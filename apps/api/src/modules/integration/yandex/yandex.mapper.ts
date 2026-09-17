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
    currency: null,
    items,
    rawData: { ...order },
  };
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

  const sku: PlatformListingSkuRaw = {
    platformSkuId: marketSku,
    offerId,
    sellerSku: offerId,
    rawData: { ...(entry.mapping ?? {}) },
  };

  return {
    // marketSku is the platform product identity; an unmapped offer falls
    // back to the seller's own offerId (documented fallback, resolvable by
    // sellerSku once mapped).
    platformProductId: marketSku ?? offerId,
    title: readString(offer.name),
    url: null,
    platformStatus: readString(campaignStatus ?? null) ?? readString(offer.cardStatus ?? null),
    skus: [sku],
    rawData: { ...entry },
  };
}

// ---------------------------------------------------------------------------
// Returns (campaign returns, docs §6)
// ---------------------------------------------------------------------------

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
