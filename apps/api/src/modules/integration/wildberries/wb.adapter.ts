import { Injectable } from '@nestjs/common';
import {
  PaginatedResult,
  PlatformAdapter,
  PlatformBuyerQuestionRaw,
  PlatformReviewRaw,
  PlatformCredentialContext,
  PlatformLabelFile,
  PlatformListingRaw,
  PlatformOrderLabelFile,
  PlatformOrderRaw,
  PlatformShipmentPreparation,
  PlatformWebhookEvent,
  StoreContext,
} from '@wcies/platform-contracts';
import { WbClient, WbAuth } from './wb.client';
import { WB_STICKER_BATCH_LIMIT, WbShipmentService } from './wb-shipment.service';
import {
  mapCardToListing,
  wbCardMatches,
  mapWbFeedback,
  mapWbQuestion,
  mapFbsOrderToOrder,
  mapStatsRowToOrder,
  mapWebhookEnvelope,
} from './wb.mapper';
import { StoreCredentialMalformedError } from '../integration.errors';
import { WbCard, WbStatsOrderRow, WbV3Order, WbV3OrdersResponse } from './types/api.types';
import { PlatformApiError } from '../platform-error';
import {
  INITIAL_ORDER_WINDOW_DAYS,
  ORDER_WINDOW_OVERLAP_MS,
  isWbListingCursor,
  isWbOrderResumeCursor,
  isWbOrderRunCursor,
  toMskRfc3339,
  WbListingCursor,
  WbOrderRunCursor,
} from './types/cursors';

/** Page sizes: cards/list <= 100/页 (docs §4); v3 orders <= 1000 (docs §3a). */
const LISTING_PAGE_SIZE = 100;
const ORDER_PAGE_SIZE = 1000;
/** 评价单次轮询每类（已回复/未回复）最多翻几页，防止异常账号拖垮 tick。 */
const WB_FEEDBACK_MAX_PAGES = 3;

/**
 * Wildberries implementation of the platform adapter contract (2026-09-18).
 *
 * Combines WbClient (transport) + WbMapper (normalization) and owns ONLY
 * cursor interpretation. It never touches WCIES repositories/services.
 *
 * Capability scope (docs/integrations/wildberries.md, plan §P1-P4):
 * - validateCredential: common-domain seller-info read;
 * - fetchListings: content cards/list cursor walk;
 * - fetchOrders: DUAL-source - FBS/DBS tasks (marketplace v3 `next` cursor in
 *   a rolling creation window) THEN DBW rows (statistics incremental by
 *   lastChangeDate, ONE call per run - the endpoint allows 1 req/min);
 * - processWebhook (2026-09-18, docs verified): parses event deliveries from
 *   webhooks-api (content events today; dedup rides the platform's
 *   idempotencyKey). Authenticity = Authorization-header secret check in the
 *   SYNC ingest service; subscription managed via WbWebhookService;
 * - NOT implemented on purpose (spec unverified, T0 first):
 *   fetchOrdersByPlatformIds (/api/v3/orders/status body unverified),
 *   fetchReturns (returns-domain spec unverified), fetchProductImages (cards
 *   carry photos; no barcode-keyed lookup endpoint).
 */
@Injectable()
export class WbAdapter implements PlatformAdapter {
  readonly platformCode = 'WB' as const;

  /**
   * 订单行定向读卡片（2026-11-02）。`fetchListingVariant` 此前只有 OZON 实现，
   * 导致 WB 订单行在本地链接缺失时「打开商品链接 / 映射」两条路都走不通
   * （实证：WS-001 的 GRAVASTAR-MH1-PRO 卡片在平台存在，但 listing sync 还没
   * walk 到）。
   *
   * 做法：content `cards/list` 的 `filter.textSearch` 支持按卖家货号/nmid 检索
   * （2026-11-02 实测返回目标卡片），拿到候选后**再精确匹配**（vendorCode /
   * nmID / 条码），检索是模糊的，不能直接当命中（AGENTS §88）。
   */
  async fetchListingVariant(
    _context: StoreContext,
    identifiers: {
      platformSkuId?: string | null;
      offerId?: string | null;
      platformProductId?: string | null;
    },
  ): Promise<PlatformListingRaw | null> {
    const storeId = _context.storeId;
    const auth = parseWbAuth(_context.credential, storeId);
    const term =
      firstNonEmpty([
        identifiers.offerId,
        identifiers.platformSkuId,
        identifiers.platformProductId,
      ]) ?? null;
    if (term === null) {
      return null;
    }
    const response = await this.client.cardsList(auth, storeId, {
      settings: { cursor: { limit: LISTING_PAGE_SIZE }, filter: { textSearch: term } },
    });
    const cards: ReadonlyArray<WbCard> = Array.isArray(response.cards) ? response.cards : [];
    const match = cards.find((card) => wbCardMatches(card, identifiers));
    return match === undefined ? null : mapCardToListing(match);
  }

  /**
   * 商品评价（2026-11-02 实测）：`dateFrom/dateTo` 是 Unix 秒，`take/skip` 分页。
   * 增量水位由调用方按发布时间维护；这里按 `order=dateAsc` 拉窗口内的数据。
   */
  async fetchReviews(
    context: StoreContext,
    input: { publishedFrom: Date; limit?: number; lastId?: string },
  ): Promise<PaginatedResult<PlatformReviewRaw>> {
    const auth = parseWbAuth(context.credential, context.storeId);
    const take = input.limit ?? 100;
    const dateFrom = Math.floor(input.publishedFrom.getTime() / 1000);
    const dateTo = Math.floor(Date.now() / 1000);
    // `isAnswered` 是必填参数（省略会 400），而它只能二选一：未回复 / 已回复。
    // 两遍都拉——只拉未回复会漏掉「客服已回复过的差评」，而提醒恰恰要覆盖它们。
    // 量级很小（每家店每 30 分钟最多几百条），值得多一次请求。
    const items: PlatformReviewRaw[] = [];
    for (const isAnswered of [false, true]) {
      for (let page = 0; page < WB_FEEDBACK_MAX_PAGES; page += 1) {
        const response = await this.client.feedbacks(auth, context.storeId, {
          take,
          skip: page * take,
          order: 'dateAsc',
          dateFrom,
          dateTo,
          isAnswered,
        });
        const rows = response.data?.feedbacks ?? [];
        for (const row of rows) {
          const mapped = mapWbFeedback(row);
          if (mapped !== null) {
            items.push(mapped);
          }
        }
        if (rows.length < take) {
          break;
        }
      }
    }
    return { items, nextCursor: null, hasMore: false };
  }

  /**
   * 买家提问（2026-11-02 实测）。WB 没有聊天 API——提问就是这边最主要的买家
   * 触达渠道，提醒按这份数据出。分页同样是 take/skip。
   */
  async fetchBuyerQuestions(
    context: StoreContext,
    input: { createdFrom: Date; limit?: number; cursor?: unknown },
  ): Promise<PaginatedResult<PlatformBuyerQuestionRaw>> {
    const auth = parseWbAuth(context.credential, context.storeId);
    const take = input.limit ?? 100;
    const skip =
      typeof input.cursor === 'object' &&
      input.cursor !== null &&
      typeof (input.cursor as { skip?: unknown }).skip === 'number'
        ? ((input.cursor as { skip: number }).skip ?? 0)
        : 0;
    const response = await this.client.questions(auth, context.storeId, {
      take,
      skip,
      order: 'dateAsc',
      dateFrom: Math.floor(input.createdFrom.getTime() / 1000),
      dateTo: Math.floor(Date.now() / 1000),
    });
    const rows = response.data?.questions ?? [];
    const items: PlatformBuyerQuestionRaw[] = [];
    for (const row of rows) {
      const mapped = mapWbQuestion(row);
      if (mapped !== null) {
        items.push(mapped);
      }
    }
    const hasMore = rows.length >= take;
    return {
      items,
      nextCursor: hasMore ? { skip: skip + take } : null,
      hasMore,
    };
  }

  /**
   * 入供应单（`confirm`）后贴纸立即可取，不依赖平台先分配运单号——预取门槛
   * 因此不由运单号决定（2026-10-22）。
   */
  readonly labelReadyAfterPrepare = true;

  /** 官方 spec：单次贴纸请求 ≤100 单。 */
  readonly labelBatchLimit = WB_STICKER_BATCH_LIMIT;

  constructor(
    private readonly client: WbClient,
    private readonly shipmentService: WbShipmentService,
  ) {}

  async validateCredential(context: PlatformCredentialContext): Promise<void> {
    await this.client.sellerInfo(parseWbAuth(context.credential, context.storeId), context.storeId);
  }

  async processWebhook(_context: StoreContext, payload: unknown): Promise<PlatformWebhookEvent[]> {
    return mapWebhookEnvelope(payload);
  }

  /**
   * WRITE: put the order into a dedicated supply (order -> `confirm`), the
   * only seller path there per the vendor spec. Does NOT call
   * `supplies/{id}/deliver` - the `complete` fact arrives when WB scans the
   * supply at handover (docs/integrations/wildberries.md §9.4). No-op
   * (read-only) when the order already sits in a supply.
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
   * 单张面单。跨境贴纸优先（PDF + 运单号），非跨境降级到通用 PNG 贴纸
   * （已在 shipment service 内转成 PDF）。
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

  /** 批量贴纸：单次 ≤100 单，跨境优先、通用兜底（2026-10-22）。 */
  async fetchShippingLabels(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderLabelFile[]> {
    return this.shipmentService.fetchShippingLabels(
      { storeId: context.storeId, credential: context.credential },
      platformOrderIds,
    );
  }

  async fetchListings(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformListingRaw>> {
    const auth = parseWbAuth(context.credential, context.storeId);
    const pageCursor = isWbListingCursor(cursor)
      ? cursor
      : ({ kind: 'WB_LISTING', updatedAt: null, nmId: null } as const);

    // T0 校准（2026-09-18 live）：首页不能带数字型 updatedAt（会 400），但
    // **limit 必须带**——`{settings:{}}` 时 WB 只回 10 条，而下面的
    // 「短页即结束」判定会把它当成最后一页，整个店铺只会同步到 10 张卡片
    // （2026-10-22 实测：WS-001 首页 10 条 / 真实 110 条）。
    const settings: { cursor: Record<string, unknown> } = {
      cursor: {
        ...(pageCursor.updatedAt !== null ? { updatedAt: pageCursor.updatedAt } : {}),
        ...(pageCursor.nmId !== null ? { nmID: pageCursor.nmId } : {}),
        limit: LISTING_PAGE_SIZE,
      },
    };

    const response = await this.client.cardsList(auth, context.storeId, { settings });
    // T0 校准：真实响应是顶层 {cards, cursor}——没有 {data} 信封。
    if (!Array.isArray(response.cards)) {
      throw malformedListResponse(context.storeId);
    }
    const cards: ReadonlyArray<WbCard> = response.cards;
    const items = cards.map(mapCardToListing);

    // Cursor round-trip: echo the response cursor. A short page ends the
    // walk; a full page whose cursor equals the one we sent means NO
    // progress - stop instead of looping forever.
    const echoUpdatedAt = readCursorUpdatedAt(response.cursor?.updatedAt);
    const echoNmId = typeof response.cursor?.nmID === 'number' ? response.cursor.nmID : null;
    const progressed = echoUpdatedAt !== pageCursor.updatedAt || echoNmId !== pageCursor.nmId;
    const hasMore = cards.length >= LISTING_PAGE_SIZE && progressed;
    const echo: WbListingCursor | null = hasMore
      ? { kind: 'WB_LISTING', updatedAt: echoUpdatedAt, nmId: echoNmId }
      : null;
    return { items, nextCursor: hasMore ? echo : null, hasMore };
  }

  async fetchOrders(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformOrderRaw>> {
    const auth = parseWbAuth(context.credential, context.storeId);
    const run = normalizeRunCursor(cursor);
    if (run.phase === 'FBS') {
      return this.fetchFbsPage(auth, context.storeId, run);
    }
    return this.fetchStatsPage(auth, context.storeId, run);
  }

  // -----------------------------------------------------------------------

  private async fetchFbsPage(
    auth: WbAuth,
    storeId: string,
    run: WbOrderRunCursor,
  ): Promise<PaginatedResult<PlatformOrderRaw>> {
    const response: WbV3OrdersResponse = await this.client.fbsOrders(auth, storeId, {
      dateFrom: epochSeconds(run.windowFrom),
      dateTo: epochSeconds(run.windowTo),
      next: run.next,
      limit: ORDER_PAGE_SIZE,
    });
    if (typeof response !== 'object' || response === null || !Array.isArray(response.orders)) {
      throw malformedOrdersResponse(storeId);
    }
    const orders: ReadonlyArray<WbV3Order> = response.orders;
    const items = orders.map(mapFbsOrderToOrder);
    const next = typeof response.next === 'number' ? response.next : 0;

    // Exhaustion signal (next == 0 / absent) is T0-calibration material -
    // treat a positive cursor on a non-empty page as "more pages" (docs §3a).
    // A repeated cursor means no progress - stop instead of looping forever.
    if (next > 0 && orders.length > 0 && next !== run.next) {
      return {
        items,
        nextCursor: { ...run, next },
        hasMore: true,
      };
    }
    // FBS phase complete: hand over to the statistics phase. This transition
    // costs no API call - the sync loop re-enters fetchOrders with the new
    // cursor and only then hits the statistics endpoint.
    return { items, nextCursor: { ...run, phase: 'STATS' }, hasMore: true };
  }

  private async fetchStatsPage(
    auth: WbAuth,
    storeId: string,
    run: WbOrderRunCursor,
  ): Promise<PaginatedResult<PlatformOrderRaw>> {
    const rows: readonly WbStatsOrderRow[] = await this.client.supplierOrders(auth, storeId, {
      dateFrom: run.statsFrom,
      flag: 0,
    });
    const items = rows.map(mapStatsRowToOrder);

    // ONE statistics call per run (1 req/min budget, docs §3b): the cursor
    // advances to the last row's lastChangeDate and the NEXT scheduled run
    // continues from there. Empty rows keep the previous position.
    const lastRow = rows[rows.length - 1];
    const statsFrom =
      typeof lastRow?.lastChangeDate === 'string' && lastRow.lastChangeDate !== ''
        ? lastRow.lastChangeDate
        : run.statsFrom;
    return {
      items,
      nextCursor: { kind: 'WB_ORDER_RESUME', windowEnd: run.windowTo, statsFrom },
      hasMore: false,
    };
  }
}

// ---------------------------------------------------------------------------

/** Response cursor updatedAt is an RFC3339 string; tolerate numbers verbatim. */
function readCursorUpdatedAt(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseWbAuth(credential: Readonly<Record<string, unknown>>, storeId: string): WbAuth {
  const apiKey = credential['apiKey'];
  if (typeof apiKey !== 'string' || apiKey === '') {
    throw new StoreCredentialMalformedError(storeId, 'WB', 'expected { apiKey }');
  }
  return { apiKey };
}

/** Shared credential parse for WB-specific services outside the adapter. */
export function parseWbAuthCredential(
  credential: Readonly<Record<string, unknown>>,
  storeId: string,
): WbAuth {
  return parseWbAuth(credential, storeId);
}

/**
 * Effective run cursor:
 * - explicit WB_ORDER_RUN (paged walk in progress);
 * - WB_ORDER_RESUME (previous run stored): new FBS window from the last
 *   window end (minus overlap) + statistics continues from its position;
 * - no cursor: initial catch-up of INITIAL_ORDER_WINDOW_DAYS days.
 */
function normalizeRunCursor(cursor: unknown): WbOrderRunCursor {
  if (isWbOrderRunCursor(cursor)) {
    return cursor;
  }
  const now = new Date();
  if (isWbOrderResumeCursor(cursor)) {
    const from = new Date(new Date(cursor.windowEnd).getTime() - ORDER_WINDOW_OVERLAP_MS);
    return {
      kind: 'WB_ORDER_RUN',
      phase: 'FBS',
      windowFrom: (from.getTime() < now.getTime()
        ? from
        : new Date(now.getTime() - ORDER_WINDOW_OVERLAP_MS)
      ).toISOString(),
      windowTo: now.toISOString(),
      next: 0,
      statsFrom: isMskRfc3339(cursor.statsFrom) ? cursor.statsFrom : toMskRfc3339(now),
    };
  }
  const since = new Date(now.getTime() - INITIAL_ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return {
    kind: 'WB_ORDER_RUN',
    phase: 'FBS',
    windowFrom: since.toISOString(),
    windowTo: now.toISOString(),
    next: 0,
    statsFrom: toMskRfc3339(since),
  };
}

/** True when the stored statistics cursor is already a Moscow RFC3339 stamp. */
function isMskRfc3339(value: string): boolean {
  return /\+03:00$/.test(value) || /(?:Z|z)$/.test(value);
}

function epochSeconds(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new PlatformApiError({
      code: 'PLATFORM_BAD_RESPONSE',
      httpStatus: null,
      requestId: null,
      endpoint: 'wb.cursor',
      storeId: 'unknown',
      message: `Stored WB cursor carries an unparseable ISO date: ${iso}`,
      details: { reason: 'cursor-window-unparseable' },
    });
  }
  return Math.floor(ms / 1000);
}

function malformedListResponse(storeId: string): Error {
  return new WbBadShape(storeId, 'content/cards/list', 'cards array missing');
}
function malformedOrdersResponse(storeId: string): Error {
  return new WbBadShape(storeId, 'marketplace/orders', 'orders array missing');
}

class WbBadShape extends PlatformApiError {
  constructor(storeId: string, endpoint: string, reason: string) {
    super({
      code: 'PLATFORM_BAD_RESPONSE',
      httpStatus: null,
      requestId: null,
      endpoint,
      storeId,
      message: `WB ${endpoint} response violates the verified schema: ${reason}`,
      details: { reason },
    });
  }
}

/** 第一个非空字符串（定向读取的检索词优先级：货号 > 条码 > 商品 id）。 */
function firstNonEmpty(values: ReadonlyArray<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return null;
}
