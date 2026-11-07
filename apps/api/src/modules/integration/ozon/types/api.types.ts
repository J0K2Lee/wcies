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

/**
 * v4 `/posting/fbs/list` returns the price as an OBJECT, unlike the v3
 * get/list shape which uses a plain decimal string (verified 2026-10-21 on
 * polling-ingested orders: items came in with price `{amount, currency}`).
 */
export interface OzonPriceAmount {
  readonly amount?: string;
  readonly currency?: string;
}

export interface OzonPostingProduct {
  readonly name?: string;
  /** Seller article. */
  readonly offer_id: string;
  /** v3 get: "107.000000"; v4 list: {amount, currency} (2026-10-20). */
  readonly price?: string | OzonPriceAmount;
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
  /**
   * Platform-advertised next actions (v3 spec `v3FbsPostingDetail`,
   * e.g. `ship` / `ship_async` / `ship_async_in_process` / `label_download`).
   * Preferred "can this posting be assembled?" signal; not guaranteed
   * present, so callers fall back to the status vocabulary.
   */
  readonly available_actions?: readonly string[] | null;
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

/**
 * POST /v4/posting/fbs/list (2026-10-20 迁移)：v3 的 list 方法已对本账号持续
 * 返回 429（实测，双店复现），v4 正常。v4 是**游标分页**且响应在顶层——
 * 不再有 `result` 包裹：
 *   request  { filter: { since, to }, limit, cursor? }
 *   response { has_next, cursor, postings }
 * posting 字段与 v3 一致（products / analytics_data 均保留）。
 */
export interface OzonFbsPostingListResponse {
  readonly has_next: boolean;
  /** 下一页游标（不透明）；has_next=false 时为空串。 */
  readonly cursor: string;
  readonly postings: readonly OzonFbsPosting[];
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
// POST /v3/chat/list · POST /v3/chat/history（2026-11-02 实测）
// ---------------------------------------------------------------------------

/** 会话摘要（实测：`chat.chat_id` / `chat.chat_type` / `unread_count` …）。 */
export interface OzonChatListItem {
  readonly chat?: {
    readonly chat_id?: string | null;
    readonly chat_type?: string | null;
    readonly chat_status?: string | null;
    readonly created_at?: string | null;
  } | null;
  readonly unread_count?: number | null;
  /** int64：bigint-safe 解析后是字符串（可能超过 2^53）。 */
  readonly first_unread_message_id?: number | string | null;
  readonly last_message_id?: number | string | null;
}

export interface OzonChatListResponse {
  readonly chats?: readonly OzonChatListItem[];
  readonly total_unread_count?: number | null;
  readonly cursor?: string | null;
  readonly has_next?: boolean | null;
}

/** 一条会话消息（实测：`data[]` 是 Markdown 行数组；`user.type`=Customer/Seller）。 */
export interface OzonChatHistoryMessage {
  /** int64：bigint-safe 解析后是字符串（可能超过 2^53）。 */
  readonly message_id?: number | string | null;
  readonly user?: { readonly id?: string | null; readonly type?: string | null } | null;
  readonly created_at?: string | null;
  readonly is_read?: boolean | null;
  readonly data?: readonly string[] | null;
  readonly context?: { readonly order_number?: string | null; readonly sku?: string | null } | null;
  readonly is_image?: boolean | null;
  readonly [key: string]: unknown;
}

export interface OzonChatHistoryResponse {
  readonly has_next?: boolean | null;
  readonly messages?: readonly OzonChatHistoryMessage[];
}

// ---------------------------------------------------------------------------
// POST /v2/review/list（2026-11-02：需卖家付费订阅，403 PermissionDenied）
// ---------------------------------------------------------------------------

export interface OzonReviewListRequest {
  readonly limit: number;
  readonly sort_dir?: 'ASC' | 'DESC';
  readonly last_id?: string;
  readonly filters?: {
    readonly published_from?: string;
    readonly published_to?: string;
  };
}

export interface OzonReview {
  readonly id?: string | null;
  readonly rating?: number | null;
  readonly text?: string | null;
  readonly sku?: number | null;
  readonly published_at?: string | null;
  readonly status?: string | null;
  readonly order_status?: string | null;
  readonly photos_amount?: number | null;
  readonly videos_amount?: number | null;
  readonly comments_amount?: number | null;
  readonly [key: string]: unknown;
}

export interface OzonReviewListResponse {
  readonly reviews?: readonly OzonReview[];
  readonly has_next?: boolean | null;
  readonly last_id?: string | null;
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

// ---------------------------------------------------------------------------
// POST /v2/warehouse/list · /v1/fbp/warehouse/list · /v1/warehouse/ozon/list
// (仓库绑定平台仓库；2026-09-17 实测验证，见 docs/integrations/ozon.md)
// ---------------------------------------------------------------------------

/** POST /v2/warehouse/list item - seller's own FBS / rFBS warehouses. */
export interface OzonSellerWarehouse {
  readonly warehouse_id: number;
  readonly name?: string;
  /** true = rFBS (realFBS 自发货), false = FBS (发货至 OZON 分拣中心). */
  readonly is_rfbs?: boolean;
  readonly warehouse_type?: string;
  /** new|created|disabled|blocked|disabled_due_to_limit|error */
  readonly status?: string;
  readonly address_info?: { readonly address?: string; readonly [key: string]: unknown };
  readonly [key: string]: unknown;
}

export interface OzonSellerWarehouseListResponse {
  readonly warehouses: readonly OzonSellerWarehouse[];
}

/** POST /v1/fbp/warehouse/list item - FBP 平台国内合作仓（半托管）. */
export interface OzonFbpWarehouse {
  readonly id: number;
  readonly name?: string;
  readonly partner_name?: string;
  readonly is_bonded?: boolean;
  readonly timezone_name?: string;
  readonly address_detailing?: {
    readonly city?: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
}

export interface OzonFbpWarehouseListResponse {
  readonly warehouses: readonly OzonFbpWarehouse[];
}

/** POST /v1/warehouse/ozon/list item - OZON 自有仓目录（FBO 履约中心）. */
export interface OzonOwnWarehouse {
  readonly warehouse_id: number;
  readonly name?: string;
  readonly short_name?: string;
  readonly address?: string;
  readonly is_active?: boolean;
  readonly warehouse_type?: string;
  readonly [key: string]: unknown;
}

export interface OzonOwnWarehouseListResponse {
  readonly warehouses: readonly OzonOwnWarehouse[];
}

// ---------------------------------------------------------------------------
// Outbound shipment operations (order fulfillment flow, 2026-09-18)
//
// Source: vendored v3 English spec (docs/ozon-seller-api-eng-version-3.json),
// operationIds PostingAPI_ShipFbsPostingV4 / PostingAPI_PostingFBSPackageLabel.
// NOT yet verified against the live API - the write path needs an explicit
// owner-approved T0 run (AGENTS.md §92); see docs/integrations/ozon.md.
// ---------------------------------------------------------------------------

/** One product instance inside a ship request package (spec: product_id = SKU). */
export interface OzonShipPackageProduct {
  readonly product_id: number;
  readonly quantity: number;
}

/** One shipment parcel of `POST /v4/posting/fbs/ship`. */
export interface OzonShipPackage {
  readonly products: readonly OzonShipPackageProduct[];
}

export interface OzonFbsShipRequest {
  readonly posting_number: string;
  readonly packages: readonly OzonShipPackage[];
}

/**
 * Response of `POST /v4/posting/fbs/ship`: `result` lists the posting numbers
 * the platform accepted. The spec explicitly warns that a 200 does NOT prove
 * the order was assembled - the caller must re-read the posting and check
 * `substatus` (`ship_failed` means "retry").
 */
export interface OzonFbsShipResponse {
  readonly result?: readonly string[];
  readonly additional_data?: readonly {
    readonly posting_number?: string;
    readonly products?: readonly OzonShipPackageProduct[];
    readonly [key: string]: unknown;
  }[];
  readonly [key: string]: unknown;
}

/**
 * Response of `POST /v3/posting/fbs/package-label/create`.
 *
 * 官方于 2026-11-02 停用同步面单接口 `POST /v2/posting/fbs/package-label`
 * （停用后仍返回误导性的 429 code 8），替代流程是「create 建任务 → get 取
 * file_url」。T0 实测（2026-11-03，ON-002/ON-003）：`tasks` 在响应**顶层**，
 * 单次请求多个 posting 只返回一个任务，`task_type` 为 `small_label`（店铺
 * 面单格式设置决定；文档称 `big_label` 为普通面单）。
 */
export interface OzonPackageLabelTask {
  /** 类型声明为 int64：解析时按长整数保护，可能以字符串形式到达。 */
  readonly task_id?: number | string;
  readonly task_type?: string;
  readonly [key: string]: unknown;
}

export interface OzonPackageLabelCreateResponse {
  readonly tasks?: readonly OzonPackageLabelTask[];
  readonly [key: string]: unknown;
}

/**
 * Response of `POST /v2/posting/fbs/package-label/get`（按 task_id 取面单）。
 *
 * `status.code`：`pending` / `in_progress` / `completed` / `error`。
 * T0 实测：任务通常 2–7 秒内 completed；`file_url` 指向 ozonstatic.cn 的
 * 一次性下载地址（无签名参数、无需鉴权头），Content-Type 为
 * `application/octet-stream`，内容为多页 PDF（一页一单）。
 */
export interface OzonPackageLabelGetResponse {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
  readonly file_url?: string;
  readonly status?: {
    readonly code?: string;
    readonly postings_count?: number;
    readonly printed_postings_count?: number;
    readonly unprinted_postings?: readonly {
      readonly posting_number?: string;
      readonly message?: string;
    }[];
  };
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Push-notification subscription management (/v1/notification/*)
//
// Source: vendored official spec v2.1, schemas notification.v1.* (checked
// field-by-field 2026-10-09); management endpoints are documented in
// docs/integrations/ozon.md §6. Responses of set/update/delete carry NO body
// (spec declares no 200 content) - OzonClient tolerates that.
// ---------------------------------------------------------------------------

/**
 * One entry of the list response's `types` array. Live shape (2026-10-12):
 * an OBJECT `{type, description}` (spec schema NotificationListResponse
 * .Notification.NotificationType, both fields required) — NOT a plain string
 * like in set/update REQUEST bodies (request/response asymmetry). Legacy
 * string values are tolerated defensively.
 */
export type OzonNotificationTypeInfo =
  | string
  | {
      readonly type: string;
      readonly description?: string;
      readonly [key: string]: unknown;
    };

/** One subscribed URL as returned by `POST /v1/notification/list`. */
export interface OzonNotificationSubscription {
  readonly id: number;
  readonly url: string;
  readonly enable: boolean;
  readonly types: readonly OzonNotificationTypeInfo[];
  readonly created_at?: string;
  /**
   * 投递可用性（2026-11-07 核实）：平台按连续投递失败累计，到阈值自动
   * disable。GREEN 0 / YELLOW 1500 / RED 2500（平台口径）。
   */
  readonly availability_status?: string;
  readonly disable_reason?: string;
  readonly availability_status_date?: string;
  readonly problematic_type?: string;
  readonly [key: string]: unknown;
}

export interface OzonNotificationListResponse {
  readonly urls?: readonly OzonNotificationSubscription[];
  readonly [key: string]: unknown;
}

/**
 * `POST /v1/notification/check` —— 平台自己探测我们 URL 的结果（2026-10-27）。
 * `is_active` 表示探测是否拿到可用响应；`errors` 给出具体失败类别
 * （REQUEST_ERROR / STATUS_CODE_NOT_OK / SERVER_FAULT / WRONG_RESULT_FIELD…）。
 */
export interface OzonNotificationCheckError {
  readonly type: string;
  readonly description?: string;
}

export interface OzonNotificationCheckResponse {
  readonly is_active: boolean;
  readonly errors?: readonly OzonNotificationCheckError[];
  readonly [key: string]: unknown;
}
