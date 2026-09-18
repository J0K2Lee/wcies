import { describe, expect, it, vi } from 'vitest';
import { YandexAdapter } from './yandex.adapter';

// Not exercised here: the read paths never touch the shipment write capability.
const SHIPMENT_STUB = {} as unknown as ConstructorParameters<typeof YandexAdapter>[1];
import { YandexClient } from './yandex.client';
import { YxOrderResumeCursor } from './types/cursors';

/**
 * YandexAdapter identity-resolution tests: the store->campaign mapping rule
 * (explicit credential campaignId > single-campaign token > error) and the
 * cursor-carried identity on the order window walk.
 */

const BASE = 'https://api.partner.market.yandex.test';

const CONTEXT = {
  storeId: 'store-1',
  storeCode: 'YX-A',
  platform: 'YANDEX' as const,
  credential: { apiKey: 'test-yx-token' },
};

function stub(responses: ReadonlyArray<{ match: (url: string) => boolean; body: unknown }>) {
  const fetchImpl = vi.fn(async (input: string) => {
    const url = String(input);
    for (const route of responses) {
      if (route.match(url)) {
        return jsonResponse(route.body);
      }
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new YandexClient({
    baseUrl: BASE,
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    maxConcurrency: 4,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { adapter: new YandexAdapter(client, SHIPMENT_STUB), fetchImpl };
}

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const campaigns = (list: unknown[]) => list;

describe('YandexAdapter identity resolution', () => {
  it('resolves a single-campaign token implicitly', async () => {
    const { adapter } = stub([
      {
        match: (url) => url.startsWith(`${BASE}/v2/campaigns`),
        body: { campaigns: campaigns([{ id: 1001, business: { id: 2002, name: 'Shop' } }]) },
      },
      {
        match: (url) => url.includes('/offer-mappings'),
        body: { result: { offerMappings: [] } },
      },
    ]);
    await expect(
      adapter.validateCredential(toCredentialContext(CONTEXT.credential)),
    ).resolves.toBeUndefined();
    const page = await adapter.fetchListings(CONTEXT);
    expect(page.hasMore).toBe(false);
  });

  it('requires an explicit campaignId for multi-campaign tokens', async () => {
    const { adapter } = stub([
      {
        match: (url) => url.startsWith(`${BASE}/v2/campaigns`),
        body: {
          campaigns: campaigns([
            { id: 1001, business: { id: 2002, name: 'Shop' } },
            { id: 1003, business: { id: 2002, name: 'Shop' } },
          ]),
        },
      },
    ]);
    const error = await capture(adapter.fetchListings(CONTEXT));
    expect((error as { code?: string }).code).toBe('STORE_CREDENTIAL_MALFORMED');
    expect((error as { message: string }).message).toContain('campaignId');
  });

  it('accepts the legacy flat businessId shape as a fallback', async () => {
    const { adapter } = stub([
      {
        match: (url) => url.startsWith(`${BASE}/v2/campaigns`),
        body: { campaigns: campaigns([{ id: 1001, businessId: 2002 }]) },
      },
      {
        match: (url) => url.includes('/offer-mappings'),
        body: { result: { offerMappings: [] } },
      },
    ]);
    await expect(
      adapter.validateCredential(toCredentialContext(CONTEXT.credential)),
    ).resolves.toBeUndefined();
  });

  it('honors an explicit campaignId and rejects an unknown one', async () => {
    const campaignsRoute = {
      match: (url: string) => url.startsWith(`${BASE}/v2/campaigns`),
      body: {
        campaigns: campaigns([
          { id: 1001, business: { id: 2002, name: 'Shop' } },
          { id: 1003, business: { id: 2002, name: 'Shop' } },
        ]),
      },
    };
    const listingsRoute = {
      match: (url: string) => url.includes('/offer-mappings'),
      body: { result: { offerMappings: [] } },
    };
    const good = stub([campaignsRoute, listingsRoute]);
    const context = { ...CONTEXT, credential: { apiKey: 'k', campaignId: '1003' } };
    await expect(good.adapter.fetchListings(context)).resolves.toMatchObject({ hasMore: false });

    const bad = stub([campaignsRoute, listingsRoute]);
    const error = await capture(
      bad.adapter.fetchListings({ ...CONTEXT, credential: { apiKey: 'k', campaignId: 9999 } }),
    );
    expect((error as { code?: string }).code).toBe('STORE_CREDENTIAL_MALFORMED');
  });
});

describe('YandexAdapter order window walk', () => {
  it('carries the resolved identity inside cursors and resumes at window end', async () => {
    const { adapter, fetchImpl } = stub([
      {
        match: (url) => url.startsWith(`${BASE}/v2/campaigns`),
        body: { campaigns: campaigns([{ id: 1001, business: { id: 2002, name: 'Shop' } }]) },
      },
      {
        match: (url) => url.includes('/orders'),
        body: { status: 'OK', orders: [] },
      },
    ]);
    const page = await adapter.fetchOrders(CONTEXT);
    expect(page.hasMore).toBe(false);
    const resume = page.nextCursor as {
      kind: string;
      windowEnd: string;
      businessId: string;
      campaignId: string;
    };
    expect(resume.kind).toBe('YX_ORDER_RESUME');
    expect(resume.businessId).toBe('2002');
    expect(resume.campaignId).toBe('1001');

    // The resume cursor carries identity: the next page costs NO campaigns read.
    await adapter.fetchOrders(CONTEXT, resume);
    const campaignsReads = fetchImpl.mock.calls.filter((call) =>
      String(call[0]).includes('/v2/campaigns'),
    );
    expect(campaignsReads).toHaveLength(1);
  });

  it('re-opens an overlapped update window from a resume cursor', async () => {
    const requests: string[] = [];
    const orderBodies: Array<{ dates?: { updateDateFrom?: string } }> = [];
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(`${BASE}/v2/campaigns`)) {
        return jsonResponse({
          campaigns: campaigns([{ id: 1001, business: { id: 2002, name: 'Shop' } }]),
        });
      }
      requests.push(url);
      if (typeof init?.body === 'string') {
        orderBodies.push(JSON.parse(init.body) as { dates?: { updateDateFrom?: string } });
      }
      return jsonResponse({ status: 'OK', orders: [] });
    });
    const client = new YandexClient({
      baseUrl: BASE,
      timeoutMs: 1000,
      maxRetries: 0,
      perStoreMinIntervalMs: 0,
      maxConcurrency: 4,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    const adapter = new YandexAdapter(client, SHIPMENT_STUB);
    const resume: YxOrderResumeCursor = {
      kind: 'YX_ORDER_RESUME',
      businessId: '2002',
      campaignId: '1001',
      windowEnd: new Date(Date.now() - 30_000).toISOString(),
    };
    await adapter.fetchOrders(CONTEXT, resume);
    expect(requests).toHaveLength(1);
    const from = new Date(orderBodies[0]?.dates?.updateDateFrom ?? '').getTime();
    const expected = new Date(resume.windowEnd).getTime() - 60_000;
    expect(Math.abs(from - expected)).toBeLessThanOrEqual(1500);
  });
});

function toCredentialContext(credential: Record<string, unknown>) {
  return { storeId: CONTEXT.storeId, platform: 'YANDEX' as const, credential };
}

async function capture(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
    return new Error('expected the call to throw');
  } catch (error) {
    return error;
  }
}
