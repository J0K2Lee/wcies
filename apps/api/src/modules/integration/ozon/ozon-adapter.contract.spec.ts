import { describe, expect, it, vi } from 'vitest';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformCredentialContext,
  StoreContext,
} from '@wcies/platform-contracts';
import { OzonAdapter } from './ozon.adapter';
import { OzonClient } from './ozon.client';
import { PlatformApiError } from '../platform-error';

/**
 * Platform Adapter Contract Test (Sprint 5 task §42).
 *
 * A generic, platform-agnostic suite every adapter must pass. The harness
 * scripts raw HTTP responses through the adapter's injectable transport;
 * assertions only use the CONTRACT types (PaginatedResult / Raw models /
 * PlatformApiError), so WB / Yandex adapters reuse this file verbatim by
 * providing their own harness.
 */

export interface AdapterContractHarness {
  readonly name: string;
  readonly adapter: PlatformAdapter;
  readonly credentialContext: PlatformCredentialContext;
  readonly storeContext: StoreContext;
  /** Scripts the next HTTP response (status + JSON body). */
  enqueue(status: number, body: unknown, headers?: Record<string, string>): void;
  /** Number of HTTP calls made so far. */
  readonly calls: () => number;
}

export function runAdapterContractSuite(harness: AdapterContractHarness): void {
  const { adapter, storeContext, credentialContext } = harness;

  describe(`platform adapter contract: ${harness.name}`, () => {
    it('validates credentials on a safe read (resolve on 2xx)', async () => {
      harness.enqueue(200, okBody());
      await expect(adapter.validateCredential(credentialContext)).resolves.toBeUndefined();
    });

    it('surfaces credential failures as PLATFORM_AUTH_ERROR', async () => {
      harness.enqueue(401, { code: 16, message: 'client not found' });
      const error = await capture(adapter.validateCredential(credentialContext));
      expect(error).toBeInstanceOf(PlatformApiError);
      expect((error as PlatformApiError).platformError.code).toBe('PLATFORM_AUTH_ERROR');
    });

    it('fetchListings returns contract pages with a usable cursor', async () => {
      // A full page (OZON /v3/product/list pages by size, no has_more flag):
      // page size is reached -> adapter must offer a next cursor.
      harness.enqueue(200, {
        result: {
          last_id: 'page-1-last',
          items: Array.from({ length: 200 }, (_, i) => listingItem(String(1000 + i), `SKU-${i}`)),
        },
      });
      const page: PaginatedResult<unknown> = await adapter.fetchListings(storeContext);
      expect(Array.isArray(page.items)).toBe(true);
      expect(page.items.length).toBeGreaterThan(0);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBeDefined();

      // Cursor round-trip: feeding it back continues the enumeration.
      harness.enqueue(200, {
        result: { last_id: 'page-2-last', items: [listingItem('222', 'SKU-B')] },
      });
      const second = await adapter.fetchListings(storeContext, page.nextCursor);
      expect(second.items.length).toBeGreaterThan(0);
    });

    it('fetchListings preserves raw platform data (task §43)', async () => {
      harness.enqueue(200, {
        result: { last_id: 'x', items: [listingItem('333', 'SKU-C')] },
      });
      const page = await adapter.fetchListings(storeContext);
      const listing = page.items[0] as { rawData: Record<string, unknown> };
      expect(listing.rawData).toBeTypeOf('object');
      expect(JSON.stringify(listing.rawData)).toContain('333');
    });

    it('fetchOrders returns contract pages and walks the cursor', async () => {
      harness.enqueue(200, {
        result: { has_next: true, postings: [postingItem('O-1')] },
      });
      const first = await adapter.fetchOrders(storeContext);
      expect(first.items.length).toBe(1);
      expect(first.hasMore).toBe(true);

      harness.enqueue(200, {
        result: { has_next: false, postings: [postingItem('O-2')] },
      });
      const second = await adapter.fetchOrders(storeContext, first.nextCursor);
      expect(second.hasMore).toBe(false);
      expect(second.nextCursor).not.toBeNull(); // resume marker for the next run
    });

    it('fetchOrders normalizes order fields and preserves raw data', async () => {
      harness.enqueue(200, {
        result: { has_next: false, postings: [postingItem('O-3')] },
      });
      const page = await adapter.fetchOrders(storeContext);
      const order = page.items[0] as unknown as {
        platformOrderId: string;
        platformStatus: string | null;
        orderedAt: Date;
        items: Array<{ quantity: string; rawData: Record<string, unknown> }>;
        rawData: Record<string, unknown>;
      };
      expect(order.platformOrderId).toBe('O-3');
      expect(order.platformStatus).toBeTypeOf('string');
      expect(order.orderedAt).toBeInstanceOf(Date);
      expect(order.items.length).toBeGreaterThan(0);
      expect(order.items[0]?.quantity).toBeTypeOf('string');
      expect(order.rawData).toBeTypeOf('object');
    });

    it('normalizes malformed success bodies to PLATFORM_BAD_RESPONSE', async () => {
      harness.enqueue(200, { totally: 'unexpected' });
      const error = await capture(adapter.fetchListings(storeContext));
      expect((error as PlatformApiError).platformError.code).toBe('PLATFORM_BAD_RESPONSE');
    });

    it('never leaks credentials through errors', async () => {
      harness.enqueue(403, { message: 'forbidden' });
      const error = (await capture(
        adapter.validateCredential(credentialContext),
      )) as PlatformApiError;
      const serialized = JSON.stringify({
        message: error.message,
        details: error.details,
        platformError: error.platformError,
      });
      const secret = String(STORE_CREDENTIAL.apiKey);
      expect(serialized).not.toContain(secret);
    });
  });
}

// ---------------------------------------------------------------------------
// OZON harness (scripted via the injectable fetch transport)
// ---------------------------------------------------------------------------

const STORE_CREDENTIAL = { clientId: '3636793', apiKey: 'unit-test-api-key' };

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
    [
      '/v3/product/info/list',
      { endpoint: '/v3/product/info/list', status: 200, body: { result: { items: [] } } },
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
    if ('items' in result) {
      return '/v3/product/info/list';
    }
  }
  return '/v3/product/list';
}

runAdapterContractSuite(makeOzonHarness());

// ---------------------------------------------------------------------------
// Fixtures (sanitized shapes from the verified OZON spec)
// ---------------------------------------------------------------------------

function okBody() {
  return { result: { last_id: '', items: [] } };
}

function listingItem(productId: string, offerId: string) {
  return {
    product_id: Number(productId),
    offer_id: offerId,
    archived: false,
  };
}

function postingItem(postingNumber: string) {
  return {
    posting_number: postingNumber,
    order_id: 77059,
    order_number: '77059',
    status: 'awaiting_packaging',
    in_process_at: '2026-09-08T10:15:30.000Z',
    products: [
      { offer_id: 'SKU-A', sku: 987654321, quantity: 1, currency_code: 'RUB', price: '100.00' },
    ],
  };
}

async function capture(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
    return new Error('expected the call to throw');
  } catch (error) {
    return error;
  }
}
