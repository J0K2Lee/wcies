import * as ExcelJS from 'exceljs';
import { ImportRowError } from '../entities/import-job.entity';

/**
 * Fixed-template Excel parsing (task §57): first worksheet, header row 1,
 * columns matched by header name (trimmed). No drag-and-drop field mapping.
 */
export interface ParsedSheet {
  /** 1-based Excel row number -> column name -> cell string value. */
  rows: Array<{ rowNumber: number; cells: Record<string, string> }>;
  headers: string[];
}

export async function parseFixedTemplateSheet(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const worksheet = workbook.worksheets[0];
  if (worksheet === undefined) {
    throw new SheetInvalidError('工作簿中没有工作表');
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers.push(cellText(cell.value));
    void colNumber;
  });

  const rows: ParsedSheet['rows'] = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const cells: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header === undefined) {
        return;
      }
      const value = cellText(cell.value);
      if (value !== '') {
        hasValue = true;
      }
      cells[header] = value;
    });
    if (hasValue) {
      rows.push({ rowNumber, cells });
    }
  });

  return { rows, headers };
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    const rich = value as { richText?: Array<{ text: string }> };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((part) => part.text).join('');
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const hyperlink = value as { hyperlink?: string; text?: string };
    if (hyperlink.hyperlink !== undefined) {
      const text = hyperlink.text;
      return typeof text === 'string' ? text : hyperlink.hyperlink;
    }
    const formula = value as { result?: unknown };
    if (formula.result !== undefined && formula.result !== null) {
      return cellText(formula.result as ExcelJS.CellValue);
    }
    // Unhandled object shapes (errors etc.) carry no usable text.
    return '';
  }
  return String(value).trim();
}

export class SheetInvalidError extends Error {
  readonly code = 'IMPORT_FILE_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'SheetInvalidError';
  }
}

/** Common helpers shared by all import handlers. */
export function requiredField(
  rowNumber: number,
  cells: Record<string, string>,
  field: string,
  errors: ImportRowError[],
): string {
  const value = cells[field] ?? '';
  if (value === '') {
    errors.push({
      row: rowNumber,
      field,
      code: 'REQUIRED_FIELD_MISSING',
      message: `缺少必填字段 ${field}`,
    });
  }
  return value;
}

export function optionalField(cells: Record<string, string>, field: string): string | null {
  const value = cells[field] ?? '';
  return value === '' ? null : value;
}

export function numericField(
  rowNumber: number,
  cells: Record<string, string>,
  field: string,
  errors: ImportRowError[],
): number | null {
  const value = cells[field] ?? '';
  if (value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push({
      row: rowNumber,
      field,
      code: 'INVALID_NUMBER',
      message: `${field} 必须是非负数字`,
    });
    return null;
  }
  return parsed;
}

const TRUTHY = new Set(['true', '1', 'yes', 'y', '是', 'true ']);

export function booleanField(cells: Record<string, string>, field: string): boolean {
  const value = (cells[field] ?? '').trim().toLowerCase();
  return TRUTHY.has(value);
}
