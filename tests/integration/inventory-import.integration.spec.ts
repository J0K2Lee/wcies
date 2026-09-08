import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * INITIAL_INVENTORY import template (Sprint 2 task §46-§47): fixed-template
 * Excel -> per-row validation -> BullMQ worker applies rows through the real
 * InventoryService with stable per-row idempotency keys.
 */
let api: ManagedProcess;
let worker: ManagedProcess;
const BASE = 'http://localhost:3111';
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
  errors: Array<{ row: number; field?: string; code: string; message: string }> | null;
}

interface BalanceRow {
  skuCode: string;
  binCode: string;
  onHandQty: string;
}

let warehouseId = '';
let binA01 = '';
let sku1Id = '';
let sku2Id = '';
let sku1Code = '';
let sku2Code = '';

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  worker = spawnApiEntry('worker.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-IMPWH`,
    name: `${PREFIX} 导入仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { rackFrom: 'A01', rackTo: 'A02', levelFrom: '01', levelTo: '01' },
  );
  binA01 = bins.body.data.bins.find((bin) => bin.binCode.endsWith('A01-01'))!.id;

  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} 导入商品`,
  });
  for (const suffix of ['1', '2']) {
    const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
      productId: product.body.data.id,
      skuCode: `${PREFIX}-IMPSKU${suffix}`,
      nameZh: `${PREFIX} 导入SKU${suffix}`,
    });
    if (suffix === '1') {
      sku1Id = sku.body.data.id;
      sku1Code = sku.body.data.skuCode;
    } else {
      sku2Id = sku.body.data.id;
      sku2Code = sku.body.data.skuCode;
    }
  }
});

afterAll(async () => {
  await api.stop();
  await worker.stop();
});

async function sheet(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('INITIAL_INVENTORY');
  sheet.addRow(['sku_code', 'warehouse_code', 'bin_code', 'quantity', 'remark']);
  sheet.addRow([sku1Code, `${PREFIX}-IMPWH`, `${PREFIX}-IMPWH-A01-01`, '10', '首行有效']);
  sheet.addRow([sku2Code, `${PREFIX}-IMPWH`, `${PREFIX}-IMPWH-A02-01`, '0.5', '小数数量']);
  sheet.addRow(['NOPE-SKU', `${PREFIX}-IMPWH`, `${PREFIX}-IMPWH-A01-01`, '5', '']); // row 4: unknown sku
  sheet.addRow([sku1Code, 'NOPE-WH', `${PREFIX}-IMPWH-A01-01`, '5', '']); // row 5: unknown warehouse
  sheet.addRow([sku1Code, `${PREFIX}-IMPWH`, 'NOPE-BIN', '5', '']); // row 6: unknown bin
  sheet.addRow([sku2Code, `${PREFIX}-IMPWH`, `${PREFIX}-IMPWH-A01-01`, '0', '']); // row 7: qty <= 0 (own dimension)
  sheet.addRow([sku1Code, `${PREFIX}-IMPWH`, `${PREFIX}-IMPWH-A01-01`, '3', '']); // row 8: duplicate dim of row 2
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

describe('INITIAL_INVENTORY import (task §46-§47)', () => {
  let jobId = '';

  it('validates rows with exact per-row errors and a clear duplicate strategy', async () => {
    const uploaded = await client.upload<ImportJobDto>(
      `/api/v1/imports/upload?type=INITIAL_INVENTORY`,
      {
        name: 'initial-inventory.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await sheet(),
      },
    );
    expect(uploaded.body.success).toBe(true);
    const job = uploaded.body.data;
    expect(job.totalRows).toBe(7);
    expect(job.validRows).toBe(2);
    expect(job.invalidRows).toBe(5);
    expect(job.status).toBe('VALIDATED');

    const byRow = new Map((job.errors ?? []).map((error) => [error.row, error]));
    expect(byRow.get(4)?.code).toBe('SKU_NOT_FOUND');
    expect(byRow.get(5)?.code).toBe('WAREHOUSE_NOT_FOUND');
    expect(byRow.get(6)?.code).toBe('WAREHOUSE_BIN_NOT_FOUND');
    expect(byRow.get(7)?.code).toBe('INITIAL_INVENTORY_QUANTITY_INVALID');
    expect(byRow.get(8)?.code).toBe('INITIAL_INVENTORY_ROW_DUPLICATE');
    jobId = job.id;
  });

  it('worker imports valid rows through the real InventoryService', async () => {
    const confirmed = await client.post<ImportJobDto>(`/api/v1/imports/${jobId}/confirm`);
    expect([200, 202]).toContain(confirmed.status);

    let final: ImportJobDto | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const poll = await client.get<ImportJobDto>(`/api/v1/imports/${jobId}`);
      final = poll.body.data;
      if (final.status === 'COMPLETED' || final.status === 'FAILED') {
        break;
      }
    }
    expect(final?.status).toBe('COMPLETED');
    expect(final?.importedRows).toBe(2);
    expect(final?.failedRows).toBe(0);

    const rows1 = await client.get<BalanceRow[]>(
      `/api/v1/inventory?skuId=${sku1Id}&warehouseId=${warehouseId}&pageSize=100`,
    );
    expect(rows1.body.data).toHaveLength(1);
    expect(rows1.body.data[0]?.onHandQty).toBe('10.000');

    const rows2 = await client.get<BalanceRow[]>(
      `/api/v1/inventory?skuId=${sku2Id}&warehouseId=${warehouseId}&pageSize=100`,
    );
    expect(rows2.body.data).toHaveLength(1);
    expect(rows2.body.data[0]?.onHandQty).toBe('0.500');

    // ledger lines carry the IMPORT reference (task §47)
    const ledger = await client.get(
      `/api/v1/inventory/transactions?skuId=${sku1Id}&transactionType=INITIAL_STOCK&pageSize=10`,
    );
    expect(ledger.body.data.length).toBe(1);
  });

  it('the per-row idempotency key replays instead of double-adding (task §47)', async () => {
    // Call the public API with the exact key the worker used for Excel row 2.
    const key = `INITIAL_INVENTORY:${jobId}:2`;
    const replay = await client.post('/api/v1/inventory/initialize', {
      skuId: sku1Id,
      warehouseId,
      binId: binA01,
      quantity: '10',
      referenceType: 'IMPORT',
      referenceId: jobId,
      remark: 'worker-retry simulation',
      idempotencyKey: key,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotentReplay).toBe(true);

    const rows = await client.get<BalanceRow[]>(
      `/api/v1/inventory?skuId=${sku1Id}&warehouseId=${warehouseId}&pageSize=100`,
    );
    expect(rows.body.data[0]?.onHandQty).toBe('10.000');
  });

  it('DEFAULT virtual bin is created for a bin-less warehouse on initialize (task §6)', async () => {
    const platformWh = await client.post<{ id: string }>('/api/v1/warehouses', {
      warehouseCode: `${PREFIX}-FBOTEST`,
      name: `${PREFIX} 平台仓(无库位)`,
      warehouseType: 'PLATFORM',
      countryCode: 'RU',
    });
    const result = await client.post<{ balance: { binId: string } }>(
      '/api/v1/inventory/initialize',
      {
        skuId: sku1Id,
        warehouseId: platformWh.body.data.id,
        quantity: '6',
        referenceType: 'MANUAL',
        referenceId: randomUUID(),
        remark: 'virtual default bin',
        idempotencyKey: `default-bin:${PREFIX}`,
      },
    );
    expect(result.status).toBe(200);
    const bins = await client.get<Array<{ binCode: string; id: string }>>(
      `/api/v1/warehouses/${platformWh.body.data.id}/bins?pageSize=10`,
    );
    const defaultBin = bins.body.data.find((bin) => bin.binCode === 'DEFAULT');
    expect(defaultBin).toBeDefined();
    expect(result.body.data.balance.binId).toBe(defaultBin?.id);
  });

  it('a warehouse WITH bins refuses a bin-less initialize', async () => {
    const rejected = await client.post('/api/v1/inventory/initialize', {
      skuId: sku1Id,
      warehouseId,
      quantity: '1',
      referenceType: 'MANUAL',
      referenceId: randomUUID(),
      idempotencyKey: `bin-required:${PREFIX}`,
    });
    expect(rejected.status).toBe(422);
    expect(rejected.body.error?.code).toBe('INVENTORY_DIMENSION_INVALID');
  });
});
