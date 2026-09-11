import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 3 Picking Workflow acceptance (task §74-§78, §85) against real
 * PostgreSQL: barcode scan correctness, wrong-SKU blocking, quantity limits,
 * multi-bin preservation, multi-item completeness and scan concurrency.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3112';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();
const REF = () => randomUUID();

interface IngestResult {
  orderId: string;
  orderNo: string;
  erpStatus: string;
  itemResults: Array<{
    orderItemId: string;
    fulfillmentStatus: string;
    reservationId: string | null;
  }>;
}
interface TaskDetail {
  id: string;
  pickingNo: string;
  status: string;
  warehouseCode: string;
  items: Array<{
    id: string;
    skuCode: string;
    requiredQty: string;
    pickedQty: string;
    status: string;
    primaryBarcode: string | null;
    binLines: Array<{ binCode: string; quantity: string; pickedQty: string }>;
  }>;
}

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';
let binA02 = '';

async function newSku(label: string): Promise<string> {
  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} ${label}商品`,
  });
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
}

async function initialize(skuId: string, binId: string, quantity: string): Promise<void> {
  await client.post('/api/v1/inventory/initialize', {
    skuId,
    warehouseId,
    binId,
    quantity,
    condition: 'SELLABLE',
    referenceType: 'MANUAL',
    referenceId: REF(),
    idempotencyKey: `IT-PICK-INIT:${randomUUID()}`,
  });
}

async function addBarcode(skuId: string, barcode: string): Promise<void> {
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
}

async function mapSku(skuId: string, platformSkuId: string): Promise<void> {
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-PP-${platformSkuId}`,
    skuVariants: [{ skuId, platformSkuId }],
  });
}

async function ingestOrder(
  items: Array<{ platformSkuId: string; quantity: string }>,
): Promise<IngestResult> {
  const result = await client.post<IngestResult>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'new',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    items,
  });
  return result.body.data;
}

async function createAndStartTask(orderId: string): Promise<TaskDetail> {
  const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
    orderId,
  });
  const taskId = created.body.data.tasks[0]!.id;
  await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
  const detail = await client.get<TaskDetail>(`/api/v1/picking-tasks/${taskId}`);
  return detail.body.data;
}

async function balancesOf(
  skuId: string,
): Promise<Array<{ binCode: string; onHandQty: string; reservedQty: string; pickedQty: string }>> {
  const list = await client.get<
    Array<{ binCode: string; onHandQty: string; reservedQty: string; pickedQty: string }>
  >(`/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`);
  return [...list.body.data].sort((a, b) => a.binCode.localeCompare(b.binCode));
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3112', REDIS_URL: 'redis://localhost:6379/7' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-P`,
    name: `${PREFIX} 拣货店`,
  });
  storeId = store.body.data.id;

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-PWH`,
    name: `${PREFIX} 拣货测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 2, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins.find((b) => b.binCode.endsWith('A01-1'))?.id ?? '';
  binA02 = bins.body.data.bins.find((b) => b.binCode.endsWith('A02-1'))?.id ?? '';

  await client.post(`/api/v1/stores/${storeId}/warehouse-bindings`, {
    warehouseId,
    fulfillmentMode: 'OZON_RFBS',
  });
});

afterAll(async () => {
  await api.stop();
});

describe('picking scan workflow (task §74-§78, §85)', () => {
  it('correct scan: Reserved -1 / Picked +1 and picking pickedQty +1 (§74)', async () => {
    const skuId = await newSku('S74');
    const barcode = `${PREFIX}-S74-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, binA01, '5');
    await mapSku(skuId, `${PREFIX}-S74`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-S74`, quantity: '2' }]);

    const task = await createAndStartTask(order.orderId);
    expect(task.items[0]?.requiredQty).toBe('2.000');
    expect(task.items[0]?.primaryBarcode).toBe(barcode);

    const scan = await client.post<{ pickedQty: string; itemStatus: string }>(
      `/api/v1/picking-tasks/${task.id}/scan`,
      { barcode },
    );
    expect(scan.status).toBe(200);
    expect(scan.body.data.pickedQty).toBe('1.000');
    expect(scan.body.data.itemStatus).toBe('PENDING');

    const balances = await balancesOf(skuId);
    expect(balances[0]?.reservedQty).toBe('1.000');
    expect(balances[0]?.pickedQty).toBe('1.000');
    expect(balances[0]?.onHandQty).toBe('5.000');
  });

  it('wrong SKU scan: PICKING_SKU_MISMATCH and inventory untouched (§75)', async () => {
    const skuA = await newSku('S75A');
    const skuB = await newSku('S75B');
    const barcodeA = `${PREFIX}-S75A-BAR`;
    const barcodeB = `${PREFIX}-S75B-BAR`;
    await addBarcode(skuA, barcodeA);
    await addBarcode(skuB, barcodeB);
    await initialize(skuA, binA01, '5');
    await mapSku(skuA, `${PREFIX}-S75A`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-S75A`, quantity: '1' }]);

    const task = await createAndStartTask(order.orderId);
    const before = await balancesOf(skuA);

    const scan = await client.post(`/api/v1/picking-tasks/${task.id}/scan`, {
      barcode: barcodeB,
    });
    expect(scan.status).toBe(422);
    expect(scan.body.error?.code).toBe('PICKING_SKU_MISMATCH');

    const after = await balancesOf(skuA);
    expect(after).toEqual(before);
  });

  it('multi-item completeness: A+B done is not COMPLETED until C is done (§76)', async () => {
    const skuA = await newSku('S76A');
    const skuB = await newSku('S76B');
    const skuC = await newSku('S76C');
    for (const [sku, tag] of [
      [skuA, 'S76A'],
      [skuB, 'S76B'],
      [skuC, 'S76C'],
    ] as const) {
      await addBarcode(sku, `${PREFIX}-${tag}-BAR`);
      await initialize(sku, binA01, '5');
      await mapSku(sku, `${PREFIX}-${tag}`);
    }
    const order = await ingestOrder([
      { platformSkuId: `${PREFIX}-S76A`, quantity: '1' },
      { platformSkuId: `${PREFIX}-S76B`, quantity: '1' },
      { platformSkuId: `${PREFIX}-S76C`, quantity: '1' },
    ]);
    const task = await createAndStartTask(order.orderId);

    await client.post(`/api/v1/picking-tasks/${task.id}/scan`, {
      barcode: `${PREFIX}-S76A-BAR`,
    });
    await client.post(`/api/v1/picking-tasks/${task.id}/scan`, {
      barcode: `${PREFIX}-S76B-BAR`,
    });

    const early = await client.post(`/api/v1/picking-tasks/${task.id}/complete`, {});
    expect(early.status).toBe(409);
    expect(early.body.error?.code).toBe('PICKING_INCOMPLETE');

    const detailMid = await client.get<TaskDetail>(`/api/v1/picking-tasks/${task.id}`);
    expect(detailMid.body.data.status).toBe('IN_PROGRESS');

    const last = await client.post(`/api/v1/picking-tasks/${task.id}/scan`, {
      barcode: `${PREFIX}-S76C-BAR`,
    });
    expect(last.status).toBe(200);

    const detailDone = await client.get<TaskDetail>(`/api/v1/picking-tasks/${task.id}`);
    expect(detailDone.body.data.status).toBe('COMPLETED');
    for (const item of detailDone.body.data.items) {
      expect(item.status).toBe('PICKED');
    }

    const orderDetail = await client.get<{ erpStatus: string }>(`/api/v1/orders/${order.orderId}`);
    expect(orderDetail.body.data.erpStatus).toBe('PICKED');
  });

  it('over-scan rejected: third scan of required 2 fails, pickedQty stays 2 (§77)', async () => {
    const skuMain = await newSku('S77');
    const skuOther = await newSku('S77B');
    const barcode = `${PREFIX}-S77-BAR`;
    await addBarcode(skuMain, barcode);
    await addBarcode(skuOther, `${PREFIX}-S77B-BAR`);
    await initialize(skuMain, binA01, '5');
    await initialize(skuOther, binA01, '5');
    await mapSku(skuMain, `${PREFIX}-S77`);
    await mapSku(skuOther, `${PREFIX}-S77B`);
    // Two lines: the main line completes at 2, the other line keeps the task
    // open so the THIRD scan of the main line hits the quantity guard itself.
    const order = await ingestOrder([
      { platformSkuId: `${PREFIX}-S77`, quantity: '2' },
      { platformSkuId: `${PREFIX}-S77B`, quantity: '1' },
    ]);

    const task = await createAndStartTask(order.orderId);
    for (let i = 0; i < 2; i += 1) {
      const scan = await client.post(`/api/v1/picking-tasks/${task.id}/scan`, { barcode });
      expect(scan.status).toBe(200);
    }
    const third = await client.post(`/api/v1/picking-tasks/${task.id}/scan`, { barcode });
    expect(third.status).toBe(422);
    expect(third.body.error?.code).toBe('PICKING_QUANTITY_EXCEEDED');

    const detail = await client.get<TaskDetail>(`/api/v1/picking-tasks/${task.id}`);
    const mainItem = detail.body.data.items.find((item) => item.status === 'PICKED');
    expect(mainItem?.pickedQty).toBe('2.000');
    expect(detail.body.data.status).toBe('IN_PROGRESS');

    const balances = await balancesOf(skuMain);
    expect(balances[0]?.pickedQty).toBe('2.000');
    expect(balances[0]?.reservedQty).toBe('0.000');
  });

  it('multi-bin reservation preserved as per-bin picking lines (§78)', async () => {
    const skuId = await newSku('S78');
    await addBarcode(skuId, `${PREFIX}-S78-BAR`);
    await initialize(skuId, binA01, '2');
    await initialize(skuId, binA02, '3');
    await mapSku(skuId, `${PREFIX}-S78`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-S78`, quantity: '5' }]);

    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const detail = await client.get<TaskDetail>(
      `/api/v1/picking-tasks/${created.body.data.tasks[0]!.id}`,
    );
    const binLines = detail.body.data.items[0]?.binLines ?? [];
    expect(binLines.length).toBe(2);
    expect(binLines[0]).toMatchObject({
      binCode: expect.stringContaining('A01'),
      quantity: '2.000',
    });
    expect(binLines[1]).toMatchObject({
      binCode: expect.stringContaining('A02'),
      quantity: '3.000',
    });
  });

  it('concurrent scans never exceed requiredQty (§85)', async () => {
    const skuId = await newSku('S85');
    const barcode = `${PREFIX}-S85-BAR`;
    await addBarcode(skuId, barcode);
    await initialize(skuId, binA01, '10');
    await mapSku(skuId, `${PREFIX}-S85`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-S85`, quantity: '3' }]);

    const task = await createAndStartTask(order.orderId);
    const scans = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        client.post(`/api/v1/picking-tasks/${task.id}/scan`, { barcode }),
      ),
    );
    const ok = scans.filter((s) => s.status === 'fulfilled' && s.value.status === 200);
    const rejected = scans.filter((s) => s.status === 'fulfilled' && s.value.status === 422);
    expect(ok.length).toBe(3);
    expect(rejected.length).toBe(2);

    const detail = await client.get<TaskDetail>(`/api/v1/picking-tasks/${task.id}`);
    expect(detail.body.data.items[0]?.pickedQty).toBe('3.000');
    expect(detail.body.data.items[0]?.status).toBe('PICKED');

    const balances = await balancesOf(skuId);
    expect(balances[0]?.pickedQty).toBe('3.000');
    expect(balances[0]?.reservedQty).toBe('0.000');
    expect(balances[0]?.onHandQty).toBe('10.000');
  });

  it('scan before start is rejected with PICKING_TASK_STATE_INVALID', async () => {
    const skuId = await newSku('S86');
    await addBarcode(skuId, `${PREFIX}-S86-BAR`);
    await initialize(skuId, binA01, '5');
    await mapSku(skuId, `${PREFIX}-S86`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-S86`, quantity: '1' }]);

    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: order.orderId,
    });
    const scan = await client.post(`/api/v1/picking-tasks/${created.body.data.tasks[0]!.id}/scan`, {
      barcode: `${PREFIX}-S86-BAR`,
    });
    expect(scan.status).toBe(409);
    expect(scan.body.error?.code).toBe('PICKING_TASK_STATE_INVALID');
  });

  it('picking creation rejects orders without RESERVED lines (§32)', async () => {
    const skuId = await newSku('S87');
    await mapSku(skuId, `${PREFIX}-S87`);
    const order = await ingestOrder([{ platformSkuId: `${PREFIX}-S87`, quantity: '1' }]);
    expect(order.erpStatus).toBe('BACKORDERED');

    const created = await client.post('/api/v1/picking-tasks', { orderId: order.orderId });
    expect(created.status).toBe(422);
    expect(created.body.error?.code).toBe('PICKING_NO_ELIGIBLE_ITEMS');
  });
});
