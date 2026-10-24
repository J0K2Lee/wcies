import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
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
  /** 采购覆盖（ADR 0023 派生）；店铺未绑定仓库时 coverage 为 null。 */
  procurementCoverage: 'COVERED' | 'SHORT' | null;
  /** 店铺没有任何 ACTIVE 仓库绑定（2026-10-24）。 */
  storeWarehouseUnbound: boolean;
}
interface OrderDetail {
  id: string;
  orderNo: string;
  platformOrderId: string;
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
let db: Client;

async function newSku(label: string, serialTracking = false): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
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
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
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
    await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
  }
});

afterAll(async () => {
  await api.stop();
  await db.end();
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

  it('订单页快速建档 → 自动重试映射/分配把订单行救回（页面 onCompleted 路径）', async () => {
    // 复刻订单页真实链路：
    //   行先到（无映射）→ FAILED；运营在订单页点「快速建档」→ 弹窗内部
    //   ①按平台标识反查未映射商品链接 ②onboard 建 SKU 并落 MAPPED；
    //   成功后页面 onCompleted 立刻调 retry-allocation 重试映射+分配。
    const platformSkuId = `${PREFIX}-QP-1`;
    const result = await ingest({ items: [{ platformSkuId, quantity: '1' }] });
    const item = result.body.data.itemResults[0]!;
    expect(item.mappingStatus).toBe('FAILED');

    // 已同步但未映射的变体行（sync 的真实产物形状）。
    const listing = await db.query<{ id: string }>(
      `INSERT INTO platform_listings (platform_id, store_id, platform_product_id, title, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE') RETURNING id`,
      [ozonPlatformId, storeA, `${PREFIX}-QP-L1`, `${PREFIX} 快速建档链接`],
    );
    const listingId = listing.rows[0].id;
    const mapping = await db.query<{ id: string }>(
      `INSERT INTO platform_listing_skus
         (listing_id, sku_id, mapping_status, platform_sku_id, status)
       VALUES ($1, NULL, 'UNMAPPED', $2, 'ACTIVE') RETURNING id`,
      [listingId, platformSkuId],
    );
    const mappingId = mapping.rows[0].id;

    // ① 弹窗入口：按订单行标识能在本店铺检索到该未映射链接。
    const found = await client.get<Array<{ id: string }>>(
      `/api/v1/listings?storeId=${storeA}&keyword=${encodeURIComponent(platformSkuId)}&mappingState=UNMAPPED&pageSize=5`,
    );
    expect(found.body.data.some((row) => row.id === listingId)).toBe(true);

    // ② onboard：一个事务内建 SKU + 落 MAPPED（与弹窗提交体一致）。
    const onboard = await client.post<{ sku: { id: string; skuCode: string } }>(
      `/api/v1/listings/${listingId}/skus/${mappingId}/onboard`,
      { skuNameZh: `${PREFIX} 快速建档SKU`, generateBarcode: false },
    );
    expect(onboard.status).toBe(201);
    const onboardedSkuId = onboard.body.data.sku.id;
    const mappingRow = await db.query<{ mapping_status: string; sku_id: string | null }>(
      'SELECT mapping_status, sku_id FROM platform_listing_skus WHERE id = $1',
      [mappingId],
    );
    expect(mappingRow.rows[0]?.mapping_status).toBe('MAPPED');
    expect(mappingRow.rows[0]?.sku_id).toBe(onboardedSkuId);

    // 备货后 ③ 自动重试（页面 onCompleted 的 retryMutation）：行转 RESERVED。
    await initialize({ skuId: onboardedSkuId, binId: binA01, quantity: '3' });
    const retry = await client.post<{ reserved: boolean; fulfillmentStatus: string }>(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(retry.status).toBe(200);
    expect(retry.body.data.reserved).toBe(true);
    expect(retry.body.data.fulfillmentStatus).toBe('RESERVED');

    const detail = await orderDetail(result.body.data.orderId);
    expect(detail.erpStatus).toBe('READY_TO_PICK');
    expect(
      detail.items[0]?.exceptions.filter(
        (e) => e.exceptionType === 'ORDER_SKU_MAPPING_FAILED' && e.status === 'OPEN',
      ).length,
    ).toBe(0);
  });

  it('非可分配状态（RELEASED）的行：补齐映射后重试仍必须修映射并关异常', async () => {
    // 现实来源：行先映射失败（FAILED + 异常），运营随后把订单标记「外部履约」
    // → 行转 RELEASED（markExternalFulfillment 只拦 RESERVED/PICKED），映射保持
    // FAILED。此后运营在订单页「快速建档」补齐变体映射，自动重试**不能再被
    // 分配状态守卫拦住**（2026-10-14 修：映射修复先于分配；此前该行会 409，
    // 映射永远修不上、映射异常常开、订单卡在 EXCEPTION）。
    const skuId = await newSku('RELEASED-REPAIR');
    const platformSkuId = `${PREFIX}-REL-1`;
    const created = await ingest({ items: [{ platformSkuId, quantity: '1' }] });
    const item = created.body.data.itemResults[0]!;
    expect(item.mappingStatus).toBe('FAILED');

    const marked = await client.post(
      `/api/v1/orders/${created.body.data.orderId}/mark-external-fulfillment`,
      {
        reason: '线下直发买家（测试）',
      },
    );
    expect(marked.status).toBe(200);
    const released = await orderDetail(created.body.data.orderId);
    expect(released.items[0]?.fulfillmentStatus).toBe('RELEASED');
    expect(released.items[0]?.mappingStatus).toBe('FAILED');

    // 未补齐映射 → 仍拒绝（语义不变，行为不放松）。
    const stillFailed = await client.post(
      `/api/v1/orders/items/${item.orderItemId}/retry-allocation`,
    );
    expect(stillFailed.status).toBe(409);
    expect(stillFailed.body.error?.code).toBe('ORDER_INVALID_STATE');

    // 补齐映射（等价订单页快速建档把变体落成 MAPPED）。
    await mapSku(skuId, platformSkuId);

    const retry = await client.post<{
      mappingRepaired: boolean;
      reserved: boolean;
      fulfillmentStatus: string;
    }>(`/api/v1/orders/items/${item.orderItemId}/retry-allocation`);
    expect(retry.status).toBe(200);
    expect(retry.body.data.mappingRepaired).toBe(true);
    // 该行不持有内部库存（RELEASED），只修映射、不占库存。
    expect(retry.body.data.reserved).toBe(false);
    expect(retry.body.data.fulfillmentStatus).toBe('RELEASED');

    const after = await orderDetail(created.body.data.orderId);
    expect(after.items[0]?.mappingStatus).toBe('MAPPED');
    expect(after.items[0]?.skuId).toBe(skuId);
    expect(
      after.items[0]?.exceptions.filter(
        (e) => e.exceptionType === 'ORDER_SKU_MAPPING_FAILED' && e.status === 'OPEN',
      ).length,
    ).toBe(0);
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

  it('映射修复遇到配置性失败时行落 BACKORDERED（不留 PENDING），列表口径一致', async () => {
    // 用户 bug 报告（2026-10-15）：映射失败行被修复时店铺尚未绑定仓库，
    // retryFailedMappingItem 的分配阶段抛 OrderIngestInvalidError —— catch 只
    // 重算 rollup（行已是 MAPPED，被 rollup 记作缺货），但抛错路径不写
    // BACKORDERED，于是行卡在 MAPPED+PENDING：订单头 ERP 显示缺货，商品列却
    // 没有缺货徽标、右栏「风险」不渲染、行内也没有「重新尝试分配」。
    // 2026-10-23 修正为与摄入路径对齐（7bc37a7/3062d91/085aaa2）：配置性失败
    // 写 BACKORDERED + ORDER_INVALID_STATE 异常，任何路径都不再留 PENDING。
    const storeUnbound = (
      await client.post<{ id: string }>('/api/v1/stores', {
        platformId: ozonPlatformId,
        storeCode: `${PREFIX}-UNBOUND`,
        name: `${PREFIX} 未绑定仓店`,
      })
    ).body.data.id;
    // 故意不绑定平台仓库：摄入即落 BACKORDERED（此路径自己写异常），
    // 随后走「映射失败 → 修复」复现卡行需要先 FAILED，故用仅映射失败更直接：
    const platformSkuId = `${PREFIX}-PEND-1`;
    const skuId = await newSku('PEND');
    const created = await ingest({
      storeId: storeUnbound,
      items: [{ platformSkuId, quantity: '1' }],
    });
    const item = created.body.data.itemResults[0]!;
    // 无映射时先 FAILED；补齐映射后（未绑仓）分配阶段抛配置性错误，行停在
    // MAPPED+PENDING —— 正是线上卡行的形状。
    expect(item.mappingStatus).toBe('FAILED');
    await mapSku(skuId, platformSkuId, storeUnbound);
    const retry = await client.post<{
      fulfillmentStatus: string;
      mappingRepaired: boolean;
    }>(`/api/v1/orders/items/${item.orderItemId}/retry-allocation`);
    expect(retry.status, JSON.stringify(retry.body.error ?? {})).toBe(200);
    expect(retry.body.data.reserved).toBe(false);
    expect(retry.body.data.fulfillmentStatus).toBe('BACKORDERED');
    const stuck = await db.query<{ mapping_status: string; fulfillment_status: string }>(
      'SELECT mapping_status, fulfillment_status FROM order_items WHERE id = $1',
      [item.orderItemId],
    );
    expect(stuck.rows[0]?.mapping_status).toBe('MAPPED');
    expect(stuck.rows[0]?.fulfillment_status).toBe('BACKORDERED');
    // 配置性失败必须留痕：行有 OPEN 的配置异常可查（仓库未绑定是配置问题，
    // 不是库存不足，所以异常类型是 ORDER_INVALID_STATE）。
    expect(
      (await openExceptionsOf(item.orderItemId)).some(
        (e) => e.exceptionType === 'ORDER_INVALID_STATE',
      ),
    ).toBe(true);

    // 订单头按 rollup 显示缺货，列表必须同口径：backorderedCount 计入该卡行。
    const detail = await orderDetail(created.body.data.orderId);
    expect(detail.erpStatus).toBe('BACKORDERED');
    const list = await client.get<
      Array<{
        id: string;
        erpStatus: string;
        backorderedCount: number;
        backorderedCoveredCount: number;
        backorderedShortCount: number;
        backorderedUnboundCount: number;
      }>
    >(`/api/v1/orders?keyword=${encodeURIComponent(detail.orderNo)}&pageSize=10`);
    const row = list.body.data.find((r) => r.id === created.body.data.orderId);
    expect(row?.erpStatus).toBe('BACKORDERED');
    expect(row?.backorderedCount).toBe(1);
    // 店铺未绑定仓库（2026-10-24 用户指示）：这类行**不算缺货**，单独计数。
    expect(row?.backorderedCoveredCount).toBe(0);
    expect(row?.backorderedShortCount).toBe(0);
    expect(row?.backorderedUnboundCount).toBe(1);
    const detailItem = detail.items[0]!;
    expect(detailItem.storeWarehouseUnbound).toBe(true);
    expect(detailItem.procurementCoverage).toBeNull();
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

  it('订单占用不可裸释放（库存页 lifecycle 被拒），但订单取消仍可收口（2026-10-15 悬空占用）', async () => {
    // 用户 bug：库存占用页对 ORDER 来源预约直接 release，只改库存不回订单，
    // 行悬空在 RESERVED（真实样本 ORD00000142）。修复：库存层拒绝 ORDER 来源的
    // 裸生命周期；订单取消链路带 orderDomain 标志，且容忍预约已终态（自愈）。
    const skuId = await newSku('OWNED');
    await initialize({ skuId, binId: binA01, quantity: '3' });
    await mapSku(skuId, `${PREFIX}-OWNED-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-OWNED-1`, quantity: '1' }] });
    const item = result.body.data.itemResults[0]!;
    const reservationId = item.reservationId;
    expect(reservationId).not.toBeNull();

    // 直接对 ORDER 来源预约 release → 409，库存不变，订单行仍 RESERVED。
    const naked = await client.post(`/api/v1/inventory/reservations/${reservationId}/release`, {});
    expect(naked.status).toBe(409);
    expect(naked.body.error?.code).toBe('INVENTORY_RESERVATION_ORDER_OWNED');
    expect((await balanceOf(skuId))[0]?.reservedQty).toBe('1.000');

    // 订单取消链路照常：释放库存、行转 RELEASED、订单 CANCELLED。
    const cancel = await client.post<{ erpStatus: string; releasedItems: number }>(
      `/api/v1/orders/${result.body.data.orderId}/cancel`,
      { reason: 'integration cancel (owned)' },
    );
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.erpStatus).toBe('CANCELLED');
    expect(cancel.body.data.releasedItems).toBe(1);
    expect((await balanceOf(skuId))[0]?.reservedQty).toBe('0.000');
    const after = await orderDetail(result.body.data.orderId);
    expect(after.items[0]?.fulfillmentStatus).toBe('RELEASED');
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
    backorderedCoveredCount: number;
    backorderedShortCount: number;
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
    platformStage?: string;
    platformStatus?: string;
    fulfillmentMode?: string;
  }) {
    const result = await client.post<IngestResult>('/api/v1/orders/ingest', {
      storeId: storeA,
      platformOrderId: `PO-${randomUUID()}`,
      platformStatus: options.platformStatus ?? 'awaiting_packaging',
      platformStage: options.platformStage,
      fulfillmentMode: options.fulfillmentMode ?? 'FBS',
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

  it('stage=EXTERNAL collects external-fulfillment orders and keeps them out of PENDING', async () => {
    // 外部履约单（FBP）已映射 → 行 EXTERNAL_FULFILLED、erp NEW。
    const skuF = await newSku('AXF');
    await mapSku(skuF, `${PREFIX}-AXF-1`);
    const fbp = await ingestWith({
      fulfillmentMode: 'FBP',
      items: [{ platformSkuId: `${PREFIX}-AXF-1`, quantity: '1' }],
    });
    expect(fbp.erpStatus).toBe('NEW');

    // 归入「外部履约」，不再混入「待处理」。
    expect((await listOne(fbp.orderId, 'stage=EXTERNAL')).hit).toBe(true);
    expect((await listOne(fbp.orderId, 'stage=PENDING')).hit).toBe(false);

    // 普通 FBS 自管仓单不受影响：仍在「待处理」。
    const skuS = await newSku('AXFE');
    await initialize({ skuId: skuS, binId: binA01, quantity: '5' });
    await mapSku(skuS, `${PREFIX}-AXFE-1`);
    const fbs = await ingestWith({ items: [{ platformSkuId: `${PREFIX}-AXFE-1`, quantity: '1' }] });
    expect((await listOne(fbs.orderId, 'stage=PENDING')).hit).toBe(true);
    expect((await listOne(fbs.orderId, 'stage=EXTERNAL')).hit).toBe(false);

    // 映射失败的外部履约单仍需人工补映射 → 留在「待处理」，不归「外部履约」。
    const fbpFailed = await ingestWith({
      fulfillmentMode: 'FBP',
      items: [{ platformSkuId: `${PREFIX}-NO-SUCH-FBP`, quantity: '1' }],
    });
    expect(fbpFailed.erpStatus).toBe('EXCEPTION');
    expect((await listOne(fbpFailed.orderId, 'stage=PENDING')).hit).toBe(true);
    expect((await listOne(fbpFailed.orderId, 'stage=EXTERNAL')).hit).toBe(false);
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

  it('a factually-shipped order with a mapping failure is not 发货超时 (用户指示 2026-10-14)', async () => {
    // 平台已发货（IN_TRANSIT，OZON delivering）+ 映射失败 + 已过发货时限：
    // 未映射异常继续阻塞（EXCEPTION），但货物已发走——不属于发货超时
    //（orders.md §17a；shipmentOverduePredicate 的平台阶段排除档）。
    const shippedFailed = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-NO-SUCH-3`, quantity: '1' }],
      shipmentDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      platformStage: 'IN_TRANSIT',
      platformStatus: 'delivering',
    });
    expect(shippedFailed.erpStatus).toBe('EXCEPTION');
    expect((await listOne(shippedFailed.orderId, 'goodsState=SHIPMENT_OVERDUE')).hit).toBe(false);
    // 仍可经「映射失败」找到（ABNORMAL 命中的是映射子句，不是超时）。
    expect((await listOne(shippedFailed.orderId, 'goodsState=MAPPING_FAILED')).hit).toBe(true);
    expect((await listOne(shippedFailed.orderId, 'goodsState=ABNORMAL')).hit).toBe(true);

    // 对照组：同样逾期但平台尚未发货（AWAITING_SHIPMENT）→ 仍是发货超时。
    const awaitingFailed = await ingestWith({
      items: [{ platformSkuId: `${PREFIX}-NO-SUCH-4`, quantity: '1' }],
      shipmentDeadline: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      platformStage: 'AWAITING_SHIPMENT',
    });
    expect(awaitingFailed.erpStatus).toBe('EXCEPTION');
    expect((await listOne(awaitingFailed.orderId, 'goodsState=SHIPMENT_OVERDUE')).hit).toBe(true);
  });

  it('backorderedCoveredCount / backorderedShortCount follow the purchase lifecycle (ADR 0023)', async () => {
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
    expect(listBefore.body.data[0]?.backorderedCoveredCount).toBe(0);
    expect(listBefore.body.data[0]?.backorderedShortCount).toBe(1);

    // 按 SKU×仓缺口补货采购（ADR 0023）：在途覆盖需求 → 「已采购」口径。
    const po = await client.post<{ id: string }>('/api/v1/purchase-orders', {
      sourceNote: '双轴测试 采购登记',
      receivingWarehouseId: warehouseId,
      purpose: 'REPLENISH',
      items: [{ skuId: skuP, quantity: '2' }],
    });
    expect(po.status, JSON.stringify(po.body.error ?? {})).toBe(200);

    const listOrdered = await client.get<ListItem[]>(
      `/api/v1/orders?keyword=${encodeURIComponent(detail.platformOrderId)}&pageSize=10`,
    );
    expect(listOrdered.body.data[0]?.backorderedCoveredCount).toBe(1);
    expect(listOrdered.body.data[0]?.backorderedShortCount).toBe(0);

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
    // 收货确认会同时触发「库存增加 → 缺货行自动重新分配」
    // （OrderAutoReallocationService，2026-09-17 用户指示，异步 fire-and-forget）：
    // 该行仍是缺货时，派生标记必须显示「已到货」；若自动重分配已跑完，行转
    // RESERVED、缺货计数归零 —— 两种都是正确事实（本断言此前只覆盖前者，
    // 与异步重分配存在竞态，2026-10-13 T8 修正为竞态感知）。
    const arrivedRow = listArrived.body.data[0];
    if (arrivedRow?.backorderedCount === 1) {
      expect(arrivedRow.backorderedCoveredCount).toBe(0);
      expect(arrivedRow.backorderedShortCount).toBe(1);
    } else {
      expect(arrivedRow?.reservedCount).toBe(1);
      expect(arrivedRow?.backorderedCoveredCount).toBe(0);
      expect(arrivedRow?.backorderedShortCount).toBe(0);
    }
  });
});

describe('urgent orders: marking + allocation priority (ADR 0022)', () => {
  interface UrgentListItem {
    id: string;
    erpStatus: string;
    isUrgent: boolean;
  }

  async function listOne(orderId: string): Promise<UrgentListItem | undefined> {
    const detail = await orderDetail(orderId);
    const list = await client.get<UrgentListItem[]>(
      `/api/v1/orders?keyword=${encodeURIComponent(detail.platformOrderId)}&pageSize=10`,
    );
    return list.body.data.find((row) => row.id === orderId);
  }

  /** 等到某单的缺货行被占用（自动重分配 fire-and-forget，竞态感知）。 */
  async function waitForReserved(orderId: string, timeoutMs = 5000): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const detail = await orderDetail(orderId);
      if (detail.erpStatus === 'READY_TO_PICK') {
        return true;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  it('toggles isUrgent on a live order and rejects a terminal order', async () => {
    const skuId = await newSku('URG');
    await initialize({ skuId, binId: binA01, quantity: '3' });
    await mapSku(skuId, `${PREFIX}-URG-1`);
    const result = await ingest({ items: [{ platformSkuId: `${PREFIX}-URG-1`, quantity: '1' }] });

    const on = await client.post<{ isUrgent: boolean }>(
      `/api/v1/orders/${result.body.data.orderId}/urgent`,
      { urgent: true },
    );
    expect(on.status).toBe(200);
    expect(on.body.data.isUrgent).toBe(true);
    expect((await listOne(result.body.data.orderId))?.isUrgent).toBe(true);

    const off = await client.post<{ isUrgent: boolean }>(
      `/api/v1/orders/${result.body.data.orderId}/urgent`,
      { urgent: false },
    );
    expect(off.body.data.isUrgent).toBe(false);

    // 终态（已取消）不可加急：ORDER_INVALID_STATE，且状态不被改写。
    await client.post(`/api/v1/orders/${result.body.data.orderId}/cancel`, { reason: '测试取消' });
    const rejected = await client.post<{ isUrgent: boolean }>(
      `/api/v1/orders/${result.body.data.orderId}/urgent`,
      { urgent: true },
    );
    expect(rejected.status).toBe(409);
    expect((await orderDetail(result.body.data.orderId)).erpStatus).toBe('CANCELLED');
  });

  it('allocates newly-received stock to the urgent backordered order first', async () => {
    const skuId = await newSku('URGP');
    await mapSku(skuId, `${PREFIX}-URGP-1`);

    // 两单各缺 1 件（无库存起始）：早单先创建，随后单被标记加急。
    const early = await ingest({ items: [{ platformSkuId: `${PREFIX}-URGP-1`, quantity: '1' }] });
    const late = await ingest({ items: [{ platformSkuId: `${PREFIX}-URGP-1`, quantity: '1' }] });
    expect(early.body.data.erpStatus).toBe('BACKORDERED');
    expect(late.body.data.erpStatus).toBe('BACKORDERED');

    await client.post(`/api/v1/orders/${late.body.data.orderId}/urgent`, { urgent: true });

    // 只收 1 件：加急单（晚创建）必须拿到，先来单保持缺货。
    await client.post('/api/v1/inventory/receive', {
      skuId,
      warehouseId,
      binId: binA01,
      quantity: '1',
      referenceType: 'MANUAL',
      referenceId: REF(),
      idempotencyKey: `IT-URG-RECV:${randomUUID()}`,
    });

    expect(await waitForReserved(late.body.data.orderId)).toBe(true);
    expect((await orderDetail(early.body.data.orderId)).erpStatus).toBe('BACKORDERED');
  });
});

describe('列表排序（2026-10-17 SKU 排序 500 修复）', () => {
  interface SortRow {
    id: string;
    isUrgent: boolean;
    firstSkuCode: string | null;
    shipmentDeadline: string | null;
  }

  /** 按加急分组后组内的键必须单调（加急恒定置顶，组内才应用所选排序键）。 */
  function assertGroupedMonotonic(
    rows: SortRow[],
    key: (row: SortRow) => string | null,
    label: string,
  ): void {
    const urgentFlags = rows.map((row) => row.isUrgent);
    const firstNonUrgent = urgentFlags.indexOf(false);
    const lastUrgent = urgentFlags.lastIndexOf(true);
    if (firstNonUrgent !== -1 && lastUrgent !== -1) {
      expect(lastUrgent, `${label}: 加急必须置顶`).toBeLessThan(firstNonUrgent);
    }
    for (const urgent of [true, false]) {
      const group = rows.filter((row) => row.isUrgent === urgent);
      const values = group.map(key);
      const defined = values.filter((value): value is string => value !== null);
      expect(defined, `${label}: 组内升序`).toEqual([...defined].sort());
      const firstNull = values.findIndex((value) => value === null);
      if (firstNull !== -1) {
        expect(
          values.slice(firstNull).every((value) => value === null),
          `${label}: 空值压最后`,
        ).toBe(true);
      }
    }
  }

  it('sortBy=skuCode 返回 200 且按 MIN(sku_code) 组内升序、空值压后', async () => {
    // 回归：ORDER BY 曾用 MIN 子查询原文，skip/take + joins 下 TypeORM 按
    // alias.property 解析并抛 '(SELECT MIN(sk' alias was not found → 500/空列表。
    const response = await client.get<SortRow[]>(
      '/api/v1/orders?sortBy=skuCode&sortOrder=asc&pageSize=100',
    );
    expect(response.status, JSON.stringify(response.body.error ?? {})).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    assertGroupedMonotonic(response.body.data, (row) => row.firstSkuCode, 'skuCode ASC');
  });

  it('sortBy=skuCode 降序与 sortBy=shipmentDeadline 均返回 200', async () => {
    const desc = await client.get<SortRow[]>(
      '/api/v1/orders?sortBy=skuCode&sortOrder=desc&pageSize=50',
    );
    expect(desc.status, JSON.stringify(desc.body.error ?? {})).toBe(200);

    const deadlines = await client.get<SortRow[]>(
      '/api/v1/orders?sortBy=shipmentDeadline&sortOrder=asc&pageSize=50',
    );
    expect(deadlines.status, JSON.stringify(deadlines.body.error ?? {})).toBe(200);
    expect(deadlines.body.data.length).toBeGreaterThan(0);
    assertGroupedMonotonic(
      deadlines.body.data,
      (row) => row.shipmentDeadline,
      'shipmentDeadline ASC',
    );
  });
});
