import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { BusinessCodeService } from '../../../infrastructure/business-code/business-code.service';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { SkuEntity } from '../entities/sku.entity';
import { ImageNotFoundError } from '../errors/image-errors';
import { ProductNotFoundError } from '../errors/product-errors';
import {
  SkuCodeAlreadyExistsError,
  SkuDimensionsInvalidError,
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
      weightG: dto.weightG === undefined ? null : String(dto.weightG),
      lengthMm,
      widthMm,
      heightMm,
      volumeMm3: volumeMm3 === null ? null : String(volumeMm3),
      purchaseUrl: dto.purchaseUrl ?? null,
      latestPurchasePrice:
        dto.latestPurchasePrice === undefined ? null : String(dto.latestPurchasePrice),
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
    if (dto.weightG !== undefined)
      patch.weightG = dto.weightG === null ? null : String(dto.weightG);
    if (dto.lengthMm !== undefined) patch.lengthMm = dto.lengthMm;
    if (dto.widthMm !== undefined) patch.widthMm = dto.widthMm;
    if (dto.heightMm !== undefined) patch.heightMm = dto.heightMm;
    patch.volumeMm3 = volumeMm3 === null ? null : String(volumeMm3);
    if (dto.purchaseUrl !== undefined) {
      patch.purchaseUrl = dto.purchaseUrl === null ? null : dto.purchaseUrl;
    }
    if (dto.latestPurchasePrice !== undefined) {
      patch.latestPurchasePrice =
        dto.latestPurchasePrice === null ? null : String(dto.latestPurchasePrice);
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

  async getEntityByCode(skuCode: string): Promise<SkuEntity | null> {
    return this.repository.findByCode(skuCode);
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
