import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import { PlatformService } from '../../platform/platform.service';
import { PlatformNotFoundError } from '../../platform/errors/platform-errors';
import { StoreService } from '../../store/services/store.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import { SkuService } from '../../product/services/sku.service';
import { SkuNotFoundError } from '../../product/errors/sku-errors';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { PlatformListingEntity } from '../entities/platform-listing.entity';
import {
  ListingAlreadyExistsError,
  ListingNotFoundError,
  ListingSkuMappingAlreadyExistsError,
  ListingSkuMappingNotFoundError,
} from '../errors/listing-errors';
import {
  ListingRepository,
  ListingRowWithRefs,
  MappingRowWithRefs,
} from '../repositories/listing.repository';
import {
  AddListingSkuRequestDto,
  CreateListingRequestDto,
  ListingDetailDto,
  ListingListQueryDto,
  ListingResponseDto,
  ListingSkuResponseDto,
  UpdateListingRequestDto,
  UpdateListingSkuRequestDto,
} from '../dto/listing.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'PLATFORM_LISTING';
const MAPPING_ENTITY_TYPE = 'PLATFORM_LISTING_SKU';

/**
 * Platform listings + SKU mappings (task §46-§50).
 *
 * Hard invariants (AGENTS.md §101):
 * - one internal SKU may map to many listings (no UNIQUE(sku_id, store_id));
 * - store + platform_product_id identifies a listing;
 * - the same offer/sku strings may repeat across stores.
 */
@Injectable()
export class ListingService {
  constructor(
    private readonly repository: ListingRepository,
    private readonly platformService: PlatformService,
    private readonly storeService: StoreService,
    private readonly skuService: SkuService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(query: ListingListQueryDto): Promise<{ items: ListingResponseDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listWithRefs(
      {
        platformId: query.platformId,
        storeId: query.storeId,
        skuId: query.skuId,
        status: query.status,
        keyword: query.keyword?.trim() || undefined,
        mappingState: query.mappingState,
      },
      pageSize,
      offsetOf(page, pageSize),
    );
    return {
      items: rows.map((row) => this.toResponse(row)),
      meta: { page, pageSize, total },
    };
  }

  /** Listing detail with its variant mappings (SKU drawer / expandable row). */
  async getDetail(id: string): Promise<ListingDetailDto> {
    const listing = await this.findListingOrThrow(id);
    const mappings = await this.repository.listMappingsByListingId(id);
    const refs = await this.resolveRefs(listing);
    return {
      ...this.toResponse({ listing, ...refs, mappingCount: mappings.length }),
      skus: mappings.map((row) => this.mappingToResponse(row)),
    };
  }

  /** All mappings of an internal SKU across stores/listings (task §91). */
  async listMappingsOfSku(skuId: string): Promise<
    Array<
      ListingSkuResponseDto & {
        platformCode: string;
        storeCode: string;
        platformProductId: string;
        title: string | null;
        url: string | null;
      }
    >
  > {
    const rows = await this.repository.listMappingsBySkuId(skuId);
    return rows.map((row) => ({
      id: row.mapping.id,
      listingId: row.mapping.listingId,
      skuId: row.mapping.skuId,
      skuCode: '',
      skuName: '',
      platformSkuId: row.mapping.platformSkuId,
      sellerSku: row.mapping.sellerSku,
      offerId: row.mapping.offerId,
      status: row.mapping.status,
      createdAt: row.mapping.createdAt,
      updatedAt: row.mapping.updatedAt,
      platformCode: row.platformCode,
      storeCode: row.storeCode,
      platformProductId: row.listing.platformProductId,
      title: row.listing.title,
      url: row.listing.url,
    }));
  }

  /**
   * Creates a listing with its variant mappings in one payload (spec §84).
   * Reuse semantics: the caller checks existence first; duplicates raise
   * LISTING_ALREADY_EXISTS for the store + platform_product_id pair.
   */
  async create(dto: CreateListingRequestDto, operator: OperatorContext): Promise<ListingDetailDto> {
    const platform = await this.platformService.getEntityById(dto.platformId);
    if (platform === null) {
      throw new PlatformNotFoundError(dto.platformId);
    }
    const store = await this.storeService.getEntityById(dto.storeId);
    if (store === null) {
      throw new StoreNotFoundError(dto.storeId);
    }
    if (store.platformId !== platform.id) {
      throw new StoreNotFoundError(dto.storeId);
    }
    for (const variant of dto.skuVariants) {
      const sku = await this.skuService.getEntityById(variant.skuId);
      if (sku === null) {
        throw new SkuNotFoundError(variant.skuId);
      }
    }

    const existing = await this.repository.findListingByStoreAndProductId(
      dto.storeId,
      dto.platformProductId,
    );
    if (existing !== null) {
      throw new ListingAlreadyExistsError(dto.storeId, dto.platformProductId);
    }

    const listing = await this.repository.insertListing({
      platformId: platform.id,
      storeId: store.id,
      platformProductId: dto.platformProductId,
      title: dto.title ?? null,
      url: dto.url ?? null,
      status: 'ACTIVE',
      rawData: dto.rawData ?? null,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: listing.id,
      entityCode: `${platform.code}/${store.storeCode}/${dto.platformProductId}`,
      action: 'CREATE',
      changes: { platformProductId: { from: null, to: listing.platformProductId } },
      operator,
    });

    const mappings: MappingRowWithRefs[] = [];
    for (const variant of dto.skuVariants) {
      const mapping = await this.addMappingInternal(listing.id, variant, operator);
      mappings.push({
        mapping,
        skuCode: (await this.skuService.getEntityById(variant.skuId))?.skuCode ?? '',
        skuName: (await this.skuService.getEntityById(variant.skuId))?.nameZh ?? '',
      });
    }

    return {
      ...this.toResponse({
        listing,
        platformCode: platform.code,
        storeCode: store.storeCode,
        storeName: store.name,
        mappingCount: mappings.length,
      }),
      skus: mappings.map((row) => this.mappingToResponse(row)),
    };
  }

  async update(
    id: string,
    dto: UpdateListingRequestDto,
    operator: OperatorContext,
  ): Promise<ListingDetailDto> {
    const listing = await this.findListingOrThrow(id);
    const before = { title: listing.title, url: listing.url };
    const patch: Partial<PlatformListingEntity> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.url !== undefined) patch.url = dto.url;
    if (dto.rawData !== undefined) patch.rawData = dto.rawData;
    if (Object.keys(patch).length > 0) {
      await this.repository.updateListing(id, patch);
    }
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: listing.platformProductId,
      action: 'UPDATE',
      changes: diffOf(before, { title: dto.title ?? listing.title, url: dto.url ?? listing.url }),
      operator,
    });
    return this.getDetail(id);
  }

  async setStatus(
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<ListingDetailDto> {
    const listing = await this.findListingOrThrow(id);
    await this.repository.updateListing(id, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: listing.platformProductId,
      action: status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE',
      changes: { status: { from: listing.status, to: status } },
      operator,
    });
    return this.getDetail(id);
  }

  // ---- Variant mappings ----

  async addMapping(
    listingId: string,
    dto: AddListingSkuRequestDto,
    operator: OperatorContext,
  ): Promise<ListingSkuResponseDto> {
    await this.findListingOrThrow(listingId);
    const mapping = await this.addMappingInternal(listingId, dto, operator);
    const sku = await this.skuService.getEntityById(dto.skuId);
    return this.mappingToResponse({
      mapping,
      skuCode: sku?.skuCode ?? '',
      skuName: sku?.nameZh ?? '',
    });
  }

  async updateMapping(
    listingId: string,
    mappingId: string,
    dto: UpdateListingSkuRequestDto,
    operator: OperatorContext,
  ): Promise<ListingSkuResponseDto> {
    const mapping = await this.findOwnedMappingOrThrow(listingId, mappingId);
    const patch: Partial<{
      platformSkuId: string | null;
      sellerSku: string | null;
      offerId: string | null;
      status: string;
    }> = {};
    if (dto.platformSkuId !== undefined) patch.platformSkuId = dto.platformSkuId;
    if (dto.sellerSku !== undefined) patch.sellerSku = dto.sellerSku;
    if (dto.offerId !== undefined) patch.offerId = dto.offerId;
    if (dto.status !== undefined) patch.status = dto.status;
    if (Object.keys(patch).length > 0) {
      await this.repository.updateMapping(mappingId, patch);
    }
    await this.operationLog.record({
      entityType: MAPPING_ENTITY_TYPE,
      entityId: mappingId,
      entityCode: mapping.offerId ?? mapping.sellerSku ?? mapping.id,
      action: 'UPDATE',
      changes: { updatedFields: { from: null, to: Object.keys(patch) } },
      operator,
    });
    const updated = await this.repository.findMappingById(mappingId);
    const sku = updated === null ? null : await this.skuService.getEntityById(updated.skuId);
    return this.mappingToResponse({
      mapping: updated as typeof mapping,
      skuCode: sku?.skuCode ?? '',
      skuName: sku?.nameZh ?? '',
    });
  }

  /** Allowed while the mapping has no order history (spec §66). */
  async deleteMapping(
    listingId: string,
    mappingId: string,
    operator: OperatorContext,
  ): Promise<void> {
    const mapping = await this.findOwnedMappingOrThrow(listingId, mappingId);
    await this.repository.deleteMapping(mappingId);
    await this.operationLog.record({
      entityType: MAPPING_ENTITY_TYPE,
      entityId: mappingId,
      entityCode: mapping.offerId ?? mapping.sellerSku ?? mapping.id,
      action: 'DELETE',
      changes: { deleted: { from: true, to: null } },
      operator,
    });
  }

  /** Cross-module: listing entity lookup (import service). */
  async getEntityById(id: string): Promise<PlatformListingEntity | null> {
    return this.repository.findListingById(id);
  }

  async getOrCreateListingForImport(
    input: {
      platformId: string;
      storeId: string;
      platformProductId: string;
      title?: string | null;
      url?: string | null;
      rawData?: Record<string, unknown> | null;
    },
    operator: OperatorContext,
  ): Promise<PlatformListingEntity> {
    const existing = await this.repository.findListingByStoreAndProductId(
      input.storeId,
      input.platformProductId,
    );
    if (existing !== null) {
      return existing;
    }
    const created = await this.repository.insertListing({
      platformId: input.platformId,
      storeId: input.storeId,
      platformProductId: input.platformProductId,
      title: input.title ?? null,
      url: input.url ?? null,
      status: 'ACTIVE',
      rawData: input.rawData ?? null,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: created.id,
      entityCode: input.platformProductId,
      action: 'IMPORT_CREATE',
      changes: { platformProductId: { from: null, to: input.platformProductId } },
      operator,
    });
    return created;
  }

  async addMappingForImport(
    input: {
      listingId: string;
      skuId: string;
      platformSkuId?: string | null;
      sellerSku?: string | null;
      offerId?: string | null;
    },
    operator: OperatorContext,
  ): Promise<{ created: boolean }> {
    const duplicate = await this.repository.findMappingByListingAndSku(
      input.listingId,
      input.skuId,
    );
    if (duplicate !== null) {
      return { created: false };
    }
    await this.addMappingInternal(input.listingId, input, operator);
    return { created: true };
  }

  private async addMappingInternal(
    listingId: string,
    variant: {
      skuId: string;
      platformSkuId?: string | null;
      sellerSku?: string | null;
      offerId?: string | null;
    },
    operator: OperatorContext,
  ) {
    const sku = await this.skuService.getEntityById(variant.skuId);
    if (sku === null) {
      throw new SkuNotFoundError(variant.skuId);
    }
    const duplicate = await this.repository.findMappingByListingAndSku(listingId, variant.skuId);
    if (duplicate !== null) {
      throw new ListingSkuMappingAlreadyExistsError(listingId, variant.skuId);
    }
    const mapping = await this.repository.insertMapping({
      listingId,
      skuId: variant.skuId,
      platformSkuId: variant.platformSkuId ?? null,
      sellerSku: variant.sellerSku ?? null,
      offerId: variant.offerId ?? null,
      status: 'ACTIVE',
      rawData: null,
    });
    await this.operationLog.record({
      entityType: MAPPING_ENTITY_TYPE,
      entityId: mapping.id,
      entityCode: `${listingId}/${sku.skuCode}`,
      action: 'CREATE',
      changes: {
        skuCode: { from: null, to: sku.skuCode },
        offerId: { from: null, to: mapping.offerId },
      },
      operator,
    });
    return mapping;
  }

  private async findListingOrThrow(id: string): Promise<PlatformListingEntity> {
    const listing = await this.repository.findListingById(id);
    if (listing === null) {
      throw new ListingNotFoundError(id);
    }
    return listing;
  }

  private async findOwnedMappingOrThrow(
    listingId: string,
    mappingId: string,
  ): Promise<NonNullable<Awaited<ReturnType<ListingRepository['findMappingById']>>>> {
    await this.findListingOrThrow(listingId);
    const mapping = await this.repository.findMappingById(mappingId);
    if (mapping === null || mapping.listingId !== listingId) {
      throw new ListingSkuMappingNotFoundError(mappingId);
    }
    return mapping;
  }

  private async resolveRefs(listing: PlatformListingEntity): Promise<{
    platformCode: string;
    storeCode: string;
    storeName: string;
  }> {
    const platform = await this.platformService.getEntityById(listing.platformId);
    const store = await this.storeService.getEntityById(listing.storeId);
    if (platform === null || store === null) {
      throw new ListingNotFoundError(listing.id);
    }
    return { platformCode: platform.code, storeCode: store.storeCode, storeName: store.name };
  }

  private toResponse(row: ListingRowWithRefs): ListingResponseDto {
    return {
      id: row.listing.id,
      platformId: row.listing.platformId,
      platformCode: row.platformCode,
      storeId: row.listing.storeId,
      storeCode: row.storeCode,
      storeName: row.storeName,
      platformProductId: row.listing.platformProductId,
      title: row.listing.title,
      url: row.listing.url,
      status: row.listing.status,
      createdAt: row.listing.createdAt,
      updatedAt: row.listing.updatedAt,
      mappingCount: row.mappingCount,
    };
  }

  private mappingToResponse(row: MappingRowWithRefs): ListingSkuResponseDto {
    return {
      id: row.mapping.id,
      listingId: row.mapping.listingId,
      skuId: row.mapping.skuId,
      skuCode: row.skuCode,
      skuName: row.skuName,
      platformSkuId: row.mapping.platformSkuId,
      sellerSku: row.mapping.sellerSku,
      offerId: row.mapping.offerId,
      status: row.mapping.status,
      createdAt: row.mapping.createdAt,
      updatedAt: row.mapping.updatedAt,
    };
  }
}
