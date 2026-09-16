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
import {
  OzonFbsPosting,
  OzonPostingProduct,
  OzonProductInfoItem,
  OzonProductListItem,
  OzonRfbsReturn,
} from './types/api.types';
import { DomainError } from '../../../common/errors/domain.error';

/**
 * OZON DTO -> WCIES unified model mapper (Sprint 5 task §7/§33).
 *
 * Pure functions only - no HTTP, no repositories. Every conversion either
 * produces a verified shape or throws PLATFORM_BAD_RESPONSE (task §50):
 * never `as any` through malformed data.
 */

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export function mapProductToListing(
  listItem: OzonProductListItem,
  info: OzonProductInfoItem | undefined,
): PlatformListingRaw {
  if (typeof listItem.product_id !== 'number' || typeof listItem.offer_id !== 'string') {
    throw malformed('product/list item', 'product_id (number) / offer_id (string) missing');
  }
  if (info !== undefined && info.id !== listItem.product_id) {
    throw malformed('product/info item', `info id ${String(info.id)} does not match product_id`);
  }

  const title = typeof info?.name === 'string' && info.name !== '' ? info.name : null;
  // `sku: 0` is not an identifier: OZON returns it for products that have no
  // SKU assigned yet (25 such rows were observed in real data). Storing "0"
  // would make many products share one fake identifier, so a non-positive
  // value is treated as absent - those rows stay resolvable by offer_id.
  const platformSkuId = typeof info?.sku === 'number' && info.sku > 0 ? String(info.sku) : null;
  const archived =
    info?.is_archived === true || info?.is_autoarchived === true || listItem.archived === true;

  const sku: PlatformListingSkuRaw = {
    platformSkuId,
    offerId: listItem.offer_id,
    sellerSku: null,
    rawData: info === undefined ? { ...listItem } : { ...info },
  };

  return {
    platformProductId: String(listItem.product_id),
    title,
    url: null,
    platformStatus: archived ? 'ARCHIVED' : 'LISTED',
    skus: [sku],
    rawData: {
      product_list_item: { ...listItem },
      product_info: info === undefined ? null : { ...info },
    },
  };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * OZON FBS Seller-API status for a cancelled posting (docs/integrations/ozon.md
 * §Posting 字段映射, verified 2026-09). Kept HERE so the platform vocabulary
 * never leaks into the order core (AGENTS.md §31/§33): the core only sees
 * `platformCancelled: true`.
 */
const OZON_POSTING_STATUS_CANCELLED = 'cancelled';

/**
 * Seller API `status` -> normalized logistics stage (dual-axis task T1,
 * 2026-09-15; vocabulary cross-checked word-by-word against the v3 English
 * spec's v3FbsPostingDetail.status description - see docs/integrations/ozon.md
 * §平台阶段映射). Unclassified values map to null: guessing a stage for
 * arbitration-like statuses would be a business-rule invention (AGENTS.md §88).
 */
const OZON_POSTING_STATUS_STAGE: Readonly<Record<string, PlatformOrderStage>> = {
  awaiting_approve: 'AWAITING_SHIPMENT',
  awaiting_packaging: 'AWAITING_SHIPMENT',
  awaiting_registration: 'AWAITING_SHIPMENT',
  awaiting_deliver: 'AWAITING_SHIPMENT',
  delivering: 'IN_TRANSIT',
  driver_pickup: 'IN_TRANSIT',
  acceptance_in_progress: 'IN_TRANSIT',
  delivered: 'DELIVERED',
  cancelled: 'CANCELLED',
};

export function mapPostingToOrder(posting: OzonFbsPosting): PlatformOrderRaw {
  if (typeof posting.posting_number !== 'string' || posting.posting_number === '') {
    throw malformed('posting', 'posting_number missing');
  }
  if (typeof posting.status !== 'string') {
    throw malformed('posting', 'status missing');
  }
  if (!Array.isArray(posting.products)) {
    throw malformed('posting', 'products array missing');
  }

  const orderedAt = parseIsoDate(posting.in_process_at, 'posting.in_process_at');
  const currency = firstCurrency(posting.products);
  // Platform fact, not an ERP state (AGENTS.md §38). The official schema does
  // not mark shipment_date required, and one missing field must not fail the
  // whole posting sync (AGENTS.md §49) - so unlike orderedAt this parse is
  // TOLERANT: missing or unparseable becomes null.
  const shipmentDeadline = parseIsoDateTolerant(posting.shipment_date);
  // Normalized logistics stage + the platform's OWN timestamp for entering it
  // (dual-axis task T1). Anchors per docs §2.4: IN_TRANSIT -> delivering_date,
  // DELIVERED -> fact_delivery_date, otherwise null. Both parses tolerant.
  const platformStage = OZON_POSTING_STATUS_STAGE[posting.status] ?? null;
  const platformStageChangedAt =
    platformStage === 'IN_TRANSIT'
      ? parseIsoDateTolerant(posting.delivering_date)
      : platformStage === 'DELIVERED'
        ? parseIsoDateTolerant(posting.fact_delivery_date)
        : null;

  const items: PlatformOrderItemRaw[] = posting.products.map(
    (product: OzonPostingProduct, index: number) => {
      if (typeof product.offer_id !== 'string') {
        throw malformed(`posting.products[${index}]`, 'offer_id missing');
      }
      if (typeof product.sku !== 'number') {
        throw malformed(`posting.products[${index}]`, 'sku (number) missing');
      }
      const quantity = normalizeQuantity(product.quantity, `posting.products[${index}].quantity`);
      // Same guard as the listing mapper: a non-positive sku is not an
      // identifier. Storing "0" would make this line resolve against every
      // product that also carries "0" -> LISTING_SKU_RESOLVE_AMBIGUOUS.
      const skuId = product.sku > 0 ? String(product.sku) : null;
      return {
        platformProductId: skuId,
        platformSkuId: skuId,
        offerId: product.offer_id,
        sellerSku: null,
        quantity,
        unitPrice: parseUnitPriceTolerant(product.price),
        rawData: { ...product },
      };
    },
  );
  if (items.length === 0) {
    throw malformed('posting', 'posting has no products');
  }

  return {
    platformOrderId: posting.posting_number,
    platformStatus: posting.status,
    platformCancelled: posting.status === OZON_POSTING_STATUS_CANCELLED,
    platformStage,
    platformStageChangedAt,
    fulfillmentMode: 'FBS',
    orderedAt,
    shipmentDeadline,
    currency,
    items,
    rawData: { ...posting },
  };
}

// ---------------------------------------------------------------------------
// Returns (dual-axis T5)
// ---------------------------------------------------------------------------

/**
 * OZON rFBS return -> normalized PlatformReturnRaw (returns.md §2). Tolerant
 * mapping: only return_number is mandatory (the business key); everything
 * else degrades to null - one bad record must not fail the whole page
 * (AGENTS.md §49). The push of platform facts never writes stock: the
 * physical batch owns that.
 */
export function mapRfbsReturn(item: OzonRfbsReturn): PlatformReturnRaw {
  if (typeof item.return_number !== 'string' || item.return_number === '') {
    throw malformed('rfbs return', 'return_number missing');
  }
  const sku = item.product?.sku;
  return {
    platformReturnId: item.return_number,
    platformOrderId: readString(item.posting_number),
    state: readString(item.state?.state ?? null) ?? readString(item.state?.group_state ?? null),
    refundState: readString(item.state?.money_return_state_name ?? null),
    platformSkuId: typeof sku === 'number' && sku > 0 ? String(sku) : null,
    offerId: readString(item.product?.offer_id ?? null),
    // rFBS return requests are per-unit (spec schema has no quantity field).
    quantity: '1',
    createdAt: parseIsoDateTolerant(item.created_at),
    rawData: { ...item },
  };
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * OZON webhook payload -> normalized events. Verified envelope: a top-level
 * `message_type` discriminator plus event-specific fields (OZON provides NO
 * signature; identity matching happens in the webhook service, not here).
 * Events carry hints only - the processor re-reads the posting via API.
 */
export function mapWebhookPayload(payload: unknown): PlatformWebhookEvent[] {
  if (typeof payload !== 'object' || payload === null) {
    throw malformed('webhook payload', 'not a JSON object');
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.message_type !== 'string') {
    throw malformed('webhook payload', 'message_type missing');
  }

  const postingNumber = readString(body.posting_number);
  const externalEventId = null; // OZON webhooks carry no event id (verified)

  const eventType = classify(body.message_type);
  const platformOrderIds = postingNumber === null ? [] : [postingNumber];
  return [
    {
      eventType,
      externalEventId,
      platformOrderIds,
      payload: { ...body },
    },
  ];

  function classify(type: string): PlatformWebhookEventType {
    switch (type) {
      case 'TYPE_NEW_POSTING':
        return 'NEW_POSTING';
      case 'TYPE_POSTING_CANCELLED':
        return 'POSTING_CANCELLED';
      case 'TYPE_STATE_CHANGED':
        return 'POSTING_STATE_CHANGED';
      case 'TYPE_CREATE_ITEM':
      case 'TYPE_UPDATE_ITEM':
      case 'TYPE_CREATE_OR_UPDATE_ITEM':
        return 'ITEM_CHANGED';
      case 'TYPE_PING':
        return 'PING';
      default:
        return 'UNKNOWN';
    }
  }
}

/** Extracts the seller_id hint from a webhook payload (identity matching). */
export function webhookSellerId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  return readNumber((payload as Record<string, unknown>).seller_id);
}

/**
 * Extracts the platform-side transition time from a webhook payload
 * (dual-axis T2). Only TYPE_STATE_CHANGED / TYPE_POSTING_CANCELLED carry
 * `changed_state_date` (docs/integrations/ozon.md §6.1); tolerant - null for
 * everything else, never throws.
 */
export function webhookChangedStateDate(payload: unknown): Date | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  return parseIsoDateTolerant((payload as Record<string, unknown>).changed_state_date);
}

// ---------------------------------------------------------------------------
// Push notification acknowledgement
// ---------------------------------------------------------------------------

/**
 * OZON push notification acknowledgement body.
 *
 * Verified 2026-09-14 against the seller cabinet's "添加地址" check: the legacy
 * `{result: true}` body is REJECTED with WRONG_RESULT_TIME_FIELD. The platform
 * requires `{version, name, time}` on HTTP 200; errors must answer 4xx/5xx.
 * Source: official OpenAPI spec v2.1, section "Запрос для проверки соединения"
 * (docs/ozon-seller-openapi.json) - see docs/integrations/ozon.md §6.4.
 */
export interface OzonPushAck {
  version: string;
  name: string;
  time: string;
}

/** Service identity reported to OZON - free-form strings per the spec. */
const PUSH_ACK_NAME = 'WCIES';
const PUSH_ACK_VERSION = '2.0';

/**
 * Builds the acknowledgement for a push notification.
 *
 * `time` is the moment the notification STARTED being processed (spec:
 * "дата и время начала обработки уведомления"), not when the response is
 * serialised - hence the caller stamps it on entry. Fractional seconds are
 * dropped to match the documented template `2019-08-24T14:15:22Z`.
 */
export function buildPushAck(startedAt: Date): OzonPushAck {
  return {
    version: PUSH_ACK_VERSION,
    name: PUSH_ACK_NAME,
    time: startedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstCurrency(products: readonly { currency_code?: unknown }[]): string | null {
  for (const product of products) {
    if (typeof product.currency_code === 'string' && product.currency_code !== '') {
      return product.currency_code;
    }
  }
  return null;
}

/**
 * OZON posting products[].price arrives as a string like "107.000000"
 * (verified field, docs/integrations/ozon.md). Sprint 10 T1: normalize it to
 * a <=4-decimal string for the structured finance fact; a missing/malformed
 * value becomes NULL - one bad price must neither fail the posting sync
 * (AGENTS.md §49) nor be fabricated as 0 (finance.md §2).
 */
function parseUnitPriceTolerant(price: string | undefined): string | null {
  if (typeof price !== 'string') {
    return null;
  }
  const trimmed = price.trim();
  if (!/^\d{1,14}(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ''] = trimmed.split('.');
  // Keep at most 4 fraction digits (half-up on the 5th) without float math.
  const kept = (fraction + '0000').slice(0, 4);
  const rest = fraction.slice(4, 5);
  let last = Number(kept[3]);
  if (rest >= '5') {
    last += 1;
  }
  const fractionFinal = kept.slice(0, 3) + String(last);
  return `${whole}.${fractionFinal}`;
}

function normalizeQuantity(value: unknown, field: string): string {
  const quantity = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw malformed(field, `invalid quantity: ${String(value)}`);
  }
  return String(quantity);
}

function parseIsoDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw malformed(field, 'date-time string missing');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw malformed(field, `unparseable date-time: ${value}`);
  }
  return date;
}

/**
 * Same as parseIsoDate but returns null instead of throwing: for optional
 * platform facts a missing/invalid value must degrade gracefully, never fail
 * the order sync (Sprint 7 task §8, AGENTS.md §49).
 */
function parseIsoDateTolerant(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function readNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) {
    return value;
  }
  return null;
}

function malformed(field: string, reason: string): Error {
  return new OzonMappingError(field, reason);
}

/** Mapper-level schema violation -> PLATFORM_BAD_RESPONSE (task §50). */
export class OzonMappingError extends DomainError {
  readonly code = 'PLATFORM_BAD_RESPONSE';
  readonly httpStatus = 502;

  constructor(field: string, reason: string) {
    super(`OZON response does not match the verified schema at ${field}: ${reason}`, {
      field,
      reason,
    });
  }
}
