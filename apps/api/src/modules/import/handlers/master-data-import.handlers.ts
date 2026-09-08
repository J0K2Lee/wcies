import { Injectable } from '@nestjs/common';
import { BarcodeService } from '../../product/services/barcode.service';
import { WarehouseService } from '../../warehouse/services/warehouse.service';
import { WarehouseBinService } from '../../warehouse/services/warehouse-bin.service';
import { SkuService } from '../../product/services/sku.service';
import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { booleanField, optionalField, requiredField } from '../services/excel-parser';
import { ImportHandler, ImportRowContext, ValidRow } from './import-handler';
import { BARCODE_TYPES, BarcodeType } from '../../product/constants/barcode.constants';

interface BarcodeRowData {
  skuCode: string;
  barcode: string;
  barcodeType: BarcodeType;
  isPrimary: boolean;
}

/**
 * BARCODE fixed template: sku_code | barcode | barcode_type | is_primary.
 * A barcode already bound anywhere is rejected (global uniqueness, §30).
 */
@Injectable()
export class BarcodeImportHandler implements ImportHandler {
  readonly type = 'BARCODE';

  constructor(
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
  ) {}

  async validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const validRows: ValidRow[] = [];
    const barcodesInFile = new Set<string>();

    for (const { rowNumber, cells } of rows) {
      const before = errors.length;
      const skuCode = requiredField(rowNumber, cells, 'sku_code', errors);
      const barcode = requiredField(rowNumber, cells, 'barcode', errors);
      const barcodeTypeRaw = optionalField(cells, 'barcode_type') ?? 'EAN';
      if (!(BARCODE_TYPES as readonly string[]).includes(barcodeTypeRaw)) {
        errors.push({
          row: rowNumber,
          field: 'barcode_type',
          code: 'SKU_BARCODE_TYPE_INVALID',
          message: `未知条码类型: ${barcodeTypeRaw}`,
        });
      }

      if (barcode !== '' && barcodesInFile.has(barcode)) {
        errors.push({
          row: rowNumber,
          field: 'barcode',
          code: 'SKU_BARCODE_ALREADY_EXISTS',
          message: `文件内重复的 barcode: ${barcode}`,
        });
      } else if (barcode !== '') {
        barcodesInFile.add(barcode);
        const existing = await this.barcodeService.findByBarcode(barcode);
        if (existing !== null) {
          errors.push({
            row: rowNumber,
            field: 'barcode',
            code: 'SKU_BARCODE_ALREADY_EXISTS',
            message: `条码已绑定其他 SKU: ${barcode}`,
          });
        }
      }

      const sku = skuCode === '' ? null : await this.skuService.getEntityByCode(skuCode);
      if (skuCode !== '' && sku === null) {
        errors.push({
          row: rowNumber,
          field: 'sku_code',
          code: 'SKU_NOT_FOUND',
          message: `SKU 不存在: ${skuCode}`,
        });
      }

      if (errors.length > before) {
        continue;
      }
      validRows.push({
        rowNumber,
        data: {
          skuCode,
          barcode,
          barcodeType: barcodeTypeRaw,
          isPrimary: booleanField(cells, 'is_primary'),
        },
      });
    }
    return { validRows, errors };
  }

  async importRow(
    raw: Record<string, unknown>,
    operator: OperatorContext,

    _context: ImportRowContext,
  ): Promise<void> {
    const row = raw as unknown as BarcodeRowData;
    const sku = await this.skuService.getEntityByCode(row.skuCode);
    if (sku === null) {
      throw new Error(`SKU not found: ${row.skuCode}`);
    }
    await this.barcodeService.create(
      sku.id,
      { barcode: row.barcode, barcodeType: row.barcodeType, isPrimary: row.isPrimary || undefined },
      operator,
    );
  }
}

interface WarehouseRowData {
  warehouseCode: string;
  name: string;
  warehouseType: string;
  countryCode: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

const WAREHOUSE_TYPES = ['SELF', 'PLATFORM', 'THIRD_PARTY', 'RETURN_TEMP'] as const;

/** WAREHOUSE fixed template (task §35 fields as columns). */
@Injectable()
export class WarehouseImportHandler implements ImportHandler {
  readonly type = 'WAREHOUSE';

  constructor(private readonly warehouseService: WarehouseService) {}

  async validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const validRows: ValidRow[] = [];
    const codesInFile = new Set<string>();

    for (const { rowNumber, cells } of rows) {
      const before = errors.length;
      const warehouseCode = requiredField(rowNumber, cells, 'warehouse_code', errors);
      const name = requiredField(rowNumber, cells, 'name', errors);
      const warehouseType = requiredField(rowNumber, cells, 'warehouse_type', errors);
      if (!(WAREHOUSE_TYPES as readonly string[]).includes(warehouseType)) {
        errors.push({
          row: rowNumber,
          field: 'warehouse_type',
          code: 'INVALID_VALUE',
          message: `warehouse_type 必须是 ${WAREHOUSE_TYPES.join('/')}`,
        });
      }
      if (warehouseCode !== '' && codesInFile.has(warehouseCode)) {
        errors.push({
          row: rowNumber,
          field: 'warehouse_code',
          code: 'WAREHOUSE_CODE_ALREADY_EXISTS',
          message: `文件内重复的 warehouse_code: ${warehouseCode}`,
        });
      } else if (warehouseCode !== '') {
        codesInFile.add(warehouseCode);
        const existing = await this.warehouseService.getEntityByCode(warehouseCode);
        if (existing !== null) {
          errors.push({
            row: rowNumber,
            field: 'warehouse_code',
            code: 'WAREHOUSE_CODE_ALREADY_EXISTS',
            message: `仓库编码已存在: ${warehouseCode}`,
          });
        }
      }
      if (errors.length > before) {
        continue;
      }
      validRows.push({
        rowNumber,
        data: {
          warehouseCode,
          name,
          warehouseType,
          countryCode: optionalField(cells, 'country_code'),
          province: optionalField(cells, 'province'),
          city: optionalField(cells, 'city'),
          address: optionalField(cells, 'address'),
          contactName: optionalField(cells, 'contact_name'),
          contactPhone: optionalField(cells, 'contact_phone'),
        },
      });
    }
    return { validRows, errors };
  }

  async importRow(
    raw: Record<string, unknown>,
    operator: OperatorContext,

    _context: ImportRowContext,
  ): Promise<void> {
    const row = raw as unknown as WarehouseRowData;
    await this.warehouseService.create(
      {
        warehouseCode: row.warehouseCode,
        name: row.name,
        warehouseType: row.warehouseType as (typeof WAREHOUSE_TYPES)[number],
        countryCode: row.countryCode ?? undefined,
        province: row.province ?? undefined,
        city: row.city ?? undefined,
        address: row.address ?? undefined,
        contactName: row.contactName ?? undefined,
        contactPhone: row.contactPhone ?? undefined,
      },
      operator,
    );
  }
}

// Late import avoids a circular import at module-eval time.

interface BinRowData {
  warehouseCode: string;
  binCode: string;
  zone: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
}

/**
 * BIN fixed template: warehouse_code | bin_code | zone | rack | level | position.
 * Duplicate bin_code within the same warehouse is rejected (§76).
 */
@Injectable()
export class BinImportHandler implements ImportHandler {
  readonly type = 'BIN';

  constructor(
    private readonly warehouseService: WarehouseService,
    private readonly binService: WarehouseBinService,
  ) {}

  async validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const validRows: ValidRow[] = [];
    const combosInFile = new Set<string>();

    for (const { rowNumber, cells } of rows) {
      const before = errors.length;
      const warehouseCode = requiredField(rowNumber, cells, 'warehouse_code', errors);
      const binCode = requiredField(rowNumber, cells, 'bin_code', errors);

      let warehouseId: string | null = null;
      if (warehouseCode !== '') {
        const warehouse = await this.warehouseService.getEntityByCode(warehouseCode);
        if (warehouse === null) {
          errors.push({
            row: rowNumber,
            field: 'warehouse_code',
            code: 'WAREHOUSE_NOT_FOUND',
            message: `仓库不存在: ${warehouseCode}`,
          });
        } else {
          warehouseId = warehouse.id;
          if (binCode !== '') {
            const combo = `${warehouse.id}:${binCode}`;
            if (combosInFile.has(combo)) {
              errors.push({
                row: rowNumber,
                field: 'bin_code',
                code: 'WAREHOUSE_BIN_ALREADY_EXISTS',
                message: `文件内重复的库位: ${binCode}`,
              });
            } else {
              combosInFile.add(combo);
              const bin = await this.binService.findByWarehouseAndCode(warehouse.id, binCode);
              if (bin !== null) {
                errors.push({
                  row: rowNumber,
                  field: 'bin_code',
                  code: 'WAREHOUSE_BIN_ALREADY_EXISTS',
                  message: `库位已存在: ${binCode}`,
                });
              }
            }
          }
        }
      }

      if (errors.length > before || warehouseId === null) {
        continue;
      }
      validRows.push({
        rowNumber,
        data: {
          warehouseCode,
          binCode,
          zone: optionalField(cells, 'zone'),
          rack: optionalField(cells, 'rack'),
          level: optionalField(cells, 'level'),
          position: optionalField(cells, 'position'),
        },
      });
    }
    return { validRows, errors };
  }

  async importRow(
    raw: Record<string, unknown>,
    operator: OperatorContext,

    _context: ImportRowContext,
  ): Promise<void> {
    const row = raw as unknown as BinRowData;
    const warehouse = await this.warehouseService.getEntityByCode(row.warehouseCode);
    if (warehouse === null) {
      throw new Error(`Warehouse not found: ${row.warehouseCode}`);
    }
    await this.binService.create(
      warehouse.id,
      {
        binCode: row.binCode,
        zone: row.zone ?? undefined,
        rack: row.rack ?? undefined,
        level: row.level ?? undefined,
        position: row.position ?? undefined,
      },
      operator,
    );
  }
}
