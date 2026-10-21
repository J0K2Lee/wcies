import { DomainError } from '../../common/errors/domain.error';
import { PlatformErrorDetail } from '@wcies/platform-contracts';

/**
 * Normalized platform failure (Sprint 5 task §39/§50).
 *
 * Thrown by platform clients/adapters and persisted (secret-free) on sync
 * jobs. `code` is one of the PLATFORM_* categories; `details` carries HTTP
 * status, platform request id and endpoint name - never credentials.
 */
export class PlatformApiError extends DomainError {
  readonly code: string;
  readonly httpStatus: number;

  constructor(readonly platformError: PlatformErrorDetail) {
    super(platformError.message, {
      httpStatus: platformError.httpStatus ?? null,
      requestId: platformError.requestId ?? null,
      endpoint: platformError.endpoint,
      storeId: platformError.storeId,
      ...platformError.details,
    });
    this.code = platformError.code;
    // HTTP 502: an upstream platform failure is not this API's client's fault.
    this.httpStatus = 502;
  }
}

/** Thrown when a platform response does not match the verified schema. */
export class PlatformMalformedResponseError extends PlatformApiError {
  constructor(detail: Omit<PlatformErrorDetail, 'code'>) {
    super({ ...detail, code: 'PLATFORM_BAD_RESPONSE' });
  }
}

/**
 * A batched platform read returned something that cannot be attributed to the
 * requested items - e.g. OZON returns ONE combined label PDF for several
 * postings and the page count does not match the posting count.
 *
 * NOT a business failure: the caller must fall back to per-item reads. A plain
 * Error on purpose - it never surfaces to the operator and must not reach the
 * exception center.
 */
export class PlatformBatchShapeError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PlatformBatchShapeError';
  }
}
