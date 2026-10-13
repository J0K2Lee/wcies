import { Injectable } from '@nestjs/common';
import { BarcodeService } from '../../product/services/barcode.service';
import { SkuService } from '../../product/services/sku.service';
import { assertDimensionsConsistent } from '../../product/services/sku.service';
import { CatalogService } from '../../catalog/catalog.service';
import { ImportRowError } from '../entities/import-job.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { booleanField, numericField, optionalField, requiredField } from '../services/excel-parser';
import { ImportHandler, ImportRowContext, ValidRow } from './import-handler';
import { BARCODE_TYPES, BarcodeType } from '../../product/constants/barcode.constants';

interface SkuRowData {
  skuCode: string | null;
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
  /** Resolved in validate() from the exact-name columns (null = not provided). */
  brandId: string | null;
  categoryId: string | null;
}

/**
 * SKU fixed template (spec §87; units 2026-09-09: g / integer mm):
 * sku_code | name_zh | name_ru | model |
 * color | size | weight_g | length_mm | width_mm | height_mm |
 * latest_purchase_price | barcode | barcode_type | serial_tracking |
 * brand | category
 *
 * - sku_code empty -> auto-generated (global SKU%09d sequence, V1 decision D2);
 * - every row creates the SKU directly - the product layer is gone (V1);
 * - brand / category are OPTIONAL and matched by EXACT name (brand: the
 *   general name; category: name_zh). A miss is a row error
 *   (BRAND_NOT_FOUND / CATEGORY_NOT_FOUND) - never an auto-create; the
 *   category must be a level-3 node (decision 0005);
 * - duplicate sku_code / barcode -> rejected with the exact row (task §61).
 * - length_mm / width_mm / height_mm must be integers.
 */
@Injectable()
export class SkuImportHandler implements ImportHandler {
  readonly type = 'SKU';

  constructor(
    private readonly skuService: SkuService,
    private readonly barcodeService: BarcodeService,
    private readonly catalogService: CatalogService,
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

      // Optional brand / category by EXACT name (V1 T6): a miss is a row
      // error - never an auto-create; the category must be level 3.
      let brandId: string | null = null;
      let categoryId: string | null = null;
      const brandName = optionalField(cells, 'brand');
      if (brandName !== null) {
        const brand = await this.catalogService.findBrandByName(brandName);
        if (brand === null) {
          errors.push({
            row: rowNumber,
            field: 'brand',
            code: 'BRAND_NOT_FOUND',
            message: `品牌不存在: ${brandName}`,
          });
        } else {
          brandId = brand.id;
        }
      }
      const categoryName = optionalField(cells, 'category');
      if (categoryName !== null) {
        const category = await this.catalogService.findCategoryByNameZh(categoryName);
        if (category === null) {
          errors.push({
            row: rowNumber,
            field: 'category',
            code: 'CATEGORY_NOT_FOUND',
            message: `分类不存在: ${categoryName}`,
          });
        } else if (category.level !== 3) {
          errors.push({
            row: rowNumber,
            field: 'category',
            code: 'CATEGORY_LEVEL_INVALID',
            message: `SKU 分类必须挂三级类目: ${categoryName}`,
          });
        } else {
          categoryId = category.id;
        }
      }

      if (errors.length > rowErrorsBefore) {
        continue;
      }

      const data: SkuRowData = {
        skuCode,
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
        brandId,
        categoryId,
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

    assertDimensionsConsistent(row.lengthMm, row.widthMm, row.heightMm);
    const sku = await this.skuService.create(
      {
        skuCode: row.skuCode ?? undefined,
        nameZh: row.nameZh,
        nameRu: row.nameRu ?? undefined,
        brandId: row.brandId ?? undefined,
        categoryId: row.categoryId ?? undefined,
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
