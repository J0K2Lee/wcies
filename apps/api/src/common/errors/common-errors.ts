import { DomainError } from './domain.error';

/** Fallback for unclassified internal failures. Never leaks internals to clients. */
export class InternalDomainError extends DomainError {
  readonly code = 'COMMON_INTERNAL_ERROR';
  readonly httpStatus = 500;

  constructor(message = 'Internal server error', details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Database failure - real driver error is logged server-side, never returned. */
export class DatabaseDomainError extends DomainError {
  readonly code = 'COMMON_DATABASE_ERROR';
  readonly httpStatus = 500;

  constructor(message = 'Database error', details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Readiness probe failure - one or more dependencies are down. */
export class ServiceUnavailableError extends DomainError {
  readonly code = 'COMMON_SERVICE_UNAVAILABLE';
  readonly httpStatus = 503;

  constructor(message = 'Service unavailable', details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
