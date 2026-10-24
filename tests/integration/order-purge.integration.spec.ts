import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * 错误摄入订单的彻底移除（2026-10-24 用户指示）。
 *
 * 关键约束：取消是「这张单发生过、后来被取消」，删除是「这张单本不该存在」。
 * 删除只允许在**没有任何业务事实**时执行——一旦有库存流水/占用/拣货/发货/
 * 结算/财务/拦截/面单/采购引用，就必须拒绝（AGENTS §14/§101.10）。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3125';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
let db: Client;

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binId = '';

interface PurgePreview {
  orderId: string;
  orderNo: string;
  platformOrderId: string;
  erpStatus: string;
  items: Array<{ id: string; lineNo: number; fulfillmentStatus: string }>;
  willDelete: {
    items: number;
    statusHistory: number;
    platformStatusHistory: number;
    exceptions: number;
  };
  blockers: string[];
}

async function ingestOrder(
  label: string,
): Promise<{ orderId: string; orderNo: string; itemId: string }> {
  const created = await client.post<{
    orderId: string;
    itemResults: Array<{ orderItemId: string }>;
  }>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `${PREFIX}-${label}`,
    platformStatus: 'awaiting_packaging',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    currency: 'RUB',
    items: [{ platformSkuId: `${PREFIX}-NO-SUCH-${label}`, quantity: '1' }],
  });
  expect(created.status, JSON.stringify(created.body.error ?? {})).toBe(200);
  const itemId = created.body.data.itemResults[0]!.orderItemId;
  const detail = await client.get<{ orderNo: string }>(
    `/api/v1/orders/${created.body.data.orderId}`,
  );
  return {
    orderId: created.body.data.orderId,
    orderNo: detail.body.data.orderNo,
    itemId,
  };
}

beforeAll(async () => {
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  api = spawnApiEntry('main.js', { PORT: '3125', REDIS_URL: 'redis://localhost:6379/12' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-PURGE`,
    name: `${PREFIX} 错单移除店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-PWH`,
    name: `${PREFIX} 错单仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binId = bins.body.data.bins[0]!.id;
}, 180_000);

afterAll(async () => {
  await api.stop();
  await db.end();
});

describe('错误摄入订单的彻底移除', () => {
  it('无业务事实的订单：预览 → 确认单号 → 删除订单与附属行', async () => {
    const order = await ingestOrder('P1');
    const preview = await client.get<PurgePreview>(`/api/v1/orders/${order.orderId}/purge-preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.blockers).toEqual([]);
    expect(preview.body.data.willDelete.items).toBe(1);
    expect(preview.body.data.willDelete.exceptions).toBeGreaterThan(0);

    const mismatch = await client.post(`/api/v1/orders/${order.orderId}/purge`, {
      reason: '确认号写错',
      confirmOrderNo: 'ORD99999999',
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error?.code).toBe('ORDER_PURGE_CONFIRM_MISMATCH');
    // 单号不符不删任何东西
    expect((await client.get(`/api/v1/orders/${order.orderId}`)).status).toBe(200);

    const purged = await client.post<{ deleted: { items: number } }>(
      `/api/v1/orders/${order.orderId}/purge`,
      { reason: '重复摄入（测试）', confirmOrderNo: order.orderNo },
    );
    expect(purged.status, JSON.stringify(purged.body.error ?? {})).toBe(200);
    expect(purged.body.data.deleted.items).toBe(1);

    expect((await client.get(`/api/v1/orders/${order.orderId}`)).status).toBe(404);
    const items = await db.query('SELECT 1 FROM order_items WHERE order_id = $1', [order.orderId]);
    expect(items.rowCount).toBe(0);
    const exceptions = await client.get<unknown[]>(
      `/api/v1/exceptions?referenceType=ORDER_ITEM&referenceId=${order.itemId}&pageSize=50`,
    );
    expect(exceptions.body.data).toEqual([]);

    // 幂等：再删一次是 404，不会 500
    const again = await client.post(`/api/v1/orders/${order.orderId}/purge`, {
      reason: '重复删除',
      confirmOrderNo: order.orderNo,
    });
    expect(again.status).toBe(404);
  });

  it('产生过库存流水的订单：拒绝删除并列出阻断项，订单原样保留', async () => {
    const order = await ingestOrder('P2');
    const sku = await client.post<{ id: string }>('/api/v1/skus', {
      nameZh: `${PREFIX} 错单流水-SKU`,
    });
    const event = await db.query<{ id: string }>(
      `INSERT INTO inventory_events
         (event_no, event_type, reference_type, reference_id, idempotency_key)
       VALUES ($1, 'RECEIVE', 'ORDER', $2, $3)
       RETURNING id`,
      [
        `${PREFIX}-EV-${randomUUID().slice(0, 8)}`,
        order.orderId,
        `${PREFIX}-EVK-${randomUUID().slice(0, 8)}`,
      ],
    );
    const eventId = event.rows[0]!.id;
    await db.query(
      `INSERT INTO inventory_transactions
         (transaction_no, event_id, sku_id, warehouse_id, bin_id, transaction_type,
          quantity_before, quantity_change, quantity_after, reference_type, reference_id, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, 'RECEIVE', 0, 1, 1, 'ORDER', $6, $7)`,
      [
        `${PREFIX}-TX-${randomUUID().slice(0, 8)}`,
        eventId,
        sku.body.data.id,
        warehouseId,
        binId,
        order.orderId,
        `${PREFIX}-IDEM-${randomUUID().slice(0, 8)}`,
      ],
    );

    const preview = await client.get<PurgePreview>(`/api/v1/orders/${order.orderId}/purge-preview`);
    expect(preview.body.data.blockers.join('；')).toContain('库存流水');

    const blocked = await client.post(`/api/v1/orders/${order.orderId}/purge`, {
      reason: '不该删的',
      confirmOrderNo: order.orderNo,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe('ORDER_PURGE_BLOCKED');
    expect((await client.get(`/api/v1/orders/${order.orderId}`)).status).toBe(200);
  });
});
