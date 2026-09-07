import { Injectable } from '@nestjs/common';
import { PageMeta } from '@wcies/shared';
import {
  OperatorContext,
  OperationLogService,
  diffOf,
} from '../../operation-log/operation-log.service';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { SkuEntity } from '../entities/sku.entity';
import { ImageNotFoundError } from '../errors/image-errors';
import { ProductNotFoundError } from '../errors/product-errors';
import {
  SkuCodeAlreadyExistsError,
  SkuDimensionsInvalidError,
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

export function computeVolumeCm3(
  lengthCm: number | null,
  widthCm: number | null,
  heightCm: number | null,
): number | null {
  if (lengthCm === null || widthCm === null || heightCm === null) {
    return null;
  }
  return Number((lengthCm * widthCm * heightCm).toFixed(3));
}

/** Asserts dimensions are all-or-none (task §23: volume must be computable). */
export function assertDimensionsConsistent(
  lengthCm: number | null | undefined,
  widthCm: number | null | undefined,
  heightCm: number | null | undefined,
): void {
  const provided = [lengthCm, widthCm, heightCm].filter(
    (value) => value !== null && value !== undefined,
  );
  if (provided.length !== 0 && provided.length !== 3) {
    throw new SkuDimensionsInvalidError();
  }
}

/**
 * Internal SKU master data (task §20-§27).
 *
 * sku_code: auto-generated (SKU%06d) when omitted, always globally unique.
 * volume_cm3: backend-computed from L x W x H, never accepted from clients.
 * moving_average_cost: reserved, stays null until the purchase sprint.
 */
@Injectable()
export class SkuService {
  constructor(
    private readonly repository: SkuRepository,
    private readonly productRepository: ProductRepository,
    private readonly imageRepository: SkuImageRepository,
    private readonly objectStorage: ObjectStorageService,
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
      skuCode = await this.repository.nextSkuCode();
    } else {
      const existing = await this.repository.findByCode(skuCode);
      if (existing !== null) {
        throw new SkuCodeAlreadyExistsError(skuCode);
      }
    }

    const lengthCm = dto.lengthCm ?? null;
    const widthCm = dto.widthCm ?? null;
    const heightCm = dto.heightCm ?? null;
    assertDimensionsConsistent(lengthCm, widthCm, heightCm);
    const volumeCm3 = computeVolumeCm3(lengthCm, widthCm, heightCm);

    const sku = await this.repository.insert({
      productId: product.id,
      skuCode,
      nameZh: dto.nameZh,
      nameRu: dto.nameRu ?? null,
      model: dto.model ?? null,
      color: dto.color ?? null,
      size: dto.size ?? null,
      weightKg: dto.weightKg === undefined ? null : String(dto.weightKg),
      lengthCm: lengthCm === null ? null : String(lengthCm),
      widthCm: widthCm === null ? null : String(widthCm),
      heightCm: heightCm === null ? null : String(heightCm),
      volumeCm3: volumeCm3 === null ? null : String(volumeCm3),
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

    if (dto.skuCode !== undefined) {
      const trimmed = dto.skuCode.trim();
      if (trimmed !== found.sku.skuCode) {
        const conflict = await this.repository.findByCode(trimmed);
        if (conflict !== null && conflict.id !== id) {
          throw new SkuCodeAlreadyExistsError(trimmed);
        }
      }
    }

    const mergedLength = dto.lengthCm !== undefined ? dto.lengthCm : numOrNull(found.sku.lengthCm);
    const mergedWidth = dto.widthCm !== undefined ? dto.widthCm : numOrNull(found.sku.widthCm);
    const mergedHeight = dto.heightCm !== undefined ? dto.heightCm : numOrNull(found.sku.heightCm);
    assertDimensionsConsistent(mergedLength, mergedWidth, mergedHeight);
    const volumeCm3 = computeVolumeCm3(mergedLength, mergedWidth, mergedHeight);

    const patch: Partial<SkuEntity> = {};
    if (dto.skuCode !== undefined) patch.skuCode = dto.skuCode.trim();
    if (dto.nameZh !== undefined) patch.nameZh = dto.nameZh;
    if (dto.nameRu !== undefined) patch.nameRu = dto.nameRu;
    if (dto.model !== undefined) patch.model = dto.model;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.size !== undefined) patch.size = dto.size;
    if (dto.weightKg !== undefined)
      patch.weightKg = dto.weightKg === null ? null : String(dto.weightKg);
    if (dto.lengthCm !== undefined)
      patch.lengthCm = dto.lengthCm === null ? null : String(dto.lengthCm);
    if (dto.widthCm !== undefined)
      patch.widthCm = dto.widthCm === null ? null : String(dto.widthCm);
    if (dto.heightCm !== undefined)
      patch.heightCm = dto.heightCm === null ? null : String(dto.heightCm);
    patch.volumeCm3 = volumeCm3 === null ? null : String(volumeCm3);
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
      weightKg: sku.weightKg,
      lengthCm: sku.lengthCm,
      widthCm: sku.widthCm,
      heightCm: sku.heightCm,
      volumeCm3: sku.volumeCm3,
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
      weightKg: numOrNull(sku.weightKg),
      lengthCm: numOrNull(sku.lengthCm),
      widthCm: numOrNull(sku.widthCm),
      heightCm: numOrNull(sku.heightCm),
      volumeCm3: numOrNull(sku.volumeCm3),
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
