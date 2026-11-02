import {
  PlatformBuyerQuestionRaw,
  PlatformChatMessageRaw,
  PlatformChatSummaryRaw,
  PlatformListingRaw,
  PlatformListingSkuRaw,
  PlatformOrderItemRaw,
  PlatformOrderRaw,
  PlatformOrderStage,
  PlatformReturnRaw,
  PlatformReviewRaw,
  PlatformWebhookEvent,
  PlatformWebhookEventType,
} from '@wcies/platform-contracts';
import { DomainError } from '../../../common/errors/domain.error';
import {
  YxChatInfo,
  YxChatMessage,
  YxGoodsFeedback,
  YxGoodsQuestion,
  YxOfferMapping,
  YxOrder,
  YxOrderItem,
  YxReturnItem,
} from './types/api.types';

/**
 * Yandex Market DTO -> WCIES unified model mapper (2026-09-18).
 *
 * Pure functions only - no HTTP, no repositories. Every conversion either
 * produces a verified shape or throws PLATFORM_BAD_RESPONSE: never `as any`
 * through malformed data.
 *
 * Identifier rules (Decision 0016: order resolution uses platformSkuId +
 * sellerSku ONLY): business orders rows carry NO marketSku (docs §8.3), so
 * order lines resolve by sellerSku = offerId; the listing rows carry
 * platformSkuId = marketSku for the human mapping workflow.
 */

// ---------------------------------------------------------------------------
// Order status vocabulary (docs/integrations/yandex.md §3)
// ---------------------------------------------------------------------------

const YX_STATUS_CANCELLED = 'CANCELLED';

/**
 * `status` -> normalized logistics stage. The full status x substatus table
 * is T0-calibratable against real samples (docs §8.2); values not listed map
 * to null - guessing a stage would be a business-rule invention (AGENTS.md
 * §88). PENDING (delivery being rescheduled - pre-/post-ship ambiguous) and
 * UNKNOWN stay unclassified; PARTIALLY_RETURNED / RETURNED presuppose a
 * completed delivery, hence DELIVERED.
 */
const YX_STATUS_STAGE: Readonly<Record<string, PlatformOrderStage>> = {
  PLACING: 'AWAITING_SHIPMENT',
  RESERVED: 'AWAITING_SHIPMENT',
  UNPAID: 'AWAITING_SHIPMENT',
  PROCESSING: 'AWAITING_SHIPMENT',
  DELIVERY: 'IN_TRANSIT',
  PICKUP: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  PARTIALLY_RETURNED: 'DELIVERED',
  RETURNED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
};

/** substatus refinement for PROCESSING (docs §3): SHIPPED = goods left. */
const YX_SUBSTATUS_SHIPPED = 'SHIPPED';

export function yxStageOf(
  status: string | null,
  substatus: string | null,
): PlatformOrderStage | null {
  const base = YX_STATUS_STAGE[status ?? ''] ?? null;
  if (base === 'AWAITING_SHIPMENT' && substatus === YX_SUBSTATUS_SHIPPED) {
    return 'IN_TRANSIT';
  }
  return base;
}

// ---------------------------------------------------------------------------
// Fulfillment program (docs §3: programType is the fulfillment fact)
// ---------------------------------------------------------------------------

/**
 * programType -> WCIES short fulfillment code. FBY = platform-managed
 * (external fulfillment, isExternalFulfillmentMode('FBY') is true); FBS and
 * DBS are seller-fulfilled (YANDEX_FBS / SELF_MANAGED, plan §4.2). EXPRESS /
 * LAAS ownership is unverified - null, never guessed (T0).
 */
export function yxFulfillmentModeOf(programType: unknown): string | null {
  switch (programType) {
    case 'FBY':
      return 'FBY';
    case 'FBS':
    case 'DBS':
      return 'FBS';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Orders (business-level, docs §3)
// ---------------------------------------------------------------------------

export function mapOrderToOrder(order: YxOrder): PlatformOrderRaw {
  if (typeof order.orderId !== 'number' && typeof order.orderId !== 'string') {
    throw malformed('order', 'orderId missing');
  }
  if (typeof order.status !== 'string') {
    throw malformed('order', 'status missing');
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    throw malformed('order', 'items array missing/empty');
  }
  const orderedAt = parseRequiredDate(order.creationDate, 'order.creationDate');

  const substatus = readString(order.substatus);
  const stage = yxStageOf(order.status, substatus);

  const items = order.items.map((item: YxOrderItem, index: number) => {
    const offerId = readString(item.offerId);
    if (offerId === null) {
      throw malformed(`order.items[${index}]`, 'offerId missing');
    }
    const count = typeof item.count === 'number' ? item.count : Number(item.count);
    if (!Number.isFinite(count) || count <= 0) {
      throw malformed(`order.items[${index}]`, `invalid count: ${String(item.count)}`);
    }
    return {
      // No marketSku on business-order rows (docs §8.3) - resolution rides on
      // sellerSku. 单价按官方口径（2026-10-24）：商品金额 = payment + cashback，
      // subsidy 是卖家奖励、不属于商品金额；缺字段时保持 null，不猜。
      platformProductId: null,
      platformSkuId: null,
      offerId,
      sellerSku: offerId,
      quantity: String(count),
      unitPrice: yxGoodsAmount(item.prices),
      rawData: { ...item },
    } satisfies PlatformOrderItemRaw;
  });

  return {
    platformOrderId: String(order.orderId),
    platformStatus: order.status,
    platformCancelled: order.status === YX_STATUS_CANCELLED,
    platformStage: stage,
    platformStageChangedAt: parseTolerantDate(order.updateDate),
    fulfillmentMode: yxFulfillmentModeOf(order.programType),
    orderedAt,
    shipmentDeadline: parseTolerantDate(order.delivery?.shipment?.shipmentDate),
    // 平台运单号（2026-10-22）：business-orders 的 delivery.tracks[].trackCode。
    // 之前只有手工「获取运单号」会读它，轮询/webhook 从不刷新，运单号列长期为空。
    platformTrackingNo: readYxTrackCode(order),
    // 币种（2026-10-24）：订单级 prices 优先，退回第一条明细的币种。
    currency:
      yxCurrencyOf(order.prices) ??
      order.items
        .map((item) => yxCurrencyOf((item as { prices?: unknown }).prices))
        .find((code) => code !== null) ??
      null,
    items,
    rawData: { ...order },
  };
}

/**
 * 订单的运单号（2026-10-23 按真实面单校正）。
 *
 * Yandex 的 FBS **没有独立的承运商运单号**：官方 spec 把 `tracks` 标注为
 * 「Информация о трек-номере посылки **(DBS)**」，FBS 订单里永远为空——实测
 * 113 单全为 null。FBS 面单上印的只有两个号：
 *
 *   номер заказа      = 订单号（`orderId`）
 *   номер грузоместа  = 货位号（`boxesLayout[].barcode`，形如 `<orderId>-<箱号>`）
 *
 * 交接时承运商扫的是后者，运营也按它核对，所以 FBS 取货位号当运单号用，
 * 与面单完全一致（用户 2026-10-23 用真实面单确认）。多箱订单取第一箱。
 * DBS 的 `tracks[].trackCode` 优先，出现时以它为准。都没有则为 null。
 */
/**
 * 订单商品金额（官方口径，docs/yandex-partner-api-openapi.json）：
 *
 * > Стоимость товаров в заказе складывается из параметров `payment` и `cashback`.
 * > Общая сумма вознаграждений продавцу возвращается в параметре `subsidy`.
 *
 * 即：**商品金额 = payment + cashback**（`subsidy` 是给卖家的奖励，不是商品价）。
 * 实测对账：V9 TURBO 单 payment 711 + cashback 5661 = 6372 RUB，与同款在 WB 的
 * 6754 RUB 同量级。金额单位为店铺币种，不做换算。
 */
interface YxMoney {
  value?: unknown;
  currencyId?: unknown;
}

interface YxPrices {
  payment?: YxMoney;
  cashback?: YxMoney;
  subsidy?: YxMoney;
}

function readMoneyValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

/** 商品金额 = payment + cashback；payment 缺失时返回 null（不猜）。 */
function asPrices(value: unknown): YxPrices | null {
  return typeof value === 'object' && value !== null ? value : null;
}

export function yxGoodsAmount(value: unknown): string | null {
  const prices = asPrices(value);
  const payment = readMoneyValue(prices?.payment?.value);
  if (payment === null) {
    return null;
  }
  const cashback = readMoneyValue(prices?.cashback?.value) ?? 0;
  return (payment + cashback).toFixed(2);
}

/**
 * 币种：Yandex 用历史码 `RUR` 表示卢布，统一成 ISO 字母码 `RUB`；
 * 其它值原样大写（不猜成 CNY）。
 */
export function yxCurrencyOf(value: unknown): string | null {
  const raw = asPrices(value)?.payment?.currencyId;
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  const code = raw.trim().toUpperCase();
  return code === 'RUR' ? 'RUB' : code;
}

export function readYxTrackCode(order: {
  delivery?: { tracks?: readonly unknown[]; boxesLayout?: readonly unknown[] };
}): string | null {
  const tracks = order.delivery?.tracks;
  if (Array.isArray(tracks)) {
    for (const raw of tracks) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const code = readString((raw as Record<string, unknown>)['trackCode'])?.trim();
      if (code !== undefined && code !== '') {
        return code;
      }
    }
  }
  const boxes = order.delivery?.boxesLayout;
  if (Array.isArray(boxes)) {
    for (const raw of boxes) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const barcode = readString((raw as Record<string, unknown>)['barcode'])?.trim();
      if (barcode !== undefined && barcode !== '') {
        return barcode;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Listings (offer-mappings, docs §5)
// ---------------------------------------------------------------------------

export function mapOfferMappingToListing(
  entry: YxOfferMapping,
  campaignId: string | null,
): PlatformListingRaw {
  const offer = entry.offer;
  if (typeof offer !== 'object' || offer === null) {
    throw malformed('offerMapping', 'offer object missing');
  }
  const offerId = readString(offer.offerId);
  if (offerId === null) {
    throw malformed('offerMapping.offer', 'offerId missing');
  }
  const marketSku = readString(entry.mapping?.marketSku ?? null);

  // Campaign-scoped publish state when our campaign is listed; verbatim
  // otherwise null (unmapped cards have NO_CARD etc. on cardStatus).
  const campaignStatus = offer.campaigns?.find(
    (row) => String(row.campaignId ?? '') === campaignId,
  )?.status;

  const productAttributes = buildProductAttributes(offer);

  const sku: PlatformListingSkuRaw = {
    platformSkuId: marketSku,
    offerId,
    sellerSku: offerId,
    rawData: {
      ...(entry.mapping ?? {}),
      ...(productAttributes !== null ? { product_attributes: productAttributes } : {}),
    },
  };

  return {
    // marketSku is the platform product identity; an unmapped offer falls
    // back to the seller's own offerId (documented fallback, resolvable by
    // sellerSku once mapped).
    platformProductId: marketSku ?? offerId,
    title: readString(offer.name),
    // 买家商品页链接只信平台给的 showcaseUrl（2026-10-22 实测：marketSku 并不
    // 总是公开页面 id，用它拼出来的链接会 404）。缺失时留 null，前端退回搜索页。
    url: pickShowcaseUrl(entry.showcaseUrls),
    platformStatus: readString(campaignStatus ?? null) ?? readString(offer.cardStatus ?? null),
    skus: [sku],
    rawData: { ...entry },
  };
}

/**
 * `showcaseUrls[]` -> 买家商品页链接。优先 B2C 橱窗，其次第一条有 URL 的；
 * 没有就返回 null（绝不拿 marketSku 拼，AGENTS §88）。
 */
export function pickShowcaseUrl(urls: unknown): string | null {
  if (!Array.isArray(urls)) {
    return null;
  }
  const entries = urls.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  );
  const usable = entries.flatMap((entry) => {
    const url = readString(entry['showcaseUrl'])?.trim();
    return url === undefined || url === '' ? [] : [{ url, type: entry['showcaseType'] }];
  });
  if (usable.length === 0) {
    return null;
  }
  const b2c = usable.find((entry) => entry.type === 'B2C');
  return (b2c ?? usable[0])?.url ?? null;
}

// ---------------------------------------------------------------------------
// Returns (campaign returns, docs §6)
// ---------------------------------------------------------------------------

/**
 * offer.weightDimensions -> shared product_attributes payload (the onboarding
 * prefill reads it via listing-onboarding readProductAttributes). Units per
 * the vendored official OpenAPI (OfferWeightDimensionsDTO, checked 2026-10-05):
 * length/width/height in **cm**, weight in **kg** (gross). Yandex "length" is
 * the package long side -> written as the OZON-style `depth` key the reader
 * maps to 内部长度. Dims are all-or-none (a partial triple cannot yield a
 * volume); weight is independent. Non-positive values are treated as absent
 * platform junk rather than prefilled as 0. null = nothing usable.
 */
export function buildProductAttributes(
  offer: YxOfferMapping['offer'],
): Record<string, unknown> | null {
  const weightDimensions = offer?.weightDimensions;
  if (typeof weightDimensions !== 'object' || weightDimensions === null) {
    return null;
  }
  const positive = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  const length = positive(weightDimensions.length);
  const width = positive(weightDimensions.width);
  const height = positive(weightDimensions.height);
  const weight = positive(weightDimensions.weight);

  const attributes: Record<string, unknown> = {};
  if (length !== null && width !== null && height !== null) {
    attributes['dimension_unit'] = 'cm';
    attributes['depth'] = length;
    attributes['width'] = width;
    attributes['height'] = height;
  }
  if (weight !== null) {
    attributes['weight_unit'] = 'kg';
    attributes['weight'] = weight;
  }
  return Object.keys(attributes).length > 0 ? attributes : null;
}

export function mapReturnToReturn(item: YxReturnItem): PlatformReturnRaw {
  const returnId = readString(item.id);
  if (returnId === null) {
    throw malformed('return', 'id missing');
  }
  const firstItem = item.items?.[0];
  const marketSku = readString(firstItem?.marketSku ?? null);
  const shopSku = readString(firstItem?.shopSku ?? null);
  const count = firstItem?.count;
  return {
    platformReturnId: returnId,
    platformOrderId: readString(item.orderId ?? null),
    state: readString(item.shipmentStatus ?? null),
    refundState: readString(item.refundStatus ?? null),
    platformSkuId: marketSku,
    offerId: shopSku,
    quantity:
      typeof count === 'number' && Number.isFinite(count) && count > 0 ? String(count) : '1',
    createdAt: parseTolerantDate(item.createdAt),
    rawData: { ...item },
  };
}

// ---------------------------------------------------------------------------
// 买家侧事实（2026-11-02）：聊天 / 评价 / 提问
// ---------------------------------------------------------------------------

/** 会话摘要：只关心买家会话（type=CHAT），ARBITRAGE 由调用方决定是否处理。 */
export function mapChatSummaries(items: readonly YxChatInfo[]): PlatformChatSummaryRaw[] {
  const out: PlatformChatSummaryRaw[] = [];
  for (const item of items) {
    const chatId = readString(item.chatId ?? null);
    if (chatId === null) {
      continue;
    }
    // Yandex 没有「未读数」字段；WAITING_FOR_PARTNER 就是「等着我们回」。
    const waitingForPartner = readString(item.status ?? null) === 'WAITING_FOR_PARTNER';
    out.push({
      chatId,
      chatType: readString(item.type ?? null) ?? 'CHAT',
      chatStatus: readString(item.status ?? null) ?? 'NEW',
      unreadCount: waitingForPartner ? 1 : 0,
      lastMessageId: null,
      firstUnreadMessageId: null,
      createdAt: parseTolerantDate(item.createdAt),
    });
  }
  return out;
}

/** 消息方向：CUSTOMER=买家；PARTNER=我们；MARKET/SUPPORT=平台系统。 */
export function mapChatMessage(chatId: string, item: YxChatMessage): PlatformChatMessageRaw {
  const messageId = readString(item.messageId ?? null);
  if (messageId === null) {
    throw malformed('chat message', 'messageId missing');
  }
  const sender = readString(item.sender ?? null);
  const text = readString(item.message ?? null);
  const hasAttachment = Array.isArray(item.payload) && item.payload.length > 0;
  return {
    chatId,
    platformMessageId: messageId,
    direction: sender === 'CUSTOMER' ? 'IN' : sender === 'PARTNER' ? 'OUT' : 'SYSTEM',
    senderType: sender,
    senderId: null,
    bodyText: text === null || text.trim() === '' ? null : text.trim(),
    hasImage: hasAttachment,
    orderNumber: null,
    platformSkuId: null,
    createdAt: parseTolerantDate(item.createdAt) ?? new Date(),
    rawData: { ...item },
  };
}

/** 评价：rating 1-5；正文由 advantages/disadvantages/comment 拼装。 */
export function mapGoodsFeedback(item: YxGoodsFeedback): PlatformReviewRaw | null {
  const reviewId = readString(item.feedbackId ?? null);
  if (reviewId === null) {
    return null;
  }
  const parts = [
    readString(item.description?.comment ?? null),
    readString(item.description?.advantages ?? null),
    readString(item.description?.disadvantages ?? null),
  ].filter((part): part is string => part !== null && part !== '');
  const rating = item.statistics?.rating;
  return {
    platformReviewId: reviewId,
    rating: typeof rating === 'number' ? rating : null,
    bodyText: parts.length === 0 ? null : parts.join(' / '),
    platformSkuId: readString(item.identifiers?.offerId ?? null),
    publishedAt: parseTolerantDate(item.createdAt),
    status: item.needReaction === true ? 'NEED_REACTION' : null,
    orderStatus: null,
    photosCount: 0,
    videosCount: 0,
    commentsCount:
      typeof item.statistics?.commentsCount === 'number' ? item.statistics.commentsCount : 0,
    rawData: { ...item },
  };
}

/** 提问：Yandex 的答案在独立接口，这里 answer 恒为 null。 */
export function mapGoodsQuestion(item: YxGoodsQuestion): PlatformBuyerQuestionRaw | null {
  const questionId = readString(item.questionIdentifiers?.id ?? null);
  if (questionId === null) {
    return null;
  }
  return {
    platformQuestionId: questionId,
    bodyText: readString(item.text ?? null),
    answerText: null,
    platformSkuId: readString(item.questionIdentifiers?.offerId ?? null),
    askedAt: parseTolerantDate(item.createdAt),
    answeredAt: null,
    wasViewed: null,
    rawData: { ...item },
  };
}

// ---------------------------------------------------------------------------
// Webhooks (docs §4: notificationType vocabulary, no signature)
// ---------------------------------------------------------------------------

/**
 * Yandex notification payload -> normalized event. Order events carry
 * `orderId` - the hint the processor re-reads via fetchOrdersByPlatformIds.
 * Return/review/chat events are recorded facts (eventType UNKNOWN -> the
 * processor SKIPS them; the raw payload stays auditable).
 */
export function mapWebhookPayload(payload: unknown): PlatformWebhookEvent[] {
  if (typeof payload !== 'object' || payload === null) {
    throw malformed('webhook payload', 'not a JSON object');
  }
  const body = payload as Record<string, unknown>;
  const notificationType = readString(body.notificationType);
  if (notificationType === null) {
    throw malformed('webhook payload', 'notificationType missing');
  }

  const orderId = readString(body.orderId ?? null);
  const carriesOrderHint = orderId !== null && isOrderAction(notificationType);
  return [
    {
      eventType: classify(notificationType),
      // Yandex notifications carry no event id (docs §4): dedup rides on the
      // payload hash like OZON.
      externalEventId: null,
      platformOrderIds: carriesOrderHint ? [orderId] : [],
      payload: { ...body },
    },
  ];
}

function isOrderAction(notificationType: string): boolean {
  switch (notificationType) {
    case 'ORDER_CREATED':
    case 'ORDER_CANCELLED':
    case 'ORDER_STATUS_UPDATED':
    case 'ORDER_UPDATED':
    case 'ORDER_CANCELLATION_REQUEST':
      return true;
    default:
      return false;
  }
}

function classify(notificationType: string): PlatformWebhookEventType {
  switch (notificationType) {
    case 'PING':
      return 'PING';
    case 'ORDER_CREATED':
      return 'NEW_POSTING';
    case 'ORDER_CANCELLED':
      return 'POSTING_CANCELLED';
    case 'ORDER_STATUS_UPDATED':
    case 'ORDER_UPDATED':
    case 'ORDER_CANCELLATION_REQUEST':
      return 'POSTING_STATE_CHANGED';
    // 买家侧推送（2026-11-02）：载荷只有 id + 时间戳，作为「去拉一次」的信号。
    case 'CHAT_CREATED':
    case 'CHAT_MESSAGE_SENT':
    case 'CHAT_ARBITRAGE_STARTED':
    case 'CHAT_ARBITRAGE_FINISHED':
      return 'CHAT_MESSAGE';
    case 'GOODS_FEEDBACK_CREATED':
    case 'GOODS_FEEDBACK_COMMENT_CREATED':
      return 'GOODS_FEEDBACK';
    case 'QUESTION_CREATED':
    case 'QUESTION_ANSWER_CREATED':
    case 'QUESTION_COMMENT_CREATED':
      return 'BUYER_QUESTION';
    default:
      return 'UNKNOWN';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRequiredDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || value === '') {
    throw malformed(field, 'date-time string missing');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw malformed(field, `unparseable date-time: ${value}`);
  }
  return date;
}

function parseTolerantDate(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function malformed(field: string, reason: string): Error {
  return new YandexMappingError(field, reason);
}

/**
 * Yandex offer-mappings raw entry -> primary product image URL (2026-09-28,
 * ERP 建议#2: 订单行补图). Verified against the vendored official spec
 * (docs/yandex-partner-api-openapi.json): GetOfferMappingDTO.offer.pictures
 * is a nullable array of plain URL strings and "изображение по первой ссылке
 * считается основным" — the FIRST entry is the primary image
 * (BaseOfferResponseDTO.pictures). Tolerant by design (AGENTS.md §49):
 * missing or malformed payload yields null, never a throw.
 */
export function extractYandexOfferImageUrl(rawData: unknown): string | null {
  if (typeof rawData !== 'object' || rawData === null) {
    return null;
  }
  const offer = (rawData as { offer?: unknown }).offer;
  if (typeof offer !== 'object' || offer === null) {
    return null;
  }
  const pictures = (offer as { pictures?: unknown }).pictures;
  if (!Array.isArray(pictures)) {
    return null;
  }
  for (const entry of pictures) {
    if (typeof entry === 'string' && entry.trim() !== '') {
      return entry.trim();
    }
  }
  return null;
}

/** Mapper-level schema violation -> PLATFORM_BAD_RESPONSE. */
export class YandexMappingError extends DomainError {
  readonly code = 'PLATFORM_BAD_RESPONSE';
  readonly httpStatus = 502;

  constructor(field: string, reason: string) {
    super(`Yandex response does not match the verified schema at ${field}: ${reason}`, {
      field,
      reason,
    });
  }
}
