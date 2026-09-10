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

/** Moving/creating a subtree would exceed the 3-level limit (decision 0005). */
export class CategoryDepthExceededError extends DomainError {
  readonly code = 'CATEGORY_DEPTH_EXCEEDED';
  readonly httpStatus = 422;

  constructor(categoryId: string, resultingDepth: number) {
    super('Category tree allows at most 3 levels', { categoryId, resultingDepth });
  }
}

/** Products may only reference level-3 categories (decision 0005). */
export class CategoryLevelInvalidError extends DomainError {
  readonly code = 'CATEGORY_LEVEL_INVALID';
  readonly httpStatus = 422;

  constructor(categoryId: string, level: number) {
    super(
      level === 3
        ? '该类目下有商品，不可移动到非三级位置'
        : '商品分类必须挂三级类目',
      { categoryId, level },
    );
  }
}

/** Same-name sibling under the same parent (including between roots). */
export class CategoryNameDuplicatedError extends DomainError {
  readonly code = 'CATEGORY_NAME_DUPLICATED';
  readonly httpStatus = 409;

  constructor(nameZh: string, parentId: string | null) {
    super(`同级已存在同名分类: ${nameZh}`, { nameZh, parentId });
  }
}

/** Sub-categories are a hierarchy relation, not a reference (decision 0003). */
export class CategoryHasChildrenError extends DomainError {
  readonly code = 'CATEGORY_HAS_CHILDREN';
  readonly httpStatus = 409;

  constructor(categoryId: string) {
    super('该分类下存在子分类，只能停用不能删除', { categoryId });
  }
}

/** Products still reference this category (decision 0003). */
export class CategoryInUseError extends DomainError {
  readonly code = 'CATEGORY_IN_USE';
  readonly httpStatus = 409;

  constructor(categoryId: string) {
    super('该记录已被引用（存在商品），只能停用不能删除', { categoryId });
  }
}
