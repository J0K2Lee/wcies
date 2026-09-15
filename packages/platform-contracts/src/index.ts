/**
 * Platform integration contracts.
 *
 * Every external platform (OZON / Wildberries / Yandex Market) is integrated
 * through a PlatformAdapter implementing the contracts below (AGENTS.md §32).
 *
 * Sprint 5 extends the minimal Sprint 0 shape with the read-first sync
 * capabilities: listing sync, order polling, credential validation and
 * (platform-dependent) webhook parsing. Write operations (push inventory,
 * prices, shipments) are intentionally NOT part of this contract yet.
 */

/** Known platform codes. Extend only when a new platform is actually integrated. */
export const PLATFORM_CODES = ['OZON', 'WILDBERRIES', 'YANDEX_MARKET'] as const;
export type PlatformCode = (typeof PLATFORM_CODES)[number];

/**
 * Credential payload handed to an adapter for validation.
 * Secrets are already-decrypted values; adapters must never log them.
 */
export interface PlatformCredentialContext {
  readonly storeId: string;
  readonly platform: PlatformCode;
  readonly credential: Readonly<Record<string, unknown>>;
}

/**
 * Decrypted store context for sync calls. The adapter combines the store's
 * credential with a store-scoped API call (AGENTS.md §27/§43: sync is ALWAYS
 * store-scoped, never platform-global).
 */
export interface StoreContext {
  readonly storeId: string;
  readonly storeCode: string;
  readonly platform: PlatformCode;
  readonly credential: Readonly<Record<string, unknown>>;
}

/** One page of platform data plus the opaque cursor for the next page. */
export interface PaginatedResult<T> {
  readonly items: readonly T[];
  /**
   * Cursor to pass to the next call. `null` when the enumeration completed
   * (no more pages). Opaque to the sync layer - only adapters interpret it.
   */
  readonly nextCursor: unknown;
  readonly hasMore: boolean;
}

/** Normalized platform error categories (Sprint 5 task §39). */
export const PLATFORM_ERROR_CODES = [
  'PLATFORM_AUTH_ERROR',
  'PLATFORM_RATE_LIMITED',
  'PLATFORM_TIMEOUT',
  'PLATFORM_BAD_RESPONSE',
  'PLATFORM_API_ERROR',
  'PLATFORM_NETWORK_ERROR',
] as const;
export type PlatformErrorCode = (typeof PLATFORM_ERROR_CODES)[number];

/** Safe, secret-free platform failure details persisted on sync jobs. */
export interface PlatformErrorDetail {
  readonly code: PlatformErrorCode;
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly endpoint: string;
  readonly storeId: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

/** One platform SKU variant seen inside a platform listing. */
export interface PlatformListingSkuRaw {
  /** Platform-side SKU id (OZON: numeric `sku`). */
  readonly platformSkuId: string | null;
  /** Seller-maintained article (OZON: `offer_id`). */
  readonly offerId: string | null;
  readonly sellerSku: string | null;
  readonly rawData: Record<string, unknown>;
}

/**
 * A platform product page as returned by the platform (Sprint 5 task §17).
 * Raw data is preserved verbatim for audit/troubleshooting.
 */
export interface PlatformListingRaw {
  readonly platformProductId: string;
  readonly title: string | null;
  readonly url: string | null;
  /** Platform-native status string, stored as fact; never an ERP state. */
  readonly platformStatus: string | null;
  readonly skus: readonly PlatformListingSkuRaw[];
  readonly rawData: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Normalized platform LOGISTICS stage of an order (2026-09-15 dual-axis task
 * T1). Derived by each platform MAPPER from its own status vocabulary - the
 * core never interprets platform status strings (AGENTS.md §31/§33). Stages
 * are facts, never ERP states: AWAITING_SHIPMENT/IN_TRANSIT/DELIVERED describe
 * where the GOODS are on the platform side, while erp_status describes WCIES
 * fulfillment progress.
 */
export const PLATFORM_ORDER_STAGES = [
  'AWAITING_SHIPMENT',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
] as const;
export type PlatformOrderStage = (typeof PLATFORM_ORDER_STAGES)[number];

/** One order line as returned by the platform. */
export interface PlatformOrderItemRaw {
  readonly platformProductId: string | null;
  readonly platformSkuId: string | null;
  readonly offerId: string | null;
  readonly sellerSku: string | null;
  readonly quantity: string;
  readonly rawData: Record<string, unknown>;
}

/**
 * A platform order/posting in platform-neutral shape (Sprint 5 task §21).
 * Mappers convert platform DTOs into this; OrderIngestionService consumes it.
 */
export interface PlatformOrderRaw {
  /** Business key: UNIQUE(storeId, platformOrderId) in WCIES. */
  readonly platformOrderId: string;
  readonly platformStatus: string | null;
  readonly fulfillmentMode: string | null;
  readonly orderedAt: Date;
  /**
   * Platform-required ship-by time (OZON shipment_date). A platform FACT,
   * never an ERP state. Null when the platform omits it or the value is
   * unparseable - mappers must tolerate both (Sprint 7).
   */
  readonly shipmentDeadline: Date | null;
  readonly currency: string | null;
  readonly items: readonly PlatformOrderItemRaw[];
  readonly rawData: Record<string, unknown>;
  /**
   * True when the platform reports this order cancelled. Derived by the
   * PLATFORM MAPPER from its own status vocabulary (platform semantics stay
   * out of the core, AGENTS.md §31/§33) - the core never compares
   * platform_status strings itself (Sprint 9 T1).
   */
  readonly platformCancelled?: boolean;
  /**
   * Normalized logistics stage (see PLATFORM_ORDER_STAGES). Null when the
   * mapper's status vocabulary value is not yet classified (e.g. OZON
   * `arbitration`) - unclassified values must be documented, never guessed
   * (AGENTS.md §88).
   */
  readonly platformStage?: PlatformOrderStage | null;
  /**
   * Platform's OWN timestamp for entering `platformStage` (OZON:
   * delivering_date for IN_TRANSIT, fact_delivery_date for DELIVERED).
   * Null when the stage carries no platform timestamp or the value is
   * missing/unparseable - callers fall back to their observation time.
   */
  readonly platformStageChangedAt?: Date | null;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Webhook event types WCIES knows how to act on. */
export const PLATFORM_WEBHOOK_EVENT_TYPES = [
  'NEW_POSTING',
  'POSTING_CANCELLED',
  'POSTING_STATE_CHANGED',
  'ITEM_CHANGED',
  'PING',
  'UNKNOWN',
] as const;
export type PlatformWebhookEventType = (typeof PLATFORM_WEBHOOK_EVENT_TYPES)[number];

/**
 * A normalized webhook event. Webhook payloads are treated as HINTS only:
 * they carry identifiers, not business facts - processors re-read the
 * platform API for the authoritative data before ingesting anything.
 */
export interface PlatformWebhookEvent {
  readonly eventType: PlatformWebhookEventType;
  /** Platform event id when provided; null when absent (payload hash dedup). */
  readonly externalEventId: string | null;
  /** Platform order ids referenced by the event (e.g. posting numbers). */
  readonly platformOrderIds: readonly string[];
  readonly payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

/**
 * Base contract every platform adapter implements.
 * Extended per-sprint with new capabilities only when a business sprint
 * requires them (no speculative method dumps).
 */
export interface PlatformAdapter {
  readonly platformCode: PlatformCode;

  /** Throws a PlatformError when credentials are invalid (safe read only). */
  validateCredential(context: PlatformCredentialContext): Promise<void>;

  /**
   * Fetch one page of platform listings starting at `cursor` (undefined =
   * first page). Cursor semantics are platform-specific and opaque.
   */
  fetchListings(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformListingRaw>>;

  /**
   * Fetch one page of platform orders. Without a cursor this starts a
   * catch-up window; adapters may also accept targeted cursors (e.g.
   * specific posting numbers from a webhook) - see adapter option types.
   */
  fetchOrders(context: StoreContext, cursor?: unknown): Promise<PaginatedResult<PlatformOrderRaw>>;

  /**
   * Parse a raw webhook payload into normalized events. Optional: platforms
   * without webhook capability simply do not implement it (task §29).
   */
  processWebhook?(context: StoreContext, payload: unknown): Promise<PlatformWebhookEvent[]>;

  /**
   * Targeted order re-read by platform order ids (webhook follow-up): the
   * webhook payload is only a hint, the authoritative facts come from this
   * authenticated read. Optional - only webhook-capable platforms need it.
   */
  fetchOrdersByPlatformIds?(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderRaw[]>;
}
