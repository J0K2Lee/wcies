import { describe, expect, it, vi } from 'vitest';
import { PlatformApiError } from '../platform-error';
import { WbClient, WB_DEFAULT_BASE_URLS } from './wb.client';

/**
 * WbClient unit tests: multi-domain routing, auth header, WB-specific error
 * normalization (429 X-Ratelimit-Retry, content-domain HTTP-200 business
 * errors, marketplace 4XX budget penalty) and per-domain rate floors.
 * All HTTP via an injected stub.
 */

const AUTH = { apiKey: 'test-wb-token' };
const BASES = WB_DEFAULT_BASE_URLS;

function makeClient(overrides: Partial<ConstructorParameters<typeof WbClient>[0]> = {}) {
  const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  const sleep = vi.fn().mockResolvedValue(undefined);
  let now = 1_000_000;
  const client = new WbClient({
    baseUrls: BASES,
    timeoutMs: 5000,
    maxRetries: 3,
    perStoreMinIntervalMs: 0,
    statisticsMinIntervalMs: 0,
    webhooksMinIntervalMs: 0,
    marketplace4xxPenaltyMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    now: () => now,
    ...overrides,
  });
  return { client, fetchImpl, sleep, tick: (ms: number) => (now += ms) };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** mockResolvedValue would reuse ONE Response across calls (single-use body). */
function jsonResponses(status: number, body: unknown, headers: Record<string, string> = {}) {
  return async (): Promise<Response> => jsonResponse(status, body, headers);
}

describe('WbClient domain routing + auth header', () => {
  it('targets the right module domain per endpoint with the bare Authorization header', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(jsonResponses(200, {}));
    await client.sellerInfo(AUTH, 's1');
    await client.cardsList(AUTH, 's1', {
      settings: { filter: {}, cursor: { updatedAt: 0, nmID: 0, limit: 1 } },
    });
    await client.fbsOrders(AUTH, 's1', { dateFrom: 1, dateTo: 2, next: 0, limit: 1 });
    await client.supplierOrders(AUTH, 's1', { dateFrom: '2026-09-18T00:00:00+03:00', flag: 0 });

    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toBe(`${BASES.common}/api/v1/seller-info`);
    expect(urls[1]).toBe(`${BASES.content}/content/v2/get/cards/list`);
    expect(urls[2]).toBe(`${BASES.marketplace}/api/v3/orders?dateFrom=1&dateTo=2&next=0&limit=1`);
    expect(urls[3]).toBe(
      `${BASES.statistics}/api/v1/supplier/orders?dateFrom=2026-09-18T00%3A00%3A00%2B03%3A00&flag=0`,
    );
    for (const call of fetchImpl.mock.calls) {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get('Authorization')).toBe('test-wb-token');
      expect(headers.get('Client-Id')).toBeNull();
    }
  });
});

describe('WbClient error normalization', () => {
  it('maps 401 to PLATFORM_AUTH_ERROR and never retries', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(jsonResponses(401, { message: 'token expired' }));
    const error = await capture(client.sellerInfo(AUTH, 's1'));
    expect((error as PlatformApiError).platformError.code).toBe('PLATFORM_AUTH_ERROR');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to PLATFORM_RATE_LIMITED honoring X-Ratelimit-Retry (ms)', async () => {
    const { client, fetchImpl, sleep } = makeClient();
    fetchImpl.mockImplementationOnce(
      jsonResponses(429, { message: 'too many' }, { 'X-Ratelimit-Retry': '2500' }),
    );
    fetchImpl.mockImplementationOnce(jsonResponses(200, {}));
    await client.sellerInfo(AUTH, 's1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenLastCalledWith(2500);
  });

  it('unwraps {error:true, errorText} from a 200 content response', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(
      jsonResponses(200, { data: null, error: true, errorText: '(520) internal' }),
    );
    const error = await capture(
      client.cardsList(AUTH, 's1', {
        settings: { filter: {}, cursor: { updatedAt: 0, nmID: 0, limit: 1 } },
      }),
    );
    expect(error).toBeInstanceOf(PlatformApiError);
    expect((error as PlatformApiError).platformError.code).toBe('PLATFORM_API_ERROR');
    expect((error as PlatformApiError).message).toContain('(520) internal');
  });

  it('retries 5xx with backoff and succeeds', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementationOnce(jsonResponses(503, {}));
    fetchImpl.mockImplementationOnce(jsonResponses(200, { orders: [], next: 0 }));
    const rows = await client.supplierOrders(AUTH, 's1', {
      dateFrom: '2026-09-18T00:00:00+03:00',
      flag: 0,
    });
    expect(rows).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps network failures to PLATFORM_NETWORK_ERROR (retryable)', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchImpl.mockImplementationOnce(jsonResponses(200, {}));
    await client.sellerInfo(AUTH, 's1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('WbClient per-domain rate limiting', () => {
  it('enforces the statistics 1-req/min floor per store', async () => {
    const { client, fetchImpl, sleep, tick } = makeClient({
      statisticsMinIntervalMs: 61_000,
    });
    fetchImpl.mockImplementation(jsonResponses(200, { orders: [] }));
    await client.supplierOrders(AUTH, 's1', { dateFrom: 'x', flag: 0 });
    tick(1_000); // far below 61s
    await client.supplierOrders(AUTH, 's1', { dateFrom: 'x', flag: 0 });
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('cools the marketplace lane after a 4XX (budget billed x10)', async () => {
    const { client, fetchImpl, sleep, tick } = makeClient({
      marketplace4xxPenaltyMs: 2_000,
    });
    fetchImpl.mockImplementationOnce(jsonResponses(422, { message: 'bad filter' }));
    fetchImpl.mockImplementation(jsonResponses(200, { orders: [], next: 0 }));
    await capture(client.fbsOrders(AUTH, 's1', { dateFrom: 1, dateTo: 2, next: 0, limit: 1 }));
    tick(100);
    await client.fbsOrders(AUTH, 's1', { dateFrom: 1, dateTo: 2, next: 0, limit: 1 });
    // 2000ms penalty minus the 100ms elapsed.
    expect(sleep).toHaveBeenLastCalledWith(1_900);
  });

  it('keeps other domains independent of a cooled marketplace lane', async () => {
    const { client, fetchImpl, sleep, tick } = makeClient({
      marketplace4xxPenaltyMs: 2_000,
    });
    fetchImpl.mockImplementationOnce(jsonResponses(422, {}));
    fetchImpl.mockImplementation(jsonResponses(200, {}));
    await capture(client.fbsOrders(AUTH, 's1', { dateFrom: 1, dateTo: 2, next: 0, limit: 1 }));
    tick(50);
    await client.sellerInfo(AUTH, 's1');
    expect(sleep).not.toHaveBeenCalled();
  });
});

async function capture(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
    return new Error('expected the call to throw');
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// Webhook management domain (docs verified 2026-09-18)
// ---------------------------------------------------------------------------

describe('WbClient webhook management domain', () => {
  const WEBHOOK_AUTH = { apiKey: 'seller-token', serviceSecret: 'service-secret' };

  it('targets webhooks-api with BOTH the seller token and X-Client-Secret', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(async (input: string) => {
      const url = String(input);
      if (url.includes('/api/v1/webhooks/check')) {
        return jsonResponse(200, {});
      }
      return jsonResponse(200, { id: 'wh-1', secret: 's', enabled: true });
    });
    await client.createWebhook(WEBHOOK_AUTH, 's1', {
      enabled: true,
      url: 'https://hook.example.com/wb',
      name: 'WCIES WB-A',
      subscriptions: [{ scope: 'content', event: 'card_changed' }],
    });
    await client.checkWebhookUrl(WEBHOOK_AUTH, 's1', 'https://hook.example.com/wb');

    const createCall = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(createCall[0]).toBe(`${BASES.webhooks}/api/v1/webhooks`);
    const headers = new Headers(createCall[1].headers);
    expect(headers.get('Authorization')).toBe('seller-token');
    expect(headers.get('X-Client-Secret')).toBe('service-secret');

    const checkCall = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(checkCall[0]).toBe(`${BASES.webhooks}/api/v1/webhooks/check`);
  });

  it('treats a 204/empty-body DELETE as success', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(async () => new Response(null, { status: 204 }));
    await expect(client.deleteWebhook(WEBHOOK_AUTH, 's1', 'wh-1')).resolves.toBeUndefined();
    const call = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe(`${BASES.webhooks}/api/v1/webhooks/wh-1`);
    expect(call[1].method).toBe('DELETE');
  });

  it('enforces the webhook-domain 1 req/sec lane per store', async () => {
    const { client, fetchImpl, sleep, tick } = makeClient({ webhooksMinIntervalMs: 1_100 });
    fetchImpl.mockImplementation(async () => jsonResponse(200, []));
    await client.listWebhooks(WEBHOOK_AUTH, 's1');
    tick(100); // far below 1.1s
    await client.listWebhooks(WEBHOOK_AUTH, 's1');
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('tolerant list extraction accepts wrapped and bare-array responses', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementationOnce(async () => jsonResponse(200, [{ id: 'wh-1', url: 'u' }]));
    await expect(client.listWebhooks(WEBHOOK_AUTH, 's1')).resolves.toHaveLength(1);
    fetchImpl.mockImplementationOnce(async () =>
      jsonResponse(200, { webhooks: [{ id: 'wh-2', url: 'u' }] }),
    );
    await expect(client.listWebhooks(WEBHOOK_AUTH, 's1')).resolves.toHaveLength(1);
  });
});
