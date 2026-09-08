import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuService } from '../../product/services/sku.service';
import { OrderService } from '../../order/services/order.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { ShipmentEntity } from '../entities/shipment.entity';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import { shipmentReserveKey } from '../enums/shipment.constants';
import {
  ShipmentNotFoundError,
  ShipmentNotFullyPackedError,
  ShipmentStateInvalidError,
} from '../errors/shipment.errors';
import { ShipShipmentResultDto } from '../dto/shipment.dto';

/**
 * Formal ship (Sprint 4 task §22-§28): the ONE stock-consuming step of the
 * fulfillment ladder.
 *
 * Transaction design (task §23, mirrors the P0 picking fix): a single
 * database transaction locks the shipment row, re-validates completeness,
 * consumes stock per shipment item through the transaction-aware Inventory
 * public API (ReservationService.shipStockPartialInTx: Picked - N / On Hand -
 * N / SN -> SHIPPED) and only then flips packages, the shipment itself and
 * the order items. Any failure anywhere rolls EVERYTHING back - a half-shipped
 * state (SHIPPED header with un-deducted stock, or deducted stock with a
 * READY_TO_SHIP header) cannot exist.
 *
 * Idempotency (task §26-§27): the FOR UPDATE shipment lock plus the status
 * check make a repeated ship return the already-shipped result WITHOUT a
 * second stock deduction; the deterministic inventory event keys
 * (SHIP:<reservationId>:SHIPMENT:<shipmentId>) additionally guard the ledger.
 */
@Injectable()
export class ShipmentShipService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly packageRepo: PackageRepository,
    private readonly reservationService: ReservationService,
    private readonly orderService: OrderService,
    private readonly skuService: SkuService,
    private readonly operationLog: OperationLogService,
  ) {}

  async shipShipment(
    shipmentId: string,
    input: {
      trackingNumber?: string;
      carrierCode?: string;
      shippingMethod?: string;
      idempotencyKey?: string;
    },
    operator: OperatorContext,
  ): Promise<ShipShipmentResultDto> {
    const shipment = await this.shipmentRepo.findById(shipmentId);
    if (shipment === null) {
      throw new ShipmentNotFoundError(shipmentId);
    }
    const order = await this.orderService.getOrderOrThrow(shipment.orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new ShipmentStateInvalidError('订单已取消，不能出库', {
        shipmentId,
        orderId: order.id,
      });
    }

    // Explicit QueryRunner (NOT dataSource.transaction): the inventory core's
    // transaction-aware API takes the runner itself, so stock movements and
    // every shipment-side update share ONE connection + transaction.
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let result!: { status: string; shippedAt: Date | null; alreadyShipped: boolean };
    try {
      const locked = await this.shipmentRepo.lockById(runner.manager, shipmentId);
      if (locked === null) {
        throw new ShipmentNotFoundError(shipmentId);
      }

      // Idempotent replay: a SHIPPED shipment never ships twice (task §27).
      if (locked.status === 'SHIPPED') {
        result = { status: locked.status, shippedAt: locked.shippedAt, alreadyShipped: true };
        await runner.commitTransaction();
      } else {
        await this.shipLockedShipment(runner, locked, shipmentId, input, order.id, operator);
        result = { status: 'SHIPPED', shippedAt: new Date(), alreadyShipped: false };
      }
    } catch (error: unknown) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    const orderErpStatus = await this.orderService.recomputeAfterShip(order.id, operator);
    await this.operationLog.record({
      entityType: 'SHIPMENT',
      entityId: shipmentId,
      entityCode: shipment.shipmentNo,
      action: result.alreadyShipped ? 'SHIP_IDEMPOTENT_REPLAY' : 'SHIP',
      changes: {
        status: { from: shipment.status, to: result.status },
        orderId: { from: null, to: order.id },
      },
      operator,
    });

    return {
      shipmentId,
      status: result.status,
      shippedAt: result.shippedAt,
      alreadyShipped: result.alreadyShipped,
      orderNo: order.orderNo,
      orderErpStatus,
      eventNos: [],
    };
  }

  /** The real ship path, executed while the shipment row lock is held. */
  private async shipLockedShipment(
    runner: QueryRunner,
    locked: ShipmentEntity,
    shipmentId: string,
    input: {
      trackingNumber?: string;
      carrierCode?: string;
      shippingMethod?: string;
      idempotencyKey?: string;
    },
    orderId: string,
    operator: OperatorContext,
  ): Promise<void> {
    // Completeness re-check under the lock FIRST (task §16/§66): a shipment
    // that is not fully packed reports SHIPMENT_NOT_FULLY_PACKED even when
    // the ladder status has not reached READY_TO_SHIP yet.
    const items = await this.shipmentRepo.findItemsByShipmentIdTx(runner.manager, shipmentId);
    const packages = await this.packageRepo.listByShipmentIdTx(runner.manager, shipmentId);
    const livePackages = packages.filter(
      (pkg) => pkg.status !== 'CANCELLED' && pkg.status !== 'SHIPPED',
    );
    const packedTotals = await this.packageRepo.packedTotalsByShipmentTx(
      runner.manager,
      shipmentId,
    );
    const shortfalls: Array<{ skuId: string; requiredQty: string; packedQty: string }> = [];
    for (const item of items) {
      const packed = packedTotals.get(item.orderItemId) ?? 0n;
      if (packed !== parseQty(item.quantity)) {
        shortfalls.push({
          skuId: item.skuId,
          requiredQty: item.quantity,
          packedQty: formatQty(packed),
        });
      }
    }
    if (shortfalls.length > 0 || livePackages.some((pkg) => pkg.status !== 'SEALED')) {
      throw new ShipmentNotFullyPackedError({ shipmentId, shortfalls });
    }
    if (locked.status !== 'READY_TO_SHIP') {
      throw new ShipmentStateInvalidError(
        `发货单状态 ${locked.status} 不允许出库（需 READY_TO_SHIP）`,
        { shipmentId, status: locked.status },
      );
    }
    if (locked.orderId !== orderId) {
      throw new ShipmentStateInvalidError('发货单与订单不匹配', { shipmentId, orderId });
    }

    // Consume stock per shipment item on the SAME runner (task §22).
    for (const item of items) {
      const sku = await this.skuService.getEntityById(item.skuId);
      const serialNumbers =
        sku?.serialTracking === true
          ? await this.packageRepo.findSerialsOfShipmentItem(
              runner.manager,
              shipmentId,
              item.orderItemId,
            )
          : undefined;
      await this.reservationService.shipStockPartialInTx(runner, item.reservationId, {
        quantity: item.quantity,
        serialNumbers,
        idempotencyKey: input.idempotencyKey ?? shipmentReserveKey(shipmentId),
        operator,
        remark: `shipment=${locked.shipmentNo}`,
      });
    }

    // Only after ALL stock movements succeeded: flip the business states.
    await this.packageRepo.updateManyStatus(
      runner.manager,
      livePackages.map((pkg) => pkg.id),
      { status: 'SHIPPED' },
    );
    await this.shipmentRepo.updateStatus(runner.manager, shipmentId, {
      status: 'SHIPPED',
      shippedAt: new Date(),
      ...(input.trackingNumber !== undefined && input.trackingNumber !== ''
        ? { trackingNumber: input.trackingNumber }
        : {}),
      ...(input.carrierCode !== undefined && input.carrierCode !== ''
        ? { carrierCode: input.carrierCode }
        : {}),
      ...(input.shippingMethod !== undefined && input.shippingMethod !== ''
        ? { shippingMethod: input.shippingMethod }
        : {}),
    });
    for (const item of items) {
      await this.orderService.markItemShippedInTx(runner.manager, item.orderItemId);
    }
    await runner.commitTransaction();
  }
}
