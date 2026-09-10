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
  /** Дата и время начала обработки отправления (UTC ISO). */
  readonly in_process_at?: string;
  readonly tracking_number?: string | null;
  readonly products: readonly OzonPostingProduct[];
  readonly [key: string]: unknown;
}

export interface OzonFbsPostingListResponse {
  readonly result: {
    readonly has_next: boolean;
    readonly postings: readonly OzonFbsPosting[];
  };
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
