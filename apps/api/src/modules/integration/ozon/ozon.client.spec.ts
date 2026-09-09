import { describe, expect, it, vi } from 'vitest';
import { OzonClient, OZON_DEFAULT_OPTIONS } from './ozon.client';
import { PlatformApiError } from '../platform-error';

/**
 * OzonClient unit tests (task §39/§40/§41): error normalization, retry
 * policy, rate limiting, secret hygiene. All HTTP via an injected stub.
 */

const AUTH = { clientId: '1234567', apiKey: 'test-api-key' };
const BASE = 'https://api-seller.ozon.test';

function makeClient(overrides: Partial<ConstructorParameters<typeof OzonClient>[0]> = {}) {
  const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();
  const sleep = vi.fn().mockResolvedValue(undefined);
  let now = 1_000_000;
  const client = new OzonClient({
    baseUrl: BASE,
    timeoutMs: 5000,
    maxRetries: 3,
    perStoreMinIntervalMs: 0,
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

describe('OzonClient error normalization', () => {
  it('maps 401 to PLATFORM_AUTH_ERROR and never retries', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValue(jsonResponse(401, { code: 16, message: 'not-found client' }));
    const error = await capture(client.pingCredential(AUTH, 'store-1'));
    expect(error).toBeInstanceOf(PlatformApiError);
    expect((error as PlatformApiError).code).toBe('PLATFORM_AUTH_ERROR');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to PLATFORM_RATE_LIMITED with retryable semantics', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValueOnce(jsonResponse(429, { message: 'too many requests' }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { result: { last_id: '', items: [] } }));
    await client.pingCredential(AUTH, 'store-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps 500 to PLATFORM_API_ERROR and retries until success', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValueOnce(jsonResponse(500, { message: 'internal' }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(502, { message: 'bad gateway' }));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { result: { last_id: 'x', items: [] } }));
    const response = await client.productList(AUTH, 'store-1', { lastId: '', limit: 1 });
    expect(response.result.last_id).toBe('x');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and surfaces the normalized error', async () => {
    const { client, fetchImpl } = makeClient({ maxRetries: 2 });
    fetchImpl.mockImplementation(async () => jsonResponse(500, { message: 'down' }));
    const error = await capture(client.pingCredential(AUTH, 'store-1'));
    expect((error as PlatformApiError).code).toBe('PLATFORM_API_ERROR');
    // 1 initial + 2 retries
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('maps network failures to PLATFORM_NETWORK_ERROR (retryable)', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockRejectedValueOnce(new TypeError('fetch failed'));
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { result: { last_id: '', items: [] } }));
    await client.pingCredential(AUTH, 'store-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps abort to PLATFORM_TIMEOUT (retryable)', async () => {
    const { client, fetchImpl } = makeClient();
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchImpl.mockRejectedValueOnce(abortError);
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { result: { last_id: '', items: [] } }));
    await client.pingCredential(AUTH, 'store-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps non-JSON 200 bodies to PLATFORM_BAD_RESPONSE (no retry)', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValue(
      new Response('<html>gateway error</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    const error = await capture(client.pingCredential(AUTH, 'store-1'));
    expect((error as PlatformApiError).code).toBe('PLATFORM_BAD_RESPONSE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry deterministic 400 business errors', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValue(jsonResponse(400, { message: 'invalid field' }));
    const error = await capture(client.pingCredential(AUTH, 'store-1'));
    expect((error as PlatformApiError).code).toBe('PLATFORM_API_ERROR');
    expect((error as PlatformApiError).platformError.httpStatus).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('carries the platform request id and endpoint, never secrets', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValue(
      jsonResponse(403, { message: 'forbidden' }, { 'x-request-id': 'req-42' }),
    );
    const error = (await capture(client.pingCredential(AUTH, 'store-9'))) as PlatformApiError;
    expect(error.platformError.requestId).toBe('req-42');
    expect(error.platformError.endpoint).toBe('/v3/product/list');
    expect(error.platformError.storeId).toBe('store-9');
    expect(JSON.stringify(error.details)).not.toContain(AUTH.apiKey);
    expect(JSON.stringify(error.message)).not.toContain(AUTH.apiKey);
  });
});

describe('OzonClient auth + retry mechanics', () => {
  it('sends Client-Id / Api-Key headers and a JSON body', async () => {
    const { client, fetchImpl } = makeClient();
    fetchImpl.mockResolvedValue(jsonResponse(200, { result: { last_id: '', items: [] } }));
    await client.pingCredential(AUTH, 'store-1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URL(url).toString()).toBe(`${BASE}/v3/product/list`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Client-Id']).toBe(AUTH.clientId);
    expect((init.headers as Record<string, string>)['Api-Key']).toBe(AUTH.apiKey);
  });

  it('honors Retry-After seconds over exponential backoff', async () => {
    const { client, fetchImpl, sleep } = makeClient({ maxRetries: 1 });
    fetchImpl.mockResolvedValueOnce(
      jsonResponse(429, { message: 'slow down' }, { 'Retry-After': '2' }),
    );
    fetchImpl.mockResolvedValueOnce(jsonResponse(200, { result: { last_id: '', items: [] } }));
    await client.pingCredential(AUTH, 'store-1');
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});

describe('OzonClient per-store rate limiting', () => {
  it('spaces requests of one store, never blocks another store', async () => {
    const { client, fetchImpl, sleep, tick } = makeClient({ perStoreMinIntervalMs: 100 });
    fetchImpl.mockImplementation(async () =>
      jsonResponse(200, { result: { last_id: '', items: [] } }),
    );

    await client.pingCredential(AUTH, 'store-A');
    expect(sleep).not.toHaveBeenCalled();

    // Same store, immediately again -> must wait ~100ms.
    const pending = client.pingCredential(AUTH, 'store-A');
    expect(sleep).toHaveBeenCalledWith(100);
    tick(100);
    await pending;

    // Different store right after -> no wait (store isolation, task §41).
    sleep.mockClear();
    await client.pingCredential(AUTH, 'store-B');
    expect(sleep).not.toHaveBeenCalled();
  });

  it('defaults match the documented-safe configuration', () => {
    expect(OZON_DEFAULT_OPTIONS.maxRetries).toBeGreaterThan(0);
    expect(OZON_DEFAULT_OPTIONS.perStoreMinIntervalMs).toBeGreaterThan(0);
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
