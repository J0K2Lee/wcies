import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Order fulfillment flow (2026-09-18) against real PostgreSQL.
 *
 * The one-click 发货 path adds an ORCHESTRATION over the existing ladder, so
 * the thing that must be proven here is exactly the thing a mock cannot prove:
 * the stock ledger moves ONCE, concurrently and on replay (AGENTS.md §77/§78).
 * The platform write half of the flow is covered by the adapter specs with a
 * scripted transport - it must never run against a real account (§92).
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3113';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';
let barcodeSeq = 0;

async function newSku(label: string): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
}

async function balanceOnHand(skuId: string): Promise<string> {
  const list = await client.get<Array<{ onHandQty: string }>>(
    `/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`,
  );
  return list.body.data[0]?.onHandQty ?? '0';
}

async function mappedSku(
  label: string,
): Promise<{ skuId: string; barcode: string; skuKey: string }> {
  const skuId = await newSku(label);
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

/** Puts `quantity` sellable units on the shelf (a confirmed receipt IS stock). */
async function receive(skuId: string, quantity: string): Promise<void> {
  const receipt = await client.post<{ id: string }>('/api/v1/purchase-receipts', {
    warehouseId,
    sourceNote: `${PREFIX} 备货`,
    items: [{ skuId, quantity, binId: binA01, unitCost: '10' }],
  });
  const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
  expect(confirm.status).toBe(200);
}

async function ingestOrder(input: {
  platformSkuId: string;
  quantity: string;
  platformTrackingNo?: string;
}): Promise<string> {
  const result = await client.post<{ orderId: string }>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'awaiting_packaging',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    currency: 'RUB',
    ...(input.platformTrackingNo === undefined
      ? {}
      : { platformTrackingNo: input.platformTrackingNo }),
    items: [{ platformSkuId: input.platformSkuId, quantity: input.quantity }],
  });
  expect(result.status).toBe(200);
  return result.body.data.orderId;
}

/** Picks every unit of the order (the 发货 pre-condition). */
async function pick(orderId: string, barcode: string, units: number): Promise<void> {
  const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
    orderId,
  });
  const taskId = task.body.data.tasks[0]!.id;
  await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
  for (let i = 0; i < units; i += 1) {
    const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(scan.status).toBe(200);
  }
}

async function quickShip(orderId: string) {
  return client.post<{
    orderErpStatus: string;
    trackingNumber: string | null;
    shipments: Array<{ shipmentId: string; alreadyShipped: boolean }>;
  }>(`/api/v1/orders/${orderId}/ship`, {});
}

async function orderDetail(orderId: string) {
  const detail = await client.get<{
    erpStatus: string;
    platformTrackingNo: string | null;
    platformCapabilities: { prepareShipment: boolean; fetchShippingLabel: boolean };
    items: Array<{ fulfillmentStatus: string }>;
  }>(`/api/v1/orders/${orderId}`);
  return detail.body.data;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3113', REDIS_URL: 'redis://localhost:6379/10' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-SHIP`,
    name: `${PREFIX} 发货流程店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-SHIPWH`,
    name: `${PREFIX} 发货流程仓`,
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

describe('one-click 发货 (2026-09-18 flow)', () => {
  it('refuses to ship before the lines are picked', async () => {
    const { skuId, skuKey } = await mappedSku('GATE');
    await receive(skuId, '3');
    const orderId = await ingestOrder({ platformSkuId: skuKey, quantity: '2' });

    const refused = await quickShip(orderId);
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe('SHIPMENT_NO_ELIGIBLE_ITEMS');
    expect((await orderDetail(orderId)).erpStatus).toBe('READY_TO_PICK');
    expect(await balanceOnHand(skuId)).toBe('3.000');
  });

  it('ships, deducts stock once and carries the platform waybill onto the shipment', async () => {
    const { skuId, barcode, skuKey } = await mappedSku('SHIP');
    await receive(skuId, '5');
    const orderId = await ingestOrder({
      platformSkuId: skuKey,
      quantity: '2',
      platformTrackingNo: 'OZ-E2E-TRACK-1',
    });

    // Ingest stores the platform waybill fact (order-level, before any shipment).
    const beforeShip = await orderDetail(orderId);
    expect(beforeShip.platformTrackingNo).toBe('OZ-E2E-TRACK-1');
    // The OZON adapter declares the fulfillment write capabilities, so the UI
    // will offer 获取运单号 / 打单 for this store.
    expect(beforeShip.platformCapabilities).toEqual({
      prepareShipment: true,
      fetchShippingLabel: true,
    });

    await pick(orderId, barcode, 2);
    const shipped = await quickShip(orderId);
    expect(shipped.status).toBe(200);
    expect(shipped.body.data.orderErpStatus).toBe('SHIPPED');
    expect(shipped.body.data.trackingNumber).toBe('OZ-E2E-TRACK-1');

    const detail = await orderDetail(orderId);
    expect(detail.erpStatus).toBe('SHIPPED');
    expect(detail.items[0]?.fulfillmentStatus).toBe('SHIPPED');
    expect(await balanceOnHand(skuId)).toBe('3.000');

    // The waybill reached the internal shipment (the "future adapter fills it
    // in" promise in orders.md §15A).
    const shipmentId = shipped.body.data.shipments[0]!.shipmentId;
    const shipment = await client.get<{ trackingNumber: string | null; status: string }>(
      `/api/v1/shipments/${shipmentId}`,
    );
    expect(shipment.body.data.status).toBe('SHIPPED');
    expect(shipment.body.data.trackingNumber).toBe('OZ-E2E-TRACK-1');
  });

  it('replaying 发货 never deducts stock twice (task §27)', async () => {
    const { skuId, barcode, skuKey } = await mappedSku('REPLAY');
    await receive(skuId, '4');
    const orderId = await ingestOrder({ platformSkuId: skuKey, quantity: '1' });
    await pick(orderId, barcode, 1);

    const first = await quickShip(orderId);
    expect(first.status).toBe(200);
    expect(await balanceOnHand(skuId)).toBe('3.000');

    const second = await quickShip(orderId);
    expect(second.status).toBe(200);
    expect(second.body.data.shipments[0]?.alreadyShipped).toBe(true);
    expect(await balanceOnHand(skuId)).toBe('3.000');
  });

  it('concurrent 发货 deducts exactly one unit (AGENTS.md §18)', async () => {
    const { skuId, barcode, skuKey } = await mappedSku('RACE');
    await receive(skuId, '2');
    const orderId = await ingestOrder({ platformSkuId: skuKey, quantity: '1' });
    await pick(orderId, barcode, 1);

    // Both requests race the same shipment: the FOR UPDATE lock makes the
    // second one an idempotent replay rather than a second deduction.
    const [a, b] = await Promise.all([quickShip(orderId), quickShip(orderId)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await balanceOnHand(skuId)).toBe('1.000');
  });
});
