import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 7 T7 end-to-end acceptance against real PostgreSQL - the two
 * business chains the user asked to see proven (task §14):
 *
 *  Chain A (stock-first):  receive -> sell -> reserve -> pick -> ship.
 *  Chain B (sell-first, the main mode): order backorders -> register PO
 *    (duplicate refused) -> receive from PO -> retry allocation -> pick
 *    -> ship.
 *
 * The assertions focus on the SEAMS this sprint added: stock produced by
 * receipts must be consumable by orders (bin placement, sellable
 * availability, scanner finds it), and the ledger must trace every unit
 * back to its receipt document.
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binA01 = '';

async function newSku(label: string): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
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

async function balanceRows(
  skuId: string,
): Promise<Array<{ binCode: string; onHandQty: string; reservedQty: string; pickedQty: string }>> {
  // includeEmpty=true: this spec deliberately observes rows that shipping drove
  // to zero (onHand/reserved/picked all 0); the inventory list hides those by
  // default since 2026-10-15 (commit 9aa71e3).
  const list = await client.get<
    Array<{ binCode: string; onHandQty: string; reservedQty: string; pickedQty: string }>
  >(`/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&includeEmpty=true&pageSize=100`);
  return [...list.body.data].sort((a, b) => a.binCode.localeCompare(b.binCode));
}

async function ingestOrder(input: {
  platformSkuId: string;
  quantity: string;
  shipmentDeadline?: string;
}): Promise<{ orderId: string; orderItemId: string; erpStatus: string }> {
  const result = await client.post<{
    orderId: string;
    erpStatus: string;
    itemResults: Array<{ orderItemId: string; fulfillmentStatus: string }>;
  }>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'awaiting_packaging',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    ...(input.shipmentDeadline ? { shipmentDeadline: input.shipmentDeadline } : {}),
    currency: 'RUB',
    items: [{ platformSkuId: input.platformSkuId, quantity: input.quantity }],
  });
  expect(result.status).toBe(200);
  return {
    orderId: result.body.data.orderId,
    orderItemId: result.body.data.itemResults[0]!.orderItemId,
    erpStatus: result.body.data.erpStatus,
  };
}

async function orderLine(orderId: string): Promise<{
  fulfillmentStatus: string;
  procurementCoverage: string | null;
}> {
  const detail = await client.get<{
    shipmentDeadline: string | null;
    items: Array<{ fulfillmentStatus: string; procurementCoverage: string | null }>;
  }>(`/api/v1/orders/${orderId}`);
  return detail.body.data.items[0]!;
}

async function orderDeadline(orderId: string): Promise<string | null> {
  const detail = await client.get<{ shipmentDeadline: string | null }>(`/api/v1/orders/${orderId}`);
  return detail.body.data.shipmentDeadline;
}

async function openExceptionsOf(
  referenceType: string,
  referenceId: string,
): Promise<Array<{ exceptionType: string; status: string }>> {
  const list = await client.get<Array<{ exceptionType: string; status: string }>>(
    `/api/v1/exceptions?referenceType=${referenceType}&referenceId=${referenceId}&pageSize=100`,
  );
  return list.body.data;
}

/** Picks every unit of the order and ships it; asserts line SHIPPED at the end. */
async function pickAndShip(orderId: string, barcode: string, units: number): Promise<void> {
  const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
    orderId,
  });
  const taskId = task.body.data.tasks[0]!.id;
  await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
  for (let i = 0; i < units; i += 1) {
    const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(scan.status).toBe(200);
  }

  const shipmentCreated = await client.post<{ shipments: Array<{ id: string }> }>(
    '/api/v1/shipments',
    { orderId },
  );
  const shipmentId = shipmentCreated.body.data.shipments[0]!.id;
  const packageCreated = await client.post<{ packageId: string }>(
    `/api/v1/shipments/${shipmentId}/packages`,
    {},
  );
  const packageId = packageCreated.body.data.packageId;
  for (let i = 0; i < units; i += 1) {
    const scan = await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
    expect(scan.status).toBe(200);
  }
  await client.post(`/api/v1/packages/${packageId}/seal`, {});
  const ship = await client.post(`/api/v1/shipments/${shipmentId}/ship`, {});
  expect(ship.status).toBe(200);
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-E2E`,
    name: `${PREFIX} 端到端店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-E2EWH`,
    name: `${PREFIX} 端到端仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binA01 = bins.body.data.bins[0]?.id ?? '';
  await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
});

afterAll(async () => {
  await api.stop();
});

describe('chain A: stock-first selling (task §14 链路A)', () => {
  it('receive -> order reserves -> scan-pick -> ship, stock and ledger follow', async () => {
    const skuId = await newSku('A');
    const barcode = `${PREFIX}-A-BAR`;
    await addBarcode(skuId, barcode);
    const platformSkuId = `${PREFIX}-A-1`;
    await mapSku(skuId, platformSkuId);

    // 3. Receive first: the receipt IS the stock source.
    const receipt = await client.post<{ id: string }>('/api/v1/purchase-receipts', {
      warehouseId,
      sourceNote: '1688 备货单',
      items: [{ skuId, quantity: '5', binId: binA01, unitCost: '80' }],
    });
    const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
    expect(confirm.status).toBe(200);
    expect((await balanceRows(skuId))[0]?.onHandQty).toBe('5.000');

    const tx = await client.get<Array<{ referenceType: string; referenceId: string }>>(
      `/api/v1/inventory/transactions?skuId=${skuId}&pageSize=100`,
    );
    const receiveLine = tx.body.data.find(
      (row) => row.referenceType === 'PURCHASE_RECEIPT' && row.referenceId === receipt.body.data.id,
    );
    expect(receiveLine).toBeDefined();

    // 4. Order consumes receipt-produced stock; deadline is visible.
    const deadline = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const order = await ingestOrder({ platformSkuId, quantity: '2', shipmentDeadline: deadline });
    expect(order.erpStatus).toBe('READY_TO_PICK');
    expect((await orderLine(order.orderId)).fulfillmentStatus).toBe('RESERVED');
    expect(await orderDeadline(order.orderId)).not.toBeNull();
    const reserved = (await balanceRows(skuId))[0]!;
    expect(reserved.reservedQty).toBe('2.000');
    expect(reserved.onHandQty).toBe('5.000');

    // 5-6. Scan picking and shipment on the receipt-placed bin.
    await pickAndShip(order.orderId, barcode, 2);
    const line = await orderLine(order.orderId);
    expect(line.fulfillmentStatus).toBe('SHIPPED');
    const after = (await balanceRows(skuId))[0]!;
    expect(after.onHandQty).toBe('3.000');
    expect(after.reservedQty).toBe('0.000');
    expect(after.pickedQty).toBe('0.000');
  });
});

describe('chain B: sell-first, buy-later (task §14 链路B, the main mode)', () => {
  it('backorder -> register PO (dup refused) -> receive from PO -> auto reallocate -> pick -> ship', async () => {
    const skuId = await newSku('B');
    const barcode = `${PREFIX}-B-BAR`;
    await addBarcode(skuId, barcode);
    const platformSkuId = `${PREFIX}-B-1`;
    await mapSku(skuId, platformSkuId);

    // 1. Order with ZERO stock: BACKORDERED + exception + 未覆盖（SHORT）。
    const deadline = new Date(Date.now() + 36 * 3600 * 1000).toISOString();
    const order = await ingestOrder({ platformSkuId, quantity: '2', shipmentDeadline: deadline });
    expect(order.erpStatus).toBe('BACKORDERED');
    let line = await orderLine(order.orderId);
    expect(line.fulfillmentStatus).toBe('BACKORDERED');
    expect(line.procurementCoverage).toBe('SHORT');
    expect(
      (await openExceptionsOf('ORDER_ITEM', order.orderItemId)).some(
        (e) => e.exceptionType === 'ORDER_OUT_OF_STOCK' && e.status === 'OPEN',
      ),
    ).toBe(true);

    // 2. 按 SKU×仓缺口补货采购（ADR 0023）；同一缺口重复采购被拒。
    const po = await client.post<{ id: string; poNo: string; items: Array<{ id: string }> }>(
      '/api/v1/purchase-orders',
      {
        sourceNote: '淘宝 订单号 50001',
        receivingWarehouseId: warehouseId,
        purpose: 'REPLENISH',
        items: [{ skuId, quantity: '2', unitCost: '120' }],
      },
    );
    expect(po.status, JSON.stringify(po.body.error ?? {})).toBe(200);
    line = await orderLine(order.orderId);
    expect(line.procurementCoverage).toBe('COVERED');

    const duplicate = await client.post('/api/v1/purchase-orders', {
      receivingWarehouseId: warehouseId,
      purpose: 'REPLENISH',
      items: [{ skuId, quantity: '2' }],
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('PURCHASE_SKU_GAP_COVERED');

    // 3. Goods arrive: receipt generated from the PO, confirmed.
    const receipt = await client.post<{ id: string }>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA01 },
    );
    expect(receipt.status).toBe(200);
    const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
    expect(confirm.status).toBe(200);

    expect((await balanceRows(skuId))[0]?.onHandQty).toBe('2.000');
    const poAfter = await client.get<{
      status: string;
      items: Array<{ receivedQuantity: string }>;
    }>(`/api/v1/purchase-orders/${po.body.data.id}`);
    expect(poAfter.body.data.status).toBe('RECEIVED');
    expect(poAfter.body.data.items[0]?.receivedQuantity).toBe('2.000');
    // 在途清零后覆盖标记消失（缺货口径 = 需求 − 在途，ADR 0023）。
    line = await orderLine(order.orderId);
    expect(line.procurementCoverage).not.toBe('COVERED');

    // 4. 库存增加后自动重新分配（用户指示 2026-09-17）：收货确认产生
    //    RECEIVE 流水后，缺货行由 OrderAutoReallocationService 自动转
    //    RESERVED（异步监听器，轮询等待）；此前「收货绝不自动分配」的
    //    假设已被该规则取代。
    //
    //    负载敏感（既有备忘：负载敏感用例单独跑）：该监听器是 fire-and-forget
    //    且**同 sku:warehouse 通道已在跑 / 在飞数达上限时本次事件被丢弃**
    //    （设计如此：失败自吞，不阻塞库存主流程，兜底为下一笔流水或人工重试）。
    //    全量套件并发跑时事件可能被丢弃——本用例需单独运行。
    line = await orderLine(order.orderId);
    for (let i = 0; i < 30 && line.fulfillmentStatus !== 'RESERVED'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      line = await orderLine(order.orderId);
    }
    expect(line.fulfillmentStatus).toBe('RESERVED');
    // 行已持有库存：手动重试被状态守卫正确拒绝（409）。
    const retry = await client.post<{ reserved: boolean }>(
      `/api/v1/orders/items/${order.orderItemId}/retry-allocation`,
    );
    expect(retry.status).toBe(409);
    expect(
      (await openExceptionsOf('ORDER_ITEM', order.orderItemId)).every(
        (e) => e.status !== 'OPEN' || e.exceptionType !== 'ORDER_OUT_OF_STOCK',
      ),
    ).toBe(true);

    // 5. Pick and ship against the deadline.
    await pickAndShip(order.orderId, barcode, 2);
    line = await orderLine(order.orderId);
    expect(line.fulfillmentStatus).toBe('SHIPPED');
    const after = (await balanceRows(skuId))[0]!;
    expect(after.onHandQty).toBe('0.000');
  });
});
