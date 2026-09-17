import { vi } from 'vitest';
import { YandexAdapter } from './yandex.adapter';
import { YandexClient } from './yandex.client';
import {
  AdapterContractHarness,
  listingItem,
  postingItem,
  runAdapterContractSuite,
} from '../adapter.contract';

/**
 * Yandex harness for the shared Platform Adapter Contract Suite. Route-based
 * fake server over the injectable fetch transport; generic (OZON-shaped)
 * fixtures are translated into Yandex DTOs of the matching endpoint:
 * - result.last_id/items (empty) -> GET /v2/campaigns (identity resolution)
 * - result.last_id/items (non-empty) -> POST offer-mappings
 * - result.postings -> POST businesses/{id}/orders
 * - everything else -> fallback route (any unmatched URL)
 */

const STORE_CREDENTIAL = { apiKey: 'unit-test-yx-api-key' };
const BASE = 'https://api.partner.market.yandex.test';

interface ScriptedRoute {
  readonly match: (url: string) => boolean;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

const EVERGREEN_CAMPAIGNS = { campaigns: [{ id: 1001, businessId: 2002, name: 'Test Shop' }] };

function makeYandexHarness(): AdapterContractHarness {
  const routes = new Map<string, ScriptedRoute>();
  let fallback: ScriptedRoute | null = null;
  let callCount = 0;
  const fetchImpl = vi.fn(async (input: string) => {
    callCount += 1;
    const url = String(input);
    for (const route of routes.values()) {
      if (route.match(url)) {
        return new Response(JSON.stringify(route.body), {
          status: route.status,
          headers: { 'Content-Type': 'application/json', ...route.headers },
        });
      }
    }
    if (fallback !== null) {
      return new Response(JSON.stringify(fallback.body), {
        status: fallback.status,
        headers: { 'Content-Type': 'application/json', ...fallback.headers },
      });
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
  return {
    name: 'YANDEX',
    adapter: new YandexAdapter(client),
    credentialContext: {
      storeId: 'store-1',
      platform: 'YANDEX',
      credential: STORE_CREDENTIAL,
    },
    storeContext: {
      storeId: 'store-1',
      storeCode: 'YX-A',
      platform: 'YANDEX',
      credential: STORE_CREDENTIAL,
    },
    // Yandex orderIds are strings - the generic fixture id stays verbatim.
    expectedOrderId: (sourceId: string) => sourceId,
    enqueue: (status: number, body: unknown, headers?: Record<string, string>) => {
      const classified = classify(body);
      if (classified === null) {
        // Error / malformed bodies ride the fallback for WHATEVER endpoint
        // the adapter calls - stale specific routes must not shadow them.
        routes.clear();
        fallback = { match: () => false, status, body, headers };
        return;
      }
      fallback = null;
      for (const route of classified) {
        routes.set(route.key, { ...route, status, headers });
      }
    },
    calls: () => callCount,
  };

  function classify(
    body: unknown,
  ): ReadonlyArray<{ key: string; match: (url: string) => boolean; body: unknown }> | null {
    if (typeof body !== 'object' || body === null || !('result' in body)) {
      return null;
    }
    const result = (body as { result: Record<string, unknown> }).result;
    if ('postings' in result && Array.isArray(result.postings) && result.postings.length > 0) {
      const hasNext = result.has_next === true;
      return [
        campaignsRoute(),
        {
          key: 'orders',
          match: (url) => url.includes('/orders'),
          body: {
            status: 'OK',
            orders: result.postings.map((raw) => toYxOrder(raw as ReturnType<typeof postingItem>)),
            ...(hasNext ? { paging: { nextPageToken: 'page-2' } } : {}),
          },
        },
      ];
    }
    if ('last_id' in result && Array.isArray(result.items) && result.items.length > 0) {
      const items = result.items as ReturnType<typeof listingItem>[];
      return [
        campaignsRoute(),
        {
          key: 'listings',
          match: (url) => url.includes('/offer-mappings'),
          body: {
            result: {
              offerMappings: items.map((item) => toYxOfferMapping(item)),
              ...(items.length >= 100 ? { paging: { nextPageToken: 'page-2' } } : {}),
            },
          },
        },
      ];
    }
    if ('last_id' in result) {
      // okBody (empty listing page) doubles as the credential-validation
      // response: a valid campaigns list.
      return [campaignsRoute()];
    }
    return null;
  }

  function campaignsRoute() {
    return {
      key: 'campaigns',
      match: (url: string) => url.startsWith(`${BASE}/v2/campaigns`),
      body: EVERGREEN_CAMPAIGNS,
    };
  }
}

function toYxOfferMapping(item: ReturnType<typeof listingItem>) {
  return {
    offer: { offerId: item.offer_id, name: `Offer ${item.offer_id}` },
    mapping: { marketSku: item.product_id, marketCategoryName: 'Test' },
  };
}

function toYxOrder(posting: ReturnType<typeof postingItem>) {
  const product = posting.products[0] ?? { offer_id: 'SKU-A', quantity: 1 };
  return {
    orderId: posting.posting_number,
    campaignId: 1001,
    programType: 'FBS',
    status: 'PROCESSING',
    substatus: 'READY_TO_SHIP',
    creationDate: posting.in_process_at,
    updateDate: posting.in_process_at,
    items: [{ offerId: product.offer_id, count: product.quantity ?? 1 }],
    delivery: { type: 'DELIVERY' },
  };
}

runAdapterContractSuite(makeYandexHarness());
