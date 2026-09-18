import { PlatformErrorDetail } from '@wcies/platform-contracts';
import { PlatformApiError, PlatformMalformedResponseError } from '../platform-error';
import {
  WbCardsListRequest,
  WbCardsListResponse,
  WbSellerInfoResponse,
  WbStatsOrderRow,
  WbV3OrdersResponse,
  WbWebhookCreateResponse,
  WbWebhookResource,
  extractWebhookRows,
  extractStatsRows,
} from './types/api.types';

/**
 * Wildberries Seller API client (read-first scope, 2026-09-18).
 *
 * Responsibilities ONLY: HTTP transport, authentication header, timeout,
 * retry of safely-retryable failures, per-store/per-domain rate limiting and
 * error normalization. No business logic, no mapping.
 *
 * Verified facts (docs/integrations/wildberries.md):
 * - WB splits its API across module domains (common / content / marketplace /
 *   statistics) - one base URL per domain, unlike OZON's single host.
 * - Auth header `Authorization: <token>` (no Client-Id, no Bearer prefix).
 * - 401/403 = credential error (never retried); 429 = rate limited, honors
 *   `X-Ratelimit-Retry` (milliseconds); 5xx/timeout/network = retried with
 *   exponential backoff.
 * - The CONTENT domain returns HTTP 200 with `{error: true, errorText}` on
 *   business errors - unwrapped here into PLATFORM_API_ERROR.
 * - The MARKETPLACE module bills every 4XX as 10 requests against the
 *   300/min budget - after a marketplace 4XX the store's marketplace lane
 *   cools down `marketplace4xxPenaltyMs` before the next call.
 * - STATISTICS allows 1 req/min (Personal/Service tokens) - its per-store
 *   floor defaults to 61s, far above the other domains.
 *
 * Plain class (no Nest decorators) so tests construct it with a stub fetch;
 * the WbClientFactory wires it to ConfigService at runtime.
 */

/** WB module domains with distinct hosts and rate budgets. */
export type WbDomain = 'common' | 'content' | 'marketplace' | 'statistics' | 'webhooks';

export interface WbClientOptions {
  readonly baseUrls: Readonly<Record<WbDomain, string>>;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Minimum spacing between two requests of one store in most domains. */
  readonly perStoreMinIntervalMs: number;
  /** Statistics-domain floor - the endpoint allows 1 req/min (docs §2). */
  readonly statisticsMinIntervalMs: number;
  /**
   * Webhook-API floor - 1 req/sec per seller across ALL webhook methods
   * (docs §Limits); shared per store like the other lanes.
   */
  readonly webhooksMinIntervalMs: number;
  /** Marketplace cool-down after a 4XX (billed x10 against the budget). */
  readonly marketplace4xxPenaltyMs: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface WbAuth {
  readonly apiKey: string;
}

/**
 * Webhook-API auth: the seller token PLUS the WCIES service secret from the
 * Solutions Catalog registration (docs §Access) - `X-Client-Secret` header.
 */
export interface WbWebhookAuth extends WbAuth {
  readonly serviceSecret: string;
}

export const WB_DEFAULT_OPTIONS: Readonly<
  Omit<WbClientOptions, 'baseUrls' | 'fetchImpl' | 'sleep' | 'now'>
> = {
  timeoutMs: 30_000,
  maxRetries: 3,
  perStoreMinIntervalMs: 110,
  statisticsMinIntervalMs: 61_000,
  webhooksMinIntervalMs: 1_100,
  marketplace4xxPenaltyMs: 2_000,
};

export const WB_DEFAULT_BASE_URLS: Readonly<Record<WbDomain, string>> = {
  common: 'https://common-api.wildberries.ru',
  content: 'https://content-api.wildberries.ru',
  marketplace: 'https://marketplace-api.wildberries.ru',
  statistics: 'https://statistics-api.wildberries.ru',
  webhooks: 'https://webhooks-api.wildberries.ru',
};

interface RequestCall {
  readonly domain: WbDomain;
  readonly endpoint: string;
  readonly storeId: string;
  readonly method: 'GET' | 'POST' | 'DELETE';
  /** GET/DELETE: query params; POST: JSON body. */
  readonly query?: Record<string, string | number>;
  readonly body?: Record<string, unknown>;
}

/** Per-store, per-domain serialized rate limiting state. */
interface LaneThrottle {
  /** Earliest dispatch time the lane accepts (ms epoch). */
  availableAt: number;
}

export class WbClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly lanes = new Map<string, LaneThrottle>();

  constructor(private readonly options: WbClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  // -----------------------------------------------------------------------
  // Endpoints (read-only surface)
  // -----------------------------------------------------------------------

  /** Credential validation (docs §1): common-domain light read, 1 req/min. */
  async sellerInfo(auth: WbAuth, storeId: string): Promise<WbSellerInfoResponse> {
    return this.request<WbSellerInfoResponse>(auth, {
      domain: 'common',
      endpoint: '/api/v1/seller-info',
      storeId,
      method: 'GET',
    });
  }

  /** Listing cards page (docs §4): POST body cursor pagination. */
  async cardsList(
    auth: WbAuth,
    storeId: string,
    body: WbCardsListRequest,
  ): Promise<WbCardsListResponse> {
    return this.request<WbCardsListResponse>(auth, {
      domain: 'content',
      endpoint: '/content/v2/get/cards/list',
      storeId,
      method: 'POST',
      body: body as unknown as Record<string, unknown>,
    });
  }

  /** FBS/DBS assembly-task orders (docs §3a): GET with `next` cursor. */
  async fbsOrders(
    auth: WbAuth,
    storeId: string,
    query: { dateFrom: number; dateTo: number; next: number; limit: number },
  ): Promise<WbV3OrdersResponse> {
    return this.request<WbV3OrdersResponse>(auth, {
      domain: 'marketplace',
      endpoint: '/api/v3/orders',
      storeId,
      method: 'GET',
      query,
    });
  }

  /** DBW buyout report rows (docs §3b): GET, 1 req/min, single-sided cursor. */
  async supplierOrders(
    auth: WbAuth,
    storeId: string,
    query: { dateFrom: string; flag: 0 | 1 },
  ): Promise<readonly WbStatsOrderRow[]> {
    const body = await this.request<unknown>(auth, {
      domain: 'statistics',
      endpoint: '/api/v1/supplier/orders',
      storeId,
      method: 'GET',
      query,
    });
    return extractStatsRows(body);
  }

  // -----------------------------------------------------------------------
  // Webhook management API (webhooks-api domain, docs verified 2026-09-18)
  // -----------------------------------------------------------------------

  /**
   * Creates a webhook subscription (docs §How to create). The response's
   * webhook secret is shown ONLY here - the caller must persist it at once.
   */
  async createWebhook(
    auth: WbWebhookAuth,
    storeId: string,
    body: {
      readonly enabled: boolean;
      readonly url: string;
      readonly name: string;
      readonly subscriptions: readonly { scope: string; event: string }[];
    },
  ): Promise<WbWebhookCreateResponse> {
    return this.request<WbWebhookCreateResponse>(auth, {
      domain: 'webhooks',
      endpoint: '/api/v1/webhooks',
      storeId,
      method: 'POST',
      body: { ...body, subscriptions: body.subscriptions.map((row) => ({ ...row })) },
    });
  }

  /** All webhooks of the seller (docs §Managing). */
  async listWebhooks(auth: WbWebhookAuth, storeId: string): Promise<readonly WbWebhookResource[]> {
    const body = await this.request<unknown>(auth, {
      domain: 'webhooks',
      endpoint: '/api/v1/webhooks',
      storeId,
      method: 'GET',
    });
    return extractWebhookRows(body);
  }

  /** Deletes a webhook (docs §Managing). Any 2xx (incl. empty body) counts. */
  async deleteWebhook(auth: WbWebhookAuth, storeId: string, id: string): Promise<void> {
    await this.request<Record<string, never>>(auth, {
      domain: 'webhooks',
      endpoint: `/api/v1/webhooks/${encodeURIComponent(id)}`,
      storeId,
      method: 'DELETE',
    });
  }

  /** URL reachability probe (docs §Testing). */
  async checkWebhookUrl(
    auth: WbWebhookAuth,
    storeId: string,
    url: string,
  ): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>(auth, {
      domain: 'webhooks',
      endpoint: '/api/v1/webhooks/check',
      storeId,
      method: 'POST',
      body: { url },
    });
  }

  /** Sends a `test: true` event through the webhook (docs §Testing). */
  async sendTestEvent(auth: WbWebhookAuth, storeId: string, id: string): Promise<void> {
    await this.request<Record<string, never>>(auth, {
      domain: 'webhooks',
      endpoint: `/api/v1/webhooks/${encodeURIComponent(id)}/test/send`,
      storeId,
      method: 'POST',
    });
  }

  // -----------------------------------------------------------------------
  // Transport: auth header + timeout + retry + rate limit + error mapping
  // -----------------------------------------------------------------------

  private async request<TResponse>(auth: WbAuth, call: RequestCall): Promise<TResponse> {
    let attempt = 0;
    // One extra iteration beyond maxRetries: retries happen inside the loop.
    for (;;) {
      const retryWaitMs = this.throttle(call);
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
    auth: WbAuth,
    call: RequestCall,
  ): Promise<
    | { ok: true; value: TResponse }
    | { ok: false; retryable: boolean; error: PlatformApiError; retryAfterMs: number | null }
  > {
    const url = `${this.options.baseUrls[call.domain]}${call.endpoint}${toQueryString(call.query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: call.method,
        headers: {
          Accept: 'application/json',
          // Secrets travel ONLY in these headers; never logged (AGENTS.md §29).
          Authorization: auth.apiKey,
          ...(typeof (auth as WbWebhookAuth).serviceSecret === 'string'
            ? { 'X-Client-Secret': (auth as WbWebhookAuth).serviceSecret }
            : {}),
          ...(call.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
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

    if (response.status === 401 || response.status === 403) {
      if (call.domain === 'marketplace') {
        this.chargeMarketplace4xx(call.storeId);
      }
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: this.error(
          call,
          'PLATFORM_AUTH_ERROR',
          response.status,
          null,
          await safeErrorMessage(response, call.domain),
        ),
      };
    }
    if (response.status === 429) {
      const retryAfterMs = parseWbRetryAfterMs(response.headers);
      return {
        ok: false,
        retryable: true,
        retryAfterMs,
        error: this.error(call, 'PLATFORM_RATE_LIMITED', 429, null, 'Rate limited by WB', {
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
          null,
          await safeErrorMessage(response, call.domain),
        ),
      };
    }
    if (!response.ok) {
      // Marketplace 4XX burns 10x budget (docs §1) - cool the lane down.
      if (call.domain === 'marketplace') {
        this.chargeMarketplace4xx(call.storeId);
      }
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: this.error(
          call,
          'PLATFORM_API_ERROR',
          response.status,
          null,
          await safeErrorMessage(response, call.domain),
        ),
      };
    }

    let parsed: unknown;
    try {
      // DELETE (and some admin calls) may answer 2xx with an empty body -
      // treat it as a success object instead of a malformed response.
      const text = await response.text();
      if (text.trim() === '') {
        return { ok: true, value: {} as TResponse };
      }
      parsed = JSON.parse(text) as unknown;
    } catch (error: unknown) {
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: new PlatformMalformedResponseError({
          httpStatus: response.status,
          requestId: null,
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
          requestId: null,
          endpoint: call.endpoint,
          storeId: call.storeId,
          message: 'Response body is not a JSON object',
        }),
      };
    }
    // Content domain: a business error hides inside HTTP 200 (docs §4) -
    // `{error: true, errorText}` must surface as a platform failure.
    if (call.domain === 'content') {
      const envelope = parsed as { error?: unknown; errorText?: unknown };
      if (envelope.error === true) {
        const text = typeof envelope.errorText === 'string' ? envelope.errorText : '(no errorText)';
        return {
          ok: false,
          retryable: false,
          retryAfterMs: null,
          error: this.error(call, 'PLATFORM_API_ERROR', response.status, null, `WB error: ${text}`),
        };
      }
    }
    return { ok: true, value: parsed as TResponse };
  }

  /**
   * Per-store, per-domain request spacing. Statistics lives on 1 req/min and
   * the webhook API on 1 req/sec per seller, so those lanes use their own
   * floors; a marketplace 4XX pushes that lane's availability forward by the
   * penalty (budget x10, docs §1). Returns the ms the caller must wait.
   */
  private throttle(call: RequestCall): number {
    const key = `${call.storeId}:${call.domain}`;
    const interval =
      call.domain === 'statistics'
        ? this.options.statisticsMinIntervalMs
        : call.domain === 'webhooks'
          ? this.options.webhooksMinIntervalMs
          : this.options.perStoreMinIntervalMs;
    const now = this.now();
    const existing = this.lanes.get(key);
    const waitMs = existing === undefined ? 0 : Math.max(0, existing.availableAt - now);
    const dispatchAt = now + waitMs;
    this.lanes.set(key, {
      availableAt: interval > 0 ? dispatchAt + interval : dispatchAt,
    });
    return waitMs;
  }

  private chargeMarketplace4xx(storeId: string): void {
    const penalty = this.options.marketplace4xxPenaltyMs;
    if (penalty <= 0) {
      return;
    }
    const key = `${storeId}:marketplace`;
    const existing = this.lanes.get(key);
    const notBefore = this.now() + penalty;
    this.lanes.set(key, {
      availableAt: existing === undefined ? notBefore : Math.max(existing.availableAt, notBefore),
    });
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
      endpoint: `${call.domain}${call.endpoint}`,
      storeId: call.storeId,
      message,
      details,
    });
  }
}

function toQueryString(query: Record<string, string | number> | undefined): string {
  if (query === undefined) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/** Parses WB error bodies without ever echoing request headers. */
async function safeErrorMessage(response: Response, domain: WbDomain): Promise<string> {
  let raw = '';
  try {
    raw = await response.text();
    const body = JSON.parse(raw) as {
      message?: unknown;
      errorText?: unknown;
      detail?: unknown;
    };
    for (const candidate of [body.message, body.errorText, body.detail]) {
      if (typeof candidate === 'string' && candidate !== '') {
        return `WB ${domain} error (HTTP ${response.status}): ${candidate.slice(0, 300)}`;
      }
    }
  } catch {
    // Plain-text bodies exist (e.g. Go decoder 400s, T0 2026-09-18) - surface
    // a trimmed slice; bodies never contain credentials (those are headers).
    if (raw.trim() !== '') {
      return `WB ${domain} error (HTTP ${response.status}): ${raw.slice(0, 300)}`;
    }
  }
  return `WB ${domain} responded HTTP ${response.status}`;
}

function networkMessage(error: unknown): string {
  return `Network failure calling WB: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * WB sends `X-Ratelimit-Retry` in milliseconds (docs §1); `Retry-After`
 * (seconds) is kept as a generic fallback. Both unit interpretations are
 * documented for T0 calibration.
 */
function parseWbRetryAfterMs(headers: Headers): number | null {
  const wbRetry = headers.get('x-ratelimit-retry') ?? headers.get('x-ratelimit-retry-after');
  if (wbRetry !== null) {
    const ms = Number(wbRetry);
    if (Number.isFinite(ms) && ms >= 0) {
      return Math.min(ms, 300_000);
    }
    return null;
  }
  const retryAfter = headers.get('retry-after');
  if (retryAfter === null) {
    return null;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 300_000);
  }
  return null;
}

/** Exponential backoff with the rate-limit header override. */
function retryDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null && retryAfterMs > 0) {
    return Math.min(retryAfterMs, 60_000);
  }
  return Math.min(500 * 2 ** (attempt - 1), 15_000);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
