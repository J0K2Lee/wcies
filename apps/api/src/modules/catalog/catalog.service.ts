import { Injectable } from '@nestjs/common';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../operation-log/operation-log.service';
import { BrandEntity } from './entities/brand.entity';
import { CategoryEntity } from './entities/category.entity';
import {
  BrandCodeAlreadyExistsError,
  BrandNotFoundError,
  CategoryCodeAlreadyExistsError,
  CategoryCycleInvalidError,
  CategoryNotFoundError,
} from './errors/catalog-errors';
import { CatalogRepository } from './repositories/catalog.repository';
import {
  BrandResponseDto,
  CategoryResponseDto,
  CategoryTreeItemDto,
  CreateBrandRequestDto,
  CreateCategoryRequestDto,
  UpdateBrandRequestDto,
  UpdateCategoryRequestDto,
} from './dto/catalog.dto';

/** Brand + Category master data (task §13/§14). */
@Injectable()
export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly operationLog: OperationLogService,
  ) {}

  // ---- Brand ----

  async listBrands(keyword?: string): Promise<BrandResponseDto[]> {
    const brands = await this.repository.listBrands(keyword);
    return brands.map((brand) => this.brandToResponse(brand));
  }

  async createBrand(
    dto: CreateBrandRequestDto,
    operator: OperatorContext,
  ): Promise<BrandResponseDto> {
    const existing = await this.repository.findBrandByCode(dto.code);
    if (existing !== null) {
      throw new BrandCodeAlreadyExistsError(dto.code);
    }
    const brand = await this.repository.insertBrand({
      code: dto.code,
      nameZh: dto.nameZh,
      nameEn: dto.nameEn ?? null,
      nameRu: dto.nameRu ?? null,
      status: 'ACTIVE',
    });
    await this.operationLog.record({
      entityType: 'BRAND',
      entityId: brand.id,
      entityCode: brand.code,
      action: 'CREATE',
      changes: { code: { from: null, to: brand.code }, nameZh: { from: null, to: brand.nameZh } },
      operator,
    });
    return this.brandToResponse(brand);
  }

  async updateBrand(
    id: string,
    dto: UpdateBrandRequestDto,
    operator: OperatorContext,
  ): Promise<BrandResponseDto> {
    const brand = await this.repository.findBrandById(id);
    if (brand === null) {
      throw new BrandNotFoundError(id);
    }
    const before = {
      nameZh: brand.nameZh,
      nameEn: brand.nameEn,
      nameRu: brand.nameRu,
      status: brand.status,
    };
    const patch: Partial<BrandEntity> = {};
    if (dto.nameZh !== undefined) patch.nameZh = dto.nameZh;
    if (dto.nameEn !== undefined) patch.nameEn = dto.nameEn;
    if (dto.nameRu !== undefined) patch.nameRu = dto.nameRu;
    if (dto.status !== undefined) patch.status = dto.status;
    if (Object.keys(patch).length > 0) {
      await this.repository.updateBrand(id, patch);
    }
    const updated = await this.repository.findBrandById(id);
    await this.operationLog.record({
      entityType: 'BRAND',
      entityId: id,
      entityCode: brand.code,
      action: 'UPDATE',
      changes: diffOf(before, {
        nameZh: updated?.nameZh,
        nameEn: updated?.nameEn,
        nameRu: updated?.nameRu,
        status: updated?.status,
      }),
      operator,
    });
    return this.brandToResponse(updated as BrandEntity);
  }

  /** Cross-module validation for Product service. */
  async findBrandEntityById(id: string): Promise<BrandEntity | null> {
    return this.repository.findBrandById(id);
  }

  // ---- Category ----

  async listCategoryTree(): Promise<CategoryTreeItemDto[]> {
    const categories = await this.repository.listCategories();
    return this.buildTree(categories);
  }

  async createCategory(
    dto: CreateCategoryRequestDto,
    operator: OperatorContext,
  ): Promise<CategoryResponseDto> {
    const existing = await this.repository.findCategoryByCode(dto.code);
    if (existing !== null) {
      throw new CategoryCodeAlreadyExistsError(dto.code);
    }
    if (dto.parentId !== undefined && dto.parentId !== null) {
      const parent = await this.repository.findCategoryById(dto.parentId);
      if (parent === null) {
        throw new CategoryNotFoundError(dto.parentId);
      }
    }
    const category = await this.repository.insertCategory({
      parentId: dto.parentId ?? null,
      code: dto.code,
      nameZh: dto.nameZh,
      nameRu: dto.nameRu ?? null,
      sortOrder: dto.sortOrder ?? 0,
      status: 'ACTIVE',
    });
    await this.operationLog.record({
      entityType: 'CATEGORY',
      entityId: category.id,
      entityCode: category.code,
      action: 'CREATE',
      changes: {
        code: { from: null, to: category.code },
        nameZh: { from: null, to: category.nameZh },
      },
      operator,
    });
    return this.categoryToResponse(category);
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryRequestDto,
    operator: OperatorContext,
  ): Promise<CategoryResponseDto> {
    const category = await this.repository.findCategoryById(id);
    if (category === null) {
      throw new CategoryNotFoundError(id);
    }
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new CategoryCycleInvalidError(id);
      }
      if (dto.parentId !== null) {
        const parent = await this.repository.findCategoryById(dto.parentId);
        if (parent === null) {
          throw new CategoryNotFoundError(dto.parentId);
        }
        await this.assertNoCycle(id, dto.parentId);
      }
    }
    const before = {
      parentId: category.parentId,
      nameZh: category.nameZh,
      nameRu: category.nameRu,
      sortOrder: category.sortOrder,
      status: category.status,
    };
    const patch: Partial<CategoryEntity> = {};
    if (dto.parentId !== undefined) patch.parentId = dto.parentId;
    if (dto.nameZh !== undefined) patch.nameZh = dto.nameZh;
    if (dto.nameRu !== undefined) patch.nameRu = dto.nameRu;
    if (dto.sortOrder !== undefined) patch.sortOrder = dto.sortOrder;
    if (dto.status !== undefined) patch.status = dto.status;
    if (Object.keys(patch).length > 0) {
      await this.repository.updateCategory(id, patch);
    }
    const updated = await this.repository.findCategoryById(id);
    await this.operationLog.record({
      entityType: 'CATEGORY',
      entityId: id,
      entityCode: category.code,
      action: 'UPDATE',
      changes: diffOf(before, {
        parentId: updated?.parentId,
        nameZh: updated?.nameZh,
        nameRu: updated?.nameRu,
        sortOrder: updated?.sortOrder,
        status: updated?.status,
      }),
      operator,
    });
    return this.categoryToResponse(updated as CategoryEntity);
  }

  /** Cross-module validation for Product service. */
  async findCategoryEntityById(id: string): Promise<CategoryEntity | null> {
    return this.repository.findCategoryById(id);
  }

  /** Walks parent links to make sure `newParentId` is not a descendant of id. */
  private async assertNoCycle(id: string, newParentId: string): Promise<void> {
    let currentId: string | null = newParentId;
    const seen = new Set<string>();
    while (currentId !== null) {
      if (currentId === id) {
        throw new CategoryCycleInvalidError(id);
      }
      if (seen.has(currentId)) {
        break;
      }
      seen.add(currentId);
      const parent = await this.repository.findCategoryById(currentId);
      currentId = parent?.parentId ?? null;
    }
  }

  private buildTree(categories: CategoryEntity[]): CategoryTreeItemDto[] {
    const byParent = new Map<string | null, CategoryEntity[]>();
    for (const category of categories) {
      const list = byParent.get(category.parentId) ?? [];
      list.push(category);
      byParent.set(category.parentId, list);
    }
    const build = (parentId: string | null): CategoryTreeItemDto[] => {
      const children = byParent.get(parentId) ?? [];
      return children.map((category) => ({
        ...this.categoryToResponse(category),
        children: build(category.id),
      }));
    };
    return build(null);
  }

  private brandToResponse(brand: BrandEntity): BrandResponseDto {
    return {
      id: brand.id,
      code: brand.code,
      nameZh: brand.nameZh,
      nameEn: brand.nameEn,
      nameRu: brand.nameRu,
      status: brand.status,
      createdAt: brand.createdAt,
      updatedAt: brand.updatedAt,
    };
  }

  private categoryToResponse(category: CategoryEntity): CategoryResponseDto {
    return {
      id: category.id,
      parentId: category.parentId,
      code: category.code,
      nameZh: category.nameZh,
      nameRu: category.nameRu,
      sortOrder: category.sortOrder,
      status: category.status,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
