/**
 * OZON Seller API DTO fragments used by Sprint 5 read-first integration.
 *
 * Source of truth: docs/ozon-seller-openapi.json (official Seller API spec,
 * version 2.1, supplied 2026-09) - see docs/integrations/ozon.md for the
 * verification log. Fields NOT verified there must not be relied upon.
 * These types describe only what the mapper reads; unknown extra fields are
 * preserved verbatim in rawData.
 */

// ---------------------------------------------------------------------------
// POST /v3/product/list
// ---------------------------------------------------------------------------

export interface OzonProductListItem {
  /** Идентификатор товара в системе Ozon — product_id. */
  readonly product_id: number;
  /** Идентификатор товара в системе продавца — артикул. */
  readonly offer_id: string;
  readonly archived?: boolean;
  readonly is_discounted?: boolean;
  readonly [key: string]: unknown;
}

export interface OzonProductListResponse {
  readonly result: {
    /** Cursor for the next page (pass back as last_id). */
    readonly last_id: string;
    readonly items: readonly OzonProductListItem[];
    /** Present in the spec as total; treat as optional. */
    readonly total?: number;
  };
}

// ---------------------------------------------------------------------------
// POST /v3/product/info/list (batch detail by offer_id)
// ---------------------------------------------------------------------------

export interface OzonProductInfoItem {
  /** Ozon product_id. */
  readonly id: number;
  readonly name?: string;
  readonly offer_id?: string;
  /** Ozon SKU id (marketplace entity id). */
  readonly sku?: number;
  readonly is_archived?: boolean;
  readonly is_autoarchived?: boolean;
  /** v3 product info/list arrays (verified 2026-09-17). */
  readonly primary_image?: readonly string[];
  readonly images?: readonly string[];
  readonly currency_code?: string;
  readonly [key: string]: unknown;
}

export interface OzonProductInfoListResponse {
  /**
   * Real + spec-verified (2026-09-09 smoke test): the response is a TOP-LEVEL
   * { items } array - unlike product/list and posting/fbs/list there is NO
   * `result` envelope (official schema v3GetProductInfoListResponse).
   */
  readonly items: readonly OzonProductInfoItem[];
}

// ---------------------------------------------------------------------------
// POST /v3/posting/fbs/list
// ---------------------------------------------------------------------------

export interface OzonPostingProduct {
  readonly name?: string;
  /** Seller article. */
  readonly offer_id: string;
  readonly price?: string;
  readonly quantity: number;
  /** Ozon SKU id. */
  readonly sku: number;
  readonly currency_code?: string;
  readonly [key: string]: unknown;
}

export interface OzonFbsPosting {
  readonly posting_number: string;
  readonly order_id?: number;
  readonly order_number?: string;
  readonly status: string;
  readonly substatus?: string;
  /** Logistics flow: v3 English spec + real postings, verified 2026-09-17. */
  readonly integration_type_flow?: string | null;
  /** Дата и время начала обработки отправления (UTC ISO). */
  readonly in_process_at?: string;
  /**
   * Дата и время, до которой необходимо собрать отправление (deadline;
   * after it a new tariff applies). Not marked required by the official
   * schema - treat as optional.
   */
  readonly shipment_date?: string | null;
  readonly tracking_number?: string | null;
  /**
   * Date when the shipment was transferred for delivery (v3 spec schema,
   * verified 2026-09-15) - the platform's OWN timestamp for entering the
   * in-transit stage.
   */
  readonly delivering_date?: string | null;
  /** Actual delivery timestamp (v3 spec schema, verified 2026-09-15). */
  readonly fact_delivery_date?: string | null;
  /** Delivery-window / expected-delivery display facts (verified 2026-09-15). */
  readonly analytics_data?: OzonFbsPostingAnalyticsData | null;
  readonly products: readonly OzonPostingProduct[];
  readonly [key: string]: unknown;
}

/**
 * Nested analytics block of an FBS posting (v3 spec `v3FbsPostingAnalyticsData`,
 * verified 2026-09-15). Carries the delivery-window display facts; the posting
 * response schema puts these HERE, not on the top-level posting object.
 */
export interface OzonFbsPostingAnalyticsData {
  /** Expected date by which the order is delivered (Ozon Delivery only). */
  readonly client_delivery_date_end?: string | null;
  /** Delivery window start (expected). */
  readonly delivery_date_begin?: string | null;
  /** Delivery window end (expected). */
  readonly delivery_date_end?: string | null;
  readonly [key: string]: unknown;
}

export interface OzonFbsPostingListResponse {
  readonly result: {
    readonly has_next: boolean;
    readonly postings: readonly OzonFbsPosting[];
  };
}

// ---------------------------------------------------------------------------
// POST /v2/returns/rfbs/list (dual-axis T5; verified 2026-09-15)
// ---------------------------------------------------------------------------

/** One rFBS return request (per unit). */
export interface OzonRfbsReturn {
  /** Return request identifier (cursor value for pagination). */
  readonly return_id: number;
  readonly return_number: string;
  /** Shipment number - matches our orders.platform_order_id. */
  readonly posting_number?: string | null;
  readonly order_number?: string | null;
  readonly client_name?: string | null;
  readonly created_at?: string | null;
  readonly state?: {
    readonly state?: string | null;
    readonly state_name?: string | null;
    readonly group_state?: string | null;
    readonly money_return_state_name?: string | null;
  } | null;
  readonly product?: {
    readonly sku?: number | null;
    readonly offer_id?: string | null;
    readonly name?: string | null;
    readonly price?: number | null;
    readonly currency_code?: string | null;
  } | null;
  readonly [key: string]: unknown;
}

export interface OzonRfbsReturnListResponse {
  readonly returns?: readonly OzonRfbsReturn[];
}

// ---------------------------------------------------------------------------
// POST /v3/posting/fbs/get
// ---------------------------------------------------------------------------

export interface OzonFbsPostingGetResponse {
  readonly result: OzonFbsPosting;
}

// ---------------------------------------------------------------------------
// Error body shape (observed for 4xx/5xx; fields optional by endpoint)
// ---------------------------------------------------------------------------

export interface OzonErrorBody {
  readonly code?: number;
  readonly message?: string;
  readonly details?: unknown;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// POST /v1/description-category/tree (Sprint 8.5 T3a; verified 2026-09-14)
// ---------------------------------------------------------------------------

export interface OzonCategoryTreeNode {
  readonly description_category_id?: number;
  readonly category_name?: string;
  readonly children?: readonly OzonCategoryTreeNode[];
  readonly disabled?: boolean;
  /** Present on TYPE entries (depth 3); they carry NO description_category_id. */
  readonly type_id?: number;
  readonly type_name?: string;
  readonly [key: string]: unknown;
}

export interface OzonCategoryTreeResponse {
  readonly result: readonly OzonCategoryTreeNode[];
}

// ---------------------------------------------------------------------------
// POST /v4/product/info/attributes (Sprint 8.5 T5; verified 2026-09-14)
// ---------------------------------------------------------------------------

export interface OzonProductAttributesItem {
  /** Ozon product_id (same value v3 info/list reports as `id`). */
  readonly id: number;
  readonly offer_id?: string;
  readonly name?: string;
  readonly depth?: number;
  readonly height?: number;
  readonly width?: number;
  /** Observed value: "mm" (spec allows mm/cm/in). */
  readonly dimension_unit?: string;
  readonly weight?: number;
  /** Observed value: "g". */
  readonly weight_unit?: string;
  readonly description_category_id?: number;
  readonly type_id?: number;
  readonly primary_image?: string;
  readonly images?: readonly string[];
  readonly attributes?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface OzonProductAttributesResponse {
  /**
   * Real + smoke-verified (2026-09-14): `result` is a DIRECT ARRAY - the
   * spec's `result.items` envelope does not match the live response (same
   * class of spec-vs-real gap as /v3/product/info/list).
   */
  readonly result: readonly OzonProductAttributesItem[];
}
