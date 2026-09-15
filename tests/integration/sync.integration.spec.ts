import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { spawnApiEntry, waitForHttp, waitForOutput, ManagedProcess } from './helpers';
import { ApiClient, runPrefix } from './sprint1.helpers';

/**
 * Sprint 5 Platform Integration acceptance (task §44-§54) against real
 * PostgreSQL + Redis + a scripted mock OZON Seller API:
 *
 * - listing sync: UNMAPPED facts, human mapping survives re-sync, no dupes
 * - order sync through OrderIngestionService (reserve / backorder / mapping
 *   failure), sync job SUCCESS even for business-level line failures
 * - idempotency: poll again / webhook + poll race -> exactly one order
 * - store isolation: store A failing never blocks store B; cursors advance
 * - transport failures: job FAILED, cursor NOT advanced, recovery re-walks
 * - single flight: 10 concurrent dispatches -> 1 active job
 * - secrets never surface in API responses, jobs, errors or raw events
 */

const PREFIX = runPrefix();
const BASE = 'http://localhost:3116';
const client = new ApiClient(BASE);

const API_KEY_A = 'it-test-api-key-A';
const API_KEY_B = 'it-test-api-key-B';
const CLIENT_ID_A = '111000111';
const CLIENT_ID_B = '222000222';

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
  products: MockPostingProduct[];
}

interface StoreScript {
  failMode: 'none' | 'auth' | 'serverError' | 'malformed' | 'failSecondListCall';
  listings: Array<{ product_id: number; offer_id: string }>;
  productInfos: Record<number, { name: string; sku: number }>;
  postings: MockPosting[];
  listCalls: number;
}

const scripts = new Map<string, StoreScript>();
let mockOzon: Server;
let mockOzonUrl = '';

let ozonPlatformId = '';
let storeA = '';
let storeB = '';
let credentialA = '';
let warehouseId = '';
let binA01 = '';

function scriptFor(clientId: string): StoreScript {
  let script = scripts.get(clientId);
  if (script === undefined) {
    script = {
      failMode: 'none',
      listings: [],
      productInfos: {},
      postings: [],
      listCalls: 0,
    };
    scripts.set(clientId, script);
  }
  return script;
}

function startMockOzon(): Promise<Server> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      const clientId = String(req.headers['client-id'] ?? '');
      const apiKey = String(req.headers['api-key'] ?? '');
      const script = scriptFor(clientId);
      const authorized =
        (clientId === CLIENT_ID_A && apiKey === API_KEY_A) ||
        (clientId === CLIENT_ID_B && apiKey === API_KEY_B);
      const url = req.url ?? '';

      const send = (status: number, payload: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (script.failMode === 'auth' || !authorized) {
        send(401, { code: 16, message: 'client-id or api-key not found' });
        return;
      }
      if (script.failMode === 'serverError') {
        send(500, { code: 500, message: 'internal error (scripted)' });
        return;
      }
      if (script.failMode === 'malformed') {
        send(200, { totally: 'unexpected-shape' });
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
        if (script.failMode === 'none') {
          send(200, { result: { last_id: 'last', items: script.listings } });
        } else {
          send(200, { result: { last_id: 'last', items: script.listings } });
        }
        return;
      }
      if (url === '/v3/product/info/list') {
        const offerIds = (parsed['offer_id'] as string[] | undefined) ?? [];
        const items = offerIds
          .map((offer) => script.listings.find((l) => l.offer_id === offer))
          .filter((l): l is { product_id: number; offer_id: string } => l !== undefined)
          .map((l) => ({
            id: l.product_id,
            offer_id: l.offer_id,
            name: script.productInfos[l.product_id]?.name ?? `Product ${l.product_id}`,
            sku: script.productInfos[l.product_id]?.sku ?? 900000000 + l.product_id,
            is_archived: false,
          }));
        // Real OZON returns info items at TOP LEVEL (no `result` envelope),
        // verified 2026-09-09 smoke test against api-seller.ozon.ru.
        send(200, { items });
        return;
      }
      if (url === '/v3/posting/fbs/list') {
        script.listCalls += 1;
        if (script.failMode === 'failSecondListCall' && script.listCalls >= 2) {
          send(500, { code: 500, message: 'page 2 transport failure (scripted)' });
          return;
        }
        const filter = (parsed['filter'] as { since?: string; to?: string } | undefined) ?? {};
        const offset = Number(parsed['offset'] ?? 0);
        const limit = Number(parsed['limit'] ?? 200);
        const since = filter.since ?? '1970-01-01T00:00:00Z';
        const to = filter.to ?? '2999-01-01T00:00:00Z';
        const matched = script.postings.filter(
          (p) => p.in_process_at >= since && p.in_process_at <= to,
        );
        const page = matched.slice(offset, offset + limit);
        // failSecondListCall: force a second page on the first call so the
        // scripted page-2 failure is actually reached (real postings are far
        // below the page size).
        const forceNext = script.failMode === 'failSecondListCall' && script.listCalls === 1;
        send(200, {
          result: {
            has_next: forceNext || offset + page.length < matched.length,
            postings: page,
          },
        });
        return;
      }
      if (url === '/v3/posting/fbs/get') {
        const rawNumber: unknown = parsed['posting_number'];
        const number = typeof rawNumber === 'string' ? rawNumber : '';
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
// Test helpers
// ---------------------------------------------------------------------------

let api: ManagedProcess;
let worker: ManagedProcess;

interface SyncJobDto {
  id: string;
  storeId: string;
  syncType: string;
  status: string;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  cursorBefore: Record<string, unknown> | null;
  cursorAfter: Record<string, unknown> | null;
}

async function dispatchSync(path: 'sync/orders' | 'sync/listings', storeId: string) {
  return client.post<SyncJobDto>(`/api/v1/${path}`, { storeId });
}

async function dumpProcesses(_context: string): Promise<void> {
  console.error();
  console.error();
}

async function waitForJob(jobId: string, timeoutMs = 40_000): Promise<SyncJobDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await client
      .get<SyncJobDto>(`/api/v1/sync/jobs/${jobId}`)
      .catch(async (error: unknown) => {
        await dumpProcesses('waitForJob fetch failure');
        throw error;
      });
    if (response.status === 200) {
      const job = response.body.data;
      if (['SUCCESS', 'PARTIAL', 'FAILED'].includes(job.status)) {
        return job;
      }
    }
    if (Date.now() > deadline) {
      await dumpProcesses('waitForJob timeout');
      throw new Error(
        `sync job ${jobId} did not finish in ${timeoutMs}ms (last: ${JSON.stringify(response.body.data)})`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function syncAndWait(
  path: 'sync/orders' | 'sync/listings',
  storeId: string,
): Promise<SyncJobDto> {
  const dispatch = await dispatchSync(path, storeId);
  expect(dispatch.status).toBe(202);
  return waitForJob(dispatch.body.data.id);
}

function makePosting(
  number: string,
  items: Array<{ offerId: string; sku: number; quantity?: number }>,
  minutesAgo = 5,
): MockPosting {
  return {
    posting_number: number,
    status: 'awaiting_packaging',
    in_process_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    products: items.map((item) => ({
      offer_id: item.offerId,
      sku: item.sku,
      quantity: item.quantity ?? 1,
      price: '100.00',
      currency_code: 'RUB',
    })),
  };
}

async function newSku(label: string): Promise<string> {
  const product = await client.post<{ id: string }>('/api/v1/products', {
    nameZh: `${PREFIX} ${label}商品`,
  });
  const sku = await client.post<{ id: string; skuCode: string }>('/api/v1/skus', {
    productId: product.body.data.id,
    nameZh: `${PREFIX} ${label}SKU`,
  });
  return sku.body.data.id;
}

async function initializeStock(skuId: string, quantity: string): Promise<void> {
  const response = await client.post('/api/v1/inventory/initialize', {
    skuId,
    warehouseId,
    binId: binA01,
    quantity,
    condition: 'SELLABLE',
    referenceType: 'MANUAL',
    referenceId: randomUUID(),
    idempotencyKey: `IT-SYNC-INIT:${randomUUID()}`,
  });
  expect(response.status).toBe(200);
}

async function countOrders(platformOrderId: string, storeId = storeA): Promise<number> {
  const list = await client.get<Array<{ platformOrderId: string; storeId: string }>>(
    `/api/v1/orders?keyword=${encodeURIComponent(platformOrderId)}&pageSize=100`,
  );
  return list.body.data.filter(
    (o) => o.platformOrderId === platformOrderId && o.storeId === storeId,
  ).length;
}

async function orderDetailByPlatformId(platformOrderId: string): Promise<{
  id: string;
  erpStatus: string;
  syncSource: string | null;
  rawData: Record<string, unknown> | null;
  items: Array<{
    fulfillmentStatus: string;
    mappingStatus: string;
    skuId: string | null;
    reservationId: string | null;
    exceptions: Array<{ exceptionType: string; status: string }>;
  }>;
}> {
  const list = await client.get<Array<{ id: string }>>(
    `/api/v1/orders?keyword=${encodeURIComponent(platformOrderId)}&pageSize=100`,
  );
  const match = list.body.data[0];
  expect(match).toBeDefined();
  const detail = await client.get<Awaited<ReturnType<typeof orderDetailByPlatformId>>>(
    `/api/v1/orders/${match?.id}`,
  );
  return detail.body.data;
}

async function reservationsOfSku(skuId: string): Promise<number> {
  const list = await client.get<Array<{ id: string }>>(
    `/api/v1/inventory/reservations?skuId=${skuId}&pageSize=100`,
  );
  return list.body.data.length;
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  mockOzon = await startMockOzon();
  const address = mockOzon.address() as AddressInfo;
  mockOzonUrl = `http://127.0.0.1:${address.port}`;

  const env = {
    PORT: '3116',
    REDIS_URL: 'redis://localhost:6379/11',
    OZON_API_BASE_URL: mockOzonUrl,
    OZON_MIN_REQUEST_INTERVAL_MS: '0',
  };
  api = spawnApiEntry('main.js', env);
  worker = spawnApiEntry('worker.js', env);
  await waitForHttp(`${BASE}/health/live`, 60_000);
  await waitForOutput(worker, /order-sync|listing-sync|Worker|started/i, 60_000).catch(() => {
    // worker logs may differ; presence is asserted by jobs completing
  });
  await client.login();

  const platforms = await client.get<Array<{ code: string; id: string }>>('/api/v1/platforms');
  ozonPlatformId = platforms.body.data.find((p) => p.code === 'OZON')?.id ?? '';

  for (const [storeCode, name] of [
    [`${PREFIX}-A`, `${PREFIX} A店`],
    [`${PREFIX}-B`, `${PREFIX} B店`],
  ] as const) {
    await client.post('/api/v1/stores', { platformId: ozonPlatformId, storeCode, name });
  }
  const stores = await client.get<Array<{ id: string; storeCode: string }>>(
    `/api/v1/stores?keyword=${PREFIX}&pageSize=100`,
  );
  storeA = stores.body.data.find((s) => s.storeCode === `${PREFIX}-A`)?.id ?? '';
  storeB = stores.body.data.find((s) => s.storeCode === `${PREFIX}-B`)?.id ?? '';

  const credA = await client.post<{ id: string }>(`/api/v1/stores/${storeA}/credentials`, {
    credentialType: 'MAIN_API',
    payload: { clientId: CLIENT_ID_A, apiKey: API_KEY_A },
  });
  credentialA = credA.body.data.id;
  const credB = await client.post<{ id: string }>(`/api/v1/stores/${storeB}/credentials`, {
    credentialType: 'MAIN_API',
    payload: { clientId: CLIENT_ID_B, apiKey: API_KEY_B },
  });
  expect(credB.status).toBe(201);

  const warehouse = await client.post<{ id: string }>('/api/v1/warehouses', {
    warehouseCode: `${PREFIX}-SYNCWH`,
    name: `${PREFIX} 同步测试仓`,
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
}, 180_000);

afterAll(async () => {
  await api.stop();
  await worker.stop();
  await new Promise<void>((resolve) => mockOzon.close(() => resolve()));
});

// ---------------------------------------------------------------------------

describe('credential validation (task §32/§33)', () => {
  it('marks VALID on a successful read and INVALID on auth failure', async () => {
    const ok = await client.post<{ validationStatus: string }>(
      `/api/v1/stores/${storeA}/credentials/${credentialA}/validate`,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.data.validationStatus, `validate error: ${ok.body.data.error}`).toBe('VALID');

    scriptFor(CLIENT_ID_A).failMode = 'auth';
    const bad = await client.post<{ validationStatus: string; error: string | null }>(
      `/api/v1/stores/${storeA}/credentials/${credentialA}/validate`,
    );
    expect(bad.body.data.validationStatus).toBe('INVALID');
    expect(bad.body.data.error).not.toContain(API_KEY_A);
    scriptFor(CLIENT_ID_A).failMode = 'none';

    const meta = await client.get<
      Array<{ id: string; lastValidationStatus: string | null; lastValidationError: string | null }>
    >(`/api/v1/stores/${storeA}/credentials`);
    const mine = meta.body.data.find((c) => c.id === credentialA);
    expect(mine?.lastValidationStatus).toBe('INVALID');
    expect(mine?.lastValidationError).not.toContain(API_KEY_A);
  });
});

describe('listing sync (task §17-§20)', () => {
  it('syncs listings as UNMAPPED platform facts; human mapping survives re-sync', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.listings = [
      { product_id: 101, offer_id: 'SYNC-OFFER-1' },
      { product_id: 102, offer_id: 'SYNC-OFFER-2' },
    ];

    const job = await syncAndWait('sync/listings', storeA);
    expect(job.status).toBe('SUCCESS');
    expect(job.successCount).toBe(2);

    // UNMAPPED visible in listing list (mappingState=UNMAPPED filter)
    const unmapped = await client.get<
      Array<{ id: string; mappingCount: number; mappingStatus: string }>
    >(`/api/v1/listings?storeId=${storeA}&mappingState=UNMAPPED&pageSize=100`);
    const codes = unmapped.body.data.map((l) => l.id);
    expect(unmapped.body.data.length).toBeGreaterThanOrEqual(2);
    // The synced listing carries one UNMAPPED variant fact, so mappingCount
    // (total variants, matching the detail view's skus.length) is >= 1; what
    // makes it unmapped is the derived status, which every row must report.
    expect(unmapped.body.data.every((l) => l.mappingStatus === 'UNMAPPED')).toBe(true);

    // human mapping of the listing carrying SYNC-OFFER-1 (list order is not
    // guaranteed between same-timestamp rows)
    const details = await Promise.all(
      codes.slice(0, 4).map((id) =>
        client.get<{
          id: string;
          skus: Array<{
            id: string;
            mappingStatus: string;
            skuId: string | null;
            offerId: string | null;
          }>;
        }>(`/api/v1/listings/${id}`),
      ),
    );
    const target = details
      .map((d) => d.body.data)
      .find((d) => d.skus.some((s) => s.offerId === 'SYNC-OFFER-1'));
    expect(target).toBeDefined();
    const variant = target!.skus.find((s) => s.mappingStatus === 'UNMAPPED');
    expect(variant).toBeDefined();
    expect(variant?.offerId).toBe('SYNC-OFFER-1');

    const skuId = await newSku('MAPPED');
    const mapResult = await client.post<{ mappingStatus: string; skuId: string | null }>(
      `/api/v1/listings/${target!.id}/skus/${variant?.id}/map`,
      { skuId },
    );
    expect(mapResult.status).toBe(200);
    expect(mapResult.body.data.mappingStatus).toBe('MAPPED');
    expect(mapResult.body.data.skuId).toBe(skuId);

    // re-sync: platform data refreshes, mapping preserved, no duplicate rows
    script.listings[1] = { product_id: 102, offer_id: 'SYNC-OFFER-2-RENAMED' };
    const job2 = await syncAndWait('sync/listings', storeA);
    expect(job2.status).toBe('SUCCESS');

    const after = await client.get<{
      skus: Array<{ id: string; mappingStatus: string; skuId: string | null }>;
    }>(`/api/v1/listings/${target!.id}`);
    expect(after.body.data.skus).toHaveLength(1);
    expect(after.body.data.skus[0]?.mappingStatus).toBe('MAPPED');
    expect(after.body.data.skus[0]?.skuId).toBe(skuId);

    // second listing still unmapped; offer id refreshed
    const detail2 = details
      .map((d) => d.body.data)
      .find((d) => d.skus.some((s) => s.offerId === 'SYNC-OFFER-2'));
    const after2 = await client.get<{
      skus: Array<{ offerId: string | null; mappingStatus: string }>;
    }>(`/api/v1/listings/${detail2!.id}`);
    expect(after2.body.data.skus[0]?.mappingStatus).toBe('UNMAPPED');
    expect(after2.body.data.skus[0]?.offerId).toBe('SYNC-OFFER-2-RENAMED');
  });
});

describe('sync job list (dashboard pagination, regression: raw-join + skip/take)', () => {
  it('lists jobs with joined store/platform fields and paginates via LIMIT/OFFSET', async () => {
    const job = await syncAndWait('sync/listings', storeA);
    expect(job.status).toBe('SUCCESS');

    const list = await client.get<
      Array<{
        id: string;
        storeId: string;
        storeCode: string;
        storeName: string;
        platformCode: string;
        syncType: string;
        status: string;
      }>
    >(`/api/v1/sync/jobs?storeId=${storeA}&page=1&pageSize=10`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((r) => r.id === job.id);
    expect(row).toBeDefined();
    expect(row?.storeCode).toBe(`${PREFIX}-A`);
    expect(row?.storeName).toBe(`${PREFIX} A店`);
    expect(row?.platformCode).toBe('OZON');
    expect(row?.syncType).toBe('LISTING_SYNC');
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);

    // page beyond offset also works (regression: skip/take + raw join used to 500)
    const page2 = await client.get(`/api/v1/sync/jobs?storeId=${storeA}&page=2&pageSize=1`);
    expect(page2.status).toBe(200);
    expect(Array.isArray(page2.body.data)).toBe(true);
  });
});

describe('order sync (task §21-§25, §38, §45-§52)', () => {
  it('ingests a normal order through OrderIngestionService with reservation', async () => {
    const skuId = await newSku('ORD');
    await initializeStock(skuId, '10');
    // map via listing create (same as orders suite)
    await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-ORD-PP`,
      skuVariants: [{ skuId, platformSkuId: '500000001' }],
    });

    const script = scriptFor(CLIENT_ID_A);
    script.postings = [
      makePosting('IT-SYNC-ORD-1', [{ offerId: 'ORD', sku: 500000001, quantity: 2 }]),
    ];

    const job = await syncAndWait('sync/orders', storeA);
    expect(job.status).toBe('SUCCESS');
    expect(job.successCount).toBe(1);

    const detail = await orderDetailByPlatformId('IT-SYNC-ORD-1');
    expect(detail.erpStatus).toBe('READY_TO_PICK');
    expect(detail.syncSource).toBe('POLLING');
    expect(detail.items[0]?.fulfillmentStatus).toBe('RESERVED');
    expect(detail.items[0]?.mappingStatus).toBe('MAPPED');
    expect(detail.rawData).toBeTruthy();
    expect(await reservationsOfSku(skuId)).toBe(1);
  });

  it('re-poll is idempotent: no duplicate order / reservation (task §45)', async () => {
    const job = await syncAndWait('sync/orders', storeA);
    expect(job.status).toBe('SUCCESS');
    // The advanced window may legitimately exclude the old posting (0
    // re-reads) or re-deliver it once inside the overlap - either way the
    // UNIQUE(store_id, platform_order_id) key keeps exactly one order.
    expect(job.skippedCount + job.successCount).toBeLessThanOrEqual(1);
    expect(await countOrders('IT-SYNC-ORD-1')).toBe(1);
  });

  it('webhook + poll race results in exactly one order (task §52)', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.postings.push(
      makePosting('IT-SYNC-WEB-1', [{ offerId: 'ORD', sku: 500000001, quantity: 1 }], 2),
    );

    // webhook arrives first (targeted read + ingest in the worker)
    const webhook = await client.post('/api/v1/webhooks/ozon/stores/' + `${PREFIX}-A`, {
      message_type: 'TYPE_NEW_POSTING',
      posting_number: 'IT-SYNC-WEB-1',
      seller_id: Number(CLIENT_ID_A),
      warehouse_id: 1,
    });
    expect(webhook.status).toBe(200);
    // Ack must match the platform template {version, name, time}: the legacy
    // {result:true} body is rejected with WRONG_RESULT_TIME_FIELD (2026-09-14,
    // docs/integrations/ozon.md §6.4).
    const ack = webhook.body as unknown as { version: string; name: string; time: string };
    expect(Object.keys(ack).sort()).toEqual(['name', 'time', 'version']);
    expect(ack.name).toBe('WCIES');
    expect(ack.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    // webhook processing is async - wait for the order to exist
    const deadline = Date.now() + 30_000;
    while ((await countOrders('IT-SYNC-WEB-1')) === 0) {
      if (Date.now() > deadline) {
        throw new Error('webhook-processed order did not appear');
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    // polling catches the same posting -> duplicate ingest must be absorbed
    const job = await syncAndWait('sync/orders', storeA);
    expect(['SUCCESS', 'PARTIAL']).toContain(job.status);
    expect(await countOrders('IT-SYNC-WEB-1')).toBe(1);

    const detail = await orderDetailByPlatformId('IT-SYNC-WEB-1');
    expect(['WEBHOOK', 'POLLING']).toContain(detail.syncSource);

    // duplicate webhook delivery -> deduped raw event, still one order
    const webhook2 = await client.post('/api/v1/webhooks/ozon/stores/' + `${PREFIX}-A`, {
      message_type: 'TYPE_NEW_POSTING',
      posting_number: 'IT-SYNC-WEB-1',
      seller_id: Number(CLIENT_ID_A),
      warehouse_id: 1,
    });
    expect(webhook2.status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await countOrders('IT-SYNC-WEB-1')).toBe(1);
  });

  it('webhook with wrong seller_id is rejected but answered result:true', async () => {
    const events = await client.get<Array<{ eventType: string; status: string }>>(
      `/api/v1/sync/events?storeId=${storeA}&pageSize=100`,
    );
    const before = events.body.data.length;

    const response = await client.post('/api/v1/webhooks/ozon/stores/' + `${PREFIX}-A`, {
      message_type: 'TYPE_NEW_POSTING',
      posting_number: 'IT-SYNC-SPOOF-1',
      seller_id: 999999999,
    });
    expect(response.status).toBe(200);

    const after = await client.get<Array<{ eventType: string; status: string }>>(
      `/api/v1/sync/events?storeId=${storeA}&pageSize=100`,
    );
    expect(after.body.data.length).toBe(before + 1);
    const rejected = after.body.data[0];
    expect(rejected?.status).toBe('REJECTED');
    expect(await countOrders('IT-SYNC-SPOOF-1')).toBe(0);
  });

  it('mapping failure: order saved, item FAILED, exception created, cursor advances (task §47)', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.postings.push(
      makePosting('IT-SYNC-MAP-1', [{ offerId: 'UNKNOWN-OFFER', sku: 777000777, quantity: 1 }], 1),
    );

    const job = await syncAndWait('sync/orders', storeA);
    // business-level failure still counts as an ingested fact -> SUCCESS
    expect(job.status).toBe('SUCCESS');
    expect(job.cursorAfter).not.toBeNull();

    const detail = await orderDetailByPlatformId('IT-SYNC-MAP-1');
    expect(detail.items[0]?.mappingStatus).toBe('FAILED');
    expect(
      detail.items[0]?.exceptions.some((e) => e.exceptionType === 'ORDER_SKU_MAPPING_FAILED'),
    ).toBe(true);
    expect(detail.erpStatus).toBe('EXCEPTION');
  });

  it('backorder: BACKORDERED line, job still SUCCESS (task §48)', async () => {
    const skuId = await newSku('BACK');
    await client.post('/api/v1/listings', {
      platformId: ozonPlatformId,
      storeId: storeA,
      platformProductId: `${PREFIX}-BACK-PP`,
      skuVariants: [{ skuId, platformSkuId: '600000001' }],
    });
    // NO stock initialized

    const script = scriptFor(CLIENT_ID_A);
    script.postings.push(
      makePosting('IT-SYNC-BACK-1', [{ offerId: 'BACK', sku: 600000001, quantity: 3 }], 1),
    );

    const job = await syncAndWait('sync/orders', storeA);
    expect(job.status).toBe('SUCCESS');

    const detail = await orderDetailByPlatformId('IT-SYNC-BACK-1');
    expect(detail.items[0]?.fulfillmentStatus).toBe('BACKORDERED');
    expect(detail.items[0]?.exceptions.some((e) => e.exceptionType === 'ORDER_OUT_OF_STOCK')).toBe(
      true,
    );
  });

  it('HTTP failure: job FAILED, cursor not advanced; recovery re-walks without loss (task §49/§51)', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.postings.push(
      makePosting('IT-SYNC-RETRY-1', [{ offerId: 'ORD', sku: 500000001, quantity: 1 }], 1),
    );
    script.failMode = 'serverError';

    const failedJob = await syncAndWait('sync/orders', storeA);
    expect(failedJob.status).toBe('FAILED');
    expect(failedJob.errorCode).toBe('PLATFORM_API_ERROR');
    // cursor not advanced: cursorAfter equals cursorBefore
    expect(failedJob.cursorAfter).toEqual(failedJob.cursorBefore);
    expect(await countOrders('IT-SYNC-RETRY-1')).toBe(0);

    // immediate re-dispatch is allowed (failed job frees the single-flight slot)
    script.failMode = 'none';
    const recovered = await syncAndWait('sync/orders', storeA);
    expect(recovered.status).toBe('SUCCESS');
    expect(await countOrders('IT-SYNC-RETRY-1')).toBe(1);
  });

  it('page-2 failure keeps the window cursor so recovery cannot skip page 1 orders (task §51)', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.listCalls = 0;
    // 0 minutes ago: after earlier syncs the window has advanced, so the
    // postings must be fresh to fall inside [windowStart, now].
    script.postings = script.postings.concat([
      makePosting('IT-SYNC-P1-1', [{ offerId: 'ORD', sku: 500000001, quantity: 1 }], 0),
      makePosting('IT-SYNC-P2-1', [{ offerId: 'ORD', sku: 500000001, quantity: 1 }], 0),
    ]);
    // force two pages: has_next requires matched > limit; simpler: second call fails
    script.failMode = 'failSecondListCall';

    const job = await syncAndWait('sync/orders', storeA);
    expect(job.status).toBe('FAILED');
    expect(job.cursorAfter).toEqual(job.cursorBefore);
    expect(await countOrders('IT-SYNC-P1-1')).toBe(1); // page 1 WAS ingested...
    // ...and after recovery page 1 is not lost or duplicated, page 2 arrives
    script.failMode = 'none';
    const recovered = await syncAndWait('sync/orders', storeA);
    expect(recovered.status).toBe('SUCCESS');
    expect(await countOrders('IT-SYNC-P1-1')).toBe(1);
    expect(await countOrders('IT-SYNC-P2-1')).toBe(1);
  });

  it('malformed platform responses become PLATFORM_BAD_RESPONSE (task §50)', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.failMode = 'malformed';
    const job = await syncAndWait('sync/orders', storeA);
    expect(job.status).toBe('FAILED');
    expect(job.errorCode).toBe('PLATFORM_BAD_RESPONSE');
    expect(job.errorMessage).toBeTruthy();
    script.failMode = 'none';
  });

  it('single flight: 10 concurrent dispatches yield exactly one active job (task §53)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        dispatchSync('sync/listings', storeA).then(
          (r) => r.status,
          (error: { body?: { error?: { code?: string } } }) => error?.body?.error?.code ?? 'ERR',
        ),
      ),
    );
    const accepted = results.filter((status) => status === 202).length;
    const conflicts = results.filter(
      (status) => status === 'ERR' || status === 409 || status === undefined,
    ).length;
    // exactly one dispatch wins the DB guard; the rest get SYNC_ALREADY_RUNNING
    expect(accepted).toBe(1);
    expect(conflicts).toBe(9);

    // let the winner finish so later tests are not blocked
    const jobs = await client.get<Array<{ id: string; status: string }>>(
      `/api/v1/sync/jobs?storeId=${storeA}&syncType=LISTING_SYNC&pageSize=1`,
    );
    const winner = jobs.body.data?.[0];
    if (winner !== undefined && ['PENDING', 'RUNNING'].includes(winner.status)) {
      await waitForJob(winner.id);
    }
  });

  it('store isolation: store A failing never blocks store B (task §44)', async () => {
    const scriptA = scriptFor(CLIENT_ID_A);
    const scriptB = scriptFor(CLIENT_ID_B);
    scriptA.failMode = 'serverError';
    scriptB.postings = [
      makePosting('IT-SYNC-STOREB-1', [{ offerId: 'B1', sku: 800000001, quantity: 1 }], 1),
    ];

    const [jobA, jobB] = await Promise.all([
      syncAndWait('sync/orders', storeA),
      syncAndWait('sync/orders', storeB),
    ]);
    expect(jobA.status).toBe('FAILED');
    expect(jobB.status).toBe('SUCCESS');
    expect(await countOrders('IT-SYNC-STOREB-1', storeB)).toBe(1);
    scriptA.failMode = 'none';
  });

  it('same platform order id in two stores stays two independent orders (task §46)', async () => {
    const scriptA = scriptFor(CLIENT_ID_A);
    const scriptB = scriptFor(CLIENT_ID_B);
    scriptA.postings.push(
      makePosting('IT-SYNC-SHARED-1', [{ offerId: 'ORD', sku: 500000001, quantity: 1 }], 0),
    );
    scriptB.postings.push(
      makePosting('IT-SYNC-SHARED-1', [{ offerId: 'B1', sku: 800000001, quantity: 1 }], 0),
    );

    await syncAndWait('sync/orders', storeA);
    await syncAndWait('sync/orders', storeB);

    const list = await client.get<Array<{ platformOrderId: string; storeId: string }>>(
      `/api/v1/orders?keyword=${encodeURIComponent('IT-SYNC-SHARED-1')}&pageSize=100`,
    );
    const shared = list.body.data.filter(
      (o) =>
        o.platformOrderId === 'IT-SYNC-SHARED-1' && (o.storeId === storeA || o.storeId === storeB),
    );
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map((o) => o.storeId)).size).toBe(2);
  });
});

describe('credential security (task §54)', () => {
  it('API responses, sync jobs, raw events never contain the API key', async () => {
    const script = scriptFor(CLIENT_ID_A);
    script.failMode = 'auth';
    const job = await syncAndWait('sync/orders', storeA);
    script.failMode = 'none';
    expect(job.errorMessage).not.toContain(API_KEY_A);
    expect(JSON.stringify(job)).not.toContain(API_KEY_A);

    const overview = await client.get<unknown>(`/api/v1/sync/stores/${storeA}/overview`);
    expect(JSON.stringify(overview.body)).not.toContain(API_KEY_A);

    const credentials = await client.get<unknown>(`/api/v1/stores/${storeA}/credentials`);
    expect(JSON.stringify(credentials.body)).not.toContain(API_KEY_A);

    const events = await client.get<unknown>(`/api/v1/sync/events?storeId=${storeA}&pageSize=100`);
    expect(JSON.stringify(events.body)).not.toContain(API_KEY_A);
  });
});
