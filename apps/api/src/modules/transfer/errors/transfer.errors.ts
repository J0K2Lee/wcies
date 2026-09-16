import { DomainError } from '../../../common/errors/domain.error';

/** Transfer module domain errors (transfer.md; codes are stable API facts). */

export class TransferOrderNotFoundError extends DomainError {
  readonly code = 'TRANSFER_ORDER_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(transferId: string) {
    super('调拨单不存在', { transferId });
  }
}

export class TransferOrderInvalidStateError extends DomainError {
  readonly code = 'TRANSFER_ORDER_INVALID_STATE';
  readonly httpStatus = 409;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class TransferOrderInvalidError extends DomainError {
  readonly code = 'TRANSFER_ORDER_INVALID';
  readonly httpStatus = 422;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}
