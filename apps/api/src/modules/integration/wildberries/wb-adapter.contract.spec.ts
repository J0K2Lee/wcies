import { vi } from 'vitest';
import { WbAdapter } from './wb.adapter';
import { WbClient, WB_DEFAULT_BASE_URLS } from './wb.client';
import { WbShipmentService } from './wb-shipment.service';
import {
  AdapterContractHarness,
  listingItem,
  postingItem,
  runAdapterContractSuite,
} from '../adapter.contract';

/**
 * WB harness for the shared Platform Adapter Contract Suite. Route-based
 * fake server over the injectable fetch transport; generic (OZON-shaped)
 * fixtures are translated into the WB DTOs of the matching endpoint:
 * - result.last_id/items   -> content /content/v2/get/cards/list cards
 * - result.postings        -> marketplace /api/v3/orders (has_next -> next)
 * - everything else        -> common /api/v1/seller-info
 * The statistics endpoint is served by a default empty-rows route.
 */

const STORE_CREDENTIAL = { apiKey: 'unit-test-wb-api-key' };
const BASES = WB_DEFAULT_BASE_URLS;

interface ScriptedRoute {
  readonly url: string;
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

function makeWbHarness(): AdapterContractHarness {
  const routes = new Map<string, ScriptedRoute>([
    // Default statistics route: empty incremental page ends the STATS phase.
    [
      `${BASES.statistics}/api/v1/supplier/orders`,
      { url: `${BASES.statistics}/api/v1/supplier/orders`, status: 200, body: {} },
    ],
  ]);
  // Fallback for URLs without a scripted route: the suite's generic bodies
  // (okBody / error bodies) target whatever endpoint the adapter happens to
  // call (validateCredential hits common, the malformed-body test hits
  // content) - shape-based routing cannot know, so serve them anywhere.
  let fallback: ScriptedRoute | null = null;
  // The scripted assembly order's seller status. Flips to `confirm` when the
  // supply PATCH lands, which is what the adapter's post-write re-read sees.
  let wbOrderStatus = 'new';
  const SHIPMENT_ORDER_ID = 5632423;
  const SUPPLY_ID = 'WB-GI-1';
  const STICKER_PNG = Buffer.from('%PNG-scripted-sticker').toString('base64');
  let callCount = 0;
  const fetchImpl = vi.fn(async (input: string) => {
    callCount += 1;
    const url = String(input);
    if (url.startsWith(`${BASES.marketplace}/api/v3/orders/status`)) {
      return new Response(
        JSON.stringify({
          orders: [{ id: SHIPMENT_ORDER_ID, supplierStatus: wbOrderStatus, wbStatus: 'waiting' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === `${BASES.marketplace}/api/v3/supplies`) {
      return new Response(JSON.stringify({ id: SUPPLY_ID }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === `${BASES.marketplace}/api/marketplace/v3/supplies/${SUPPLY_ID}/orders`) {
      wbOrderStatus = 'confirm';
      return new Response(null, { status: 204 });
    }
    if (url.startsWith(`${BASES.marketplace}/api/v3/orders/stickers`)) {
      return new Response(
        JSON.stringify({
          stickers: [
            {
              orderId: SHIPMENT_ORDER_ID,
              partA: '231648',
              partB: '9753',
              barcode: '!uKEtQZVx',
              file: STICKER_PNG,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    for (const [prefix, route] of routes) {
      if (url.startsWith(prefix)) {
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
  return {
    name: 'WB',
    adapter: new WbAdapter(client, new WbShipmentService(client, LOGGER_STUB)),
    credentialContext: {
      storeId: 'store-1',
      platform: 'WB',
      credential: STORE_CREDENTIAL,
    },
    storeContext: {
      storeId: 'store-1',
      storeCode: 'WB-A',
      platform: 'WB',
      credential: STORE_CREDENTIAL,
    },
    // Generic "O-3" -> WB numeric assembly-task id 3.
    expectedOrderId: (sourceId: string) => String(Number(sourceId.replace(/\D/g, ''))),
    // FBS page -> STATS phase transition adds a third page before done.
    orderPagesUntilDone: 3,
    enqueue: (status: number, body: unknown, headers?: Record<string, string>) => {
      fallback = { url: '(fallback)', status, body, headers };
      const converted = translate(body);
      // Unclassified bodies ride the fallback - stale per-endpoint routes
      // from earlier tests must not shadow them.
      routes.delete(`${BASES.content}/content/v2/get/cards/list`);
      routes.delete(`${BASES.marketplace}/api/v3/orders`);
      if (converted !== null) {
        routes.set(converted.url, { url: converted.url, status, body: converted.body, headers });
      }
    },
    calls: () => callCount,
    shipmentFulfillment: {
      platformOrderId: String(SHIPMENT_ORDER_ID),
      scriptAlreadyPrepared: () => {
        wbOrderStatus = 'confirm';
      },
      scriptPrepareSuccess: () => {
        wbOrderStatus = 'new';
      },
      scriptLabel: () => {
        // The sticker route is always scripted; the caller's status decides.
        wbOrderStatus = 'confirm';
      },
    },
  };
}

const LOGGER_STUB = {
  log: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof WbShipmentService>[1];

/**
 * Translates generic (OZON-shaped) fixtures into WB DTOs. Returns null when
 * the body carries no recognizable fixture shape (error bodies, okBody,
 * arbitrary malformed payloads) - those ride the fallback route.
 */
function translate(body: unknown): { url: string; body: unknown } | null {
  if (typeof body === 'object' && body !== null && 'result' in body) {
    const result = (body as { result: Record<string, unknown> }).result;
    if ('postings' in result && Array.isArray(result.postings) && result.postings.length > 0) {
      const hasNext = result.has_next === true;
      return {
        url: `${BASES.marketplace}/api/v3/orders`,
        body: {
          orders: result.postings.map((raw) => toWbOrder(raw as ReturnType<typeof postingItem>)),
          next: hasNext ? 999 : 0,
        },
      };
    }
    if ('last_id' in result && Array.isArray(result.items) && result.items.length > 0) {
      const items = result.items as ReturnType<typeof listingItem>[];
      // T0 校准（2026-09-18 live）：cards/list 响应为顶层 {cards, cursor}，
      // cursor.updatedAt 是 RFC3339 字符串。
      return {
        url: `${BASES.content}/content/v2/get/cards/list`,
        body: {
          cards: items.map((item) => toWbCard(item)),
          cursor: {
            total: items.length,
            updatedAt: '2030-01-01T00:00:00Z',
            nmID: items.at(-1)?.product_id ?? 0,
          },
        },
      };
    }
  }
  return null;
}

function toWbCard(item: ReturnType<typeof listingItem>) {
  return {
    nmID: item.product_id,
    vendorCode: item.offer_id,
    title: `Card ${item.offer_id}`,
    sizes: [{ chrtID: 5000 + item.product_id, techSize: '0', skus: [20300 + item.product_id] }],
  };
}

function toWbOrder(posting: ReturnType<typeof postingItem>) {
  const product = posting.products[0] ?? { offer_id: 'SKU-A', sku: 1, price: '100.00' };
  return {
    id: Number(posting.posting_number.replace(/\D/g, '')),
    article: product.offer_id,
    skus: [product.sku],
    nmId: 40001,
    finalPrice: Number(product.price),
    currencyCode: 'RUB',
    createdAt: posting.in_process_at,
    supplierStatus: 'new',
    wbStatus: null,
  };
}

runAdapterContractSuite(makeWbHarness());
