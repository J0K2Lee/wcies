import { DomainError } from '../../../common/errors/domain.error';

export class StoreNotFoundError extends DomainError {
  readonly code = 'STORE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(identifier: string) {
    super(`Store not found: ${identifier}`, { identifier });
  }
}

export class StoreCodeAlreadyExistsError extends DomainError {
  readonly code = 'STORE_CODE_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(platformId: string, storeCode: string) {
    super(`Store code already exists on this platform: ${storeCode}`, { platformId, storeCode });
  }
}

export class StoreInactiveError extends DomainError {
  readonly code = 'STORE_INACTIVE';
  readonly httpStatus = 409;

  constructor(storeId: string) {
    super(`Store is inactive: ${storeId}`, { storeId });
  }
}

/** Zero-reference delete policy (Sprint 6 decision 0003): still referenced. */
export class StoreInUseError extends DomainError {
  readonly code = 'STORE_IN_USE';
  readonly httpStatus = 409;

  constructor(sources: string[]) {
    super(`该记录已被引用（${sources.join('、')}），只能停用不能删除`, { sources });
  }
}
