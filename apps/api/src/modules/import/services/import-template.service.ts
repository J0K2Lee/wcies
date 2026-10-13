import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { DomainError } from '../../../common/errors/domain.error';

export class ImportTemplateInvalidError extends DomainError {
  readonly code = 'IMPORT_TEMPLATE_INVALID';
  readonly httpStatus = 422;
  constructor(type: string) {
    super(`未知导入模板类型: ${type}`, { type });
  }
}

interface TemplateDefinition {
  filename: string;
  headers: string[];
  example: Array<string | number | boolean>;
}

/**
 * Downloadable fixed-template Excel files (Sprint 8 T2.4).
 *
 * The templates are the single source of truth shared by the parser: header
 * row 1, columns matched by header name. An example row shows the expected
 * shape; the user deletes it before filling real data (the example values
 * would surface as exact row errors on upload, which is the desired guard
 * against accidentally importing them).
 */
const TEMPLATES: Record<string, TemplateDefinition> = {
  SKU: {
    filename: 'wcies-import-template-sku.xlsx',
    // V1 (2026-10-13): the product columns are gone - every row creates the
    // SKU directly (name_zh = the SKU name, required); brand/category are
    // optional and matched by EXACT name (a miss is a row error, never an
    // auto-create); the category must be a level-3 node (decision 0005).
    headers: [
      'sku_code',
      'name_zh',
      'name_ru',
      'model',
      'color',
      'size',
      'weight_g',
      'length_mm',
      'width_mm',
      'height_mm',
      'latest_purchase_price',
      'barcode',
      'barcode_type',
      'serial_tracking',
      'brand',
      'category',
    ],
    example: [
      '',
      '示例SKU 黑色',
      '',
      'VK87',
      '黑色',
      '',
      850,
      360,
      140,
      40,
      199,
      '',
      '',
      false,
      '示例品牌',
      '示例三级分类',
    ],
  },
  LISTING_MAPPING: {
    filename: 'wcies-import-template-listing-mapping.xlsx',
    headers: [
      'platform',
      'store_code',
      'platform_product_id',
      'platform_sku_id',
      'seller_sku',
      'offer_id',
      'internal_sku_code',
      'title',
      'url',
    ],
    example: [
      'OZON',
      'ON001',
      '152987456001',
      '152987456',
      '',
      '1234567890',
      'SKU000001',
      '示例标题（可留空）',
      '',
    ],
  },
};

const TEMPLATE_TYPES = Object.keys(TEMPLATES);

@Injectable()
export class ImportTemplateService {
  /** Builds the fixed-template workbook as an xlsx buffer. */
  async buildTemplate(type: string): Promise<{ buffer: Buffer; filename: string }> {
    const template = TEMPLATES[type];
    if (template === undefined) {
      throw new ImportTemplateInvalidError(type);
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('template');
    sheet.addRow([...template.headers]);
    sheet.addRow([...template.example]);
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: template.filename,
    };
  }
}

export { TEMPLATE_TYPES };
