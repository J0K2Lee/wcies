import { describe, expect, it } from 'vitest';
import * as ExcelJS from 'exceljs';
import { parseFixedTemplateSheet } from './excel-parser';

async function buildSheet(rows: Array<Array<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  for (const row of rows) {
    worksheet.addRow(row);
  }
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

describe('parseFixedTemplateSheet (fixed templates, task §57)', () => {
  it('maps columns by header name and keeps Excel row numbers', async () => {
    const buffer = await buildSheet([
      ['sku_code', 'name_zh', 'weight_kg'],
      ['SKU001', '键盘', 0.5],
      ['', '鼠标', 0.3],
    ]);
    const sheet = await parseFixedTemplateSheet(buffer);
    expect(sheet.headers).toEqual(['sku_code', 'name_zh', 'weight_kg']);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toEqual({
      rowNumber: 2,
      cells: { sku_code: 'SKU001', name_zh: '键盘', weight_kg: '0.5' },
    });
    expect(sheet.rows[1]?.rowNumber).toBe(3);
  });

  it('skips fully-empty rows', async () => {
    const buffer = await buildSheet([
      ['a', 'b'],
      ['x', 'y'],
      ['', ''],
      ['z', ''],
    ]);
    const sheet = await parseFixedTemplateSheet(buffer);
    expect(sheet.rows).toHaveLength(2);
  });

  it('produces empty rows for a sheet with only headers', async () => {
    const buffer = await buildSheet([['a', 'b']]);
    const sheet = await parseFixedTemplateSheet(buffer);
    expect(sheet.rows).toHaveLength(0);
  });
});
