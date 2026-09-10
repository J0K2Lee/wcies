import { Injectable } from '@nestjs/common';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformCredentialContext,
  PlatformListingRaw,
  PlatformOrderRaw,
  PlatformWebhookEvent,
  StoreContext,
} from '@wcies/platform-contracts';
import { OzonClient, OzonAuth } from './ozon.client';
import { mapPostingToOrder, mapProductToListing, mapWebhookPayload } from './ozon.mapper';
import { StoreCredentialMalformedError } from '../integration.errors';
import { OzonProductInfoItem, OzonProductListItem } from './types/api.types';
import { PlatformApiError } from '../platform-error';
import {
  INITIAL_ORDER_WINDOW_DAYS,
  ORDER_WINDOW_OVERLAP_MS,
  isOzonListingCursor,
  isOzonOrderResumeCursor,
  isOzonOrderWindowCursor,
  isOzonPostingNumbersCursor,
  OzonListingCursor,
  OzonOrderWindowCursor,
} from './types/cursors';

/** Page sizes (spec: /v3/product/list limit <= 1000; postings <= 1000). */
const LISTING_PAGE_SIZE = 200;
const ORDER_PAGE_SIZE = 200;
/** Batch size for /v3/product/info/list detail enrichment (conservative). */
const PRODUCT_INFO_BATCH = 100;

/**
 * OZON implementation of the platform adapter contract (task §7/§21).
 *
 * Combines OzonClient (transport) + OzonMapper (normalization) and owns ONLY
 * cursor interpretation. It never touches WCIES repositories/services.
 */
@Injectable()
export class OzonAdapter implements PlatformAdapter {
  readonly platformCode = 'OZON' as const;

  constructor(private readonly client: OzonClient) {}

  async validateCredential(context: PlatformCredentialContext): Promise<void> {
    // Safe read-only validation (task §32): one minimal product list call.
    await this.client.pingCredential(
      parseAuth(context.credential, context.storeId),
      context.storeId,
    );
  }

  async fetchListings(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformListingRaw>> {
    const auth = parseAuth(context.credential, context.storeId);
    const lastId = isOzonListingCursor(cursor) ? cursor.lastId : '';

    const listResponse = await this.client.productList(auth, context.storeId, {
      lastId,
      limit: LISTING_PAGE_SIZE,
    });
    const result = listResponse.result;
    if (
      typeof result?.last_id !== 'string' ||
      !Array.isArray(result?.items) ||
      result.items.some(
        (item: unknown) =>
          typeof (item as OzonProductListItem | null)?.product_id !== 'number' ||
          typeof (item as OzonProductListItem | null)?.offer_id !== 'string',
      )
    ) {
      throw malformedListResponse(context.storeId);
    }
    const pageItems: ReadonlyArray<OzonProductListItem> = result.items;

    // Enrich page items with product info (name / OZON sku id / archived).
    const infos = await this.fetchProductInfos(auth, context.storeId, pageItems);
    const items = pageItems.map((listItem) =>
      mapProductToListing(listItem, infos.get(listItem.product_id)),
    );

    const hasMore = result.items.length >= LISTING_PAGE_SIZE && result.last_id !== lastId;
    const nextCursor: OzonListingCursor | null = hasMore
      ? { kind: 'OZON_LISTING', lastId: result.last_id }
      : null;
    return { items, nextCursor, hasMore };
  }

  async fetchOrders(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformOrderRaw>> {
    const auth = parseAuth(context.credential, context.storeId);

    const postingNumbersCursor =
      cursor !== undefined && cursor !== null && isOzonPostingNumbersCursor(cursor) ? cursor : null;
    if (postingNumbersCursor !== null) {
      return this.fetchPostingsByNumber(auth, context.storeId, postingNumbersCursor.numbers);
    }

    const windowCursor = normalizeWindowCursor(cursor);
    const response = await this.client.fbsPostingList(auth, context.storeId, {
      since: windowCursor.since,
      to: windowCursor.to,
      offset: windowCursor.offset,
      limit: ORDER_PAGE_SIZE,
    });
    const result = response.result;
    if (typeof result?.has_next !== 'boolean' || !Array.isArray(result?.postings)) {
      throw malformedPostingListResponse(context.storeId);
    }
    const items = result.postings.map(mapPostingToOrder);
    const hasMore = result.has_next;
    const nextCursor: unknown = hasMore
      ? ({ ...windowCursor, offset: windowCursor.offset + result.postings.length } as const)
      : // Window complete: the resume marker opens the NEXT window at the
        // next run, overlapped by 60s (idempotent ingest absorbs re-reads).
        ({ kind: 'OZON_ORDER_RESUME', windowEnd: windowCursor.to } as const);
    return { items, nextCursor, hasMore };
  }

  async processWebhook(_context: StoreContext, payload: unknown): Promise<PlatformWebhookEvent[]> {
    return mapWebhookPayload(payload);
  }

  async fetchOrdersByPlatformIds(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderRaw[]> {
    const auth = parseAuth(context.credential, context.storeId);
    const page = await this.fetchPostingsByNumber(auth, context.storeId, platformOrderIds);
    return page.items;
  }

  // -----------------------------------------------------------------------

  private async fetchPostingsByNumber(
    auth: OzonAuth,
    storeId: string,
    numbers: readonly string[],
  ): Promise<PaginatedResult<PlatformOrderRaw>> {
    const items: PlatformOrderRaw[] = [];
    for (const number of numbers) {
      const response = await this.client.fbsPostingGet(auth, storeId, number);
      if (typeof response?.result?.posting_number !== 'string') {
        throw malformedPostingGetResponse(storeId, number);
      }
      items.push(mapPostingToOrder(response.result));
    }
    return { items, nextCursor: null, hasMore: false };
  }

  private async fetchProductInfos(
    auth: OzonAuth,
    storeId: string,
    items: readonly { product_id: number; offer_id: string }[],
  ): Promise<Map<number, OzonProductInfoItem>> {
    const byProductId = new Map<number, OzonProductInfoItem>();
    const offerIds = items.map((item) => item.offer_id);
    for (let start = 0; start < offerIds.length; start += PRODUCT_INFO_BATCH) {
      const batch = offerIds.slice(start, start + PRODUCT_INFO_BATCH);
      const response = await this.client.productInfoList(auth, storeId, batch);
      // Real API (verified 2026-09-09): items sit at top level, no `result`
      // envelope - see OzonProductInfoListResponse.
      if (
        !Array.isArray(response?.items) ||
        response.items.some(
          (info: unknown) => typeof (info as OzonProductInfoItem | null)?.id !== 'number',
        )
      ) {
        throw malformedInfoResponse(storeId);
      }
      const infos = response.items.filter(
        (info: unknown): info is OzonProductInfoItem =>
          typeof (info as OzonProductInfoItem | null)?.id === 'number',
      );
      for (const info of infos) {
        byProductId.set(info.id, info);
      }
    }
    return byProductId;
  }
}

// ---------------------------------------------------------------------------

function parseAuth(credential: Readonly<Record<string, unknown>>, storeId: string): OzonAuth {
  const clientId = credential['clientId'];
  const apiKey = credential['apiKey'];
  if (
    typeof clientId !== 'string' ||
    clientId === '' ||
    typeof apiKey !== 'string' ||
    apiKey === ''
  ) {
    throw new StoreCredentialMalformedError(storeId, 'OZON', 'expected { clientId, apiKey }');
  }
  return { clientId, apiKey };
}

/**
 * Computes the effective window cursor:
 * - explicit WINDOW cursor (paged walk inside one window);
 * - RESUME cursor (previous run completed): new window starting at the last
 *   window end minus a small overlap;
 * - no cursor: initial catch-up window of INITIAL_ORDER_WINDOW_DAYS days.
 */
function normalizeWindowCursor(cursor: unknown): OzonOrderWindowCursor {
  if (isOzonOrderWindowCursor(cursor)) {
    return cursor;
  }
  const to = new Date();
  let since: Date;
  if (isOzonOrderResumeCursor(cursor)) {
    since = new Date(new Date(cursor.windowEnd).getTime() - ORDER_WINDOW_OVERLAP_MS);
    if (since.getTime() >= to.getTime()) {
      since = new Date(to.getTime() - ORDER_WINDOW_OVERLAP_MS);
    }
  } else {
    since = new Date(to.getTime() - INITIAL_ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }
  return {
    kind: 'OZON_ORDER_WINDOW',
    since: since.toISOString(),
    to: to.toISOString(),
    offset: 0,
  };
}

function malformedListResponse(storeId: string): Error {
  return new OzonBadShape(storeId, '/v3/product/list', 'result.last_id / result.items missing');
}
function malformedInfoResponse(storeId: string): Error {
  return new OzonBadShape(storeId, '/v3/product/info/list', 'result.items missing');
}
function malformedPostingListResponse(storeId: string): Error {
  return new OzonBadShape(
    storeId,
    '/v3/posting/fbs/list',
    'result.has_next / result.postings missing',
  );
}
function malformedPostingGetResponse(storeId: string, postingNumber: string): Error {
  return new OzonBadShape(
    storeId,
    '/v3/posting/fbs/get',
    `result.posting_number missing for ${postingNumber}`,
  );
}

class OzonBadShape extends PlatformApiError {
  constructor(storeId: string, endpoint: string, reason: string) {
    super({
      code: 'PLATFORM_BAD_RESPONSE',
      httpStatus: null,
      requestId: null,
      endpoint,
      storeId,
      message: `OZON ${endpoint} response violates the verified schema: ${reason}`,
      details: { reason },
    });
  }
}
