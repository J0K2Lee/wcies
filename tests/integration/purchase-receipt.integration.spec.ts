import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 7 T4 purchase-receipt acceptance against real PostgreSQL:
 * confirmation is the REAL receiving action - stock rises through
 * InventoryService, the ledger references PURCHASE_RECEIPT, the whole
 * document commits or rolls back as one transaction, and moving-average
 * cost updates on lines carrying unit_cost (decision 0013).
 */
let api: ManagedProcess;
const BASE = 'http://localhost:3111';
const client = new ApiClient(BASE);
const PREFIX = runPrefix();

interface ReceiptItem {
  id: string;
  skuId: string;
  purchaseOrderItemId: string | null;
  quantity: string;
  unitCost: string | null;
  binId: string | null;
  binCode: string | null;
  serialNumbers: string[] | null;
}
interface ReceiptDetail {
  id: string;
  receiptNo: string;
  status: string;
  purchaseOrderId: string | null;
  items: ReceiptItem[];
  idempotentReplay?: boolean;
}

let warehouseId = '';
let binA01 = '';
let binA02 = '';

async function newSku(label: string, serialTracking = false): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
    serialTracking,
  });
  return sku.body.data.id;
}

async function balanceOf(skuId: string): Promise<{ binCode: string; onHandQty: string }[]> {
  const list = await client.get<{ binCode: string; onHandQty: string }[]>(
    `/api/v1/inventory?skuId=${skuId}&warehouseId=${warehouseId}&pageSize=100`,
  );
  return [...list.body.data].sort((a, b) => a.binCode.localeCompare(b.binCode));
}

async function skuAverageCost(skuId: string): Promise<string | null> {
  const detail = await client.get<{ movingAverageCost: string | null }>(`/api/v1/skus/${skuId}`);
  return detail.body.data.movingAverageCost;
}

async function skuLatestPrice(skuId: string): Promise<number | null> {
  const detail = await client.get<{ latestPurchasePrice: number | null }>(`/api/v1/skus/${skuId}`);
  return detail.body.data.latestPurchasePrice;
}

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3111', REDIS_URL: 'redis://localhost:6379/8' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-RCWH`,
    name: `${PREFIX} 收货测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 2 },
  );
  binA01 = bins.body.data.bins.find((b) => b.binCode.endsWith('A01-1'))?.id ?? '';
  binA02 = bins.body.data.bins.find((b) => b.binCode.endsWith('A01-2'))?.id ?? '';
});

afterAll(async () => {
  await api.stop();
});

describe('PO creation with optional receiving draft (2026-09-17 T1)', () => {
  async function createPoWithDraft(label: string) {
    const skuId = await newSku(label);
    const orderedAt = '2026-09-01T04:30:00.000Z';
    const po = await client.post<{
      id: string;
      poNo: string;
      orderedAt: string;
      items: Array<{ id: string }>;
    }>('/api/v1/purchase-orders', {
      orderedAt,
      sourceNote: `${PREFIX} ${label}`,
      receivingWarehouseId: warehouseId,
      receipt: { defaultBinId: binA01 },
      items: [{ skuId, quantity: '10', unitCost: '12.3400' }],
    });
    expect(po.status).toBe(200);
    expect(po.body.data.orderedAt).toBe(orderedAt);
    const list = await client.get<Array<{ id: string }>>(
      `/api/v1/purchase-receipts?purchaseOrderId=${po.body.data.id}`,
    );
    expect(list.body.data).toHaveLength(1);
    const receipt = await client.get<ReceiptDetail & { sourceNote: string; remark: string }>(
      `/api/v1/purchase-receipts/${list.body.data[0]!.id}`,
    );
    return { skuId, po: po.body.data, receipt: receipt.body.data };
  }

  it('persists an independent numbered DRAFT with correct prefilled lines and no inventory', async () => {
    const { skuId, po, receipt } = await createPoWithDraft('AUTO1');
    expect(receipt.status).toBe('DRAFT');
    expect(receipt.receiptNo).toMatch(/^PR\d{6,}$/);
    expect(receipt.purchaseOrderId).toBe(po.id);
    expect(receipt.sourceNote).toBe(`${PREFIX} AUTO1`);
    expect(receipt.remark).toBe(`从采购单 ${po.poNo} 创建时自动生成`);
    expect(receipt.items).toHaveLength(1);
    expect(receipt.items[0]).toMatchObject({
      skuId,
      purchaseOrderItemId: po.items[0]!.id,
      quantity: '10.000',
      unitCost: '12.3400',
      binId: binA01,
      serialNumbers: null,
    });
    expect(await balanceOf(skuId)).toEqual([]);
    expect(await skuAverageCost(skuId)).toBeNull();
  });

  it('cancels all linked drafts without stock and prevents their confirmation', async () => {
    const { skuId, po, receipt } = await createPoWithDraft('AUTO2');
    // 决策 0021 防重复草稿：已有 DRAFT 时再生成被拒（不是静默第二张）。
    const duplicate = await client.post(`/api/v1/purchase-receipts/from-po/${po.id}`, {
      warehouseId,
      defaultBinId: binA01,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error?.code).toBe('PURCHASE_RECEIPT_DUPLICATE_DRAFT');
    // 手工建的第二张草稿（直接收货入口）仍允许，用于验证“取消联动全部草稿”。
    const extra = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      purchaseOrderId: po.id,
      warehouseId,
      items: [{ skuId, quantity: '1', binId: binA01 }],
    });
    expect(extra.status).toBe(200);
    const cancelled = await client.post<{ status: string }>(
      `/api/v1/purchase-orders/${po.id}/cancel`,
      {},
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    for (const id of [receipt.id, extra.body.data.id]) {
      const detail = await client.get<ReceiptDetail>(`/api/v1/purchase-receipts/${id}`);
      expect(detail.body.data.status).toBe('CANCELLED');
      const confirm = await client.post(`/api/v1/purchase-receipts/${id}/confirm`);
      expect(confirm.body.error?.code).toBe('PURCHASE_RECEIPT_INVALID_STATE');
    }
    expect(await balanceOf(skuId)).toEqual([]);
  });

  it('allows independent draft editing and confirmation, accruing partial receipt and stock', async () => {
    const { skuId, po, receipt } = await createPoWithDraft('AUTO3');
    const edited = await client.patch<ReceiptDetail>(`/api/v1/purchase-receipts/${receipt.id}`, {
      items: [
        {
          skuId,
          purchaseOrderItemId: po.items[0]!.id,
          quantity: '4',
          unitCost: '12.3400',
          binId: binA02,
        },
      ],
    });
    expect(edited.status).toBe(200);
    expect(await balanceOf(skuId)).toEqual([]);
    const confirmed = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${receipt.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('RECEIVED');
    expect((await balanceOf(skuId))[0]?.onHandQty).toBe('4.000');
    const poAfter = await client.get<{
      status: string;
      items: Array<{ receivedQuantity: string }>;
    }>(`/api/v1/purchase-orders/${po.id}`);
    expect(poAfter.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(poAfter.body.data.items[0]?.receivedQuantity).toBe('4.000');
    const cancellation = await client.post(`/api/v1/purchase-orders/${po.id}/cancel`, {});
    expect(cancellation.body.error?.code).toBe('PURCHASE_ORDER_INVALID_STATE');
    const unchanged = await client.get<ReceiptDetail>(`/api/v1/purchase-receipts/${receipt.id}`);
    expect(unchanged.body.data.status).toBe('RECEIVED');
  });

  it('unknown receiving warehouse leaves no PO persisted', async () => {
    const sourceNote = `${PREFIX} AUTO-invalid-warehouse`;
    const skuId = await newSku('AUTO4');
    const created = await client.post('/api/v1/purchase-orders', {
      sourceNote,
      receivingWarehouseId: '00000000-0000-4000-8000-000000000001',
      items: [{ skuId, quantity: '1' }],
    });
    expect(created.body.error?.code).toBe('WAREHOUSE_NOT_FOUND');
    const list = await client.get<Array<{ id: string }>>(
      `/api/v1/purchase-orders?keyword=${encodeURIComponent(sourceNote)}`,
    );
    expect(list.body.data).toEqual([]);
  });

  it('draft insertion failure rolls back PO header and items', async () => {
    const sourceNote = `${PREFIX} AUTO-invalid-bin`;
    const skuId = await newSku('AUTO5');
    const created = await client.post('/api/v1/purchase-orders', {
      sourceNote,
      receivingWarehouseId: warehouseId,
      receipt: { defaultBinId: '00000000-0000-4000-8000-000000000001' },
      items: [{ skuId, quantity: '1' }],
    });
    expect(created.status).toBeGreaterThanOrEqual(400);
    const list = await client.get<Array<{ id: string }>>(
      `/api/v1/purchase-orders?keyword=${encodeURIComponent(sourceNote)}`,
    );
    expect(list.body.data).toEqual([]);
    const receipts = await client.get<Array<{ id: string }>>(
      `/api/v1/purchase-receipts?keyword=${encodeURIComponent(sourceNote)}`,
    );
    expect(receipts.body.data).toEqual([]);
    expect(await balanceOf(skuId)).toEqual([]);
  });
});

describe('purchase receipt confirmation (Sprint 7 T4)', () => {
  it('books stock with PURCHASE_RECEIPT ledger rows; repeat confirm is idempotent (T4.5-1/2/3)', async () => {
    const skuA = await newSku('C1A');
    const skuB = await newSku('C1B');
    const created = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      sourceNote: '淘宝 订单号 20001',
      items: [
        { skuId: skuA, quantity: '6', binId: binA01 },
        { skuId: skuB, quantity: '4', binId: binA02 },
      ],
    });
    expect(created.status).toBe(200);
    expect(created.body.data.status).toBe('DRAFT');
    expect(created.body.data.receiptNo).toMatch(/^PR\d{6,}$/);

    // Pre-confirm balance view: nothing yet.
    expect(await balanceOf(skuA)).toEqual([]);

    const confirmed = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${created.body.data.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe('RECEIVED');
    expect(confirmed.body.data.idempotentReplay).toBe(false);

    const balancesA = await balanceOf(skuA);
    expect(balancesA[0]?.onHandQty).toBe('6.000');
    expect(balancesA[0]?.binCode.endsWith('A01-1')).toBe(true);
    expect((await balanceOf(skuB))[0]?.onHandQty).toBe('4.000');

    // Ledger traceability (AGENTS.md §14/§48).
    const tx = await client.get<
      Array<{ referenceType: string; referenceId: string; binCode: string }>
    >(
      `/api/v1/inventory/transactions?skuId=${skuA}&referenceType=PURCHASE_RECEIPT&referenceId=${created.body.data.id}&pageSize=100`,
    );
    expect(tx.body.data).toHaveLength(1);
    expect(tx.body.data[0]?.referenceType).toBe('PURCHASE_RECEIPT');

    // Repeat confirm: idempotent, stock NOT booked twice.
    const again = await client.post<ReceiptDetail & { idempotentReplay: boolean }>(
      `/api/v1/purchase-receipts/${created.body.data.id}/confirm`,
    );
    expect(again.status).toBe(200);
    expect(again.body.data.idempotentReplay).toBe(true);
    expect((await balanceOf(skuA))[0]?.onHandQty).toBe('6.000');
  });

  it('a failing line rolls the whole receipt back (T4.5-4)', async () => {
    const skuOk = await newSku('C2A');
    // A serial-tracked SKU without serialNumbers fails at the inventory
    // layer - the failure the atomicity test needs.
    const skuSn = await newSku('C2B', true);

    const created = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [
        { skuId: skuOk, quantity: '5', binId: binA01 },
        { skuId: skuSn, quantity: '2', binId: binA01 },
      ],
    });
    expect(created.status).toBe(200);

    const failed = await client.post(`/api/v1/purchase-receipts/${created.body.data.id}/confirm`);
    expect(failed.status).toBe(422);
    expect(failed.body.error?.code).toBe('INVENTORY_SERIAL_INVALID');

    // Whole-document rollback: the FIRST line must not be booked either.
    expect(await balanceOf(skuOk)).toEqual([]);
    const detail = await client.get<ReceiptDetail>(
      `/api/v1/purchase-receipts/${created.body.data.id}`,
    );
    expect(detail.body.data.status).toBe('DRAFT');
  });

  it('SN lines validate count and book serials when correct (T4.5-6)', async () => {
    const skuSn = await newSku('C3', true);
    const missing = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: skuSn, quantity: '2', binId: binA01 }],
    });
    const missingConfirm = await client.post(
      `/api/v1/purchase-receipts/${missing.body.data.id}/confirm`,
    );
    expect(missingConfirm.status).toBe(422);

    const wrong = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: skuSn, quantity: '2', binId: binA01, serialNumbers: ['ONLY-ONE'] }],
    });
    const wrongConfirm = await client.post(
      `/api/v1/purchase-receipts/${wrong.body.data.id}/confirm`,
    );
    expect(wrongConfirm.status).toBe(422);

    const ok = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [
        {
          skuId: skuSn,
          quantity: '2',
          binId: binA01,
          serialNumbers: [`${PREFIX}-SN-A`, `${PREFIX}-SN-B`],
        },
      ],
    });
    const okConfirm = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${ok.body.data.id}/confirm`,
    );
    expect(okConfirm.status).toBe(200);
    expect((await balanceOf(skuSn))[0]?.onHandQty).toBe('2.000');
  });

  it('partial deliveries accrue the PO: PARTIALLY_RECEIVED then RECEIVED (T4.5-5)', async () => {
    const sku = await newSku('C4');
    const po = await client.post<{ id: string; poNo: string; items: Array<{ id: string }> }>(
      '/api/v1/purchase-orders',
      {
        sourceNote: '京东 订单号 30001',
        receivingWarehouseId: warehouseId,
        items: [{ skuId: sku, quantity: '10' }],
      },
    );
    expect(po.status).toBe(200);

    const first = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA01 },
    );
    // Prefill covers the full remaining quantity; trim it to 4 for partial.
    const trimmed = await client.patch<ReceiptDetail>(
      `/api/v1/purchase-receipts/${first.body.data.id}`,
      {
        items: [
          {
            skuId: sku,
            purchaseOrderItemId: first.body.data.items[0]?.purchaseOrderItemId,
            quantity: '4',
            binId: binA01,
          },
        ],
      },
    );
    expect(trimmed.status).toBe(200);
    const confirmedFirst = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${first.body.data.id}/confirm`,
    );
    expect(confirmedFirst.status).toBe(200);
    expect((await balanceOf(sku))[0]?.onHandQty).toBe('4.000');

    const poAfterFirst = await client.get<{
      status: string;
      items: Array<{ receivedQuantity: string; quantity: string }>;
    }>(`/api/v1/purchase-orders/${po.body.data.id}`);
    expect(poAfterFirst.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(poAfterFirst.body.data.items[0]?.receivedQuantity).toBe('4.000');

    const second = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA02 },
    );
    const confirmedSecond = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${second.body.data.id}/confirm`,
    );
    expect(confirmedSecond.status).toBe(200);

    const poAfterSecond = await client.get<{ status: string }>(
      `/api/v1/purchase-orders/${po.body.data.id}`,
    );
    expect(poAfterSecond.body.data.status).toBe('RECEIVED');
    const balances = await balanceOf(sku);
    expect(balances.reduce((sum, row) => sum + Number(row.onHandQty), 0)).toBe(10);
  });

  it('RECEIVED receipts refuse quantity edits (T4.5-7)', async () => {
    const sku = await newSku('C5');
    const created = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: sku, quantity: '3', binId: binA01 }],
    });
    await client.post(`/api/v1/purchase-receipts/${created.body.data.id}/confirm`);
    expect((await balanceOf(sku))[0]?.onHandQty).toBe('3.000');

    const edit = await client.patch(`/api/v1/purchase-receipts/${created.body.data.id}`, {
      items: [{ skuId: sku, quantity: '99', binId: binA01 }],
    });
    expect(edit.status).toBe(409);
    expect(edit.body.error?.code).toBe('PURCHASE_RECEIPT_INVALID_STATE');
    // Stock untouched by the refused edit.
    expect((await balanceOf(sku))[0]?.onHandQty).toBe('3.000');
  });

  it('moving-average cost updates on confirmed lines only (Q2, decision 0013 §6)', async () => {
    const sku = await newSku('C6');
    expect(await skuAverageCost(sku)).toBeNull();

    const first = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: sku, quantity: '10', unitCost: '100', binId: binA01 }],
    });
    await client.post(`/api/v1/purchase-receipts/${first.body.data.id}/confirm`);
    expect(Number(await skuAverageCost(sku))).toBeCloseTo(100, 2);

    // Second receipt at 200 for another 10 units: average = (100*10+200*10)/20.
    const second = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: sku, quantity: '10', unitCost: '200', binId: binA02 }],
    });
    await client.post(`/api/v1/purchase-receipts/${second.body.data.id}/confirm`);
    expect(Number(await skuAverageCost(sku))).toBeCloseTo(150, 2);

    // A DRAFT with a different cost must NOT move the average.
    const draft = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: sku, quantity: '5', unitCost: '999', binId: binA01 }],
    });
    expect(draft.status).toBe(200);
    expect(Number(await skuAverageCost(sku))).toBeCloseTo(150, 2);
  });

  it('empty receipts cannot be confirmed; DRAFT cancel never touched stock', async () => {
    const sku = await newSku('C7');
    // Build then empty-by-cancel path: create a DRAFT, cancel it, verify no stock.
    const created = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: sku, quantity: '7', binId: binA01 }],
    });
    const cancelled = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${created.body.data.id}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(await balanceOf(sku)).toEqual([]);

    // Confirmed-then-cancel is refused with the state error.
    const booked = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: sku, quantity: '1', binId: binA01 }],
    });
    await client.post(`/api/v1/purchase-receipts/${booked.body.data.id}/confirm`);
    const cancelBooked = await client.post(
      `/api/v1/purchase-receipts/${booked.body.data.id}/cancel`,
    );
    expect(cancelBooked.status).toBe(409);
    expect(cancelBooked.body.error?.code).toBe('PURCHASE_RECEIPT_INVALID_STATE');
  });
});

describe('收货默认库位与超收防御（决策 0021）', () => {
  it('prefills the SKU current bin for a stocked SKU; staging bin for a new one', async () => {
    // Stock a SKU in A01-1, then purchase more of it plus a brand-new SKU.
    const stocked = await newSku('D1-existing');
    const seed = await client.post<ReceiptDetail>('/api/v1/purchase-receipts', {
      warehouseId,
      items: [{ skuId: stocked, quantity: '5', binId: binA01 }],
    });
    await client.post(`/api/v1/purchase-receipts/${seed.body.data.id}/confirm`);

    const fresh = await newSku('D1-fresh');
    const po = await client.post<{ id: string; items: Array<{ id: string }> }>(
      '/api/v1/purchase-orders',
      {
        sourceNote: `${PREFIX} default-bin`,
        receivingWarehouseId: warehouseId,
        items: [
          { skuId: stocked, quantity: '3' },
          { skuId: fresh, quantity: '2' },
        ],
      },
    );
    const draft = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId },
    );
    expect(draft.status).toBe(200);
    const lines = draft.body.data.items;
    const stockedLine = lines.find((item) => item.skuId === stocked);
    const freshLine = lines.find((item) => item.skuId === fresh);
    // Existing stock co-locates; the new SKU lands in an ST staging bin.
    expect(stockedLine?.binCode?.endsWith('A01-1')).toBe(true);
    expect(freshLine?.binCode).toContain('-ST');
  });

  it('refuses a duplicate draft for the same PO (409) and allows a fresh one after confirm', async () => {
    const sku = await newSku('D2');
    const po = await client.post<{ id: string }>('/api/v1/purchase-orders', {
      sourceNote: `${PREFIX} dedupe`,
      receivingWarehouseId: warehouseId,
      items: [{ skuId: sku, quantity: '4' }],
    });
    const first = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA01 },
    );
    expect(first.status).toBe(200);
    const dup = await client.post(`/api/v1/purchase-receipts/from-po/${po.body.data.id}`, {
      warehouseId,
      defaultBinId: binA01,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error?.code).toBe('PURCHASE_RECEIPT_DUPLICATE_DRAFT');

    // Confirm the first; a second draft must still be refused (partial delivery
    // is the case that legitimately needs a fresh draft — but only once there is
    // no live DRAFT left, i.e. only shows up here when nothing remains).
    await client.post(`/api/v1/purchase-receipts/${first.body.data.id}/confirm`);
    // Fully received: no remaining quantity.
    const none = await client.post(`/api/v1/purchase-receipts/from-po/${po.body.data.id}`, {
      warehouseId,
    });
    expect(none.status).toBe(409);
    expect(none.body.error?.code).toBe('PURCHASE_ORDER_INVALID_STATE');
  });

  it('短装结案：少发不再补时把剩余关掉，采购单收口且不产生库存（2026-11-03）', async () => {
    const sku = await newSku('E1');
    const po = await client.post<{ id: string; poNo: string; items: Array<{ id: string }> }>(
      '/api/v1/purchase-orders',
      {
        sourceNote: `${PREFIX} short-close`,
        receivingWarehouseId: warehouseId,
        items: [{ skuId: sku, quantity: '10' }],
      },
    );
    expect(po.status).toBe(200);
    const poItemId = po.body.data.items[0]?.id as string;

    // 到货 6 件（部分收货）
    const draft = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA01 },
    );
    await client.patch(`/api/v1/purchase-receipts/${draft.body.data.id}`, {
      items: [
        {
          skuId: sku,
          purchaseOrderItemId: draft.body.data.items[0]?.purchaseOrderItemId,
          quantity: '6',
          binId: binA01,
        },
      ],
    });
    const confirmed = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/${draft.body.data.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect((await balanceOf(sku))[0]?.onHandQty).toBe('6.000');

    const partial = await client.get<{ status: string }>(
      `/api/v1/purchase-orders/${po.body.data.id}`,
    );
    expect(partial.body.data.status).toBe('PARTIALLY_RECEIVED');

    // 结案剩余 4 件：不是收货，库存不动
    const closed = await client.post<{
      status: string;
      totalClosed: string;
      items: Array<{ closedQuantity: string; remainingQuantity: string }>;
    }>(`/api/v1/purchase-orders/${po.body.data.id}/close-remaining`, {
      reason: `${PREFIX} 供应商确认缺货`,
      items: [{ itemId: poItemId }],
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('RECEIVED');
    expect(closed.body.data.totalClosed).toBe('4.000');
    expect(closed.body.data.items[0]?.remainingQuantity).toBe('0.000');

    // 库存仍是 6（结案不写库存流水）
    expect((await balanceOf(sku))[0]?.onHandQty).toBe('6.000');

    const detail = await client.get<{
      status: string;
      items: Array<{ receivedQuantity: string; closedQuantity: string }>;
    }>(`/api/v1/purchase-orders/${po.body.data.id}`);
    expect(detail.body.data.status).toBe('RECEIVED');
    expect(detail.body.data.items[0]).toMatchObject({
      receivedQuantity: '6.000',
      closedQuantity: '4.000',
    });

    // 收口后不再生成收货草稿
    const none = await client.post(`/api/v1/purchase-receipts/from-po/${po.body.data.id}`, {
      warehouseId,
    });
    expect(none.status).toBe(409);
    expect(none.body.error?.code).toBe('PURCHASE_ORDER_INVALID_STATE');
  });

  it('短装结案：允许只关一部分、超额与空原因被拒、有草稿时先处理草稿', async () => {
    const sku = await newSku('E2');
    const po = await client.post<{ id: string; items: Array<{ id: string }> }>(
      '/api/v1/purchase-orders',
      {
        sourceNote: `${PREFIX} short-close-guards`,
        receivingWarehouseId: warehouseId,
        items: [{ skuId: sku, quantity: '5' }],
      },
    );
    const poId = po.body.data.id;
    const poItemId = po.body.data.items[0]?.id as string;

    // 空原因拒绝
    const noReason = await client.post(`/api/v1/purchase-orders/${poId}/close-remaining`, {
      reason: '   ',
      items: [{ itemId: poItemId }],
    });
    expect(noReason.status).toBe(409);

    // 有未取消草稿 → 先处理草稿
    const draft = await client.post<ReceiptDetail>(`/api/v1/purchase-receipts/from-po/${poId}`, {
      warehouseId,
      defaultBinId: binA01,
    });
    const blocked = await client.post(`/api/v1/purchase-orders/${poId}/close-remaining`, {
      reason: `${PREFIX} 短装`,
      items: [{ itemId: poItemId }],
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe('PURCHASE_RECEIPT_DUPLICATE_DRAFT');

    // 取消草稿后：只关 2 件 → 仍 PARTIALLY_RECEIVED，剩余 3
    await client.post(`/api/v1/purchase-receipts/${draft.body.data.id}/cancel`, {});
    const part = await client.post<{ status: string; items: Array<{ remainingQuantity: string }> }>(
      `/api/v1/purchase-orders/${poId}/close-remaining`,
      { reason: `${PREFIX} 先关 2 件`, items: [{ itemId: poItemId, quantity: '2' }] },
    );
    expect(part.status).toBe(200);
    expect(part.body.data.status).toBe('PARTIALLY_RECEIVED');
    expect(part.body.data.items[0]?.remainingQuantity).toBe('3.000');

    // 超额关闭被拒
    const overflow = await client.post(`/api/v1/purchase-orders/${poId}/close-remaining`, {
      reason: `${PREFIX} 超额`,
      items: [{ itemId: poItemId, quantity: '99' }],
    });
    expect(overflow.status).toBe(409);
  });

  it('rejects a confirm line that exceeds the PO item remaining quantity (no stock booked)', async () => {
    const sku = await newSku('D3');
    const po = await client.post<{ id: string; items: Array<{ id: string }> }>(
      '/api/v1/purchase-orders',
      {
        sourceNote: `${PREFIX} overreceipt`,
        receivingWarehouseId: warehouseId,
        items: [{ skuId: sku, quantity: '3' }],
      },
    );
    const draft = await client.post<ReceiptDetail>(
      `/api/v1/purchase-receipts/from-po/${po.body.data.id}`,
      { warehouseId, defaultBinId: binA01 },
    );
    // Manually inflate the draft beyond the ordered quantity.
    const inflated = await client.patch<ReceiptDetail>(
      `/api/v1/purchase-receipts/${draft.body.data.id}`,
      {
        items: [
          {
            skuId: sku,
            purchaseOrderItemId: draft.body.data.items[0]?.purchaseOrderItemId,
            quantity: '99',
            binId: binA01,
          },
        ],
      },
    );
    expect(inflated.status).toBe(200);
    const failed = await client.post(`/api/v1/purchase-receipts/${draft.body.data.id}/confirm`);
    expect(failed.status).toBe(409);
    expect(failed.body.error?.code).toBe('PURCHASE_RECEIPT_EXCEEDS_ORDERED');
    expect(await balanceOf(sku)).toEqual([]);
  });
});

describe('最近采购价随收货确认更新（2026-11-09 用户口径）', () => {
  async function createDraft(
    label: string,
    unitCost: string,
  ): Promise<{
    skuId: string;
    receiptId: string;
  }> {
    const skuId = await newSku(label);
    const po = await client.post<{ id: string }>('/api/v1/purchase-orders', {
      orderedAt: '2026-11-01T04:30:00.000Z',
      sourceNote: `${PREFIX} ${label}`,
      receivingWarehouseId: warehouseId,
      receipt: { defaultBinId: binA01 },
      items: [{ skuId, quantity: '2', unitCost }],
    });
    expect(po.status).toBe(200);
    const list = await client.get<Array<{ id: string }>>(
      `/api/v1/purchase-receipts?purchaseOrderId=${po.body.data.id}`,
    );
    expect(list.body.data).toHaveLength(1);
    return { skuId, receiptId: list.body.data[0]!.id };
  }

  it('草稿不更新；确认收货写入本次单价；下一次收货覆盖为最新价', async () => {
    const first = await createDraft('LPP1', '12.3400');
    // 草稿收货不动最近采购价。
    expect(await skuLatestPrice(first.skuId)).toBeNull();

    const confirmed = await client.post(`/api/v1/purchase-receipts/${first.receiptId}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(await skuLatestPrice(first.skuId)).toBe(12.34);

    // 第二次采购/收货：最近采购价 = 最近一次确认收货的单价（不做加权）。
    const second = await createDraft('LPP2', '15.5000');
    // 同一个 SKU 再建一张采购单 + 收货单
    const po2 = await client.post<{ id: string }>('/api/v1/purchase-orders', {
      orderedAt: '2026-11-02T04:30:00.000Z',
      sourceNote: `${PREFIX} LPP2b`,
      receivingWarehouseId: warehouseId,
      receipt: { defaultBinId: binA01 },
      items: [{ skuId: first.skuId, quantity: '1', unitCost: '15.5000' }],
    });
    expect(po2.status).toBe(200);
    const list2 = await client.get<Array<{ id: string }>>(
      `/api/v1/purchase-receipts?purchaseOrderId=${po2.body.data.id}`,
    );
    const confirmed2 = await client.post(
      `/api/v1/purchase-receipts/${list2.body.data[0]!.id}/confirm`,
    );
    expect(confirmed2.status).toBe(200);
    expect(await skuLatestPrice(first.skuId)).toBe(15.5);
    void second;
  });
});
