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
  /**
   * Seller barcodes of this size - order lines resolve against these.
   * T0 校准（2026-09-18 live）：skus 是字符串数组（如 "2056942167514"），
   * 不是数字。数字保留为兼容回退。
   */
  readonly skus?: readonly (number | string)[];
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
  /**
   * 包装尺寸与重量（卡片级，所有尺寸变体共用）。单位（2026-10-05 经搜索索引
   * 核对 WB 官方开发者门户 dev.wildberries.ru changelog/论坛帖）：
   * length/width/height 为**毫米**，weightBrutto 为**千克**（毛重，
   * 如 0.15 = 150g）。.ru 直连被反爬、本地无 content OpenAPI 副本——
   * T0 拿到真实卡片时按量级复核。listing 同步把它规范化为变体
   * raw_data 的 product_attributes（建档预填数据源）。
   */
  readonly dimensions?: {
    readonly length?: number;
    readonly width?: number;
    readonly height?: number;
    readonly weightBrutto?: number;
  };
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
/**
 * POST /content/v2/get/cards/list 响应 —— T0 校准（2026-09-18 live）：
 * **真实响应是顶层 `{cards, cursor}`，没有文档所称的 `{data, error, errorText}`
 * 信封**（信封解封装仅对带 `error` 键的形状生效）。cursor.updatedAt 是
 * RFC3339 时间字符串（翻页原样回传），nmID 是数字。
 */
export interface WbCardsListResponse {
  readonly cards?: readonly WbCard[];
  readonly cursor?: {
    readonly updatedAt?: string | number;
    readonly nmID?: number;
    readonly total?: number;
  };
  readonly error?: boolean;
  readonly errorText?: string;
  readonly additionalErrors?: unknown;
  readonly [key: string]: unknown;
}

/**
 * Request body of /content/v2/get/cards/list —— T0 校准（2026-09-18 live）：
 * 首页就是 `{settings: {}}`（**不带 cursor 字段**）；cursor.updatedAt 是
 * RFC3339 时间字符串（数字会 400: Time.UnmarshalJSON）。filter/sort 可省略。
 */
export interface WbCardsListRequest {
  readonly settings: {
    readonly cursor?: {
      readonly updatedAt?: string;
      readonly nmID?: number;
      readonly limit?: number;
    };
    readonly filter?: Record<string, unknown>;
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
  /**
   * Seller barcodes - the platform-SKU identity order lines resolve by.
   * 字符串或数字都可能（cards 实测为字符串，订单侧 T0 校准）。
   */
  readonly skus?: readonly (number | string)[];
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

// ---------------------------------------------------------------------------
// Webhook management API (webhooks-api domain, docs verified 2026-09-18)
// ---------------------------------------------------------------------------

/** One webhook resource as returned by GET /api/v1/webhooks. */
export interface WbWebhookResource {
  readonly id?: number | string;
  readonly url?: string;
  readonly name?: string;
  readonly enabled?: boolean;
  readonly subscriptions?: readonly { scope?: string; event?: string }[];
  readonly [key: string]: unknown;
}

/**
 * POST /api/v1/webhooks response - carries the webhook SECRET, shown only at
 * creation (docs §How to create). The exact field name is T0-calibration
 * material (the doc says "the response returns the webhook secret" without
 * naming it); `extractWebhookSecret` scans /secret/i keys instead of
 * hard-coding a guess (AGENTS.md §88).
 */
export interface WbWebhookCreateResponse {
  readonly [key: string]: unknown;
}

/** Tolerant list extraction: bare array or `{webhooks|data|items: [...]}`. */
export function extractWebhookRows(body: unknown): readonly WbWebhookResource[] {
  if (Array.isArray(body)) {
    return body as readonly WbWebhookResource[];
  }
  if (typeof body === 'object' && body !== null) {
    for (const key of ['webhooks', 'data', 'items']) {
      const value = (body as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value as readonly WbWebhookResource[];
      }
    }
  }
  return [];
}

/**
 * Finds the creation-response secret WITHOUT logging or echoing anything:
 * scans top-level, then nested objects (bounded depth), for a /secret/i key
 * whose value is a non-empty string. Returns null when nothing matches.
 */
export function extractWebhookSecret(response: unknown, depth = 2): string | null {
  if (depth <= 0 || typeof response !== 'object' || response === null) {
    return null;
  }
  for (const [key, value] of Object.entries(response as Record<string, unknown>)) {
    if (/secret/i.test(key) && typeof value === 'string' && value !== '') {
      return value;
    }
  }
  for (const value of Object.values(response as Record<string, unknown>)) {
    const nested = extractWebhookSecret(value, depth - 1);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outbound shipment operations (order fulfillment flow, 2026-09-18)
//
// Source: the official FBS Orders swagger vendored at
// docs/wb-orders-fbs-openapi.yaml (openapi 3.0.1, 2026-09-18). Spec-verified,
// NOT yet executed against a live account (AGENTS.md §92 - see
// docs/integrations/wildberries.md §9).
// ---------------------------------------------------------------------------

/** `POST /api/v3/orders/status` item - a READ of one assembly order's state. */
export interface WbV3OrderStatus {
  readonly id: number;
  readonly isCancellable?: boolean;
  /** Seller-side state: new / confirm / complete / cancel (cancel_carrier crossborder). */
  readonly supplierStatus?: string;
  /** WB-side fact (waiting / sorted / sold / canceled / ...). */
  readonly wbStatus?: string;
  readonly [key: string]: unknown;
}

export interface WbV3OrderStatusesResponse {
  readonly orders: readonly WbV3OrderStatus[];
}

/** `POST /api/v3/supplies` - 201 body. */
export interface WbV3CreateSupplyResponse {
  /** Supply ID, e.g. "WB-GI-1234567". */
  readonly id: string;
}

/**
 * `POST /api/v3/orders/stickers` item. `file` is the BASE64 of the sticker in
 * the requested format (the endpoint answers JSON, not a binary stream).
 */
export interface WbV3Sticker {
  readonly orderId: number;
  readonly partA: string;
  readonly partB: string;
  /** Encoded sticker value printed on the label. */
  readonly barcode: string;
  readonly file: string;
}

export interface WbV3StickersResponse {
  readonly stickers: readonly WbV3Sticker[];
}

/**
 * 跨境（CBT）贴纸：与通用贴纸的差别是**返回 PDF**、带生成状态与运单号
 * （官方 spec `/api/v3/orders/stickers/cross-border`，2026-10-22 真实店铺实测：
 * 8/8 张面单 status=ready、parcelId 形如 `WBCNRUGUBCJ2000ZAD`）。
 */
export interface WbV3CrossBorderSticker {
  readonly orderId: number;
  /** `awaitingTrackNumber` = 等承运商回传运单号，面单还没生成。 */
  readonly status?: string;
  /** 贴纸上的运单号（平台分配）。 */
  readonly parcelId?: string;
  readonly file?: string;
}

export interface WbV3CrossBorderStickersResponse {
  readonly stickers: readonly WbV3CrossBorderSticker[];
}
