import {
  PlatformListingRaw,
  PlatformListingSkuRaw,
  PlatformOrderItemRaw,
  PlatformOrderRaw,
  PlatformWebhookEvent,
  PlatformWebhookEventType,
} from '@wcies/platform-contracts';
import {
  OzonFbsPosting,
  OzonPostingProduct,
  OzonProductInfoItem,
  OzonProductListItem,
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
  const platformSkuId = typeof info?.sku === 'number' ? String(info.sku) : null;
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

  const items: PlatformOrderItemRaw[] = posting.products.map(
    (product: OzonPostingProduct, index: number) => {
      if (typeof product.offer_id !== 'string') {
        throw malformed(`posting.products[${index}]`, 'offer_id missing');
      }
      if (typeof product.sku !== 'number') {
        throw malformed(`posting.products[${index}]`, 'sku (number) missing');
      }
      const quantity = normalizeQuantity(product.quantity, `posting.products[${index}].quantity`);
      return {
        platformProductId: String(product.sku),
        platformSkuId: String(product.sku),
        offerId: product.offer_id,
        sellerSku: null,
        quantity,
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
    fulfillmentMode: 'FBS',
    orderedAt,
    currency,
    items,
    rawData: { ...posting },
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
