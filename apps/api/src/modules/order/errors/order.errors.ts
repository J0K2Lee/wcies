import { DomainError } from '../../../common/errors/domain.error';

export class OrderNotFoundError extends DomainError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('订单不存在', { id });
  }
}

export class OrderItemNotFoundError extends DomainError {
  readonly code = 'ORDER_ITEM_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super('订单行不存在', { id });
  }
}

/**
 * The order cannot move to the requested state (task §26 exception type
 * ORDER_INVALID_STATE also lands in the exception center for the
 * cancel-during-picking case).
 */
export class OrderInvalidStateError extends DomainError {
  readonly code = 'ORDER_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** Ingestion-level input problems that cannot be attributed to one line. */
export class OrderIngestInvalidError extends DomainError {
  readonly code = 'ORDER_INGEST_INVALID';
  readonly httpStatus = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
