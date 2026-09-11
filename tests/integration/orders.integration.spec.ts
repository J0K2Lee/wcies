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
