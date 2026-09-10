import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { SkuEntity } from '../entities/sku.entity';

export interface SkuListFilters {
  keyword?: string;
  productId?: string;
  brandId?: string;
  categoryId?: string;
  status?: string;
  serialTracking?: boolean;
  hasListing?: boolean;
  platformId?: string;
  storeId?: string;
  sortBy: 'createdAt' | 'updatedAt' | 'skuCode' | 'nameZh';
  sortOrder: 'asc' | 'desc';
}

export interface SkuRowWithAggregates {
  sku: SkuEntity;
  productCode: string;
  productName: string;
  brandId: string | null;
  brandName: string | null;
  primaryBarcode: string | null;
  primaryImageKey: string | null;
  listingCount: number;
}

/**
 * Data access only - no business rules here (AGENTS.md §8).
 *
 * List aggregates (product/brand names, primary barcode, primary image,
 * listing count) are computed in ONE query with subselects (task §93).
 */
@Injectable()
export class SkuRepository {
  constructor(
    @InjectRepository(SkuEntity)
    private readonly repository: Repository<SkuEntity>,
  ) {}

  async listWithAggregates(
    filters: SkuListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: SkuRowWithAggregates[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('sku')
      .innerJoin('products', 'product', 'product.id = sku.product_id')
      .addSelect('product.productCode', 'product_code')
      .addSelect('product.nameZh', 'product_name')
      .addSelect('product.brand_id', 'brand_id')
      .addSelect('brand.name_zh', 'brand_name')
      .addSelect(
        (sub) =>
          sub
            .select('b.barcode')
            .from('sku_barcodes', 'b')
            .where('b.sku_id = sku.id')
            .andWhere('b.is_primary = true')
            .andWhere("b.status = 'ACTIVE'")
            .limit(1),
        'primary_barcode',
      )
      .addSelect(
        (sub) =>
          sub
            .select('img.object_key')
            .from('sku_images', 'img')
            .where('img.sku_id = sku.id')
            .orderBy('img.is_primary', 'DESC')
            .addOrderBy('img.sort_order', 'ASC')
            .limit(1),
        'primary_image_key',
      )
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(pls.id)')
            .from('platform_listing_skus', 'pls')
            .where('pls.sku_id = sku.id')
            .andWhere("pls.status = 'ACTIVE'"),
        'listing_count',
      )
      .leftJoin('brands', 'brand', 'brand.id = product.brand_id');

    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere(
        '(sku.sku_code ILIKE :kw OR sku.name_zh ILIKE :kw OR sku.name_ru ILIKE :kw OR sku.model ILIKE :kw)',
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.productId !== undefined) {
      qb.andWhere('sku.product_id = :productId', { productId: filters.productId });
    }
    if (filters.brandId !== undefined) {
      qb.andWhere('product.brand_id = :brandId', { brandId: filters.brandId });
    }
    if (filters.categoryId !== undefined) {
      qb.andWhere('product.category_id = :categoryId', { categoryId: filters.categoryId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('sku.status = :status', { status: filters.status });
    }
    if (filters.serialTracking !== undefined) {
      qb.andWhere('sku.serial_tracking = :serialTracking', {
        serialTracking: filters.serialTracking,
      });
    }
    if (filters.hasListing === true) {
      qb.andWhere((sub) => {
        const query = sub
          .subQuery()
          .select('1')
          .from('platform_listing_skus', 'pls_exists')
          .where('pls_exists.sku_id = sku.id')
          .andWhere("pls_exists.status = 'ACTIVE'")
          .getQuery();
        return `EXISTS ${query}`;
      });
    }
    if (filters.hasListing === false) {
      qb.andWhere((sub) => {
        const query = sub
          .subQuery()
          .select('1')
          .from('platform_listing_skus', 'pls_exists')
          .where('pls_exists.sku_id = sku.id')
          .andWhere("pls_exists.status = 'ACTIVE'")
          .getQuery();
        return `NOT EXISTS ${query}`;
      });
    }
    if (filters.platformId !== undefined || filters.storeId !== undefined) {
      qb.andWhere((sub) => {
        const inner = sub
          .subQuery()
          .select('1')
          .from('platform_listing_skus', 'pls_store')
          .innerJoin('platform_listings', 'pl_store', 'pl_store.id = pls_store.listing_id')
          .where('pls_store.sku_id = sku.id')
          .andWhere("pls_store.status = 'ACTIVE'");
        if (filters.platformId !== undefined) {
          inner.andWhere('pl_store.platform_id = :platformIdFilter');
          qb.setParameter('platformIdFilter', filters.platformId);
        }
        if (filters.storeId !== undefined) {
          inner.andWhere('pl_store.store_id = :storeIdFilter');
          qb.setParameter('storeIdFilter', filters.storeId);
        }
        return `EXISTS ${inner.getQuery()}`;
      });
    }

    const column = {
      createdAt: 'sku.createdAt',
      updatedAt: 'sku.updatedAt',
      skuCode: 'sku.skuCode',
      nameZh: 'sku.nameZh',
    }[filters.sortBy];

    qb.orderBy(column, filters.sortOrder === 'asc' ? 'ASC' : 'DESC')
      .skip(offset)
      .take(limit);

    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;

    const rows: SkuRowWithAggregates[] = rawList.map((raw, index) => ({
      sku: entities[index] as SkuEntity,
      productCode: String(raw['product_code'] as string),
      productName: String(raw['product_name'] as string),
      brandId: raw['brand_id'] === null ? null : String(raw['brand_id'] as string),
      brandName: raw['brand_name'] === null ? null : String(raw['brand_name'] as string),
      primaryBarcode:
        raw['primary_barcode'] === null ? null : String(raw['primary_barcode'] as string),
      primaryImageKey:
        raw['primary_image_key'] === null ? null : String(raw['primary_image_key'] as string),
      listingCount: Number(raw['listing_count'] ?? 0),
    }));
    return { rows, total };
  }

  async findById(id: string): Promise<SkuEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findByCode(skuCode: string): Promise<SkuEntity | null> {
    return this.repository.findOneBy({ skuCode });
  }

  async insert(sku: Partial<SkuEntity>): Promise<SkuEntity> {
    const created = this.repository.create(sku as unknown as DeepPartial<SkuEntity>);
    return this.repository.save(created);
  }

  async update(id: string, patch: Partial<SkuEntity>): Promise<void> {
    await this.repository.update({ id }, patch);
  }

  async listByProductIds(productIds: string[]): Promise<SkuEntity[]> {
    if (productIds.length === 0) {
      return [];
    }
    return this.repository
      .createQueryBuilder('sku')
      .where('sku.product_id IN (:...productIds)', { productIds })
      .orderBy('sku.skuCode', 'ASC')
      .getMany();
  }
}
