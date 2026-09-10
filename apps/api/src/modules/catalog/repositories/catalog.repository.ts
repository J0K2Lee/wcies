import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, Repository } from 'typeorm';
import { BrandEntity } from '../entities/brand.entity';
import { CategoryEntity } from '../entities/category.entity';

/** Data access only - no business rules here (AGENTS.md §8). */
@Injectable()
export class CatalogRepository {
  constructor(
    @InjectRepository(BrandEntity)
    private readonly brandRepository: Repository<BrandEntity>,
    @InjectRepository(CategoryEntity)
    private readonly categoryRepository: Repository<CategoryEntity>,
  ) {}

  // ---- Brand ----

  async listBrands(keyword?: string): Promise<BrandEntity[]> {
    const qb = this.brandRepository.createQueryBuilder('brand');
    if (keyword !== undefined && keyword !== '') {
      qb.andWhere('(brand.code ILIKE :kw OR brand.name ILIKE :kw OR brand.name_en ILIKE :kw)', {
        kw: `%${keyword}%`,
      });
    }
    return qb.orderBy('brand.code', 'ASC').getMany();
  }

  async findBrandById(id: string): Promise<BrandEntity | null> {
    return this.brandRepository.findOneBy({ id });
  }

  async findBrandByCode(code: string): Promise<BrandEntity | null> {
    return this.brandRepository.findOneBy({ code });
  }

  async insertBrand(brand: Partial<BrandEntity>): Promise<BrandEntity> {
    const created = this.brandRepository.create(brand as unknown as DeepPartial<BrandEntity>);
    return this.brandRepository.save(created);
  }

  async updateBrand(id: string, patch: Partial<BrandEntity>): Promise<void> {
    await this.brandRepository.update({ id }, patch);
  }

  // ---- Category ----

  async listCategories(): Promise<CategoryEntity[]> {
    return this.categoryRepository.find({ order: { sortOrder: 'ASC', code: 'ASC' } });
  }

  async findCategoryById(id: string): Promise<CategoryEntity | null> {
    return this.categoryRepository.findOneBy({ id });
  }

  async findCategoryByCode(code: string): Promise<CategoryEntity | null> {
    return this.categoryRepository.findOneBy({ code });
  }

  async insertCategory(category: Partial<CategoryEntity>): Promise<CategoryEntity> {
    const created = this.categoryRepository.create(
      category as unknown as DeepPartial<CategoryEntity>,
    );
    return this.categoryRepository.save(created);
  }

  async updateCategory(id: string, patch: Partial<CategoryEntity>): Promise<void> {
    await this.categoryRepository.update({ id }, patch);
  }

  /** Same lower(name_zh) sibling under one parent (NULL parent = roots). */
  async findSiblingByName(
    parentId: string | null,
    nameZh: string,
    excludeId?: string,
  ): Promise<CategoryEntity | null> {
    const qb = this.categoryRepository
      .createQueryBuilder('category')
      .where('lower(category.nameZh) = lower(:nameZh)', { nameZh });
    if (parentId === null) {
      qb.andWhere('category.parentId IS NULL');
    } else {
      qb.andWhere('category.parentId = :parentId', { parentId });
    }
    if (excludeId !== undefined) {
      qb.andWhere('category.id != :excludeId', { excludeId });
    }
    return qb.getOne();
  }

  /** Height of the subtree rooted at id (1 for a leaf) - decision 0005. */
  async subtreeHeight(id: string): Promise<number> {
    const rows = await this.categoryRepository.query<Array<{ height: number }>>(
      `WITH RECURSIVE t AS (
         SELECT id, parent_id, 1 AS depth FROM categories WHERE id = $1
         UNION ALL
         SELECT c.id, c.parent_id, t.depth + 1
           FROM categories c JOIN t ON c.parent_id = t.id
       )
       SELECT COALESCE(MAX(depth), 0)::int AS height FROM t`,
      [id],
    );
    return Number(rows[0]?.height ?? 0);
  }

  /**
   * Re-parent a subtree: root gets the new parent, every node's level shifts
   * by delta - one transaction, one statement (decision 0005: the level
   * update must never be split from the parent update).
   */
  async reparentCategory(id: string, newParentId: string | null, delta: number): Promise<void> {
    await this.categoryRepository.manager.transaction(async (manager) => {
      await manager.query(
        `WITH RECURSIVE t AS (
           SELECT id FROM categories WHERE id = $1
           UNION ALL
           SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id
         )
         UPDATE categories
            SET parent_id = CASE WHEN id = $1 THEN $2 ELSE parent_id END,
                level = level + $3
          WHERE id IN (SELECT id FROM t)`,
        [id, newParentId, delta],
      );
    });
  }

  /** Products attached anywhere in the subtree (products live on level-3 nodes). */
  async countProductsInSubtree(id: string): Promise<number> {
    const rows = await this.categoryRepository.query<Array<{ count: string }>>(
      `WITH RECURSIVE t AS (
         SELECT id FROM categories WHERE id = $1
         UNION ALL
         SELECT c.id FROM categories c JOIN t ON c.parent_id = t.id
       )
       SELECT COUNT(*)::text AS count FROM products WHERE category_id IN (SELECT id FROM t)`,
      [id],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async deleteCategory(id: string): Promise<void> {
    await this.categoryRepository.delete({ id });
  }
}
