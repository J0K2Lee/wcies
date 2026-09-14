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
 * Decision 0012 + 0016: a mapping must name the platform variant it resolves
 * by a RESOLUTION identifier (Platform SKU ID or Seller SKU). Offer ID alone
 * is refused because the platform lets operators edit it - a mapping that
 * could only be found by offer id would silently stop resolving.
 */
export class ListingSkuMappingIdentifierRequiredError extends DomainError {
  readonly code = 'LISTING_SKU_MAPPING_IDENTIFIER_REQUIRED';
  readonly httpStatus = 422;

  constructor(listingId: string) {
    super('至少填写 Platform SKU ID 或 Seller SKU；Offer ID 可被运营修改，不作为订单解析依据', {
      listingId,
    });
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

/** Sprint 8.5 T3b: no cached platform tree for this platform yet. */
export class CategoryTreeNotSyncedError extends DomainError {
  readonly code = 'CATEGORY_TREE_NOT_SYNCED';
  readonly httpStatus = 409;

  constructor(platformId: string) {
    super('该平台尚未同步类目树，请先在同步中心触发「类目树同步」', { platformId });
  }
}

/**
 * Sprint 8.5 T3b (AGENTS.md §89): the import refuses to run while any
 * candidate collides with an existing category by exact name_ru match, or
 * would duplicate a sibling name_zh - ambiguity is reported, never silently
 * dropped or guessed.
 */
export class CategoryImportConflictsError extends DomainError {
  readonly code = 'CATEGORY_IMPORT_CONFLICTS';
  readonly httpStatus = 409;

  constructor(conflicts: Array<{ name: string; reason: string }>) {
    super(
      `类目导入存在 ${conflicts.length} 处冲突，请先人工处理后再导入（详见 details，不做静默跳过）`,
      { conflicts: conflicts.slice(0, 50) },
    );
  }
}

/** Sprint 8 T1: neither the request nor the listing title provides a name. */
export class ListingOnboardNameRequiredError extends DomainError {
  readonly code = 'LISTING_ONBOARD_NAME_REQUIRED';
  readonly httpStatus = 422;

  constructor() {
    super('商品名/SKU 名不能为空（该 Listing 无标题，请手工填写名称）', {});
  }
}
