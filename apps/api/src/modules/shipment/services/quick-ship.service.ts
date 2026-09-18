import { Injectable } from '@nestjs/common';
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
    private readonly shipmentRepo: ShipmentRepository,
    private readonly packageRepo: PackageRepository,
    private readonly shipmentService: ShipmentService,
    private readonly packingService: PackingService,
    private readonly shipService: ShipmentShipService,
    private readonly orderService: OrderService,
    private readonly operationLog: OperationLogService,
  ) {}

  async quickShipOrder(orderId: string, operator: OperatorContext): Promise<QuickShipResultDto> {
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

    const shipped = await this.shipService.shipShipment(
      shipment.id,
      {
        // Platform waybill first, explicit operator input would win if the
        // shipment already carried one (ShipmentService.updateTracking).
        ...(shipment.trackingNumber === null && platformTrackingNo !== null
          ? { trackingNumber: platformTrackingNo }
          : {}),
      },
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
   * when the shipment was already READY_TO_SHIP, i.e. somebody packed it by
   * hand and there is nothing left to do).
   */
  private async ensurePackedPackage(
    shipment: ShipmentEntity,
    operator: OperatorContext,
  ): Promise<string | null> {
    if (shipment.status === 'READY_TO_SHIP') {
      return null;
    }

    const packages = await this.packageRepo.listByShipmentId(shipment.id);
    const reusable = packages.find(
      (pkg) => pkg.status === 'OPEN' || pkg.status === 'REPACK_REQUIRED',
    );
    const packageId =
      reusable?.id ?? (await this.packingService.createPackage(shipment.id, operator)).packageId;

    await this.packingService.packAllItems(packageId, operator);
    await this.packingService.sealPackage(packageId, {}, operator);
    return packageId;
  }
}
