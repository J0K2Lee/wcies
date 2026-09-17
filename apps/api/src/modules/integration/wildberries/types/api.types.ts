/**
 * Wildberries Seller API DTO fragments (read-first scope, 2026-09-18).
 *
 * Source of truth: docs/integrations/wildberries.md (verified against the
 * official Chinese mirror dev.wildberries.cn). WB splits its API across
 * module domains (common / content / marketplace / statistics) - the client
 * owns the per-domain base URLs. Fields NOT verified in the doc must not be
 * relied upon; unknown extra fields are preserved verbatim in rawData.
 *
 * Deliberately NOT typed here (spec unverified, T0 pending): returns domain
 * payloads, webhook payloads, /api/v3/orders/status bodies, seller FBS
 * warehouse CRUD.
 */

// ---------------------------------------------------------------------------
// GET common /api/v1/seller-info (credential validation)
// ---------------------------------------------------------------------------

/** Response shape beyond "HTTP 200 + JSON object" is T0-calibration material. */
export interface WbSellerInfoResponse {
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// POST content /content/v2/get/cards/list (listings)
// ---------------------------------------------------------------------------

export interface WbCardSize {
  /** WB characteristic id - stable identity of one size variant. */
  readonly chrtID?: number;
  readonly techSize?: string;
  /** Seller barcodes of this size - order lines resolve against these. */
  readonly skus?: readonly number[];
  readonly [key: string]: unknown;
}

export interface WbCard {
  readonly nmID: number;
  readonly imtID?: number;
  readonly nmUUID?: string;
  readonly subjectID?: number;
  readonly subjectName?: string;
  /** Seller article - the seller-SKU identity orders resolve by. */
  readonly vendorCode?: string;
  readonly brand?: string;
  readonly title?: string;
  readonly description?: string;
  readonly photos?: Record<string, unknown>;
  readonly characteristics?: readonly Record<string, unknown>[];
  readonly sizes?: readonly WbCardSize[];
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly [key: string]: unknown;
}

/**
 * Content-domain envelope: `{data, error, errorText, additionalErrors}`.
 * A business error rides inside HTTP 200 with `error: true` - the client
 * unwraps it (docs/integrations/wildberries.md §4).
 */
export interface WbCardsListResponse {
  readonly data?: {
    readonly cards?: readonly WbCard[];
    /** Cursor to echo back (updatedAt + nmID of the last card). */
    readonly cursor?: { total?: number; updatedAt?: number; nmID?: number };
  };
  readonly error?: boolean;
  readonly errorText?: string;
  readonly additionalErrors?: unknown;
}

/** Request body of /content/v2/get/cards/list. */
export interface WbCardsListRequest {
  readonly settings: {
    readonly filter: Record<string, unknown>;
    readonly cursor: { readonly updatedAt: number; readonly nmID: number; readonly limit: number };
    readonly sort?: { readonly ascending: boolean };
  };
}

// ---------------------------------------------------------------------------
// GET marketplace /api/v3/orders (FBS/DBS assembly-task orders)
// ---------------------------------------------------------------------------

export interface WbV3Order {
  /** Assembly-task id - the WCIES platform order id for FBS/DBS. */
  readonly id: number;
  readonly orderUid?: string;
  readonly rid?: string;
  /** Seller article (= vendorCode on the card). */
  readonly article?: string;
  /** Seller barcodes - the platform-SKU identity order lines resolve by. */
  readonly skus?: readonly number[];
  readonly nmId?: number;
  readonly chrtId?: number;
  readonly price?: number;
  readonly finalPrice?: number;
  readonly salePrice?: number;
  readonly currencyCode?: string;
  readonly warehouseId?: number;
  readonly officeId?: number;
  readonly createdAt?: string;
  readonly ddate?: string;
  readonly sellerDate?: string;
  readonly deliveryType?: string;
  readonly comment?: string;
  readonly isZeroOrder?: boolean;
  readonly supplyId?: string;
  /** Seller-side task state: new / confirm / complete / cancel. */
  readonly supplierStatus?: string;
  /** Platform-side fact vocabulary (docs §3a); may be absent on tasks. */
  readonly wbStatus?: string;
  readonly [key: string]: unknown;
}

export interface WbV3OrdersResponse {
  readonly orders?: readonly WbV3Order[];
  /**
   * Pagination cursor: first request passes 0; echo the response value.
   * Exhaustion signal is T0-calibration material - the adapter treats
   * `next > 0 && orders.length > 0` as "more pages".
   */
  readonly next?: number;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// GET statistics /api/v1/supplier/orders (DBW/FBO buyout report rows)
// ---------------------------------------------------------------------------

/**
 * One row = one order = one unit (docs §3b). Data refreshes every 30 min and
 * is retained 90 days; `lastChangeDate` is the single-sided incremental
 * cursor (flag=0). `date`/`lastChangeDate` are Moscow time (UTC+3).
 */
export interface WbStatsOrderRow {
  readonly date?: string;
  readonly lastChangeDate?: string;
  readonly warehouseName?: string;
  readonly warehouseType?: string;
  readonly supplierArticle?: string;
  readonly nmId?: number;
  readonly barcode?: string;
  readonly category?: string;
  readonly subject?: string;
  readonly brand?: string;
  readonly techSize?: string;
  readonly incomeID?: number;
  readonly isSupply?: boolean;
  readonly isRealization?: boolean;
  readonly totalPrice?: number;
  readonly discountPercent?: number;
  readonly spp?: number;
  readonly finishedPrice?: number;
  readonly priceWithDisc?: number;
  readonly isCancel?: boolean;
  readonly cancelDate?: string;
  readonly sticker?: unknown;
  readonly gNumber?: string;
  /** Order-line unique id - the WCIES platform order id for DBW rows. */
  readonly srid?: string;
  readonly [key: string]: unknown;
}

/** Statistics responses may wrap rows in `orders` or return a bare array. */
export function extractStatsRows(body: unknown): readonly WbStatsOrderRow[] {
  if (Array.isArray(body)) {
    return body as readonly WbStatsOrderRow[];
  }
  if (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { orders?: unknown }).orders)
  ) {
    return (body as { orders: readonly WbStatsOrderRow[] }).orders;
  }
  return [];
}
