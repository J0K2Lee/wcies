import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, QueryDeepPartialEntity, Repository } from 'typeorm';
import { PlatformListingEntity } from '../entities/platform-listing.entity';
import { PlatformListingSkuEntity } from '../entities/platform-listing-sku.entity';

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
  mappingCount: number;
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
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(pls.id)')
            .from('platform_listing_skus', 'pls')
            .where('pls.listing_id = listing.id')
            .andWhere("pls.status = 'ACTIVE'")
            .andWhere("pls.mapping_status = 'MAPPED'"),
        'mapping_count',
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
      qb.andWhere('(listing.platform_product_id ILIKE :kw OR listing.title ILIKE :kw)', {
        kw: `%${filters.keyword}%`,
      });
    }
    if (filters.skuId !== undefined || filters.mappingState !== undefined) {
      qb.andWhere((sub) => {
        const inner = sub
          .subQuery()
          .select('1')
          .from('platform_listing_skus', 'pls_filter')
          .where('pls_filter.listing_id = listing.id')
          .andWhere("pls_filter.status = 'ACTIVE'")
          .andWhere("pls_filter.mapping_status = 'MAPPED'");
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

    qb.orderBy('listing.createdAt', 'DESC').skip(offset).take(limit);

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

  /** Sync upsert lookup (Sprint 5 §19): ACTIVE row by platform SKU id. */
  async findActiveMappingByListingAndPlatformSkuId(
    listingId: string,
    platformSkuId: string,
  ): Promise<PlatformListingSkuEntity | null> {
    return this.mappingRepository.findOneBy({ listingId, platformSkuId, status: 'ACTIVE' });
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

  // ---- Resolver ----

  /**
   * STRICTLY store-scoped candidate search (task §52): the query ALWAYS
   * carries store_id; global identifier lookups are forbidden. Matches any
   * provided identifier; ambiguity detection is the caller's job.
   */
  async findResolveCandidates(input: {
    storeId: string;
    platformSkuId?: string;
    sellerSku?: string;
    offerId?: string;
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
    if (input.offerId !== undefined && input.offerId !== '') {
      conditions.push('pls.offer_id = :offerId');
      qb.setParameter('offerId', input.offerId);
    }
    qb.andWhere(`(${conditions.join(' OR ')})`);

    const rows = await qb.getMany();
    return rows.map((mapping) => ({
      mapping,
      listingId: mapping.listingId,
      storeId: input.storeId,
    }));
  }
}
