/**
 * Yandex Market Partner API DTO fragments (read-first scope, 2026-09-18).
 *
 * Source of truth: docs/integrations/yandex.md (verified against the
 * official partner-api docs). Fields NOT verified there must not be relied
 * upon; unknown extra fields are preserved verbatim in rawData.
 *
 * T0-calibration notes live in docs/integrations/yandex.md §8: query-param
 * casing (page_token), per-item prices subshape, returns field names.
 */

// ---------------------------------------------------------------------------
// GET /v2/campaigns (credential validation + identity resolution)
// ---------------------------------------------------------------------------

export interface YxCampaign {
  /** Campaign (store) id. */
  readonly id?: number | string;
  /**
   * Business (柜面) the campaign belongs to. REAL SHAPE (T0 校准 2026-09-18，
   * live response)：business 是嵌套对象 `business: {id, name}` —— 不是文档
   * 调研时假设的平铺 businessId。保留平铺键做兼容回退。
   */
  readonly business?: { readonly id?: number | string; readonly name?: string };
  readonly businessId?: number | string;
  readonly clientId?: number | string;
  readonly name?: string;
  readonly domain?: string;
  readonly placementType?: string;
  readonly [key: string]: unknown;
}

export interface YxCampaignsResponse {
  readonly campaigns?: readonly YxCampaign[];
  readonly paging?: { readonly nextPageToken?: string };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// POST /v2/businesses/{businessId}/offer-mappings (listings)
// ---------------------------------------------------------------------------

export interface YxOfferMapping {
  readonly offer?: {
    /** Seller SKU identity (255 chars max) - the sellerSku resolution key. */
    readonly offerId?: string;
    readonly name?: string;
    readonly marketCategoryId?: number;
    readonly vendor?: string;
    readonly barcodes?: readonly number[];
    readonly cardStatus?: string;
    /** Publish state per campaign (= listing status fact). */
    readonly campaigns?: readonly { campaignId?: number | string; status?: string }[];
    /** Fulfillment capability facts (FBY/FBS/DBS ...). */
    readonly sellingPrograms?: readonly {
      sellingProgram?: string;
      status?: string;
    }[];
    readonly archived?: boolean;
    readonly [key: string]: unknown;
  };
  readonly mapping?: {
    /** Platform SKU id - the internal-SKU mapping target. */
    readonly marketSku?: number | string;
    readonly marketCategoryName?: string;
    readonly [key: string]: unknown;
  };
}

export interface YxOfferMappingsResponse {
  readonly result?: {
    readonly offerMappings?: readonly YxOfferMapping[];
    readonly paging?: { readonly nextPageToken?: string };
  };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// POST /v1/businesses/{businessId}/orders (business-level orders)
// ---------------------------------------------------------------------------

export interface YxOrderItem {
  readonly id?: number | string;
  readonly offerId?: string;
  readonly offerName?: string;
  readonly count?: number;
  readonly prices?: Record<string, unknown>;
  readonly instances?: readonly Record<string, unknown>[];
  readonly itemStatuses?: readonly Record<string, unknown>[];
  readonly [key: string]: unknown;
}

export interface YxOrder {
  readonly orderId?: number | string;
  readonly campaignId?: number | string;
  /** Fulfillment-program fact: FBY / FBS / DBS / EXPRESS / LAAS. */
  readonly programType?: string;
  readonly externalOrderId?: string;
  readonly status?: string;
  readonly substatus?: string;
  readonly creationDate?: string;
  readonly updateDate?: string;
  readonly buyerType?: string;
  readonly items?: readonly YxOrderItem[];
  readonly delivery?: {
    readonly type?: string;
    readonly dates?: Record<string, unknown>;
    readonly shipment?: { readonly shipmentDate?: string; readonly [key: string]: unknown };
    readonly tracks?: readonly Record<string, unknown>[];
    readonly deliveryPartnerType?: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface YxOrdersResponse {
  readonly status?: string;
  readonly orders?: readonly YxOrder[];
  readonly paging?: { readonly nextPageToken?: string };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// GET /v2/campaigns/{campaignId}/returns
// ---------------------------------------------------------------------------

export interface YxReturnItem {
  /** Platform return id. */
  readonly id?: number | string;
  readonly orderId?: number | string;
  readonly refundStatus?: string;
  readonly shipmentStatus?: string;
  readonly createdAt?: string;
  readonly items?: readonly {
    marketSku?: number | string;
    shopSku?: string;
    count?: number;
    [key: string]: unknown;
  }[];
  readonly [key: string]: unknown;
}

export interface YxReturnsResponse {
  readonly returns?: readonly YxReturnItem[];
  readonly paging?: { readonly nextPageToken?: string };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// GET /v2/businesses/{businessId}/warehouses (seller-side FBS/DBS warehouses)
// ---------------------------------------------------------------------------

export interface YxWarehouse {
  readonly id?: number | string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

export interface YxWarehousesResponse {
  readonly warehouses?: readonly YxWarehouse[];
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Error envelope: { status: 'OK'|'ERROR', errors: [{code, message}] }
// ---------------------------------------------------------------------------

export interface YxErrorBody {
  readonly status?: string;
  readonly errors?: readonly { code?: string; message?: string }[];
}
