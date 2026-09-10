import { Injectable } from '@nestjs/common';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../operation-log/operation-log.service';
import { BusinessCodeService } from '../../infrastructure/business-code/business-code.service';
import { BrandEntity } from './entities/brand.entity';
import { CategoryEntity } from './entities/category.entity';
import {
  BrandCodeAlreadyExistsError,
  BrandInUseError,
  BrandNotFoundError,
  CategoryCodeAlreadyExistsError,
  CategoryCycleInvalidError,
  CategoryDepthExceededError,
  CategoryHasChildrenError,
  CategoryInUseError,
  CategoryLevelInvalidError,
  CategoryNameDuplicatedError,
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

/** Brand + Category master data (task §13/§14; Sprint 6 decisions 0005/0006). */
@Injectable()
export class CatalogService {
  constructor(
    private readonly repository: CatalogRepository,
    private readonly businessCode: BusinessCodeService,
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
    // Auto-coded (BN%05d) when omitted (decision #5).
    const manualCode = dto.code?.trim();
    if (manualCode !== undefined && manualCode !== '') {
      const existing = await this.repository.findBrandByCode(manualCode);
      if (existing !== null) {
        throw new BrandCodeAlreadyExistsError(manualCode);
      }
    }
    const code = manualCode || (await this.businessCode.nextBrandCode());
    const brand = await this.repository.insertBrand({
      code,
      name: dto.name,
      nameZh: dto.nameZh ?? null,
      nameEn: dto.nameEn ?? null,
      nameRu: dto.nameRu ?? null,
      status: 'ACTIVE',
    });
    await this.operationLog.record({
      entityType: 'BRAND',
      entityId: brand.id,
      entityCode: brand.code,
      action: 'CREATE',
      changes: { code: { from: null, to: brand.code }, name: { from: null, to: brand.name } },
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
      name: brand.name,
      nameZh: brand.nameZh,
      nameEn: brand.nameEn,
      nameRu: brand.nameRu,
      status: brand.status,
    };
    const patch: Partial<BrandEntity> = {};
    if (dto.name !== undefined) patch.name = dto.name;
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
        name: updated?.name,
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

  /** Zero-reference hard delete (decision 0003); referenced -> BRAND_IN_USE. */
  async removeBrand(id: string, operator: OperatorContext): Promise<void> {
    const brand = await this.repository.findBrandById(id);
    if (brand === null) {
      throw new BrandNotFoundError(id);
    }
    const productCount = await this.repository.countBrandReferences(id);
    if (productCount > 0) {
      throw new BrandInUseError(id);
    }
    await this.repository.deleteBrand(id);
    await this.operationLog.record({
      entityType: 'BRAND',
      entityId: id,
      entityCode: brand.code,
      action: 'DELETE',
      changes: { deleted: { from: brand.name, to: null } },
      operator,
    });
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
    // Auto-coded (CN%05d) when omitted (decision #6); all three levels share
    // one sequence.
    const manualCode = dto.code?.trim();
    if (manualCode !== undefined && manualCode !== '') {
      const existing = await this.repository.findCategoryByCode(manualCode);
      if (existing !== null) {
        throw new CategoryCodeAlreadyExistsError(manualCode);
      }
    }
    const code = manualCode || (await this.businessCode.nextCategoryCode());

    let level = 1;
    if (dto.parentId !== undefined && dto.parentId !== null) {
      const parent = await this.repository.findCategoryById(dto.parentId);
      if (parent === null) {
        throw new CategoryNotFoundError(dto.parentId);
      }
      level = parent.level + 1;
      if (level > 3) {
        throw new CategoryDepthExceededError(dto.parentId, level);
      }
    }

    // Same-name sibling under the same parent (incl. between roots); the DB
    // unique index is the backstop, this gives the friendly error.
    const duplicate = await this.repository.findSiblingByName(
      dto.parentId ?? null,
      dto.nameZh,
    );
    if (duplicate !== null) {
      throw new CategoryNameDuplicatedError(dto.nameZh, dto.parentId ?? null);
    }

    const category = await this.repository.insertCategory({
      parentId: dto.parentId ?? null,
      code,
      level,
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
        parentId: { from: null, to: category.parentId },
        level: { from: null, to: category.level },
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

    if (
      dto.nameZh !== undefined &&
      dto.nameZh.trim() !== '' &&
      dto.nameZh !== category.nameZh
    ) {
      const duplicate = await this.repository.findSiblingByName(
        category.parentId,
        dto.nameZh,
        id,
      );
      if (duplicate !== null) {
        throw new CategoryNameDuplicatedError(dto.nameZh, category.parentId);
      }
    }

    if (dto.parentId !== undefined && dto.parentId !== category.parentId) {
      await this.reparentWithDepthRules(id, category, dto.parentId);
    }

    const before = {
      parentId: category.parentId,
      nameZh: category.nameZh,
      nameRu: category.nameRu,
      sortOrder: category.sortOrder,
      status: category.status,
      level: category.level,
    };
    const patch: Partial<CategoryEntity> = {};
    // parentId/level only change through reparentWithDepthRules above.
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
        level: updated?.level,
      }),
      operator,
    });
    return this.categoryToResponse(updated as CategoryEntity);
  }

  /**
   * Re-parent rules (decision 0005, §9.4): the check must consider the
   * height of the WHOLE subtree (not just the moved node), and a subtree
   * carrying products can never shift levels (products only live on
   * level-3 nodes).
   */
  private async reparentWithDepthRules(
    id: string,
    category: CategoryEntity,
    newParentId: string | null,
  ): Promise<void> {
    let newParentLevel = 0;
    if (newParentId !== null) {
      if (newParentId === id) {
        throw new CategoryCycleInvalidError(id);
      }
      const parent = await this.repository.findCategoryById(newParentId);
      if (parent === null) {
        throw new CategoryNotFoundError(newParentId);
      }
      await this.assertNoCycle(id, newParentId);
      newParentLevel = parent.level;
    }
    const newLevel = newParentLevel + 1;
    const height = await this.repository.subtreeHeight(id);
    const resultingDepth = newLevel + height - 1;
    if (resultingDepth > 3) {
      throw new CategoryDepthExceededError(id, resultingDepth);
    }
    const delta = newLevel - category.level;
    if (delta !== 0) {
      const productCount = await this.repository.countProductsInSubtree(id);
      if (productCount > 0) {
        // Scenario C: moving would re-level nodes that carry products.
        throw new CategoryLevelInvalidError(id, 3);
      }
    }
    if (delta !== 0 || newParentId !== category.parentId) {
      await this.repository.reparentCategory(id, newParentId, delta);
    }
  }

  /** Cross-module validation for Product service. */
  async findCategoryEntityById(id: string): Promise<CategoryEntity | null> {
    return this.repository.findCategoryById(id);
  }

  /**
   * Zero-reference hard delete (decision 0003): children and products each
   * block with their own error code (children are a hierarchy relation).
   */
  async removeCategory(id: string, operator: OperatorContext): Promise<void> {
    const category = await this.repository.findCategoryById(id);
    if (category === null) {
      throw new CategoryNotFoundError(id);
    }
    if ((await this.repository.countCategoryChildren(id)) > 0) {
      throw new CategoryHasChildrenError(id);
    }
    if ((await this.repository.countCategoryProducts(id)) > 0) {
      throw new CategoryInUseError(id);
    }
    await this.repository.deleteCategory(id);
    await this.operationLog.record({
      entityType: 'CATEGORY',
      entityId: id,
      entityCode: category.code,
      action: 'DELETE',
      changes: { deleted: { from: category.nameZh, to: null } },
      operator,
    });
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
      name: brand.name,
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
      level: category.level,
      sortOrder: category.sortOrder,
      status: category.status,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    };
  }
}
