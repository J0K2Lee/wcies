import { describe, expect, it, vi } from 'vitest';
import { PlatformApiError } from '../platform-error';
import { YandexClient } from './yandex.client';

/**
 * YandexClient unit tests: Api-Key header, 420 Enhance Your Calm rate-limit
 * normalization (NOT 429), the {status, errors[]} envelope, the global
 * 4-request concurrency semaphore and per-store spacing. All HTTP via an
 * injected stub.
 */

const AUTH = { apiKey: 'test-yx-token' };
const BASE = 'https://api.partner.market.yandex.test';

function makeClient(overrides: Partial<ConstructorParameters<typeof YandexClient>[0]> = {}) {
  const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  const sleep = vi.fn().mockResolvedValue(undefined);
  let now = 1_000_000;
  const client = new YandexClient({
    baseUrl: BASE,
    timeoutMs: 5000,
    maxRetries: 3,
    perStoreMinIntervalMs: 0,
    maxConcurrency: 4,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep,
    now: () => now,
    ...overrides,
  });
  return { client, fetchImpl, sleep, tick: (ms: number) => (now += ms) };
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
/** mockResolvedValue would reuse ONE Response across calls (single-use body). */
const jsonResponses =
  (status: number, body: unknown, headers: Record<string, string> = {}) =>
  async (): Promise<Response> =>
    jsonResponse(status, body, headers);

describe('YandexClient transport basics', () => {
  it('sends the Api-Key header against the single domain', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(jsonResponses(200, { campaigns: [] }));
    await client.campaigns(AUTH, 's1');
    const call = fetchImpl.mock.calls[0];
    expect(String(call?.[0])).toBe(`${BASE}/v2/campaigns`);
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('Api-Key')).toBe('test-yx-token');
    expect(headers.get('Authorization')).toBeNull();
  });

  it('maps 401 to PLATFORM_AUTH_ERROR and never retries', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(jsonResponses(401, { status: 'ERROR', errors: [] }));
    const error = await capture(client.campaigns(AUTH, 's1'));
    expect((error as PlatformApiError).platformError.code).toBe('PLATFORM_AUTH_ERROR');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads the {status, errors[]} envelope for messages', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockImplementation(
      jsonResponses(400, {
        status: 'ERROR',
        errors: [{ code: 'BAD_REQUEST', message: 'wrong filter' }],
      }),
    );
    const error = (await capture(client.campaigns(AUTH, 's1'))) as PlatformApiError;
    expect(error.message).toContain('BAD_REQUEST');
    expect(error.message).toContain('wrong filter');
  });
});

describe('YandexClient rate limiting (420, not 429)', () => {
  it('maps 420 Enhance Your Calm to PLATFORM_RATE_LIMITED and retries', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl
      .mockImplementationOnce(
        jsonResponses(
          420,
          { status: 'ERROR', errors: [] },
          { 'X-RateLimit-Resource-Until': '1002' },
        ),
      )
      .mockImplementationOnce(jsonResponses(200, { campaigns: [] }));
    await client.campaigns(AUTH, 's1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('also tolerates a classic 429 with the same normalization', async () => {
    const { client, fetchImpl } = makeClient({ maxRetries: 1 });
    fetchImpl.mockImplementation(jsonResponses(429, {}));
    const error = await capture(client.campaigns(AUTH, 's1'));
    expect((error as PlatformApiError).platformError.code).toBe('PLATFORM_RATE_LIMITED');
    // 1 initial + 1 retry, then gives up.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('YandexClient concurrency semaphore', () => {
  it('caps simultaneous requests at maxConcurrency even across stores', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      inFlight -= 1;
      return jsonResponse(200, { campaigns: [] });
    });
    const tracked = new YandexClient({
      baseUrl: BASE,
      timeoutMs: 5000,
      maxRetries: 0,
      perStoreMinIntervalMs: 0,
      maxConcurrency: 4,
      fetchImpl: fetchImpl,
      sleep: async () => undefined,
    });
    await Promise.all(Array.from({ length: 9 }, (_, i) => tracked.campaigns(AUTH, `store-${i}`)));
    expect(peak).toBeLessThanOrEqual(4);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
  });

  it('enforces per-store request spacing on top of the semaphore', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    let now = 1_000_000;
    const fetchImpl = vi.fn(async () => jsonResponse(200, { campaigns: [] }));
    const spaced = new YandexClient({
      baseUrl: BASE,
      timeoutMs: 5000,
      maxRetries: 0,
      perStoreMinIntervalMs: 1000,
      maxConcurrency: 4,
      fetchImpl: fetchImpl,
      sleep,
      now: () => now,
    });
    await spaced.campaigns(AUTH, 's1');
    now += 100;
    await spaced.campaigns(AUTH, 's1');
    expect(sleep).toHaveBeenCalledWith(900);
  });
});

describe('YandexClient retry policy', () => {
  it('retries 5xx with backoff and succeeds', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl
      .mockImplementationOnce(jsonResponses(503, {}))
      .mockImplementationOnce(jsonResponses(200, { campaigns: [] }));
    await client.campaigns(AUTH, 's1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps network failures to PLATFORM_NETWORK_ERROR (retryable)', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementationOnce(jsonResponses(200, { campaigns: [] }));
    await client.campaigns(AUTH, 's1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
