import { Injectable } from '@nestjs/common';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { parseQty } from '../../../common/utils/quantity';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import { WarehouseNotFoundError } from '../../warehouse/errors/warehouse-errors';
import { InventorySafetyStockEntity } from '../entities/inventory-safety-stock.entity';
import { InventoryQuantityInvalidError } from '../errors/inventory.errors';
import { InventorySafetyStockRepository } from '../repositories/inventory-safety-stock.repository';

export interface SafetyStockDto {
  id: string;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  safetyQty: string;
  updatedAt: Date;
}

/**
 * Safety stock policy (task §11-§12, §40, inventory.md §40-§41): a sales
 * protection number per (sku, warehouse). Setting it changes neither On Hand
 * nor the ledger - only Operation Log records the change (task §48).
 */
@Injectable()
export class InventorySafetyStockService {
  constructor(
    private readonly repository: InventorySafetyStockRepository,
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly operationLog: OperationLogService,
  ) {}

  async upsert(
    skuId: string,
    warehouseId: string,
    safetyQty: string,
    operator: OperatorContext,
  ): Promise<SafetyStockDto> {
    const qty = parseQty(safetyQty);
    if (qty < 0n) {
      throw new InventoryQuantityInvalidError('安全库存不能为负');
    }
    const sku = await this.skuService.getEntityById(skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
    const warehouse = await this.warehouseService.getEntityById(warehouseId);
    if (warehouse === null) {
      throw new WarehouseNotFoundError(warehouseId);
    }

    const before = await this.repository.findBySkuWarehouse(skuId, warehouseId);
    const saved = await this.repository.upsert(skuId, warehouseId, safetyQty);
    await this.operationLog.record({
      entityType: 'INVENTORY_SAFETY_STOCK',
      entityId: saved.id,
      entityCode: `${sku.skuCode}/${warehouse.warehouseCode}`,
      action: 'SAFETY_STOCK_UPDATE',
      changes: { safetyQty: { from: before?.safetyQty ?? null, to: safetyQty } },
      operator,
    });
    return this.toDto(saved, sku.skuCode, warehouse.warehouseCode);
  }

  async listBySku(skuId: string): Promise<SafetyStockDto[]> {
    const sku = await this.skuService.getEntityById(skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
    const rows = await this.repository.findBySku(skuId);
    const warehouses = await Promise.all(
      rows.map((row) => this.warehouseService.getEntityById(row.warehouseId)),
    );
    return rows.map((row, index) =>
      this.toDto(row, sku.skuCode, warehouses[index]?.warehouseCode ?? ''),
    );
  }

  async list(
    filters: { skuId?: string; warehouseId?: string },
    page: { page: number; pageSize: number },
  ): Promise<{ items: SafetyStockDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const { rows, total } = await this.repository.list(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map(({ safety, skuCode, warehouseCode }) =>
        this.toDto(safety, skuCode, warehouseCode),
      ),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  private toDto(
    row: InventorySafetyStockEntity,
    skuCode: string,
    warehouseCode: string,
  ): SafetyStockDto {
    return {
      id: row.id,
      skuId: row.skuId,
      skuCode,
      warehouseId: row.warehouseId,
      warehouseCode,
      safetyQty: row.safetyQty,
      updatedAt: row.updatedAt,
    };
  }
}
