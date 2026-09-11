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

/** Zero-reference delete policy (Sprint 6 decision 0003): still referenced. */
export class SkuInUseError extends DomainError {
  readonly code = 'SKU_IN_USE';
  readonly httpStatus = 409;

  constructor(sources: string[]) {
    super(`该记录已被引用（${sources.join('、')}），只能停用不能删除`, { sources });
  }
}

/**
 * Forced delete (decision 0008) hit business history. Inventory, order,
 * picking, package and shipment records are evidence the SKU physically
 * moved, so they are never cascaded away (AGENTS.md §25).
 */
export class SkuHasHistoryError extends DomainError {
  readonly code = 'SKU_HAS_BUSINESS_HISTORY';
  readonly httpStatus = 409;

  constructor(sources: string[]) {
    super(
      `该 SKU 已有业务流水（${sources.join('、')}），强制删除也不能移除。` + `如需下架请改用停用。`,
      { sources },
    );
  }
}
