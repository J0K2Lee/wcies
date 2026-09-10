import { DomainError } from '../../../common/errors/domain.error';

export class ListingNotFoundError extends DomainError {
  readonly code = 'LISTING_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Listing not found: ${id}`, { id });
  }
}

export class ListingAlreadyExistsError extends DomainError {
  readonly code = 'LISTING_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(storeId: string, platformProductId: string) {
    super(`Listing already exists for this store + platform product id: ${platformProductId}`, {
      storeId,
      platformProductId,
    });
  }
}

export class ListingSkuMappingNotFoundError extends DomainError {
  readonly code = 'LISTING_SKU_MAPPING_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(id: string) {
    super(`Listing SKU mapping not found: ${id}`, { id });
  }
}

export class ListingSkuMappingAlreadyExistsError extends DomainError {
  readonly code = 'LISTING_SKU_MAPPING_ALREADY_EXISTS';
  readonly httpStatus = 409;

  constructor(listingId: string, skuId: string) {
    super(`The internal SKU is already mapped to this listing`, { listingId, skuId });
  }
}

/**
 * No candidate matched within the store scope (task §54).
 * Order sync will later turn this into ORDER_SKU_MAPPING_FAILED.
 */
export class ListingSkuResolveFailedError extends DomainError {
  readonly code = 'LISTING_SKU_RESOLVE_FAILED';
  readonly httpStatus = 404;

  constructor(storeId: string, identifiers: Record<string, string>) {
    super(`No internal SKU matches the given platform identifiers in this store`, {
      storeId,
      ...identifiers,
    });
  }
}

/**
 * Multiple candidates matched within the SAME store (task §53).
 * Picking the first row is FORBIDDEN - this is an order-safety boundary.
 */
export class ListingSkuResolveAmbiguousError extends DomainError {
  readonly code = 'LISTING_SKU_RESOLVE_AMBIGUOUS';
  readonly httpStatus = 409;

  constructor(storeId: string, candidateIds: string[]) {
    super(`Multiple internal SKUs match the given platform identifiers in this store`, {
      storeId,
      candidateIds,
    });
  }
}

/** Mapping state change not allowed (e.g. mapping an already-mapped row). */
export class ListingSkuMappingInvalidStateError extends DomainError {
  readonly code = 'LISTING_SKU_MAPPING_INVALID_STATE';
  readonly httpStatus = 409;

  constructor(mappingId: string, reason: string) {
    super(`Listing SKU mapping ${mappingId} cannot change state: ${reason}`, {
      mappingId,
      reason,
    });
  }
}

/** Zero-reference delete policy (Sprint 6 decision 0003): still referenced. */
export class ListingInUseError extends DomainError {
  readonly code = 'LISTING_IN_USE';
  readonly httpStatus = 409;

  constructor(sources: string[]) {
    super(`该记录已被引用（${sources.join('、')}），只能停用不能删除`, { sources });
  }
}

/** The mapping already appears in order history (spec §66, Sprint 6 T4). */
export class ListingSkuMappingInUseError extends DomainError {
  readonly code = 'LISTING_SKU_MAPPING_IN_USE';
  readonly httpStatus = 409;

  constructor(mappingId: string) {
    super('该记录已被引用（存在订单行），只能停用不能删除', { mappingId });
  }
}
