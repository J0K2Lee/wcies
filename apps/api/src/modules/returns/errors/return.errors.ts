import { DomainError } from '../../../common/errors/domain.error';

/** Return-domain errors (dual-axis T5, returns.md). Stable codes. */

export class ReturnBatchNotFoundError extends DomainError {
  readonly code = 'RETURN_BATCH_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(batchId: string) {
    super(`退货批次不存在：${batchId}`, { batchId });
  }
}

export class ReturnBatchInvalidStateError extends DomainError {
  readonly code = 'RETURN_BATCH_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class ReturnItemInvalidConditionError extends DomainError {
  readonly code = 'RETURN_ITEM_INVALID_CONDITION';
  readonly httpStatus = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

export class ReturnBinNotFoundError extends DomainError {
  readonly code = 'RETURN_BIN_NOT_FOUND';
  readonly httpStatus = 409;

  constructor(details: Record<string, unknown>) {
    super('目标库位不存在或不属于该退货仓库', details);
  }
}
