import { DomainError } from '../../../common/errors/domain.error';

export class ProductNotFoundError extends DomainError {
  readonly code = 'PRODUCT_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Product not found: ${id}`, { id });
  }
}

export class ProductCodeAlreadyExistsError extends DomainError {
  readonly code = 'PRODUCT_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(productCode: string) {
    super(`Product code already exists: ${productCode}`, { productCode });
  }
}

export class ProductStatusInvalidError extends DomainError {
  readonly code = 'PRODUCT_STATUS_INVALID';
  readonly httpStatus = 409;

  constructor(message: string) {
    super(message);
  }
}

/** Zero-reference delete policy (Sprint 6 decision 0003): still referenced. */
export class ProductInUseError extends DomainError {
  readonly code = 'PRODUCT_IN_USE';
  readonly httpStatus = 409;

  constructor(sources: string[]) {
    super(`该记录已被引用（${sources.join('、')}），只能停用不能删除`, { sources });
  }
}
