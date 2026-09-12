import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { CatalogService } from '../../catalog/catalog.service';
import { BrandNotFoundError } from '../../catalog/errors/catalog-errors';
import {
  CategoryLevelInvalidError,
  CategoryNotFoundError,
} from '../../catalog/errors/catalog-errors';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { ProductEntity } from '../entities/product.entity';
import {
  ProductCodeAlreadyExistsError,
  ProductHasHistoryError,
  ProductInUseError,
  ProductNotFoundError,
} from '../errors/product-errors';
import { ProductRepository, ProductRowWithCounts } from '../repositories/product.repository';
import {
  CreateProductRequestDto,
  ProductListItemDto,
  ProductListQueryDto,
  ProductResponseDto,
  UpdateProductRequestDto,
} from '../dto/product-sku.dto';
import { SkuService } from './sku.service';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'PRODUCT';

/**
 * Product / SPU master data (task §15-§19).
 * Statuses: DRAFT -> ACTIVE <-> INACTIVE; referenced products are never
 * physically deleted (task §17).
 */
@Injectable()
export class ProductService {
  constructor(
    private readonly repository: ProductRepository,
    private readonly catalogService: CatalogService,
    private readonly skuService: SkuService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    query: ProductListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: ProductListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listWithCounts(
      {
        keyword: query.keyword?.trim() || undefined,
        brandId: query.brandId,
        categoryId: query.categoryId,
        status: query.status,
        sortBy: query.sortBy ?? 'createdAt',
        sortOrder: query.sortOrder ?? 'desc',
      },
      pageSize,
      offsetOf(page, pageSize),
    );
    return {
      items: rows.map((row) => this.toListItem(row)),
      meta: { page, pageSize, total },
    };
  }

  async create(
    dto: CreateProductRequestDto,
    operator: OperatorContext,
  ): Promise<ProductResponseDto> {
    if (dto.brandId !== undefined) {
      const brand = await this.catalogService.findBrandEntityById(dto.brandId);
      if (brand === null) {
        throw new BrandNotFoundError(dto.brandId);
      }
    }
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const category = await this.catalogService.findCategoryEntityById(dto.categoryId);
      if (category === null) {
        throw new CategoryNotFoundError(dto.categoryId);
      }
      // Products may only reference level-3 categories (decision 0005).
      if (category.level !== 3) {
        throw new CategoryLevelInvalidError(dto.categoryId, category.level);
      }
    }

    // The sequence number is ALWAYS taken from the product scope (even for
    // manual codes) so code_seq stays a dense, collision-free fact source.
    const generated = await this.businessCode.nextProductCode();
    const productCode = dto.productCode?.trim() || generated.productCode;
    if (productCode !== generated.productCode) {
      const existing = await this.repository.findByCode(productCode);
      if (existing !== null) {
        throw new ProductCodeAlreadyExistsError(productCode);
      }
    }

    const product = await this.repository.insert({
      productCode,
      codeSeq: generated.codeSeq,
      nameZh: dto.nameZh,
      nameRu: dto.nameRu ?? null,
      categoryId: dto.categoryId ?? null,
      brandId: dto.brandId ?? null,
      mainImageId: null,
      status: 'DRAFT',
      remark: dto.remark ?? null,
      createdBy: operator.userId,
      updatedBy: operator.userId,
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: product.id,
      entityCode: product.productCode,
      action: 'CREATE',
      changes: {
        productCode: { from: null, to: product.productCode },
        nameZh: { from: null, to: product.nameZh },
      },
      operator,
    });
    const row = await this.findRowOrThrow(product.id);
    return this.toResponse(row.product, row.brandName, row.categoryName);
  }

  async getById(id: string): Promise<ProductResponseDto> {
    const row = await this.findRowOrThrow(id);
    return this.toResponse(row.product, row.brandName, row.categoryName);
  }

  /** Product detail incl. its SKUs (product detail page, task §65). */
  async getDetail(id: string): Promise<{
    product: ProductResponseDto;
    skus: Array<ReturnType<SkuService['toResponse']>>;
  }> {
    const row = await this.findRowOrThrow(id);
    const skus = await this.skuService.listByProductId(id);
    return {
      product: this.toResponse(row.product, row.brandName, row.categoryName),
      skus,
    };
  }

  async update(
    id: string,
    dto: UpdateProductRequestDto,
    operator: OperatorContext,
  ): Promise<ProductResponseDto> {
    const existing = await this.findRowOrThrow(id);
    const before = this.snapshot(existing.product);

    // productCode is read-only after creation (decision 0002): derived SKU
    // codes would lose their anchor if it changed.
    if (dto.brandId !== undefined && dto.brandId !== null) {
      const brand = await this.catalogService.findBrandEntityById(dto.brandId);
      if (brand === null) {
        throw new BrandNotFoundError(dto.brandId);
      }
    }
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const category = await this.catalogService.findCategoryEntityById(dto.categoryId);
      if (category === null) {
        throw new CategoryNotFoundError(dto.categoryId);
      }
      if (category.level !== 3) {
        throw new CategoryLevelInvalidError(dto.categoryId, category.level);
      }
    }
    if (dto.mainImageId !== undefined && dto.mainImageId !== null) {
      await this.skuService.assertImageBelongsToProduct(dto.mainImageId, id);
    }

    const patch: Partial<ProductEntity> = { updatedBy: operator.userId };
    if (dto.nameZh !== undefined) patch.nameZh = dto.nameZh;
    if (dto.nameRu !== undefined) patch.nameRu = dto.nameRu;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.brandId !== undefined) patch.brandId = dto.brandId;
    if (dto.mainImageId !== undefined) patch.mainImageId = dto.mainImageId;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    if (Object.keys(patch).length > 1) {
      await this.repository.update(id, patch);
    }
    const updated = await this.findRowOrThrow(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.product.productCode,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated.product)),
      operator,
    });
    return this.toResponse(updated.product, updated.brandName, updated.categoryName);
  }

  async setStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<ProductResponseDto> {
    const existing = await this.findRowOrThrow(id);
    await this.repository.update(id, { status, updatedBy: operator.userId });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.product.productCode,
      action:
        status === 'ACTIVE' ? 'ACTIVATE' : status === 'INACTIVE' ? 'DEACTIVATE' : 'STATUS_CHANGE',
      changes: { status: { from: existing.product.status, to: status } },
      operator,
    });
    const updated = await this.findRowOrThrow(id);
    return this.toResponse(updated.product, updated.brandName, updated.categoryName);
  }

  /** Cross-module entity lookup (import / listing services). */
  async getEntityById(id: string): Promise<ProductEntity | null> {
    return this.repository.findById(id);
  }

  /** Zero-reference hard delete (decision 0003); referenced -> PRODUCT_IN_USE. */
  async remove(id: string, operator: OperatorContext): Promise<void> {
    const existing = await this.findRowOrThrow(id);
    const references = await this.repository.countReferences(id);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new ProductInUseError(used.map((reference) => reference.table));
    }
    await this.repository.delete(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.product.productCode,
      action: 'DELETE',
      changes: { deleted: { from: existing.product.productCode, to: null } },
      operator,
    });
  }

  /**
   * Forced delete (decision 0008): removes the product, all of its SKUs and
   * those SKUs' master-data children (barcodes, images, bundle links, platform
   * mappings) in one transaction.
   *
   * Business history still blocks: if any SKU has inventory ledger rows, order
   * lines, picking/package/shipment records, the delete is refused and the
   * caller is told which table. Those rows are evidence the goods physically
   * moved, so cascading them would break traceability (AGENTS.md §25).
   */
  async forceRemove(id: string, operator: OperatorContext): Promise<void> {
    const existing = await this.findRowOrThrow(id);
    const skuIds = await this.repository.listSkuIds(id);
    const blockers = await this.skuService.findHistoryBlockersForProduct(skuIds);
    if (blockers.length > 0) {
      throw new ProductHasHistoryError(
        blockers.map((blocker) => `${blocker.table}(${blocker.count})`),
      );
    }
    // The repository owns the cascade table list (single source of truth in
    // constants/sku-delete.constants.ts) - nothing to pass through here.
    await this.repository.deleteWithSkus(id, skuIds);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.product.productCode,
      action: 'FORCE_DELETE',
      changes: {
        deleted: { from: existing.product.productCode, to: null },
        cascadedSkus: { from: skuIds.length, to: null },
      },
      operator,
    });
  }

  async getEntityByCode(code: string): Promise<ProductEntity | null> {
    return this.repository.findByCode(code);
  }

  /** Used by import flows; creates a product without brand/category checks. */
  async createForImport(
    input: {
      nameZh: string;
      nameRu?: string | null;
      brandId?: string | null;
      categoryId?: string | null;
    },
    operator: OperatorContext,
  ): Promise<ProductEntity> {
    const { productCode, codeSeq } = await this.businessCode.nextProductCode();
    const product = await this.repository.insert({
      productCode,
      codeSeq,
      nameZh: input.nameZh,
      nameRu: input.nameRu ?? null,
      brandId: input.brandId ?? null,
      categoryId: input.categoryId ?? null,
      status: 'DRAFT',
      createdBy: operator.userId,
      updatedBy: operator.userId,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: product.id,
      entityCode: product.productCode,
      action: 'IMPORT_CREATE',
      changes: { productCode: { from: null, to: product.productCode } },
      operator,
    });
    return product;
  }

  /**
   * Cross-module tx participant (Sprint 8 T1): creates the product row on the
   * CALLER's transaction so listing quick-onboarding commits or rolls back as
   * one unit. Sequence is taken on the same manager - a rollback returns the
   * number instead of burning it. Operation logging stays with the CALLER
   * (after commit) so a rolled-back attempt leaves no audit orphans.
   */
  async createForOnboardingInTx(
    manager: EntityManager,
    input: { nameZh: string; nameRu?: string | null },
    operator: OperatorContext,
  ): Promise<ProductEntity> {
    const { productCode, codeSeq } = await this.businessCode.nextProductCode(manager);
    const repository = manager.getRepository(ProductEntity);
    const created = repository.create({
      productCode,
      codeSeq,
      nameZh: input.nameZh,
      nameRu: input.nameRu ?? null,
      brandId: null,
      categoryId: null,
      mainImageId: null,
      status: 'DRAFT',
      remark: null,
      createdBy: operator.userId,
      updatedBy: operator.userId,
    });
    return repository.save(created);
  }

  private async findRowOrThrow(id: string): Promise<ProductRowWithCounts> {
    const product = await this.repository.findById(id);
    if (product === null) {
      throw new ProductNotFoundError(id);
    }
    let brandName: string | null = null;
    if (product.brandId !== null) {
      const brand = await this.catalogService.findBrandEntityById(product.brandId);
      brandName = brand?.name ?? null;
    }
    let categoryName: string | null = null;
    if (product.categoryId !== null) {
      const category = await this.catalogService.findCategoryEntityById(product.categoryId);
      categoryName = category?.nameZh ?? null;
    }
    return { product, brandName, categoryName, skuCount: 0 };
  }

  private snapshot(product: ProductEntity): Record<string, unknown> {
    return {
      productCode: product.productCode,
      nameZh: product.nameZh,
      nameRu: product.nameRu,
      categoryId: product.categoryId,
      brandId: product.brandId,
      mainImageId: product.mainImageId,
      remark: product.remark,
    };
  }

  private toListItem(row: ProductRowWithCounts): ProductListItemDto {
    return {
      ...this.toResponse(row.product, row.brandName, row.categoryName),
      skuCount: row.skuCount,
    };
  }

  private toResponse(
    product: ProductEntity,
    brandName: string | null,
    categoryName: string | null,
  ): ProductResponseDto {
    return {
      id: product.id,
      productCode: product.productCode,
      nameZh: product.nameZh,
      nameRu: product.nameRu,
      categoryId: product.categoryId,
      categoryName,
      brandId: product.brandId,
      brandName,
      mainImageId: product.mainImageId,
      status: product.status,
      remark: product.remark,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
