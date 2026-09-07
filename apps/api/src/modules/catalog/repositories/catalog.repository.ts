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
      qb.andWhere('(brand.code ILIKE :kw OR brand.name_zh ILIKE :kw OR brand.name_en ILIKE :kw)', {
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
}
