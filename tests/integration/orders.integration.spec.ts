import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 3 Order Core acceptance (task §67-§73, §79-§82, §84) against real
 * PostgreSQL: ingestion, SKU resolution, reservation integration, backorder
 * self-healing, idempotency, cross-store uniqueness and cancellation.
 *
 * Runs on the dedicated wcies_test database; every scenario uses its own
 * SKU / platform order id so nothing leaks between tests.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();

interface IngestItemResult {
  orderItemId: string;
  lineNo: number;
  mappingStatus: string;
  fulfillmentStatus: string;
  skuId: string | null;
  reservationId: string | null;
}
interface IngestResult {
  orderId: string;
  orderNo: string;
  erpStatus: string;
  alreadyIngested: boolean;
  itemResults: IngestItemResult[];
}
interface OrderDetailItem {
  id: string;
  lineNo: number;
  skuId: string | null;
  quantity: string;
  fulfillmentStatus: string;
  mappingStatus: string;
  reservationId: string | null;
  reservation: {
    id: string;
    reservationNo: string;
    status: string;
    lines: Array<{ binCode: string; quantity: string; pickedQty: string }>;
  } | null;
  exceptions: Array<{ exceptionType: string; status: string }>;
}
interface OrderDetail {
  id: string;
  orderNo: string;
  erpStatus: string;
  items: OrderDetailItem[];
  history: Array<{ fromStatus: string | null; toStatus: string; reason: string | null }>;
  interceptions: Array<{
    id: string;
    interceptionNo: string;
    orderItemId: string | null;
    status: string;
  }>;
}
interface BalanceRow {
  skuId: string;
  binCode: string;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
}
interface ExceptionDto {
  id: string;
  exceptionType: string;
  status: string;
  referenceId: string;
}

let ozonPlatformId = '';
let storeA = '';
let storeB = '';
let warehouseId = '';
let binA01 = '';

async function newSku(label: string, serialTracking = false): Promise<string> {
  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} ${label}商品`,
  });
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} ${label}SKU`,
    serialTracking,
  });
  return sku.body.data.id;
}

async function initialize(input: {
  skuId: string;
  binId: string;
  quantity: string;
  serialNumbers?: string[];
}) {
  return client.post('/api/v1/inventory/initialize', {
    skuId: input.skuId,
    warehouseId,
    binId: input.binId,
    quantity: input.quantity,
    serialNumbers: input.serialNumbers,
    condition: 'SELLABLE',
    referenceType: 'MANUAL',
    referenceId: REF(),
    idempotencyKey: `IT-INIT:${randomUUID()}`,
  });
}

async function addBarcode(skuId: string, barcode: string): Promise<void> {
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
}

async function mapSku(skuId: string, platformSkuId: string, store = storeA): Promise<void> {
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId: store,
    platformProductId: `${PREFIX}-PP-${platformSkuId}`,
    skuVariants: [{ skuId, platformSkuId }],
  });
}

async function ingest(input: {
  storeId?: string;
  platformOrderId?: string;
  items: Array<{ platformSkuId?: string; sellerSku?: string; offerId?: string; quantity: string }>;
}) {
  return client.post<IngestResult>('/api/v1/orders/ingest', {
    storeId: input.storeId ?? storeA,
    platformOrderId: input.platformOrderId ?? `PO-${randomUUID()}`,
    platformStatus: 'awaiting_packaging',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    currency: 'RUB',
    items: input.items,
  });
}

async function balanceOf(skuId: string): Promise<BalanceRow[]> {
  const list = await client.get<BalanceRow[]>(
    `/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`,
  );
  return [...list.body.data].sort((a, b) => a.binCode.localeCompare(b.binCode));
}

async function orderDetail(orderId: string): Promise<OrderDetail> {
  const response = await client.get<OrderDetail>(`/api/v1/orders/${orderId}`);
  return response.body.data;
}

async function openExceptionsOf(referenceId: string): Promise<ExceptionDto[]> {
  const list = await client.get<ExceptionDto[]>(
    `/api/v1/exceptions?referenceType=ORDER_ITEM&referenceId=${referenceId}&status=OPEN&pageSize=100`,
  );
  return list.body.data;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  const storeAresp = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-A`,
    name: `${PREFIX} A店`,
  });
  storeA = storeAresp.body.data.id;
  const storeBresp = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-B`,
    name: `${PREFIX} B店`,
  });
  storeB = storeBresp.body.data.id;

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 订单测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 2, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins.find((b) => b.binCode.endsWith('A01-1'))?.id ?? '';

  for (const storeId of [storeA, storeB]) {
    await client.post(`/api/v1/stores/${storeId}/warehouse-bindings`, {
      warehouseId,
      fulfillmentMode: 'OZON_RFBS',
    });
  }
});

afterAll(async () => {
  await api.stop();
});

describe('order ingestion + allocation (task §67-§73)', () => {
  it('normal order: line RESERVED, inventory reserved +2, order READY_TO_PICK (§67)', async () => {
    const skuId = await newSku('OK');
    await initialize({ skuId, binId: binA01, quantity: '10' });
    await mapSku(skuId, `${PREFIX}-OK-1`);

    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-OK-1`, quantity: '2' }] });
    const body = result.body.data;
    expect(result.status).toBe(200);
    expect(body.alreadyIngested).toBe(false);
    expect(body.erpStatus).toBe('READY_TO_PICK');
    expect(body.itemResults[0]?.fulfillmentStatus).toBe('RESERVED');
    expect(body.itemResults[0]?.mappingStatus).toBe('MAPPED');

    const balances = await balanceOf(skuId);
    expect(balances[0]?.onHandQty).toBe('10.000');
    expect(balances[0]?.reservedQty).toBe('2.000');

    const detail = await orderDetail(body.orderId);
    expect(detail.history.map((h) => h.toStatus)).toContain('NEW');
    expect(detail.history.map((h) => h.toStatus)).toContain('READY_TO_PICK');
  });

  it('out of stock: order saved, line BACKORDERED, inventory unchanged, exception (§68)', async () => {
    const skuId = await newSku('OOS');
    await initialize({ skuId, binId: binA01, quantity: '1' });
    await mapSku(skuId, `${PREFIX}-OOS-1`);

    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-OOS-1`, quantity: '2' }] });
    const body = result.body.data;
    expect(body.erpStatus).toBe('BACKORDERED');
    expect(body.itemResults[0]?.fulfillmentStatus).toBe('BACKORDERED');

    const balances = await balanceOf(skuId);
    expect(balances[0]?.reservedQty).toBe('0.000');
    expect(balances[0]?.onHandQty).toBe('1.000');

    const exceptions = await openExceptionsOf(body.itemResults[0]!.orderItemId);
    expect(exceptions.some((e) => e.exceptionType === 'ORDER_OUT_OF_STOCK')).toBe(true);
  });

  it('partial stock: A RESERVED stays, B BACKORDERED, order survives (§69)', async () => {
    const skuA = await newSku('PA');
    const skuB = await newSku('PB');
    await initialize({ skuId: skuA, binId: binA01, quantity: '5' });
    await mapSku(skuA, `${PREFIX}-PA-1`);
    await mapSku(skuB, `${PREFIX}-PB-1`);

    const result = await ingest({
      items: [
        { platformSkuId: `${PREFIX}-PA-1`, quantity: '1' },
        { platformSkuId: `${PREFIX}-PB-1`, quantity: '1' },
      ],
    });
    const body = result.body.data;
    expect(body.erpStatus).toBe('PARTIALLY_BACKORDERED');
    expect(body.itemResults[0]?.fulfillmentStatus).toBe('RESERVED');
    expect(body.itemResults[1]?.fulfillmentStatus).toBe('BACKORDERED');

    const balances = await balanceOf(skuA);
    expect(balances[0]?.reservedQty).toBe('1.000');
  });

  it('mapping failure: line FAILED with skuId null + exception, other line still reserves (§70/§17)', async () => {
    const skuA = await newSku('MF');
    await initialize({ skuId: skuA, binId: binA01, quantity: '5' });
    await mapSku(skuA, `${PREFIX}-MF-1`);

    const result = await ingest({
      items: [
        { platformSkuId: `${PREFIX}-UNKNOWN-SKU`, quantity: '1' },
        { platformSkuId: `${PREFIX}-MF-1`, quantity: '1' },
      ],
    });
    const body = result.body.data;
    const failed = body.itemResults.find((r) => r.mappingStatus === 'FAILED');
    const mapped = body.itemResults.find((r) => r.mappingStatus === 'MAPPED');
    expect(failed).toBeDefined();
    expect(failed?.skuId).toBeNull();
    expect(mapped?.fulfillmentStatus).toBe('RESERVED');
    // Mapping failed line carries the exception; the order keeps its rollup.
    const exceptions = await openExceptionsOf(failed!.orderItemId);
    expect(exceptions.some((e) => e.exceptionType === 'ORDER_SKU_MAPPING_FAILED')).toBe(true);
    expect(body.erpStatus).toBe('READY_TO_PICK');
  });

  it('ingest idempotency: 10 repeats -> one order, one reservation, one event set (§71)', async () => {
    const skuId = await newSku('IDEM');
    await initialize({ skuId, binId: binA01, quantity: '10' });
    await mapSku(skuId, `${PREFIX}-IDEM-1`);
    const platformOrderId = `PO-IDEM-${randomUUID()}`;

    let first: IngestResult | undefined;
    for (let i = 0; i < 10; i += 1) {
      const result = await ingest({
        platformOrderId,
        items: [{ platformSkuId: `${PREFIX}-IDEM-1`, quantity: '3' }],
      });
      if (i === 0) {
        first = result.body.data;
        expect(result.body.data.alreadyIngested).toBe(false);
      } else {
        expect(result.body.data.alreadyIngested).toBe(true);
        expect(result.body.data.orderId).toBe(first!.orderId);
      }
    }

    const list = await client.get<{ id: string }[]>(
      `/api/v1/orders?keyword=${platformOrderId}&pageSize=10`,
    );
    expect(list.body.data.filter((o) => o.id === first!.orderId).length).toBe(1);

    const balances = await balanceOf(skuId);
    expect(balances[0]?.reservedQty).toBe('3.000');

    const transactions = await client.get<{ eventNo: string }[]>(
      `/api/v1/inventory/transactions?referenceType=ORDER&referenceId=${first!.itemResults[0]!.orderItemId}&pageSize=100`,
    );
    expect(transactions.body.data.length).toBe(1);
  });

  it('cross-store same platformOrderId -> two independent orders (§72)', async () => {
    const skuA = await newSku('XS1');
    const skuB = await newSku('XS2');
    await initialize({ skuId: skuA, binId: binA01, quantity: '5' });
    await initialize({ skuId: skuB, binId: binA01, quantity: '5' });
    await mapSku(skuA, `${PREFIX}-XS1`);
    await mapSku(skuB, `${PREFIX}-XS2`, storeB);

    const platformOrderId = `PO-XS-${randomUUID()}`;
    const orderA = await ingest({
      storeId: storeA,
      platformOrderId,
      items: [{ platformSkuId: `${PREFIX}-XS1`, quantity: '1' }],
    });
    const orderB = await ingest({
      storeId: storeB,
      platformOrderId,
      items: [{ platformSkuId: `${PREFIX}-XS2`, quantity: '1' }],
    });
    expect(orderA.body.data.orderId).not.toBe(orderB.body.data.orderId);
    expect(orderA.body.data.alreadyIngested).toBe(false);
    expect(orderB.body.data.alreadyIngested).toBe(false);
  });

  it('backorder self-healing: restock + retry -> RESERVED, exception resolved, status recalculated (§73)', async () => {
    const skuId = await newSku('HEAL');
    await initialize({ skuId, binId: binA01, quantity: '1' });
    await mapSku(skuId, `${PREFIX}-HEAL-1`);

    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-HEAL-1`, quantity: '2' }] });
    const item = result.body.data.itemResults[0]!;
    expect(item.fulfillmentStatus).toBe('BACKORDERED');

    await client.post('/api/v1/inventory/receive', {
      skuId,
      warehouseId,
      binId: binA01,
      quantity: '5',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `IT-RECV:${randomUUID()}`,
    });

    const retry = await client.post<{ fulfillmentStatus: string; reserved: boolean }>(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(retry.body.data.reserved).toBe(true);
    expect(retry.body.data.fulfillmentStatus).toBe('RESERVED');

    const exceptions = await client.get<ExceptionDto[]>(
      `/api/v1/exceptions?referenceType=ORDER_ITEM&referenceId=${item.orderItemId}&pageSize=100`,
    );
    const open = exceptions.body.data.filter((e) => e.status === 'OPEN');
    expect(open.length).toBe(0);

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.erpStatus).toBe('READY_TO_PICK');
  });

  it('retry while still short keeps BACKORDERED without exception spam (task §24)', async () => {
    const skuId = await newSku('SHORT');
    await initialize({ skuId, binId: binA01, quantity: '1' });
    await mapSku(skuId, `${PREFIX}-SHORT-1`);
    const result = await ingest({
      items: [{ platformSkuId: `${PREFIX}-SHORT-1`, quantity: '3' }],
    });
    const item = result.body.data.itemResults[0]!;
    const retry = await client.post<{ reserved: boolean }>(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(retry.body.data.reserved).toBe(false);
    const exceptions = await client.get<ExceptionDto[]>(
      `/api/v1/exceptions?referenceType=ORDER_ITEM&referenceId=${item.orderItemId}&pageSize=100`,
    );
    expect(
      exceptions.body.data.filter((e) => e.exceptionType === 'ORDER_OUT_OF_STOCK').length,
    ).toBe(1);
  });

  it('mapping repair after FAILED: retry re-resolves the line and closes the exception', async () => {
    // The line arrives before any mapping exists -> FAILED + exception.
    const skuId = await newSku('REPAIR');
    await initialize({ skuId, binId: binA01, quantity: '5' });
    const result = await ingest({
      items: [{ platformSkuId: `${PREFIX}-REPAIR-1`, quantity: '1' }],
    });
    const item = result.body.data.itemResults[0]!;
    expect(item.mappingStatus).toBe('FAILED');

    // Without a repair the retry must stay a no-op that reports the reason.
    const stillFailed = await client.post(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(stillFailed.status).toBe(409);
    expect(stillFailed.body.error?.code).toBe('ORDER_INVALID_STATE');

    // Human repairs the mapping in the SKU workbench ...
    await mapSku(skuId, `${PREFIX}-REPAIR-1`);

    // ... and the retry must pick the repair up: FAILED is not a dead end.
    const retry = await client.post<{ reserved: boolean; fulfillmentStatus: string }>(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(retry.status).toBe(200);
    expect(retry.body.data.reserved).toBe(true);
    expect(retry.body.data.fulfillmentStatus).toBe('RESERVED');

    const exceptions = await client.get<ExceptionDto[]>(
      `/api/v1/exceptions?referenceType=ORDER_ITEM&referenceId=${item.orderItemId}&pageSize=100`,
    );
    expect(exceptions.body.data.filter((e) => e.status === 'OPEN').length).toBe(0);

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.erpStatus).toBe('READY_TO_PICK');
  });

  it('mapping repair with no stock: retry records BACKORDERED, not a stuck PENDING', async () => {
    const skuId = await newSku('REPAIR2');
    // No inventory initialized for this SKU.
    const result = await ingest({
      items: [{ platformSkuId: `${PREFIX}-REPAIR2-1`, quantity: '1' }],
    });
    const item = result.body.data.itemResults[0]!;
    expect(item.mappingStatus).toBe('FAILED');

    await mapSku(skuId, `${PREFIX}-REPAIR2-1`);
    const retry = await client.post<{ reserved: boolean; fulfillmentStatus: string }>(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(retry.status).toBe(200);
    expect(retry.body.data.reserved).toBe(false);
    // A repaired line starts from PENDING, so a failed reservation must be
    // recorded as BACKORDERED - staying PENDING would hide the stock problem.
    expect(retry.body.data.fulfillmentStatus).toBe('BACKORDERED');

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.erpStatus).toBe('BACKORDERED');
  });

  it('concurrent duplicate ingest -> exactly one order (§84)', async () => {
    const skuId = await newSku('RACE');
    await initialize({ skuId, binId: binA01, quantity: '10' });
    await mapSku(skuId, `${PREFIX}-RACE-1`);
    const platformOrderId = `PO-RACE-${randomUUID()}`;

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        ingest({ platformOrderId, items: [{ platformSkuId: `${PREFIX}-RACE-1`, quantity: '1' }] }),
      ),
    );
    const ids = new Set(results.map((r) => r.body.data.orderId));
    expect(ids.size).toBe(1);
    const balances = await balanceOf(skuId);
    expect(balances[0]?.reservedQty).toBe('1.000');
  });
});

describe('cancellation (task §79-§82)', () => {
  it('reserved cancel releases stock and releases the line (§79)', async () => {
    const skuId = await newSku('CXL');
    await initialize({ skuId, binId: binA01, quantity: '5' });
    await mapSku(skuId, `${PREFIX}-CXL-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-CXL-1`, quantity: '2' }] });

    const cancel = await client.post<{ erpStatus: string; releasedItems: number }>(
      `/api/v1/orders/${result.body.data.orderId}/cancel`,
      { reason: 'integration cancel' },
    );
    expect(cancel.body.data.erpStatus).toBe('CANCELLED');
    expect(cancel.body.data.releasedItems).toBe(1);

    const balances = await balanceOf(skuId);
    expect(balances[0]?.reservedQty).toBe('0.000');
    expect(balances[0]?.onHandQty).toBe('5.000');

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.items[0]?.fulfillmentStatus).toBe('RELEASED');
    expect(detail.history.map((h) => h.toStatus)).toContain('CANCELLED');
  });

  it('backordered cancel touches no stock (§80)', async () => {
    const skuId = await newSku('CXB');
    await mapSku(skuId, `${PREFIX}-CXB-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-CXB-1`, quantity: '1' }] });
    expect(result.body.data.erpStatus).toBe('BACKORDERED');

    const cancel = await client.post<{ releasedItems: number }>(
      `/api/v1/orders/${result.body.data.orderId}/cancel`,
    );
    expect(cancel.status).toBe(200);
    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.items[0]?.fulfillmentStatus).toBe('RELEASED');
    // No reservation was ever created -> no transactions for this item.
    const transactions = await client.get<{ eventNo: string }[]>(
      `/api/v1/inventory/transactions?referenceType=ORDER&referenceId=${detail.items[0]!.id}&pageSize=100`,
    );
    expect(transactions.body.data.length).toBe(0);
  });

  it('picked cancel keeps picked stock and creates an interception (§81)', async () => {
    const skuId = await newSku('CXP');
    await addBarcode(skuId, `${PREFIX}-CXP-BAR`);
    await initialize({ skuId, binId: binA01, quantity: '3' });
    await mapSku(skuId, `${PREFIX}-CXP-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-CXP-1`, quantity: '1' }] });
    const item = result.body.data.itemResults[0]!;

    // Pick through the real workflow so the order line itself becomes PICKED.
    const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: result.body.data.orderId,
    });
    const taskId = task.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, {
      barcode: `${PREFIX}-CXP-BAR`,
    });
    expect(scan.status).toBe(200);

    const balancesBefore = await balanceOf(skuId);
    const cancel = await client.post<{ interceptions: number }>(
      `/api/v1/orders/${result.body.data.orderId}/cancel`,
      { reason: 'customer cancel after pick' },
    );
    expect(cancel.body.data.interceptions).toBe(1);

    // Picked stock must NOT be restored (no Reserved +N, no availability back).
    const balancesAfter = await balanceOf(skuId);
    expect(balancesAfter[0]?.pickedQty).toBe('1.000');
    expect(balancesAfter[0]?.reservedQty).toBe(balancesBefore[0]?.reservedQty);
    expect(balancesAfter[0]?.onHandQty).toBe(balancesBefore[0]?.onHandQty);

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.items[0]?.fulfillmentStatus).toBe('PICKED');
    expect(detail.interceptions.length).toBe(1);
    expect(detail.interceptions[0]?.status).toBe('CREATED');
    expect(detail.interceptions[0]?.orderItemId).toBe(item.orderItemId);
  });

  it('cancel while picking has progress is rejected with ORDER_INVALID_STATE', async () => {
    const skuId = await newSku('CXM');
    await addBarcode(skuId, `${PREFIX}-CXM-BAR`);
    await initialize({ skuId, binId: binA01, quantity: '5' });
    await mapSku(skuId, `${PREFIX}-CXM-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-CXM-1`, quantity: '2' }] });

    const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: result.body.data.orderId,
    });
    const taskId = task.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode: `${PREFIX}-CXM-BAR` });

    const cancel = await client.post(`/api/v1/orders/${result.body.data.orderId}/cancel`, {
      reason: 'mid-picking',
    });
    expect(cancel.status).toBe(409);
    expect(cancel.body.error?.code).toBe('ORDER_INVALID_STATE');
  });

  it('every major transition leaves order_status_history rows (§82)', async () => {
    const skuId = await newSku('HIST');
    await initialize({ skuId, binId: binA01, quantity: '5' });
    await mapSku(skuId, `${PREFIX}-HIST-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-HIST-1`, quantity: '1' }] });
    await client.post(`/api/v1/orders/${result.body.data.orderId}/cancel`, {});
    const detail = await orderDetail(result.body.data.orderId);
    const transitions = detail.history.map((h) => `${h.fromStatus}->${h.toStatus}`);
    expect(transitions).toContain('null->NEW');
    expect(transitions).toContain('NEW->READY_TO_PICK');
    expect(transitions).toContain('READY_TO_PICK->CANCELLED');
  });
});

describe('serial tracking in ingestion (S3-SN)', () => {
  it('serial-tracked SKU reserves serials and picking scans them one by one', async () => {
    const skuId = await newSku('SN1', true);
    await addBarcode(skuId, `${PREFIX}-SN1-BAR`);
    const serials = ['SN-A', 'SN-B'].map((s) => `${PREFIX}-${s}`);
    await initialize({
      skuId,
      binId: binA01,
      quantity: '2',
      serialNumbers: serials,
    });
    await mapSku(skuId, `${PREFIX}-SN1-1`);

    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-SN1-1`, quantity: '2' }] });
    expect(result.body.data.erpStatus).toBe('READY_TO_PICK');

    const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: result.body.data.orderId,
    });
    const taskId = task.body.data.tasks[0]!.id;
    const detailStart = await client.get<{
      items: Array<{ id: string; serialTracking: boolean; pendingSerialNumbers: string[] }>;
    }>(`/api/v1/picking-tasks/${taskId}`);
    expect(detailStart.body.data.items[0]?.serialTracking).toBe(true);
    expect(detailStart.body.data.items[0]?.pendingSerialNumbers.sort()).toEqual(
      [...serials].sort(),
    );

    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    // Scan without SN is rejected.
    const noSn = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, {
      barcode: `${PREFIX}-SN1-BAR`,
    });
    expect(noSn.status).toBe(422);
    expect(noSn.body.error?.code).toBe('PICKING_SERIAL_REQUIRED');

    // Wrong SN is rejected.
    const wrongSn = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, {
      barcode: `${PREFIX}-SN1-BAR`,
      serialNumber: 'SN-NOT-MINE',
    });
    expect(wrongSn.status).toBe(422);
    expect(wrongSn.body.error?.code).toBe('PICKING_SERIAL_INVALID');

    // Both serials pick through.
    for (const sn of serials) {
      const scan = await client.post<{ itemStatus: string }>(
        `/api/v1/picking-tasks/${taskId}/scan`,
        { barcode: `${PREFIX}-SN1-BAR`, serialNumber: sn },
      );
      expect(scan.status).toBe(200);
    }
    const taskDone = await client.get<{ status: string }>(`/api/v1/picking-tasks/${taskId}`);
    expect(taskDone.body.data.status).toBe('COMPLETED');

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.items[0]?.fulfillmentStatus).toBe('PICKED');
    expect(detail.erpStatus).toBe('PICKED');
  });

  it('initialize rejects serial count mismatch (task §44)', async () => {
    const skuId = await newSku('SN2', true);
    const bad = await client.post('/api/v1/inventory/initialize', {
      skuId,
      warehouseId,
      binId: binA01,
      quantity: '2',
      serialNumbers: ['ONLY-ONE'],
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `IT-SN2:${randomUUID()}`,
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error?.code).toBe('INVENTORY_SERIAL_INVALID');
  });
});

describe('shipment deadline (Sprint 7 task §8)', () => {
  it('ingests a deadline that is returned by list and detail; far deadline raises no exception', async () => {
    const skuId = await newSku('DL1');
    await initialize({ skuId, binId: binA01, quantity: '5' });
    await mapSku(skuId, `${PREFIX}-DL-1`);

    const deadline = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const result = await client.post<IngestResult>('/api/v1/orders/ingest', {
      storeId: storeA,
      platformOrderId: `PO-${randomUUID()}`,
      platformStatus: 'awaiting_packaging',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      shipmentDeadline: deadline.toISOString(),
      currency: 'RUB',
      items: [{ platformSkuId: `${PREFIX}-DL-1`, quantity: '1' }],
    });
    expect(result.status, JSON.stringify(result.body.error ?? {})).toBe(200);
    const orderId = result.body.data.orderId;

    const detail = await client.get<OrderDetail & { shipmentDeadline: string | null }>(
      `/api/v1/orders/${orderId}`,
    );
    expect(detail.body.data.shipmentDeadline).not.toBeNull();
    expect(new Date(detail.body.data.shipmentDeadline as string).getTime()).toBe(
      deadline.getTime(),
    );

    const list = await client.get<Array<{ id: string; shipmentDeadline: string | null }>>(
      `/api/v1/orders?keyword=&pageSize=100`,
    );
    const row = list.body.data.find((o) => o.id === orderId);
    expect(row?.shipmentDeadline).not.toBeNull();

    // Far deadline: no exception (orders.md §16 - only <24h or overdue).
    const exceptions = await client.get<ExceptionDto[]>(
      `/api/v1/exceptions?referenceType=ORDER&referenceId=${orderId}&status=OPEN&pageSize=100`,
    );
    expect(
      exceptions.body.data.some((e) => e.exceptionType === 'ORDER_SHIPMENT_DEADLINE_NEAR'),
    ).toBe(false);
  });

  it('a near deadline (<24h) raises ORDER_SHIPMENT_DEADLINE_NEAR; overdue is HIGH severity', async () => {
    const skuId = await newSku('DL2');
    await initialize({ skuId, binId: binA01, quantity: '5' });
    await mapSku(skuId, `${PREFIX}-DL-2`);

    const ingestNear = await client.post<IngestResult>('/api/v1/orders/ingest', {
      storeId: storeA,
      platformOrderId: `PO-${randomUUID()}`,
      orderedAt: new Date().toISOString(),
      shipmentDeadline: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      items: [{ platformSkuId: `${PREFIX}-DL-2`, quantity: '1' }],
    });
    const nearId = ingestNear.body.data.orderId;
    const nearExceptions = await client.get<Array<ExceptionDto & { severity: string }>>(
      `/api/v1/exceptions?referenceType=ORDER&referenceId=${nearId}&status=OPEN&pageSize=100`,
    );
    const near = nearExceptions.body.data.find(
      (e) => e.exceptionType === 'ORDER_SHIPMENT_DEADLINE_NEAR',
    );
    expect(near).toBeDefined();
    expect(near?.severity).toBe('MEDIUM');

    const ingestOverdue = await client.post<IngestResult>('/api/v1/orders/ingest', {
      storeId: storeA,
      platformOrderId: `PO-${randomUUID()}`,
      orderedAt: new Date().toISOString(),
      shipmentDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      items: [{ platformSkuId: `${PREFIX}-DL-2`, quantity: '1' }],
    });
    const overdueExceptions = await client.get<Array<ExceptionDto & { severity: string }>>(
      `/api/v1/exceptions?referenceType=ORDER&referenceId=${ingestOverdue.body.data.orderId}&status=OPEN&pageSize=100`,
    );
    const overdue = overdueExceptions.body.data.find(
      (e) => e.exceptionType === 'ORDER_SHIPMENT_DEADLINE_NEAR',
    );
    expect(overdue?.severity).toBe('HIGH');

    // Cancelling the overdue order auto-resolves its deadline exception.
    await client.post(`/api/v1/orders/${ingestOverdue.body.data.orderId}/cancel`, {
      reason: 'test cancel',
    });
    const afterCancel = await client.get<ExceptionDto[]>(
      `/api/v1/exceptions?referenceType=ORDER&referenceId=${ingestOverdue.body.data.orderId}&status=OPEN&pageSize=100`,
    );
    expect(
      afterCancel.body.data.some((e) => e.exceptionType === 'ORDER_SHIPMENT_DEADLINE_NEAR'),
    ).toBe(false);
  });
});

describe('dual-axis list contract: stage + goodsState filters (T3)', () => {
  interface ListItem {
    id: string;
    erpStatus: string;
    backorderedOrderedCount: number;
    backorderedArrivedCount: number;
  }

  /** List with the dual-axis filters, scoped to one order via keyword. */
  async function listOne(orderId: string, query: string): Promise<{ hit: boolean }> {
    const detail = await orderDetail(orderId);
    const list = await client.get<ListItem[]>(
      `/api/v1/orders?keyword=${encodeURIComponent(detail.platformOrderId)}&${query}&pageSize=10`,
    );
    return { hit: list.body.data.some((row) => row.id === orderId) };
  }

  async function ingestWith(options: {
    items: Array<{ platformSkuId: string; quantity: string }>;
    shipmentDeadline?: string;
  }) {
    const result = await client.post<IngestResult>('/api/v1/orders/ingest', {
      storeId: storeA,
      platformOrderId: `PO-${randomUUID()}`,
      platformStatus: 'awaiting_packaging',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      currency: 'RUB',
      ...(options.shipmentDeadline !== undefined
        ? { shipmentDeadline: options.shipmentDeadline }
        : {}),
      items: options.items,
    });
    expect(result.status, JSON.stringify(result.body.error ?? {})).toBe(200);
    return result.body.data;
  }

  it('stage=PENDING covers reserved / backordered / mapping-failed orders; shipped leaves it', async () => {
    // Reserved order.
    const skuR = await newSku('AXR');
    await initialize({ skuId: skuR, binId: binA01, quantity: '5' });
    await mapSku(skuR, `${PREFIX}-AXR-1`);
    const reserved = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-AXR-1`, quantity: '1' }],
    });

    // Backordered order.
    const skuB = await newSku('AXB');
    await mapSku(skuB, `${PREFIX}-AXB-1`);
    const backordered = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-AXB-1`, quantity: '1' }],
    });

    // Mapping-failed order.
    const mappedFail = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-NO-SUCH-MAPPING`, quantity: '1' }],
    });

    expect((await listOne(reserved.orderId, 'stage=PENDING')).hit).toBe(true);
    expect((await listOne(backordered.orderId, 'stage=PENDING')).hit).toBe(true);
    expect((await listOne(mappedFail.orderId, 'stage=PENDING')).hit).toBe(true);

    // Externally fulfilled -> erp SHIPPED, platform stage NULL -> NOT pending,
    // and stage=IN_TRANSIT catches it (NULL stage counts as not delivered).
    const closed = await client.post(
      `/api/v1/orders/${backordered.orderId}/mark-external-fulfillment`,
      { reason: '双轴测试：外部履约' },
    );
    expect(closed.status).toBe(200);
    expect((await listOne(backordered.orderId, 'stage=PENDING')).hit).toBe(false);
    expect((await listOne(backordered.orderId, 'stage=IN_TRANSIT')).hit).toBe(true);
    expect((await listOne(reserved.orderId, 'stage=IN_TRANSIT')).hit).toBe(false);
    expect((await listOne(reserved.orderId, 'stage=COMPLETED')).hit).toBe(false);
  });

  it('goodsState chips resolve line-level facts hidden by the rollup status', async () => {
    const skuT = await newSku('AXT');
    await addBarcode(skuT, `${PREFIX}-AXT-BAR`);
    await initialize({ skuId: skuT, binId: binA01, quantity: '5' });
    await mapSku(skuT, `${PREFIX}-AXT-1`);
    const skuU = await newSku('AXU');
    await addBarcode(skuU, `${PREFIX}-AXU-BAR`);
    await initialize({ skuId: skuU, binId: binA01, quantity: '5' });
    await mapSku(skuU, `${PREFIX}-AXU-1`);
    const toPick = await ingestWith({
      items: [
        { platformSkuId: `${PREFIX}-AXT-1`, quantity: '1' },
        { platformSkuId: `${PREFIX}-AXU-1`, quantity: '1' },
      ],
    });
    expect((await listOne(toPick.orderId, 'goodsState=TO_PICK')).hit).toBe(true);

    const failed = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-NO-SUCH-2`, quantity: '1' }],
    });
    expect((await listOne(failed.orderId, 'goodsState=MAPPING_FAILED')).hit).toBe(true);
    expect((await listOne(failed.orderId, 'goodsState=ABNORMAL')).hit).toBe(true);

    const skuD = await newSku('AXD');
    await mapSku(skuD, `${PREFIX}-AXD-1`);
    const overdue = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-AXD-1`, quantity: '1' }],
      shipmentDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    expect((await listOne(overdue.orderId, 'goodsState=BACKORDERED')).hit).toBe(true);
    expect((await listOne(overdue.orderId, 'goodsState=SHIPMENT_OVERDUE')).hit).toBe(true);
    expect((await listOne(overdue.orderId, 'goodsState=ABNORMAL')).hit).toBe(true);
    expect((await listOne(toPick.orderId, 'goodsState=BACKORDERED')).hit).toBe(false);

    // PICKING: completing line 1 while line 2 is still being picked rolls the
    // order up to PICKING (orders.md §7 rule 3 - derived from OPEN picking
    // items at recompute time). Line 2 stays RESERVED, so TO_PICK may hit
    // simultaneously - by design (orders.md §17b).
    const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: toPick.orderId,
    });
    expect([200, 201]).toContain(task.status);
    const taskId = task.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    const firstScan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, {
      barcode: `${PREFIX}-AXT-BAR`,
    });
    expect(firstScan.status, JSON.stringify(firstScan.body.error ?? {})).toBe(200);
    expect((await listOne(toPick.orderId, 'goodsState=PICKING')).hit).toBe(true);
    expect((await listOne(toPick.orderId, 'goodsState=TO_PICK')).hit).toBe(true);

    // Complete line 2 -> all lines PICKED -> TO_SHIP, no longer PICKING.
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, {
      barcode: `${PREFIX}-AXU-BAR`,
    });
    expect((await listOne(toPick.orderId, 'goodsState=TO_SHIP')).hit).toBe(true);
    expect((await listOne(toPick.orderId, 'goodsState=PICKING')).hit).toBe(false);
  });

  it('SHIPMENT_OVERDUE hits a PARTIALLY_SHIPPED order with an unshipped remainder', async () => {
    // Two lines: line 1 stocked (picked + shipped), line 2 backordered. The
    // rollup becomes PARTIALLY_SHIPPED while the overdue deadline still
    // applies - exactly the case a single status filter can never express.
    const skuS = await newSku('AXS');
    await addBarcode(skuS, `${PREFIX}-AXS-BAR`);
    await initialize({ skuId: skuS, binId: binA01, quantity: '5' });
    await mapSku(skuS, `${PREFIX}-AXS-1`);
    const skuR = await newSku('AXR2');
    await mapSku(skuR, `${PREFIX}-AXR2-1`);

    const order = await ingestWith({
      items: [
        { platformSkuId: `${PREFIX}-AXS-1`, quantity: '1' },
        { platformSkuId: `${PREFIX}-AXR2-1`, quantity: '1' },
      ],
      shipmentDeadline: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    expect(order.erpStatus).toBe('PARTIALLY_BACKORDERED');

    // Pick + pack + ship ONLY line 1 (line 2 has no stock, never reserved).
    const pickTask = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const taskId = pickTask.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode: `${PREFIX}-AXS-BAR` });

    const shipmentCreated = await client.post<{ shipments: Array<{ id: string }> }>(
      '/api/v1/shipments',
      { orderId: order.orderId },
    );
    const shipmentId = shipmentCreated.body.data.shipments[0]!.id;
    const packageCreated = await client.post<{ packageId: string }>(
      `/api/v1/shipments/${shipmentId}/packages`,
      {},
    );
    await client.post(`/api/v1/packages/${packageCreated.body.data.packageId}/items/scan`, {
      barcode: `${PREFIX}-AXS-BAR`,
    });
    await client.post(`/api/v1/packages/${packageCreated.body.data.packageId}/seal`, {});
    const ship = await client.post(`/api/v1/shipments/${shipmentId}/ship`, {});
    expect(ship.status, JSON.stringify(ship.body.error ?? {})).toBe(200);

    const detail = await orderDetail(order.orderId);
    expect(detail.erpStatus).toBe('PARTIALLY_SHIPPED');
    expect((await listOne(order.orderId, 'goodsState=SHIPMENT_OVERDUE')).hit).toBe(true);
    expect((await listOne(order.orderId, 'goodsState=BACKORDERED')).hit).toBe(true);
    expect((await listOne(order.orderId, 'stage=PENDING')).hit).toBe(true);
  });

  it('backorderedOrderedCount / backorderedArrivedCount follow the purchase lifecycle', async () => {
    const skuP = await newSku('AXP');
    await mapSku(skuP, `${PREFIX}-AXP-1`);
    const order = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-AXP-1`, quantity: '2' }],
    });
    expect(order.erpStatus).toBe('BACKORDERED');

    const detail = await orderDetail(order.orderId);
    const listBefore = await client.get<ListItem[]>(
      `/api/v1/orders?keyword=${encodeURIComponent(detail.platformOrderId)}&pageSize=10`,
    );
    expect(listBefore.body.data[0]?.backorderedOrderedCount).toBe(0);
    expect(listBefore.body.data[0]?.backorderedArrivedCount).toBe(0);

    const po = await client.post<{ id: string }>('/api/v1/purchase-orders', {
      sourceNote: '双轴测试 采购登记',
      items: [{ skuId: skuP, orderItemId: order.itemResults[0]!.orderItemId, quantity: '2' }],
    });
    expect(po.status, JSON.stringify(po.body.error ?? {})).toBe(200);

    const listOrdered = await client.get<ListItem[]>(
      `/api/v1/orders?keyword=${encodeURIComponent(detail.platformOrderId)}&pageSize=10`,
    );
    expect(listOrdered.body.data[0]?.backorderedOrderedCount).toBe(1);
    expect(listOrdered.body.data[0]?.backorderedArrivedCount).toBe(0);

    const receipt = await client.post<{ id: string }>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA01 },
    );
    expect(receipt.status, JSON.stringify(receipt.body.error ?? {})).toBe(200);
    const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
    expect(confirm.status, JSON.stringify(confirm.body.error ?? {})).toBe(200);

    const listArrived = await client.get<ListItem[]>(
      `/api/v1/orders?keyword=${encodeURIComponent(detail.platformOrderId)}&pageSize=10`,
    );
    expect(listArrived.body.data[0]?.backorderedOrderedCount).toBe(0);
    expect(listArrived.body.data[0]?.backorderedArrivedCount).toBe(1);
  });
});
