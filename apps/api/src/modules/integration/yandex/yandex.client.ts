import { PlatformErrorDetail } from '@wcies/platform-contracts';
import { PlatformApiError, PlatformMalformedResponseError } from '../platform-error';
import {
  YxCampaignsResponse,
  YxErrorBody,
  YxOfferMappingsResponse,
  YxOrdersResponse,
  YxReturnsResponse,
  YxWarehousesResponse,
} from './types/api.types';

/**
 * Yandex Market Partner API client (read-first scope, 2026-09-18).
 *
 * Responsibilities ONLY: HTTP transport, authentication header, timeout,
 * retry of safely-retryable failures, concurrency/rate limiting and error
 * normalization. No business logic, no mapping.
 *
 * Verified facts (docs/integrations/yandex.md):
 * - Base URL https://api.partner.market.yandex.ru; auth header `Api-Key`.
 * - Global concurrency cap: 4 simultaneous requests (metered per business /
 *   campaign) - enforced with a process-wide semaphore, conservative across
 *   businesses. Per-store request spacing applies ON TOP of it.
 * - Rate limiting answers HTTP 420 Enhance Your Calm (NOT 429); response
 *   header X-RateLimit-Resource-Until carries the epoch-second reset.
 * - 401/403 = credential error (never retried); 5xx/timeout/network retried
 *   with exponential backoff; request bodies cap at 512 KB.
 * - Error envelope: { status: 'OK'|'ERROR', errors: [{code, message}] }.
 *
 * Plain class (no Nest decorators) so tests construct it with a stub fetch;
 * the YandexClientFactory wires it to ConfigService at runtime.
 */

export interface YandexClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  /** Minimum spacing between two requests for the same store. */
  readonly perStoreMinIntervalMs: number;
  /** Global simultaneous-request cap (platform contract: 4). */
  readonly maxConcurrency: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

export interface YxAuth {
  readonly apiKey: string;
}

export const YANDEX_DEFAULT_OPTIONS: Readonly<
  Omit<YandexClientOptions, 'baseUrl' | 'fetchImpl' | 'sleep' | 'now'>
> = {
  timeoutMs: 30_000,
  maxRetries: 3,
  perStoreMinIntervalMs: 110,
  maxConcurrency: 4,
};

interface RequestCall {
  readonly endpoint: string;
  readonly storeId: string;
  readonly method: 'GET' | 'POST';
  readonly query?: Record<string, string | number | undefined>;
  readonly body?: Record<string, unknown>;
}

/** Per-store serialized rate limiting state. */
interface StoreThrottle {
  readonly availableAt: number;
}

export class YandexClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly throttles = new Map<string, StoreThrottle>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly options: YandexClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  // -----------------------------------------------------------------------
  // Endpoints (read-only surface)
  // -----------------------------------------------------------------------

  /** Campaigns the token can access - credential validation + identity. */
  async campaigns(auth: YxAuth, storeId: string, pageToken?: string): Promise<YxCampaignsResponse> {
    return this.request<YxCampaignsResponse>(auth, {
      endpoint: '/v2/campaigns',
      storeId,
      method: 'GET',
      query: pageToken === undefined ? {} : { page_token: pageToken },
    });
  }

  /** Offer-mappings page (listings; docs §5). */
  async offerMappings(
    auth: YxAuth,
    storeId: string,
    input: { businessId: string; limit: number; pageToken?: string },
  ): Promise<YxOfferMappingsResponse> {
    return this.request<YxOfferMappingsResponse>(auth, {
      endpoint: `/v2/businesses/${encodeURIComponent(input.businessId)}/offer-mappings`,
      storeId,
      method: 'POST',
      query: { limit: input.limit, ...(input.pageToken ? { page_token: input.pageToken } : {}) },
      body: {},
    });
  }

  /** Business-level orders (docs §3): window filters / targeted ids in body. */
  async businessOrders(
    auth: YxAuth,
    storeId: string,
    input: { businessId: string; limit: number; pageToken?: string; body: Record<string, unknown> },
  ): Promise<YxOrdersResponse> {
    return this.request<YxOrdersResponse>(auth, {
      endpoint: `/v1/businesses/${encodeURIComponent(input.businessId)}/orders`,
      storeId,
      method: 'POST',
      query: { limit: input.limit, ...(input.pageToken ? { page_token: input.pageToken } : {}) },
      body: input.body,
    });
  }

  /** Campaign return records (docs §6): pageToken walk, limit <= 100. */
  async campaignReturns(
    auth: YxAuth,
    storeId: string,
    input: { campaignId: string; limit: number; pageToken?: string },
  ): Promise<YxReturnsResponse> {
    return this.request<YxReturnsResponse>(auth, {
      endpoint: `/v2/campaigns/${encodeURIComponent(input.campaignId)}/returns`,
      storeId,
      method: 'GET',
      query: { limit: input.limit, ...(input.pageToken ? { page_token: input.pageToken } : {}) },
    });
  }

  /** Seller-side FBS/DBS warehouses (docs §6; FBY platform warehouses are
   * NOT part of this response - a documented data-source gap). */
  async businessWarehouses(
    auth: YxAuth,
    storeId: string,
    input: { businessId: string },
  ): Promise<YxWarehousesResponse> {
    return this.request<YxWarehousesResponse>(auth, {
      endpoint: `/v2/businesses/${encodeURIComponent(input.businessId)}/warehouses`,
      storeId,
      method: 'GET',
    });
  }

  // -----------------------------------------------------------------------
  // Transport: auth header + timeout + retry + concurrency + error mapping
  // -----------------------------------------------------------------------

  private async request<TResponse>(auth: YxAuth, call: RequestCall): Promise<TResponse> {
    let attempt = 0;
    // One extra iteration beyond maxRetries: retries happen inside the loop.
    for (;;) {
      const retryWaitMs = this.throttle(call.storeId);
      if (retryWaitMs > 0) {
        await this.sleep(retryWaitMs);
      }
      await this.acquire();
      const outcome = await this.attemptOnce<TResponse>(auth, call).finally(() => this.release());
      if (outcome.ok) {
        return outcome.value;
      }
      if (!outcome.retryable || attempt >= this.options.maxRetries) {
        throw outcome.error;
      }
      const retryAfterMs = outcome.retryAfterMs;
      attempt += 1;
      await this.sleep(retryDelayMs(attempt, retryAfterMs));
    }
  }

  private async attemptOnce<TResponse>(
    auth: YxAuth,
    call: RequestCall,
  ): Promise<
    | { ok: true; value: TResponse }
    | { ok: false; retryable: boolean; error: PlatformApiError; retryAfterMs: number | null }
  > {
    const url = `${this.options.baseUrl}${call.endpoint}${toQueryString(call.query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: call.method,
        headers: {
          Accept: 'application/json',
          // Secrets travel ONLY in this header; never logged (AGENTS.md §29).
          'Api-Key': auth.apiKey,
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
      return {
        ok: false,
        retryable: false,
        retryAfterMs: null,
        error: this.error(
          call,
          'PLATFORM_AUTH_ERROR',
          response.status,
          null,
          await safeErrorMessage(response),
        ),
      };
    }
    // Yandex rate limiting answers 420 Enhance Your Calm - NOT 429 (docs §2).
    if (response.status === 420 || response.status === 429) {
      const retryAfterMs = parseRateLimitUntilMs(response.headers, this.now());
      return {
        ok: false,
        retryable: true,
        retryAfterMs,
        error: this.error(
          call,
          'PLATFORM_RATE_LIMITED',
          response.status,
          null,
          'Rate limited by Yandex Market',
          { retryAfterMs },
        ),
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
          null,
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
    return { ok: true, value: parsed as TResponse };
  }

  /**
   * Process-wide concurrency cap (platform contract: 4 simultaneous
   * requests). Handoff-based release keeps the cap exact even with queued
   * waiters. Per-store spacing (below) applies on top of this gate.
   */
  private async acquire(): Promise<void> {
    if (this.active < this.options.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      next(); // slot handed off directly - no decrement
      return;
    }
    this.active -= 1;
  }

  /** Per-store request spacing; stores never share a throttle. */
  private throttle(storeId: string): number {
    const interval = this.options.perStoreMinIntervalMs;
    const now = this.now();
    const existing = this.throttles.get(storeId);
    const waitMs = existing === undefined ? 0 : Math.max(0, existing.availableAt - now);
    const dispatchAt = now + waitMs;
    this.throttles.set(storeId, {
      availableAt: interval > 0 ? dispatchAt + interval : dispatchAt,
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

function toQueryString(query: Record<string, string | number | undefined> | undefined): string {
  if (query === undefined) {
    return '';
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/** Parses the Yandex error envelope without ever echoing headers. */
async function safeErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as YxErrorBody;
    const first = body.errors?.[0];
    if (first !== undefined) {
      const code = typeof first.code === 'string' ? first.code : '?';
      const message = typeof first.message === 'string' ? first.message : '';
      return `Yandex error (HTTP ${response.status}) ${code}: ${message}`;
    }
  } catch {
    // fall through to the generic message
  }
  return `Yandex Market responded HTTP ${response.status}`;
}

function networkMessage(error: unknown): string {
  return `Network failure calling Yandex Market: ${error instanceof Error ? error.message : String(error)}`;
}

/** X-RateLimit-Resource-Until: epoch seconds of the budget reset. */
function parseRateLimitUntilMs(headers: Headers, now: number): number | null {
  const until = headers.get('x-ratelimit-resource-until');
  if (until === null) {
    return null;
  }
  const seconds = Number(until);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.min(Math.max(0, seconds * 1000 - now), 300_000);
}

/** Exponential backoff with the rate-limit reset override. */
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
