import { Injectable } from '@nestjs/common';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformCredentialContext,
  PlatformListingRaw,
  PlatformOrderRaw,
  PlatformReturnRaw,
  PlatformWebhookEvent,
  StoreContext,
} from '@wcies/platform-contracts';
import { YandexClient, YxAuth } from './yandex.client';
import {
  mapOfferMappingToListing,
  mapOrderToOrder,
  mapReturnToReturn,
  mapWebhookPayload,
} from './yandex.mapper';
import { StoreCredentialMalformedError } from '../integration.errors';
import { YxCampaign, YxOfferMapping, YxReturnItem, YxOrder } from './types/api.types';
import { PlatformApiError } from '../platform-error';
import {
  INITIAL_ORDER_WINDOW_DAYS,
  ORDER_WINDOW_OVERLAP_MS,
  isYxListingCursor,
  isYxOrderResumeCursor,
  isYxOrderWindowCursor,
  isYxReturnCursor,
  YxIdentity,
  YxListingCursor,
  YxOrderWindowCursor,
} from './types/cursors';

/** offer-mappings limit 1-100 (default 50); orders limit <= 50 (no default). */
const LISTING_PAGE_SIZE = 100;
const ORDER_PAGE_SIZE = 50;
/** Returns limit <= 100 (docs §6). */
const RETURN_PAGE_SIZE = 100;
/** business orders accepts up to 50 orderIds per targeted read (docs §3). */
const TARGETED_IDS_BATCH = 50;

/**
 * Yandex Market implementation of the platform adapter contract (2026-09-18).
 *
 * Combines YandexClient (transport) + YandexMapper (normalization) and owns
 * ONLY cursor interpretation. It never touches WCIES repositories/services.
 *
 * Identity model (docs §1): one Api-Key covers a whole business (柜面);
 * GET /v2/campaigns returns every campaign it can access. WCIES stores are
 * campaigns - so the store->campaign mapping comes from the credential:
 * a token with exactly one campaign resolves implicitly; multi-campaign
 * tokens MUST carry an explicit `campaignId` in the credential payload.
 * The resolved {businessId, campaignId} rides inside the cursors so paged
 * walks cost no extra identity lookups.
 */
@Injectable()
export class YandexAdapter implements PlatformAdapter {
  readonly platformCode = 'YANDEX' as const;

  constructor(private readonly client: YandexClient) {}

  async validateCredential(context: PlatformCredentialContext): Promise<void> {
    // GET /v2/campaigns doubles as the light credential-validation read
    // (docs §1) and enforces a resolvable identity at the same time.
    await this.resolveIdentity(
      parseYxAuth(context.credential, context.storeId),
      context.storeId,
      context.credential,
    );
  }

  async fetchListings(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformListingRaw>> {
    const auth = parseYxAuth(context.credential, context.storeId);
    let identity: YxIdentity;
    let pageToken: string | undefined;
    if (isYxListingCursor(cursor)) {
      identity = cursor;
      pageToken = cursor.pageToken ?? undefined;
    } else {
      identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    }

    const response = await this.client.offerMappings(auth, context.storeId, {
      businessId: identity.businessId,
      limit: LISTING_PAGE_SIZE,
      pageToken,
    });
    const result = response.result;
    if (typeof result !== 'object' || result === null || !Array.isArray(result.offerMappings)) {
      throw malformedListResponse(context.storeId);
    }
    const entries: ReadonlyArray<YxOfferMapping> = result.offerMappings;
    const items = entries.map((entry) => mapOfferMappingToListing(entry, identity.campaignId));

    const nextToken = readStringOrNull(result.paging?.nextPageToken);
    const hasMore = nextToken !== null;
    const nextCursor: YxListingCursor | null = hasMore
      ? {
          kind: 'YX_LISTING',
          businessId: identity.businessId,
          campaignId: identity.campaignId,
          pageToken: nextToken,
        }
      : null;
    return { items, nextCursor, hasMore };
  }

  async fetchOrders(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformOrderRaw>> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const windowCursor = await normalizeWindowCursor(
      cursor,
      auth,
      context.storeId,
      context.credential,
      this.resolveIdentity.bind(this),
    );
    const response = await this.client.businessOrders(auth, context.storeId, {
      businessId: windowCursor.businessId,
      limit: ORDER_PAGE_SIZE,
      pageToken: windowCursor.pageToken ?? undefined,
      body: {
        dates: {
          updateDateFrom: windowCursor.updateFrom,
          updateDateTo: windowCursor.updateTo,
        },
      },
    });
    if (typeof response !== 'object' || response === null || !Array.isArray(response.orders)) {
      throw malformedOrdersResponse(context.storeId);
    }
    const orders: ReadonlyArray<YxOrder> = response.orders;
    const items = orders.map(mapOrderToOrder);

    const nextToken = readStringOrNull(response.paging?.nextPageToken);
    if (nextToken !== null) {
      const nextCursor: YxOrderWindowCursor = { ...windowCursor, pageToken: nextToken };
      return { items, nextCursor, hasMore: true };
    }
    // Window complete: the resume marker opens the NEXT window at the next
    // run, overlapped by 60s (idempotent ingest absorbs re-reads) - same
    // pattern as the OZON window machine.
    return {
      items,
      nextCursor: {
        kind: 'YX_ORDER_RESUME',
        businessId: windowCursor.businessId,
        campaignId: windowCursor.campaignId,
        windowEnd: windowCursor.updateTo,
      },
      hasMore: false,
    };
  }

  async processWebhook(_context: StoreContext, payload: unknown): Promise<PlatformWebhookEvent[]> {
    return mapWebhookPayload(payload);
  }

  async fetchOrdersByPlatformIds(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderRaw[]> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    const items: PlatformOrderRaw[] = [];
    for (let start = 0; start < platformOrderIds.length; start += TARGETED_IDS_BATCH) {
      const batch = platformOrderIds.slice(start, start + TARGETED_IDS_BATCH);
      const response = await this.client.businessOrders(auth, context.storeId, {
        businessId: identity.businessId,
        limit: ORDER_PAGE_SIZE,
        body: { orderIds: [...batch] },
      });
      if (!Array.isArray(response?.orders)) {
        throw malformedOrdersResponse(context.storeId);
      }
      items.push(...response.orders.map(mapOrderToOrder));
    }
    return items;
  }

  async fetchReturns(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformReturnRaw>> {
    const auth = parseYxAuth(context.credential, context.storeId);
    let identity: YxIdentity;
    let pageToken: string | undefined;
    if (isYxReturnCursor(cursor)) {
      identity = cursor;
      pageToken = cursor.pageToken ?? undefined;
    } else {
      identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    }
    const response = await this.client.campaignReturns(auth, context.storeId, {
      campaignId: identity.campaignId,
      limit: RETURN_PAGE_SIZE,
      pageToken,
    });
    if (typeof response !== 'object' || response === null || !Array.isArray(response.returns)) {
      throw malformedReturnsResponse(context.storeId);
    }
    const rows: ReadonlyArray<YxReturnItem> = response.returns;
    const items = rows.map(mapReturnToReturn);
    const nextToken = readStringOrNull(response.paging?.nextPageToken);
    return {
      items,
      nextCursor:
        nextToken !== null
          ? {
              kind: 'YX_RETURN',
              businessId: identity.businessId,
              campaignId: identity.campaignId,
              pageToken: nextToken,
            }
          : null,
      hasMore: nextToken !== null,
    };
  }

  // -----------------------------------------------------------------------

  /** Exposed for the Yandex warehouse catalog (P4). */
  async resolveIdentityForContext(context: StoreContext): Promise<YxIdentity> {
    const auth = parseYxAuth(context.credential, context.storeId);
    return this.resolveIdentity(auth, context.storeId, context.credential);
  }

  /**
   * store -> {businessId, campaignId}. Explicit credential campaignId wins;
   * otherwise a single-campaign token resolves implicitly; anything else is
   * an unresolvable store configuration (never a guess, AGENTS.md §89).
   */
  private async resolveIdentity(
    auth: YxAuth,
    storeId: string,
    credential: Readonly<Record<string, unknown>>,
  ): Promise<YxIdentity> {
    const campaigns: YxCampaign[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.client.campaigns(auth, storeId, pageToken);
      if (typeof response !== 'object' || response === null || !Array.isArray(response.campaigns)) {
        throw malformedCampaignsResponse(storeId);
      }
      const rows: readonly YxCampaign[] = response.campaigns;
      for (const row of rows) {
        campaigns.push(row);
      }
      pageToken = readStringOrNull(response.paging?.nextPageToken) ?? undefined;
    } while (pageToken !== undefined);

    const explicit = readStringOrNull(credential['campaignId'] ?? null);
    if (explicit !== null) {
      const match = campaigns.find((campaign) => String(campaign.id ?? '') === explicit);
      if (match === undefined) {
        throw new StoreCredentialMalformedError(
          storeId,
          'YANDEX',
          `credential campaignId ${explicit} 不在该 Api-Key 可访问的 campaign 列表中`,
        );
      }
      return identityOf(match, storeId);
    }
    if (campaigns.length === 1 && campaigns[0] !== undefined) {
      return identityOf(campaigns[0], storeId);
    }
    throw new StoreCredentialMalformedError(
      storeId,
      'YANDEX',
      campaigns.length === 0
        ? '该 Api-Key 无可访问 campaign'
        : `该 Api-Key 可访问 ${campaigns.length} 个 campaign，需在凭证中指定 campaignId`,
    );
  }
}

// ---------------------------------------------------------------------------

function identityOf(campaign: YxCampaign, storeId: string): YxIdentity {
  const campaignId = campaign.id;
  const businessId = campaign.businessId;
  if (
    (typeof campaignId !== 'string' && typeof campaignId !== 'number') ||
    (typeof businessId !== 'string' && typeof businessId !== 'number')
  ) {
    throw new StoreCredentialMalformedError(
      storeId,
      'YANDEX',
      'campaign 记录缺少 campaignId/businessId',
    );
  }
  return { businessId: String(businessId), campaignId: String(campaignId) };
}

function parseYxAuth(credential: Readonly<Record<string, unknown>>, storeId: string): YxAuth {
  const apiKey = credential['apiKey'];
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new StoreCredentialMalformedError(storeId, 'YANDEX', 'expected { apiKey, campaignId? }');
  }
  return { apiKey };
}

type IdentityResolver = (
  auth: YxAuth,
  storeId: string,
  credential: Readonly<Record<string, unknown>>,
) => Promise<YxIdentity>;

/**
 * Effective window cursor: explicit WINDOW / RESUME / fresh catch-up. The
 * identity resolution is async (one campaigns read) only when the cursor
 * does not already carry it.
 */
async function normalizeWindowCursor(
  cursor: unknown,
  auth: YxAuth,
  storeId: string,
  credential: Readonly<Record<string, unknown>>,
  resolveIdentity: IdentityResolver,
): Promise<YxOrderWindowCursor> {
  if (isYxOrderWindowCursor(cursor)) {
    return cursor;
  }
  let identity: YxIdentity;
  if (isYxOrderResumeCursor(cursor)) {
    identity = cursor;
  } else {
    identity = await resolveIdentity(auth, storeId, credential);
  }
  const now = new Date();
  let since: Date;
  if (isYxOrderResumeCursor(cursor)) {
    since = new Date(new Date(cursor.windowEnd).getTime() - ORDER_WINDOW_OVERLAP_MS);
    if (since.getTime() >= now.getTime()) {
      since = new Date(now.getTime() - ORDER_WINDOW_OVERLAP_MS);
    }
  } else {
    since = new Date(now.getTime() - INITIAL_ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  }
  return {
    kind: 'YX_ORDER_WINDOW',
    businessId: identity.businessId,
    campaignId: identity.campaignId,
    updateFrom: since.toISOString(),
    updateTo: now.toISOString(),
    pageToken: null,
  };
}

function readStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function malformedCampaignsResponse(storeId: string): Error {
  return new YxBadShape(storeId, '/v2/campaigns', 'campaigns array missing');
}
function malformedListResponse(storeId: string): Error {
  return new YxBadShape(storeId, 'offer-mappings', 'result.offerMappings missing');
}
function malformedOrdersResponse(storeId: string): Error {
  return new YxBadShape(storeId, 'businesses/orders', 'orders array missing');
}
function malformedReturnsResponse(storeId: string): Error {
  return new YxBadShape(storeId, 'campaigns/returns', 'returns array missing');
}

class YxBadShape extends PlatformApiError {
  constructor(storeId: string, endpoint: string, reason: string) {
    super({
      code: 'PLATFORM_BAD_RESPONSE',
      httpStatus: null,
      requestId: null,
      endpoint,
      storeId,
      message: `Yandex ${endpoint} response violates the verified schema: ${reason}`,
      details: { reason },
    });
  }
}
