import {
  PlatformListingRaw,
  PlatformListingSkuRaw,
  PlatformOrderItemRaw,
  PlatformOrderRaw,
  PlatformOrderStage,
  PlatformReturnRaw,
  PlatformWebhookEvent,
  PlatformWebhookEventType,
} from '@wcies/platform-contracts';
import { DomainError } from '../../../common/errors/domain.error';
import { YxOfferMapping, YxOrder, YxOrderItem, YxReturnItem } from './types/api.types';

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
      // sellerSku; unitPrice subshape unverified -> null (T0), never 0.
      platformProductId: null,
      platformSkuId: null,
      offerId,
      sellerSku: offerId,
      quantity: String(count),
      unitPrice: null,
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
    currency: null,
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
