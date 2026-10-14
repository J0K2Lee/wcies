import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 9 acceptance (planning T1/T2/T3/T5) + dual-axis T2 semantics:
 *
 * - platform cancel propagation: a RESERVED order re-synced as `cancelled`
 *   releases its reservation and cancels through the EXISTING chain;
 * - a BACKORDERED (no reservation) order cancels with ZERO stock movement and
 *   its ORDER_OUT_OF_STOCK exception closes;
 * - a PICKED order cancels into an interception (no stock restore);
 * - repeated cancelled re-syncs release exactly once; unchanged facts write
 *   nothing;
 * - deadline re-evaluation on re-encounter (raise when < 24h / overdue,
 *   resolve when pushed out);
 * - interception return-to-stock auto-creates a STAGING bin when the
 *   warehouse has none;
 * - consecutive sync failures open a deduped SYNC_FAILED (STORE) exception
 *   and a later success resolves it.
 *
 * Delivery channel note (dual-axis T2): the fallback refresh pass is now a
 * FAIR ROTATION (fallback window below ~29s), so same-run re-syncs no longer
 * re-read fresh orders. Cancellation/deadline updates therefore arrive via
 * the WEBHOOK event path (TYPE_POSTING_CANCELLED / TYPE_STATE_CHANGED ->
 * targeted re-read), which is the production primary channel anyway
 * (acceptance §4: event path <= 1 min; fallback rotation is the 24h safety
 * net, covered by order-facts-rotation.integration.spec.ts).
 */

const PREFIX = runPrefix();
const BASE = 'http://localhost:3117';
const client = new ApiClient(BASE);

const API_KEY = 'it-test-api-key-s9';
const CLIENT_ID = '333000333';
/** ~29s fallback window (dual-axis T2): short enough to wait out once. */
const FALLBACK_HOURS = '0.008';
/** Wall-clock wait until the rotation window elapses (window + margin). */
const FALLBACK_WINDOW_WAIT_MS = 32_000;

interface MockPostingProduct {
  offer_id: string;
  sku: number;
  quantity: number;
  price: string;
  currency_code: string;
}
interface MockPosting {
  posting_number: string;
  status: string;
  in_process_at: string;
  shipment_date?: string;
  products: MockPostingProduct[];
}

interface StoreScript {
  failMode: 'none' | 'serverError';
  postings: MockPosting[];
}

const script: StoreScript = { failMode: 'none', postings: [] };
let mockOzon: Server;
let mockOzonUrl = '';

let ozonPlatformId = '';
let storeId = '';
let storeCode = '';
let warehouseId = '';
let binId = '';

function startMockOzon(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const clientId = String(req.headers['client-id'] ?? '');
      const apiKey = String(req.headers['api-key'] ?? '');
      const url = req.url ?? '';
      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (clientId !== CLIENT_ID || apiKey !== API_KEY) {
        send(401, { code: 16, message: 'client-id or api-key not found' });
        return;
      }
      if (script.failMode === 'serverError') {
        send(500, { code: 500, message: 'internal error (scripted)' });
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = body === '' ? {} : (JSON.parse(body) as Record<string, unknown>);
      } catch {
        send(400, { code: 400, message: 'bad json' });
        return;
      }
      if (url === '/v3/product/list') {
        send(200, { result: { last_id: 'last', items: [] } });
        return;
      }
      if (url === '/v3/posting/fbs/list') {
        const filter = (parsed['filter'] as { since?: string; to?: string } | undefined) ?? {};
        const since = filter.since ?? '1970-01-01T00:00:00Z';
        const to = filter.to ?? '2999-01-01T00:00:00Z';
        const matched = script.postings.filter(
          (p) => p.in_process_at >= since && p.in_process_at <= to,
        );
        send(200, { result: { has_next: false, postings: matched } });
        return;
      }
      if (url === '/v3/posting/fbs/get') {
        const number = typeof parsed['posting_number'] === 'string' ? parsed['posting_number'] : '';
        const posting = script.postings.find((p) => p.posting_number === number);
        if (posting === undefined) {
          send(404, { code: 404, message: 'posting not found' });
          return;
        }
        send(200, { result: posting });
        return;
      }
      send(404, { code: 404, message: `unknown mock endpoint ${url}` });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let api: ManagedProcess;
let worker: ManagedProcess;

interface SyncJobDto {
  id: string;
  status: string;
  successCount: number;
  failedCount: number;
  skippedCount: number;
}

async function waitForJob(jobId: string, timeoutMs = 40_000): Promise<SyncJobDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await client.get<SyncJobDto>(`/api/v1/sync/jobs/${jobId}`);
    const job = response.body.data;
    if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(job.status)) {
      return job;
    }
    if (Date.now() > deadline) {
      throw new Error(`sync job ${jobId} did not finish (last: ${JSON.stringify(job)})`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function syncOrders(): Promise<SyncJobDto> {
  const dispatch = await client.post<SyncJobDto>('/api/v1/sync/orders', { storeId });
  expect(dispatch.status).toBe(202);
  return waitForJob(dispatch.body.data.id);
}

function makePosting(
  number: string,
  items: Array<{ offerId: string; sku: number; quantity?: number }>,
  options: { minutesAgo?: number; status?: string; shipmentDate?: string } = {},
): MockPosting {
  return {
    posting_number: number,
    status: options.status ?? 'awaiting_packaging',
    in_process_at: new Date(Date.now() - (options.minutesAgo ?? 5) * 60_000).toISOString(),
    ...(options.shipmentDate !== undefined ? { shipment_date: options.shipmentDate } : {}),
    products: items.map((item) => ({
      offer_id: item.offerId,
      sku: item.sku,
      quantity: item.quantity ?? 1,
      price: '100.00',
      currency_code: 'RUB',
    })),
  };
}

/** Mapped SKU with stock in the shared warehouse bin. */
async function newMappedSkuWithStock(
  label: string,
  platformSkuId: number,
  quantity: string,
): Promise<string> {
  const sku = await client.post<{ id: string }>('/api/v1/skus', {
    nameZh: `${PREFIX} ${label}SKU`,
  });
  const skuId = sku.body.data.id;
  const received = await client.post('/api/v1/inventory/initialize', {
    skuId,
    warehouseId,
    binId,
    quantity,
    condition: 'SELLABLE',
    referenceType: 'MANUAL',
    referenceId: randomUUID(),
    idempotencyKey: `IT-S9-INIT:${randomUUID()}`,
  });
  expect(received.status).toBe(200);
  await client.post('/api/v1/listings', {
    platformId: ozonPlatformId,
    storeId,
    platformProductId: `${PREFIX}-${label}-PP`,
    skuVariants: [{ skuId, platformSkuId: String(platformSkuId) }],
  });
  return skuId;
}

interface OrderDetailShape {
  id: string;
  orderNo: string;
  erpStatus: string;
  platformStatus: string | null;
  updatedAt: string;
  items: Array<{
    id: string;
    fulfillmentStatus: string;
    mappingStatus: string;
    reservationId: string | null;
    quantity: string;
    exceptions: Array<{ exceptionType: string; status: string }>;
  }>;
  history: Array<{ toStatus: string; reason: string | null; createdAt: string }>;
  platformStatusHistory: Array<{
    fromStatus: string | null;
    toStatus: string;
    source: string | null;
  }> | null;
  interceptions: Array<{ interceptionNo: string; status: string }>;
}

async function orderByPlatformId(platformOrderId: string): Promise<OrderDetailShape> {
  const list = await client.get<Array<{ id: string }>>(
    `/api/v1/orders?keyword=${encodeURIComponent(platformOrderId)}&pageSize=10`,
  );
  const match = list.body.data[0];
  expect(match).toBeDefined();
  const detail = await client.get<OrderDetailShape>(`/api/v1/orders/${match?.id}`);
  return detail.body.data;
}

async function inventoryOf(skuId: string): Promise<{
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
}> {
  const list = await client.get<
    Array<{ skuId: string; onHandQty: string; reservedQty: string; pickedQty: string }>
  >(`/api/v1/inventory?skuId=${skuId}&pageSize=10`);
  expect(list.body.data.length).toBeGreaterThan(0);
  return list.body.data[0]!;
}

async function transactionCountOf(skuId: string): Promise<number> {
  const list = await client.get<Array<{ id: string }>>(
    `/api/v1/inventory/transactions?skuId=${skuId}&pageSize=100`,
  );
  return list.body.data.length;
}

async function exceptionsOf(
  referenceId: string,
  exceptionType?: string,
): Promise<Array<{ id: string; status: string; exceptionType: string }>> {
  const query = new URLSearchParams({ referenceType: 'ORDER', referenceId, pageSize: '50' });
  if (exceptionType !== undefined) {
    query.set('exceptionType', exceptionType);
  }
  const list = await client.get<Array<{ id: string; status: string; exceptionType: string }>>(
    `/api/v1/exceptions?${query.toString()}`,
  );
  return list.body.data;
}

async function exceptionsOfItem(
  referenceId: string,
): Promise<Array<{ status: string; exceptionType: string }>> {
  const list = await client.get<Array<{ status: string; exceptionType: string }>>(
    `/api/v1/exceptions?referenceType=ORDER_ITEM&referenceId=${referenceId}&pageSize=50`,
  );
  return list.body.data;
}

interface RawEventDto {
  id: string;
  eventType: string;
  status: string;
  payload: Record<string, unknown>;
}

/**
 * Posts a webhook event (the production primary channel since T2) and waits
 * until the worker finishes it. The re-read delivers the mock's CURRENT
 * posting facts, so callers mutate script.postings BEFORE calling this.
 */
async function postWebhookEvent(
  messageType: 'TYPE_STATE_CHANGED' | 'TYPE_POSTING_CANCELLED',
  postingNumber: string,
  changedStateDate: string,
): Promise<void> {
  const payload = {
    message_type: messageType,
    posting_number: postingNumber,
    new_state: messageType === 'TYPE_POSTING_CANCELLED' ? 'posting_canceled' : 'posting_changed',
    changed_state_date: changedStateDate,
    seller_id: Number(CLIENT_ID),
  };
  const response = await client.post(`/api/v1/webhooks/ozon/stores/${storeCode}`, payload);
  expect(response.status).toBe(200);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const list = await client.get<RawEventDto[]>(
      `/api/v1/sync/events?storeId=${storeId}&pageSize=100`,
    );
    const mine = list.body.data.filter(
      (row) => row.payload['changed_state_date'] === changedStateDate,
    );
    if (mine.length > 0 && ['PROCESSED', 'FAILED', 'SKIPPED'].includes(mine[0]?.status ?? '')) {
      expect(mine[0]?.status).toBe('PROCESSED');
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `webhook event did not finish (got: ${JSON.stringify(mine.map((e) => e.status))})`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  mockOzon = await startMockOzon();
  const address = mockOzon.address() as AddressInfo;
  mockOzonUrl = `http://127.0.0.1:${address.port}`;

  const env = {
    PORT: '3117',
    REDIS_URL: 'redis://localhost:6379/11',
    OZON_API_BASE_URL: mockOzonUrl,
    OZON_MIN_REQUEST_INTERVAL_MS: '0',
    ORDER_STATE_FALLBACK_HOURS: FALLBACK_HOURS,
  };
  api = spawnApiEntry('main.js', env);
  worker = spawnApiEntry('worker.js', env);
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  storeCode = `${PREFIX}-A`;
  const store = await client.post<{ id: string }>('/api/v1/stores', {
    platformId: ozonPlatformId,
    storeCode,
    name: `${PREFIX} A店`,
  });
  storeId = store.body.data.id;
  await client.post(`/api/v1/stores/${storeId}/credentials`, {
    credentialType: 'MAIN_API',
    payload: { clientId: CLIENT_ID, apiKey: API_KEY },
  });

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 测试仓`,
    warehouseType: 'SELF',
  });
  warehouseId = warehouse.body.data.id;
  // Deliberately NO STAGING bin - T3's fallback must create one on demand.
  const bins = await client.post<{ bins: Array<{ binCode: string; id: string }> }>(
    `/api/v1/warehouses/${warehouseId}/bins/batch`,
    { zone: 'A', rackStart: 1, rackCount: 1, levelsPerRack: 1 },
  );
  binId = bins.body.data.bins[0]!.id;

  await bindPlatformWarehouse(client, storeId, warehouseId, 'OZON_RFBS');
}, 180_000);

afterAll(async () => {
  await api.stop();
  await worker.stop();
  await new Promise<void>((resolve) => mockOzon.close(() => resolve()));
});

// ---------------------------------------------------------------------------

describe('platform cancellation propagation (T1, decision 1-D1b=A)', () => {
  it('RESERVED order: cancelled re-sync releases the reservation and cancels', async () => {
    const skuId = await newMappedSkuWithStock('RSV', 700000001, '10');
    script.postings.push(
      makePosting('IT-S9-RSV-1', [{ offerId: 'RSV', sku: 700000001, quantity: 2 }], {
        minutesAgo: 30,
      }),
    );
    const job1 = await syncOrders();
    expect(job1.status).toBe('SUCCESS');

    const before = await orderByPlatformId('IT-S9-RSV-1');
    expect(before.erpStatus).toBe('READY_TO_PICK');
    expect(before.items[0]?.fulfillmentStatus).toBe('RESERVED');
    const invBefore = await inventoryOf(skuId);
    expect(Number(invBefore.reservedQty)).toBe(2);

    // Dual-axis T2: the platform cancellation arrives through the webhook
    // event path (TYPE_POSTING_CANCELLED -> targeted re-read of the mock's
    // CURRENT facts). The window cursor has long moved past this posting.
    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-RSV-1')!;
    posting.status = 'cancelled';
    await postWebhookEvent('TYPE_POSTING_CANCELLED', 'IT-S9-RSV-1', '2026-09-15T09:00:01.000Z');

    const after = await orderByPlatformId('IT-S9-RSV-1');
    expect(after.platformStatus).toBe('cancelled');
    expect(after.erpStatus).toBe('CANCELLED');
    expect(after.items[0]?.fulfillmentStatus).toBe('RELEASED');
    // platform_status_history recorded the transition, returned by getDetail.
    const transitions = after.platformStatusHistory ?? [];
    expect(
      transitions.some((t) => t.fromStatus === 'awaiting_packaging' && t.toStatus === 'cancelled'),
    ).toBe(true);

    // Stock: reservation released, available restored, on-hand untouched.
    const invAfter = await inventoryOf(skuId);
    expect(Number(invAfter.reservedQty)).toBe(0);
    expect(Number(invAfter.onHandQty)).toBe(10);
  });

  it('repeated cancelled re-sync releases exactly once (idempotent, zero new writes)', async () => {
    const before = await orderByPlatformId('IT-S9-RSV-1');
    const historyCount = before.history.length;
    const transitionsBefore = (before.platformStatusHistory ?? []).length;

    // A second, distinct cancellation event (new payload hash): the re-read
    // finds the facts already applied - cancel() early-returns, no history
    // rows, no duplicate transitions. (orders.updatedAt DOES move: the
    // rotation cursor platform_facts_checked_at is stamped by design.)
    await postWebhookEvent('TYPE_POSTING_CANCELLED', 'IT-S9-RSV-1', '2026-09-15T09:05:02.000Z');

    const after = await orderByPlatformId('IT-S9-RSV-1');
    expect(after.erpStatus).toBe('CANCELLED');
    expect(after.items[0]?.fulfillmentStatus).toBe('RELEASED');
    // No state churn: no new ERP history rows, no duplicate platform
    // transitions.
    expect(after.history.length).toBe(historyCount);
    expect((after.platformStatusHistory ?? []).length).toBe(transitionsBefore);
  });

  it('BACKORDERED order (no reservation): cancelled re-sync closes order + exception, zero stock writes', async () => {
    const skuId = await newMappedSkuWithStock('BKO', 700000002, '0.001');
    script.postings.push(
      makePosting('IT-S9-BKO-1', [{ offerId: 'BKO', sku: 700000002, quantity: 1 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    const before = await orderByPlatformId('IT-S9-BKO-1');
    expect(before.erpStatus).toBe('BACKORDERED');
    expect(before.items[0]?.fulfillmentStatus).toBe('BACKORDERED');
    expect(before.items[0]?.reservationId).toBeNull();
    const outOfStock = await exceptionsOfItem(before.items[0]!.id);
    expect(
      outOfStock.some((e) => e.exceptionType === 'ORDER_OUT_OF_STOCK' && e.status === 'OPEN'),
    ).toBe(true);
    const txCount = await transactionCountOf(skuId);

    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-BKO-1')!;
    posting.status = 'cancelled';
    await postWebhookEvent('TYPE_POSTING_CANCELLED', 'IT-S9-BKO-1', '2026-09-15T09:10:03.000Z');

    const after = await orderByPlatformId('IT-S9-BKO-1');
    expect(after.erpStatus).toBe('CANCELLED');
    expect(after.items[0]?.fulfillmentStatus).toBe('RELEASED');
    // The out-of-stock exception closed; the ledger saw ZERO new rows.
    const closed = await exceptionsOfItem(after.items[0]!.id);
    expect(
      closed.every((e) => e.exceptionType !== 'ORDER_OUT_OF_STOCK' || e.status !== 'OPEN'),
    ).toBe(true);
    expect(await transactionCountOf(skuId)).toBe(txCount);
  });

  it('PICKED order: cancelled re-sync creates an interception and does NOT restore stock (§78 Case 3)', async () => {
    const skuId = await newMappedSkuWithStock('PCK', 700000003, '5');
    const barcode = `${PREFIX}-PCK-BAR`;
    await client.post(`/api/v1/skus/${skuId}/barcodes`, {
      barcode,
      barcodeType: 'EAN',
    });
    script.postings.push(
      makePosting('IT-S9-PCK-1', [{ offerId: 'PCK', sku: 700000003, quantity: 1 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    const reserved = await orderByPlatformId('IT-S9-PCK-1');
    expect(reserved.items[0]?.fulfillmentStatus).toBe('RESERVED');

    // Pick the single unit so the line becomes PICKED.
    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: reserved.id,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    const scan = await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    expect(scan.status).toBe(200);
    const picked = await orderByPlatformId('IT-S9-PCK-1');
    expect(picked.items[0]?.fulfillmentStatus).toBe('PICKED');
    const invPicked = await inventoryOf(skuId);
    expect(Number(invPicked.pickedQty)).toBe(1);

    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-PCK-1')!;
    posting.status = 'cancelled';
    await postWebhookEvent('TYPE_POSTING_CANCELLED', 'IT-S9-PCK-1', '2026-09-15T09:15:04.000Z');

    const after = await orderByPlatformId('IT-S9-PCK-1');
    expect(after.erpStatus).toBe('CANCELLED');
    // The line stays PICKED and the interception owns the physical recovery -
    // availability is NEVER restored directly (AGENTS.md §42).
    expect(after.items[0]?.fulfillmentStatus).toBe('PICKED');
    expect(after.interceptions.length).toBe(1);
    expect(after.interceptions[0]?.status).toBe('CREATED');
    const invAfter = await inventoryOf(skuId);
    expect(Number(invAfter.pickedQty)).toBe(1);
    expect(Number(invAfter.reservedQty)).toBe(0);
  });

  it('a NEW order arriving already cancelled is ingested then auto-cancelled', async () => {
    const skuId = await newMappedSkuWithStock('NEWC', 700000004, '8');
    script.postings.push(
      makePosting('IT-S9-NEWC-1', [{ offerId: 'NEWC', sku: 700000004, quantity: 1 }], {
        minutesAgo: 0,
        status: 'cancelled',
      }),
    );
    const job = await syncOrders();
    expect(['SUCCESS', 'PARTIAL']).toContain(job.status);

    const order = await orderByPlatformId('IT-S9-NEWC-1');
    expect(order.platformStatus).toBe('cancelled');
    expect(order.erpStatus).toBe('CANCELLED');
    expect(order.items[0]?.fulfillmentStatus).toBe('RELEASED');
    const inv = await inventoryOf(skuId);
    expect(Number(inv.reservedQty)).toBe(0);
    expect(Number(inv.onHandQty)).toBe(8);
  });
});

describe('deadline re-evaluation on re-encounter (T1, orders.md §16)', () => {
  it('raises when the deadline crosses into <24h and resolves when pushed out', async () => {
    await newMappedSkuWithStock('DDL', 700000005, '3');
    const far = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    script.postings.push(
      makePosting('IT-S9-DDL-1', [{ offerId: 'DDL', sku: 700000005, quantity: 1 }], {
        minutesAgo: 0,
        shipmentDate: far,
      }),
    );
    await syncOrders();

    const order = await orderByPlatformId('IT-S9-DDL-1');
    expect(order.erpStatus).not.toBe('CANCELLED');
    expect(await exceptionsOf(order.id, 'ORDER_SHIPMENT_DEADLINE_NEAR')).toHaveLength(0);

    // Platform pushes the deadline into the past -> the next webhook-driven
    // re-encounter must raise (deadline re-evaluation runs on EVERY
    // encounter, changed or not - orders.md §16).
    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-DDL-1')!;
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    posting.shipment_date = past;
    await postWebhookEvent('TYPE_STATE_CHANGED', 'IT-S9-DDL-1', '2026-09-15T09:20:05.000Z');

    const raised = await exceptionsOf(order.id, 'ORDER_SHIPMENT_DEADLINE_NEAR');
    expect(raised.some((e) => e.status === 'OPEN')).toBe(true);

    // Platform pushes it far out again -> the OPEN alert resolves.
    const far2 = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    posting.shipment_date = far2;
    await postWebhookEvent('TYPE_STATE_CHANGED', 'IT-S9-DDL-1', '2026-09-15T09:25:06.000Z');

    const resolved = await exceptionsOf(order.id, 'ORDER_SHIPMENT_DEADLINE_NEAR');
    expect(resolved.every((e) => e.status !== 'OPEN')).toBe(true);
  });
});

describe('interception STAGING fallback (T3, decision 4 = A)', () => {
  it('return-to-stock without a scanned bin auto-creates STAGING and completes', async () => {
    const skuId = await newMappedSkuWithStock('STG', 700000006, '4');
    const barcode = `${PREFIX}-STG-BAR`;
    await client.post(`/api/v1/skus/${skuId}/barcodes`, { barcode, barcodeType: 'EAN' });
    script.postings.push(
      makePosting('IT-S9-STG-1', [{ offerId: 'STG', sku: 700000006, quantity: 1 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    const reserved = await orderByPlatformId('IT-S9-STG-1');
    const created = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: reserved.id,
    });
    const taskId = created.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });

    // Manual cancel takes the PICKED line into an interception.
    const cancelled = await client.post(`/api/v1/orders/${reserved.id}/cancel`, {
      reason: '拦截暂存位测试',
    });
    expect(cancelled.status).toBe(200);

    const withInterception = await orderByPlatformId('IT-S9-STG-1');
    const interception = withInterception.interceptions[0];
    expect(interception).toBeDefined();

    // List interceptions to get the id (order detail exposes the no only).
    const interceptions = await client.get<
      Array<{ interceptionNo: string; id: string; status: string }>
    >(`/api/v1/interceptions?pageSize=50`);
    const target = interceptions.body.data.find(
      (row) => row.interceptionNo === interception?.interceptionNo,
    );
    expect(target).toBeDefined();

    // NO binBarcode: the old code threw here; now a STAGING bin is created.
    const returned = await client.post(`/api/v1/interceptions/${target!.id}/return-to-stock`, {});
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('RETURNED_TO_STOCK');

    const bins = await client.get<Array<{ binCode: string; id: string }>>(
      `/api/v1/warehouses/${warehouseId}/bins?pageSize=100`,
    );
    expect(bins.body.data.some((bin) => bin.binCode === 'STAGING')).toBe(true);

    // Stock actually returned: picked back to 0, reserved 0, on-hand intact.
    const inv = await inventoryOf(skuId);
    expect(Number(inv.pickedQty)).toBe(0);
    expect(Number(inv.reservedQty)).toBe(0);
    expect(Number(inv.onHandQty)).toBe(4);

    const after = await orderByPlatformId('IT-S9-STG-1');
    expect(after.items[0]?.fulfillmentStatus).toBe('RELEASED');
  });
});

describe('SYNC_FAILED exception (T2, decision 3)', () => {
  it('opens after 3 consecutive failures (one OPEN per store) and resolves on success', async () => {
    script.failMode = 'serverError';
    for (let i = 0; i < 3; i += 1) {
      const job = await syncOrders();
      expect(job.status).toBe('FAILED');
    }

    const open = await client.get<
      Array<{
        id: string;
        status: string;
        exceptionType: string;
        referenceId: string;
        storeId: string | null;
      }>
    >(`/api/v1/exceptions?exceptionType=SYNC_FAILED&status=OPEN&pageSize=20`);
    const mine = open.body.data.filter((row) => row.storeId === storeId);
    expect(mine.length).toBe(1);
    expect(mine[0]?.referenceId).toBe(storeId);

    // Recovery: the next successful sync resolves the OPEN row.
    script.failMode = 'none';
    const job = await syncOrders();
    expect(job.status).toBe('SUCCESS');

    const after = await client.get<Array<{ status: string; storeId: string | null }>>(
      `/api/v1/exceptions?exceptionType=SYNC_FAILED&pageSize=50`,
    );
    const stillOpen = after.body.data.filter(
      (row) => row.storeId === storeId && row.status === 'OPEN',
    );
    expect(stillOpen).toHaveLength(0);
  });
});

describe('mark external fulfillment (T6, decision 6 = A)', () => {
  it('closes a BACKORDERED order without stock movement and closes its exceptions', async () => {
    const skuId = await newMappedSkuWithStock('EXT', 700000007, '0.001');
    script.postings.push(
      makePosting('IT-S9-EXT-1', [{ offerId: 'EXT', sku: 700000007, quantity: 2 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    const before = await orderByPlatformId('IT-S9-EXT-1');
    expect(before.erpStatus).toBe('BACKORDERED');
    const txCount = await transactionCountOf(skuId);

    const marked = await client.post(`/api/v1/orders/${before.id}/mark-external-fulfillment`, {
      reason: '线下采购直发买家（测试）',
    });
    expect(marked.status).toBe(200);
    expect(marked.body.data.erpStatus).toBe('SHIPPED');
    expect(marked.body.data.releasedItems).toBe(1);

    const after = await orderByPlatformId('IT-S9-EXT-1');
    expect(after.erpStatus).toBe('SHIPPED');
    expect(after.items[0]?.fulfillmentStatus).toBe('RELEASED');
    expect(await transactionCountOf(skuId)).toBe(txCount);
    const itemExceptions = await exceptionsOfItem(after.items[0]!.id);
    expect(
      itemExceptions.every((e) => e.exceptionType !== 'ORDER_OUT_OF_STOCK' || e.status !== 'OPEN'),
    ).toBe(true);

    // A RESERVED-line order must be rejected (stock release belongs to cancel).
    const reservedOrder = await orderByPlatformId('IT-S9-DDL-1');
    const rejected = await client.post(
      `/api/v1/orders/${reservedOrder.id}/mark-external-fulfillment`,
      { reason: 'should reject' },
    );
    expect(rejected.status).toBeGreaterThanOrEqual(400);
  });
});

describe('platform-shipped convergence (用户指示 2026-10-14, orders.md §7a.0)', () => {
  it('a factually-shipped (delivering) order is never blocked by out-of-stock', async () => {
    // 库存 0.001 < 订单 2：摄入即缺货（BACKORDERED + OPEN 缺货异常）。
    const skuId = await newMappedSkuWithStock('PSD', 700000011, '0.001');
    script.postings.push(
      makePosting('IT-S9-PSD-1', [{ offerId: 'PSD', sku: 700000011, quantity: 2 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    const before = await orderByPlatformId('IT-S9-PSD-1');
    expect(before.erpStatus).toBe('BACKORDERED');
    expect(before.items[0]?.fulfillmentStatus).toBe('BACKORDERED');
    const openBefore = await exceptionsOfItem(before.items[0]!.id);
    expect(
      openBefore.some((e) => e.exceptionType === 'ORDER_OUT_OF_STOCK' && e.status === 'OPEN'),
    ).toBe(true);
    const txCount = await transactionCountOf(skuId);

    // 平台侧发货（webhook 是生产主通道）：回读拿到 delivering 事实后，
    // 缺货与现实矛盾——订单按平台事实收敛，不再被缺货阻塞。
    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-PSD-1')!;
    posting.status = 'delivering';
    (posting as MockPosting & { delivering_date?: string }).delivering_date =
      new Date().toISOString();
    await postWebhookEvent('TYPE_STATE_CHANGED', 'IT-S9-PSD-1', new Date().toISOString());

    const after = await orderByPlatformId('IT-S9-PSD-1');
    expect(after.erpStatus).toBe('SHIPPED');
    expect(after.items[0]?.fulfillmentStatus).toBe('EXTERNAL_FULFILLED');
    // 缺货异常关闭；没有任何库存流水（行从未持有内部库存）。
    const openAfter = await exceptionsOfItem(after.items[0]!.id);
    expect(
      openAfter.every((e) => e.exceptionType !== 'ORDER_OUT_OF_STOCK' || e.status !== 'OPEN'),
    ).toBe(true);
    expect(await transactionCountOf(skuId)).toBe(txCount);
    // 缺货筛选不再命中（行已非 BACKORDERED/PENDING）；物流阶段进入「在途」。
    const backorderedList = await client.get<Array<{ id: string }>>(
      `/api/v1/orders?keyword=IT-S9-PSD-1&goodsState=BACKORDERED&pageSize=10`,
    );
    expect(backorderedList.body.data).toHaveLength(0);
    const inTransitList = await client.get<Array<{ id: string }>>(
      `/api/v1/orders?keyword=IT-S9-PSD-1&stage=IN_TRANSIT&pageSize=10`,
    );
    expect(inTransitList.body.data.length).toBeGreaterThan(0);
  }, 120_000);

  it('the unmapped exception still blocks a factually-shipped order (birth-delivering)', async () => {
    // 无 Listing → 映射失败；订单摄入时平台已 delivering。未映射异常是
    // 唯一被允许的阻塞：订单保持 EXCEPTION，不转 SHIPPED。
    await client.post<{ id: string }>('/api/v1/skus', { nameZh: `${PREFIX} PSD-UNMAPPED SKU` });
    script.postings.push(
      makePosting('IT-S9-PSD-2', [{ offerId: 'PSD-UNMAPPED', sku: 700000012, quantity: 1 }], {
        minutesAgo: 0,
        status: 'delivering',
      }),
    );
    await syncOrders();

    const order = await orderByPlatformId('IT-S9-PSD-2');
    expect(order.erpStatus).toBe('EXCEPTION');
    expect(order.items[0]?.mappingStatus).toBe('FAILED');
    expect(order.items[0]?.fulfillmentStatus).not.toBe('EXTERNAL_FULFILLED');
    const itemExceptions = await exceptionsOfItem(order.items[0]!.id);
    expect(
      itemExceptions.some(
        (e) => e.exceptionType === 'ORDER_SKU_MAPPING_FAILED' && e.status === 'OPEN',
      ),
    ).toBe(true);
  }, 120_000);

  it('does not auto-close an order whose internal fulfillment is in progress (RESERVED line)', async () => {
    // 货可能还在我们仓内：平台状态与现实谁对谁错留给人判（双轴差异
    // 协议）——不自动转 SHIPPED，占用中的库存不动。
    const skuId = await newMappedSkuWithStock('PSR', 700000013, '5');
    script.postings.push(
      makePosting('IT-S9-PSR-1', [{ offerId: 'PSR', sku: 700000013, quantity: 1 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    const before = await orderByPlatformId('IT-S9-PSR-1');
    expect(before.erpStatus).toBe('READY_TO_PICK');
    expect(before.items[0]?.fulfillmentStatus).toBe('RESERVED');

    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-PSR-1')!;
    posting.status = 'delivering';
    (posting as MockPosting & { delivering_date?: string }).delivering_date =
      new Date().toISOString();
    await postWebhookEvent('TYPE_STATE_CHANGED', 'IT-S9-PSR-1', new Date().toISOString());

    const after = await orderByPlatformId('IT-S9-PSR-1');
    expect(after.erpStatus).toBe('READY_TO_PICK');
    expect(after.items[0]?.fulfillmentStatus).toBe('RESERVED');
    const inventory = await inventoryOf(skuId);
    expect(inventory.reservedQty).toBe('1.000');
  }, 120_000);
});

describe('platform logistics stall (dual-axis T4, orders.md §16A)', () => {
  it('IN_TRANSIT anchored >3 days ago raises ORDER_TRACKING_STALLED; pure re-read resolves it', async () => {
    await newMappedSkuWithStock('STL', 700000008, '6');
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    script.postings.push({
      posting_number: 'IT-S9-STL-1',
      status: 'delivering',
      in_process_at: new Date().toISOString(),
      delivering_date: fourDaysAgo,
      products: [
        {
          offer_id: 'STL',
          sku: 700000008,
          quantity: 1,
          price: '100.00',
          currency_code: 'RUB',
        },
      ],
    });

    // Pure ORDER_SYNC path (no webhook): window pass ingests IN_TRANSIT with
    // the PLATFORM's 4-day-old delivering_date as the anchor, then the
    // first rotation read evaluates the stall - the anchor, not our receive
    // time, decides.
    await syncOrders();
    const order = await orderByPlatformId('IT-S9-STL-1');
    // 平台已事实发货收敛（用户指示 2026-10-14，orders.md §7a.0）：摄入时
    // 平台阶段即 IN_TRANSIT——不预留库存、按平台事实直接 SHIPPED（行
    // EXTERNAL_FULFILLED）；物流停滞是平台侧事实，仍照常评估。
    expect(order.erpStatus).toBe('SHIPPED');
    const stalled = await exceptionsOf(order.id, 'ORDER_TRACKING_STALLED');
    expect(stalled.some((e) => e.status === 'OPEN')).toBe(true);

    // Platform finally delivers. The fallback rotation (window elapsed)
    // re-reads the order with NO webhook involved and the stall resolves -
    // acceptance §5: auto-resolution must not depend on webhook liveness.
    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-STL-1')!;
    posting.status = 'delivered';
    posting.fact_delivery_date = new Date().toISOString();
    await new Promise((r) => setTimeout(r, FALLBACK_WINDOW_WAIT_MS));
    const job = await syncOrders();
    expect(job.status).toBe('SUCCESS');

    const resolved = await exceptionsOf(order.id, 'ORDER_TRACKING_STALLED');
    expect(resolved.every((e) => e.status !== 'OPEN')).toBe(true);
    const after = await orderByPlatformId('IT-S9-STL-1');
    expect(after.platformStatus).toBe('delivered');
  }, 180_000);

  it('a fresh IN_TRANSIT anchor does NOT raise the stall', async () => {
    await newMappedSkuWithStock('FRS', 700000009, '6');
    script.postings.push(
      makePosting('IT-S9-FRS-1', [{ offerId: 'FRS', sku: 700000009, quantity: 1 }], {
        minutesAgo: 0,
        status: 'delivering',
      }),
    );
    await syncOrders();
    const order = await orderByPlatformId('IT-S9-FRS-1');
    const stalled = await exceptionsOf(order.id, 'ORDER_TRACKING_STALLED');
    expect(stalled).toHaveLength(0);
  });
});

describe('shipped-line platform cancellation (dual-axis T4)', () => {
  it('raises ORDER_CANCELLED_AFTER_SHIP; SHIPPED line stays, stock untouched', async () => {
    const skuId = await newMappedSkuWithStock('CSH', 700000010, '5');
    const barcode = `${PREFIX}-CSH-BAR`;
    await client.post(`/api/v1/skus/${skuId}/barcodes`, {
      barcode,
      barcodeType: 'EAN',
    });
    script.postings.push(
      makePosting('IT-S9-CSH-1', [{ offerId: 'CSH', sku: 700000010, quantity: 1 }], {
        minutesAgo: 0,
      }),
    );
    await syncOrders();

    // Full in-house fulfillment: reserve -> pick -> pack -> ship.
    const reserved = await orderByPlatformId('IT-S9-CSH-1');
    const task = await client.post<{ tasks: Array<{ id: string }> }>('/api/v1/picking-tasks', {
      orderId: reserved.id,
    });
    const taskId = task.body.data.tasks[0]!.id;
    await client.post(`/api/v1/picking-tasks/${taskId}/start`, {});
    await client.post(`/api/v1/picking-tasks/${taskId}/scan`, { barcode });
    const shipmentCreated = await client.post<{ shipments: Array<{ id: string }> }>(
      '/api/v1/shipments',
      { orderId: reserved.id },
    );
    const shipmentId = shipmentCreated.body.data.shipments[0]!.id;
    const packageCreated = await client.post<{ packageId: string }>(
      `/api/v1/shipments/${shipmentId}/packages`,
      {},
    );
    await client.post(`/api/v1/packages/${packageCreated.body.data.packageId}/items/scan`, {
      barcode,
    });
    await client.post(`/api/v1/packages/${packageCreated.body.data.packageId}/seal`, {});
    await client.post(`/api/v1/shipments/${shipmentId}/ship`, {});
    const shipped = await orderByPlatformId('IT-S9-CSH-1');
    expect(shipped.erpStatus).toBe('SHIPPED');
    expect(shipped.items[0]?.fulfillmentStatus).toBe('SHIPPED');
    const invShipped = await inventoryOf(skuId);
    expect(Number(invShipped.onHandQty)).toBe(4);

    // The platform cancels what we already shipped.
    const posting = script.postings.find((p) => p.posting_number === 'IT-S9-CSH-1')!;
    posting.status = 'cancelled';
    await postWebhookEvent('TYPE_POSTING_CANCELLED', 'IT-S9-CSH-1', '2026-09-15T12:00:07.000Z');

    const after = await orderByPlatformId('IT-S9-CSH-1');
    expect(after.erpStatus).toBe('CANCELLED');
    // The shipped line STAYS shipped: no in-warehouse interception is
    // possible once goods left (orders.md §8) - recovery is a return flow.
    expect(after.items[0]?.fulfillmentStatus).toBe('SHIPPED');
    expect(after.interceptions).toHaveLength(0);
    // Stock never moves back.
    const invAfter = await inventoryOf(skuId);
    expect(Number(invAfter.onHandQty)).toBe(4);
    expect(Number(invAfter.reservedQty)).toBe(0);
    expect(Number(invAfter.pickedQty)).toBe(0);
    // The follow-up exception for the return/refund process is open.
    const flagged = await exceptionsOf(after.id, 'ORDER_CANCELLED_AFTER_SHIP');
    expect(flagged.some((e) => e.status === 'OPEN')).toBe(true);
  });
});
