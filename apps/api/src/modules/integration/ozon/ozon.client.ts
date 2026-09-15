import {
  OzonCategoryTreeResponse,
  OzonErrorBody,
  OzonFbsPostingGetResponse,
  OzonFbsPostingListResponse,
  OzonProductAttributesResponse,
  OzonProductInfoListResponse,
  OzonProductListResponse,
  OzonRfbsReturnListResponse,
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
  ): Promise<OzonProductInfoListResponse> {
    return this.request<OzonProductInfoListResponse>(auth, {
      endpoint: '/v3/product/info/list',
      storeId,
      body: { offer_id: [...offerIds] },
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

    let parsed: unknown;
    try {
      parsed = await response.json();
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
          message: `Response body is not JSON (${String(error)})`,
        }),
      };
    }
    if (typeof parsed !== 'object' || parsed === null) {
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
