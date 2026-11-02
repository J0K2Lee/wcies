import { Injectable } from '@nestjs/common';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformChatMessageRaw,
  PlatformChatSummaryRaw,
  PlatformCredentialContext,
  PlatformLabelFile,
  PlatformListingRaw,
  PlatformOrderLabelFile,
  PlatformOrderRaw,
  PlatformReturnRaw,
  PlatformReviewRaw,
  PlatformShipmentPreparation,
  PlatformWebhookEvent,
  StoreContext,
} from '@wcies/platform-contracts';
import { OzonClient, OzonAuth } from './ozon.client';
import { OzonShipmentService } from './ozon-shipment.service';
import { parseOzonAuth } from './ozon-auth';
import {
  mapChatMessage,
  mapChatSummaries,
  mapPostingToOrder,
  mapProductToListing,
  mapRfbsReturn,
  mapReview,
  mapWebhookPayload,
} from './ozon.mapper';
import { mapProductImages } from './ozon-product-image.mapper';
import {
  OzonProductAttributesResponse,
  OzonProductInfoItem,
  OzonProductInfoListResponse,
  OzonProductListItem,
  OzonRfbsReturn,
} from './types/api.types';
import { PlatformApiError } from '../platform-error';
import {
  INITIAL_ORDER_WINDOW_DAYS,
  ORDER_WINDOW_OVERLAP_MS,
  isOzonListingCursor,
  isOzonOrderResumeCursor,
  isOzonOrderWindowCursor,
  isOzonPostingNumbersCursor,
  isOzonReturnCursor,
  OzonListingCursor,
  OzonOrderWindowCursor,
} from './types/cursors';

/**
 * Page sizes.
 * - /v3/product/list: limit ≤ 1000.
 * - /v4/posting/fbs/list: limit **≤ 100**（实测 2026-10-20：200 会被
 *   `PLATFORM_API_ERROR: invalid PostingFbsListRequest.Limit: value must be
 *   inside range (0, 100]` 拒绝；v3 曾允许更大值）。
 */
const LISTING_PAGE_SIZE = 200;
const ORDER_PAGE_SIZE = 100;
/** Page size for /v2/returns/rfbs/list (dual-axis T5). */
const RETURN_PAGE_SIZE = 200;
/** /v3/chat/list 的每页会话数（平台上限 100，取 50 够用）。 */
const CHAT_LIST_LIMIT = 50;
/** /v2/review/list 每页条数（平台允许 20–100）。 */
const REVIEW_PAGE_SIZE = 50;
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

  /** 退货列表实测可用（2026-11-02）→ 参与退货提醒轮询。 */
  readonly returnAlertsEnabled = true;

  constructor(
    private readonly client: OzonClient,
    private readonly shipmentService: OzonShipmentService,
  ) {}

  async validateCredential(context: PlatformCredentialContext): Promise<void> {
    // Safe read-only validation (task §32): one minimal product list call.
    await this.client.pingCredential(
      parseAuth(context.credential, context.storeId),
      context.storeId,
    );
  }

  async fetchProductImages(
    context: StoreContext,
    platformSkuIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>> {
    const ids = [...new Set(platformSkuIds)];
    const result = new Map<string, string | null>(ids.map((id) => [id, null]));
    if (ids.length === 0) return result;
    // Avoid rounding int64 identifiers: unsupported unsafe numbers stay absent.
    const valid = ids.filter((id) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)));
    const auth = parseAuth(context.credential, context.storeId);
    for (let start = 0; start < valid.length; start += PRODUCT_INFO_BATCH) {
      const batch = valid.slice(start, start + PRODUCT_INFO_BATCH);
      const response = await this.client.productInfoList(
        auth,
        context.storeId,
        [],
        batch.map(Number),
      );
      const images = mapProductImages(response, context.storeId);
      for (const id of batch) result.set(id, images.get(id) ?? null);
    }
    return result;
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

  /**
   * 定向读取单个变体（2026-10-20，订单行按需补链接）：订单行已带平台标识，
   * 只补「本地镜像缺这一条」，不做全量遍历。
   *
   * /v3/product/info/list 支持 offer_id 与 sku 两种入参（图片富化自
   * 2026-09-17 起在生产用 sku 入参，已验证）。优先用不可变的 sku；没有 sku
   * 时才退回 offer_id。一次点击最多一次平台调用。
   */
  async fetchListingVariant(
    context: StoreContext,
    identifiers: {
      platformSkuId?: string | null;
      offerId?: string | null;
      platformProductId?: string | null;
    },
  ): Promise<PlatformListingRaw | null> {
    const auth = parseAuth(context.credential, context.storeId);
    const skuRaw = identifiers.platformSkuId?.trim() ?? '';
    const sku =
      /^[1-9]\d*$/.test(skuRaw) && Number.isSafeInteger(Number(skuRaw)) ? Number(skuRaw) : null;
    const offerRaw = identifiers.offerId?.trim() ?? '';

    let response: OzonProductInfoListResponse;
    if (sku !== null) {
      response = await this.client.productInfoList(auth, context.storeId, [], [sku]);
    } else if (offerRaw !== '') {
      response = await this.client.productInfoList(auth, context.storeId, [offerRaw]);
    } else {
      return null;
    }
    if (
      !Array.isArray(response?.items) ||
      response.items.some(
        (info: unknown) => typeof (info as OzonProductInfoItem | null)?.id !== 'number',
      )
    ) {
      throw malformedInfoResponse(context.storeId);
    }
    // Array.isArray 把 readonly 数组收窄成 any[]，与 fetchProductInfos 一样
    // 用显式谓词过滤回真实类型（AGENTS §63：不让 any 往下游流）。
    const infos = response.items.filter(
      (info: unknown): info is OzonProductInfoItem =>
        typeof (info as OzonProductInfoItem | null)?.id === 'number',
    );
    const info = infos[0];
    if (info === undefined) {
      return null;
    }
    const offerId =
      typeof info.offer_id === 'string' && info.offer_id !== '' ? info.offer_id : offerRaw;
    if (offerId === '') {
      // 没有 offer_id 就无法建立可对账的变体行（映射台账按它对齐平台）。
      return null;
    }
    return mapProductToListing({ product_id: info.id, offer_id: offerId }, info);
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
      limit: ORDER_PAGE_SIZE,
      cursor: windowCursor.cursor,
    });
    // v4 响应在顶层（无 result 包裹）。
    if (typeof response?.has_next !== 'boolean' || !Array.isArray(response?.postings)) {
      throw malformedPostingListResponse(context.storeId);
    }
    const items = response.postings.map(mapPostingToOrder);
    const hasMore = response.has_next;
    const nextCursor: unknown = hasMore
      ? // 游标分页（2026-10-20）：把 v4 返回的不透明游标原样带回。空游标却
        // 声称还有下一页 = 畸形响应，必须报错而不是原地重读（防死循环）。
        typeof response.cursor === 'string' && response.cursor !== ''
        ? ({
            kind: 'OZON_ORDER_WINDOW',
            since: windowCursor.since,
            to: windowCursor.to,
            cursor: response.cursor,
          } as const)
        : (() => {
            throw malformedPostingListCursor(context.storeId);
          })()
      : // Window complete: the resume marker opens the NEXT window at the
        // next run, overlapped by 60s (idempotent ingest absorbs re-reads).
        ({ kind: 'OZON_ORDER_RESUME', windowEnd: windowCursor.to } as const);
    return { items, nextCursor, hasMore };
  }

  async processWebhook(_context: StoreContext, payload: unknown): Promise<PlatformWebhookEvent[]> {
    return mapWebhookPayload(payload);
  }

  /**
   * Sprint 8.5 T5: packed product attributes (dimensions/weight/category).
   * OZON-specific read outside the generic adapter contract - used by the
   * enrichment sync; response shape per the 2026-09-14 smoke (§ozon.md 8).
   */
  async fetchProductAttributes(
    context: StoreContext,
    productIds: readonly string[],
  ): Promise<OzonProductAttributesResponse> {
    return this.client.productAttributes(
      parseAuth(context.credential, context.storeId),
      context.storeId,
      productIds,
    );
  }

  async fetchOrdersByPlatformIds(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderRaw[]> {
    const auth = parseAuth(context.credential, context.storeId);
    const page = await this.fetchPostingsByNumber(auth, context.storeId, platformOrderIds);
    return page.items;
  }

  /**
   * rFBS return records, one page (dual-axis T5). Cursor: { lastReturnId } -
   * the last return_id of the previous page. A full page means there may be
   * more; no has_more flag exists on this endpoint (spec, 2026-09-15).
   */
  async fetchReturns(
    context: StoreContext,
    cursor?: unknown,
    options?: { createdFrom?: Date },
  ): Promise<PaginatedResult<PlatformReturnRaw>> {
    const auth = parseAuth(context.credential, context.storeId);
    const lastReturnId = isOzonReturnCursor(cursor) ? cursor.lastReturnId : 0;
    const response = await this.client.rfbsReturnsList(auth, context.storeId, {
      lastId: lastReturnId,
      limit: RETURN_PAGE_SIZE,
      ...(options?.createdFrom === undefined
        ? {}
        : { createdFrom: options.createdFrom.toISOString() }),
    });
    const rows: ReadonlyArray<OzonRfbsReturn> = Array.isArray(response?.returns)
      ? response.returns
      : [];
    const items = rows.map(mapRfbsReturn);
    const hasMore = rows.length >= RETURN_PAGE_SIZE;
    const last = rows[rows.length - 1];
    return {
      items,
      nextCursor: hasMore && last !== undefined ? { lastReturnId: last.return_id } : null,
      hasMore,
    };
  }

  // -----------------------------------------------------------------------

  /**
   * 买家会话摘要（2026-11-02）。只读；`unreadOnly` 把范围压到还有未读的会话。
   * chat_type 原词原样带回，过滤（只看 BUYER_SELLER）由调用方决定。
   */
  async fetchChats(
    context: StoreContext,
    options?: { unreadOnly?: boolean },
  ): Promise<readonly PlatformChatSummaryRaw[]> {
    const auth = parseAuth(context.credential, context.storeId);
    const response = await this.client.chatList(auth, context.storeId, {
      limit: CHAT_LIST_LIMIT,
      ...(options?.unreadOnly === true ? { unreadOnly: true } : {}),
    });
    return mapChatSummaries(response.chats ?? []);
  }

  /**
   * 会话消息（2026-11-02）。给出 `fromMessageId` 时取该消息之后的增量，
   * 否则取最近 `limit` 条。平台按 message_id 升序返回增量。
   */
  async fetchChatMessages(
    context: StoreContext,
    input: { chatId: string; fromMessageId?: string; limit?: number },
  ): Promise<readonly PlatformChatMessageRaw[]> {
    const auth = parseAuth(context.credential, context.storeId);
    const response = await this.client.chatHistory(auth, context.storeId, input);
    const messages = response.messages ?? [];
    const out: PlatformChatMessageRaw[] = [];
    for (const item of messages) {
      try {
        out.push(mapChatMessage(input.chatId, item));
      } catch {
        // 单条畸形消息不拖垮整段会话（AGENTS.md §49）。
      }
    }
    return out;
  }

  /**
   * 商品评价（2026-11-02）。平台要求卖家付费订阅：无权限时客户端抛
   * PLATFORM_AUTH_ERROR（403 PermissionDenied），调用方据此停止轮询。
   */
  async fetchReviews(
    context: StoreContext,
    input: { publishedFrom: Date; limit?: number; lastId?: string },
  ): Promise<PaginatedResult<PlatformReviewRaw>> {
    const auth = parseAuth(context.credential, context.storeId);
    const limit = input.limit ?? REVIEW_PAGE_SIZE;
    const response = await this.client.reviewListV2(auth, context.storeId, {
      limit,
      sort_dir: 'ASC',
      ...(input.lastId === undefined ? {} : { last_id: input.lastId }),
      filters: { published_from: input.publishedFrom.toISOString() },
    });
    const rows = response.reviews ?? [];
    const items: PlatformReviewRaw[] = [];
    for (const row of rows) {
      const mapped = mapReview(row);
      if (mapped !== null) {
        items.push(mapped);
      }
    }
    const last = rows[rows.length - 1];
    const hasMore = response.has_next === true;
    return {
      items,
      nextCursor: hasMore && last?.id != null ? { lastReviewId: String(last.id) } : null,
      hasMore,
    };
  }

  /**
   * WRITE: assemble the order on OZON (组包, awaiting_packaging ->
   * awaiting_deliver) so the platform assigns a waybill. This is the ONE
   * platform write of the order fulfillment flow; it is never exercised by
   * tests against a live account (AGENTS.md §92). No-op (read-only) when the
   * platform already accepted the order.
   */
  async prepareShipment(
    context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<PlatformShipmentPreparation> {
    return this.shipmentService.prepareShipment(
      { storeId: context.storeId, credential: context.credential },
      order,
    );
  }

  /**
   * Shipping label PDF (面单) for an order, archived and printed by the order
   * page. Null while OZON has not generated it yet.
   */
  async fetchShippingLabel(
    context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null> {
    return this.shipmentService.fetchShippingLabel(
      { storeId: context.storeId, credential: context.credential },
      order,
    );
  }

  /**
   * Batched label read (用户指示 2026-10-21): one platform call for a chunk of
   * postings. Caller chunks to the documented 20-posting limit.
   */
  async fetchShippingLabels(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderLabelFile[]> {
    return this.shipmentService.fetchShippingLabels(
      { storeId: context.storeId, credential: context.credential },
      platformOrderIds,
    );
  }

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
  return parseOzonAuth(credential, storeId);
}

/**
 * Re-export for the OZON-specific services that historically imported the
 * credential parse from this file. The implementation lives in ozon-auth.ts
 * so those services do not import the adapter (which depends on
 * OzonShipmentService - an adapter<->service cycle otherwise).
 */
export { parseOzonAuth };

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
  };
}

function malformedListResponse(storeId: string): Error {
  return new OzonBadShape(storeId, '/v3/product/list', 'result.last_id / result.items missing');
}
function malformedInfoResponse(storeId: string): Error {
  return new OzonBadShape(storeId, '/v3/product/info/list', 'result.items missing');
}
function malformedPostingListResponse(storeId: string): Error {
  return new OzonBadShape(storeId, '/v4/posting/fbs/list', 'has_next / postings missing');
}
function malformedPostingListCursor(storeId: string): Error {
  return new OzonBadShape(storeId, '/v4/posting/fbs/list', 'has_next=true but cursor is empty');
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
