import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, QueryDeepPartialEntity, Repository } from 'typeorm';
import { PlatformListingEntity } from '../entities/platform-listing.entity';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

/**
 * The single definition of "this listing is mapped": it has at least one
 * ACTIVE variant bound to an internal SKU. Used by the derived status column,
 * the mapped/unmapped counters and the mappingState filter - they must all
 * agree, otherwise one page shows a row as 未映射 while its own counter says
 * 已映射. The `pls.` alias is substituted per query.
 */
const MAPPED_VARIANT_CONDITIONS =
  "pls.status = 'ACTIVE' AND pls.mapping_status = 'MAPPED' AND pls.sku_id IS NOT NULL";

/**
 * In-memory twin of MAPPED_VARIANT_CONDITIONS for paths that already hold the
 * mapping rows (create / detail), so the derived status does not need a second
 * query and cannot diverge from the list query's SQL.
 */
export function isMappedVariant(row: {
  status: string;
  mappingStatus: string;
  skuId: string | null;
}): boolean {
  return row.status === 'ACTIVE' && row.mappingStatus === 'MAPPED' && row.skuId !== null;
}

export function deriveMappingStatus(
  rows: ReadonlyArray<{ status: string; mappingStatus: string; skuId: string | null }>,
): 'MAPPED' | 'UNMAPPED' {
  return rows.some((row) => isMappedVariant(row)) ? 'MAPPED' : 'UNMAPPED';
}

export interface ListingListFilters {
  platformId?: string;
  storeId?: string;
  skuId?: string;
  status?: string;
  keyword?: string;
  /** MAPPED = has at least one ACTIVE mapping; UNMAPPED = none. */
  mappingState?: 'MAPPED' | 'UNMAPPED';
}

export interface ListingRowWithRefs {
  listing: PlatformListingEntity;
  platformCode: string;
  storeCode: string;
  storeName: string;
  /** Total variant rows on the listing (any status). */
  mappingCount: number;
  /** Derived from MAPPED_VARIANT_CONDITIONS, not from a separate count. */
  mappingStatus: 'MAPPED' | 'UNMAPPED';
  /**
   * Sprint 8 T3: an OPEN ORDER_SKU_MAPPING_FAILED exception points at this
   * listing (via order item identifiers). Derived display fact only - it
   * never gates any write.
   */
  hasOrderException: boolean;
}

export interface MappingRowWithRefs {
  mapping: PlatformListingSkuEntity;
  skuCode: string | null;
  skuName: string | null;
}

/** Resolve candidate: a mapping row joined with its listing's store scope. */
export interface ResolveCandidate {
  mapping: PlatformListingSkuEntity;
  listingId: string;
  storeId: string;
}

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class ListingRepository {
  constructor(
    @InjectRepository(PlatformListingEntity)
    private readonly listingRepository: Repository<PlatformListingEntity>,
    @InjectRepository(PlatformListingSkuEntity)
    private readonly mappingRepository: Repository<PlatformListingSkuEntity>,
  ) {}

  // ---- Listings ----

  async listWithRefs(
    filters: ListingListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ListingRowWithRefs[]; total: number }> {
    const qb = this.listingRepository
      .createQueryBuilder('listing')
      .innerJoin('platforms', 'platform', 'platform.id = listing.platform_id')
      .innerJoin('stores', 'store', 'store.id = listing.store_id')
      .addSelect('platform.code', 'platform_code')
      .addSelect('store.store_code', 'store_code')
      .addSelect('store.name', 'store_name')
      // Total variants on the listing. Same meaning as the detail endpoint's
      // mappingCount, which counts every mapping row.
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(pls.id)')
            .from('platform_listing_skus', 'pls')
            .where('pls.listing_id = listing.id'),
        'mapping_count',
      )
      // Derived mapped state, computed from MAPPED_VARIANT_CONDITIONS - the
      // same fragment the mappingState filter uses, so the status column can
      // never contradict the mapped/unmapped counters on the same page.
      .addSelect(
        (sub) =>
          sub
            .select(`CASE WHEN COUNT(pls_mapped.id) > 0 THEN 'MAPPED' ELSE 'UNMAPPED' END`)
            .from('platform_listing_skus', 'pls_mapped')
            .where('pls_mapped.listing_id = listing.id')
            .andWhere(MAPPED_VARIANT_CONDITIONS.replaceAll('pls.', 'pls_mapped.')),
        'mapping_status',
      )
      // Sprint 8 T3: "an order ran into this unmapped listing" - an OPEN
      // ORDER_SKU_MAPPING_FAILED exception whose order item points at this
      // listing by store + platform identifiers. Derived fact, no writes.
      // Sprint 8.5 real-data fix: OZON order lines carry the SKU id in
      // platform_product_id while listings are keyed by product id, so the
      // match must ALSO hit the listing's variant platform_sku_id (the
      // documented intent: the exception "runs into" this listing).
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(se.id) > 0')
            .from('system_exceptions', 'se')
            .innerJoin('order_items', 'exc_oi', 'exc_oi.id = se.reference_id')
            .innerJoin('orders', 'exc_o', 'exc_o.id = exc_oi.order_id')
            .where("se.exception_type = 'ORDER_SKU_MAPPING_FAILED'")
            .andWhere("se.status = 'OPEN'")
            .andWhere("se.reference_type = 'ORDER_ITEM'")
            .andWhere('exc_o.store_id = listing.store_id')
            .andWhere(
              `(exc_oi.platform_product_id = listing.platform_product_id
                 OR EXISTS (
                   SELECT 1 FROM platform_listing_skus exc_pls
                   WHERE exc_pls.listing_id = listing.id
                     AND exc_pls.platform_sku_id = exc_oi.platform_product_id
                     AND exc_pls.platform_sku_id IS NOT NULL))`,
            ),
        'has_order_exception',
      );

    if (filters.platformId !== undefined) {
      qb.andWhere('listing.platform_id = :platformId', { platformId: filters.platformId });
    }
    if (filters.storeId !== undefined) {
      qb.andWhere('listing.store_id = :storeId', { storeId: filters.storeId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('listing.status = :status', { status: filters.status });
    }
    if (filters.keyword !== undefined && filters.keyword !== '') {
      // Keyword spans the listing's own identity (platform product_id, title)
      // AND every variant identifier (platform sku, offer_id, seller_sku) plus
      // the mapped internal SKU code. The exception center deep-links here
      // with whichever identifier the ORDER_SKU_MAPPING_FAILED payload
      // carries - usually the offer_id - so the search must accept all of
      // them or the deep link lands on an empty result.
      qb.andWhere(
        `(listing.platform_product_id ILIKE :kw
          OR listing.title ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM platform_listing_skus kw_pls
            WHERE kw_pls.listing_id = listing.id
              AND (kw_pls.platform_sku_id ILIKE :kw
                   OR kw_pls.offer_id ILIKE :kw
                   OR kw_pls.seller_sku ILIKE :kw
                   OR (kw_pls.sku_id IS NOT NULL AND EXISTS (
                        SELECT 1 FROM skus kw_sku
                        WHERE kw_sku.id = kw_pls.sku_id
                          AND (kw_sku.sku_code ILIKE :kw
                               OR kw_sku.name_zh ILIKE :kw
                               OR kw_sku.name_ru ILIKE :kw))))))`,
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.skuId !== undefined || filters.mappingState !== undefined) {
      qb.andWhere((sub) => {
        const inner = sub
          .subQuery()
          .select('1')
          .from('platform_listing_skus', 'pls_filter')
          .where('pls_filter.listing_id = listing.id')
          .andWhere(MAPPED_VARIANT_CONDITIONS.replaceAll('pls.', 'pls_filter.'));
        if (filters.skuId !== undefined) {
          inner.andWhere('pls_filter.sku_id = :skuIdFilter');
          qb.setParameter('skuIdFilter', filters.skuId);
        }
        const query = inner.getQuery();
        // Sprint 5 §36: UNMAPPED = listing has no MAPPED variant (may still
        // carry synced UNMAPPED platform-SKU facts).
        return filters.mappingState === 'UNMAPPED' ? `NOT EXISTS ${query}` : `EXISTS ${query}`;
      });
    }

    // Sprint 8 T3: in the UNMAPPED workbench, listings an order has already
    // run into (open mapping-failed exceptions) sort to the top so the rows
    // that actually block fulfillment are processed first, not found by
    // paging through sync order. (orderBy resets the list - use it first.)
    if (filters.mappingState === 'UNMAPPED') {
      qb.orderBy('has_order_exception', 'DESC').addOrderBy('listing.createdAt', 'DESC');
    } else {
      qb.orderBy('listing.createdAt', 'DESC');
    }
    qb.skip(offset).take(limit);

    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;

    const rows: ListingRowWithRefs[] = rawList.map((raw, index) => ({
      listing: entities[index] as PlatformListingEntity,
      platformCode: String(raw['platform_code'] as string),
      storeCode: String(raw['store_code'] as string),
      storeName: String(raw['store_name'] as string),
      mappingCount: Number(raw['mapping_count'] ?? 0),
      mappingStatus: raw['mapping_status'] === 'MAPPED' ? 'MAPPED' : 'UNMAPPED',
      hasOrderException: raw['has_order_exception'] === true,
    }));
    return { rows, total };
  }

  async findListingById(id: string): Promise<PlatformListingEntity | null> {
    return this.listingRepository.findOneBy({ id });
  }

  async findListingByStoreAndProductId(
    storeId: string,
    platformProductId: string,
  ): Promise<PlatformListingEntity | null> {
    return this.listingRepository.findOneBy({ storeId, platformProductId });
  }

  async insertListing(listing: Partial<PlatformListingEntity>): Promise<PlatformListingEntity> {
    const created = this.listingRepository.create(
      listing as unknown as DeepPartial<PlatformListingEntity>,
    );
    return this.listingRepository.save(created);
  }

  async updateListing(id: string, patch: Partial<PlatformListingEntity>): Promise<void> {
    await this.listingRepository.update(
      { id },
      patch as unknown as QueryDeepPartialEntity<PlatformListingEntity>,
    );
  }

  // ---- Mappings ----

  async listMappingsByListingId(listingId: string): Promise<MappingRowWithRefs[]> {
    const qb = this.mappingRepository
      .createQueryBuilder('pls')
      // LEFT JOIN since Sprint 5: UNMAPPED rows carry sku_id = NULL.
      .leftJoin('skus', 'sku', 'sku.id = pls.sku_id')
      .addSelect('sku.sku_code', 'sku_code')
      .addSelect('sku.name_zh', 'sku_name')
      .where('pls.listing_id = :listingId', { listingId })
      .orderBy('pls.createdAt', 'ASC');
    const { raw: rawRows, entities } = await qb.getRawAndEntities();
    const rawList = rawRows as Array<Record<string, unknown>>;
    return rawList.map((raw, index) => ({
      mapping: entities[index] as PlatformListingSkuEntity,
      skuCode: raw['sku_code'] === null ? null : String(raw['sku_code'] as string),
      skuName: raw['sku_name'] === null ? null : String(raw['sku_name'] as string),
    }));
  }

  async listMappingsBySkuId(skuId: string): Promise<
    Array<{
      mapping: PlatformListingSkuEntity;
      listing: PlatformListingEntity;
      platformCode: string;
      storeCode: string;
    }>
  > {
    const qb = this.mappingRepository
      .createQueryBuilder('pls')
      .innerJoin('platform_listings', 'listing', 'listing.id = pls.listing_id')
      .innerJoin('platforms', 'platform', 'platform.id = listing.platform_id')
      .innerJoin('stores', 'store', 'store.id = listing.store_id')
      .addSelect('listing.id', 'p_listing_id')
      .addSelect('listing.platform_id', 'p_platform_id')
      .addSelect('listing.store_id', 'p_store_id')
      .addSelect('listing.platform_product_id', 'p_platform_product_id')
      .addSelect('listing.title', 'p_title')
      .addSelect('listing.url', 'p_url')
      .addSelect('listing.status', 'p_status')
      .addSelect('platform.code', 'p_platform_code')
      .addSelect('store.store_code', 'p_store_code')
      .where('pls.sku_id = :skuId', { skuId })
      .orderBy('pls.createdAt', 'ASC');
    const { raw: rawRows, entities } = await qb.getRawAndEntities();
    const rawList = rawRows as Array<Record<string, unknown>>;
    return rawList.map((raw, index) => ({
      mapping: entities[index] as PlatformListingSkuEntity,
      listing: {
        id: String(raw['p_listing_id'] as string),
        platformId: String(raw['p_platform_id'] as string),
        storeId: String(raw['p_store_id'] as string),
        platformProductId: String(raw['p_platform_product_id'] as string),
        title: raw['p_title'] === null ? null : String(raw['p_title'] as string),
        url: raw['p_url'] === null ? null : String(raw['p_url'] as string),
        status: String(raw['p_status'] as string),
        rawData: null,
        lastSeenAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } satisfies PlatformListingEntity,
      platformCode: String(raw['p_platform_code'] as string),
      storeCode: String(raw['p_store_code'] as string),
    }));
  }

  async findMappingById(id: string): Promise<PlatformListingSkuEntity | null> {
    return this.mappingRepository.findOneBy({ id });
  }

  /**
   * Sprint 8.5 T1: row lock on the mapping INSIDE the onboarding
   * transaction. Taking the lock first serializes "check -> create -> map"
   * end to end, so two concurrent onboards of the same variant cannot both
   * build master data (the loser re-checks after the lock and gets the same
   * 409 as a plain double submit).
   */
  async lockMappingByIdInTx(
    manager: EntityManager,
    id: string,
  ): Promise<PlatformListingSkuEntity | null> {
    const rows = await manager
      .getRepository(PlatformListingSkuEntity)
      .createQueryBuilder('pls')
      .setLock('pessimistic_write')
      .where('pls.id = :id', { id })
      .getOne();
    return rows ?? null;
  }

  /**
   * Sprint 8.5: one join feed for the onboarding dialog - variant rows with
   * their mapped internal SKU code plus the raw_data fields the dialog
   * consumes (images, platform category keys, v4-enriched dimensions).
   *
   * V1 (2026-10-13): the products join is gone with the product layer -
   * a mapped variant references its internal SKU directly.
   */
  async listOnboardContextVariants(listingId: string): Promise<
    Array<{
      mapping: PlatformListingSkuEntity;
      skuCode: string | null;
    }>
  > {
    const qb = this.mappingRepository
      .createQueryBuilder('pls')
      .leftJoin('skus', 'sku', 'sku.id = pls.sku_id')
      .addSelect('sku.sku_code', 'sku_code')
      .where('pls.listing_id = :listingId', { listingId })
      .orderBy('pls.createdAt', 'ASC');
    const { raw: rawRows, entities } = await qb.getRawAndEntities();
    const rawList = rawRows as Array<Record<string, unknown>>;
    return rawList.map((raw, index) => ({
      mapping: entities[index] as PlatformListingSkuEntity,
      skuCode: raw['sku_code'] === null ? null : String(raw['sku_code'] as string),
    }));
  }

  /**
   * Sprint 8.5 T5: variant rows of a store that have no v4 attribute payload
   * yet, keyed by their listing's platform_product_id (the v4 filter key).
   */
  async listEnrichmentTargets(storeId: string, limit: number): Promise<string[]> {
    const rows = await this.listingRepository.query<Array<{ platform_product_id: string }>>(
      `SELECT DISTINCT listing.platform_product_id
       FROM platform_listing_skus pls
       INNER JOIN platform_listings listing ON listing.id = pls.listing_id
       WHERE listing.store_id = $1
         AND pls.status = 'ACTIVE'
         AND pls.raw_data->'product_attributes' IS NULL
       LIMIT $2`,
      [storeId, limit],
    );
    return rows.map((row) => row.platform_product_id);
  }

  /**
   * Sprint 8.5 T5: merges the v4 attribute payload into the variant rows'
   * raw_data under the DEDICATED product_attributes key (existing keys are
   * never touched). Rows already carrying the key are skipped (idempotent
   * re-runs). Returns the number of updated variant rows.
   */
  async mergeProductAttributes(
    storeId: string,
    platformProductId: string,
    attributes: Record<string, unknown>,
  ): Promise<number> {
    const result = await this.listingRepository.query<Array<{ id: string }>>(
      `UPDATE platform_listing_skus pls
       SET raw_data = COALESCE(pls.raw_data, '{}'::jsonb) || jsonb_build_object('product_attributes', $3::jsonb),
           updated_at = now()
       FROM platform_listings listing
       WHERE listing.id = pls.listing_id
         AND listing.store_id = $1
         AND listing.platform_product_id = $2
         AND pls.status = 'ACTIVE'
         AND pls.raw_data->'product_attributes' IS NULL
       RETURNING pls.id`,
      [storeId, platformProductId, JSON.stringify(attributes)],
    );
    return result.length;
  }

  /** Sync upsert lookup (Sprint 5 §19): ACTIVE row by platform SKU id. */
  async findActiveMappingByListingAndPlatformSkuId(
    listingId: string,
    platformSkuId: string,
  ): Promise<PlatformListingSkuEntity | null> {
    return this.mappingRepository.findOneBy({ listingId, platformSkuId, status: 'ACTIVE' });
  }

  /**
   * Dedup for seller-SKU-keyed variant rows (2026-10-20，订单事实兜底建链）：
   * Yandex 等平台的订单行只带 offerId（= sellerSku），没有 marketSku，
   * 无法按 platform_sku_id 去重；同一链接内 sellerSku 唯一，可按它对齐。
   */
  async findActiveMappingByListingAndSellerSku(
    listingId: string,
    sellerSku: string,
  ): Promise<PlatformListingSkuEntity | null> {
    return this.mappingRepository.findOneBy({ listingId, sellerSku, status: 'ACTIVE' });
  }

  async findMappingByListingAndSku(
    listingId: string,
    skuId: string,
  ): Promise<PlatformListingSkuEntity | null> {
    return this.mappingRepository.findOneBy({ listingId, skuId });
  }

  async insertMapping(
    mapping: Partial<PlatformListingSkuEntity>,
  ): Promise<PlatformListingSkuEntity> {
    const created = this.mappingRepository.create(
      mapping as unknown as DeepPartial<PlatformListingSkuEntity>,
    );
    return this.mappingRepository.save(created);
  }

  async updateMapping(id: string, patch: Partial<PlatformListingSkuEntity>): Promise<void> {
    await this.mappingRepository.update(
      { id },
      patch as unknown as QueryDeepPartialEntity<PlatformListingSkuEntity>,
    );
  }

  async deleteMapping(id: string): Promise<void> {
    await this.mappingRepository.delete({ id });
  }

  async deleteListing(id: string): Promise<void> {
    await this.listingRepository.delete({ id });
  }

  /** Variant mappings that block deleting the listing (decision 0003). */
  async countListingReferences(id: string): Promise<number> {
    const rows = await this.listingRepository.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM platform_listing_skus WHERE listing_id = $1',
      [id],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /** Order lines referencing a mapping - blocks its delete (spec §66). */
  async countMappingOrderReferences(mappingId: string): Promise<number> {
    const rows = await this.listingRepository.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM order_items WHERE listing_sku_id = $1',
      [mappingId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  // ---- Derived counters / export (Sprint 8 T2/T3) ----

  /**
   * Global MAPPED/UNMAPPED listing counters. Uses the same
   * MAPPED_VARIANT_CONDITIONS fragment as the list query and the filter, so
   * "1323 条未映射" on the page can never disagree with the 待映射 filter.
   */
  async countMappingStates(): Promise<{ mapped: number; unmapped: number }> {
    const rows = await this.listingRepository.query<Array<{ mapped: string; unmapped: string }>>(
      `SELECT
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM platform_listing_skus pls_m
           WHERE pls_m.listing_id = platform_listings.id
             AND ${MAPPED_VARIANT_CONDITIONS.replaceAll('pls.', 'pls_m.')}
         ))::text AS mapped,
         COUNT(*) FILTER (WHERE NOT EXISTS (
           SELECT 1 FROM platform_listing_skus pls_u
           WHERE pls_u.listing_id = platform_listings.id
             AND ${MAPPED_VARIANT_CONDITIONS.replaceAll('pls.', 'pls_u.')}
         ))::text AS unmapped
       FROM platform_listings`,
    );
    return {
      mapped: Number(rows[0]?.mapped ?? 0),
      unmapped: Number(rows[0]?.unmapped ?? 0),
    };
  }

  /**
   * Unmapped ACTIVE variant rows joined with their listing/store context for
   * the Excel export (Sprint 8 T2). Variant-level - the export/import
   * template is per platform-SKU row, and a listing with zero synced variant
   * facts carries no identifiers to round-trip.
   */
  async listUnmappedVariantsForExport(filters: { platformId?: string; storeId?: string }): Promise<
    Array<{
      platformCode: string;
      storeCode: string;
      platformProductId: string;
      platformSkuId: string | null;
      sellerSku: string | null;
      offerId: string | null;
      title: string | null;
      url: string | null;
    }>
  > {
    const params: unknown[] = [];
    const where: string[] = [
      'pls.sku_id IS NULL',
      "pls.mapping_status = 'UNMAPPED'",
      "pls.status = 'ACTIVE'",
    ];
    if (filters.platformId !== undefined) {
      params.push(filters.platformId);
      where.push(`listing.platform_id = $${params.length}`);
    }
    if (filters.storeId !== undefined) {
      params.push(filters.storeId);
      where.push(`listing.store_id = $${params.length}`);
    }
    interface ExportRow {
      platform_code: string;
      store_code: string;
      platform_product_id: string;
      platform_sku_id: string | null;
      seller_sku: string | null;
      offer_id: string | null;
      title: string | null;
      url: string | null;
    }
    const rows = await this.listingRepository.query<ExportRow[]>(
      `SELECT platform.code AS platform_code,
              store.store_code AS store_code,
              listing.platform_product_id AS platform_product_id,
              pls.platform_sku_id AS platform_sku_id,
              pls.seller_sku AS seller_sku,
              pls.offer_id AS offer_id,
              listing.title AS title,
              listing.url AS url
       FROM platform_listing_skus pls
       INNER JOIN platform_listings listing ON listing.id = pls.listing_id
       INNER JOIN platforms platform ON platform.id = listing.platform_id
       INNER JOIN stores store ON store.id = listing.store_id
       WHERE ${where.join(' AND ')}
       ORDER BY platform.code, store.store_code, listing.platform_product_id, pls.platform_sku_id`,
      params,
    );
    return rows.map((row) => ({
      platformCode: row.platform_code,
      storeCode: row.store_code,
      platformProductId: row.platform_product_id,
      platformSkuId: row.platform_sku_id,
      sellerSku: row.seller_sku,
      offerId: row.offer_id,
      title: row.title,
      url: row.url,
    }));
  }

  /**
   * Active UNMAPPED synced variant on a listing matching any provided
   * identifier (platform SKU id first, then seller SKU), so the
   * LISTING_MAPPING import binds the synced row instead of inserting a twin
   * (Sprint 8 T2 closed loop). Offer id is not a binding identifier
   * (decision 0016: the platform lets operators edit it).
   */
  async findUnmappedVariantByIdentifiers(
    listingId: string,
    input: { platformSkuId?: string | null; sellerSku?: string | null },
  ): Promise<PlatformListingSkuEntity | null> {
    const qb = this.mappingRepository
      .createQueryBuilder('pls')
      .where('pls.listing_id = :listingId', { listingId })
      .andWhere('pls.sku_id IS NULL')
      .andWhere("pls.mapping_status = 'UNMAPPED'")
      .andWhere("pls.status = 'ACTIVE'");
    // Identifier priority: platform SKU id first (sync rows are keyed by it),
    // then seller SKU. Offer id is DELIBERATELY absent (decision 0016): it is
    // editable on the platform, so binding by it would silently drift.
    const ordered: Array<[string | null | undefined, string]> = [
      [input.platformSkuId, 'platform_sku_id'],
      [input.sellerSku, 'seller_sku'],
    ];
    const conditions: string[] = [];
    let priorityCase: string | null = null;
    for (const [value, column] of ordered) {
      const trimmed = value?.trim();
      if (trimmed === undefined || trimmed === '') {
        continue;
      }
      const param = `id_${column}`;
      conditions.push(`pls.${column} = :${param}`);
      qb.setParameter(param, trimmed);
      if (priorityCase === null) {
        priorityCase = `CASE WHEN pls.${column} = :${param} THEN 0 ELSE 1 END`;
      }
    }
    if (conditions.length === 0) {
      return null;
    }
    qb.andWhere(`(${conditions.join(' OR ')})`).orderBy(priorityCase as string, 'ASC');
    return qb.getOne();
  }

  /**
   * Store-scoped lookup of an UNMAPPED variant by order-line identifiers
   * (2026-10-20 按需补链接的「本地优先」检查）：同一店铺可能有多条链接
   * 引用同一变体，命中任意一条即可继续映射流程，无需再打平台接口。
   * Offer id 不参与（decision 0016）。
   */
  async findUnmappedVariantByStoreAndIdentifiers(
    storeId: string,
    input: { platformSkuId?: string | null; sellerSku?: string | null },
  ): Promise<{ listingId: string; variantId: string } | null> {
    const qb = this.mappingRepository
      .createQueryBuilder('pls')
      .innerJoin('platform_listings', 'listing', 'listing.id = pls.listing_id')
      .select(['pls.id AS variant_id', 'pls.listing_id AS listing_id'])
      .where('listing.store_id = :storeId', { storeId })
      .andWhere("listing.status = 'ACTIVE'")
      .andWhere("pls.status = 'ACTIVE'")
      .andWhere('pls.sku_id IS NULL')
      .andWhere("pls.mapping_status = 'UNMAPPED'");
    const conditions: string[] = [];
    const platformSkuId = input.platformSkuId?.trim();
    if (platformSkuId !== undefined && platformSkuId !== '') {
      conditions.push('pls.platform_sku_id = :platformSkuId');
      qb.setParameter('platformSkuId', platformSkuId);
    }
    const sellerSku = input.sellerSku?.trim();
    if (sellerSku !== undefined && sellerSku !== '') {
      conditions.push('pls.seller_sku = :sellerSku');
      qb.setParameter('sellerSku', sellerSku);
    }
    if (conditions.length === 0) {
      return null;
    }
    const row = await qb
      .andWhere(`(${conditions.join(' OR ')})`)
      .orderBy('pls.created_at', 'ASC')
      .limit(1)
      .getRawOne<{ variant_id: string; listing_id: string }>();
    return row === undefined
      ? null
      : { variantId: String(row.variant_id), listingId: String(row.listing_id) };
  }

  // ---- Resolver ----

  /**
   * STRICTLY store-scoped candidate search (task §52): the query ALWAYS
   * carries store_id; global identifier lookups are forbidden. Matches any
   * provided identifier; ambiguity detection is the caller's job.
   *
   * Decision 0016: offer id is NOT a resolution identifier - the platform
   * lets operators edit it, so a mapping that can only be found by offer id
   * would drift out from under the orders it serves.
   */
  async findResolveCandidates(input: {
    storeId: string;
    platformSkuId?: string;
    sellerSku?: string;
  }): Promise<ResolveCandidate[]> {
    const qb = this.mappingRepository
      .createQueryBuilder('pls')
      .innerJoin('platform_listings', 'listing', 'listing.id = pls.listing_id')
      .where('listing.store_id = :storeId', { storeId: input.storeId })
      .andWhere('listing.status = :listingActive', { listingActive: 'ACTIVE' })
      .andWhere('pls.status = :mappingActive', { mappingActive: 'ACTIVE' })
      // Sprint 5 §18: UNMAPPED rows (sku_id NULL) are facts, never resolvable.
      .andWhere('pls.sku_id IS NOT NULL')
      .andWhere('pls.mapping_status = :mapped', { mapped: 'MAPPED' });

    const conditions: string[] = [];
    if (input.platformSkuId !== undefined && input.platformSkuId !== '') {
      conditions.push('pls.platform_sku_id = :platformSkuId');
      qb.setParameter('platformSkuId', input.platformSkuId);
    }
    if (input.sellerSku !== undefined && input.sellerSku !== '') {
      conditions.push('pls.seller_sku = :sellerSku');
      qb.setParameter('sellerSku', input.sellerSku);
    }
    qb.andWhere(`(${conditions.join(' OR ')})`);

    const rows = await qb.getMany();
    return rows.map((mapping) => ({
      mapping,
      listingId: mapping.listingId,
      storeId: input.storeId,
    }));
  }

  /**
   * Store-scoped listing media facts by seller SKU batch (2026-09-28, ERP
   * 建议#2: Yandex 订单行补图). Returns each matching ACTIVE variant's listing
   * url + the listing's raw platform payload; the caller owns any platform
   * specific interpretation of raw_data. One seller SKU may sit on several
   * links (§25) - rows come newest-listing-first and the caller dedupes
   * first-wins.
   */
  /**
   * 订单行补图（WB，2026-10-22）：WB 订单行带条码（platform_sku_id），卡片按
   * `sizes[].skus[]` 落到 listing 变体的 platform_sku_id —— 这是比 seller_sku
   * 更可靠的键（offerId/vendorCode 可能被卖家改名）。一次查全页，不逐行。
   */
  async findListingMediaByPlatformSkuIds(
    storeId: string,
    platformSkuIds: readonly string[],
  ): Promise<
    Array<{
      platformSkuId: string;
      listingUrl: string | null;
      listingRawData: unknown;
    }>
  > {
    if (platformSkuIds.length === 0) return [];
    const rows = await this.listingRepository.query<
      Array<{
        platform_sku_id: string | null;
        listing_url: string | null;
        listing_raw_data: unknown;
      }>
    >(
      `SELECT pls.platform_sku_id, listing.url AS listing_url, listing.raw_data AS listing_raw_data
       FROM platform_listing_skus pls
       INNER JOIN platform_listings listing ON listing.id = pls.listing_id
       WHERE listing.store_id = $1::uuid
         AND listing.status = 'ACTIVE'
         AND pls.status = 'ACTIVE'
         AND pls.platform_sku_id = ANY($2::varchar[])
       ORDER BY listing.updated_at DESC`,
      [storeId, [...platformSkuIds]],
    );
    return rows.flatMap((row) =>
      row.platform_sku_id === null
        ? []
        : [
            {
              platformSkuId: row.platform_sku_id,
              listingUrl: row.listing_url,
              listingRawData: row.listing_raw_data,
            },
          ],
    );
  }

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
    if (sellerSkus.length === 0) return [];
    const rows = await this.listingRepository.query<
      Array<{ seller_sku: string | null; listing_url: string | null; listing_raw_data: unknown }>
    >(
      `SELECT pls.seller_sku, listing.url AS listing_url, listing.raw_data AS listing_raw_data
       FROM platform_listing_skus pls
       INNER JOIN platform_listings listing ON listing.id = pls.listing_id
       WHERE listing.store_id = $1::uuid
         AND listing.status = 'ACTIVE'
         AND pls.status = 'ACTIVE'
         AND pls.seller_sku = ANY($2::varchar[])
       ORDER BY listing.updated_at DESC`,
      [storeId, [...sellerSkus]],
    );
    return rows.flatMap((row) =>
      row.seller_sku === null
        ? []
        : [
            {
              sellerSku: row.seller_sku,
              listingUrl: row.listing_url,
              listingRawData: row.listing_raw_data,
            },
          ],
    );
  }
}
