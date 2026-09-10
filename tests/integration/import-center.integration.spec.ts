import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Import Center acceptance (task §86):
 * 100+ SKU rows incl. normal / duplicate sku_code / duplicate barcode /
 * unknown product rows; exact row numbers reported; confirm imports only
 * valid rows via the BullMQ worker; plus a LISTING_MAPPING sheet with
 * unknown store / unknown sku rows.
 */
let api: ManagedProcess;
let worker: ManagedProcess;
const BASE = 'http://localhost:3108';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

interface ImportJobDto {
  id: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  failedRows: number;
  errors: Array<{ row: number; field?: string; code: string }> | null;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3108', REDIS_URL: 'redis://localhost:6379/7' });
  worker = spawnApiEntry('worker.js', { PORT: '3108', REDIS_URL: 'redis://localhost:6379/7' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();
});

afterAll(async () => {
  await api.stop();
  await worker.stop();
});

async function skuSheet(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SKU');
  sheet.addRow([
    'sku_code',
    'product_code',
    'product_name_zh',
    'name_zh',
    'model',
    'color',
    'weight_g',
    'length_mm',
    'width_mm',
    'height_mm',
    'latest_purchase_price',
    'barcode',
    'barcode_type',
  ]);
  // rows 2..91: 90 normal rows (auto sku_code, product created by name)
  for (let i = 1; i <= 90; i += 1) {
    sheet.addRow([
      '',
      '',
      `${PREFIX} 导入商品`,
      `${PREFIX} 正常SKU-${String(i).padStart(3, '0')}`,
      'M1',
      '黑',
      500,
      100,
      100,
      100,
      88.8,
      `69${PREFIX}${String(i).padStart(6, '0')}`,
      'EAN',
    ]);
  }
  // row 92: duplicate sku_code against DB (seed one first via API below)
  sheet.addRow([
    `${PREFIX}-DUPSKU`,
    '',
    `${PREFIX} 导入商品`,
    `${PREFIX} 重复SKU`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  // row 93: duplicate barcode (will collide with row 2's barcode)
  sheet.addRow([
    '',
    '',
    `${PREFIX} 导入商品`,
    `${PREFIX} 重复条码`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    `69${PREFIX}000001`,
    'EAN',
  ]);
  // row 94: unknown product without product_name_zh
  sheet.addRow([
    '',
    'NOPE-404',
    '',
    `${PREFIX} 未知商品SKU`,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  // rows 95..104: in-file duplicate sku_code
  for (let i = 1; i <= 10; i += 1) {
    sheet.addRow([
      `${PREFIX}-INDUP`,
      '',
      `${PREFIX} 导入商品`,
      `${PREFIX} 文件内重复-${i}`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

describe('SKU import (task §86: >=100 rows, exact error rows)', () => {
  it('seeds the DB duplicate sku_code, uploads, and gets exact row errors', async () => {
    // create the conflicting SKU in the DB first
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} 导入商品DB`,
    });
    await client.post('/api/v1/skus', {
      productId: product.body.data.id,
      skuCode: `${PREFIX}-DUPSKU`,
      nameZh: 'db duplicate',
    });

    const uploaded = await client.upload<ImportJobDto>(`/api/v1/imports/upload?type=SKU`, {
      name: 'skus.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await skuSheet(),
    });
    expect(uploaded.body.success).toBe(true);
    const job = uploaded.body.data;
    expect(job.totalRows).toBe(103); // 90 normal + 3 invalid + 10 same-code rows
    expect(job.validRows).toBe(91); // 90 normal + the first INDUP row
    expect(job.invalidRows).toBe(12);
    expect(job.status).toBe('VALIDATED');

    const byRow = new Map((job.errors ?? []).map((error) => [error.row, error]));
    expect(byRow.get(92)?.code).toBe('SKU_CODE_ALREADY_EXISTS');
    expect(byRow.get(93)?.code).toBe('SKU_BARCODE_ALREADY_EXISTS');
    expect(byRow.get(94)?.code).toBe('PRODUCT_NOT_FOUND');
    for (let row = 96; row <= 104; row += 1) {
      expect(byRow.get(row)?.code).toBe('SKU_CODE_ALREADY_EXISTS');
    }

    // confirm -> worker imports the 90 valid rows
    const confirmed = await client.post<ImportJobDto>(`/api/v1/imports/${job.id}/confirm`);
    expect([200, 202]).toContain(confirmed.status);

    let final: ImportJobDto | undefined;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await client.get<ImportJobDto>(`/api/v1/imports/${job.id}`);
      final = poll.body.data;
      if (final.status === 'COMPLETED') {
        break;
      }
    }
    expect(final?.status).toBe('COMPLETED');
    expect(final?.importedRows).toBe(91);
    expect(final?.failedRows).toBe(0);

    // imported rows are searchable with computed volume
    const list = await client.get<unknown[]>(
      `/api/v1/skus?keyword=${encodeURIComponent(`${PREFIX} 正常SKU-001`)}&pageSize=20`,
    );
    expect(list.body.data.length).toBe(1);
  });

  it('rejects confirm on a job without valid rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('SKU');
    sheet.addRow(['sku_code', 'product_code', 'product_name_zh', 'name_zh']);
    sheet.addRow(['', 'NOPE-404', '', 'orphan']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const uploaded = await client.upload<ImportJobDto>(`/api/v1/imports/upload?type=SKU`, {
      name: 'all-bad.xlsx',
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });
    expect(uploaded.body.data.validRows).toBe(0);
    expect(uploaded.body.data.status).toBe('FAILED');
    const confirmed = await client.post(`/api/v1/imports/${uploaded.body.data.id}/confirm`);
    expect(confirmed.status).toBe(409);
  });
});

describe('LISTING_MAPPING import (task §58: unknown store / unknown sku rows)', () => {
  it('reports unknown store and unknown sku with exact rows', async () => {
    const platforms = await client.get<Array<{ id: string; code: string }>>('/api/v1/platforms');
    const ozonId = platforms.body.data.find((platform) => platform.code === 'OZON')?.id ?? '';
    const store = await client.post<{ id: string; storeCode: string }>('/api/v1/stores', {
      platformId: ozonId,
      storeCode: `${PREFIX}-IMP`,
      name: 'import store',
    });
    const product = await client.post<{ id: string }>('/api/v1/products', {
      nameZh: `${PREFIX} IMP`,
    });
    const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      nameZh: `${PREFIX} IMP-SKU`,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('LM');
    sheet.addRow([
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
    sheet.addRow([
      'OZON',
      store.body.data.storeCode,
      `${PREFIX}-L1`,
      'ps1',
      'ss1',
      `${PREFIX}-O1`,
      sku.body.data.skuCode,
      't',
      'u',
    ]);
    sheet.addRow([
      'OZON',
      'GHOST-STORE',
      `${PREFIX}-L2`,
      '',
      '',
      `${PREFIX}-O2`,
      sku.body.data.skuCode,
      '',
      '',
    ]);
    sheet.addRow([
      'OZON',
      store.body.data.storeCode,
      `${PREFIX}-L3`,
      '',
      '',
      `${PREFIX}-O3`,
      'GHOST-SKU',
      '',
      '',
    ]);

    const uploaded = await client.upload<ImportJobDto>(
      `/api/v1/imports/upload?type=LISTING_MAPPING`,
      {
        name: 'lm.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      },
    );
    const job = uploaded.body.data;
    expect(job.validRows).toBe(1);
    expect(job.invalidRows).toBe(2);
    const byRow = new Map((job.errors ?? []).map((error) => [error.row, error]));
    expect(byRow.get(3)?.code).toBe('STORE_NOT_FOUND');
    expect(byRow.get(4)?.code).toBe('SKU_NOT_FOUND');

    await client.post(`/api/v1/imports/${job.id}/confirm`);
    let final: ImportJobDto | undefined;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const poll = await client.get<ImportJobDto>(`/api/v1/imports/${job.id}`);
      final = poll.body.data;
      if (final.status === 'COMPLETED') break;
    }
    expect(final?.importedRows).toBe(1);

    // the imported mapping resolves store-scoped
    const resolved = await client.get<{ internalSkuCode: string }>(
      `/api/v1/listings/resolve?storeId=${store.body.data.id}&offerId=${PREFIX}-O1`,
    );
    expect(resolved.body.data.internalSkuCode).toBe(sku.body.data.skuCode);
  });
});
