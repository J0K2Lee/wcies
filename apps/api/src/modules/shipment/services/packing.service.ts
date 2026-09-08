import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { BarcodeService } from '../../product/services/barcode.service';
import { SkuService } from '../../product/services/sku.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { ShipmentEntity } from '../entities/shipment.entity';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import {
  PackageEmptyError,
  PackageNotFoundError,
  PackingBarcodeNotFoundError,
  PackingQuantityExceededError,
  PackingSerialInvalidError,
  PackingSkuMismatchError,
  ShipmentNotFoundError,
  ShipmentStateInvalidError,
} from '../errors/shipment.errors';
import { PackingScanResultDto, SealPackageResultDto } from '../dto/shipment.dto';

/**
 * Packing workflow (Sprint 4 task §15-§18): create package -> scan SKU
 * barcodes (one scan = one unit) -> seal. Packing NEVER touches stock
 * (task §17) - it only records what went into which box; quantities are
 * validated against the shipment snapshot and SN ownership against the
 * order's reservation.
 *
 * Concurrency: every scan/seal runs one transaction that locks the SHIPMENT
 * row first, then the package row - all packing operations of a shipment
 * serialize deterministically, so packed totals can never race past the
 * snapshot (task §16).
 */
@Injectable()
export class PackingService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly packageRepo: PackageRepository,
    private readonly barcodeService: BarcodeService,
    private readonly skuService: SkuService,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly operationLog: OperationLogService,
  ) {}

  // --------------------------------------------------------------------------
  // Create package (task §15)
  // --------------------------------------------------------------------------

  async createPackage(
    shipmentId: string,
    operator: OperatorContext,
  ): Promise<{ packageId: string; packageNo: string; shipmentStatus: string }> {
    await this.assertShipmentExists(shipmentId);
    const created = await this.dataSource.transaction(async (manager) => {
      const shipment = await this.lockShipmentForPacking(manager, shipmentId);
      const packageNo = await this.packageRepo.nextPackageNo(manager);
      const pkg = await this.packageRepo.insert(manager, { packageNo, shipmentId });
      if (shipment.status === 'READY_TO_PACK') {
        await this.shipmentRepo.updateStatus(manager, shipmentId, { status: 'PACKING' });
      }
      return { packageId: pkg.id, packageNo: pkg.packageNo, shipmentStatus: 'PACKING' };
    });
    await this.operationLog.record({
      entityType: 'PACKAGE',
      entityId: created.packageId,
      entityCode: created.packageNo,
      action: 'CREATE',
      changes: { shipmentId: { from: null, to: shipmentId } },
      operator,
    });
    return created;
  }

  // --------------------------------------------------------------------------
  // Scan (task §17-§18)
  // --------------------------------------------------------------------------

  async scanItem(
    packageId: string,
    input: { barcode: string; serialNumber?: string },
    operator: OperatorContext,
  ): Promise<PackingScanResultDto> {
    const pkg = await this.packageRepo.findById(packageId);
    if (pkg === null) {
      throw new PackageNotFoundError(packageId);
    }

    // 1. Barcode -> SKU, resolved by the BACKEND (task §17).
    const barcode = input.barcode.trim();
    const barcodeRow = await this.barcodeService.findByBarcode(barcode);
    if (barcodeRow === null) {
      throw new PackingBarcodeNotFoundError(barcode);
    }
    const sku = await this.skuService.getEntityById(barcodeRow.skuId);
    if (sku === null) {
      throw new PackingBarcodeNotFoundError(barcode);
    }

    // 2. Pre-validation (read-only): does this shipment wait for that SKU,
    //    and is the SN (if any) owned by the right reservation?
    const shipmentItems = await this.shipmentRepo.findItemsByShipmentId(pkg.shipmentId);
    const candidates = shipmentItems.filter((item) => item.skuId === sku.id);
    if (candidates.length === 0) {
      throw new PackingSkuMismatchError({
        scannedSkuId: sku.id,
        scannedBarcode: barcode,
        shipmentId: pkg.shipmentId,
      });
    }
    let serialNumber: string | null = null;
    if (sku.serialTracking) {
      const trimmed = input.serialNumber?.trim();
      if (trimmed === undefined || trimmed === '') {
        throw new PackingSerialInvalidError('该 SKU 启用 SN 管理，打包必须扫描序列号', {
          skuId: sku.id,
        });
      }
      serialNumber = trimmed;
      const serial = await this.inventoryQuery.findSerialByNumber(trimmed);
      if (serial === null) {
        throw new PackingSerialInvalidError('SN 不存在', { serialNumber: trimmed });
      }
      const owned = candidates.some((item) => item.reservationId === serial.reservationId);
      if (!owned || serial.status !== 'PICKED' || serial.skuId !== sku.id) {
        throw new PackingSerialInvalidError(
          'SN 不属于该订单或状态不允许打包（禁止装入别的订单的 SN）',
          {
            serialNumber: trimmed,
            serialStatus: serial.status,
          },
        );
      }
    } else if (input.serialNumber !== undefined && input.serialNumber.trim() !== '') {
      throw new PackingSerialInvalidError('该 SKU 未启用 SN 管理，无需序列号', { skuId: sku.id });
    }

    // 3. One transaction: lock shipment -> lock package -> re-validate totals
    //    -> increment package item (+ serial row).
    const result = await this.dataSource.transaction(async (manager) => {
      await this.lockShipmentForPacking(manager, pkg.shipmentId);
      const lockedPkg = await this.packageRepo.lockById(manager, packageId);
      if (lockedPkg === null) {
        throw new PackageNotFoundError(packageId);
      }
      if (lockedPkg.status !== 'OPEN' && lockedPkg.status !== 'REPACK_REQUIRED') {
        throw new ShipmentStateInvalidError(
          `包裹状态 ${lockedPkg.status} 不允许扫码（仅 OPEN / REPACK_REQUIRED）`,
          { packageId, status: lockedPkg.status },
        );
      }

      const totals = await this.packageRepo.packedTotalsByShipmentTx(manager, pkg.shipmentId);
      const target = candidates.find(
        (item) => (totals.get(item.orderItemId) ?? 0n) < parseQty(item.quantity),
      );
      if (target === undefined) {
        const done = candidates[0]!;
        throw new PackingQuantityExceededError({
          packageId,
          orderItemId: done.orderItemId,
          requiredQty: done.quantity,
          packedQty: formatQty(totals.get(done.orderItemId) ?? 0n),
        });
      }

      let packageItem = await this.packageRepo.lockItem(manager, packageId, target.orderItemId);
      if (packageItem === null) {
        packageItem = await this.packageRepo.insertItem(manager, {
          packageId,
          orderItemId: target.orderItemId,
          skuId: target.skuId,
          quantity: '0.000',
        });
      }
      const newQty = parseQty(packageItem.quantity) + 1000n; // one scan = one unit
      await this.packageRepo.updateItemQuantity(manager, packageItem.id, formatQty(newQty));
      if (serialNumber !== null) {
        await this.packageRepo.insertSerial(manager, {
          packageItemId: packageItem.id,
          packageId,
          orderItemId: target.orderItemId,
          skuId: target.skuId,
          serialNumber,
        });
      }
      return {
        orderItemId: target.orderItemId,
        packedQty: formatQty((totals.get(target.orderItemId) ?? 0n) + 1000n),
        requiredQty: target.quantity,
      };
    });

    await this.operationLog.record({
      entityType: 'PACKAGE',
      entityId: packageId,
      entityCode: pkg.packageNo,
      action: 'SCAN_ITEM',
      changes: {
        skuCode: { from: null, to: sku.skuCode },
        orderItemId: { from: null, to: result.orderItemId },
      },
      operator,
    });

    return {
      packageId,
      orderItemId: result.orderItemId,
      skuId: sku.id,
      skuCode: sku.skuCode,
      packedQty: result.packedQty,
      requiredQty: result.requiredQty,
      serialNumber,
      message: `已装 ${sku.skuCode} ×${result.packedQty} / 应装 ${result.requiredQty}`,
    };
  }

  // --------------------------------------------------------------------------
  // Seal (task §15-§16)
  // --------------------------------------------------------------------------

  async sealPackage(
    packageId: string,
    input: {
      weightKg?: string;
      lengthCm?: string;
      widthCm?: string;
      heightCm?: string;
    },
    operator: OperatorContext,
  ): Promise<SealPackageResultDto> {
    const pkg = await this.packageRepo.findById(packageId);
    if (pkg === null) {
      throw new PackageNotFoundError(packageId);
    }
    const result = await this.dataSource.transaction(async (manager) => {
      const shipment = await this.lockShipmentForPacking(manager, pkg.shipmentId);
      const lockedPkg = await this.packageRepo.lockById(manager, packageId);
      if (lockedPkg === null) {
        throw new PackageNotFoundError(packageId);
      }
      if (lockedPkg.status !== 'OPEN' && lockedPkg.status !== 'REPACK_REQUIRED') {
        throw new ShipmentStateInvalidError(`包裹状态 ${lockedPkg.status} 不允许封箱`, {
          packageId,
          status: lockedPkg.status,
        });
      }
      const items = await this.packageRepo.findItems(packageId);
      if (items.length === 0) {
        throw new PackageEmptyError({ packageId });
      }
      // SN invariants: every SERIAL-TRACKED item's serialized count must
      // equal its quantity (non-serial items carry no serial rows at all).
      for (const item of items) {
        const sku = await this.skuService.getEntityById(item.skuId);
        if (sku?.serialTracking !== true) {
          continue;
        }
        const serialized = await this.packageRepo.countSerialsOfItemTx(manager, item.id);
        if (parseQty(item.quantity) !== serialized) {
          throw new PackingSerialInvalidError(
            `SN 管理商品 ${sku?.skuCode ?? item.skuId} 打包数量与 SN 记录不一致`,
            { packageId, orderItemId: item.orderItemId, quantity: item.quantity },
          );
        }
      }

      await this.packageRepo.updateStatus(manager, packageId, {
        status: 'SEALED',
        sealedAt: new Date(),
        ...(input.weightKg !== undefined ? { weightKg: input.weightKg } : {}),
        ...(input.lengthCm !== undefined ? { lengthCm: input.lengthCm } : {}),
        ...(input.widthCm !== undefined ? { widthCm: input.widthCm } : {}),
        ...(input.heightCm !== undefined ? { heightCm: input.heightCm } : {}),
      });

      // Advance the shipment ladder: fully packed + every live package sealed
      // -> READY_TO_SHIP; anything less -> PACKING (task §16).
      const packages = await this.packageRepo.listByShipmentIdTx(manager, pkg.shipmentId);
      const unsealed = packages.filter(
        (candidate) => candidate.status === 'OPEN' || candidate.status === 'REPACK_REQUIRED',
      );
      const { complete } = await this.evaluateCompleteness(manager, pkg.shipmentId);
      const nextStatus = complete && unsealed.length === 0 ? 'READY_TO_SHIP' : 'PACKING';
      if (shipment.status !== nextStatus) {
        await this.shipmentRepo.updateStatus(manager, pkg.shipmentId, { status: nextStatus });
      }
      return {
        shipmentId: pkg.shipmentId,
        shipmentStatus: nextStatus,
        totalQty: formatQty(items.reduce((sum, item) => sum + parseQty(item.quantity), 0n)),
      };
    });

    await this.operationLog.record({
      entityType: 'PACKAGE',
      entityId: packageId,
      entityCode: pkg.packageNo,
      action: 'SEAL',
      changes: { status: { from: pkg.status, to: 'SEALED' } },
      operator,
    });
    return {
      packageId,
      packageStatus: 'SEALED',
      shipmentId: result.shipmentId,
      shipmentStatus: result.shipmentStatus,
      totalQty: result.totalQty,
    };
  }

  // --------------------------------------------------------------------------
  // Reads for the package workbench
  // --------------------------------------------------------------------------

  async getPackageWorkbench(packageId: string): Promise<{
    package: {
      id: string;
      packageNo: string;
      shipmentId: string;
      status: string;
      sealedAt: Date | null;
      createdAt: Date;
    };
    shipmentNo: string;
    shipmentStatus: string;
    items: Array<{
      id: string;
      orderItemId: string;
      skuId: string;
      skuCode: string;
      skuName: string;
      quantity: string;
      serialNumbers: string[];
    }>;
    demand: Array<{
      orderItemId: string;
      skuId: string;
      skuCode: string;
      skuName: string;
      primaryBarcode: string | null;
      requiredQty: string;
      packedQty: string;
      serialTracking: boolean;
      pendingSerialNumbers: string[];
    }>;
  }> {
    const pkg = await this.packageRepo.findById(packageId);
    if (pkg === null) {
      throw new PackageNotFoundError(packageId);
    }
    const shipment = await this.shipmentRepo.findById(pkg.shipmentId);
    if (shipment === null) {
      throw new ShipmentNotFoundError(pkg.shipmentId);
    }
    const [shipmentItems, packageItems, packedTotalsRows] = await Promise.all([
      this.shipmentRepo.findItemsByShipmentId(pkg.shipmentId),
      this.packageRepo.findItems(packageId),
      this.dataSource.query<Array<{ order_item_id: string; packed: string }>>(
        `SELECT pi.order_item_id, SUM(pi.quantity)::text AS packed
           FROM package_items pi
           JOIN packages p ON p.id = pi.package_id
          WHERE p.shipment_id = $1::uuid
            AND p.status IN ('OPEN', 'SEALED', 'REPACK_REQUIRED')
          GROUP BY pi.order_item_id`,
        [pkg.shipmentId],
      ),
    ]);
    const packedTotals = new Map(packedTotalsRows.map((row) => [row.order_item_id, row.packed]));
    const serials = await this.packageRepo.findSerialsOfPackage(packageId);

    const demand = await Promise.all(
      shipmentItems.map(async (item) => {
        const [sku, barcodes] = await Promise.all([
          this.skuService.getEntityById(item.skuId),
          this.barcodeService.listBySku(item.skuId),
        ]);
        let pendingSerialNumbers: string[] = [];
        if (sku?.serialTracking === true) {
          const reservationSerials = await this.inventoryQuery.listReservationSerials(
            item.reservationId,
          );
          const picked = reservationSerials
            .filter((entry) => entry.status === 'PICKED')
            .map((entry) => entry.serialNumber);
          const packedRows = (await this.dataSource.query<Array<{ serial_number: string }>>(
            `SELECT pis.serial_number
               FROM package_item_serials pis
               JOIN packages p ON p.id = pis.package_id
              WHERE p.shipment_id = $1::uuid
                AND pis.order_item_id = $2::uuid
                AND p.status <> 'CANCELLED'`,
            [pkg.shipmentId, item.orderItemId],
          )) as Array<{ serial_number: string }>;
          const packedSet = new Set(packedRows.map((row) => row.serial_number));
          pendingSerialNumbers = picked.filter((sn) => !packedSet.has(sn));
        }
        return {
          orderItemId: item.orderItemId,
          skuId: item.skuId,
          skuCode: sku?.skuCode ?? '',
          skuName: sku?.nameZh ?? '',
          primaryBarcode:
            barcodes.find((barcode) => barcode.isPrimary)?.barcode ?? barcodes[0]?.barcode ?? null,
          requiredQty: item.quantity,
          packedQty: packedTotals.get(item.orderItemId) ?? '0.000',
          serialTracking: sku?.serialTracking ?? false,
          pendingSerialNumbers,
        };
      }),
    );

    const items = await Promise.all(
      packageItems.map(async (item) => {
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
      package: {
        id: pkg.id,
        packageNo: pkg.packageNo,
        shipmentId: pkg.shipmentId,
        status: pkg.status,
        sealedAt: pkg.sealedAt,
        createdAt: pkg.createdAt,
      },
      shipmentNo: shipment.shipmentNo,
      shipmentStatus: shipment.status,
      items,
      demand,
    };
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async assertShipmentExists(shipmentId: string): Promise<void> {
    const shipment = await this.shipmentRepo.findById(shipmentId);
    if (shipment === null) {
      throw new ShipmentNotFoundError(shipmentId);
    }
  }

  /** Locks the shipment and validates the packing-phase status. */
  private async lockShipmentForPacking(
    manager: EntityManager,
    shipmentId: string,
  ): Promise<ShipmentEntity> {
    const shipment = await this.shipmentRepo.lockById(manager, shipmentId);
    if (shipment === null) {
      throw new ShipmentNotFoundError(shipmentId);
    }
    if (
      shipment.status !== 'READY_TO_PACK' &&
      shipment.status !== 'PACKING' &&
      shipment.status !== 'READY_TO_SHIP'
    ) {
      throw new ShipmentStateInvalidError(`发货单状态 ${shipment.status} 不允许打包操作`, {
        shipmentId,
        status: shipment.status,
      });
    }
    return shipment;
  }

  private async evaluateCompleteness(
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
}
