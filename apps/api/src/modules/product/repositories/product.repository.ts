import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { ProductEntity } from '../entities/product.entity';

export interface ProductListFilters {
  keyword?: string;
  brandId?: string;
  categoryId?: string;
  status?: string;
  sortBy: 'createdAt' | 'updatedAt' | 'productCode' | 'nameZh';
  sortOrder: 'asc' | 'desc';
}

export interface ProductRowWithCounts {
  product: ProductEntity;
  brandName: string | null;
  categoryName: string | null;
  skuCount: number;
}

/**
 * Data access only - no business rules here (AGENTS.md §8).
 * skuCount/brand/category names come from a single joined query (task §93).
 */
@Injectable()
export class ProductRepository {
  constructor(
    @InjectRepository(ProductEntity)
    private readonly repository: Repository<ProductEntity>,
  ) {}

  async listWithCounts(
    filters: ProductListFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ProductRowWithCounts[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('product')
      .leftJoin('brands', 'brand', 'brand.id = product.brand_id')
      .leftJoin('categories', 'category', 'category.id = product.category_id')
      .addSelect('brand.name_zh', 'brand_name')
      .addSelect('category.name_zh', 'category_name')
      .addSelect(
        (sub) =>
          sub.select('COUNT(sku.id)').from('skus', 'sku').where('sku.product_id = product.id'),
        'sku_count',
      );

    if (filters.keyword !== undefined && filters.keyword !== '') {
      qb.andWhere(
        '(product.product_code ILIKE :kw OR product.name_zh ILIKE :kw OR product.name_ru ILIKE :kw)',
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.brandId !== undefined) {
      qb.andWhere('product.brand_id = :brandId', { brandId: filters.brandId });
    }
    if (filters.categoryId !== undefined) {
      qb.andWhere('product.category_id = :categoryId', { categoryId: filters.categoryId });
    }
    if (filters.status !== undefined) {
      qb.andWhere('product.status = :status', { status: filters.status });
    }

    const column = {
      createdAt: 'product.createdAt',
      updatedAt: 'product.updatedAt',
      productCode: 'product.productCode',
      nameZh: 'product.nameZh',
    }[filters.sortBy];

    qb.orderBy(column, filters.sortOrder === 'asc' ? 'ASC' : 'DESC')
      .skip(offset)
      .take(limit);

    const [{ raw: rawRows, entities }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);
    const rawList = rawRows as Array<Record<string, unknown>>;

    const rows: ProductRowWithCounts[] = rawList.map((raw, index) => ({
      product: entities[index] as ProductEntity,
      brandName: raw['brand_name'] === null ? null : String(raw['brand_name'] as string),
      categoryName: raw['category_name'] === null ? null : String(raw['category_name'] as string),
      skuCount: Number(raw['sku_count'] ?? 0),
    }));
    return { rows, total };
  }

  async findById(id: string): Promise<ProductEntity | null> {
    return this.repository.findOneBy({ id });
  }

  async findByCode(productCode: string): Promise<ProductEntity | null> {
    return this.repository.findOneBy({ productCode });
  }

  async nextProductCode(): Promise<string> {
    const result = await this.repository.query<{ nextval: string }[]>(
      "SELECT nextval('seq_product_code') AS nextval",
    );
    const value = Number(result[0]?.nextval ?? 1);
    return `PRD${String(value).padStart(6, '0')}`;
  }

  async insert(product: Partial<ProductEntity>): Promise<ProductEntity> {
    const created = this.repository.create(product as unknown as DeepPartial<ProductEntity>);
    return this.repository.save(created);
  }

  async update(id: string, patch: Partial<ProductEntity>): Promise<void> {
    await this.repository.update({ id }, patch);
  }
}
