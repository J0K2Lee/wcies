import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { ImportTemplateService } from './import-template.service';

/** Cell value -> plain text (rich text / formula aware), safe for headers. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const rich = value as { richText?: Array<{ text: string }> };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((part) => part.text).join('');
    }
    const formula = value as { result?: unknown };
    if (formula.result !== undefined && formula.result !== null) {
      return cellText(formula.result as ExcelJS.CellValue);
    }
    return '';
  }
  return String(value);
}

/** Sprint 8 T2.4: downloadable templates match the parser's fixed columns. */
describe('ImportTemplateService', () => {
  const service = new ImportTemplateService();

  it('builds an SKU template with the parser-recognized headers + example row', async () => {
    const { buffer } = await service.buildTemplate('SKU');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    const headers: string[] = [];
    sheet?.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      headers.push(cellText(cell.value));
    });
    expect(headers).toEqual([
      'sku_code',
      'product_code',
      'product_name_zh',
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
    ]);
    expect(sheet?.rowCount).toBe(2); // header + one example row
  });

  it('builds a LISTING_MAPPING template column-identical to the import contract', async () => {
    const { buffer } = await service.buildTemplate('LISTING_MAPPING');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet).toBeDefined();
    const headers: string[] = [];
    sheet?.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      headers.push(cellText(cell.value));
    });
    expect(headers).toEqual([
      'platform',
      'store_code',
      'platform_product_id',
      'platform_sku_id',
      'seller_sku',
      'offer_id',
      'internal_sku_code',
      'title',
      'url',
    ]);
  });

  it('rejects unknown template types with a domain error', async () => {
    await expect(service.buildTemplate('NOPE')).rejects.toMatchObject({
      code: 'IMPORT_TEMPLATE_INVALID',
    });
  });
});
