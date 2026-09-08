import { Injectable } from '@nestjs/common';
import { SkuService } from '../../product/services/sku.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { InventoryService } from '../../inventory/services/inventory.service';
import { parseQty } from '../../../common/utils/quantity';
import { ImportRowError } from '../entities/import-job.entity';
import { optionalField, requiredField } from '../services/excel-parser';
import { ImportHandler, ImportRowContext, ValidRow } from './import-handler';

interface InitialInventoryRowData {
  skuCode: string;
  warehouseCode: string;
  binCode: string;
  quantity: string;
  remark: string | null;
}

/**
 * INITIAL_INVENTORY fixed template (Sprint 2 task §46-§47):
 * sku_code | warehouse_code | bin_code | quantity | remark
 *
 * - SKU / Warehouse / Bin must exist; the bin must belong to the warehouse;
 * - quantity > 0 with at most 3 decimals;
 * - duplicate (sku, warehouse, bin) rows INSIDE one file are rejected - the
 *   explainable strategy, since row-level idempotency keys differ by row
 *   number and would otherwise double-add;
 * - rows are applied through the real InventoryService.initializeStock -
 *   the handler never writes balances itself (task §46), and the stable key
 *   INITIAL_INVENTORY:<jobId>:<rowNumber> makes worker retries idempotent.
 */
@Injectable()
export class InitialInventoryImportHandler implements ImportHandler {
  readonly type = 'INITIAL_INVENTORY';

  constructor(
    private readonly skuService: SkuService,
    private readonly warehouseService: WarehouseService,
    private readonly binService: WarehouseBinService,
    private readonly inventoryService: InventoryService,
  ) {}

  async validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const validRows: ValidRow[] = [];
    const dimensionKeys = new Set<string>();

    for (const { rowNumber, cells } of rows) {
      const rowErrorsBefore = errors.length;

      const skuCode = requiredField(rowNumber, cells, 'sku_code', errors);
      const warehouseCode = requiredField(rowNumber, cells, 'warehouse_code', errors);
      const binCode = requiredField(rowNumber, cells, 'bin_code', errors);

      const quantityText = requiredField(rowNumber, cells, 'quantity', errors);
      if (quantityText !== '') {
        try {
          if (parseQty(quantityText) <= 0n) {
            throw new Error('must be > 0');
          }
        } catch {
          errors.push({
            row: rowNumber,
            field: 'quantity',
            code: 'INITIAL_INVENTORY_QUANTITY_INVALID',
            message: `quantity 必须是大于 0 的数字（最多3位小数）: ${quantityText}`,
          });
        }
      }

      if (skuCode !== '' && warehouseCode !== '' && binCode !== '') {
        const dimensionKey = `${skuCode}|${warehouseCode}|${binCode}`;
        if (dimensionKeys.has(dimensionKey)) {
          errors.push({
            row: rowNumber,
            field: 'sku_code',
            code: 'INITIAL_INVENTORY_ROW_DUPLICATE',
            message: `文件内重复的库存维度: ${skuCode} / ${warehouseCode} / ${binCode}`,
          });
        } else {
          dimensionKeys.add(dimensionKey);
          const sku = await this.skuService.getEntityByCode(skuCode);
          if (sku === null) {
            errors.push({
              row: rowNumber,
              field: 'sku_code',
              code: 'SKU_NOT_FOUND',
              message: `SKU 不存在: ${skuCode}`,
            });
          }
          const warehouse = await this.warehouseService.getEntityByCode(warehouseCode);
          if (warehouse === null) {
            errors.push({
              row: rowNumber,
              field: 'warehouse_code',
              code: 'WAREHOUSE_NOT_FOUND',
              message: `仓库不存在: ${warehouseCode}`,
            });
          }
          if (warehouse !== null) {
            const bin = await this.binService.findByWarehouseAndCode(warehouse.id, binCode);
            if (bin === null) {
              errors.push({
                row: rowNumber,
                field: 'bin_code',
                code: 'WAREHOUSE_BIN_NOT_FOUND',
                message: `库位不存在或不属于仓库 ${warehouseCode}: ${binCode}`,
              });
            }
          }
        }
      }

      if (errors.length > rowErrorsBefore) {
        continue;
      }

      validRows.push({
        rowNumber,
        data: {
          skuCode,
          warehouseCode,
          binCode,
          quantity: quantityText,
          remark: optionalField(cells, 'remark'),
        },
      });
    }

    return { validRows, errors };
  }

  async importRow(
    raw: Record<string, unknown>,
    operator: OperatorContext,
    context: ImportRowContext,
  ): Promise<void> {
    const row = raw as unknown as InitialInventoryRowData;
    const sku = await this.skuService.getEntityByCode(row.skuCode);
    if (sku === null) {
      throw new Error(`SKU 不存在: ${row.skuCode}`);
    }
    const warehouse = await this.warehouseService.getEntityByCode(row.warehouseCode);
    if (warehouse === null) {
      throw new Error(`仓库不存在: ${row.warehouseCode}`);
    }
    const bin = await this.binService.findByWarehouseAndCode(warehouse.id, row.binCode);
    if (bin === null) {
      throw new Error(`库位不存在: ${row.binCode}`);
    }

    await this.inventoryService.initializeStock({
      skuId: sku.id,
      warehouseId: warehouse.id,
      binId: bin.id,
      condition: 'SELLABLE',
      quantity: row.quantity,
      referenceType: 'IMPORT',
      referenceId: context.jobId,
      remark: row.remark,
      idempotencyKey: `INITIAL_INVENTORY:${context.jobId}:${context.rowNumber}`,
      operator,
    });
  }
}
