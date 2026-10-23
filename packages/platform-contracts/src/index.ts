/**
 * Platform integration contracts.
 *
 * Every external platform (OZON / Wildberries / Yandex Market) is integrated
 * through a PlatformAdapter implementing the contracts below (AGENTS.md §32).
 *
 * Sprint 5 extends the minimal Sprint 0 shape with the read-first sync
 * capabilities: listing sync, order polling, credential validation and
 * (platform-dependent) webhook parsing.
 *
 * 2026-09-18 (order fulfillment flow): the read-first boundary is lifted for
 * exactly ONE order lifecycle operation per platform - `prepareShipment`
 * (OZON 组包) plus its companion label fetch `fetchShippingLabel`. Inventory
 * / price push operations remain intentionally OUT of this contract.
 * Write capabilities stay OPTIONAL per adapter: a platform without a verified
 * write endpoint simply does not implement them, and callers must treat the
 * absence as "not supported" rather than falling back to a guess
 * (AGENTS.md §88/§92).
 */

/**
 * Known platform codes. Extend only when a new platform is actually integrated.
 *
 * Values align with the DB seed / platform constants
 * (apps/api/src/modules/platform/constants/platform.constants.ts) - the
 * adapter registry keys off the DB `platforms.code`, so a mismatch here makes
 * `resolveSyncableStore` fail with STORE_NOT_FOUND (WB/Yandex adapters,
 * 2026-09-18).
 */
export const PLATFORM_CODES = ['OZON', 'WB', 'YANDEX'] as const;
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
  /**
   * Platform-reported unit sale price as a decimal string (Sprint 10 T1,
   * finance.md §2 - a structured finance fact). Null when the platform
   * omitted or malformed it; mappers must tolerate, never fabricate.
   */
  readonly unitPrice: string | null;
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
  /**
   * Platform-assigned waybill/tracking number of this shipment (OZON
   * `tracking_number`). A platform FACT used for display and for filling the
   * internal Shipment's tracking number at outbound time - it does NOT make
   * the order the logistics model (AGENTS.md §37: Shipment/Package stay the
   * only logistics carrier). Null/absent while the platform has not assigned
   * one yet; mappers must tolerate that, never fabricate (2026-09-18).
   */
  readonly platformTrackingNo?: string | null;
}

// ---------------------------------------------------------------------------
// Returns (dual-axis T5, 2026-09-15)
// ---------------------------------------------------------------------------

/**
 * A platform-side return record in platform-neutral shape (returns.md §2).
 * Read-only FACT pulled from the platform (OZON /v2/returns/rfbs/list);
 * it never drives stock by itself - physical goods flow through a
 * ReturnBatch whose inspection is the only stock write-back path.
 */
export interface PlatformReturnRaw {
  /** Business key: UNIQUE(storeId, platformReturnId) in WCIES. */
  readonly platformReturnId: string;
  /** The platform order/shipment id the return refers to (posting number). */
  readonly platformOrderId: string | null;
  /** Platform return state string, stored verbatim as a fact. */
  readonly state: string | null;
  /** Platform refund-state string (display-only fact, returns.md §4). */
  readonly refundState: string | null;
  /** Platform SKU id of the returned item (line resolution key). */
  readonly platformSkuId: string | null;
  readonly offerId: string | null;
  /** Quantity on the platform record (rFBS returns are per-unit: 1). */
  readonly quantity: string;
  /** Platform-side creation time of the return request. */
  readonly createdAt: Date | null;
  readonly rawData: Record<string, unknown>;
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
// Outbound shipment operations (order fulfillment flow, 2026-09-18)
// ---------------------------------------------------------------------------

/**
 * Result of handing an order over to the platform for dispatch.
 *
 * OZON calls this "pack the order" (`POST /v4/posting/fbs/ship`) and it IS
 * the platform-side "we have shipped it" step: `awaiting_packaging` ->
 * `awaiting_deliver`. Verified against the vendored spec: there is NO further
 * seller-facing status write afterwards, so a repeat call for an already
 * prepared order must be reported as SUCCESS (`alreadyPrepared`), never as an
 * error - callers depend on this for idempotency (docs/integrations/ozon.md).
 */
export interface PlatformShipmentPreparation {
  /** Platform order id the operation ran on. */
  readonly platformOrderId: string;
  /** Waybill/tracking number assigned by the platform, when exposed. */
  readonly trackingNumber: string | null;
  /** Platform status AFTER the operation, verbatim platform vocabulary. */
  readonly platformStatus: string | null;
  /** True when the platform reported the order was already prepared. */
  readonly alreadyPrepared: boolean;
  /**
   * True when the platform ACCEPTED the assembly request but has not
   * confirmed it yet - a SUCCESS outcome, not an error (T0 2026-10-09,
   * OZON 124 / 56089221-0064-1: `/v4/posting/fbs/ship` returns 200 and the
   * posting then sits in `awaiting_packaging` with substatus `ship_pending`
   * for a while before flipping to `awaiting_deliver`). The waybill is
   * simply not readable yet; a later call converges on the facts.
   */
  readonly assemblyPending?: boolean;
}

/** A platform-generated label/waybill file, fetched so it can be printed. */
export interface PlatformLabelFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  /**
   * 取面单时平台一并给出的运单号（WB 跨境贴纸的 `parcelId`）。
   * 有的平台的运单号只能从这个响应里拿到（订单列表接口不返回），所以由
   * 面单文件带出来，调用方负责回填订单与发货单（2026-10-22）。
   */
  readonly trackingNumber?: string | null;
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

  /**
   * 组包/入供应单之后面单**立即**可取（WB / Yandex），不依赖「平台先分配运单号」。
   * OZON 不声明：它要等 posting 进入 awaiting_deliver 才有面单，预取门槛由
   * `assemblyPending` / 运单号决定（2026-10-22）。
   */
  readonly labelReadyAfterPrepare?: boolean;

  /**
   * 批量取面单的单次上限（平台文档值）。缺省时调用方用全局配置
   * （OZON package-label ≤20）。仅当适配器实现了 `fetchShippingLabels` 才有意义。
   */
  readonly labelBatchLimit?: number;

  /** Optional read-only public product image lookup, scoped to a store. */
  fetchProductImages?(
    context: StoreContext,
    platformSkuIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>>;

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
   * Optional read-only targeted listing lookup by order-line identifiers
   * (2026-10-20, on-demand backfill for orders whose listing was created on
   * the platform after the last listing walk).
   *
   * One logical lookup: the adapter picks the identifier it can query by and
   * MUST NOT walk the full listing set. Returns null when the platform has no
   * such variant (deleted / never existed). Platforms without a targeted read
   * omit the method - callers treat that as "unsupported" and offer the local
   * fallback.
   *
   * Result is a platform FACT only: it is upserted as an UNMAPPED variant and
   * never assigns an internal SKU (decision 0016).
   */
  fetchListingVariant?(
    context: StoreContext,
    identifiers: {
      readonly platformSkuId?: string | null;
      readonly offerId?: string | null;
      readonly platformProductId?: string | null;
    },
  ): Promise<PlatformListingRaw | null>;

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

  /**
   * One page of platform return records (dual-axis T5, read-only). Cursor is
   * opaque/platform-specific; undefined starts from the beginning. Optional -
   * platforms without a return API do not implement it.
   */
  fetchReturns?(
    context: StoreContext,
    cursor?: unknown,
  ): Promise<PaginatedResult<PlatformReturnRaw>>;

  /**
   * Optional WRITE: hand the order over to the platform for dispatch (OZON
   * 组包). This changes REAL platform order state, so callers must act on
   * explicit user intent only (AGENTS.md §92) and must never call it from a
   * test against a live account. Implementations must be idempotent from the
   * caller's point of view: an order the platform already accepted resolves
   * with `alreadyPrepared: true` instead of throwing.
   *
   * Platforms whose write endpoint is not verified simply omit this method -
   * absence means "unsupported", never "guess it" (AGENTS.md §88).
   */
  prepareShipment?(
    context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<PlatformShipmentPreparation>;

  /**
   * Optional READ: fetch the platform-generated shipping label (面单) for an
   * order so it can be archived and printed. Returns null when the platform
   * has no label for the order yet (e.g. OZON only serves labels once the
   * order is `awaiting_deliver`).
   */
  fetchShippingLabel?(
    context: StoreContext,
    order: { platformOrderId: string },
  ): Promise<PlatformLabelFile | null>;

  /**
   * Optional READ (批量取面单, 用户指示 2026-10-21): fetch the labels of ONE
   * chunk of orders in a single platform call (OZON `package-label` accepts a
   * posting_number array). Callers chunk to the platform's documented limit.
   *
   * Contract: the returned array contains ONLY the orders whose label is
   * available; an id missing from the result means "not ready yet" (never an
   * error). Real platform failures throw, exactly like `fetchShippingLabel`.
   *
   * The caller must verify that the returned files can be attributed to the
   * requested orders (OZON returns one combined PDF - page order is the
   * request order) and fall back to per-order calls when it cannot: the batch
   * path is an optimization, never a correctness dependency (AGENTS.md §88).
   */
  fetchShippingLabels?(
    context: StoreContext,
    platformOrderIds: readonly string[],
  ): Promise<readonly PlatformOrderLabelFile[]>;
}

/** One order's label inside a batched label response. */
export interface PlatformOrderLabelFile {
  readonly platformOrderId: string;
  readonly file: PlatformLabelFile;
}
