import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * 手工释放库存占用（用户要求 2026-10-26）against real PostgreSQL.
 *
 * 必须证明的是 mock 证不了的那部分：释放真的走了库存模块（reservation RELEASED
 * + 余额 reserved 归还），订单行回到 PENDING 且**不会被立刻重新分配**；
 * 而后续真实入库事件仍然会按既有规则把它重新占用（AGENTS.md §78）。
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3114';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';
let barcodeSeq = 0;

async function mappedSku(
  label: string,
): Promise<{ skuId: string; barcode: string; skuKey: string }> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  const skuId = sku.body.data.id;
  barcodeSeq += 1;
  const barcode = `${PREFIX}-${label}-${barcodeSeq}`;
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
  const skuKey = `${PREFIX}-${label}-${barcodeSeq}`;
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-PP-${skuKey}`,
    skuVariants: [{ skuId, platformSkuId: skuKey }],
  });
  return { skuId, barcode, skuKey };
}

async function receive(skuId: string, quantity: string): Promise<void> {
  const receipt = await client.post<{ id: string }>('/api/v1/purchase-receipts', {
    warehouseId,
    sourceNote: `${PREFIX} 备货`,
    items: [{ skuId, quantity, binId: binA01, unitCost: '10' }],
  });
  const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
  expect(confirm.status).toBe(200);
}

async function ingestOrder(platformSkuId: string, quantity: string): Promise<string> {
  const result = await client.post<{ orderId: string }>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'awaiting_packaging',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    currency: 'RUB',
    items: [{ platformSkuId, quantity }],
  });
  expect(result.status).toBe(200);
  return result.body.data.orderId;
}

async function orderDetail(orderId: string) {
  const detail = await client.get<{
    erpStatus: string;
    items: Array<{ id: string; fulfillmentStatus: string; reservationId: string | null }>;
  }>(`/api/v1/orders/${orderId}`);
  return detail.body.data;
}

async function balance(skuId: string): Promise<{ onHand: string; reserved: string }> {
  const list = await client.get<Array<{ onHandQty: string; reservedQty: string }>>(
    `/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`,
  );
  const row = list.body.data[0];
  return { onHand: row?.onHandQty ?? '0', reserved: row?.reservedQty ?? '0' };
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3114', REDIS_URL: 'redis://localhost:6379/11' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-REL`,
    name: `${PREFIX} 释放占用店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-RELWH`,
    name: `${PREFIX} 释放占用仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins[0]?.id ?? '';
  await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
});

afterAll(async () => {
  await api.stop();
});

describe('手工释放库存占用', () => {
  it('释放后占用归还、行回到待分配，且不会被立刻重新分配', async () => {
    const { skuId, skuKey } = await mappedSku('REL');
    await receive(skuId, '1');
    const orderId = await ingestOrder(skuKey, '1');

    const reservedState = await orderDetail(orderId);
    expect(reservedState.items[0]?.fulfillmentStatus).toBe('RESERVED');
    expect(await balance(skuId)).toEqual({ onHand: '1.000', reserved: '1.000' });

    const itemId = reservedState.items[0]!.id;
    const released = await client.post<{
      fulfillmentStatus: string;
      orderErpStatus: string;
      releasedReservationId: string;
    }>(`/api/v1/orders/items/${itemId}/release-reservation`, {});
    expect(released.status).toBe(200);
    expect(released.body.data.fulfillmentStatus).toBe('PENDING');
    expect(released.body.data.orderErpStatus).toBe('BACKORDERED');

    // 库存侧真的释放了：reserved 归零，on hand 不动（货还在架上）。
    expect(await balance(skuId)).toEqual({ onHand: '1.000', reserved: '0.000' });
    // 占用记录落 RELEASED（库存事实可追溯）。
    const reservations = await client.get<Array<{ id: string; status: string }>>(
      `/api/v1/inventory/reservations?referenceType=ORDER&referenceId=${itemId}`,
    );
    expect(reservations.body.data.map((row) => row.status)).toContain('RELEASED');

    // 「不立即重新分配」：等一会儿仍是待分配（释放本身不广播库存增加事件）。
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    const afterRelease = await orderDetail(orderId);
    expect(afterRelease.items[0]?.fulfillmentStatus).toBe('PENDING');
    expect(afterRelease.erpStatus).toBe('BACKORDERED');
    expect(await balance(skuId)).toEqual({ onHand: '1.000', reserved: '0.000' });

    // 后续真实入库仍按既有规则自动占用这一行。
    await receive(skuId, '1');
    const deadline = Date.now() + 10_000;
    let reallocated = false;
    while (Date.now() < deadline) {
      const fresh = await orderDetail(orderId);
      if (fresh.items[0]?.fulfillmentStatus === 'RESERVED') {
        reallocated = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(reallocated).toBe(true);
  });

  it('非已占用行拒绝释放（409）', async () => {
    const { skuKey } = await mappedSku('SHORT');
    // 没有库存 → 行 BACKORDERED，没有占用可释放。
    const orderId = await ingestOrder(skuKey, '1');
    const detail = await orderDetail(orderId);
    expect(detail.items[0]?.fulfillmentStatus).toBe('BACKORDERED');

    const refused = await client.post(
      `/api/v1/orders/items/${detail.items[0]!.id}/release-reservation`,
      {},
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe('ORDER_INVALID_STATE');
  });
});
