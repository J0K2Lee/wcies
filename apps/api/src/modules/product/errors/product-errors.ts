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
