import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { OrderService } from '../../order/services/order.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { ShipmentEntity } from '../entities/shipment.entity';
import { ShipmentListFilters, ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import { ShippingLabelRepository } from '../repositories/shipping-label.repository';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import {
  ShipmentNoEligibleItemsError,
  ShipmentNotFoundError,
  ShipmentStateInvalidError,
} from '../errors/shipment.errors';
import {
  PackageListItemDto,
  ShipmentDetailDto,
  ShipmentItemDto,
  ShipmentListItemDto,
} from '../dto/shipment.dto';

/**
 * Shipment application service (Sprint 4 task §7-§9/§13-§14): creation from
 * a PICKED order (split per warehouse), reads and manual tracking input.
 * Stock only ever moves through the Inventory services in the ship path.
 */
@Injectable()
export class ShipmentService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly packageRepo: PackageRepository,
    private readonly labelRepo: ShippingLabelRepository,
    private readonly orderService: OrderService,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly operationLog: OperationLogService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  // --------------------------------------------------------------------------
  // Creation (task §13-§14)
  // --------------------------------------------------------------------------

  /**
   * Creates one shipment per warehouse from the order's PICKED lines that are
   * not yet assigned to a live shipment. Only PICKED lines may enter
   * (task §13); BACKORDERED / RESERVED / mapping-FAILED lines never do.
   */
  async createShipmentsFromOrder(
    orderId: string,
    operator: OperatorContext,
  ): Promise<ShipmentListItemDto[]> {
    const candidates = await this.orderService.listPickedItemsForShipment(orderId);
    const eligible: typeof candidates = [];
    for (const candidate of candidates) {
      const assigned = await this.shipmentRepo.findLiveShipmentOfOrderItem(candidate.orderItemId);
      if (assigned === null) {
        eligible.push(candidate);
      }
    }
    if (eligible.length === 0) {
      throw new ShipmentNoEligibleItemsError({ orderId });
    }

    // 1 shipment = 1 warehouse (task §14), like 1 PickingTask = 1 Warehouse.
    const byWarehouse = new Map<string, typeof candidates>();
    for (const candidate of eligible) {
      const bucket = byWarehouse.get(candidate.warehouseId) ?? [];
      bucket.push(candidate);
      byWarehouse.set(candidate.warehouseId, bucket);
    }

    const created: ShipmentEntity[] = [];
    for (const [warehouseId, bucket] of byWarehouse) {
      const shipment = await this.dataSource.transaction(async (manager) => {
        const shipmentNo = await this.shipmentRepo.nextShipmentNo(manager);
        return this.shipmentRepo.insertWithItems(
          manager,
          { shipmentNo, orderId, warehouseId, status: 'READY_TO_PACK' },
          bucket.map((item) => ({
            orderItemId: item.orderItemId,
            skuId: item.skuId,
            reservationId: item.reservationId,
            quantity: item.quantity,
          })),
        );
      });
      created.push(shipment);
      await this.operationLog.record({
        entityType: 'SHIPMENT',
        entityId: shipment.id,
        entityCode: shipment.shipmentNo,
        action: 'CREATE',
        changes: {
          orderId: { from: null, to: orderId },
          warehouseId: { from: null, to: warehouseId },
          items: { from: null, to: bucket.length },
        },
        operator,
      });
    }

    return Promise.all(created.map((shipment) => this.toListItem(shipment.id)));
  }

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async list(
    filters: ShipmentListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: ShipmentListItemDto[]; meta: PageMeta }> {
    const { rows, total } = await this.shipmentRepo.listWithAggregates(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => this.toListItemDto(row)),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getDetail(shipmentId: string): Promise<ShipmentDetailDto> {
    const shipment = await this.getShipmentOrThrow(shipmentId);
    const [order, warehouse, itemRows, packages, labels] = await Promise.all([
      this.orderService.getOrderOrThrow(shipment.orderId),
      this.warehouseService.getEntityById(shipment.warehouseId),
      this.shipmentRepo.findItemsByShipmentId(shipmentId),
      this.packageRepo.listByShipmentId(shipmentId),
      this.labelRepo.listByShipmentId(shipmentId),
    ]);

    const packedTotals = new Map<string, bigint>();
    for (const pkg of packages) {
      if (pkg.status === 'CANCELLED' || pkg.status === 'SHIPPED') {
        continue;
      }
      for (const item of await this.packageRepo.findItems(pkg.id)) {
        packedTotals.set(
          item.orderItemId,
          (packedTotals.get(item.orderItemId) ?? 0n) + parseQty(item.quantity),
        );
      }
    }

    const itemDtos: ShipmentItemDto[] = [];
    for (const item of itemRows) {
      const sku = await this.skuService.getEntityById(item.skuId);
      const serialNumbers =
        sku?.serialTracking === true
          ? await this.shipmentSerialsOnPool(shipmentId, item.orderItemId)
          : [];
      itemDtos.push({
        id: item.id,
        orderItemId: item.orderItemId,
        skuId: item.skuId,
        skuCode: sku?.skuCode ?? '',
        skuName: sku?.nameZh ?? '',
        reservationId: item.reservationId,
        quantity: item.quantity,
        packedQty: formatQty(packedTotals.get(item.orderItemId) ?? 0n),
        serialTracking: sku?.serialTracking ?? false,
        serialNumbers,
      });
    }

    const packageDtos = await Promise.all(packages.map((pkg) => this.toPackageDto(pkg)));

    const labelDtos = await Promise.all(
      labels.map(async (label) => ({
        id: label.id,
        packageId: label.packageId,
        labelType: label.labelType,
        fileName: label.fileName,
        mimeType: label.mimeType,
        fileSize: label.fileSize,
        source: label.source,
        createdAt: label.createdAt,
        signedUrl: await this.objectStorage.getSignedUrl(label.objectKey),
      })),
    );

    return {
      id: shipment.id,
      shipmentNo: shipment.shipmentNo,
      orderId: shipment.orderId,
      orderNo: order.orderNo,
      warehouseId: shipment.warehouseId,
      warehouseCode: warehouse?.warehouseCode ?? '',
      warehouseName: warehouse?.name ?? '',
      status: shipment.status,
      trackingNumber: shipment.trackingNumber,
      carrierCode: shipment.carrierCode,
      shippingMethod: shipment.shippingMethod,
      shippedAt: shipment.shippedAt,
      createdAt: shipment.createdAt,
      items: itemDtos,
      packages: packageDtos,
      labels: labelDtos,
    };
  }

  async getShipmentOrThrow(shipmentId: string): Promise<ShipmentEntity> {
    const shipment = await this.shipmentRepo.findById(shipmentId);
    if (shipment === null) {
      throw new ShipmentNotFoundError(shipmentId);
    }
    return shipment;
  }

  // --------------------------------------------------------------------------
  // Manual tracking input (task §28)
  // --------------------------------------------------------------------------

  async updateTracking(
    shipmentId: string,
    input: { trackingNumber?: string; carrierCode?: string; shippingMethod?: string },
    operator: OperatorContext,
  ): Promise<ShipmentDetailDto> {
    const shipment = await this.getShipmentOrThrow(shipmentId);
    if (shipment.status === 'SHIPPED' || shipment.status === 'CANCELLED') {
      throw new ShipmentStateInvalidError(`发货单状态 ${shipment.status} 不允许修改物流信息`, {
        shipmentId,
        status: shipment.status,
      });
    }
    const before = {
      trackingNumber: shipment.trackingNumber,
      carrierCode: shipment.carrierCode,
      shippingMethod: shipment.shippingMethod,
    };
    await this.dataSource.transaction(async (manager) => {
      await this.shipmentRepo.updateStatus(manager, shipmentId, {
        ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
        ...(input.carrierCode !== undefined ? { carrierCode: input.carrierCode } : {}),
        ...(input.shippingMethod !== undefined ? { shippingMethod: input.shippingMethod } : {}),
      });
    });
    await this.operationLog.record({
      entityType: 'SHIPMENT',
      entityId: shipmentId,
      entityCode: shipment.shipmentNo,
      action: 'UPDATE_TRACKING',
      changes: {
        trackingNumber: {
          from: before.trackingNumber,
          to: input.trackingNumber ?? before.trackingNumber,
        },
      },
      operator,
    });
    return this.getDetail(shipmentId);
  }

  // --------------------------------------------------------------------------
  // Internals shared with packing / ship / interception services
  // --------------------------------------------------------------------------

  /** Packed serials of one order item inside a shipment (pool read). */
  async shipmentSerialsOnPool(shipmentId: string, orderItemId: string): Promise<string[]> {
    const rows = await this.dataSource.query<Array<{ serial_number: string }>>(
      `SELECT pis.serial_number
         FROM package_item_serials pis
         JOIN packages p ON p.id = pis.package_id
        WHERE p.shipment_id = $1::uuid
          AND pis.order_item_id = $2::uuid
          AND p.status <> 'CANCELLED'
        ORDER BY pis.serial_number ASC`,
      [shipmentId, orderItemId],
    );
    return rows.map((row) => row.serial_number);
  }

  async toListItem(shipmentId: string): Promise<ShipmentListItemDto> {
    const shipment = await this.getShipmentOrThrow(shipmentId);
    const [order, warehouse, packages] = await Promise.all([
      this.orderService.getOrderOrThrow(shipment.orderId),
      this.warehouseService.getEntityById(shipment.warehouseId),
      this.packageRepo.listByShipmentId(shipmentId),
    ]);
    const items = await this.shipmentRepo.findItemsByShipmentId(shipmentId);
    return {
      id: shipment.id,
      shipmentNo: shipment.shipmentNo,
      orderId: shipment.orderId,
      orderNo: order.orderNo,
      warehouseId: shipment.warehouseId,
      warehouseCode: warehouse?.warehouseCode ?? '',
      warehouseName: warehouse?.name ?? '',
      status: shipment.status,
      trackingNumber: shipment.trackingNumber,
      packagesCount: packages.filter((pkg) => pkg.status !== 'CANCELLED').length,
      sealedPackagesCount: packages.filter((pkg) => pkg.status === 'SEALED').length,
      itemsTotal: items.length,
      createdAt: shipment.createdAt,
      shippedAt: shipment.shippedAt,
    };
  }

  private toListItemDto(row: {
    shipment: ShipmentEntity;
    orderNo: string;
    warehouseCode: string;
    warehouseName: string;
    packagesCount: number;
    sealedPackagesCount: number;
    itemsTotal: number;
  }): ShipmentListItemDto {
    return {
      id: row.shipment.id,
      shipmentNo: row.shipment.shipmentNo,
      orderId: row.shipment.orderId,
      orderNo: row.orderNo,
      warehouseId: row.shipment.warehouseId,
      warehouseCode: row.warehouseCode,
      warehouseName: row.warehouseName,
      status: row.shipment.status,
      trackingNumber: row.shipment.trackingNumber,
      packagesCount: row.packagesCount,
      sealedPackagesCount: row.sealedPackagesCount,
      itemsTotal: row.itemsTotal,
      createdAt: row.shipment.createdAt,
      shippedAt: row.shipment.shippedAt,
    };
  }

  private async toPackageDto(pkg: {
    id: string;
    packageNo: string;
    shipmentId: string;
    status: string;
    sealedAt: Date | null;
    createdAt: Date;
  }): Promise<PackageListItemDto> {
    const items = await this.packageRepo.findItems(pkg.id);
    const serials = await this.packageRepo.findSerialsOfPackage(pkg.id);
    const itemDtos = await Promise.all(
      items.map(async (item) => {
        const sku = await this.skuService.getEntityById(item.skuId);
        return {
          id: item.id,
          orderItemId: item.orderItemId,
          skuId: item.skuId,
          skuCode: sku?.skuCode ?? '',
          skuName: sku?.nameZh ?? '',
          quantity: item.quantity,
          serialNumbers: serials
            .filter((serial) => serial.packageItemId === item.id)
            .map((serial) => serial.serialNumber),
        };
      }),
    );
    return {
      id: pkg.id,
      packageNo: pkg.packageNo,
      shipmentId: pkg.shipmentId,
      status: pkg.status,
      sealedAt: pkg.sealedAt,
      items: itemDtos,
      totalQty: formatQty(items.reduce((sum, item) => sum + parseQty(item.quantity), 0n)),
      createdAt: pkg.createdAt,
    };
  }

  /** Completeness check helper used by packing/ship/interception (task §16). */
  async evaluateCompletenessTx(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<{
    complete: boolean;
    shortfalls: Array<{ skuId: string; requiredQty: string; packedQty: string }>;
  }> {
    const items = await this.shipmentRepo.findItemsByShipmentIdTx(manager, shipmentId);
    const packedTotals = await this.packageRepo.packedTotalsByShipmentTx(manager, shipmentId);
    const shortfalls: Array<{ skuId: string; requiredQty: string; packedQty: string }> = [];
    let complete = true;
    for (const item of items) {
      const packed = packedTotals.get(item.orderItemId) ?? 0n;
      const required = parseQty(item.quantity);
      if (packed !== required) {
        complete = false;
        shortfalls.push({
          skuId: item.skuId,
          requiredQty: item.quantity,
          packedQty: formatQty(packed),
        });
      }
    }
    return { complete, shortfalls };
  }

  /** The live (non-cancelled) shipment an order item is assigned to, if any. */
  async findLiveShipmentOfOrderItem(
    orderItemId: string,
  ): Promise<{ shipmentId: string; status: string; shippedAt: Date | null } | null> {
    return this.shipmentRepo.findLiveShipmentOfOrderItem(orderItemId);
  }

  /** Live packages containing an order item (interception detail, no N+1). */
  async listPackagesContainingOrderItem(
    orderItemId: string,
  ): Promise<Array<{ packageId: string; packageNo: string; status: string; quantity: string }>> {
    const rows = await this.dataSource.query<
      Array<{ package_id: string; package_no: string; status: string; quantity: string }>
    >(
      `SELECT p.id AS package_id, p.package_no, p.status, pi.quantity::text AS quantity
         FROM package_items pi
         JOIN packages p ON p.id = pi.package_id
        WHERE pi.order_item_id = $1::uuid
          AND p.status <> 'CANCELLED'
        ORDER BY p.created_at ASC`,
      [orderItemId],
    );
    return rows.map((row) => ({
      packageId: row.package_id,
      packageNo: row.package_no,
      status: row.status,
      quantity: row.quantity,
    }));
  }

  /**
   * Shipment-side cleanup when an interception returns an order item to stock
   * (task §43-§44), executed inside the interception's transaction:
   * unpack the line from every live package (a formerly SEALED package goes
   * REPACK_REQUIRED, an emptied package is CANCELLED), drop the shipment-item
   * row, and re-advance the shipment ladder (PACKING / READY_TO_SHIP /
   * CANCELLED when nothing is left to send). Returns the affected shipment id
   * and the packages that were put into REPACK_REQUIRED (for auditing).
   */
  async handleInterceptionReturnInTx(
    runner: QueryRunner,
    orderItemId: string,
  ): Promise<{
    shipmentId: string | null;
    repackRequiredPackageIds: string[];
  } | null> {
    const assigned = await this.shipmentRepo.findLiveShipmentOfOrderItem(orderItemId);
    if (assigned === null) {
      return null;
    }
    const { shipmentId } = assigned;
    const shipment = await this.shipmentRepo.lockById(runner.manager, shipmentId);
    if (shipment === null || shipment.status === 'SHIPPED') {
      return null; // shipped goods are rejected earlier (task §45)
    }

    // Unpack the line from live packages; serial rows cascade with the items.
    const { affectedPackageIds, emptiedPackageIds } =
      await this.packageRepo.removeItemsForOrderItemTx(runner.manager, orderItemId);
    const repackRequired: string[] = [];
    for (const packageId of affectedPackageIds) {
      if (emptiedPackageIds.includes(packageId)) {
        await this.packageRepo.updateStatus(runner.manager, packageId, { status: 'CANCELLED' });
        continue;
      }
      const pkg = await this.packageRepo.findById(packageId);
      if (pkg !== null && pkg.status === 'SEALED') {
        // Auditable re-pack signal, never a silent re-open (task §44).
        await this.packageRepo.updateStatus(runner.manager, packageId, {
          status: 'REPACK_REQUIRED',
        });
        repackRequired.push(packageId);
      }
    }

    // Drop the shipment snapshot row so packed-vs-expected stays truthful.
    await this.shipmentRepo.removeShipmentItem(runner.manager, orderItemId);

    // Re-advance the shipment ladder.
    const remainingItems = await this.shipmentRepo.findItemsByShipmentIdTx(
      runner.manager,
      shipmentId,
    );
    if (remainingItems.length === 0) {
      await this.shipmentRepo.updateStatus(runner.manager, shipmentId, { status: 'CANCELLED' });
      return { shipmentId, repackRequiredPackageIds: repackRequired };
    }
    const packages = await this.packageRepo.listByShipmentIdTx(runner.manager, shipmentId);
    const livePackages = packages.filter(
      (pkg) => pkg.status !== 'CANCELLED' && pkg.status !== 'SHIPPED',
    );
    const { complete } = await this.evaluateCompletenessTx(runner.manager, shipmentId);
    const allSealed = livePackages.every((pkg) => pkg.status === 'SEALED');
    const nextStatus = complete && allSealed ? 'READY_TO_SHIP' : 'PACKING';
    if (shipment.status !== nextStatus) {
      await this.shipmentRepo.updateStatus(runner.manager, shipmentId, { status: nextStatus });
    }
    return { shipmentId, repackRequiredPackageIds: repackRequired };
  }
}
