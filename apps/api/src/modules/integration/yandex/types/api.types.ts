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
    /**
     * 包装尺寸与重量（docs/integrations/yandex.md §5 + 仓库内官方 OpenAPI
     * `OfferWeightDimensionsDTO`，2026-10-05 核对）：length/width/height 单位
     * **厘米**，weight 单位**千克**（含包装毛重）。listing 同步把它规范化为
     * 变体 raw_data 的 product_attributes（建档预填数据源）。
     */
    readonly weightDimensions?: {
      readonly length?: number;
      readonly width?: number;
      readonly height?: number;
      readonly weight?: number;
    };
    readonly [key: string]: unknown;
  };
  readonly mapping?: {
    /** Platform SKU id - the internal-SKU mapping target. */
    readonly marketSku?: number | string;
    readonly marketCategoryName?: string;
    readonly [key: string]: unknown;
  };
  /**
   * 买家商品页链接（官方 OpenAPI `GetOfferMappingDTO.showcaseUrls`）：
   * `showcaseType` = B2C/B2B 等，`showcaseUrl` 直接就是 market.yandex.ru 的商品页。
   * **这是唯一可靠的链接来源**——`marketSku` 并不是公开页面 id（2026-10-22 实测：
   * 部分卡片用 marketSku 拼出来的 URL 直接 404）。
   */
  readonly showcaseUrls?: readonly {
    readonly showcaseType?: string;
    readonly showcaseUrl?: string;
  }[];
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
  /** 官方信封：`{status, result:{returns, paging}}`（2026-11-02 核对）。 */
  readonly result?: {
    readonly returns?: readonly YxReturnItem[];
    readonly paging?: { readonly nextPageToken?: string | null };
  };
  /** 兼容分支：历史实现按顶层读取。 */
  readonly returns?: readonly YxReturnItem[];
  readonly paging?: { readonly nextPageToken?: string | null };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// GET /v2/businesses/{businessId}/warehouses (seller-side FBS/DBS warehouses)
// ---------------------------------------------------------------------------

export interface YxWarehouse {
  readonly id?: number | string;
  readonly name?: string;
  /** 归属 campaign（T0 2026-09-18 live：POST 分页变体返回该字段）。 */
  readonly campaignId?: number | string;
  readonly express?: boolean;
  readonly [key: string]: unknown;
}

/** T0 校准（2026-09-18 live）：POST 分页变体响应为 {status, result:{warehouses, paging}}。 */
export interface YxWarehousesResponse {
  readonly status?: string;
  readonly result?: {
    readonly warehouses?: readonly YxWarehouse[];
    readonly paging?: { readonly nextPageToken?: string };
  };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Error envelope: { status: 'OK'|'ERROR', errors: [{code, message}] }
// ---------------------------------------------------------------------------

export interface YxErrorBody {
  readonly status?: string;
  readonly errors?: readonly { code?: string; message?: string }[];
}

// ---------------------------------------------------------------------------
// Outbound shipment operations (order fulfillment flow, 2026-09-18)
//
// Source: docs/yandex-partner-api-openapi.json (official OpenAPI, commit
// 8b32780df5, 2026-09-18). Spec-verified, NOT yet executed against a live
// account (AGENTS.md §92) - see docs/integrations/yandex.md §9.
// ---------------------------------------------------------------------------

/**
 * `PUT /v2/campaigns/{campaignId}/orders/{orderId}/status` (operationId
 * `updateOrderStatus`). Verified transition: `{status:"PROCESSING",
 * substatus:"STARTED"}` -> `{status:"PROCESSING", substatus:"READY_TO_SHIP"}`.
 */
export interface YxUpdateOrderStatusRequest {
  readonly order: {
    readonly status: string;
    readonly substatus?: string;
    readonly delivery?: Record<string, unknown>;
  };
}

/** 200 body: the updated order (same shape as the read path). */
export interface YxUpdateOrderStatusResponse {
  readonly order?: YxOrder;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// 聊天 / 评价 / 提问（2026-11-02，官方 openapi 核对）
// ---------------------------------------------------------------------------

export interface YxChatsResponse {
  readonly result?: {
    readonly chats?: readonly YxChatInfo[];
    readonly paging?: { readonly nextPageToken?: string | null };
  };
  readonly [key: string]: unknown;
}

export interface YxChatInfo {
  /** int64（不是 uuid，按字符串处理避免精度问题）。 */
  readonly chatId?: number | string | null;
  /** CHAT = 买家会话；ARBITRAGE = 争议。 */
  readonly type?: string | null;
  /** NEW / WAITING_FOR_CUSTOMER / WAITING_FOR_PARTNER / … / FINISHED。 */
  readonly status?: string | null;
  readonly context?: Record<string, unknown> | null;
  readonly createdAt?: string | null;
  readonly updatedAt?: string | null;
  readonly [key: string]: unknown;
}

export interface YxChatHistoryResponse {
  readonly result?: {
    readonly context?: Record<string, unknown> | null;
    readonly messages?: readonly YxChatMessage[];
    readonly paging?: { readonly nextPageToken?: string | null };
  };
  readonly [key: string]: unknown;
}

export interface YxChatMessage {
  readonly messageId?: number | string | null;
  readonly createdAt?: string | null;
  /** PARTNER / CUSTOMER / MARKET / SUPPORT。 */
  readonly sender?: string | null;
  readonly message?: string | null;
  readonly payload?: readonly unknown[] | null;
  readonly [key: string]: unknown;
}

export interface YxGoodsFeedbackResponse {
  readonly result?: {
    readonly feedbacks?: readonly YxGoodsFeedback[];
    readonly paging?: { readonly nextPageToken?: string | null };
  };
  readonly [key: string]: unknown;
}

export interface YxGoodsFeedback {
  readonly feedbackId?: string | null;
  readonly createdAt?: string | null;
  readonly needReaction?: boolean | null;
  readonly author?: string | null;
  readonly description?: {
    readonly advantages?: string | null;
    readonly disadvantages?: string | null;
    readonly comment?: string | null;
  } | null;
  readonly statistics?: {
    readonly rating?: number | null;
    readonly commentsCount?: number | null;
    readonly recommended?: boolean | null;
  } | null;
  readonly identifiers?: {
    readonly orderId?: number | null;
    readonly offerId?: string | null;
  } | null;
  readonly [key: string]: unknown;
}

export interface YxGoodsQuestionsResponse {
  readonly result?: {
    readonly questions?: readonly YxGoodsQuestion[];
    readonly paging?: { readonly nextPageToken?: string | null };
    readonly totalCount?: number | null;
  };
  readonly [key: string]: unknown;
}

export interface YxGoodsQuestion {
  readonly questionIdentifiers?: {
    readonly id?: number | string | null;
    readonly offerId?: string | null;
    readonly categoryId?: number | null;
  } | null;
  readonly text?: string | null;
  readonly createdAt?: string | null;
  readonly author?: Record<string, unknown> | null;
  readonly [key: string]: unknown;
}
