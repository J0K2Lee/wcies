import { Injectable } from '@nestjs/common';
import { BarcodeService } from '../../product/services/barcode.service';
import { ProductService } from '../../product/services/product.service';
import { SkuService } from '../../product/services/sku.service';
import { assertDimensionsConsistent, computeVolumeCm3 } from '../../product/services/sku.service';
import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { booleanField, numericField, optionalField, requiredField } from '../services/excel-parser';
import { ImportHandler, ValidRow } from './import-handler';
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
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  latestPurchasePrice: number | null;
  barcode: string | null;
  barcodeType: string | null;
  serialTracking: boolean;
}

/**
 * SKU fixed template (spec §87):
 * sku_code | product_code | product_name_zh | name_zh | name_ru | model |
 * color | size | weight_kg | length_cm | width_cm | height_cm |
 * latest_purchase_price | barcode | barcode_type | serial_tracking
 *
 * - sku_code empty -> auto-generated;
 * - product_code references an existing product, or creates one when
 *   product_name_zh is provided (task §58 lets SKU+product create together);
 * - duplicate sku_code / barcode -> rejected with the exact row (task §61).
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

      const weightKg = numericField(rowNumber, cells, 'weight_kg', errors);
      const lengthCm = numericField(rowNumber, cells, 'length_cm', errors);
      const widthCm = numericField(rowNumber, cells, 'width_cm', errors);
      const heightCm = numericField(rowNumber, cells, 'height_cm', errors);
      const latestPurchasePrice = numericField(rowNumber, cells, 'latest_purchase_price', errors);

      if (
        [lengthCm, widthCm, heightCm].filter((value) => value !== null).length !== 0 &&
        [lengthCm, widthCm, heightCm].filter((value) => value !== null).length !== 3
      ) {
        errors.push({
          row: rowNumber,
          field: 'length_cm',
          code: 'SKU_DIMENSIONS_INVALID',
          message: 'length_cm/width_cm/height_cm 必须同时提供',
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
        weightKg,
        lengthCm,
        widthCm,
        heightCm,
        latestPurchasePrice,
        barcode,
        barcodeType,
        serialTracking: booleanField(cells, 'serial_tracking'),
      };
      validRows.push({ rowNumber, data: data as unknown as Record<string, unknown> });
    }

    return { validRows, errors };
  }

  async importRow(raw: Record<string, unknown>, operator: OperatorContext): Promise<void> {
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

    assertDimensionsConsistent(row.lengthCm, row.widthCm, row.heightCm);
    const volumeCm3 = computeVolumeCm3(row.lengthCm, row.widthCm, row.heightCm);
    const sku = await this.skuService.create(
      {
        productId,
        skuCode: row.skuCode ?? undefined,
        nameZh: row.nameZh,
        nameRu: row.nameRu ?? undefined,
        model: row.model ?? undefined,
        color: row.color ?? undefined,
        size: row.size ?? undefined,
        weightKg: row.weightKg ?? undefined,
        lengthCm: row.lengthCm ?? undefined,
        widthCm: row.widthCm ?? undefined,
        heightCm: row.heightCm ?? undefined,
        latestPurchasePrice: row.latestPurchasePrice ?? undefined,
        serialTracking: row.serialTracking,
      },
      operator,
    );
    void volumeCm3; // volume is recomputed inside SkuService.create

    if (row.barcode !== null) {
      await this.barcodeService.create(
        sku.id,
        { barcode: row.barcode, barcodeType: (row.barcodeType ?? 'EAN') as BarcodeType },
        operator,
      );
    }
  }
}
