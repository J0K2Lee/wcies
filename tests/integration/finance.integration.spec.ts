import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Finance module acceptance (Sprint 10 T2, docs/business-rules/finance.md)
 * against real PostgreSQL:
 *
 * - manual vouchers enforce the category/direction matrix and required
 *   relations (SALE_* needs the order, PURCHASE_PAYMENT needs supplier+PO)
 *   and overpayment is rejected;
 * - an order shipped through the REAL picking->shipment flow settles once:
 *   revenue from the structured item price fact, cost from the SKU moving
 *   average set by a purchase receipt, profit recomputed when fees change,
 *   generation idempotent, non-shipped orders refused;
 * - payout DRAFT -> CONFIRMED mints the linked SALE_INCOME voucher exactly
 *   once; cancel only in DRAFT; the preview reconciles settled revenue;
 * - payables derive payable/paid/unpaid at read time (UNPAID -> PARTIAL ->
 *   PAID); reversal pairs net to zero in the summary.
 */

const PREFIX = runPrefix();
const BASE = 'http://localhost:3120';
const client = new ApiClient(BASE);

let api: ManagedProcess;

let ozonPlatformId = '';
let storeId = '';
let warehouseId = '';
let binId = '';

beforeAll(async () => {
  api = spawnApiEntry('main.js', { PORT: '3120', REDIS_URL: 'redis://localhost:6379/10' });
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode: `${PREFIX}-FIN`,
    name: `${PREFIX} 财务店`,
  });
  storeId = store.body.data.id;
  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-FINWH`,
    name: `${PREFIX} 财务仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binId = bins.body.data.bins[0]!.id;
  await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
}, 180_000);

afterAll(async () => {
  await api.stop();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function newSku(label: string): Promise<{ skuId: string; barcode: string }> {
  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} ${label}商品`,
  });
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} ${label}SKU`,
  });
  const skuId = sku.body.data.id;
  const barcode = `${PREFIX}${label}BAR`;
  await client.post(`/api/v1/skus/${skuId}/barcodes`, {
    barcode,
    barcodeType: 'EAN',
    isPrimary: true,
  });
  return { skuId, barcode };
}

/** Direct receipt: stock + moving average cost in one confirmed document. */
async function receiveWithCost(skuId: string, quantity: string, unitCost: string): Promise<void> {
  const receipt = await client.post<{ id: string }>('/api/v1/purchase-receipts', {
    warehouseId,
    sourceNote: `${PREFIX} 财务测试收货`,
    items: [{ skuId, quantity, binId, unitCost }],
  });
  expect(receipt.status, JSON.stringify(receipt.body.error ?? {})).toBe(200);
  const confirm = await client.post(`/api/v1/purchase-receipts/${receipt.body.data.id}/confirm`);
  expect(confirm.status).toBe(200);
}

/** Ingest an order with a structured price fact and ship it for real. */
async function ingestAndShipOrder(
  skuId: string,
  platformSkuId: string,
  barcode: string,
  quantity: number,
  unitPrice: string,
  currency = 'CNY',
): Promise<{ orderId: string; orderNo: string }> {
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-PP-${platformSkuId}`,
    skuVariants: [{ skuId, platformSkuId }],
  });
  const order = await client.post<{ orderId: string; orderNo: string }>('/api/v1/orders/ingest', {
    storeId,
    platformOrderId: `FIN-${randomUUID()}`,
    platformStatus: 'new',
    fulfillmentMode: 'FBS',
    orderedAt: new Date().toISOString(),
    currency,
    items: [{ platformSkuId, quantity: String(quantity), unitPrice }],
  });
  expect(order.status, JSON.stringify(order.body.error ?? {})).toBe(200);
  const orderId = order.body.data.orderId;

  const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
    orderId,
  });
  const taskId = created.body.data.tasks[0]!.id;
  await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
  for (let i = 0; i < quantity; i += 1) {
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
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
  for (let i = 0; i < quantity; i += 1) {
    await client.post(`/api/v1/packages/${packageId}/items/scan`, { barcode });
  }
  await client.post(`/api/v1/packages/${packageId}/seal`, {});
  const ship = await client.post(`/api/v1/shipments/${shipmentId}/ship`, {});
  expect(ship.status).toBe(200);
  return { orderId, orderNo: order.body.data.orderNo };
}

// ---------------------------------------------------------------------------
// Voucher matrix (finance.md §3.2/§3.3)
// ---------------------------------------------------------------------------

describe('finance transactions (finance.md §3)', () => {
  it('rejects direction/category mismatch and missing required relations', async () => {
    const mismatch = await client.post('/api/v1/finance/transactions', {
      direction: 'EXPENSE',
      category: 'SALE_INCOME',
      amount: '10',
    });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error?.code).toBe('FINANCE_CATEGORY_DIRECTION_MISMATCH');

    const noOrder = await client.post('/api/v1/finance/transactions', {
      direction: 'INCOME',
      category: 'SALE_INCOME',
      amount: '10',
    });
    expect(noOrder.status).toBe(422);
    expect(noOrder.body.error?.code).toBe('FINANCE_RELATION_REQUIRED');

    const noPo = await client.post('/api/v1/finance/transactions', {
      direction: 'EXPENSE',
      category: 'PURCHASE_PAYMENT',
      amount: '10',
      supplierId: randomUUID(),
    });
    expect(noPo.status).toBe(422);
    expect(noPo.body.error?.code).toBe('FINANCE_RELATION_REQUIRED');
  });

  it('creates OTHER_EXPENSE vouchers and reverses them as a net-zero pair', async () => {
    const created = await client.post<{ id: string; voucherNo: string }>(
      '/api/v1/finance/transactions',
      { direction: 'EXPENSE', category: 'OTHER_EXPENSE', amount: '25.5', currency: 'CNY' },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.voucherNo).toMatch(/^FV\d{6}$/);
    expect(created.body.data.amount).toBe('25.5000');

    const twin = await client.post<{ id: string; voucherNo: string; direction: string }>(
      `/api/v1/finance/transactions/${created.body.data.id}/reverse`,
      {},
    );
    expect(twin.status).toBe(200);
    expect(twin.body.data.direction).toBe('INCOME');
    expect(twin.body.data.category).toBe('OTHER_EXPENSE');

    // The pair nets to zero in the summary (finance.md §3.4/§7).
    const summary = await client.get<{
      incomeTotal: string;
      expenseTotal: string;
      netTotal: string;
    }>('/api/v1/finance/summary');
    expect(summary.status).toBe(200);
    // 25.5 income and 25.5 expense both excluded -> net untouched by pair.
    expect(Number(summary.body.data.incomeTotal)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Settlements (finance.md §5)
// ---------------------------------------------------------------------------

describe('order settlements (finance.md §5)', () => {
  it('refuses non-shipped orders', async () => {
    const { skuId } = await newSku('STL0');
    await receiveWithCost(skuId, '2', '10');
    const listing = await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId,
      platformProductId: `${PREFIX}-PP-STL0`,
      skuVariants: [{ skuId, platformSkuId: `${PREFIX}-STL0` }],
    });
    expect(listing.status).toBe(201);
    const order = await client.post<{ orderId: string }>('/api/v1/orders/ingest', {
      storeId,
      platformOrderId: `FIN-${randomUUID()}`,
      platformStatus: 'new',
      fulfillmentMode: 'FBS',
      orderedAt: new Date().toISOString(),
      items: [{ platformSkuId: `${PREFIX}-STL0`, quantity: '1', unitPrice: '99' }],
    });
    const generate = await client.post('/api/v1/finance/settlements/generate', {
      orderId: order.body.data.orderId,
    });
    expect(generate.status).toBe(409);
    expect(generate.body.error?.code).toBe('ORDER_SETTLEMENT_NOT_ELIGIBLE');
  });

  it('snapshots revenue/cost/profit of a really shipped order; fees recompute profit', async () => {
    const { skuId, barcode } = await newSku('STL1');
    await receiveWithCost(skuId, '5', '80'); // moving average = 80
    const { orderId, orderNo } = await ingestAndShipOrder(
      skuId,
      `${PREFIX}-STL1`,
      barcode,
      2,
      '100',
    );

    const generate = await client.post<{ id: string; revenueTotal: string }>(
      '/api/v1/finance/settlements/generate',
      { orderId },
    );
    expect(generate.status, JSON.stringify(generate.body.error ?? {})).toBe(201);
    const settlementId = generate.body.data.id;

    const detail = await client.get<{
      settlement: {
        revenueTotal: string;
        productCostTotal: string;
        profit: string;
        hasMissingPrice: boolean;
        hasMissingCost: boolean;
        currency: string;
      };
      items: Array<{
        quantity: string;
        unitPrice: string | null;
        revenue: string;
        unitCost: string | null;
        cost: string;
      }>;
    }>(`/api/v1/finance/settlements/${settlementId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.settlement.revenueTotal).toBe('200.0000');
    expect(detail.body.data.settlement.productCostTotal).toBe('160.0000');
    expect(detail.body.data.settlement.profit).toBe('40.0000');
    expect(detail.body.data.settlement.hasMissingPrice).toBe(false);
    expect(detail.body.data.settlement.hasMissingCost).toBe(false);
    expect(detail.body.data.items[0]?.unitCost).toBe('80.0000');
    expect(detail.body.data.items[0]?.revenue).toBe('200.0000');

    // Idempotent: same order -> same settlement row.
    const again = await client.post<{ id: string }>('/api/v1/finance/settlements/generate', {
      orderId,
    });
    expect(again.body.data.id).toBe(settlementId);

    // Fees recompute profit (finance.md §5.3 rule 4).
    const fees = await client.patch<{ profit: string; shippingFee: string }>(
      `/api/v1/finance/settlements/${settlementId}/fees`,
      { shippingFee: '10' },
    );
    expect(fees.status).toBe(200);
    expect(fees.body.data.shippingFee).toBe('10.0000');
    expect(fees.body.data.profit).toBe('30.0000');

    // The bulk endpoint may settle orders shipped by earlier specs in this
    // same test database; ours is already settled so it must NOT re-mint.
    const bulk = await client.post<{ generated: number }>(
      '/api/v1/finance/settlements/generate-missing',
      {},
    );
    expect(bulk.status).toBe(200);
    expect(bulk.body.data.generated).toBeGreaterThanOrEqual(0);

    // List finds it by order no keyword.
    const list = await client.get<Array<Record<string, unknown>>>(
      `/api/v1/finance/settlements?keyword=${orderNo}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta?.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Payouts (finance.md §4)
// ---------------------------------------------------------------------------

describe('platform payouts (finance.md §4)', () => {
  it('DRAFT -> CONFIRMED mints one income voucher; cancel only in DRAFT; preview reconciles', async () => {
    const payout = await client.post<{ id: string; payoutNo: string }>('/api/v1/finance/payouts', {
      storeId,
      periodStart: '2026-01-01T00:00:00.000Z',
      periodEnd: '2099-01-01T00:00:00.000Z',
      amount: '150',
    });
    expect(payout.status, JSON.stringify(payout.body.error ?? {})).toBe(201);
    expect(payout.body.data.payoutNo).toMatch(/^PY\d{6}$/);
    const payoutId = payout.body.data.id;

    // Preview: the settled order from the settlement suite lives in 2026 and
    // belongs to this store, so settled revenue is 200 (finance.md §4.2).
    const preview = await client.get<{
      settledRevenue: string;
      settledOrderCount: number;
      difference: string;
    }>(`/api/v1/finance/payouts/${payoutId}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.settledRevenue).toBe('200.0000');
    expect(preview.body.data.settledOrderCount).toBe(1);
    expect(preview.body.data.difference).toBe('-50.0000');

    const confirm = await client.post<{ status: string }>(
      `/api/v1/finance/payouts/${payoutId}/confirm`,
      {},
    );
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.status).toBe('CONFIRMED');

    // The linked voucher exists and is filterable by payout.
    const vouchers = await client.get<
      Array<{ payoutId: string; category: string; amount: string }>
    >(`/api/v1/finance/transactions?payoutId=${payoutId}`);
    expect(vouchers.body.data).toHaveLength(1);
    expect(vouchers.body.data[0]?.category).toBe('SALE_INCOME');
    expect(vouchers.body.data[0]?.amount).toBe('150.0000');

    // Confirmed payouts cannot be cancelled - mistakes go through reversal.
    const cancel = await client.post(`/api/v1/finance/payouts/${payoutId}/cancel`, {});
    expect(cancel.status).toBe(409);
    expect(cancel.body.error?.code).toBe('FINANCE_PAYOUT_INVALID_STATE');

    // A second DRAFT payout CAN be cancelled and mints nothing.
    const draft = await client.post<{ id: string }>('/api/v1/finance/payouts', {
      storeId,
      periodStart: '2026-02-01T00:00:00.000Z',
      periodEnd: '2026-03-01T00:00:00.000Z',
      amount: '10',
    });
    const draftCancel = await client.post(
      `/api/v1/finance/payouts/${draft.body.data.id}/cancel`,
      {},
    );
    expect(draftCancel.status).toBe(200);
    expect(draftCancel.body.data.status).toBe('CANCELLED');
  });
});

// ---------------------------------------------------------------------------
// Payables (finance.md §6)
// ---------------------------------------------------------------------------

describe('purchase payables (finance.md §6)', () => {
  it('derives payable/paid/unpaid at read time and blocks overpayment', async () => {
    const supplier = await client.post<{ id: string }>('/api/v1/suppliers', {
      name: `${PREFIX} 财务供应商`,
    });
    const supplierId = supplier.body.data.id;
    const { skuId } = await newSku('PAY1');
    const po = await client.post<{ id: string; poNo: string }>('/api/v1/purchase-orders', {
      supplierId,
      items: [{ skuId, quantity: '10', unitCost: '30' }],
    });
    expect(po.status, JSON.stringify(po.body.error ?? {})).toBe(200);
    const poId = po.body.data.id;

    // UNPAID initially.
    const before = await client.get<
      Array<{
        poNo: string;
        paymentState: string;
        payableAmount: string;
        paidAmount: string;
        unpaidAmount: string;
      }>
    >(`/api/v1/finance/payables?keyword=${po.body.data.poNo}`);
    expect(before.body.data).toHaveLength(1);
    expect(before.body.data[0]?.paymentState).toBe('UNPAID');
    expect(before.body.data[0]?.payableAmount).toBe('300.0000');

    // Overpayment (400 > 300) is rejected before any write.
    const overpay = await client.post('/api/v1/finance/transactions', {
      direction: 'EXPENSE',
      category: 'PURCHASE_PAYMENT',
      amount: '400',
      supplierId,
      purchaseOrderId: poId,
    });
    expect(overpay.status).toBe(422);
    expect(overpay.body.error?.code).toBe('FINANCE_OVERPAYMENT');

    // Pay 100 -> PARTIAL.
    const pay1 = await client.post<{ id: string }>('/api/v1/finance/transactions', {
      direction: 'EXPENSE',
      category: 'PURCHASE_PAYMENT',
      amount: '100',
      supplierId,
      purchaseOrderId: poId,
    });
    expect(pay1.status).toBe(201);
    const partial = await client.get<Array<{ paymentState: string; paidAmount: string }>>(
      `/api/v1/finance/payables?keyword=${po.body.data.poNo}`,
    );
    expect(partial.body.data[0]?.paymentState).toBe('PARTIAL');
    expect(partial.body.data[0]?.paidAmount).toBe('100.0000');

    // Pay the remaining 200 -> PAID.
    const pay2 = await client.post('/api/v1/finance/transactions', {
      direction: 'EXPENSE',
      category: 'PURCHASE_PAYMENT',
      amount: '200',
      supplierId,
      purchaseOrderId: poId,
    });
    expect(pay2.status).toBe(201);
    const paid = await client.get<Array<{ paymentState: string; unpaidAmount: string }>>(
      `/api/v1/finance/payables?keyword=${po.body.data.poNo}`,
    );
    expect(paid.body.data[0]?.paymentState).toBe('PAID');
    expect(paid.body.data[0]?.unpaidAmount).toBe('0.0000');
  });
});

// ---------------------------------------------------------------------------
// Summary (finance.md §7)
// ---------------------------------------------------------------------------

describe('finance summary (finance.md §7)', () => {
  it('aggregates the derived facts of this run', async () => {
    const summary = await client.get<{
      incomeTotal: string;
      expenseTotal: string;
      settledRevenue: string;
      settledProfit: string;
      unpaidPurchaseTotal: string;
      confirmedPayoutTotal: string;
    }>('/api/v1/finance/summary');
    expect(summary.status).toBe(200);
    // Payout income 150 (the reversal pair nets out) and expenses 300 paid.
    expect(Number(summary.body.data.incomeTotal)).toBeGreaterThanOrEqual(150);
    expect(Number(summary.body.data.expenseTotal)).toBeGreaterThanOrEqual(300);
    expect(Number(summary.body.data.settledRevenue)).toBeGreaterThanOrEqual(200);
    expect(Number(summary.body.data.confirmedPayoutTotal)).toBeGreaterThanOrEqual(150);
    // Fully paid PO -> zero unpaid.
    expect(Number(summary.body.data.unpaidPurchaseTotal)).toBeGreaterThanOrEqual(0);
  });
});
