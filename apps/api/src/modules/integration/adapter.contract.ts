import { describe, expect, it } from 'vitest';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformCredentialContext,
  StoreContext,
} from '@wcies/platform-contracts';
import { PlatformApiError } from './platform-error';

/**
 * Shared Platform Adapter Contract Suite (Sprint 5 task §42; extracted
 * 2026-09-18 so the WB / Yandex adapters run the SAME contract).
 *
 * The harness scripts raw HTTP responses through the adapter's injectable
 * transport; assertions only use the CONTRACT types (PaginatedResult / Raw
 * models / PlatformApiError). Platform-specific id formatting and page-walk
 * depth are expressed through the optional harness fields.
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
  /**
   * Rewrites a generic order fixture id ("O-3") into the platformOrderId the
   * platform's own id type produces. Optional - default keeps it verbatim
   * (OZON posting numbers are strings; WB task ids are numeric).
   */
  expectedOrderId?(sourceId: string): string;
  /**
   * fetchOrders pages the adapter walks until hasMore=false. OZON / Yandex:
   * 2 (window page + resume marker). WB: 3 - after the FBS pages the adapter
   * hands over to its statistics phase before finishing. Default 2.
   */
  readonly orderPagesUntilDone?: number;
}

export function runAdapterContractSuite(harness: AdapterContractHarness): void {
  const { adapter, storeContext, credentialContext } = harness;
  const expectedOrderId = (sourceId: string): string =>
    harness.expectedOrderId?.(sourceId) ?? sourceId;

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

      const pages = harness.orderPagesUntilDone ?? 2;
      let current = first;
      for (let page = 2; page <= pages; page += 1) {
        const isLast = page === pages;
        harness.enqueue(200, {
          result: { has_next: !isLast, postings: [postingItem(`O-${page}`)] },
        });
        const next = await adapter.fetchOrders(storeContext, current.nextCursor);
        current = next;
        if (isLast) {
          expect(next.hasMore).toBe(false);
          expect(next.nextCursor).not.toBeNull(); // resume marker for the next run
        } else {
          expect(next.hasMore).toBe(true);
        }
      }
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
      expect(order.platformOrderId).toBe(expectedOrderId('O-3'));
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
      const rawSecret = (credentialContext.credential as { apiKey?: unknown }).apiKey;
      const secret = typeof rawSecret === 'string' ? rawSecret : '';
      const secretHead = secret.slice(0, 8);
      expect(secretHead === '' || !serialized.includes(secretHead)).toBe(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Generic fixtures (OZON-shaped; harnesses translate to their platform DTOs)
// ---------------------------------------------------------------------------

function okBody() {
  return { result: { last_id: '', items: [] } };
}

export function listingItem(productId: string, offerId: string) {
  return {
    product_id: Number(productId),
    offer_id: offerId,
    archived: false,
  };
}

export function postingItem(postingNumber: string) {
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
