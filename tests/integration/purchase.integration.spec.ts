import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 7 T3 purchase-registration acceptance against real PostgreSQL:
 * the PO exists to answer "already bought?" - duplicate registration for
 * the same order line must be refused, cancellation must free the line, and
 * the derived per-line procurement state plus the 待采购 order filter must
 * follow the PO facts (purchase.md §3).
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

interface PoItem {
  id: string;
  skuId: string;
  orderItemId: string | null;
  quantity: string;
  receivedQuantity: string;
}
interface PoDetail {
  id: string;
  poNo: string;
  status: string;
  supplierId: string | null;
  sourceNote: string | null;
  items: PoItem[];
}

let storeA = '';
let warehouseId = '';

async function newSku(label: string): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
}

async function mapSku(skuId: string, platformSkuId: string): Promise<void> {
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId: storeA,
    platformProductId: `${PREFIX}-PP-${platformSkuId}`,
    skuVariants: [{ skuId, platformSkuId }],
  });
}

let ozonPlatformId = '';

/** Ingests an order whose single line ends MAPPED + BACKORDERED (no stock). */
async function backorderedLine(
  label: string,
): Promise<{ orderId: string; orderItemId: string; skuId: string }> {
  const skuId = await newSku(label);
  await mapSku(skuId, `${PREFIX}-${label}`);
  const result = await client.post<{
    orderId: string;
    itemResults: Array<{ orderItemId: string; fulfillmentStatus: string; mappingStatus: string }>;
  }>('/api/v1/orders/ingest', {
    storeId: storeA,
    platformOrderId: `PO-${randomUUID()}`,
    platformStatus: 'awaiting_packaging',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    currency: 'RUB',
    items: [{ platformSkuId: `${PREFIX}-${label}`, quantity: '2' }],
  });
  const line = result.body.data.itemResults[0]!;
  expect(line.fulfillmentStatus).toBe('BACKORDERED');
  expect(line.mappingStatus).toBe('MAPPED');
  return { orderId: result.body.data.orderId, orderItemId: line.orderItemId, skuId };
}

async function orderProcurementState(orderId: string): Promise<Array<string | null>> {
  const detail = await client.get<{
    items: Array<{ procurementState: string | null }>;
  }>(`/api/v1/orders/${orderId}`);
  return detail.body.data.items.map((item) => item.procurementState);
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';
  const storeResp = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-A`,
    name: `${PREFIX} 采购A店`,
  });
  storeA = storeResp.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 采购测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  await bindPlatformWarehouse(client, storeA, warehouseId, 'OZON_RFBS');
});

afterAll(async () => {
  await api.stop();
});

describe('purchase registration (Sprint 7 T3)', () => {
  it('registering a PO for a backordered line derives ORDERED (task §T3.6-1)', async () => {
    const line = await backorderedLine('R1');
    expect(await orderProcurementState(line.orderId)).toEqual(['NOT_ORDERED']);

    const created = await client.post<PoDetail>('/api/v1/purchase-orders', {
      sourceNote: '淘宝 订单号 10001',
      items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '2' }],
    });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('ORDERED');
    expect(created.body.data.poNo).toMatch(/^PO\d{6,}$/);
    expect(created.body.data.sourceNote).toBe('淘宝 订单号 10001');

    expect(await orderProcurementState(line.orderId)).toEqual(['ORDERED']);
  });

  it('duplicate registration for the same line is refused (task §T3.6-2)', async () => {
    const line = await backorderedLine('R2');
    const first = await client.post<PoDetail>('/api/v1/purchase-orders', {
      items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '2' }],
    });
    expect(first.status).toBe(200);

    const duplicate = await client.post('/api/v1/purchase-orders', {
      items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '1' }],
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('PURCHASE_ORDER_ITEM_ALREADY_ORDERED');
    expect(duplicate.body.error?.message).toContain(first.body.data.poNo);
  });

  it('cancelling the PO frees the line back to NOT_ORDERED (task §T3.6-3)', async () => {
    const line = await backorderedLine('R3');
    const created = await client.post<PoDetail>('/api/v1/purchase-orders', {
      items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '2' }],
    });
    expect(await orderProcurementState(line.orderId)).toEqual(['ORDERED']);

    const cancelled = await client.post<PoDetail>(
      `/api/v1/purchase-orders/${created.body.data.id}/cancel`,
      { reason: '买错了' },
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await orderProcurementState(line.orderId)).toEqual(['NOT_ORDERED']);

    // The freed line can be registered again (no DB unique index, §9.3).
    const again = await client.post<PoDetail>('/api/v1/purchase-orders', {
      items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '3' }],
    });
    expect(again.status).toBe(200);
    expect(await orderProcurementState(line.orderId)).toEqual(['ORDERED']);
  });

  it('stock-up purchase without orderItemId works (task §T3.6-4)', async () => {
    const supplier = await client.post<{ id: string; code: string }>('/api/v1/suppliers', {
      name: `${PREFIX} 固定供应商`,
    });
    const skuId = await newSku('R4');
    const created = await client.post<PoDetail>('/api/v1/purchase-orders', {
      supplierId: supplier.body.data.id,
      items: [
        { skuId, quantity: '10', unitCost: '59.9000' },
        { skuId: await newSku('R4B'), quantity: '5' },
      ],
    });
    expect(created.status).toBe(200);
    expect(created.body.data.supplierId).toBe(supplier.body.data.id);
    expect(created.body.data.items).toHaveLength(2);

    // PO list filters by status and keyword; item detail carries costs.
    const list = await client.get<
      Array<{ poNo: string; itemCount: number; supplierName: string | null }>
    >(`/api/v1/purchase-orders?keyword=${encodeURIComponent(created.body.data.poNo)}`);
    expect(list.status).toBe(200);
    const row = list.body.data[0]!;
    expect(row.poNo).toBe(created.body.data.poNo);
    expect(row.itemCount).toBe(2);
    expect(row.supplierName).toBe(`${PREFIX} 固定供应商`);

    // Referenced supplier cannot be hard-deleted (decision 0003).
    const deleteRefused = await client.del(`/api/v1/suppliers/${supplier.body.data.id}`);
    expect(deleteRefused.status).toBe(409);
    expect(deleteRefused.body.error?.code).toBe('SUPPLIER_IN_USE');
  });

  it('待采购 filter returns only uncovered BACKORDERED orders (task §T3.6-5)', async () => {
    const uncovered = await backorderedLine('R5A');
    const covered = await backorderedLine('R5B');
    await client.post<PoDetail>('/api/v1/purchase-orders', {
      items: [{ skuId: covered.skuId, orderItemId: covered.orderItemId, quantity: '2' }],
    });

    const list = await client.get<Array<{ id: string }>>(
      `/api/v1/orders?pendingProcurement=true&pageSize=100`,
    );
    expect(list.status).toBe(200);
    const ids = list.body.data.map((row) => row.id);
    expect(ids).toContain(uncovered.orderId);
    expect(ids).not.toContain(covered.orderId);
  });

  it('update replaces items while ORDERED; invalid sku/line refs are rejected', async () => {
    const line = await backorderedLine('R6');
    const created = await client.post<PoDetail>('/api/v1/purchase-orders', {
      expectedAt: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
      items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '2' }],
    });
    const updated = await client.patch<PoDetail>(
      `/api/v1/purchase-orders/${created.body.data.id}`,
      {
        remark: '加急',
        items: [{ skuId: line.skuId, orderItemId: line.orderItemId, quantity: '5' }],
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.body.data.remark).toBe('加急');
    expect(updated.body.data.items[0]?.quantity).toBe('5.000');

    const badSku = await client.post('/api/v1/purchase-orders', {
      items: [{ skuId: randomUUID(), quantity: '1' }],
    });
    expect(badSku.status).toBe(404);
    expect(badSku.body.error?.code).toBe('SKU_NOT_FOUND');

    const badLine = await client.post('/api/v1/purchase-orders', {
      items: [{ skuId: await newSku('R6B'), orderItemId: randomUUID(), quantity: '1' }],
    });
    expect(badLine.status).toBe(404);
  });
});

describe('列表搜索 / 采购商品列 / 批量删除（用户指示 2026-10-17）', () => {
  interface PoRow {
    id: string;
    poNo: string;
    status: string;
    firstItemSkuCode: string | null;
    firstItemName: string | null;
    firstItemQuantity: string | null;
  }
  interface ReceiptRow {
    id: string;
    receiptNo: string;
    status: string;
    purchaseOrderId: string | null;
    firstItemName: string | null;
    firstItemQuantity: string | null;
  }

  let binId = '';

  beforeAll(async () => {
    const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
      `/api/v1/warehouses/${warehouseId}/bins/batch`,
      { zone: 'D', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
    );
    binId = bins.body.data.bins[0]?.id ?? '';
  });

  async function skuCodeOf(skuId: string): Promise<string> {
    const sku = await client.get<{ skuCode: string }>(`/api/v1/skus/${skuId}`);
    return sku.body.data.skuCode;
  }

  async function createPo(
    label: string,
    options: { quantity?: string; withDraft?: boolean } = {},
  ): Promise<{ poId: string; poNo: string; skuId: string; receiptId: string | null }> {
    const skuId = await newSku(label);
    const body: Record<string, unknown> = {
      sourceNote: `${PREFIX} ${label}`,
      items: [{ skuId, quantity: options.quantity ?? '2' }],
    };
    if (options.withDraft === true) {
      body['receipt'] = { warehouseId, defaultBinId: binId };
    }
    const created = await client.post<{ id: string; poNo: string }>(
      '/api/v1/purchase-orders',
      body,
    );
    expect(created.status, JSON.stringify(created.body.error ?? {})).toBe(200);
    let receiptId: string | null = null;
    if (options.withDraft === true) {
      const receipts = await client.get<ReceiptRow[]>(
        `/api/v1/purchase-receipts?purchaseOrderId=${created.body.data.id}&pageSize=50`,
      );
      receiptId = receipts.body.data[0]?.id ?? null;
    }
    return { poId: created.body.data.id, poNo: created.body.data.poNo, skuId, receiptId };
  }

  it('搜索可命中明细 SKU 的名称与编码；列表返回首行采购商品', async () => {
    const unique = `玄影${randomUUID().slice(0, 6)}`;
    const po = await createPo(unique, { quantity: '3' });
    const code = await skuCodeOf(po.skuId);

    const byName = await client.get<PoRow[]>(
      `/api/v1/purchase-orders?keyword=${encodeURIComponent(unique)}&pageSize=50`,
    );
    expect(byName.status).toBe(200);
    expect(byName.body.data.some((row) => row.id === po.poId)).toBe(true);

    const byCode = await client.get<PoRow[]>(
      `/api/v1/purchase-orders?keyword=${encodeURIComponent(code)}&pageSize=50`,
    );
    expect(byCode.body.data.some((row) => row.id === po.poId)).toBe(true);

    const row = byName.body.data.find((item) => item.id === po.poId)!;
    expect(row.firstItemSkuCode).toBe(code);
    expect(row.firstItemName).toContain(unique);
    expect(Number(row.firstItemQuantity)).toBe(3);
  });

  it('一张草稿收货单也可被 SKU 搜索命中', async () => {
    const unique = `草稿影${randomUUID().slice(0, 6)}`;
    const po = await createPo(unique, { withDraft: true });
    expect(po.receiptId).not.toBeNull();

    const found = await client.get<ReceiptRow[]>(
      `/api/v1/purchase-receipts?keyword=${encodeURIComponent(unique)}&pageSize=50`,
    );
    expect(found.status).toBe(200);
    const row = found.body.data.find((item) => item.id === po.receiptId);
    expect(row).toBeDefined();
    expect(row?.firstItemName).toContain(unique);
    expect(Number(row?.firstItemQuantity)).toBe(2);
  });

  it('批量删除：无收货的采购单一并删掉其草稿，已确认收货的拒绝', async () => {
    // A) 无草稿的采购单 → 删除成功。
    const plain = await createPo('DELPLAIN');
    // B) 带草稿的采购单 → 删除成功，草稿随之消失。
    const withDraft = await createPo('DELDRAFT', { withDraft: true });
    // C) 已确认收货的采购单 → 拒绝（采购单与收货单都不可删）。
    const received = await createPo('DELRECV', { withDraft: true });
    const confirm = await client.post(`/api/v1/purchase-receipts/${received.receiptId}/confirm`);
    expect(confirm.status, JSON.stringify(confirm.body.error ?? {})).toBe(200);

    const poDelete = await client.post<{
      total: number;
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; errorCode: string | null }>;
    }>('/api/v1/purchase-orders/batch-delete', {
      ids: [plain.poId, withDraft.poId, received.poId],
    });
    expect(poDelete.status, JSON.stringify(poDelete.body.error ?? {})).toBe(200);
    expect(poDelete.body.data).toMatchObject({ total: 3, succeeded: 2, failed: 1 });

    const byId = new Map(poDelete.body.data.results.map((item) => [item.id, item]));
    expect(byId.get(plain.poId)?.ok).toBe(true);
    expect(byId.get(withDraft.poId)?.ok).toBe(true);
    expect(byId.get(received.poId)?.ok).toBe(false);
    expect(byId.get(received.poId)?.errorCode).toBe('PURCHASE_ORDER_INVALID_STATE');

    // 删除后不可再读；其草稿收货单一并消失。
    expect((await client.get(`/api/v1/purchase-orders/${plain.poId}`)).status).toBe(404);
    expect((await client.get(`/api/v1/purchase-orders/${withDraft.poId}`)).status).toBe(404);
    expect((await client.get(`/api/v1/purchase-receipts/${withDraft.receiptId}`)).status).toBe(404);
    // 已收货的单保留。
    expect((await client.get(`/api/v1/purchase-orders/${received.poId}`)).status).toBe(200);

    // 收货单批量删除：草稿可删、已确认的拒绝。
    const draftToDelete = await createPo('DELREC2', { withDraft: true });
    const receiptDelete = await client.post<{
      succeeded: number;
      failed: number;
      results: Array<{ id: string; ok: boolean; errorCode: string | null }>;
    }>('/api/v1/purchase-receipts/batch-delete', {
      ids: [draftToDelete.receiptId, received.receiptId],
    });
    expect(receiptDelete.status, JSON.stringify(receiptDelete.body.error ?? {})).toBe(200);
    expect(receiptDelete.body.data).toMatchObject({ succeeded: 1, failed: 1 });
    const receiptResults = new Map(receiptDelete.body.data.results.map((item) => [item.id, item]));
    expect(receiptResults.get(draftToDelete.receiptId!)?.ok).toBe(true);
    expect(receiptResults.get(received.receiptId!)?.ok).toBe(false);
    expect(receiptResults.get(received.receiptId!)?.errorCode).toBe(
      'PURCHASE_RECEIPT_INVALID_STATE',
    );
    expect((await client.get(`/api/v1/purchase-receipts/${received.receiptId}`)).status).toBe(200);
  });
});
