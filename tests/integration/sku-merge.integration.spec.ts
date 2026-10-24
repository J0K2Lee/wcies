import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * SKU 档案合并（2026-10-24，ADR 0024）真实 PostgreSQL 集成测试。
 *
 * 覆盖 AGENTS §76-78 要求的关键面：事务、行锁下的余额归并、流水按时间重放、
 * 终值校验与失败回滚。每个场景用自己的 SKU，互不污染。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3123';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

let postgres: Client;
let warehouseId = '';
let binA01 = '';
let binA02 = '';

interface MergePreview {
  source: { id: string; skuCode: string };
  target: { id: string; skuCode: string };
  product: { barcodes: number; platformMappings: number };
  inventory: { balances: number; onHandQty: string; transactions: number };
}

interface MergeResult {
  mergedSourceSkuCode: string;
  targetSkuCode: string;
  barcodesMoved: number;
  inventory: { absorbedOnHand: string; replayedTransactions: number };
}

interface LedgerRow {
  bin_id: string;
  quantity_before: string;
  quantity_change: string;
  quantity_after: string;
}

/**
 * 生成一个合法的 69 开头 EAN-13（API 对 69 前缀强制校验位，见 barcode.constants）。
 * 12 位前缀里的随机段保证多次运行不撞条码唯一键。
 */
function makeEan13(): string {
  const body = `690${Math.floor(Math.random() * 1e9)
    .toString()
    .padStart(9, '0')}`.slice(0, 12);
  const sum = [...body].reduce(
    (acc, digit, index) => acc + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${String((10 - (sum % 10)) % 10)}`;
}

async function newSku(label: string): Promise<{ id: string; skuCode: string }> {
  const created = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}`,
  });
  expect(created.status).toBe(201);
  return created.body.data;
}

async function initialize(skuId: string, binId: string, quantity: string): Promise<void> {
  const result = await client.post('/api/v1/inventory/initialize', {
    skuId,
    warehouseId,
    binId,
    quantity,
    referenceType: 'MANUAL',
    referenceId: randomUUID(),
    remark: 'sku-merge integration',
    idempotencyKey: `merge-init-${randomUUID()}`,
  });
  // initialize 返回 200（不是 201）。
  expect(result.status).toBe(200);
}

async function balancesOf(skuId: string): Promise<Array<{ binId: string; onHandQty: string }>> {
  const list = await client.get<Array<{ binId: string; onHandQty: string }>>(
    `/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`,
  );
  return list.body.data;
}

async function ledgerOf(skuId: string): Promise<LedgerRow[]> {
  const rows = await postgres.query<LedgerRow>(
    `SELECT bin_id, quantity_before, quantity_change, quantity_after
       FROM inventory_transactions
      WHERE sku_id = $1::uuid
      ORDER BY bin_id, created_at, id`,
    [skuId],
  );
  return rows.rows;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3123', REDIS_URL: 'redis://localhost:6379/12' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  postgres = new Client({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://wcies:wcies_dev_password@localhost:5432/wcies_dev',
  });
  await postgres.connect();

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 合并测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 2, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins.find((bin) => bin.binCode.endsWith('A01-1'))!.id;
  binA02 = bins.body.data.bins.find((bin) => bin.binCode.endsWith('A02-1'))!.id;
});

afterAll(async () => {
  await postgres.end();
  await api.stop();
});

describe('SKU 合并：余额归并 + 流水重放', () => {
  it('同库位相加、跨库位改指，流水按时间重放且终值等于余额，源 SKU 被删除', async () => {
    const target = await newSku('合并目标');
    const source = await newSku('合并源');

    // 目标：A01 = 2；源：A01 = 1、A02 = 3
    await initialize(target.id, binA01, '2');
    await initialize(source.id, binA01, '1');
    await initialize(source.id, binA02, '3');

    // 源 SKU 上放一个条码，合并后应挂到目标（69 前缀要走 EAN-13 校验，这里算好校验位）
    const barcode = await client.post(`/api/v1/skus/${source.id}/barcodes`, {
      barcode: makeEan13(),
      barcodeType: 'INTERNAL',
    });
    expect(barcode.status).toBe(201);

    const preview = await client.get<MergePreview>(
      `/api/v1/skus/${source.id}/merge-preview?targetSkuId=${target.id}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.data.inventory.balances).toBe(2);
    expect(preview.body.data.inventory.onHandQty).toBe('4.000');

    const merged = await client.post<MergeResult>(`/api/v1/skus/${source.id}/merge-into`, {
      targetSkuId: target.id,
      confirmSkuCode: target.skuCode,
    });
    expect(merged.status).toBe(200);
    expect(merged.body.data.inventory.absorbedOnHand).toBe('4.000');

    // 余额：A01 = 2 + 1 = 3，A02 = 3（源行改指）
    const balances = await balancesOf(target.id);
    expect(balances).toHaveLength(2);
    const byBin = new Map(balances.map((row) => [row.binId, row.onHandQty]));
    expect(byBin.get(binA01)).toBe('3.000');
    expect(byBin.get(binA02)).toBe('3.000');

    // 流水：源的两条已改指目标；重放后每条 after = before + change，末值 = 余额
    const ledger = await ledgerOf(target.id);
    expect(ledger.length).toBeGreaterThanOrEqual(3);
    for (const row of ledger) {
      expect(Number(row.quantity_after)).toBeCloseTo(
        Number(row.quantity_before) + Number(row.quantity_change),
        3,
      );
    }
    const lastA01 = [...ledger].filter((row) => row.bin_id === binA01).at(-1);
    const lastA02 = [...ledger].filter((row) => row.bin_id === binA02).at(-1);
    expect(lastA01?.quantity_after).toBe('3.000');
    expect(lastA02?.quantity_after).toBe('3.000');

    // 源 SKU 已删除，条码挂到目标
    const sourceGone = await client.get(`/api/v1/skus/${source.id}`);
    expect(sourceGone.status).toBe(404);
    const targetBarcodes = await client.get<Array<{ barcode: string }>>(
      `/api/v1/skus/${target.id}/barcodes`,
    );
    expect(targetBarcodes.body.data.some((row) => row.barcode === barcode.body.data.barcode)).toBe(
      true,
    );
  });

  it('流水与余额对不上时拒绝合并并回滚（源 SKU 仍在、余额未变）', async () => {
    const target = await newSku('冲突目标');
    const source = await newSku('冲突源');
    await initialize(target.id, binA01, '1');
    await initialize(source.id, binA01, '2');

    // 人为破坏源 SKU 的一条流水：把 change 改成 9，重放终值将不等于余额
    await postgres.query(
      `UPDATE inventory_transactions SET quantity_change = 9
        WHERE id = (
          SELECT id FROM inventory_transactions
           WHERE sku_id = $1::uuid ORDER BY created_at DESC LIMIT 1)`,
      [source.id],
    );

    const merged = await client.post(`/api/v1/skus/${source.id}/merge-into`, {
      targetSkuId: target.id,
      confirmSkuCode: target.skuCode,
    });
    expect(merged.status).toBe(409);
    expect(merged.body.error.code).toBe('SKU_MERGE_INVENTORY_CONFLICT');

    // 回滚：两张 SKU 都还在，余额未合并
    expect((await client.get(`/api/v1/skus/${source.id}`)).status).toBe(200);
    const sourceBalances = await balancesOf(source.id);
    expect(sourceBalances).toHaveLength(1);
    expect(sourceBalances[0]?.onHandQty).toBe('2.000');
    expect((await balancesOf(target.id))[0]?.onHandQty).toBe('1.000');
  });

  it('确认编码不一致时拒绝，不产生任何改动', async () => {
    const target = await newSku('确认目标');
    const source = await newSku('确认源');
    await initialize(source.id, binA01, '1');

    const merged = await client.post(`/api/v1/skus/${source.id}/merge-into`, {
      targetSkuId: target.id,
      confirmSkuCode: 'WRONG-CODE',
    });
    expect(merged.status).toBe(422);
    expect(merged.body.error.code).toBe('SKU_MERGE_CONFIRM_MISMATCH');
    expect((await client.get(`/api/v1/skus/${source.id}`)).status).toBe(200);
  });

  it('不能把 SKU 合并到它自己', async () => {
    const sku = await newSku('自合并');
    const merged = await client.post(`/api/v1/skus/${sku.id}/merge-into`, {
      targetSkuId: sku.id,
      confirmSkuCode: sku.skuCode,
    });
    expect(merged.status).toBe(422);
    expect(merged.body.error.code).toBe('SKU_MERGE_INVALID_REQUEST');
  });
});
