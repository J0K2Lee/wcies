import { vi } from 'vitest';
import { OzonAdapter } from './ozon.adapter';
import { OzonClient } from './ozon.client';
import { OzonShipmentService } from './ozon-shipment.service';
import { AdapterContractHarness, listingItem, runAdapterContractSuite } from '../adapter.contract';

/**
 * OZON harness for the shared Platform Adapter Contract Suite (Sprint 5 task
 * §42; suite extracted 2026-09-18). Responses are scripted per endpoint via
 * the injectable fetch transport - adapters may fan one contract call out to
 * several platform endpoints (e.g. listing page + detail enrichment).
 */

const STORE_CREDENTIAL = { clientId: '111222333', apiKey: 'unit-test-api-key' };

/** Posting the shipment-capability contract tests operate on. */
const SHIPMENT_ORDER_ID = 'SHIP-1';

interface ScriptedRoute {
  /** Endpoint path prefix, e.g. '/v3/product/list'. */
  readonly endpoint: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
  /** Literal body (label bytes / base64 envelope) instead of JSON.stringify. */
  readonly rawBody?: string;
}

/** Statuses the scripted posting walks through (OZON seller API vocabulary). */
const AWAITING_PACKAGING = 'awaiting_packaging';
const AWAITING_DELIVER = 'awaiting_deliver';

/** Scripted shipping-label PDF bytes (never a real label). */
const LABEL_PDF = '%PDF-1.4 scripted label';

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
  // The scripted posting's status is STATEFUL: /v4/posting/fbs/ship flips it
  // to awaiting_deliver, which is what the adapter's post-write re-read must
  // observe (the spec is explicit that a 200 alone proves nothing).
  let postingStatus = AWAITING_PACKAGING;
  let callCount = 0;
  const fetchImpl = vi.fn(async (input: string) => {
    callCount += 1;
    const url = String(input);
    if (url.includes('/v4/posting/fbs/ship')) {
      postingStatus = AWAITING_DELIVER;
      return new Response(JSON.stringify({ result: [SHIPMENT_ORDER_ID] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Built per request so it reflects the CURRENT scripted status: the
    // adapter must observe the post-write state, and a route object built
    // once would freeze the pre-write status.
    if (url.includes('/v3/posting/fbs/get')) {
      return new Response(JSON.stringify({ result: scriptedPosting() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    for (const [prefix, route] of routes) {
      if (url.includes(prefix)) {
        return new Response(route.rawBody ?? JSON.stringify(route.body), {
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
    adapter: new OzonAdapter(
      client,
      // The shipment operations run against the SAME scripted transport, so
      // the contract suite can exercise the write path without ever reaching
      // the real platform (AGENTS.md §92).
      new OzonShipmentService(client, {
        log: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      } as unknown as ConstructorParameters<typeof OzonShipmentService>[1]),
    ),
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
      // 共享契约套件用的是平台中立夹具（result.{has_next,postings}）；
      // OZON 的 v4 list 是顶层 + 游标分页（2026-10-20），这里做一次翻译。
      const wireBody =
        endpoint === '/v4/posting/fbs/list' &&
        typeof body === 'object' &&
        body !== null &&
        'result' in body
          ? (() => {
              const result = (body as { result: { has_next?: boolean; postings?: unknown[] } })
                .result;
              return {
                has_next: result.has_next === true,
                cursor: result.has_next === true ? 'contract-cursor' : '',
                postings: result.postings ?? [],
              };
            })()
          : body;
      routes.set(endpoint, { endpoint, status, body: wireBody, headers });
    },
    calls: () => callCount,
    shipmentFulfillment: {
      platformOrderId: SHIPMENT_ORDER_ID,
      scriptAlreadyPrepared: () => {
        postingStatus = AWAITING_DELIVER;
      },
      scriptPrepareSuccess: () => {
        postingStatus = AWAITING_PACKAGING;
      },
      scriptLabel: () => {
        routes.set('/v2/posting/fbs/package-label', {
          endpoint: '/v2/posting/fbs/package-label',
          status: 200,
          body: null,
          // The spec declares application/pdf while documenting a JSON
          // envelope; the contract suite only cares that A file comes back.
          rawBody: LABEL_PDF,
          headers: { 'Content-Type': 'application/pdf' },
        });
      },
    },
  };

  /** The scripted posting as of NOW - reflects every ship call so far. */
  function scriptedPosting(): Record<string, unknown> {
    return {
      posting_number: SHIPMENT_ORDER_ID,
      status: postingStatus,
      tracking_number: postingStatus === AWAITING_DELIVER ? 'OZ-TRACK-1' : null,
      in_process_at: '2026-09-08T10:15:30.000Z',
      products: [{ offer_id: 'SKU-A', sku: 987654321, quantity: 1 }],
    };
  }
}

/** Maps a scripted body to the platform endpoint it belongs to. */
function endpointOf(body: unknown): string {
  if (typeof body === 'object' && body !== null && 'result' in body) {
    const result = (body as { result: Record<string, unknown> }).result;
    if ('postings' in result) {
      return '/v4/posting/fbs/list';
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
