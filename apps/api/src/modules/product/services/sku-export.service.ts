import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import {
  InventoryQueryService,
  SkuStockSummary,
} from '../../inventory/services/inventory-query.service';
import {
  SkuExportCellFormat,
  SkuExportColumnDefinition,
  SKU_EXPORT_COLUMN_BY_KEY,
  hasListingColumns,
} from '../constants/sku-export-columns';
import { InvalidSkuExportColumnError } from '../errors/sku-export-errors';
import { SkuExportRow, SkuRepository } from '../repositories/sku.repository';

/** 导出任务参数（BullMQ job data）。 */
export interface SkuExportJobData {
  readonly columns: string[];
  readonly skuIds?: string[];
  readonly filters?: {
    readonly keyword?: string;
    readonly brandId?: string;
    readonly categoryId?: string;
    readonly status?: string;
    readonly hasListing?: boolean;
    readonly platformId?: string;
    readonly storeId?: string;
    readonly serialTracking?: boolean;
  };
  readonly sortBy: 'createdAt' | 'updatedAt' | 'skuCode' | 'nameZh';
  readonly sortOrder: 'asc' | 'desc';
  /** 浏览器时区偏移（分钟）：Excel 时间列按它换算。 */
  readonly tzOffsetMinutes: number;
}

export interface SkuExportResult {
  objectKey: string;
  rowCount: number;
  fileName: string;
}

/** 每批处理的 SKU 数：一批 = 一条明细查询 + 一条库存汇总查询。 */
const BATCH_SIZE = 500;

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 各列格式对应的 Excel 数字格式。 */
const NUMBER_FORMATS: Record<
  Exclude<SkuExportCellFormat, 'text' | 'boolean' | 'datetime'>,
  string
> = {
  int: '0',
  numeric3: '#,##0.000',
  money: '#,##0.0000',
};

/**
 * SKU 自定义列导出（2026-11-04）。
 *
 * 用户口径：**一行一个平台映射**（同一 SKU 多行，SKU 列重复）；只勾 SKU 列时
 * 每个 SKU 一行。全量导出，不设行数上限 —— 因此：
 * - 流式写入（exceljs WorkbookWriter + 临时文件）：行处理的内存恒定；
 *   上传前仍会整文件读一次（导出文件是几 MB 量级，换来的是不需要改存储层接口）；
 * - SKU 先取 id 列表，再按 500 一批取明细，单条查询有界；
 * - 库存数字**只经 InventoryQueryService**（AGENTS.md §10），不直接查余额表。
 */
@Injectable()
export class SkuExportService {
  constructor(
    private readonly skuRepository: SkuRepository,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async buildExport(
    data: SkuExportJobData,
    onProgress?: (percent: number) => Promise<void>,
  ): Promise<SkuExportResult> {
    const unknown = data.columns.filter((key) => !SKU_EXPORT_COLUMN_BY_KEY.has(key));
    if (unknown.length > 0) {
      throw new InvalidSkuExportColumnError(unknown);
    }
    if (data.columns.length === 0) {
      throw new InvalidSkuExportColumnError(['(未选择任何列)']);
    }

    // 已按白名单校验过，这里再取一次定义并保持请求顺序。
    const columns = data.columns.map(
      (key) => SKU_EXPORT_COLUMN_BY_KEY.get(key) as SkuExportColumnDefinition,
    );
    const expandListings = hasListingColumns(data.columns);
    const needsStock = columns.some((column) => column.group === 'STOCK');

    const skuIds =
      data.skuIds !== undefined && data.skuIds.length > 0
        ? [...new Set(data.skuIds)]
        : await this.skuRepository.listIdsForExport({
            keyword: data.filters?.keyword,
            brandId: data.filters?.brandId,
            categoryId: data.filters?.categoryId,
            status: data.filters?.status,
            serialTracking: data.filters?.serialTracking,
            hasListing: data.filters?.hasListing,
            platformId: data.filters?.platformId,
            storeId: data.filters?.storeId,
            sortBy: data.sortBy,
            sortOrder: data.sortOrder,
          });

    const fileName = buildFileName(data.tzOffsetMinutes);
    const workDir = await mkdtemp(join(tmpdir(), 'wcies-sku-export-'));
    const filePath = join(workDir, fileName);
    let rowCount = 0;

    try {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        filename: filePath,
        useStyles: true,
      });
      // 冻结首行必须在创建时传入：流式 writer 在构造时就写好了 <sheetViews>，
      // 之后 push/赋值 views 都不会出现在文件里（2026-11-04 实测）。
      const sheet = workbook.addWorksheet('SKU', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });
      sheet.columns = columns.map((column) => ({ key: column.key, width: column.width }));
      const headerRow = sheet.addRow(columns.map((column) => column.label));
      headerRow.font = { bold: true };
      headerRow.commit();
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

      for (let index = 0; index < skuIds.length; index += BATCH_SIZE) {
        const batchIds = skuIds.slice(index, index + BATCH_SIZE);
        const [rows, stock] = await Promise.all([
          this.skuRepository.listExportRowsBySkuIds(batchIds),
          needsStock
            ? this.inventoryQuery.listSkuStockSummaries(batchIds)
            : Promise.resolve(new Map<string, SkuStockSummary>()),
        ]);

        for (const row of pickRows(rows, batchIds, expandListings)) {
          const excelRow = sheet.addRow(
            columns.map((column) => column.read({ row, stock: stock.get(row.skuId) ?? null })),
          );
          columns.forEach((column, columnIndex) => {
            applyFormat(excelRow.getCell(columnIndex + 1), column.format, data.tzOffsetMinutes);
          });
          excelRow.commit();
          rowCount += 1;
        }

        if (onProgress !== undefined) {
          await onProgress(
            Math.min(
              100,
              Math.round(((index + batchIds.length) / Math.max(1, skuIds.length)) * 100),
            ),
          );
        }
      }

      await workbook.commit();
      const bytes = await readFile(filePath);
      const objectKey = `exports/sku/${randomUUID()}.xlsx`;
      await this.objectStorage.upload({ key: objectKey, body: bytes, contentType: MIME_XLSX });
      return { objectKey, rowCount, fileName };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * 按 SKU 的入参顺序展开行：
 * - 含平台映射列 → 该 SKU 的每一行（映射）都输出；
 * - 不含映射列 → 每个 SKU 只输出第一行（避免同一 SKU 重复 N 次）；
 * - 查不到的 SKU 不输出（导出期间被删除）。
 */
function pickRows(
  rows: readonly SkuExportRow[],
  orderedSkuIds: readonly string[],
  expandListings: boolean,
): SkuExportRow[] {
  const grouped = new Map<string, SkuExportRow[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.skuId);
    if (bucket === undefined) {
      grouped.set(row.skuId, [row]);
    } else {
      bucket.push(row);
    }
  }
  const picked: SkuExportRow[] = [];
  for (const skuId of orderedSkuIds) {
    const bucket = grouped.get(skuId);
    if (bucket === undefined) {
      continue;
    }
    if (expandListings) {
      picked.push(...bucket);
    } else {
      const first = bucket[0];
      if (first !== undefined) {
        picked.push(first);
      }
    }
  }
  return picked;
}

function applyFormat(
  cell: ExcelJS.Cell,
  format: SkuExportCellFormat,
  tzOffsetMinutes: number,
): void {
  const value = cell.value;
  if (value === null || value === undefined || value === '') {
    // 空值就留空单元格：不加数字格式，避免产生只有样式的空单元格。
    cell.value = '';
    return;
  }
  if (format === 'text') {
    // 强制文本：条码/编码/平台 id 不能被 Excel 变成科学计数法。
    cell.numFmt = '@';
    cell.value = toCellText(value);
    return;
  }
  if (format === 'datetime') {
    if (value instanceof Date) {
      // ExcelJS 按 UTC 存日期序号：把时间平移用户时区偏移后再写入，
      // 打开 Excel 看到的就是用户本地时间（后端不知道用户时区）。
      cell.value = new Date(value.getTime() + tzOffsetMinutes * 60_000);
      cell.numFmt = 'yyyy-mm-dd hh:mm';
    }
    return;
  }
  if (format === 'boolean') {
    return;
  }
  cell.numFmt = NUMBER_FORMATS[format];
}

/** 单元格取值 → 文本（各列 read 只会给出字符串/数字/布尔/日期）。 */
function toCellText(value: ExcelJS.CellValue): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return '';
}

function buildFileName(tzOffsetMinutes: number): string {
  const shifted = new Date(Date.now() + tzOffsetMinutes * 60_000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp = `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(
    shifted.getUTCDate(),
  )}_${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}`;
  return `SKU导出_${stamp}.xlsx`;
}
