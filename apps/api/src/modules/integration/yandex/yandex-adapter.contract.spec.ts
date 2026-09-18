import { vi } from 'vitest';
import { YandexAdapter } from './yandex.adapter';
import { YandexClient } from './yandex.client';
import { YandexShipmentService } from './yandex-shipment.service';
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
  /** Literal body (label PDF bytes) instead of JSON.stringify. */
  readonly rawBody?: string;
}

const EVERGREEN_CAMPAIGNS = { campaigns: [{ id: 1001, businessId: 2002, name: 'Test Shop' }] };

const LOGGER_STUB = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof YandexShipmentService>[1];

function makeYandexHarness(): AdapterContractHarness {
  const routes = new Map<string, ScriptedRoute>();
  let fallback: ScriptedRoute | null = null;
  // The scripted order's lifecycle state; the PUT write flips it, which is
  // what the adapter's post-write re-read must observe.
  let orderStatus = 'PROCESSING';
  let orderSubstatus: string | undefined = 'STARTED';
  const SHIPMENT_ORDER_ID = 5632423;
  const LABEL_PDF = '%PDF-1.4 scripted label';
  let callCount = 0;
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    callCount += 1;
    const url = String(input);
    // Targeted order re-read (also the post-write confirmation). ONLY for
    // orderIds bodies: fetchOrders walks the SAME endpoint with a window
    // body, and must keep using the scripted routes.
    const requestBody =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    if (
      url.includes('/v1/businesses/') &&
      url.includes('/orders') &&
      Array.isArray(requestBody.orderIds)
    ) {
      return new Response(
        JSON.stringify({
          orders: [
            {
              orderId: SHIPMENT_ORDER_ID,
              status: orderStatus,
              ...(orderSubstatus === undefined ? {} : { substatus: orderSubstatus }),
              creationDate: '2026-09-08T10:15:30+03:00',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // The one seller write: flips the scripted lifecycle state.
    if (url.includes('/orders/') && url.endsWith('/status')) {
      orderStatus = 'PROCESSING';
      orderSubstatus = 'READY_TO_SHIP';
      return new Response(
        JSON.stringify({
          order: { orderId: SHIPMENT_ORDER_ID, status: orderStatus, substatus: orderSubstatus },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    // Label PDF - served raw, only once the order is READY_TO_SHIP.
    if (url.includes('/delivery/labels')) {
      if (orderSubstatus !== 'READY_TO_SHIP') {
        return new Response(JSON.stringify({ status: 'ERROR', errors: [{ code: 'NOT_READY' }] }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(LABEL_PDF, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }
    for (const route of routes.values()) {
      if (route.match(url)) {
        return new Response(route.rawBody ?? JSON.stringify(route.body), {
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
  const CAMPAIGNS_ROUTE: ScriptedRoute = {
    match: (url) => url.endsWith('/v2/campaigns') || url.includes('/v2/campaigns?'),
    status: 200,
    body: EVERGREEN_CAMPAIGNS,
  };
  return {
    name: 'YANDEX',
    adapter: new YandexAdapter(client, new YandexShipmentService(client, LOGGER_STUB)),
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
    shipmentFulfillment: {
      platformOrderId: String(SHIPMENT_ORDER_ID),
      scriptAlreadyPrepared: () => {
        orderStatus = 'PROCESSING';
        orderSubstatus = 'READY_TO_SHIP';
        fallback = null;
        routes.set('campaigns', CAMPAIGNS_ROUTE);
      },
      scriptPrepareSuccess: () => {
        orderStatus = 'PROCESSING';
        orderSubstatus = 'STARTED';
        fallback = null;
        routes.set('campaigns', CAMPAIGNS_ROUTE);
      },
      scriptLabel: () => {
        orderStatus = 'PROCESSING';
        orderSubstatus = 'READY_TO_SHIP';
        fallback = null;
        routes.set('campaigns', CAMPAIGNS_ROUTE);
      },
    },
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
