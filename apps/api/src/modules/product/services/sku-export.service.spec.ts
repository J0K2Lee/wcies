import { describe, expect, it, vi } from 'vitest';
import * as ExcelJS from 'exceljs';
import { SkuExportService } from './sku-export.service';
import { InvalidSkuExportColumnError } from '../errors/sku-export-errors';
import { SkuExportRow } from '../repositories/sku.repository';
import { SkuStockSummary } from '../../inventory/services/inventory-query.service';

/**
 * SKU 自定义列导出（2026-11-04）。
 *
 * 这里校验的是**用户看得见的结果**：表头文案与顺序、一行一 listing 的展开、
 * 文本列不被 Excel 转成科学计数法、库存口径与"没有账面行≠0"、时间按用户时区。
 */

const BASE_ROW: SkuExportRow = {
  skuId: 'sku-1',
  skuCode: 'SKU000000001',
  nameZh: 'VK87 MAX V2 黑色',
  nameRu: null,
  model: 'VK87',
  color: '黑色',
  size: null,
  weightG: '850.500',
  lengthMm: 120,
  widthMm: 80,
  heightMm: 30,
  volumeMm3: '288000',
  latestPurchasePrice: '123.4500',
  movingAverageCost: null,
  costCurrency: 'CNY',
  purchaseUrl: 'https://detail.1688.com/offer/1.html',
  serialTracking: false,
  status: 'ACTIVE',
  remark: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-02T00:00:00.000Z'),
  brandName: 'VK',
  categoryName: '键盘 > 机械键盘',
  primaryBarcode: '6901234567890',
  platformCode: 'OZON',
  storeCode: 'ON-002',
  storeName: 'OZON 香港店',
  platformProductId: '111222333',
  listingTitle: '机械键盘 VK87',
  listingUrl: 'https://ozon.ru/product/111222333',
  listingStatus: 'ACTIVE',
  platformSkuId: '944000111',
  sellerSku: 'VK87-BLK',
  offerId: 'OFFER-VK87-BLK',
};

function build(rows: readonly SkuExportRow[], stock?: Map<string, SkuStockSummary>) {
  const uploaded: Array<{ key: string; body: Uint8Array | string; contentType?: string }> = [];
  const listIdsForExport = vi.fn(async () => [...new Set(rows.map((row) => row.skuId))]);
  const listExportRowsBySkuIds = vi.fn(async (ids: readonly string[]) =>
    rows.filter((row) => ids.includes(row.skuId)),
  );
  const listSkuStockSummaries = vi.fn(async () => stock ?? new Map<string, SkuStockSummary>());

  const service = new SkuExportService(
    { listIdsForExport, listExportRowsBySkuIds } as never,
    { listSkuStockSummaries } as never,
    {
      upload: async (params: { key: string; body: Uint8Array | string; contentType?: string }) => {
        uploaded.push(params);
        return { key: params.key, size: 0 };
      },
    } as never,
  );
  return { service, uploaded, listIdsForExport, listExportRowsBySkuIds, listSkuStockSummaries };
}

async function sheetOf(uploaded: Array<{ body: Uint8Array | string }>): Promise<ExcelJS.Worksheet> {
  const upload = uploaded[0];
  if (upload === undefined) {
    throw new Error('nothing uploaded');
  }
  const workbook = new ExcelJS.Workbook();
  // 与本仓其他 xlsx 读取点一致：exceljs 的 Buffer 类型与 @types/node 不同名同构。
  await workbook.xlsx.load(Buffer.from(upload.body) as unknown as ArrayBuffer);
  const sheet = workbook.getWorksheet('SKU');
  if (sheet === undefined) {
    throw new Error('sheet missing');
  }
  return sheet;
}

const TWO_LISTING_ROWS: SkuExportRow[] = [
  { ...BASE_ROW, platformCode: 'OZON', storeCode: 'ON-002', platformSkuId: '944000111' },
  { ...BASE_ROW, platformCode: 'WB', storeCode: 'WS-001', platformSkuId: '778899' },
];

describe('SkuExportService.buildExport', () => {
  it('表头按请求列顺序输出中文文案', async () => {
    const { service, uploaded } = build([BASE_ROW]);
    await service.buildExport({
      columns: ['skuCode', 'nameZh', 'latestPurchasePrice'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 480,
    });
    const sheet = await sheetOf(uploaded);
    expect(sheet.getRow(1).values).toEqual([undefined, 'SKU编码', '中文名称', '最近采购价']);
  });

  it('含平台映射列 → 一行一 listing（同一 SKU 的 SKU 列重复）', async () => {
    const { service, uploaded } = build(TWO_LISTING_ROWS);
    const result = await service.buildExport({
      columns: ['skuCode', 'platform', 'platformSkuId'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    const sheet = await sheetOf(uploaded);
    expect(result.rowCount).toBe(2);
    expect(sheet.getRow(2).values).toEqual([undefined, 'SKU000000001', 'OZON', '944000111']);
    expect(sheet.getRow(3).values).toEqual([undefined, 'SKU000000001', 'WB', '778899']);
  });

  it('不含平台映射列 → 每个 SKU 只出一行（不重复）', async () => {
    const { service, uploaded } = build(TWO_LISTING_ROWS);
    const result = await service.buildExport({
      columns: ['skuCode', 'nameZh'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    const sheet = await sheetOf(uploaded);
    expect(result.rowCount).toBe(1);
    expect(sheet.rowCount).toBe(2);
  });

  it('无映射的 SKU 仍出一行，listing 列留空', async () => {
    const noListing: SkuExportRow = {
      ...BASE_ROW,
      platformCode: null,
      storeCode: null,
      storeName: null,
      platformProductId: null,
      listingTitle: null,
      listingUrl: null,
      listingStatus: null,
      platformSkuId: null,
      sellerSku: null,
      offerId: null,
    };
    const { service, uploaded } = build([noListing]);
    await service.buildExport({
      columns: ['skuCode', 'platform', 'offerId'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    const sheet = await sheetOf(uploaded);
    expect(sheet.rowCount).toBe(2);
    const row = sheet.getRow(2);
    expect(row.getCell(1).value).toBe('SKU000000001');
    // 空字符串单元格读回是 null / 缺省（Excel 里就是空白格）。
    expect(row.getCell(2).value ?? '').toBe('');
    expect(row.getCell(3).value ?? '').toBe('');
  });

  it('条码/编码列固定为文本格式（防科学计数法）', async () => {
    const { service, uploaded } = build([BASE_ROW]);
    await service.buildExport({
      columns: ['skuCode', 'primaryBarcode'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    const sheet = await sheetOf(uploaded);
    const row = sheet.getRow(2);
    expect(row.getCell(1).numFmt).toBe('@');
    expect(row.getCell(2).numFmt).toBe('@');
    expect(row.getCell(2).value).toBe('6901234567890');
  });

  it('金额按数值 + 4 位小数写出', async () => {
    const { service, uploaded } = build([BASE_ROW]);
    await service.buildExport({
      columns: ['latestPurchasePrice'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    const sheet = await sheetOf(uploaded);
    const cell = sheet.getRow(2).getCell(1);
    expect(cell.value).toBe(123.45);
    expect(cell.numFmt).toBe('#,##0.0000');
  });

  it('库存列走库存模块汇总；没有账面行的 SKU 留空（≠0）', async () => {
    const stock = new Map<string, SkuStockSummary>([
      [
        'sku-1',
        {
          skuId: 'sku-1',
          onHandQty: '12.000',
          reservedQty: '2.000',
          pickedQty: '1.000',
          safetyQty: '3.000',
          availableQty: '6.000',
        },
      ],
    ]);
    const noStockRow: SkuExportRow = {
      ...BASE_ROW,
      skuId: 'sku-2',
      skuCode: 'SKU000000002',
      platformCode: null,
      storeCode: null,
      storeName: null,
      platformProductId: null,
      listingTitle: null,
      listingUrl: null,
      listingStatus: null,
      platformSkuId: null,
      sellerSku: null,
      offerId: null,
    };
    const { service, uploaded, listSkuStockSummaries } = build([BASE_ROW, noStockRow], stock);
    await service.buildExport({
      columns: ['skuCode', 'onHandQty', 'availableQty'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    const sheet = await sheetOf(uploaded);
    expect(listSkuStockSummaries).toHaveBeenCalledTimes(1);
    expect(sheet.getRow(2).getCell(2).value).toBe(12);
    expect(sheet.getRow(2).getCell(3).value).toBe(6);
    // 空单元格：exceljs 流式写出后读回是 null（Excel 里就是空白格）。
    expect(sheet.getRow(3).getCell(2).value ?? '').toBe('');
    expect(sheet.getRow(3).getCell(3).value ?? '').toBe('');
  });

  it('时间列按用户时区偏移写入', async () => {
    const { service, uploaded } = build([BASE_ROW]);
    await service.buildExport({
      columns: ['createdAt'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 480,
    });
    const sheet = await sheetOf(uploaded);
    const cell = sheet.getRow(2).getCell(1);
    expect(cell.value).toBeInstanceOf(Date);
    // 2026-11-01T00:00Z + 8h = 2026-11-01 08:00（Excel 里的"本地"时间）
    expect((cell.value as Date).toISOString()).toBe('2026-11-01T08:00:00.000Z');
  });

  it('未知列 → 明确的 422 业务错误（不静默丢列）', async () => {
    const { service } = build([BASE_ROW]);
    await expect(
      service.buildExport({
        columns: ['skuCode', 'notAColumn'],
        sortBy: 'skuCode',
        sortOrder: 'asc',
        tzOffsetMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidSkuExportColumnError);
  });

  it('空列 → 422，而不是导出一个只有表头的空文件', async () => {
    const { service } = build([BASE_ROW]);
    await expect(
      service.buildExport({
        columns: [],
        sortBy: 'skuCode',
        sortOrder: 'asc',
        tzOffsetMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidSkuExportColumnError);
  });

  it('只导出选中 SKU：不按筛选重查 id', async () => {
    const { service, listIdsForExport } = build([BASE_ROW]);
    await service.buildExport({
      columns: ['skuCode'],
      skuIds: ['sku-1'],
      sortBy: 'skuCode',
      sortOrder: 'asc',
      tzOffsetMinutes: 0,
    });
    expect(listIdsForExport).not.toHaveBeenCalled();
  });
});
