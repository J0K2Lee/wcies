import { Injectable } from '@nestjs/common';
import { BarcodeService } from '../../product/services/barcode.service';
import { ProductService } from '../../product/services/product.service';
import { SkuService } from '../../product/services/sku.service';
import { assertDimensionsConsistent } from '../../product/services/sku.service';
import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { booleanField, numericField, optionalField, requiredField } from '../services/excel-parser';
import { ImportHandler, ImportRowContext, ValidRow } from './import-handler';
import { BARCODE_TYPES, BarcodeType } from '../../product/constants/barcode.constants';

interface SkuRowData {
  skuCode: string | null;
  productCode: string | null;
  productNameZh: string | null;
  nameZh: string;
  nameRu: string | null;
  model: string | null;
  color: string | null;
  size: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  latestPurchasePrice: number | null;
  barcode: string | null;
  barcodeType: string | null;
  serialTracking: boolean;
}

/**
 * SKU fixed template (spec §87; units 2026-09-09: g / integer mm):
 * sku_code | product_code | product_name_zh | name_zh | name_ru | model |
 * color | size | weight_g | length_mm | width_mm | height_mm |
 * latest_purchase_price | barcode | barcode_type | serial_tracking
 *
 * - sku_code empty -> auto-generated;
 * - product_code references an existing product, or creates one when
 *   product_name_zh is provided (task §58 lets SKU+product create together);
 * - duplicate sku_code / barcode -> rejected with the exact row (task §61).
 * - length_mm / width_mm / height_mm must be integers.
 */
@Injectable()
export class SkuImportHandler implements ImportHandler {
  readonly type = 'SKU';

  constructor(
    private readonly productService: ProductService,
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
  ) {}

  async validate(
    rows: Array<{ rowNumber: number; cells: Record<string, string> }>,
  ): Promise<{ validRows: ValidRow[]; errors: ImportRowError[] }> {
    const errors: ImportRowError[] = [];
    const validRows: ValidRow[] = [];
    const skuCodesInFile = new Set<string>();
    const barcodesInFile = new Set<string>();

    for (const { rowNumber, cells } of rows) {
      const rowErrorsBefore = errors.length;

      const nameZh = requiredField(rowNumber, cells, 'name_zh', errors);
      const productCode = optionalField(cells, 'product_code');
      const productNameZh = optionalField(cells, 'product_name_zh');
      if (productCode === null && productNameZh === null) {
        errors.push({
          row: rowNumber,
          field: 'product_code',
          code: 'REQUIRED_FIELD_MISSING',
          message: 'product_code 不存在时必须提供 product_name_zh 以便创建商品',
        });
      }

      const skuCode = optionalField(cells, 'sku_code');
      if (skuCode !== null) {
        if (skuCodesInFile.has(skuCode)) {
          errors.push({
            row: rowNumber,
            field: 'sku_code',
            code: 'SKU_CODE_ALREADY_EXISTS',
            message: `文件内重复的 sku_code: ${skuCode}`,
          });
        } else {
          skuCodesInFile.add(skuCode);
          const existing = await this.skuService.getEntityByCode(skuCode);
          if (existing !== null) {
            errors.push({
              row: rowNumber,
              field: 'sku_code',
              code: 'SKU_CODE_ALREADY_EXISTS',
              message: `sku_code 已存在: ${skuCode}`,
            });
          }
        }
      }

      const weightG = numericField(rowNumber, cells, 'weight_g', errors);
      const lengthMm = numericField(rowNumber, cells, 'length_mm', errors);
      const widthMm = numericField(rowNumber, cells, 'width_mm', errors);
      const heightMm = numericField(rowNumber, cells, 'height_mm', errors);
      const latestPurchasePrice = numericField(rowNumber, cells, 'latest_purchase_price', errors);

      for (const [field, value] of [
        ['length_mm', lengthMm],
        ['width_mm', widthMm],
        ['height_mm', heightMm],
      ] as const) {
        if (value !== null && !Number.isInteger(value)) {
          errors.push({
            row: rowNumber,
            field,
            code: 'SKU_DIMENSIONS_INVALID',
            message: `${field} 必须为整数毫米`,
          });
        }
      }

      if (
        [lengthMm, widthMm, heightMm].filter((value) => value !== null).length !== 0 &&
        [lengthMm, widthMm, heightMm].filter((value) => value !== null).length !== 3
      ) {
        errors.push({
          row: rowNumber,
          field: 'length_mm',
          code: 'SKU_DIMENSIONS_INVALID',
          message: 'length_mm/width_mm/height_mm 必须同时提供',
        });
      }

      const barcodeType = optionalField(cells, 'barcode_type');
      if (barcodeType !== null && !(BARCODE_TYPES as readonly string[]).includes(barcodeType)) {
        errors.push({
          row: rowNumber,
          field: 'barcode_type',
          code: 'SKU_BARCODE_TYPE_INVALID',
          message: `未知条码类型: ${barcodeType}`,
        });
      }

      const barcode = optionalField(cells, 'barcode');
      if (barcode !== null) {
        if (barcodesInFile.has(barcode)) {
          errors.push({
            row: rowNumber,
            field: 'barcode',
            code: 'SKU_BARCODE_ALREADY_EXISTS',
            message: `文件内重复的 barcode: ${barcode}`,
          });
        } else {
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
      }

      // Resolve product reference (existing or to-be-created).
      if (productCode !== null) {
        const product = await this.productService.getEntityByCode(productCode);
        if (product === null && productNameZh === null) {
          errors.push({
            row: rowNumber,
            field: 'product_code',
            code: 'PRODUCT_NOT_FOUND',
            message: `商品不存在: ${productCode}`,
          });
        }
      }

      if (errors.length > rowErrorsBefore) {
        continue;
      }

      const data: SkuRowData = {
        skuCode,
        productCode,
        productNameZh,
        nameZh,
        nameRu: optionalField(cells, 'name_ru'),
        model: optionalField(cells, 'model'),
        color: optionalField(cells, 'color'),
        size: optionalField(cells, 'size'),
        weightG,
        lengthMm,
        widthMm,
        heightMm,
        latestPurchasePrice,
        barcode,
        barcodeType,
        serialTracking: booleanField(cells, 'serial_tracking'),
      };
      validRows.push({ rowNumber, data: data as unknown as Record<string, unknown> });
    }

    return { validRows, errors };
  }

  async importRow(
    raw: Record<string, unknown>,
    operator: OperatorContext,

    _context: ImportRowContext,
  ): Promise<void> {
    const row = raw as unknown as SkuRowData;

    // Existing product or create one with the provided name (task §58).
    let productId: string;
    if (row.productCode !== null) {
      const product = await this.productService.getEntityByCode(row.productCode);
      if (product !== null) {
        productId = product.id;
      } else {
        const created = await this.productService.createForImport(
          { nameZh: row.productNameZh ?? row.nameZh },
          operator,
        );
        productId = created.id;
      }
    } else {
      const created = await this.productService.createForImport(
        { nameZh: row.productNameZh ?? row.nameZh },
        operator,
      );
      productId = created.id;
    }

    assertDimensionsConsistent(row.lengthMm, row.widthMm, row.heightMm);
    const sku = await this.skuService.create(
      {
        productId,
        skuCode: row.skuCode ?? undefined,
        nameZh: row.nameZh,
        nameRu: row.nameRu ?? undefined,
        model: row.model ?? undefined,
        color: row.color ?? undefined,
        size: row.size ?? undefined,
        weightG: row.weightG ?? undefined,
        lengthMm: row.lengthMm ?? undefined,
        widthMm: row.widthMm ?? undefined,
        heightMm: row.heightMm ?? undefined,
        latestPurchasePrice: row.latestPurchasePrice ?? undefined,
        serialTracking: row.serialTracking,
      },
      operator,
    );

    if (row.barcode !== null) {
      await this.barcodeService.create(
        sku.id,
        { barcode: row.barcode, barcodeType: (row.barcodeType ?? 'EAN') as BarcodeType },
        operator,
      );
    }
  }
}
