import { bindPlatformWarehouse, spawnApiEntry, waitForHttp, ManagedProcess } from './helpers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Dual-axis task T2 acceptance (2026-09-15):
 *
 * 1. webhook-driven updates: TYPE_STATE_CHANGED triggers the targeted
 *    re-read; the push-model `new_state` vocabulary is NEVER trusted - only
 *    the re-read Seller API answer lands (ozon.md §6.2);
 * 2. an unknown posting number fully ingests (webhook is a catch-up
 *    channel, same semantics as NEW_POSTING);
 * 3. duplicate webhook delivery dedups by payload hash - one raw event,
 *    processed once;
 * 4. fair fallback rotation: within the fallback window a second sync run
 *    re-reads NOTHING (checked-at is fresh); after the window elapses the
 *    order re-enters the candidate set;
 * 5. erp_status='SHIPPED' orders stay candidates until the platform reports
 *    a terminal stage (fix A3 - delivered facts used to be unlearnable).
 *
 * The fallback window is set to ~29 seconds (ORDER_STATE_FALLBACK_HOURS
 * supports fractional hours for exactly this purpose).
 */

const PREFIX = runPrefix();
const BASE = 'http://localhost:3118';
const client = new ApiClient(BASE);

const API_KEY = 'it-test-api-key-rot';
const CLIENT_ID = '333111444';

/** ~29s fallback window: fast enough to wait out, long enough to stay under. */
const FALLBACK_HOURS = '0.008';
const FALLBACK_WAIT_MS = 32_000;

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
  delivering_date?: string;
  fact_delivery_date?: string;
  products: MockPostingProduct[];
}

const postings: MockPosting[] = [];
/** Live per-posting count of /v3/posting/fbs/get hits (rotation evidence). */
const getHits = new Map<string, number>();
let mockOzon: Server;

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
      // v4 list（2026-10-20）：顶层响应 + 游标分页。
      if (url === '/v4/posting/fbs/list') {
        const filter = (parsed['filter'] as { since?: string; to?: string } | undefined) ?? {};
        const since = filter.since ?? '1970-01-01T00:00:00Z';
        const to = filter.to ?? '2999-01-01T00:00:00Z';
        const matched = postings.filter((p) => p.in_process_at >= since && p.in_process_at <= to);
        send(200, { has_next: false, cursor: '', postings: matched });
        return;
      }
      if (url === '/v3/posting/fbs/get') {
        const number = typeof parsed['posting_number'] === 'string' ? parsed['posting_number'] : '';
        getHits.set(number, (getHits.get(number) ?? 0) + 1);
        const posting = postings.find((p) => p.posting_number === number);
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

let api: ManagedProcess;
let worker: ManagedProcess;

let ozonPlatformId = '';
let storeId = '';
let storeCode = '';
let warehouseId = '';
let binId = '';

interface SyncJobDto {
  id: string;
  status: string;
}
interface RawEventDto {
  id: string;
  eventType: string;
  status: string;
  payload: Record<string, unknown>;
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
  options: { minutesAgo?: number; status?: string; deliveringDate?: string } = {},
): MockPosting {
  return {
    posting_number: number,
    status: options.status ?? 'awaiting_packaging',
    in_process_at: new Date(Date.now() - (options.minutesAgo ?? 5) * 60_000).toISOString(),
    ...(options.deliveringDate !== undefined ? { delivering_date: options.deliveringDate } : {}),
    products: items.map((item) => ({
      offer_id: item.offerId,
      sku: item.sku,
      quantity: item.quantity ?? 1,
      price: '100.00',
      currency_code: 'RUB',
    })),
  };
}

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
    idempotencyKey: `IT-ROT-INIT:${randomUUID()}`,
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
  platformStatusHistory: Array<{
    fromStatus: string | null;
    toStatus: string;
    source: string | null;
    platformChangedAt: string | null;
    createdAt: string;
  }> | null;
  items: Array<{ id: string; fulfillmentStatus: string; mappingStatus: string }>;
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

/** Posts a webhook event and waits until the worker reaches a final status. */
async function postWebhookAndWait(
  payload: Record<string, unknown>,
  wantStatus: string,
): Promise<{ httpStatus: number; events: RawEventDto[] }> {
  const response = await client.post(`/api/v1/webhooks/ozon/stores/${storeCode}`, payload);
  const deadline = Date.now() + 30_000;
  for (;;) {
    const list = await client.get<RawEventDto[]>(
      `/api/v1/sync/events?storeId=${storeId}&pageSize=50`,
    );
    const mine = list.body.data.filter(
      (row) => row.payload['posting_number'] === payload['posting_number'],
    );
    if (mine.length > 0 && mine.every((row) => row.status === wantStatus)) {
      return { httpStatus: response.status, events: mine };
    }
    if (Date.now() > deadline) {
      throw new Error(
        `webhook event did not reach ${wantStatus} (got: ${JSON.stringify(mine.map((e) => e.status))})`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  mockOzon = await startMockOzon();
  const address = mockOzon.address() as AddressInfo;
  const mockOzonUrl = `http://127.0.0.1:${address.port}`;

  const env = {
    PORT: '3118',
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
    name: `${PREFIX} 轮转店`,
  });
  storeId = store.body.data.id;
  await client.post(`/api/v1/stores/${storeId}/credentials`, {
    credentialType: 'MAIN_API',
    payload: { clientId: CLIENT_ID, apiKey: API_KEY },
  });

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-WH`,
    name: `${PREFIX} 轮转仓`,
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
  await worker.stop();
  await new Promise<void>((resolve) => mockOzon.close(() => resolve()));
});

// ---------------------------------------------------------------------------

describe('webhook-driven platform facts (T2)', () => {
  it('TYPE_STATE_CHANGED on an UNKNOWN posting fully ingests (catch-up semantics) and lands PROCESSED', async () => {
    await newMappedSkuWithStock('WHB', 710000001, '5');
    postings.push(
      makePosting(`${PREFIX}-ROT-WH-1`, [{ offerId: 'WHB', sku: 710000001, quantity: 1 }]),
    );

    const changedStateDate = '2026-09-15T08:00:00.000Z';
    const { events } = await postWebhookAndWait(
      {
        message_type: 'TYPE_STATE_CHANGED',
        posting_number: `${PREFIX}-ROT-WH-1`,
        // Push-model vocabulary on purpose (§6.2): it must NOT be trusted.
        new_state: 'posting_delivered',
        changed_state_date: changedStateDate,
        seller_id: Number(CLIENT_ID),
      },
      'PROCESSED',
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe('PROCESSED');

    // The order was created from the re-read, with the re-read's facts - not
    // the push payload's `posting_delivered`.
    const order = await orderByPlatformId(`${PREFIX}-ROT-WH-1`);
    expect(order.erpStatus).toBe('READY_TO_PICK');
    expect(order.platformStatus).toBe('awaiting_packaging');
  });

  it('a later state event updates facts via re-read and records the platform-side time', async () => {
    const changedStateDate = '2026-09-15T09:30:00.000Z';
    const posting = postings.find((p) => p.posting_number === `${PREFIX}-ROT-WH-1`)!;
    posting.status = 'delivering';
    posting.delivering_date = changedStateDate;

    await postWebhookAndWait(
      {
        message_type: 'TYPE_STATE_CHANGED',
        posting_number: `${PREFIX}-ROT-WH-1`,
        new_state: 'posting_on_way_to_city',
        changed_state_date: changedStateDate,
        seller_id: Number(CLIENT_ID),
      },
      'PROCESSED',
    );

    const order = await orderByPlatformId(`${PREFIX}-ROT-WH-1`);
    // Re-read answer wins; the stage normalized from the Seller API status.
    const transitions = order.platformStatusHistory ?? [];
    const last = transitions[transitions.length - 1];
    expect(last?.toStatus).toBe('delivering');
    // Webhook-sourced platform time (changed_state_date) is preferred.
    expect(last?.source).toBe('WEBHOOK');
    expect(new Date(last?.platformChangedAt ?? '').toISOString()).toBe(changedStateDate);
  });

  it('duplicate delivery dedups by payload hash: one raw event, no second processing', async () => {
    const payload = {
      message_type: 'TYPE_STATE_CHANGED',
      posting_number: `${PREFIX}-ROT-WH-1`,
      new_state: 'posting_on_way_to_city',
      changed_state_date: '2026-09-15T11:00:00.000Z',
      seller_id: Number(CLIENT_ID),
    };
    const first = await client.post(`/api/v1/webhooks/ozon/stores/${storeCode}`, payload);
    expect(first.status).toBe(200);
    const second = await client.post(`/api/v1/webhooks/ozon/stores/${storeCode}`, payload);
    expect(second.status).toBe(200);

    await new Promise((r) => setTimeout(r, 2_000));
    const list = await client.get<RawEventDto[]>(
      `/api/v1/sync/events?storeId=${storeId}&pageSize=100`,
    );
    const mine = list.body.data.filter(
      (row) => row.payload['changed_state_date'] === '2026-09-15T11:00:00.000Z',
    );
    // Same payload (identical hash) -> exactly ONE stored raw event.
    expect(mine.length).toBe(1);
  });
});

describe('fair fallback rotation + SHIPPED candidates (T2, fix A3)', () => {
  it('within the window a second run re-reads nothing; SHIPPED orders re-enter after it', async () => {
    // Order A: stocked -> RESERVED; Order B: no stock -> BACKORDERED, then
    // closed out as externally fulfilled (erp SHIPPED, platform stage still
    // AWAITING_SHIPMENT).
    await newMappedSkuWithStock('ROA', 710000002, '5');
    await newMappedSkuWithStock('ROB', 710000003, '0.001');
    postings.push(
      makePosting(`${PREFIX}-ROT-A`, [{ offerId: 'ROA', sku: 710000002, quantity: 1 }]),
    );
    postings.push(
      makePosting(`${PREFIX}-ROT-B`, [{ offerId: 'ROB', sku: 710000003, quantity: 1 }]),
    );

    const job1 = await syncOrders();
    expect(job1.status).toBe('SUCCESS');
    const orderA = await orderByPlatformId(`${PREFIX}-ROT-A`);
    const orderB = await orderByPlatformId(`${PREFIX}-ROT-B`);
    expect(orderA.erpStatus).toBe('READY_TO_PICK');
    expect(orderB.erpStatus).toBe('BACKORDERED');
    const closed = await client.post(`/api/v1/orders/${orderB.id}/mark-external-fulfillment`, {
      reason: '轮转测试：外部履约关账',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data.erpStatus).toBe('SHIPPED');

    // Run 1 already ingested AND first-read both orders (checked-at NULL ->
    // immediate candidates). Snapshot the counters after that.
    const hitsA1 = getHits.get(`${PREFIX}-ROT-A`) ?? 0;
    const hitsB1 = getHits.get(`${PREFIX}-ROT-B`) ?? 0;
    expect(hitsA1).toBeGreaterThan(0);
    expect(hitsB1).toBeGreaterThan(0);

    // Run 2 inside the fallback window: NO fresh candidates -> zero
    // additional targeted reads (fair rotation, no budget monopolization).
    const job2 = await syncOrders();
    expect(job2.status).toBe('SUCCESS');
    expect(getHits.get(`${PREFIX}-ROT-A`) ?? 0).toBe(hitsA1);
    expect(getHits.get(`${PREFIX}-ROT-B`) ?? 0).toBe(hitsB1);

    // Platform-side movement while we wait out the window: A goes in
    // transit (erp still unshipped -> stage stays PENDING), B is delivered
    // (erp SHIPPED -> stage COMPLETED).
    const postingA = postings.find((p) => p.posting_number === `${PREFIX}-ROT-A`)!;
    const postingB = postings.find((p) => p.posting_number === `${PREFIX}-ROT-B`)!;
    postingA.status = 'delivering';
    postingA.delivering_date = '2026-09-15T10:00:00.000Z';
    postingB.status = 'delivered';
    postingB.fact_delivery_date = '2026-09-15T10:30:00.000Z';

    await new Promise((r) => setTimeout(r, FALLBACK_WAIT_MS));
    const job3 = await syncOrders();
    expect(job3.status).toBe('SUCCESS');

    // Both re-read after the window: A (erp READY_TO_PICK) and B (erp
    // SHIPPED - STILL a candidate, A3) each gained exactly one read.
    expect((getHits.get(`${PREFIX}-ROT-A`) ?? 0) - hitsA1).toBe(1);
    expect((getHits.get(`${PREFIX}-ROT-B`) ?? 0) - hitsB1).toBe(1);

    const afterA = await orderByPlatformId(`${PREFIX}-ROT-A`);
    expect(afterA.platformStatus).toBe('delivering');
    const afterB = await orderByPlatformId(`${PREFIX}-ROT-B`);
    expect(afterB.platformStatus).toBe('delivered');

    // Axis-1 stage view (orders.md §17a): B = SHIPPED + platform DELIVERED
    // -> COMPLETED (and no longer IN_TRANSIT); A = unshipped -> PENDING,
    // not IN_TRANSIT even though the platform side is delivering.
    const stageOf = async (platformOrderId: string, stage: string): Promise<boolean> => {
      const list = await client.get<Array<{ id: string }>>(
        `/api/v1/orders?keyword=${encodeURIComponent(platformOrderId)}&stage=${stage}&pageSize=10`,
      );
      return list.body.data.length > 0;
    };
    expect(await stageOf(`${PREFIX}-ROT-B`, 'COMPLETED')).toBe(true);
    expect(await stageOf(`${PREFIX}-ROT-B`, 'IN_TRANSIT')).toBe(false);
    expect(await stageOf(`${PREFIX}-ROT-A`, 'PENDING')).toBe(true);
    expect(await stageOf(`${PREFIX}-ROT-A`, 'IN_TRANSIT')).toBe(false);
  }, 180_000);
});
