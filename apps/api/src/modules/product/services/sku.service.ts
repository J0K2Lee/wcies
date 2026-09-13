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
import { SKU_HISTORY_TABLES } from '../constants/sku-delete.constants';
import { SkuEntity } from '../entities/sku.entity';
import { ProductEntity } from '../entities/product.entity';
import { ImageNotFoundError } from '../errors/image-errors';
import { ProductNotFoundError } from '../errors/product-errors';
import {
  SkuCodeAlreadyExistsError,
  SkuDimensionsInvalidError,
  SkuHasHistoryError,
  SkuInUseError,
  SkuNotFoundError,
} from '../errors/sku-errors';
import { SkuRepository } from '../repositories/sku.repository';
import { SkuImageRepository } from '../repositories/sku-image.repository';
import { ProductRepository } from '../repositories/product.repository';
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
 * sku_code: auto-generated (SKU{product seq 6}{in-product seq 3}, decision
 * 0002) when omitted, always globally unique and frozen after creation.
 * Units (2026-09-09 convention): weight in g, dimensions in integer mm;
 * volume_mm3 is backend-computed from L x W x H, never accepted from clients.
 * moving_average_cost: reserved, stays null until the purchase sprint.
 */
@Injectable()
export class SkuService {
  constructor(
    private readonly repository: SkuRepository,
    private readonly productRepository: ProductRepository,
    private readonly imageRepository: SkuImageRepository,
    private readonly objectStorage: ObjectStorageService,
    private readonly businessCode: BusinessCodeService,
    private readonly operationLog: OperationLogService,
  ) {}

  async list(
    query: SkuListQueryDto & { page: number; pageSize: number },
  ): Promise<{ items: SkuListItemDto[]; meta: PageMeta }> {
    const { page, pageSize } = query;
    const { rows, total } = await this.repository.listWithAggregates(
      {
        keyword: query.keyword?.trim() || undefined,
        productId: query.productId,
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
        ...this.toResponse(row.sku, row.productCode, row.productName),
        brandId: row.brandId,
        brandName: row.brandName,
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
    const product = await this.productRepository.findById(dto.productId);
    if (product === null) {
      throw new ProductNotFoundError(dto.productId);
    }

    let skuCode = dto.skuCode?.trim();
    if (skuCode === undefined || skuCode === '') {
      skuCode = await this.businessCode.nextSkuCode(product.id, product.codeSeq);
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
      productId: product.id,
      skuCode,
      nameZh: dto.nameZh,
      nameRu: dto.nameRu ?? null,
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
    return this.toResponse(sku, product.productCode, product.nameZh);
  }

  async getById(id: string): Promise<SkuResponseDto> {
    const found = await this.findWithProductOrThrow(id);
    return this.toResponse(found.sku, found.productCode, found.productName);
  }

  async update(
    id: string,
    dto: UpdateSkuRequestDto,
    operator: OperatorContext,
  ): Promise<SkuResponseDto> {
    const found = await this.findWithProductOrThrow(id);
    const before = this.snapshot(found.sku);

    // skuCode is frozen after generation (decision 0002): printed labels and
    // historical documents reference it.

    const mergedLength = dto.lengthMm !== undefined ? dto.lengthMm : found.sku.lengthMm;
    const mergedWidth = dto.widthMm !== undefined ? dto.widthMm : found.sku.widthMm;
    const mergedHeight = dto.heightMm !== undefined ? dto.heightMm : found.sku.heightMm;
    assertDimensionsConsistent(mergedLength, mergedWidth, mergedHeight);
    const volumeMm3 = computeVolumeMm3(mergedLength, mergedWidth, mergedHeight);

    const patch: Partial<SkuEntity> = {};
    if (dto.nameZh !== undefined) patch.nameZh = dto.nameZh;
    if (dto.nameRu !== undefined) patch.nameRu = dto.nameRu;
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
    const updated = await this.findWithProductOrThrow(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: updated.sku.skuCode,
      action: 'UPDATE',
      changes: diffOf(before, this.snapshot(updated.sku)),
      operator,
    });
    return this.toResponse(updated.sku, updated.productCode, updated.productName);
  }

  async setStatus(
    id: string,
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE',
    operator: OperatorContext,
  ): Promise<SkuResponseDto> {
    const found = await this.findWithProductOrThrow(id);
    await this.repository.update(id, { status });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: found.sku.skuCode,
      action:
        status === 'ACTIVE' ? 'ACTIVATE' : status === 'INACTIVE' ? 'DEACTIVATE' : 'STATUS_CHANGE',
      changes: { status: { from: found.sku.status, to: status } },
      operator,
    });
    const updated = await this.findWithProductOrThrow(id);
    return this.toResponse(updated.sku, updated.productCode, updated.productName);
  }

  async listByProductId(productId: string): Promise<SkuResponseDto[]> {
    const product = await this.productRepository.findById(productId);
    if (product === null) {
      throw new ProductNotFoundError(productId);
    }
    const skus = await this.repository.listByProductIds([productId]);
    return skus.map((sku) => this.toResponse(sku, product.productCode, product.nameZh));
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
   * Cross-module tx participant (Sprint 8 T1): creates the SKU row on the
   * CALLER's transaction with the standard derived code (decision 0002).
   * Logging stays with the caller (after commit).
   *
   * Sprint 8.5 T5: optional physical attributes (v4-enriched prefills,
   * user-editable in the dialog). Same all-or-none dimension rule and
   * backend-computed volume as the regular create() - the client can never
   * write volume_mm3 directly.
   */
  async createForOnboardingInTx(
    manager: EntityManager,
    input: {
      productId: string;
      nameZh: string;
      weightG?: number | null;
      lengthMm?: number | null;
      widthMm?: number | null;
      heightMm?: number | null;
    },
  ): Promise<SkuEntity> {
    const product = await manager.getRepository(ProductEntity).findOneBy({
      id: input.productId,
    });
    if (product === null) {
      throw new ProductNotFoundError(input.productId);
    }
    const lengthMm = input.lengthMm ?? null;
    const widthMm = input.widthMm ?? null;
    const heightMm = input.heightMm ?? null;
    assertDimensionsConsistent(lengthMm, widthMm, heightMm);
    const skuCode = await this.businessCode.nextSkuCode(product.id, product.codeSeq, manager);
    const repository = manager.getRepository(SkuEntity);
    const created = repository.create({
      productId: product.id,
      skuCode,
      nameZh: input.nameZh,
      nameRu: null,
      model: null,
      color: null,
      size: null,
      weightG: toNumeric(input.weightG ?? null),
      lengthMm,
      widthMm,
      heightMm,
      volumeMm3: toNumeric(computeVolumeMm3(lengthMm, widthMm, heightMm)),
      purchaseUrl: null,
      latestPurchasePrice: null,
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
    const found = await this.findWithProductOrThrow(id);
    const references = await this.repository.countReferences(id);
    const used = references.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new SkuInUseError(used.map((reference) => reference.table));
    }
    await this.repository.delete(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: found.sku.skuCode,
      action: 'DELETE',
      changes: { deleted: { from: found.sku.skuCode, to: null } },
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
    const found = await this.findWithProductOrThrow(id);
    const blocking = await this.repository.countReferencesIn(id, SKU_HISTORY_TABLES);
    const used = blocking.filter((reference) => reference.count > 0);
    if (used.length > 0) {
      throw new SkuHasHistoryError(used.map((reference) => reference.table));
    }
    await this.repository.deleteWithCascade(id);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: id,
      entityCode: found.sku.skuCode,
      action: 'FORCE_DELETE',
      changes: { deleted: { from: found.sku.skuCode, to: null } },
      operator,
    });
  }

  async getEntityByCode(skuCode: string): Promise<SkuEntity | null> {
    return this.repository.findByCode(skuCode);
  }

  /**
   * Business-history references of every SKU under a product, so a forced
   * product delete can report exactly which SKU and table blocks it
   * (decision 0008).
   */
  async findHistoryBlockersForProduct(
    skuIds: string[],
  ): Promise<Array<{ skuId: string; table: string; count: number }>> {
    const blockers: Array<{ skuId: string; table: string; count: number }> = [];
    for (const skuId of skuIds) {
      const references = await this.repository.countReferencesIn(skuId, SKU_HISTORY_TABLES);
      for (const reference of references) {
        if (reference.count > 0) {
          blockers.push({ skuId, table: reference.table, count: reference.count });
        }
      }
    }
    return blockers;
  }

  async assertImageBelongsToProduct(imageId: string, productId: string): Promise<void> {
    const image = await this.imageRepository.findById(imageId);
    if (image === null) {
      throw new ImageNotFoundError(imageId);
    }
    const sku = await this.repository.findById(image.skuId);
    if (sku === null || sku.productId !== productId) {
      throw new ImageNotFoundError(imageId);
    }
  }

  private async findWithProductOrThrow(
    id: string,
  ): Promise<{ sku: SkuEntity; productCode: string; productName: string }> {
    const sku = await this.repository.findById(id);
    if (sku === null) {
      throw new SkuNotFoundError(id);
    }
    const product = await this.productRepository.findById(sku.productId);
    if (product === null) {
      throw new ProductNotFoundError(sku.productId);
    }
    return { sku, productCode: product.productCode, productName: product.nameZh };
  }

  private snapshot(sku: SkuEntity): Record<string, unknown> {
    return {
      skuCode: sku.skuCode,
      nameZh: sku.nameZh,
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

  toResponse(sku: SkuEntity, productCode: string, productName: string): SkuResponseDto {
    return {
      id: sku.id,
      skuCode: sku.skuCode,
      nameZh: sku.nameZh,
      nameRu: sku.nameRu,
      productId: sku.productId,
      productCode,
      productName,
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
