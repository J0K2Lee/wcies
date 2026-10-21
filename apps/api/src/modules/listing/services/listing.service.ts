import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { EntityManager } from 'typeorm';
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
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';
import {
  ListingAlreadyExistsError,
  ListingInUseError,
  ListingNotFoundError,
  ListingSkuMappingAlreadyExistsError,
  ListingSkuMappingIdentifierRequiredError,
  ListingSkuMappingInUseError,
  ListingSkuMappingInvalidStateError,
  ListingSkuMappingNotFoundError,
} from '../errors/listing-errors';
import {
  deriveMappingStatus,
  ListingRepository,
  ListingRowWithRefs,
  MappingRowWithRefs,
} from '../repositories/listing.repository';
import {
  AddListingSkuRequestDto,
  CreateListingRequestDto,
  ListingDetailDto,
  MapListingSkuRequestDto,
  ListingListQueryDto,
  ListingResponseDto,
  ListingSkuResponseDto,
  UpdateListingRequestDto,
  UpdateListingSkuRequestDto,
} from '../dto/listing.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';
import { OrderIngestionService } from '../../order/services/order-ingestion.service';

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
    // 映射修复后的订单行批量收敛（2026-10-15 bug 修复；order ↔ listing 循环
    // 依赖与 order↔picking 同款 forwardRef 解法）。
    @Inject(forwardRef(() => OrderIngestionService))
    private readonly orderIngestion: OrderIngestionService,
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
      ...this.toResponse({
        listing,
        ...refs,
        mappingCount: mappings.length,
        mappingStatus: deriveMappingStatus(mappings.map((row) => row.mapping)),
        hasOrderException: false,
      }),
      skus: mappings.map((row) => this.mappingToResponse(row)),
    };
  }

  /**
   * Sprint 8 T3: global mapped/unmapped counters for the unmapped workbench
   * header ("how many are still unmanaged"). Same derived-state fragment as
   * the list filter, so the number can never contradict the 待映射 view.
   */
  async getMappingStats(): Promise<{ mapped: number; unmapped: number }> {
    return this.repository.countMappingStates();
  }

  /** Sprint 8 T2: unmapped variant rows for the Excel export (raw facts). */
  async listUnmappedVariantsForExport(filters: { platformId?: string; storeId?: string }) {
    return this.repository.listUnmappedVariantsForExport(filters);
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
      mappingStatus: row.mapping.mappingStatus,
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
        mappingStatus: deriveMappingStatus(mappings.map((row) => row.mapping)),
        hasOrderException: false,
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
    // 启用链接会让此前「链接非 ACTIVE 而不可解析」的订单行重新可解析
    // （resolver 只认 ACTIVE listing + ACTIVE MAPPED mapping）：逐个已映射
    // 变体收敛，否则这些行会一直停在映射异常，直到人工重试（2026-10-20）。
    if (status === 'ACTIVE' && listing.status !== 'ACTIVE') {
      const mapped = (await this.repository.listMappingsByListingId(id)).filter(
        (row) => row.mapping.mappingStatus === 'MAPPED' && row.mapping.status === 'ACTIVE',
      );
      for (const row of mapped) {
        await this.retryOrderLinesAfterMappingRepair(row.mapping.id, operator);
      }
    }
    return this.getDetail(id);
  }

  /** Zero-reference hard delete (decision 0003); referenced -> LISTING_IN_USE. */
  async remove(id: string, operator: OperatorContext): Promise<void> {
    const listing = await this.findListingOrThrow(id);
    if ((await this.repository.countListingReferences(id)) > 0) {
      throw new ListingInUseError(['platform_listing_skus']);
    }
    await this.repository.deleteListing(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: listing.platformProductId,
      action: 'DELETE',
      changes: { deleted: { from: listing.platformProductId, to: null } },
      operator,
    });
  }

  // ---- Variant mappings ----

  async addMapping(
    listingId: string,
    dto: AddListingSkuRequestDto,
    operator: OperatorContext,
  ): Promise<ListingSkuResponseDto> {
    await this.findListingOrThrow(listingId);
    const mapping = await this.addMappingInternal(listingId, dto, operator);
    // 手工新增映射同样要把「映射已落库」传播到已摄入的订单行（2026-10-20）：
    // 此前只有 mapUnmappedSku（绑定已同步的 UNMAPPED 变体）会收敛，走
    // POST /listings/:id/skus 新建的映射不会，订单行只能靠人工重试。
    await this.retryOrderLinesAfterMappingRepair(mapping.id, operator);
    const sku = await this.skuService.getEntityById(dto.skuId);
    return this.mappingToResponse({
      mapping,
      skuCode: sku?.skuCode ?? null,
      skuName: sku?.nameZh ?? null,
    });
  }

  /**
   * Human mapping of a synced UNMAPPED platform SKU to an internal SKU
   * (Sprint 5 task §36). Platform sync NEVER overwrites this (task §19):
   * sync upserts skip sku_id/mapping_status entirely.
   */
  async mapUnmappedSku(
    listingId: string,
    mappingId: string,
    dto: MapListingSkuRequestDto,
    operator: OperatorContext,
  ): Promise<ListingSkuResponseDto> {
    const mapping = await this.findOwnedMappingOrThrow(listingId, mappingId);
    if (mapping.skuId !== null) {
      throw new ListingSkuMappingInvalidStateError(mappingId, 'already mapped');
    }
    const sku = await this.skuService.getEntityById(dto.skuId);
    if (sku === null) {
      throw new SkuNotFoundError(dto.skuId);
    }
    await this.repository.updateMapping(mappingId, {
      skuId: dto.skuId,
      mappingStatus: 'MAPPED',
    });
    await this.operationLog.record({
      entityType: MAPPING_ENTITY_TYPE,
      entityId: mappingId,
      entityCode: mapping.offerId ?? mapping.platformSkuId ?? mappingId,
      action: 'MAP',
      changes: {
        mappingStatus: { from: mapping.mappingStatus, to: 'MAPPED' },
        skuCode: { from: null, to: sku.skuCode },
      },
      operator,
    });
    // 映射已落库：同店铺引用该变体的 FAILED 订单行批量收敛（失败自吞，
    // 不影响映射结果；2026-10-15 bug 修复）。
    await this.retryOrderLinesAfterMappingRepair(mappingId, operator);
    const updated = await this.repository.findMappingById(mappingId);
    return this.mappingToResponse({
      mapping: updated as typeof mapping,
      skuCode: sku.skuCode,
      skuName: sku.nameZh,
    });
  }

  /**
   * 映射落库后的订单行批量收敛入口（快速建档 onboard 与人工映射共用）：
   * 失败自吞——映射本身已提交成功，订单行重试的任何失败只记日志，绝不
   * 让调用方的事务/响应失败（映射结果不受影响）。
   */
  async retryOrderLinesAfterMappingRepair(
    mappingId: string,
    operator: OperatorContext,
  ): Promise<void> {
    try {
      const mapping = await this.repository.findMappingById(mappingId);
      const listing =
        mapping === null ? null : await this.repository.findListingById(mapping.listingId);
      if (mapping === null || listing === null) {
        return;
      }
      await this.orderIngestion.retryFailedMappingForVariant(
        {
          storeId: listing.storeId,
          platformSkuId: mapping.platformSkuId,
          sellerSku: mapping.sellerSku,
        },
        operator,
      );
    } catch {
      // 映射已提交：收敛失败不能反射为调用失败（静默，行仍可手动重试）。
    }
  }

  /**
   * Cross-module tx participant (Sprint 8 T1): binds a synced UNMAPPED
   * variant to an internal SKU on the CALLER's transaction. Same guards as
   * mapUnmappedSku(); operation logging stays with the caller (after commit).
   * The mapping is re-read through the CALLER's manager so the guard sees
   * the row the caller locked (Sprint 8.5 T1), not a stale snapshot.
   * Returns the updated mapping entity.
   */
  async mapUnmappedSkuInTx(
    manager: EntityManager,
    listingId: string,
    mappingId: string,
    skuId: string,
  ): Promise<PlatformListingSkuEntity> {
    const mapping = await manager
      .getRepository(PlatformListingSkuEntity)
      .findOneBy({ id: mappingId });
    if (mapping === null || mapping.listingId !== listingId) {
      throw new ListingSkuMappingNotFoundError(mappingId);
    }
    if (mapping.skuId !== null) {
      throw new ListingSkuMappingInvalidStateError(mappingId, 'already mapped');
    }
    // Read on the CALLER's manager: the SKU may have been created inside the
    // same transaction (quick onboarding) and is invisible to other
    // connections until commit.
    const sku = await this.skuService.getEntityByIdInTx(manager, skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
    await manager
      .getRepository(PlatformListingSkuEntity)
      .update({ id: mappingId }, { skuId, mappingStatus: 'MAPPED' });
    const updated = await manager
      .getRepository(PlatformListingSkuEntity)
      .findOneByOrFail({ id: mappingId });
    return updated;
  }

  /**
   * Sprint 8.5 T5: variant feeds for the enrichment sync (store-scoped,
   * idempotent - rows already enriched are not re-fetched).
   */
  async listEnrichmentTargets(storeId: string, limit: number): Promise<string[]> {
    return this.repository.listEnrichmentTargets(storeId, limit);
  }

  /**
   * Sprint 8.5 T5: merges a v4 attribute payload into the store's variant
   * rows for one platform product (dedicated raw_data key, never overwrites
   * existing keys). Returns updated row count.
   */
  async applyProductAttributes(
    storeId: string,
    platformProductId: string,
    attributes: Record<string, unknown>,
  ): Promise<number> {
    return this.repository.mergeProductAttributes(storeId, platformProductId, attributes);
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

    // Decision 0016: the same invariant as creation, enforced on the RESULT of
    // the edit - identifiers may be replaced, never erased down to "no
    // resolution identifier left", or the row would silently stop matching
    // orders. Checked only when the request touches identifiers, so a legacy
    // identifier-less row can still be edited (e.g. deactivated).
    if (dto.platformSkuId !== undefined || dto.sellerSku !== undefined) {
      const mergedPlatformSkuId =
        dto.platformSkuId !== undefined ? dto.platformSkuId : mapping.platformSkuId;
      const mergedSellerSku = dto.sellerSku !== undefined ? dto.sellerSku : mapping.sellerSku;
      const blank = (value: string | null | undefined): boolean =>
        value === null || value === undefined || value.trim() === '';
      if (blank(mergedPlatformSkuId) && blank(mergedSellerSku)) {
        throw new ListingSkuMappingIdentifierRequiredError(listingId);
      }
    }

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
    const sku =
      updated === null || updated.skuId === null
        ? null
        : await this.skuService.getEntityById(updated.skuId);
    return this.mappingToResponse({
      mapping: updated as typeof mapping,
      skuCode: sku?.skuCode ?? null,
      skuName: sku?.nameZh ?? null,
    });
  }

  /**
   * Allowed while the mapping has no order history (spec §66): order lines
   * referencing the mapping block the delete with a business error instead
   * of the raw FK failure (Sprint 6 T4 gap fix).
   */
  async deleteMapping(
    listingId: string,
    mappingId: string,
    operator: OperatorContext,
  ): Promise<void> {
    const mapping = await this.findOwnedMappingOrThrow(listingId, mappingId);
    if ((await this.repository.countMappingOrderReferences(mappingId)) > 0) {
      throw new ListingSkuMappingInUseError(mappingId);
    }
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

  /**
   * Listing-sync upsert (Sprint 5 task §17-§20). Called ONLY by the sync
   * engine with platform facts:
   * - creates listings / updates title, rawData, lastSeenAt, platform status;
   * - upserts platform-SKU rows keyed by (listingId, platformSkuId);
   * - NEVER touches skuId / mappingStatus of an existing row - a human
   *   mapping survives every re-sync (task §19);
   * - never deactivates listings missing from the payload (task §20).
   */
  async applyPlatformListing(input: {
    storeId: string;
    platformProductId: string;
    title: string | null;
    url: string | null;
    platformStatus: string | null;
    skus: Array<{
      platformSkuId: string | null;
      offerId: string | null;
      sellerSku: string | null;
      rawData: Record<string, unknown>;
    }>;
    rawData: Record<string, unknown>;
    /**
     * 仅订单事实兜底建链（2026-10-20）使用：允许在没有 platformSkuId 的
     * 情况下按 sellerSku 建/对齐变体行（Yandex 订单行只带 offerId）。
     * 全量 listing sync 不开此开关——平台 walk 永远有 platformSkuId。
     */
    allowSellerSkuKeyed?: boolean;
  }): Promise<'CREATED' | 'UPDATED'> {
    const store = await this.storeService.getEntityById(input.storeId);
    if (store === null) {
      throw new StoreNotFoundError(input.storeId);
    }
    const now = new Date();
    const existing = await this.repository.findListingByStoreAndProductId(
      input.storeId,
      input.platformProductId,
    );
    let listing = existing;
    if (listing === null) {
      listing = await this.repository.insertListing({
        platformId: store.platformId,
        storeId: input.storeId,
        platformProductId: input.platformProductId,
        title: input.title,
        url: input.url,
        status: 'ACTIVE',
        rawData: input.rawData,
        lastSeenAt: now,
      });
    } else {
      await this.repository.updateListing(listing.id, {
        title: input.title,
        url: input.url,
        rawData: input.rawData,
        lastSeenAt: now,
      });
    }

    for (const sku of input.skus) {
      const sellerSkuKeyed =
        input.allowSellerSkuKeyed === true &&
        sku.platformSkuId === null &&
        typeof sku.sellerSku === 'string' &&
        sku.sellerSku.trim() !== '';
      if (sku.platformSkuId === null && !sellerSkuKeyed) {
        // Cannot dedup safely without a platform SKU id - store in rawData
        // of the listing only. OZON always provides one; other platforms
        // get their own upsert rules when integrated.
        continue;
      }
      const existingMapping =
        sku.platformSkuId !== null
          ? await this.repository.findActiveMappingByListingAndPlatformSkuId(
              listing.id,
              sku.platformSkuId,
            )
          : await this.repository.findActiveMappingByListingAndSellerSku(
              listing.id,
              sku.sellerSku as string,
            );
      if (existingMapping !== null) {
        // Platform fact refresh only - human mapping is untouchable (§19).
        await this.repository.updateMapping(existingMapping.id, {
          offerId: sku.offerId,
          sellerSku: sku.sellerSku,
          // The walk rebuilds raw_data from the platform DTO and knows nothing
          // about payloads written AFTER the sync (OZON enrichment's
          // product_attributes). Preserve one the incoming payload does not
          // carry - same "never overwrite" rule as mergeProductAttributes.
          // WB/Yandex mappers embed product_attributes in the payload itself,
          // so their fresh platform facts still win.
          rawData: preserveEnrichedAttributes(existingMapping.rawData, sku.rawData),
        });
      } else {
        await this.repository.insertMapping({
          listingId: listing.id,
          skuId: null,
          mappingStatus: 'UNMAPPED',
          platformSkuId: sku.platformSkuId,
          offerId: sku.offerId,
          sellerSku: sku.sellerSku,
          status: 'ACTIVE',
          rawData: sku.rawData,
        });
      }
    }
    return existing === null ? 'CREATED' : 'UPDATED';
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
    // Sprint 8 T2 closed loop: when the identifiers match a synced UNMAPPED
    // variant on this listing, BIND that row (exactly what 人工映射 does).
    // Inserting a twin would leave the synced row orphaned next to the new
    // MAPPED row and pollute the variant list on every export-import cycle.
    const synced = await this.repository.findUnmappedVariantByIdentifiers(input.listingId, {
      platformSkuId: input.platformSkuId,
      sellerSku: input.sellerSku,
    });
    if (synced !== null) {
      await this.repository.updateMapping(synced.id, {
        skuId: input.skuId,
        mappingStatus: 'MAPPED',
      });
      await this.operationLog.record({
        entityType: MAPPING_ENTITY_TYPE,
        entityId: synced.id,
        entityCode: synced.offerId ?? synced.platformSkuId ?? synced.id,
        action: 'MAP',
        changes: {
          mappingStatus: { from: 'UNMAPPED', to: 'MAPPED' },
          source: { from: null, to: 'IMPORT' },
        },
        operator,
      });
      // Excel 导入绑定已同步变体后同样收敛订单行（2026-10-20：此前导入是
      // 唯一不收敛的映射写入路径，批量建档后旧订单行仍停在映射异常）。
      await this.retryOrderLinesAfterMappingRepair(synced.id, operator);
      return { created: false };
    }
    const created = await this.addMappingInternal(input.listingId, input, operator);
    await this.retryOrderLinesAfterMappingRepair(created.id, operator);
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

    // Decision 0012 + 0016: a human-created mapping must carry at least one
    // RESOLUTION identifier (platform SKU id or seller SKU). Offer id alone is
    // rejected - the platform lets operators edit it, so such a row could stop
    // resolving without anyone touching WCIES. Checked after the duplicate
    // test so "already mapped" keeps winning when both apply - it is the more
    // specific diagnosis.
    const duplicate = await this.repository.findMappingByListingAndSku(listingId, variant.skuId);
    if (duplicate !== null) {
      throw new ListingSkuMappingAlreadyExistsError(listingId, variant.skuId);
    }

    const platformSkuId = variant.platformSkuId?.trim() || null;
    const sellerSku = variant.sellerSku?.trim() || null;
    // Offer id is still stored as a platform fact, just never resolves.
    const offerId = variant.offerId?.trim() || null;
    if (platformSkuId === null && sellerSku === null) {
      throw new ListingSkuMappingIdentifierRequiredError(listingId);
    }

    const mapping = await this.repository.insertMapping({
      listingId,
      skuId: variant.skuId,
      mappingStatus: 'MAPPED',
      platformSkuId,
      sellerSku,
      offerId,
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
      lastSeenAt: row.listing.lastSeenAt,
      createdAt: row.listing.createdAt,
      updatedAt: row.listing.updatedAt,
      mappingCount: row.mappingCount,
      mappingStatus: row.mappingStatus,
      hasOrderException: row.hasOrderException,
    };
  }

  private mappingToResponse(row: MappingRowWithRefs): ListingSkuResponseDto {
    return {
      id: row.mapping.id,
      listingId: row.mapping.listingId,
      skuId: row.mapping.skuId,
      mappingStatus: row.mapping.mappingStatus,
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

  /**
   * Store-scoped listing media facts by seller SKU batch (公开只读，2026-09-28
   * ERP 建议#2)。给 sync 模块的订单行补图链路用：Yandex 订单行没有
   * platformSkuId，只能按 seller_sku（=offerId）反查本店铺 Listing，从
   * raw_data 提取商品图。url 优先于 raw_data 解读，同 sellerSku 首行胜出。
   */
  async findListingMediaBySellerSkus(
    storeId: string,
    sellerSkus: readonly string[],
  ): Promise<
    Array<{
      sellerSku: string;
      listingUrl: string | null;
      listingRawData: unknown;
    }>
  > {
    return this.repository.findListingMediaBySellerSkus(storeId, sellerSkus);
  }
}

/**
 * Listing-sync variant refresh: keep a post-sync product_attributes payload
 * (OZON enrichment) the freshly mapped platform raw_data does not carry, so a
 * routine listing walk cannot silently wipe the onboarding prefill data.
 * Incoming wins when it carries its own product_attributes (WB/Yandex mappers
 * embed it at map time - fresh platform facts must not be shadowed).
 */
export function preserveEnrichedAttributes(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const current = existing?.['product_attributes'];
  if (current === undefined || incoming['product_attributes'] !== undefined) {
    return incoming;
  }
  return { ...incoming, product_attributes: current };
}
