import {
  OzonCategoryTreeResponse,
  OzonErrorBody,
  OzonFbsPostingGetResponse,
  OzonFbsPostingListResponse,
  OzonFbsShipResponse,
  OzonFbpWarehouseListResponse,
  OzonNotificationListResponse,
  OzonOwnWarehouseListResponse,
  OzonProductAttributesResponse,
  OzonProductInfoListResponse,
  OzonProductListResponse,
  OzonRfbsReturnListResponse,
  OzonSellerWarehouseListResponse,
  OzonShipPackage,
} from './types/api.types';
import { PlatformErrorDetail } from '@wcies/platform-contracts';
import { PlatformApiError, PlatformMalformedResponseError } from '../platform-error';

/**
 * OZON Seller API client (Sprint 5 task §39-§41).
 *
 * Responsibilities ONLY: HTTP transport, authentication headers, timeout,
 * retry of safely-retryable failures, per-store rate limiting and error
 * normalization. No business logic, no mapping.
 *
 * Verified facts (docs/integrations/ozon.md):
 * - Base URL https://api-seller.ozon.ru, all methods POST + JSON body.
 * - Auth headers `Client-Id` + `Api-Key`.
 * - 401/403 = credential error (never retried); 429 = rate limited (respects
 *   Retry-After); 5xx/timeout/network = retried with exponential backoff.
 * - The spec declares no signature scheme - secrets never appear in errors
 *   or logs (only storeId + endpoint + platform request id).
 *
 * Plain class (no Nest decorators) so tests can construct it with a stub
 * fetch; the OzonClientFactory wires it to ConfigService at runtime.
 */
export interface OzonClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Minimum spacing between two requests for the same store. */
  readonly perStoreMinIntervalMs: number;
  /** Injectable fetch for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock for deterministic retry tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable now() for rate limiting (tests). */
  readonly now?: () => number;
}

export interface OzonAuth {
  readonly clientId: string;
  readonly apiKey: string;
}

export const OZON_DEFAULT_OPTIONS: Readonly<Omit<OzonClientOptions, 'baseUrl'>> = {
  timeoutMs: 30_000,
  maxRetries: 3,
  perStoreMinIntervalMs: 110,
};

interface RequestCall {
  readonly endpoint: string;
  readonly storeId: string;
  readonly body: Record<string, unknown>;
  /**
   * True for endpoints that may answer with a NON-JSON body (the package
   * label spec declares `application/pdf` while documenting a JSON envelope).
   * The transport then hands back the raw bytes instead of parsing.
   */
  readonly raw?: boolean;
  /**
   * True for endpoints whose 200 response may carry an EMPTY body (the
   * notification set/update/delete endpoints declare no response content).
   * The transport then resolves `{}` instead of failing JSON parsing.
   */
  readonly tolerateEmptyBody?: boolean;
}

/**
 * Raw HTTP outcome for binary-capable endpoints. `text` is the UTF-8 decoding
 * of `bytes` so a JSON-envelope variant can be parsed by the caller without a
 * second read of the response.
 */
export interface OzonRawResponse {
  readonly contentType: string | null;
  readonly bytes: Uint8Array;
  readonly text: string;
}

/** Per-store serialized rate limiting state. */
interface StoreThrottle {
  lastStartedAt: number;
  chain: Promise<void>;
}

export class OzonClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly throttles = new Map<string, StoreThrottle>();

  constructor(private readonly options: OzonClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  // -----------------------------------------------------------------------
  // Endpoints (Sprint 5 read-only surface)
  // -----------------------------------------------------------------------

  /** Light read used for credential validation (task §32). */
  async pingCredential(auth: OzonAuth, storeId: string): Promise<void> {
    await this.request<OzonProductListResponse>(auth, {
      endpoint: '/v3/product/list',
      storeId,
      body: { filter: { visibility: 'ALL' }, last_id: '', limit: 1 },
    });
  }

  async productList(
    auth: OzonAuth,
    storeId: string,
    input: { lastId: string; limit: number },
  ): Promise<OzonProductListResponse> {
    return this.request<OzonProductListResponse>(auth, {
      endpoint: '/v3/product/list',
      storeId,
      body: {
        filter: { visibility: 'ALL' },
        last_id: input.lastId,
        limit: input.limit,
      },
    });
  }

  async productInfoList(
    auth: OzonAuth,
    storeId: string,
    offerIds: readonly string[],
    skuIds?: readonly number[],
  ): Promise<OzonProductInfoListResponse> {
    return this.request<OzonProductInfoListResponse>(auth, {
      endpoint: '/v3/product/info/list',
      storeId,
      body: skuIds === undefined ? { offer_id: [...offerIds] } : { sku: [...skuIds] },
    });
  }

  async fbsPostingList(
    auth: OzonAuth,
    storeId: string,
    input: { since: string; to: string; offset: number; limit: number },
  ): Promise<OzonFbsPostingListResponse> {
    return this.request<OzonFbsPostingListResponse>(auth, {
      endpoint: '/v3/posting/fbs/list',
      storeId,
      body: {
        dir: 'ASC',
        filter: { since: input.since, to: input.to },
        offset: input.offset,
        limit: input.limit,
        with: {},
      },
    });
  }

  async fbsPostingGet(
    auth: OzonAuth,
    storeId: string,
    postingNumber: string,
  ): Promise<OzonFbsPostingGetResponse> {
    return this.request<OzonFbsPostingGetResponse>(auth, {
      endpoint: '/v3/posting/fbs/get',
      storeId,
      body: { posting_number: postingNumber, with: {} },
    });
  }

  /**
   * rFBS return requests (dual-axis T5, verified against the v3 spec
   * 2026-09-15). Cursor = last `return_id` of the previous page; a full page
   * means there may be more (no has_more flag in the response schema).
   */
  async rfbsReturnsList(
    auth: OzonAuth,
    storeId: string,
    input: { lastId: number; limit: number },
  ): Promise<OzonRfbsReturnListResponse> {
    return this.request<OzonRfbsReturnListResponse>(auth, {
      endpoint: '/v2/returns/rfbs/list',
      storeId,
      body: { filter: {}, last_id: input.lastId, limit: input.limit },
    });
  }

  /**
   * Full description-category tree in one shot (Sprint 8.5 T3a). No
   * pagination - the live tree is ~8k nodes in a single response
   * (verified 2026-09-14).
   */
  async descriptionCategoryTree(
    auth: OzonAuth,
    storeId: string,
    language: 'ZH_HANS' | 'RU',
  ): Promise<OzonCategoryTreeResponse> {
    return this.request<OzonCategoryTreeResponse>(auth, {
      endpoint: '/v1/description-category/tree',
      storeId,
      body: { language },
    });
  }

  /**
   * Packed product attributes (Sprint 8.5 T5): dimensions/weight/category
   * per product. filter is REQUIRED by the live API (400 otherwise) and
   * product_id accepts up to 1000 values per call.
   */
  async productAttributes(
    auth: OzonAuth,
    storeId: string,
    productIds: readonly string[],
  ): Promise<OzonProductAttributesResponse> {
    return this.request<OzonProductAttributesResponse>(auth, {
      endpoint: '/v4/product/info/attributes',
      storeId,
      body: { filter: { product_id: [...productIds] }, limit: 1000 },
    });
  }

  /**
   * Seller's own FBS / rFBS warehouses（仓库绑定平台仓库；2026-09-17 live
   * verified）。/v1/warehouse/list 已被平台标记 obsolete，必须用 v2。
   * is_rfbs=true → rFBS（realFBS），false → FBS（发货至 OZON 分拣中心）。
   */
  async sellerWarehouseList(
    auth: OzonAuth,
    storeId: string,
  ): Promise<OzonSellerWarehouseListResponse> {
    return this.request<OzonSellerWarehouseListResponse>(auth, {
      endpoint: '/v2/warehouse/list',
      storeId,
      body: {},
    });
  }

  /** FBP 平台国内合作仓列表（半托管；2026-09-17 live verified）。 */
  async fbpWarehouseList(auth: OzonAuth, storeId: string): Promise<OzonFbpWarehouseListResponse> {
    return this.request<OzonFbpWarehouseListResponse>(auth, {
      endpoint: '/v1/fbp/warehouse/list',
      storeId,
      body: {},
    });
  }

  /** OZON 自有履约仓目录（FBO；按类型过滤，2026-09-17 live verified）。 */
  async ozonWarehouseList(
    auth: OzonAuth,
    storeId: string,
    warehouseTypes: readonly string[],
  ): Promise<OzonOwnWarehouseListResponse> {
    return this.request<OzonOwnWarehouseListResponse>(auth, {
      endpoint: '/v1/warehouse/ozon/list',
      storeId,
      body: { warehouse_types: [...warehouseTypes] },
    });
  }

  // -----------------------------------------------------------------------
  // Outbound shipment operations (order fulfillment flow, 2026-09-18)
  //
  // REAL platform writes. Never invoked from tests against a live account
  // (AGENTS.md §92); the factory refuses to fall back to the real base URL.
  // -----------------------------------------------------------------------

  /**
   * `POST /v4/posting/fbs/ship` - "pack the order" (组包). Moves the posting
   * from awaiting_packaging to awaiting_deliver and is the ONLY seller-facing
   * status write on this path. A 200 does NOT prove assembly: the spec
   * requires re-reading the posting and checking `substatus` (see
   * OzonShipmentService).
   */
  async fbsPostingShip(
    auth: OzonAuth,
    storeId: string,
    input: { postingNumber: string; packages: readonly OzonShipPackage[] },
  ): Promise<OzonFbsShipResponse> {
    return this.request<OzonFbsShipResponse>(auth, {
      endpoint: '/v4/posting/fbs/ship',
      storeId,
      body: { posting_number: input.postingNumber, packages: [...input.packages] },
    });
  }

  /**
   * `POST /v2/posting/fbs/package-label` - generates the shipping label PDF
   * for postings in `awaiting_deliver`. Served as raw bytes: the live body is
   * either the PDF itself or a JSON envelope with base64 `file_content`
   * (the spec contradicts itself), so decoding is the caller's job.
   */
  async packageLabel(
    auth: OzonAuth,
    storeId: string,
    postingNumbers: readonly string[],
  ): Promise<OzonRawResponse> {
    return this.request<OzonRawResponse>(auth, {
      endpoint: '/v2/posting/fbs/package-label',
      storeId,
      body: { posting_number: [...postingNumbers] },
      raw: true,
    });
  }

  // -----------------------------------------------------------------------
  // Push-notification subscription management (/v1/notification/*).
  //
  // REAL platform writes (set/update/delete) - only invoked from the
  // operator-facing subscription endpoints (AGENTS.md §92). Request/response
  // shapes verified against the vendored official spec v2.1
  // (notification.v1.* schemas); set/update/delete declare NO response body.
  // -----------------------------------------------------------------------

  /** List every subscribed URL with its event types (account-wide for the Client-Id). */
  async notificationList(auth: OzonAuth, storeId: string): Promise<OzonNotificationListResponse> {
    return this.request<OzonNotificationListResponse>(auth, {
      endpoint: '/v1/notification/list',
      storeId,
      body: {},
    });
  }

  /** Subscribe a URL to event types (creates a new subscription). */
  async notificationSet(
    auth: OzonAuth,
    storeId: string,
    input: { url: string; types: readonly string[] },
  ): Promise<void> {
    await this.request<Record<string, never>>(auth, {
      endpoint: '/v1/notification/set',
      storeId,
      body: { url: input.url, types: [...input.types] },
      tolerateEmptyBody: true,
    });
  }

  /** Update the event types of an existing subscription (by its id). */
  async notificationUpdate(
    auth: OzonAuth,
    storeId: string,
    input: { id: number; types: readonly string[] },
  ): Promise<void> {
    await this.request<Record<string, never>>(auth, {
      endpoint: '/v1/notification/update',
      storeId,
      body: { id: input.id, types: [...input.types] },
      tolerateEmptyBody: true,
    });
  }

  /** Enable/disable a subscription (e.g. re-enable after the platform's auto-pause). */
  async notificationEnable(
    auth: OzonAuth,
    storeId: string,
    input: { id: number; enabled: boolean },
  ): Promise<void> {
    await this.request<Record<string, never>>(auth, {
      endpoint: '/v1/notification/enable',
      storeId,
      body: { id: input.id, enabled: input.enabled },
      tolerateEmptyBody: true,
    });
  }

  /** Remove a subscribed URL by its id. */
  async notificationDelete(auth: OzonAuth, storeId: string, input: { id: number }): Promise<void> {
    await this.request<Record<string, never>>(auth, {
      endpoint: '/v1/notification/delete',
      storeId,
      body: { id: input.id },
      tolerateEmptyBody: true,
    });
  }

  // -----------------------------------------------------------------------
  // Transport: auth headers + timeout + retry + rate limit + error mapping
  // -----------------------------------------------------------------------

  private async request<TResponse>(auth: OzonAuth, call: RequestCall): Promise<TResponse> {
    let attempt = 0;
    // One extra iteration beyond maxRetries: retries happen inside the loop.
    for (;;) {
      const retryWaitMs = this.throttle(call.storeId);
      if (retryWaitMs > 0) {
        await this.sleep(retryWaitMs);
      }
      const outcome = await this.attemptOnce<TResponse>(auth, call);
      if (outcome.ok) {
        return outcome.value;
      }
      if (!outcome.retryable || attempt >= this.options.maxRetries) {
        throw outcome.error;
      }
      attempt += 1;
      await this.sleep(retryDelayMs(attempt, outcome.retryAfterMs));
    }
  }

  private async attemptOnce<TResponse>(
    auth: OzonAuth,
    call: RequestCall,
  ): Promise<
    | { ok: true; value: TResponse }
    | { ok: false; retryable: boolean; error: PlatformApiError; retryAfterMs: number | null }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl}${call.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Secrets travel ONLY in these headers; never logged (AGENTS.md §29).
          'Client-Id': auth.clientId,
          'Api-Key': auth.apiKey,
        },
        body: JSON.stringify(call.body),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      return {
        ok: false,
        retryable: true,
        retryAfterMs: null,
        error:
          error instanceof Error && error.name === 'AbortError'
            ? this.error(
                call,
                'PLATFORM_TIMEOUT',
                null,
                null,
                `Timeout after ${this.options.timeoutMs}ms`,
              )
            : this.error(call, 'PLATFORM_NETWORK_ERROR', null, null, networkMessage(error)),
      };
    } finally {
      clearTimeout(timer);
    }

    // Real API (verified 2026-09-09) sends `x-o3-trace-id`; older gateways /
    // the spec mention `x-request-id` / `req-id`. Keep all three, real first.
    const requestId =
      response.headers.get('x-o3-trace-id') ??
      response.headers.get('x-request-id') ??
      response.headers.get('req-id');

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: this.error(
          call,
          'PLATFORM_AUTH_ERROR',
          response.status,
          requestId,
          await safeErrorMessage(response),
        ),
      };
    }
    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
      return {
        ok: false,
        retryable: true,
        retryAfterMs,
        error: this.error(call, 'PLATFORM_RATE_LIMITED', 429, requestId, 'Rate limited by OZON', {
          retryAfterMs,
        }),
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        retryable: true,
        retryAfterMs: null,
        error: this.error(
          call,
          'PLATFORM_API_ERROR',
          response.status,
          requestId,
          await safeErrorMessage(response),
        ),
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: this.error(
          call,
          'PLATFORM_API_ERROR',
          response.status,
          requestId,
          await safeErrorMessage(response),
        ),
      };
    }

    if (call.raw === true) {
      let buffer: ArrayBuffer;
      try {
        buffer = await response.arrayBuffer();
      } catch (error: unknown) {
        return {
          ok: false,
          retryable: false,
          retryAfterMs: null,
          error: new PlatformMalformedResponseError({
            httpStatus: response.status,
            requestId,
            endpoint: call.endpoint,
            storeId: call.storeId,
            message: `Response body could not be read (${String(error)})`,
          }),
        };
      }
      const bytes = new Uint8Array(buffer);
      return {
        ok: true,
        value: {
          contentType: response.headers.get('content-type'),
          bytes,
          // Tolerant by construction: a binary body decodes to replacement
          // characters, which the caller ignores unless the type says JSON.
          text: new TextDecoder().decode(bytes),
        } as TResponse,
      };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error: unknown) {
      if (call.tolerateEmptyBody === true) {
        // Documented no-content 200 (notification set/update/delete): the
        // platform-side effect already happened; an empty body is success.
        return { ok: true, value: {} as TResponse };
      }
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: new PlatformMalformedResponseError({
          httpStatus: response.status,
          requestId,
          endpoint: call.endpoint,
          storeId: call.storeId,
          message: `Response body is not JSON (${String(error)})`,
        }),
      };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      if (call.tolerateEmptyBody === true) {
        return { ok: true, value: {} as TResponse };
      }
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: new PlatformMalformedResponseError({
          httpStatus: response.status,
          requestId,
          endpoint: call.endpoint,
          storeId: call.storeId,
          message: 'Response body is not a JSON object',
        }),
      };
    }
    return { ok: true, value: parsed as TResponse };
  }

  /**
   * Per-store request spacing (task §41): stores never share a throttle, so
   * one store hitting its limit cannot slow another. Returns the ms the
   * caller must wait before dispatching.
   */
  private throttle(storeId: string): number {
    const interval = this.options.perStoreMinIntervalMs;
    if (interval <= 0) {
      return 0;
    }
    const now = this.now();
    const existing = this.throttles.get(storeId);
    if (existing === undefined) {
      this.throttles.set(storeId, { lastStartedAt: now, chain: Promise.resolve() });
      return 0;
    }
    const elapsed = now - existing.lastStartedAt;
    const waitMs = elapsed >= interval ? 0 : interval - elapsed;
    this.throttles.set(storeId, {
      lastStartedAt: now + waitMs,
      chain: existing.chain,
    });
    return waitMs;
  }

  private error(
    call: RequestCall,
    code: PlatformErrorDetail['code'],
    httpStatus: number | null,
    requestId: string | null,
    message: string,
    details?: Record<string, unknown>,
  ): PlatformApiError {
    return new PlatformApiError({
      code,
      httpStatus,
      requestId,
      endpoint: call.endpoint,
      storeId: call.storeId,
      message,
      details,
    });
  }
}

/** Parses OZON error bodies without ever echoing request headers. */
async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as OzonErrorBody;
    if (typeof body?.message === 'string' && body.message !== '') {
      return `OZON error${typeof body.code === 'number' ? ` ${body.code}` : ''}: ${body.message}`;
    }
  } catch {
    // fall through to the generic message
  }
  return `OZON responded HTTP ${response.status}`;
}

function networkMessage(error: unknown): string {
  return `Network failure calling OZON: ${error instanceof Error ? error.message : String(error)}`;
}

function parseRetryAfterMs(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

/** Exponential backoff with the Retry-After override (task §40). */
function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, 60_000);
  }
  const base = Math.min(500 * 2 ** (attempt - 1), 15_000);
  return base;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
