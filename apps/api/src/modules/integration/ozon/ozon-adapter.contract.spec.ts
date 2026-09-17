import { vi } from 'vitest';
import { OzonAdapter } from './ozon.adapter';
import { OzonClient } from './ozon.client';
import { AdapterContractHarness, listingItem, runAdapterContractSuite } from '../adapter.contract';

/**
 * OZON harness for the shared Platform Adapter Contract Suite (Sprint 5 task
 * §42; suite extracted 2026-09-18). Responses are scripted per endpoint via
 * the injectable fetch transport - adapters may fan one contract call out to
 * several platform endpoints (e.g. listing page + detail enrichment).
 */

const STORE_CREDENTIAL = { clientId: '111222333', apiKey: 'unit-test-api-key' };

interface ScriptedRoute {
  /** Endpoint path prefix, e.g. '/v3/product/list'. */
  readonly endpoint: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

function makeOzonHarness(): AdapterContractHarness {
  // Route-based fake server: adapters may fan one contract call out to
  // several platform endpoints (e.g. listing page + detail enrichment), so
  // responses are scripted per endpoint instead of FIFO.
  const routes = new Map<string, ScriptedRoute>([
    // Default enrichment route: empty detail pages are valid (adapter keeps
    // the listing with null title/sku) unless a test overrides it.
    // Real OZON returns info items at TOP LEVEL (no `result` envelope),
    // verified 2026-09-09 smoke test against api-seller.ozon.ru.
    [
      '/v3/product/info/list',
      { endpoint: '/v3/product/info/list', status: 200, body: { items: [] } },
    ],
  ]);
  let callCount = 0;
  const fetchImpl = vi.fn(async (input: string) => {
    callCount += 1;
    const url = String(input);
    for (const [prefix, route] of routes) {
      if (url.includes(prefix)) {
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'Content-Type': 'application/json', ...route.headers },
        });
      }
    }
    throw new Error(`no scripted route for ${url}`);
  });
  const client = new OzonClient({
    baseUrl: 'https://api-seller.ozon.test',
    timeoutMs: 1000,
    maxRetries: 0,
    perStoreMinIntervalMs: 0,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return {
    name: 'OZON',
    adapter: new OzonAdapter(client),
    credentialContext: {
      storeId: 'store-1',
      platform: 'OZON',
      credential: STORE_CREDENTIAL,
    },
    storeContext: {
      storeId: 'store-1',
      storeCode: 'OZON-A',
      platform: 'OZON',
      credential: STORE_CREDENTIAL,
    },
    enqueue: (status: number, body: unknown, headers?: Record<string, string>) => {
      // Default routing: which endpoint a scripted body belongs to is
      // decided by the shape of the body itself.
      const endpoint = endpointOf(body);
      routes.set(endpoint, { endpoint, status, body, headers });
    },
    calls: () => callCount,
  };
}

/** Maps a scripted body to the platform endpoint it belongs to. */
function endpointOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'result' in body) {
    const result = (body as { result: Record<string, unknown> }).result;
    if ('postings' in result) {
      return '/v3/posting/fbs/list';
    }
    if ('last_id' in result) {
      return '/v3/product/list';
    }
    if ('posting_number' in result) {
      return '/v3/posting/fbs/get';
    }
  }
  // product/info/list is the only read endpoint WITHOUT a `result` envelope
  // (verified against the real API 2026-09-09): items sit at top level.
  if (typeof body === 'object' && body !== null && 'items' in body) {
    return '/v3/product/info/list';
  }
  return '/v3/product/list';
}

runAdapterContractSuite(makeOzonHarness());

// Re-export for readers looking for the old symbols in this file.
export { listingItem };
