import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OrderService } from '../../order/services/order.service';
import { ShipmentEntity } from '../entities/shipment.entity';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import { ShipmentService } from './shipment.service';
import { PackingService } from './packing.service';
import { ShipmentShipService } from './shipment-ship.service';
import { ShipmentStateInvalidError } from '../errors/shipment.errors';
import { QuickShipResultDto, QuickShipShipmentDto } from '../dto/shipment.dto';
import { DomainError } from '../../../common/errors/domain.error';

/** One order's outcome inside a batch 发货 (订单页多选, 2026-10-13). */
export interface BatchShipItem {
  orderId: string;
  orderNo: string | null;
  ok: boolean;
  code: string | null;
  message: string | null;
  orderErpStatus: string | null;
  shipments: QuickShipShipmentDto[];
}

export interface BatchShipResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchShipItem[];
}

/**
 * One-click outbound (2026-09-18 order fulfillment flow): the order page's
 * 发货 button.
 *
 * It is an ORCHESTRATOR over the existing, already-tested ladder - it never
 * touches stock itself and never bypasses a packing rule:
 *
 *   createShipmentsFromOrder (PICKED lines only, 1 shipment = 1 warehouse)
 *   -> createPackage + packAllItems + sealPackage (single parcel path)
 *   -> ShipmentShipService.shipShipment (the ONE stock-consuming step)
 *
 * Idempotent by construction: existing live shipments are reused instead of
 * recreated, an already packed/sealed shipment skips packing, and
 * `shipShipment` replays without a second stock deduction. Platform
 * knowledge stays out of this service entirely.
 */
@Injectable()
export class QuickShipService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly packageRepo: PackageRepository,
    private readonly shipmentService: ShipmentService,
    private readonly packingService: PackingService,
    private readonly shipService: ShipmentShipService,
    private readonly orderService: OrderService,
    private readonly operationLog: OperationLogService,
  ) {}

  async quickShipOrder(orderId: string, operator: OperatorContext): Promise<QuickShipResultDto> {
    // Serialized per order: see withOrderLock. Without it two simultaneous
    // 发货 requests both find no shipment, both try to create one and the
    // loser dies on the ACTIVE-shipment-item unique index (verified by the
    // concurrency integration test).
    return this.withOrderLock(orderId, () => this.runQuickShip(orderId, operator));
  }

  /**
   * 批量发货（订单页多选, 2026-10-13）：逐单复用 quickShipOrder（含按单
   * 串行锁与幂等回放），单笔失败只记录结果、不拖垮整批（AGENTS §36/§43）。
   * 出库扣库存永远只发生在 shipShipment 这条已测路径里。
   */
  async quickShipBatch(orderIds: string[], operator: OperatorContext): Promise<BatchShipResult> {
    const results: BatchShipItem[] = [];
    for (const orderId of new Set(orderIds)) {
      try {
        const result = await this.quickShipOrder(orderId, operator);
        results.push({
          orderId,
          orderNo: result.orderNo,
          ok: true,
          code: null,
          message: null,
          orderErpStatus: result.orderErpStatus,
          shipments: result.shipments,
        });
      } catch (error: unknown) {
        results.push({
          orderId,
          orderNo: null,
          ok: false,
          code: error instanceof DomainError ? error.code : 'ORDER_QUICK_SHIP_FAILED',
          message: error instanceof Error ? error.message : String(error),
          orderErpStatus: null,
          shipments: [],
        });
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  private async runQuickShip(
    orderId: string,
    operator: OperatorContext,
  ): Promise<QuickShipResultDto> {
    const order = await this.orderService.getOrderOrThrow(orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new ShipmentStateInvalidError('订单已取消，不能发货', { orderId });
    }

    // Existing live shipments first: a retry after a partial failure must not
    // create a second shipment for the same lines.
    let shipments = await this.shipmentRepo.listLiveByOrderId(orderId);
    if (shipments.length === 0) {
      // Throws SHIPMENT_NO_ELIGIBLE_ITEMS when no line is PICKED yet - that is
      // the flow's guard for "拣货还没完成".
      await this.shipmentService.createShipmentsFromOrder(orderId, operator);
      shipments = await this.shipmentRepo.listLiveByOrderId(orderId);
    }

    const results: QuickShipShipmentDto[] = [];
    for (const shipment of shipments) {
      results.push(await this.shipOne(shipment, order.platformTrackingNo ?? null, operator));
    }

    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: orderId,
      entityCode: order.orderNo,
      action: 'QUICK_SHIP',
      changes: {
        shipments: { from: null, to: results.length },
        trackingNumber: { from: null, to: order.platformTrackingNo ?? null },
      },
      operator,
    });

    // shipShipment recomputes the rollup per shipment; read the settled value
    // back instead of deriving it here (OrderStatusService owns the machine).
    const settled = await this.orderService.getOrderOrThrow(orderId);
    return {
      orderId,
      orderNo: order.orderNo,
      orderErpStatus: settled.erpStatus,
      trackingNumber: order.platformTrackingNo ?? null,
      shipments: results,
    };
  }

  private async shipOne(
    shipment: ShipmentEntity,
    platformTrackingNo: string | null,
    operator: OperatorContext,
  ): Promise<QuickShipShipmentDto> {
    if (shipment.status === 'SHIPPED') {
      return {
        shipmentId: shipment.id,
        shipmentNo: shipment.shipmentNo,
        packageId: null,
        packageNo: null,
        alreadyShipped: true,
      };
    }

    const packageId = await this.ensurePackedPackage(shipment, operator);
    const packageNo =
      packageId === null ? null : ((await this.packageRepo.findById(packageId))?.packageNo ?? null);

    // Prefer a tracking number somebody already put on the shipment (manual
    // entry, previous ship attempt); otherwise fill in the platform waybill.
    // Blank strings count as absent - `''` must not win over a real number.
    const existingTracking =
      shipment.trackingNumber === null ||
      shipment.trackingNumber === undefined ||
      shipment.trackingNumber === ''
        ? null
        : shipment.trackingNumber;

    const shipped = await this.shipService.shipShipment(
      shipment.id,
      existingTracking === null && platformTrackingNo !== null
        ? { trackingNumber: platformTrackingNo }
        : {},
      operator,
    );

    return {
      shipmentId: shipment.id,
      shipmentNo: shipment.shipmentNo,
      packageId,
      packageNo,
      alreadyShipped: shipped.alreadyShipped,
    };
  }

  /**
   * Makes the shipment fully packed and sealed with ONE parcel - the
   * single-package shortcut of the flow. Returns the package it used (null
   * when there was nothing left to pack, i.e. the shipment is already
   * READY_TO_SHIP or somebody packed it by hand).
   */
  private async ensurePackedPackage(
    shipment: ShipmentEntity,
    operator: OperatorContext,
  ): Promise<string | null> {
    if (shipment.status === 'READY_TO_SHIP') {
      return null;
    }
    // The package is chosen/opened under the shipment row lock, so a
    // concurrent outbound attempt cannot also open one (an empty live package
    // would block READY_TO_SHIP forever).
    const target = await this.packingService.ensureOpenPackage(shipment.id, operator);
    if (target === null) {
      return null;
    }
    await this.packingService.packAllItems(target.packageId, operator);
    await this.packingService.sealPackage(target.packageId, {}, operator);
    return target.packageId;
  }

  /**
   * Runs `work` while holding a PostgreSQL advisory lock scoped to this order.
   *
   * The flow spans SEVERAL transactions (shipment creation, packing, sealing,
   * shipping), so no single row lock can cover it - a session-scoped advisory
   * lock is the "explicitly verified equivalent concurrency control" AGENTS.md
   * §18 allows. A double-click therefore becomes a serialized replay instead
   * of a duplicate-shipment crash, and the lock is released on the very
   * connection that took it.
   */
  private async withOrderLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query('SELECT pg_advisory_lock($1, hashtext($2))', [
        ORDER_LOCK_NAMESPACE,
        orderId,
      ]);
      return await work();
    } finally {
      await runner
        .query('SELECT pg_advisory_unlock($1, hashtext($2))', [ORDER_LOCK_NAMESPACE, orderId])
        .catch(() => undefined);
      await runner.release();
    }
  }
}

/** Advisory-lock namespace so the key can never collide with another feature. */
const ORDER_LOCK_NAMESPACE = 0x57434945 & 0x7fffffff; // "WCIE"
