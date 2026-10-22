import { describe, expect, it, vi } from 'vitest';
import { WbAdapter } from './wb.adapter';

// Not exercised here: the read paths never touch the shipment write capability.
const SHIPMENT_STUB = {} as unknown as ConstructorParameters<typeof WbAdapter>[1];
import { WbClient, WB_DEFAULT_BASE_URLS } from './wb.client';
import { WbOrderResumeCursor, WbOrderRunCursor } from './types/cursors';

/**
 * WB adapter cursor-state-machine tests: the dual-source order walk
 * (marketplace FBS `next` pages -> statistics incremental) and the listing
 * cursor echo. All HTTP via an injected stub keyed by URL matchers.
 */

const AUTH = { apiKey: 'test-wb-token' };
const BASES = WB_DEFAULT_BASE_URLS;

const CONTEXT = {
  storeId: 'store-1',
  storeCode: 'WB-A',
  platform: 'WB' as const,
  credential: AUTH,
};

const V3_ORDER = {
  id: 1,
  article: 'SKU-A',
  skus: [20301],
  createdAt: '2026-09-17T10:00:00Z',
  supplierStatus: 'new',
};

interface Stub {
  readonly adapter: WbAdapter;
  readonly calls: readonly string[];
}

/** Routes URLs through ordered matchers; first match wins. */
function stub(matchers: ReadonlyArray<{ match: (url: string) => boolean; body: unknown }>): Stub {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = String(input);
    calls.push(url);
    for (const matcher of matchers) {
      if (matcher.match(url)) {
        return jsonResponse(200, matcher.body);
      }
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new WbClient({
    baseUrls: BASES,
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    statisticsMinIntervalMs: 0,
    webhooksMinIntervalMs: 0,
    marketplace4xxPenaltyMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { adapter: new WbAdapter(client, SHIPMENT_STUB), calls };
}

const onMarketplaceOrders = (body: unknown) => ({
  match: (url: string) => url.startsWith(`${BASES.marketplace}/api/v3/orders`),
  body,
});
const onStatistics = (body: unknown) => ({
  match: (url: string) => url.startsWith(`${BASES.statistics}/api/v1/supplier/orders`),
  body,
});

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('WbAdapter fetchOrders cursor machine', () => {
  it('walks FBS pages, hands over to statistics, stores a RESUME cursor', async () => {
    const { adapter, calls } = stub([
      // First marketplace call (fresh run): positive cursor -> more pages.
      {
        match: (url) => url.includes('next=0&limit=1000'),
        body: { orders: [V3_ORDER], next: 555 },
      },
      // Subsequent marketplace calls: exhausted cursor.
      onMarketplaceOrders({ orders: [{ ...V3_ORDER, id: 2 }], next: 0 }),
      onStatistics({ orders: [] }),
    ]);

    const page1 = await adapter.fetchOrders(CONTEXT);
    expect(page1.hasMore).toBe(true);
    expect(page1.items).toHaveLength(1);
    const run1 = page1.nextCursor as WbOrderRunCursor;
    expect(run1.kind).toBe('WB_ORDER_RUN');
    expect(run1.phase).toBe('FBS');
    expect(run1.next).toBe(555);

    const page2 = await adapter.fetchOrders(CONTEXT, run1);
    expect(page2.hasMore).toBe(true); // phase hand-over, not done
    const run2 = page2.nextCursor as WbOrderRunCursor;
    expect(run2.phase).toBe('STATS');

    const page3 = await adapter.fetchOrders(CONTEXT, run2);
    expect(page3.hasMore).toBe(false);
    expect(page3.items).toHaveLength(0);
    const resume = page3.nextCursor as WbOrderResumeCursor;
    expect(resume.kind).toBe('WB_ORDER_RESUME');
    expect(resume.windowEnd).toBe(run2.windowTo);
    expect(resume.statsFrom).toBe(run2.statsFrom);

    // Exactly one statistics call across the whole run.
    expect(calls.filter((url) => url.startsWith(`${BASES.statistics}/`))).toHaveLength(1);
  });

  it('advances the statistics cursor to the last row lastChangeDate', async () => {
    const { adapter } = stub([
      onStatistics({
        orders: [
          {
            srid: 'srid-1',
            date: '2026-09-17T10:00:00+03:00',
            lastChangeDate: '2026-09-17T11:00:00+03:00',
            supplierArticle: 'SKU-A',
            barcode: '20301',
            isCancel: false,
          },
        ],
      }),
    ]);
    const run: WbOrderRunCursor = {
      kind: 'WB_ORDER_RUN',
      phase: 'STATS',
      windowFrom: '2026-09-17T00:00:00Z',
      windowTo: '2026-09-18T00:00:00Z',
      next: 0,
      statsFrom: '2026-09-17T00:00:00+03:00',
    };
    const page = await adapter.fetchOrders(CONTEXT, run);
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect((page.nextCursor as WbOrderResumeCursor).statsFrom).toBe('2026-09-17T11:00:00+03:00');
  });

  it('re-opens an overlapped FBS window from a stored RESUME cursor', async () => {
    const resume: WbOrderResumeCursor = {
      kind: 'WB_ORDER_RESUME',
      windowEnd: new Date(Date.now() - 30_000).toISOString(),
      statsFrom: '2026-09-17T00:00:00+03:00',
    };
    const { adapter, calls } = stub([
      onMarketplaceOrders({ orders: [], next: 0 }),
      onStatistics({ orders: [] }),
    ]);
    const page = await adapter.fetchOrders(CONTEXT, resume);
    const run = page.nextCursor as WbOrderRunCursor;
    expect(run.phase).toBe('STATS');
    expect(run.statsFrom).toBe(resume.statsFrom);

    // The FBS window start = stored windowEnd minus the 60s overlap.
    const mpCall = calls.find((url) => url.startsWith(`${BASES.marketplace}/`));
    expect(mpCall).toBeDefined();
    const dateFrom = Number(new URL(mpCall as string).searchParams.get('dateFrom'));
    const expectedFrom = Math.floor((new Date(resume.windowEnd).getTime() - 60_000) / 1000);
    expect(Math.abs(dateFrom - expectedFrom)).toBeLessThanOrEqual(1);
  });

  it('requires { apiKey } credentials', async () => {
    const { adapter } = stub([]);
    const error = await capture(adapter.fetchOrders({ ...CONTEXT, credential: {} }));
    expect((error as { code?: string }).code).toBe('STORE_CREDENTIAL_MALFORMED');
  });
});

describe('WbAdapter fetchListings cursor', () => {
  it('ends the walk on a short page and echoes the cursor on a full page', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      nmID: 1000 + i,
      vendorCode: `SKU-${i}`,
      sizes: [{ skus: [20300 + i] }],
    }));
    const responses: unknown[] = [
      { cards: fullPage, cursor: { updatedAt: '2030-01-01T00:00:00Z', nmID: 1099 } },
      { cards: [{ nmID: 5000, vendorCode: 'SKU-Z', sizes: [] }] },
    ];
    let index = 0;
    const { adapter } = makeStateful(
      (url) => url.startsWith(`${BASES.content}/content/v2/get/cards/list`),
      () => responses[Math.min(index++, responses.length - 1)],
    );
    const page1 = await adapter.fetchListings(CONTEXT);
    expect(page1.hasMore).toBe(true);
    expect(page1.items).toHaveLength(100);
    const page2 = await adapter.fetchListings(CONTEXT, page1.nextCursor);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
    expect(page2.items[0]?.skus[0]?.platformSkuId).toBeNull(); // barcode-less size stays visible
  });
});

describe('WbAdapter fetchListings first page (2026-10-22 分页修复)', () => {
  it('always sends the page limit — otherwise WB returns 10 cards and the walk ends early', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: string, init?: RequestInit) => {
      const raw = init?.body;
      bodies.push(typeof raw === 'string' ? JSON.parse(raw) : null);
      return jsonResponse(200, {
        cards: [{ nmID: 1, vendorCode: 'SKU-A', sizes: [{ skus: ['20301'] }] }],
        cursor: {},
      });
    });
    const client = new WbClient({
      baseUrls: BASES,
      timeoutMs: 1000,
      maxRetries: 0,
      perStoreMinIntervalMs: 0,
      statisticsMinIntervalMs: 0,
      webhooksMinIntervalMs: 0,
      marketplace4xxPenaltyMs: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    const adapter = new WbAdapter(client, SHIPMENT_STUB);

    await adapter.fetchListings(CONTEXT);

    expect(bodies[0]).toEqual({ settings: { cursor: { limit: 100 } } });
  });
});

function makeStateful(match: (url: string) => boolean, next: () => unknown): Stub {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (match(url)) {
      return jsonResponse(200, next());
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new WbClient({
    baseUrls: BASES,
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    statisticsMinIntervalMs: 0,
    webhooksMinIntervalMs: 0,
    marketplace4xxPenaltyMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { adapter: new WbAdapter(client, SHIPMENT_STUB), calls };
}

async function capture(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
    return new Error('expected the call to throw');
  } catch (error) {
    return error;
  }
}
