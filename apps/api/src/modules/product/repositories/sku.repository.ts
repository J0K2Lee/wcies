import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { SKU_CASCADE_TABLES, skuMatchCondition } from '../constants/sku-delete.constants';
import { SkuEntity } from '../entities/sku.entity';

export interface SkuListFilters {
  keyword?: string;
  brandId?: string;
  /** Subtree filter (decision 0005 §9.5): a level-1/2 id includes all descendants. */
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
  brandName: string | null;
  categoryName: string | null;
  primaryBarcode: string | null;
  primaryImageKey: string | null;
  listingCount: number;
}

/**
 * Data access only - no business rules here (AGENTS.md §8).
 *
 * List aggregates (brand/category names, primary barcode, primary image,
 * listing count) are computed in ONE query with subselects (task §93).
 *
 * V1 refactor (2026-10-13, decision D5): category/brand are SKU columns -
 * the query joins brands/categories directly off skus; the products join is
 * gone with the product layer.
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
      .leftJoin('brands', 'brand', 'brand.id = sku.brand_id')
      .leftJoin('categories', 'category', 'category.id = sku.category_id')
      .addSelect('brand.name', 'brand_name')
      .addSelect('category.name_zh', 'category_name')
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
      );

    if (filters.keyword !== undefined && filters.keyword !== '') {
      // 条码纳入 keyword（2026-10-14 用户指示，优化映射弹窗 SKU 搜索）：
      // 扫码器输入的就是条码，搜索必须能命中；匹配任一状态的条码记录。
      qb.andWhere(
        `(sku.sku_code ILIKE :kw OR sku.name_zh ILIKE :kw OR sku.name_ru ILIKE :kw OR sku.model ILIKE :kw
          OR EXISTS (
            SELECT 1 FROM sku_barcodes kw_bc
             WHERE kw_bc.sku_id = sku.id AND kw_bc.barcode ILIKE :kw
          ))`,
        { kw: `%${filters.keyword}%` },
      );
    }
    if (filters.brandId !== undefined) {
      qb.andWhere('sku.brand_id = :brandId', { brandId: filters.brandId });
    }
    if (filters.categoryId !== undefined) {
      // Subtree filter (decision 0005 §9.5): selecting a level-1/2 category
      // must include SKUs of all descendant categories. Recursive CTE migrated
      // from the deleted product.repository.
      const subtreeIds = await this.findCategorySubtreeIds(filters.categoryId);
      if (subtreeIds.length === 0) {
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere('sku.category_id IN (:...subtreeIds)', { subtreeIds });
      }
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
      brandName: raw['brand_name'] === null ? null : String(raw['brand_name'] as string),
      categoryName: raw['category_name'] === null ? null : String(raw['category_name'] as string),
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

  /** Tables whose sku rows block a hard delete (decision 0003; FKs verified). */
  async countReferences(id: string): Promise<Array<{ table: string; count: number }>> {
    const rows = await this.repository.query<Array<Record<string, string | number>>>(
      `SELECT
        (SELECT COUNT(*) FROM sku_barcodes WHERE sku_id = $1) AS sku_barcodes,
        (SELECT COUNT(*) FROM sku_images WHERE sku_id = $1) AS sku_images,
        (SELECT COUNT(*) FROM sku_bundle_components WHERE bundle_sku_id = $1 OR component_sku_id = $1) AS sku_bundle_components,
        (SELECT COUNT(*) FROM inventory_balances WHERE sku_id = $1) AS inventory_balances,
        (SELECT COUNT(*) FROM inventory_safety_stocks WHERE sku_id = $1) AS inventory_safety_stocks,
        (SELECT COUNT(*) FROM inventory_reservations WHERE sku_id = $1) AS inventory_reservations,
        (SELECT COUNT(*) FROM inventory_serials WHERE sku_id = $1) AS inventory_serials,
        (SELECT COUNT(*) FROM inventory_transactions WHERE sku_id = $1) AS inventory_transactions,
        (SELECT COUNT(*) FROM order_items WHERE sku_id = $1) AS order_items,
        (SELECT COUNT(*) FROM picking_task_items WHERE sku_id = $1) AS picking_task_items,
        (SELECT COUNT(*) FROM package_items WHERE sku_id = $1) AS package_items,
        (SELECT COUNT(*) FROM package_item_serials WHERE sku_id = $1) AS package_item_serials,
        (SELECT COUNT(*) FROM platform_listing_skus WHERE sku_id = $1) AS platform_listing_skus,
        (SELECT COUNT(*) FROM shipment_items WHERE sku_id = $1) AS shipment_items`,
      [id],
    );
    return Object.entries(rows[0] ?? {}).map(([table, count]) => ({
      table,
      count: Number(count),
    }));
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  /**
   * Counts references restricted to the given tables (decision 0008). Lets the
   * service separate cascadable master data from business history without
   * running the full reference sweep.
   */
  async countReferencesIn(
    id: string,
    tables: readonly string[],
  ): Promise<Array<{ table: string; count: number }>> {
    if (tables.length === 0) {
      return [];
    }
    // Table/column names come from typed constants in the module, never input.
    // Placeholders are numbered sequentially across all sub-selects because a
    // table may match the SKU through more than one column.
    const params: string[] = [];
    const selects = tables
      .map((table) => {
        const { where, params: tableParams } = skuMatchCondition(table, id, params.length + 1);
        params.push(...tableParams);
        return `(SELECT COUNT(*) FROM ${table} WHERE ${where}) AS ${table}`;
      })
      .join(', ');
    const rows = await this.repository.query<Array<Record<string, string | number>>>(
      `SELECT ${selects}`,
      params,
    );
    return Object.entries(rows[0] ?? {}).map(([table, count]) => ({
      table,
      count: Number(count),
    }));
  }

  /**
   * Deletes a SKU together with its master-data children in ONE transaction
   * (decision 0008). Removing `platform_listing_skus` rows detaches the SKU
   * from any listing; the listing record itself is kept intact.
   */
  async deleteWithCascade(skuId: string): Promise<void> {
    await this.repository.manager.transaction(async (manager) => {
      for (const table of SKU_CASCADE_TABLES) {
        const { where, params } = skuMatchCondition(table, skuId);
        await manager.query(`DELETE FROM ${table} WHERE ${where}`, params);
      }
      await manager.delete(SkuEntity, { id: skuId });
    });
  }

  /** Category id plus every descendant id (recursive CTE). */
  private async findCategorySubtreeIds(categoryId: string): Promise<string[]> {
    const rows = await this.repository.query<Array<{ id: string }>>(
      `WITH RECURSIVE t AS (
         SELECT id FROM categories WHERE id = $1
         UNION ALL
         SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id
       )
       SELECT id::text AS id FROM t`,
      [categoryId],
    );
    return rows.map((row) => row.id);
  }
}
