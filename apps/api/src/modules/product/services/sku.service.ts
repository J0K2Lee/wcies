import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { CatalogService } from '../../catalog/catalog.service';
import {
  BrandNotFoundError,
  CategoryLevelInvalidError,
  CategoryNotFoundError,
} from '../../catalog/errors/catalog-errors';
import { SKU_HISTORY_TABLES } from '../constants/sku-delete.constants';
import { SkuEntity } from '../entities/sku.entity';
import {
  SkuCodeAlreadyExistsError,
  SkuDimensionsInvalidError,
  SkuHasHistoryError,
  SkuInUseError,
  SkuNotFoundError,
} from '../errors/sku-errors';
import { SkuRepository } from '../repositories/sku.repository';
import {
  CreateSkuRequestDto,
  SkuListItemDto,
  SkuListQueryDto,
  SkuResponseDto,
  UpdateSkuRequestDto,
} from '../dto/product-sku.dto';
import { offsetOf } from '../../../common/dto/pagination.dto';

const ENTITY_TYPE = 'SKU';

export function computeVolumeMm3(
  lengthMm: number | null,
  widthMm: number | null,
  heightMm: number | null,
): number | null {
  if (lengthMm === null || widthMm === null || heightMm === null) {
    return null;
  }
  return lengthMm * widthMm * heightMm;
}

/** Asserts dimensions are all-or-none (task §23: volume must be computable). */
export function assertDimensionsConsistent(
  lengthMm: number | null | undefined,
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
): void {
  const provided = [lengthMm, widthMm, heightMm].filter(
    (value) => value !== null && value !== undefined,
  );
  if (provided.length !== 0 && provided.length !== 3) {
    throw new SkuDimensionsInvalidError();
  }
}

/**
 * Internal SKU master data (task §20-§27).
 *
 * V1 refactor (2026-10-13, decisions D2/D3/D5): the product layer is gone -
 * a SKU is created directly (no productId), coded from the single global
 * sequence (SKU%09d), and carries its own category/brand (optional; the
 * category must be level 3, decision 0005). The DRAFT "incomplete archive"
 * semantics of the deleted Product layer did NOT migrate: every creation
 * path lands on ACTIVE, and `POST /skus` keeps its previous default.
 *
 * sku_code: auto-generated when omitted, always globally unique and frozen
 * after creation. Units (2026-09-09 convention): weight in g, dimensions in
 * integer mm; volume_mm3 is backend-computed from L x W x H, never accepted
 * from clients. moving_average_cost: reserved, stays null until the purchase
 * sprint.
 */
@Injectable()
export class SkuService {
  constructor(
    private readonly repository: SkuRepository,
    private readonly objectStorage: ObjectStorageService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
    private readonly catalogService: CatalogService,
  ) {}

  async list(
    query: SkuListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: SkuListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listWithAggregates(
      {
        keyword: query.keyword?.trim() || undefined,
        brandId: query.brandId,
        categoryId: query.categoryId,
        status: query.status,
        serialTracking:
          query.serialTracking === undefined ? undefined : query.serialTracking === 'true',
        hasListing: query.hasListing === undefined ? undefined : query.hasListing === 'true',
        platformId: query.platformId,
        storeId: query.storeId,
        sortBy: query.sortBy ?? 'createdAt',
        sortOrder: query.sortOrder ?? 'desc',
      },
      pageSize,
      offsetOf(page, pageSize),
    );

    const items = await Promise.all(
      rows.map(async (row) => ({
        ...this.toResponse(row.sku, row.brandName, row.categoryName),
        primaryBarcode: row.primaryBarcode,
        primaryImageUrl:
          row.primaryImageKey === null
            ? null
            : await this.objectStorage.getSignedUrl(row.primaryImageKey),
        listingCount: row.listingCount,
      })),
    );
    return { items, meta: { page, pageSize, total } };
  }

  async create(dto: CreateSkuRequestDto, operator: OperatorContext): Promise<SkuResponseDto> {
    // Optional brand/category (D5): same rules the product create used -
    // brand must exist; category must exist and be level 3 (decision 0005).
    const brand =
      dto.brandId === undefined || dto.brandId === null
        ? null
        : await this.assertBrandExists(dto.brandId);
    const category =
      dto.categoryId === undefined || dto.categoryId === null
        ? null
        : await this.assertCategoryExists(dto.categoryId);

    let skuCode = dto.skuCode?.trim();
    if (skuCode === undefined || skuCode === '') {
      skuCode = await this.businessCode.nextSkuCodeGlobal();
    } else {
      const existing = await this.repository.findByCode(skuCode);
      if (existing !== null) {
        throw new SkuCodeAlreadyExistsError(skuCode);
      }
    }

    const lengthMm = dto.lengthMm ?? null;
    const widthMm = dto.widthMm ?? null;
    const heightMm = dto.heightMm ?? null;
    assertDimensionsConsistent(lengthMm, widthMm, heightMm);
    const volumeMm3 = computeVolumeMm3(lengthMm, widthMm, heightMm);

    const sku = await this.repository.insert({
      skuCode,
      nameZh: dto.nameZh,
      nameRu: dto.nameRu ?? null,
      categoryId: category?.id ?? null,
      brandId: brand?.id ?? null,
      model: dto.model ?? null,
      color: dto.color ?? null,
      size: dto.size ?? null,
      weightG: toNumeric(dto.weightG),
      lengthMm,
      widthMm,
      heightMm,
      volumeMm3: toNumeric(volumeMm3),
      purchaseUrl: dto.purchaseUrl ?? null,
      latestPurchasePrice: toNumeric(dto.latestPurchasePrice),
      movingAverageCost: null,
      costCurrency: dto.costCurrency ?? 'CNY',
      serialTracking: dto.serialTracking ?? false,
      status: 'ACTIVE',
      remark: dto.remark ?? null,
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: sku.id,
      entityCode: sku.skuCode,
      action: 'CREATE',
      changes: { skuCode: { from: null, to: sku.skuCode }, nameZh: { from: null, to: sku.nameZh } },
      operator,
    });
    return this.toResponse(sku, brand?.name ?? null, category?.nameZh ?? null);
  }

  async getById(id: string): Promise<SkuResponseDto> {
    const sku = await this.findOrThrow(id);
    const names = await this.resolveNames(sku);
    const base = this.toResponse(sku, names.brandName, names.categoryName);
    // 详情带主图（2026-10-26，SKU 映射弹窗要显示选中档案的图片）：列表接口
    // 一直有 primaryImageUrl，详情缺；签名 URL 由对象存储统一给出。
    const imageKey = await this.repository.findPrimaryImageKey(sku.id);
    return {
      ...base,
      primaryImageUrl: imageKey === null ? null : await this.objectStorage.getSignedUrl(imageKey),
    };
  }

  async update(
    id: string,
    dto: UpdateSkuRequestDto,
    operator: OperatorContext,
  ): Promise<SkuResponseDto> {
    const existing = await this.findOrThrow(id);
    const before = this.snapshot(existing);

    // skuCode is frozen after generation (decision 0002): printed labels and
    // historical documents reference it.

    const mergedLength = dto.lengthMm !== undefined ? dto.lengthMm : existing.lengthMm;
    const mergedWidth = dto.widthMm !== undefined ? dto.widthMm : existing.widthMm;
    const mergedHeight = dto.heightMm !== undefined ? dto.heightMm : existing.heightMm;
    assertDimensionsConsistent(mergedLength, mergedWidth, mergedHeight);
    const volumeMm3 = computeVolumeMm3(mergedLength, mergedWidth, mergedHeight);

    // category/brand follow the same rules as create(); null explicitly clears.
    if (dto.brandId !== undefined && dto.brandId !== null) {
      await this.assertBrandExists(dto.brandId);
    }
    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      await this.assertCategoryExists(dto.categoryId);
    }

    const patch: Partial<SkuEntity> = {};
    if (dto.nameZh !== undefined) patch.nameZh = dto.nameZh;
    if (dto.nameRu !== undefined) patch.nameRu = dto.nameRu;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.brandId !== undefined) patch.brandId = dto.brandId;
    if (dto.model !== undefined) patch.model = dto.model;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.size !== undefined) patch.size = dto.size;
    if (dto.weightG !== undefined) patch.weightG = toNumeric(dto.weightG);
    if (dto.lengthMm !== undefined) patch.lengthMm = dto.lengthMm;
    if (dto.widthMm !== undefined) patch.widthMm = dto.widthMm;
    if (dto.heightMm !== undefined) patch.heightMm = dto.heightMm;
    patch.volumeMm3 = toNumeric(volumeMm3);
    if (dto.purchaseUrl !== undefined) {
      patch.purchaseUrl = dto.purchaseUrl === null ? null : dto.purchaseUrl;
    }
    if (dto.latestPurchasePrice !== undefined) {
      patch.latestPurchasePrice = toNumeric(dto.latestPurchasePrice);
    }
    if (dto.costCurrency !== undefined) patch.costCurrency = dto.costCurrency;
    if (dto.serialTracking !== undefined) patch.serialTracking = dto.serialTracking;
    if (dto.remark !== undefined) patch.remark = dto.remark;

    await this.repository.update(id, patch);
    const updated = await this.findOrThrow(id);
    const names = await this.resolveNames(updated);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.skuCode,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated)),
      operator,
    });
    return this.toResponse(updated, names.brandName, names.categoryName);
  }

  async setStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<SkuResponseDto> {
    const existing = await this.findOrThrow(id);
    await this.repository.update(id, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.skuCode,
      action:
        status === 'ACTIVE' ? 'ACTIVATE' : status === 'INACTIVE' ? 'DEACTIVATE' : 'STATUS_CHANGE',
      changes: { status: { from: existing.status, to: status } },
      operator,
    });
    const updated = await this.findOrThrow(id);
    const names = await this.resolveNames(updated);
    return this.toResponse(updated, names.brandName, names.categoryName);
  }

  /** Cross-module lookups (listing / import services). */
  async getEntityById(id: string): Promise<SkuEntity | null> {
    return this.repository.findById(id);
  }

  /**
   * Same lookup on the CALLER's transaction (Sprint 8 T1): rows created inside
   * that transaction (e.g. the SKU quick-onboarding just built) are invisible
   * to the default connection until commit, so cross-module InTx participants
   * must read through the shared manager.
   */
  async getEntityByIdInTx(manager: EntityManager, id: string): Promise<SkuEntity | null> {
    return manager.getRepository(SkuEntity).findOneBy({ id });
  }

  /**
   * Moving-average cost update on receipt confirmation (Sprint 7, decision
   * 0013 par6, master-data.md par4). Runs on the CALLER's transaction; the
   * weighted arithmetic happens in SQL NUMERIC so precision is exact
   * (AGENTS.md par58 forbids float money). totalOnHand is the SKU's
   * warehouse-wide on-hand INCLUDING this receipt (read on the same tx).
   * Returns the new average for auditing.
   */
  async applyMovingAverageCostInTx(
    manager: EntityManager,
    input: { skuId: string; receivedQty: string; unitCost: string; totalOnHand: string },
  ): Promise<string> {
    const result = await manager.query<Array<{ avg: string }>>(
      `UPDATE skus
       SET moving_average_cost = CASE
             WHEN moving_average_cost IS NULL THEN $2::numeric
             ELSE ROUND(
               (moving_average_cost * ($4::numeric - $3::numeric)
                + $2::numeric * $3::numeric) / $4::numeric, 4)
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING moving_average_cost::text AS avg`,
      [input.skuId, input.unitCost, input.receivedQty, input.totalOnHand],
    );
    return result[0]?.avg ?? '';
  }

  /**
   * 最近采购价（2026-11-09 用户口径）：**收货确认时**用本次明细 `unit_cost`
   * 覆盖 `skus.latest_purchase_price`。
   *
   * 与移动平均成本的分工：平均成本是加权库存成本（决策 0013 §6），最近采购价
   * 是「最近一次采购单价」的快照，不做加权。草稿/未确认收货不写（与成本一致）。
   * 同日多次收货按确认顺序后写覆盖先写 = 最近一次确认生效。
   */
  async setLatestPurchasePriceInTx(
    manager: EntityManager,
    skuId: string,
    unitCost: string,
  ): Promise<void> {
    await manager.query(
      `UPDATE skus
          SET latest_purchase_price = $2::numeric,
              updated_at = now()
        WHERE id = $1`,
      [skuId, unitCost],
    );
  }

  /**
   * Cross-module tx participant (Sprint 8 T1; V1 refactor D2/D3/D5): creates
   * the SKU row on the CALLER's transaction with the global code (SKU%09d).
   * Logging stays with the caller (after commit).
   *
   * Sprint 8.5 T5: optional physical attributes (v4-enriched prefills,
   * user-editable in the dialog). Same all-or-none dimension rule and
   * backend-computed volume as the regular create() - the client can never
   * write volume_mm3 directly.
   *
   * Sprint 8.5R1: optional latest purchase price - the human-entry channel
   * for master-data §4.3 (`latest_purchase_price` is operator-maintained and
   * independent of the moving average cost, which only receipts confirm).
   *
   * V1: brand/category land on the SKU itself (D5) with the same validation
   * rules as create(); the SKU is ACTIVE from birth (D3).
   */
  async createForOnboardingInTx(
    manager: EntityManager,
    input: {
      nameZh: string;
      brandId?: string | null;
      categoryId?: string | null;
      weightG?: number | null;
      lengthMm?: number | null;
      widthMm?: number | null;
      heightMm?: number | null;
      latestPurchasePrice?: number | null;
    },
  ): Promise<SkuEntity> {
    const brand =
      input.brandId === undefined || input.brandId === null
        ? null
        : await this.assertBrandExists(input.brandId);
    const category =
      input.categoryId === undefined || input.categoryId === null
        ? null
        : await this.assertCategoryExists(input.categoryId);

    const lengthMm = input.lengthMm ?? null;
    const widthMm = input.widthMm ?? null;
    const heightMm = input.heightMm ?? null;
    assertDimensionsConsistent(lengthMm, widthMm, heightMm);
    // Global sequence consumed INSIDE the caller's transaction: a rollback
    // returns the number instead of burning it.
    const skuCode = await this.businessCode.nextSkuCodeGlobal(manager);
    const repository = manager.getRepository(SkuEntity);
    const created = repository.create({
      skuCode,
      nameZh: input.nameZh,
      nameRu: null,
      categoryId: category?.id ?? null,
      brandId: brand?.id ?? null,
      model: null,
      color: null,
      size: null,
      weightG: toNumeric(input.weightG ?? null),
      lengthMm,
      widthMm,
      heightMm,
      volumeMm3: toNumeric(computeVolumeMm3(lengthMm, widthMm, heightMm)),
      purchaseUrl: null,
      latestPurchasePrice: toNumeric(input.latestPurchasePrice ?? null),
      movingAverageCost: null,
      costCurrency: 'CNY',
      serialTracking: false,
      status: 'ACTIVE',
      remark: null,
    });
    return repository.save(created);
  }

  /** Zero-reference hard delete (decision 0003); referenced -> SKU_IN_USE. */
  async remove(id: string, operator: OperatorContext): Promise<void> {
    const existing = await this.findOrThrow(id);
    const references = await this.repository.countReferences(id);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new SkuInUseError(used.map((reference) => reference.table));
    }
    await this.repository.delete(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.skuCode,
      action: 'DELETE',
      changes: { deleted: { from: existing.skuCode, to: null } },
      operator,
    });
  }

  /**
   * Forced delete (decision 0008): cascades master-data children (barcodes,
   * images, bundle links, platform mappings) and refuses when business history
   * exists.
   *
   * The inventory ledger, order lines, picking tasks and shipments are
   * evidence that the SKU physically moved; deleting them would break the
   * audit chain (AGENTS.md §25) and the inventory rules (§10/§17). A seller
   * who mis-created a SKU can therefore clean it up in one action, but can
   * never erase what actually happened.
   */
  async forceRemove(id: string, operator: OperatorContext): Promise<void> {
    const existing = await this.findOrThrow(id);
    const blocking = await this.repository.countReferencesIn(id, SKU_HISTORY_TABLES);
    const used = blocking.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new SkuHasHistoryError(used.map((reference) => reference.table));
    }
    await this.repository.deleteWithCascade(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: existing.skuCode,
      action: 'FORCE_DELETE',
      changes: { deleted: { from: existing.skuCode, to: null } },
      operator,
    });
  }

  async getEntityByCode(skuCode: string): Promise<SkuEntity | null> {
    return this.repository.findByCode(skuCode);
  }

  private async findOrThrow(id: string): Promise<SkuEntity> {
    const sku = await this.repository.findById(id);
    if (sku === null) {
      throw new SkuNotFoundError(id);
    }
    return sku;
  }

  /** Brand must exist (reuses the catalog public Service; decision 0003 rules). */
  private async assertBrandExists(brandId: string): Promise<{ id: string; name: string }> {
    const brand = await this.catalogService.findBrandEntityById(brandId);
    if (brand === null) {
      throw new BrandNotFoundError(brandId);
    }
    return brand;
  }

  /** Category must exist AND be level 3 (decision 0005). */
  private async assertCategoryExists(categoryId: string): Promise<{ id: string; nameZh: string }> {
    const category = await this.catalogService.findCategoryEntityById(categoryId);
    if (category === null) {
      throw new CategoryNotFoundError(categoryId);
    }
    if (category.level !== 3) {
      throw new CategoryLevelInvalidError(categoryId, category.level);
    }
    return category;
  }

  private async resolveNames(sku: SkuEntity): Promise<{
    brandName: string | null;
    categoryName: string | null;
  }> {
    const brandName =
      sku.brandId === null
        ? null
        : ((await this.catalogService.findBrandEntityById(sku.brandId))?.name ?? null);
    const categoryName =
      sku.categoryId === null
        ? null
        : ((await this.catalogService.findCategoryEntityById(sku.categoryId))?.nameZh ?? null);
    return { brandName, categoryName };
  }

  private snapshot(sku: SkuEntity): Record<string, unknown> {
    return {
      skuCode: sku.skuCode,
      nameZh: sku.nameZh,
      categoryId: sku.categoryId,
      brandId: sku.brandId,
      model: sku.model,
      color: sku.color,
      size: sku.size,
      weightG: sku.weightG,
      lengthMm: sku.lengthMm,
      widthMm: sku.widthMm,
      heightMm: sku.heightMm,
      volumeMm3: sku.volumeMm3,
      purchaseUrl: sku.purchaseUrl,
      latestPurchasePrice: sku.latestPurchasePrice,
      costCurrency: sku.costCurrency,
      serialTracking: sku.serialTracking,
      remark: sku.remark,
    };
  }

  private toResponse(
    sku: SkuEntity,
    brandName: string | null,
    categoryName: string | null,
  ): SkuResponseDto {
    return {
      id: sku.id,
      skuCode: sku.skuCode,
      nameZh: sku.nameZh,
      nameRu: sku.nameRu,
      categoryId: sku.categoryId,
      categoryName,
      brandId: sku.brandId,
      brandName,
      model: sku.model,
      color: sku.color,
      size: sku.size,
      weightG: numOrNull(sku.weightG),
      lengthMm: sku.lengthMm,
      widthMm: sku.widthMm,
      heightMm: sku.heightMm,
      volumeMm3: numOrNull(sku.volumeMm3),
      purchaseUrl: sku.purchaseUrl,
      latestPurchasePrice: numOrNull(sku.latestPurchasePrice),
      movingAverageCost: numOrNull(sku.movingAverageCost),
      costCurrency: sku.costCurrency,
      serialTracking: sku.serialTracking,
      status: sku.status,
      remark: sku.remark,
      createdAt: sku.createdAt,
      updatedAt: sku.updatedAt,
      // 默认 null；getById 用签名 URL 覆盖（2026-10-26）。
      primaryImageUrl: null,
    };
  }
}

function numOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Serializes a client-supplied number for a numeric/decimal column, or null.
 *
 * `null` must be handled explicitly: antd InputNumber sends null when a field
 * is cleared, and `String(null)` would reach Postgres as the literal "null"
 * and fail with `invalid input syntax for type numeric`. Number.isFinite also
 * rejects NaN/Infinity, which the same way would only surface as a database
 * error.
 */
export function toNumeric(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return String(value);
}
