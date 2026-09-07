import { DomainError } from '../../../common/errors/domain.error';

export class SkuNotFoundError extends DomainError {
  readonly code = 'SKU_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`SKU not found: ${id}`, { id });
  }
}

export class SkuCodeAlreadyExistsError extends DomainError {
  readonly code = 'SKU_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(skuCode: string) {
    super(`SKU code already exists: ${skuCode}`, { skuCode });
  }
}

/** Dimensions must be provided all-or-none so volume is always computable. */
export class SkuDimensionsInvalidError extends DomainError {
  readonly code = 'SKU_DIMENSIONS_INVALID';
  readonly httpStatus = 422;

  constructor() {
    super('length, width and height must be provided together');
  }
}
