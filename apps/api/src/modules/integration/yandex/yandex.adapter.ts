import { Injectable } from '@nestjs/common';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformBuyerQuestionRaw,
  PlatformChatMessageRaw,
  PlatformChatSummaryRaw,
  PlatformCredentialContext,
  PlatformLabelFile,
  PlatformListingRaw,
  PlatformOrderRaw,
  PlatformReviewRaw,
  PlatformShipmentPreparation,
  PlatformReturnRaw,
  PlatformWebhookEvent,
  StoreContext,
} from '@wcies/platform-contracts';
import { YandexClient, YxAuth } from './yandex.client';
import { parseYxAuth } from './yandex-auth';
import { YandexShipmentService } from './yandex-shipment.service';
export { parseYxAuth };
import {
  mapChatMessage,
  mapChatSummaries,
  mapGoodsFeedback,
  mapGoodsQuestion,
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
/**
 * 会话列表单页大小。实测（2026-11-02 live）：`/v2/businesses/{id}/chats`
 * 的 limit **上限是 20**（50 会 400 `Parameter limit must be less than or
 * equal to 20`）；评价接口是另一套上限，这里分开常量。
 */
const CHAT_PAGE_SIZE = 20;
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

  /**
   * 退货提醒轮询（2026-11-02）。信封 bug 修好后实测 `/v2/campaigns/{id}/returns`
   * 返回 `result.returns[]`（YX-001 一页 20 条），所以打开该能力。
   */
  readonly returnAlertsEnabled = true;

  /**
   * READY_TO_SHIP 后平台即生成面单（不依赖运单号先回传），所以组包成功就能
   * 预取（2026-10-22）。批量面单没有同步接口（只有异步报表），故不声明
   * `labelBatchLimit`，调用方仍逐单取。
   */
  readonly labelReadyAfterPrepare = true;

  constructor(
    private readonly client: YandexClient,
    private readonly shipmentService: YandexShipmentService,
  ) {}

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

  /**
   * 买家会话摘要（2026-11-02）：只取 type=CHAT 的会话；`unreadOnly` 时按
   * `WAITING_FOR_PARTNER`（等我们回复）过滤——Yandex 没有未读数字段。
   */
  async fetchChats(
    context: StoreContext,
    options?: { unreadOnly?: boolean },
  ): Promise<readonly PlatformChatSummaryRaw[]> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    const out: PlatformChatSummaryRaw[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const response = await this.client.businessChats(auth, context.storeId, {
        businessId: identity.businessId,
        limit: CHAT_PAGE_SIZE,
        ...(pageToken === undefined ? {} : { pageToken }),
        body: {
          types: ['CHAT'],
          statuses: options?.unreadOnly === true ? ['WAITING_FOR_PARTNER'] : undefined,
        },
      });
      const chats = response.result?.chats ?? [];
      out.push(...mapChatSummaries(chats));
      const next = readStringOrNull(response.result?.paging?.nextPageToken);
      if (next === null) {
        break;
      }
      pageToken = next;
    }
    return out;
  }

  /** 会话消息（2026-11-02）：给出 `fromMessageId` 时只取之后的增量。 */
  async fetchChatMessages(
    context: StoreContext,
    input: { chatId: string; fromMessageId?: string; limit?: number },
  ): Promise<readonly PlatformChatMessageRaw[]> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    const response = await this.client.chatHistory(auth, context.storeId, {
      businessId: identity.businessId,
      chatId: input.chatId,
      limit: input.limit ?? 50,
      ...(input.fromMessageId === undefined ? {} : { messageIdFrom: input.fromMessageId }),
    });
    const messages = response.result?.messages ?? [];
    const out: PlatformChatMessageRaw[] = [];
    for (const item of messages) {
      try {
        out.push(mapChatMessage(input.chatId, item));
      } catch {
        // 单条畸形不拖垮整段会话（AGENTS §49）。
      }
    }
    return out;
  }

  /**
   * 商品评价（2026-11-02）：`dateTimeFrom` 为增量水位，`ratingValues: ['1','2','3']`
   * 只拉差评（平台侧过滤，省请求）。分页用 `page_token`。
   */
  async fetchReviews(
    context: StoreContext,
    input: { publishedFrom: Date; limit?: number; lastId?: string },
  ): Promise<PaginatedResult<PlatformReviewRaw>> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    const response = await this.client.goodsFeedbacks(auth, context.storeId, {
      businessId: identity.businessId,
      limit: input.limit ?? 50,
      ...(input.lastId === undefined ? {} : { pageToken: input.lastId }),
      body: {
        dateTimeFrom: input.publishedFrom.toISOString(),
        dateTimeTo: new Date(Date.now() + 60_000).toISOString(),
        // 不在平台侧按星级过滤：4-5 星也要落库（只提醒 1-3 星由业务层判断），
        // 否则事后想统计评分分布就没有数据。
      },
    });
    const rows = response.result?.feedbacks ?? [];
    const items: PlatformReviewRaw[] = [];
    for (const row of rows) {
      const mapped = mapGoodsFeedback(row);
      if (mapped !== null) {
        items.push(mapped);
      }
    }
    const next = readStringOrNull(response.result?.paging?.nextPageToken);
    return {
      items,
      nextCursor: next === null ? null : { pageToken: next },
      hasMore: next !== null,
    };
  }

  /**
   * 买家提问（2026-11-02，v1 goods-questions）：`dateFrom/dateTo` 只接受日期且
   * 窗口 ≤1 个月，所以按 30 天切片由调用方（采集器）负责；这里只取一页。
   */
  async fetchBuyerQuestions(
    context: StoreContext,
    input: { createdFrom: Date; limit?: number; cursor?: unknown },
  ): Promise<PaginatedResult<PlatformBuyerQuestionRaw>> {
    const auth = parseYxAuth(context.credential, context.storeId);
    const identity = await this.resolveIdentity(auth, context.storeId, context.credential);
    const pageToken =
      typeof input.cursor === 'object' && input.cursor !== null
        ? readStringOrNull((input.cursor as { pageToken?: unknown }).pageToken ?? null)
        : null;
    const response = await this.client.goodsQuestions(auth, context.storeId, {
      businessId: identity.businessId,
      limit: input.limit ?? 50,
      ...(pageToken === null ? {} : { pageToken }),
      body: {
        dateFrom: toDateOnly(input.createdFrom),
        dateTo: toDateOnly(new Date()),
      },
    });
    const rows = response.result?.questions ?? [];
    const items: PlatformBuyerQuestionRaw[] = [];
    for (const row of rows) {
      const mapped = mapGoodsQuestion(row);
      if (mapped !== null) {
        items.push(mapped);
      }
    }
    const next = readStringOrNull(response.result?.paging?.nextPageToken);
    return {
      items,
      nextCursor: next === null ? null : { pageToken: next },
      hasMore: next !== null,
    };
  }

  /**
   * WRITE: the one seller transition on the Yandex order lifecycle -
   * `PROCESSING/STARTED -> PROCESSING/READY_TO_SHIP` (组包/可发货). No-op
   * (read-only) when the order already passed that step. Never exercised
   * against a live account by tests (AGENTS.md §92).
   */
  async prepareShipment(
    context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<PlatformShipmentPreparation> {
    const identity = await this.resolveIdentityForContext(context);
    return this.shipmentService.prepareShipment(
      { storeId: context.storeId, credential: context.credential },
      order,
      identity,
    );
  }

  /** Label PDF (面单) for an order; null while Yandex has not generated it. */
  async fetchShippingLabel(
    context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null> {
    const identity = await this.resolveIdentityForContext(context);
    return this.shipmentService.fetchShippingLabel(
      { storeId: context.storeId, credential: context.credential },
      order,
      identity,
    );
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
    // 2026-11-02 修复：官方信封是 `{status, result:{returns, paging}}`，此前读
    // 顶层 `returns` 导致每次同步都报 "returns array missing"（Yandex 退货
    // 提醒因此一直空跑）。顶层字段作为兼容分支保留。
    const payload = response.result ?? response;
    if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.returns)) {
      throw malformedReturnsResponse(context.storeId);
    }
    const rows: ReadonlyArray<YxReturnItem> = payload.returns;
    const items = rows.map(mapReturnToReturn);
    const nextToken = readStringOrNull(payload.paging?.nextPageToken);
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
        // Ids are not secrets - listing them makes misconfiguration
        // self-diagnosable (e.g. the cabinet UI's "partnerId" is a DIFFERENT
        // numbering that never appears in the API response, T0 2026-09-18).
        const available = campaigns.map((campaign) => String(campaign.id ?? '?')).join(', ');
        throw new StoreCredentialMalformedError(
          storeId,
          'YANDEX',
          `credential campaignId ${explicit} 不在该 Api-Key 可访问的 campaign 列表中（可用 id: ${available}）——注意要用 API 的 campaign id，不是卖家后台通知页显示的 partnerId`,
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
  // T0 校准（2026-09-18 live）：businessId 藏在嵌套的 business.id 里；平铺
  // businessId 仅作老形状兼容回退。
  const businessId = campaign.business?.id ?? campaign.businessId;
  if (
    (typeof campaignId !== 'string' && typeof campaignId !== 'number') ||
    (typeof businessId !== 'string' && typeof businessId !== 'number')
  ) {
    throw new StoreCredentialMalformedError(
      storeId,
      'YANDEX',
      'campaign 记录缺少 id / business.id（响应结构不符）',
    );
  }
  return { businessId: String(businessId), campaignId: String(campaignId) };
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

/** `YYYY-MM-DD`（Yandex 提问接口只接受日期，不带时间）。 */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
