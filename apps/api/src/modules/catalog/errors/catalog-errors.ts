import { DomainError } from '../../../common/errors/domain.error';

export class BrandNotFoundError extends DomainError {
  readonly code = 'BRAND_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Brand not found: ${id}`, { id });
  }
}

export class BrandCodeAlreadyExistsError extends DomainError {
  readonly code = 'BRAND_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(code: string) {
    super(`Brand code already exists: ${code}`, { code });
  }
}

export class CategoryNotFoundError extends DomainError {
  readonly code = 'CATEGORY_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Category not found: ${id}`, { id });
  }
}

export class CategoryCodeAlreadyExistsError extends DomainError {
  readonly code = 'CATEGORY_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(code: string) {
    super(`Category code already exists: ${code}`, { code });
  }
}

/** A category must not become its own ancestor (task §14 simple tree). */
export class CategoryCycleInvalidError extends DomainError {
  readonly code = 'CATEGORY_CYCLE_INVALID';
  readonly httpStatus = 409;

  constructor(categoryId: string) {
    super('Category parent would create a cycle', { categoryId });
  }
}
