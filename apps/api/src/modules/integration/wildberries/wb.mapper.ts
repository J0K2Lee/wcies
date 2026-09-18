import {
  PlatformListingRaw,
  PlatformListingSkuRaw,
  PlatformOrderItemRaw,
  PlatformOrderRaw,
  PlatformOrderStage,
  PlatformWebhookEvent,
  PlatformWebhookEventType,
} from '@wcies/platform-contracts';
import { timingSafeEqual } from 'node:crypto';
import { DomainError } from '../../../common/errors/domain.error';
import { WbCard, WbCardSize, WbStatsOrderRow, WbV3Order } from './types/api.types';

/**
 * Wildberries DTO -> WCIES unified model mapper (2026-09-18).
 *
 * Pure functions only - no HTTP, no repositories. Every conversion either
 * produces a verified shape or throws PLATFORM_BAD_RESPONSE: never `as any`
 * through malformed data.
 *
 * Identifier rules (Decision 0016: order resolution uses platformSkuId +
 * sellerSku ONLY - offerId is editable on the platform and may never resolve
 * an order):
 * - WB order lines carry barcodes (`skus[]` / statistics `barcode`) - these
 *   equal the listing rows' `platformSkuId` (cards `sizes[].skus[]`);
 * - `article` / `vendorCode` is the seller article - it feeds BOTH offerId
 *   (audit) and sellerSku (fallback resolution when the barcode is absent).
 */

// ---------------------------------------------------------------------------
// Status vocabulary (docs/integrations/wildberries.md §3a)
// ---------------------------------------------------------------------------

/** Seller-side assembly-task states. */
const WB_SUPPLIER_CANCELLED = 'cancel';

/**
 * Platform-side `wbStatus` -> normalized logistics stage. The whole table is
 * T0-calibratable against real order samples (plan §P1); values not listed
 * map to null - guessing a stage would be a business-rule invention
 * (AGENTS.md §88).
 *
 * `postponed_delivery` is deliberately unclassified: the goods may be
 * pre-shipment (buyer moved the date) or already in circulation - the two
 * cases need a real sample to tell apart.
 */
const WB_STATUS_STAGE: Readonly<Record<string, PlatformOrderStage>> = {
  waiting: 'AWAITING_SHIPMENT',
  sorted: 'AWAITING_SHIPMENT',
  accepted_by_carrier: 'IN_TRANSIT',
  sent_to_carrier: 'IN_TRANSIT',
  ready_for_pickup: 'IN_TRANSIT',
  sold: 'DELIVERED',
  canceled: 'CANCELLED',
  canceled_by_client: 'CANCELLED',
  declined_by_client: 'CANCELLED',
  canceled_by_carrier: 'CANCELLED',
  defect: 'CANCELLED',
};

/** wbStatus values that mean the platform cancelled the position. */
const WB_STATUS_CANCELLED = new Set<string>([
  'canceled',
  'canceled_by_client',
  'declined_by_client',
  'canceled_by_carrier',
  'defect',
]);

export function wbStageOf(wbStatus: string | null): PlatformOrderStage | null {
  return WB_STATUS_STAGE[wbStatus ?? ''] ?? null;
}

export function wbCancelledOf(order: { supplierStatus?: string; wbStatus?: string }): boolean {
  return (
    order.supplierStatus === WB_SUPPLIER_CANCELLED ||
    (order.wbStatus !== undefined &&
      order.wbStatus !== null &&
      WB_STATUS_CANCELLED.has(order.wbStatus))
  );
}

// ---------------------------------------------------------------------------
// Listings (cards/list, docs §4)
// ---------------------------------------------------------------------------

export function mapCardToListing(card: WbCard): PlatformListingRaw {
  if (typeof card.nmID !== 'number' || !Number.isFinite(card.nmID)) {
    throw malformed('card', 'nmID (number) missing');
  }
  const vendorCode = readString(card.vendorCode);
  const sizes: readonly WbCardSize[] = Array.isArray(card.sizes) ? card.sizes : [];

  // One listing-SKU row per size barcode: order lines carry exactly these
  // barcodes, so each becomes its own resolvable platformSkuId. A size
  // without barcodes still emits a row (platformSkuId null) so the listing
  // stays visible and resolvable by sellerSku.
  const skus: PlatformListingSkuRaw[] = [];
  for (const size of sizes) {
    // T0 校准（2026-09-18 live）：cards 的 sizes[].skus 条码是字符串数组
    // （"2056942167514"）；数字保留为兼容回退。
    const barcodes = Array.isArray(size.skus)
      ? size.skus
          .map((sku: unknown): string | null => {
            if (typeof sku === 'string' && sku.trim() !== '') {
              return sku.trim();
            }
            if (typeof sku === 'number' && Number.isFinite(sku)) {
              return String(sku);
            }
            return null;
          })
          .filter((sku): sku is string => sku !== null)
      : [];
    if (barcodes.length === 0) {
      skus.push({
        platformSkuId: null,
        offerId: vendorCode,
        sellerSku: vendorCode,
        rawData: { ...size },
      });
      continue;
    }
    for (const barcode of barcodes) {
      skus.push({
        platformSkuId: String(barcode),
        offerId: vendorCode,
        sellerSku: vendorCode,
        rawData: { ...size },
      });
    }
  }
  if (skus.length === 0) {
    skus.push({ platformSkuId: null, offerId: vendorCode, sellerSku: vendorCode, rawData: {} });
  }

  return {
    platformProductId: String(card.nmID),
    title: readString(card.title),
    url: null,
    // Cards absent from trash appear in this list = live listings (docs §4:
    // 回收站卡片不出现在结果中) - same synthesized fact as the OZON mapper.
    platformStatus: 'LISTED',
    skus,
    rawData: { ...card },
  };
}

// ---------------------------------------------------------------------------
// Orders - FBS/DBS assembly tasks (marketplace v3, docs §3a)
// ---------------------------------------------------------------------------

/**
 * One v3 row = one unit. The row is its own order line (quantity 1) - the
 * WCIES order key is the assembly-task `id` (docs §3c mapping table).
 */
export function mapFbsOrderToOrder(order: WbV3Order): PlatformOrderRaw {
  if (typeof order.id !== 'number' || !Number.isFinite(order.id)) {
    throw malformed('order', 'id (number) missing');
  }
  if (typeof order.article !== 'string' || order.article === '') {
    throw malformed('order', 'article (seller article) missing');
  }
  const orderedAt = parseRequiredDate(order.createdAt, 'order.createdAt');

  const wbStatus = readString(order.wbStatus);
  const supplierStatus = readString(order.supplierStatus);
  const supplierCancelled = supplierStatus === WB_SUPPLIER_CANCELLED;
  // A cancelled assembly task is dead regardless of the platform-side
  // vocabulary - supplierStatus wins (plan §7.2: supplierStatus 取消 →
  // platformCancelled). Otherwise the wbStatus stage decides; only the two
  // pre-shipment supplier states fall back safely to AWAITING_SHIPMENT.
  const stage = supplierCancelled
    ? ('CANCELLED' as PlatformOrderStage)
    : (wbStageOf(wbStatus) ??
      (supplierStatus === 'new' || supplierStatus === 'confirm' ? 'AWAITING_SHIPMENT' : null));

  const barcode = firstBarcode(order.skus);
  const nmId =
    typeof order.nmId === 'number' && Number.isFinite(order.nmId) ? String(order.nmId) : null;
  const item: PlatformOrderItemRaw = {
    platformProductId: nmId,
    platformSkuId: barcode,
    offerId: order.article,
    sellerSku: order.article,
    quantity: '1',
    unitPrice: readPrice(order.finalPrice) ?? readPrice(order.salePrice),
    rawData: { ...order },
  };

  return {
    platformOrderId: String(order.id),
    platformStatus: wbStatus ?? supplierStatus,
    platformCancelled: wbCancelledOf({
      supplierStatus: order.supplierStatus,
      wbStatus: order.wbStatus,
    }),
    platformStage: stage,
    platformStageChangedAt: null,
    // Both FBS and DBS are seller-fulfilled (SELF_MANAGED WB_FBS, plan §4.2);
    // DBS delivery nuances are T0 follow-up material.
    fulfillmentMode: 'FBS',
    orderedAt,
    shipmentDeadline: null,
    currency: readString(order.currencyCode),
    items: [item],
    rawData: { ...order },
  };
}

// ---------------------------------------------------------------------------
// Orders - DBW buyout rows (statistics, docs §3b)
// ---------------------------------------------------------------------------

/**
 * One report row = one order = one unit; WCIES order key = `srid`. The
 * report has NO logistics state machine - `isCancel` is the only state fact
 * (a weak fact, docs §3c), so non-cancelled rows carry stage null rather
 * than an invented one.
 */
export function mapStatsRowToOrder(row: WbStatsOrderRow): PlatformOrderRaw {
  const srid = readString(row.srid);
  if (srid === null) {
    throw malformed('stats row', 'srid (unique order-line id) missing');
  }
  const orderedAt = parseRequiredDate(row.date, 'stats row date');

  const supplierArticle = readString(row.supplierArticle);
  const barcode = readString(row.barcode);
  const nmId = typeof row.nmId === 'number' && Number.isFinite(row.nmId) ? String(row.nmId) : null;
  const item: PlatformOrderItemRaw = {
    platformProductId: nmId,
    platformSkuId: barcode,
    offerId: supplierArticle,
    sellerSku: supplierArticle,
    quantity: '1',
    unitPrice: readPrice(row.priceWithDisc) ?? readPrice(row.finishedPrice),
    rawData: { ...row },
  };

  const cancelled = row.isCancel === true;
  return {
    platformOrderId: srid,
    platformStatus: cancelled ? 'canceled' : null,
    platformCancelled: cancelled,
    platformStage: cancelled ? 'CANCELLED' : null,
    platformStageChangedAt: null,
    // DBW (买断/ realization) = platform-managed fulfillment (WB_FBW, plan §4.2).
    fulfillmentMode: 'FBW',
    orderedAt,
    shipmentDeadline: null,
    currency: null,
    items: [item],
    rawData: { ...row },
  };
}

// ---------------------------------------------------------------------------
// Webhooks (docs verified 2026-09-18: webhooks-api event deliveries)
// ---------------------------------------------------------------------------

/**
 * WB event type -> normalized contract type. Current catalog (docs
 * §Available events): report_generation_complete / card_creation_error /
 * card_changed / feedback_updated. ONLY card_changed maps to a known
 * contract type (ITEM_CHANGED); everything else - including future types the
 * platform adds - records as UNKNOWN (facts, never guessed).
 */
const WB_WEBHOOK_EVENT_TYPES: Readonly<Record<string, PlatformWebhookEventType>> = {
  card_changed: 'ITEM_CHANGED',
};

/** One delivery event inside the envelope (docs §Event format). */
export interface WbWebhookEventRaw {
  readonly id?: string;
  readonly time?: string;
  readonly test?: boolean;
  readonly type?: string;
  readonly scope?: string;
  readonly idempotencyKey?: string;
  readonly payload?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

/**
 * WB webhook delivery envelope -> normalized events. One delivery carries up
 * to 100 events (docs §Event format). Each event keeps its OWN object as the
 * payload (the raw-event row is per event; dedup rides the platform's
 * idempotencyKey, falling back to the event id, falling back to payload
 * hash). Order ids: content events reference cards, not orders - always [].
 */
export function mapWebhookEnvelope(payload: unknown): PlatformWebhookEvent[] {
  if (typeof payload !== 'object' || payload === null) {
    throw malformed('webhook envelope', 'not a JSON object');
  }
  const body = payload as Record<string, unknown>;
  if (!Array.isArray(body.events)) {
    throw malformed('webhook envelope', 'events array missing');
  }
  const events: PlatformWebhookEvent[] = [];
  for (const raw of body.events as unknown[]) {
    if (typeof raw !== 'object' || raw === null) {
      throw malformed('webhook envelope event', 'not a JSON object');
    }
    const event = raw as WbWebhookEventRaw;
    const type = readString(event.type);
    if (type === null) {
      throw malformed('webhook envelope event', 'type missing');
    }
    events.push({
      eventType: WB_WEBHOOK_EVENT_TYPES[type] ?? 'UNKNOWN',
      externalEventId: readString(event.idempotencyKey ?? null) ?? readString(event.id ?? null),
      platformOrderIds: [],
      payload: { ...(event as Record<string, unknown>) },
    });
  }
  return events;
}

/** Delivery envelope's seller identity (audit/log context only). */
export function webhookEnvelopeSellerId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  return readString((payload as Record<string, unknown>).sellerId ?? null);
}

/** True when the event is the platform's TEST probe (docs §Testing). */
export function isWbTestWebhookEvent(event: PlatformWebhookEvent): boolean {
  return event.payload['test'] === true;
}

/**
 * Constant-time comparison of the delivery's Authorization header against
 * the stored webhook secret (docs §Verifying event authenticity - the
 * secret generated at creation time is the ONLY authenticity signal).
 * A length mismatch still burns one compare to avoid a length oracle.
 */
export function isWbWebhookSecretValid(
  headerValue: string | null | undefined,
  expectedSecret: string | null | undefined,
): boolean {
  if (
    headerValue === null ||
    headerValue === undefined ||
    headerValue === '' ||
    expectedSecret === null ||
    expectedSecret === undefined ||
    expectedSecret === ''
  ) {
    return false;
  }
  const provided = Buffer.from(headerValue, 'utf8');
  const expected = Buffer.from(expectedSecret, 'utf8');
  if (provided.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  return timingSafeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstBarcode(skus: readonly (number | string)[] | undefined): string | null {
  if (!Array.isArray(skus)) {
    return null;
  }
  for (const sku of skus) {
    if (typeof sku === 'number' && Number.isFinite(sku)) {
      return String(sku);
    }
    if (typeof sku === 'string' && sku.trim() !== '') {
      return sku.trim();
    }
  }
  return null;
}

/** Tolerant numeric price -> decimal string (never fabricated as 0). */
function readPrice(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value.toFixed(2);
  }
  return null;
}

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
  return new WbMappingError(field, reason);
}

/** Mapper-level schema violation -> PLATFORM_BAD_RESPONSE. */
export class WbMappingError extends DomainError {
  readonly code = 'PLATFORM_BAD_RESPONSE';
  readonly httpStatus = 502;

  constructor(field: string, reason: string) {
    super(`WB response does not match the verified schema at ${field}: ${reason}`, {
      field,
      reason,
    });
  }
}
