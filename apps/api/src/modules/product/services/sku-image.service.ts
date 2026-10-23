import { Injectable } from '@nestjs/common';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import {
  SkuImageEntity,
  IMAGE_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
} from '../entities/sku-image.entity';
import { FileInvalidType, FileTooLargeError, ImageNotFoundError } from '../errors/image-errors';
import { SkuNotFoundError } from '../errors/sku-errors';
import { SkuRepository } from '../repositories/sku.repository';
import { SkuImageRepository } from '../repositories/sku-image.repository';
import { SkuImageResponseDto, UpdateSkuImageRequestDto } from '../dto/barcode-image.dto';

const ENTITY_TYPE = 'SKU_IMAGE';

export interface UploadedImageFile {
  buffer: Buffer;
  mimeType: string;
  size: number;
}

/**
 * SKU images (task §33/§34). Files go to object storage via the Sprint 0
 * ObjectStorageService only (AGENTS.md §68); the bucket stays private and
 * reads always use signed URLs.
 */
@Injectable()
export class SkuImageService {
  constructor(
    private readonly repository: SkuImageRepository,
    private readonly skuRepository: SkuRepository,
    private readonly objectStorage: ObjectStorageService,
    private readonly operationLog: OperationLogService,
  ) {}

  async listBySku(skuId: string): Promise<SkuImageResponseDto[]> {
    await this.assertSkuExists(skuId);
    const images = await this.repository.listBySkuId(skuId);
    return await Promise.all(images.map(async (image) => this.toResponse(image)));
  }

  /**
   * SKU 主图 URL 批量查询（2026-10-24，采购单展开明细用）：一次取主图、
   * 一次签名，返回「skuId → 签名 URL」。没有图片的 SKU 不出现在 Map 里。
   */
  async primaryUrlsBySkuIds(skuIds: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (skuIds.length === 0) {
      return result;
    }
    const rows = await this.repository.listPrimaryBySkuIds([...new Set(skuIds)]);
    await Promise.all(
      rows.map(async (row) => {
        const url = await this.objectStorage.getSignedUrl(row.objectKey);
        result.set(row.skuId, url);
      }),
    );
    return result;
  }

  async upload(
    skuId: string,
    file: UploadedImageFile,
    operator: OperatorContext,
    options?: { width?: number; height?: number; isPrimary?: boolean },
  ): Promise<SkuImageResponseDto> {
    const sku = await this.skuRepository.findById(skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
      throw new FileInvalidType(file.mimeType);
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new FileTooLargeError(MAX_IMAGE_SIZE_BYTES);
    }

    const extension = extensionOf(file.mimeType);
    const objectKey = `products/${sku.productId}/skus/${skuId}/${crypto.randomUUID()}.${extension}`;
    await this.objectStorage.upload({
      key: objectKey,
      body: file.buffer,
      contentType: file.mimeType,
    });

    const existing = await this.repository.listBySkuId(skuId);
    const isPrimary = options?.isPrimary ?? existing.length === 0;

    const image = await this.repository.insert({
      skuId,
      objectKey,
      mimeType: file.mimeType,
      fileSize: String(file.size),
      width: options?.width ?? null,
      height: options?.height ?? null,
      sortOrder: existing.length,
      isPrimary,
    });

    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: image.id,
      entityCode: objectKey,
      action: 'UPLOAD',
      changes: {
        objectKey: { from: null, to: objectKey },
        isPrimary: { from: null, to: isPrimary },
      },
      operator,
    });
    return this.toResponse(image);
  }

  async update(
    skuId: string,
    imageId: string,
    dto: UpdateSkuImageRequestDto,
    operator: OperatorContext,
  ): Promise<SkuImageResponseDto> {
    const image = await this.findOwnedOrThrow(skuId, imageId);
    await this.repository.updateWithPrimaryHandling(imageId, skuId, {
      sortOrder: dto.sortOrder,
      isPrimary: dto.isPrimary,
    });
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: imageId,
      entityCode: image.objectKey,
      action: 'UPDATE',
      changes: {
        sortOrder: { from: image.sortOrder, to: dto.sortOrder ?? image.sortOrder },
        isPrimary: { from: image.isPrimary, to: dto.isPrimary ?? image.isPrimary },
      },
      operator,
    });
    const updated = await this.repository.findById(imageId);
    return this.toResponse(updated as SkuImageEntity);
  }

  /** Removes the DB row and the stored object (task §107: unreferenced only). */
  async delete(skuId: string, imageId: string, operator: OperatorContext): Promise<void> {
    const image = await this.findOwnedOrThrow(skuId, imageId);
    await this.repository.deleteById(imageId);
    await this.objectStorage.delete(image.objectKey);
    await this.operationLog.record({
      entityType: ENTITY_TYPE,
      entityId: imageId,
      entityCode: image.objectKey,
      action: 'DELETE',
      changes: { objectKey: { from: image.objectKey, to: null } },
      operator,
    });
  }

  async signedUrlOf(imageId: string): Promise<string> {
    const image = await this.repository.findById(imageId);
    if (image === null) {
      throw new ImageNotFoundError(imageId);
    }
    return this.objectStorage.getSignedUrl(image.objectKey);
  }

  private async assertSkuExists(skuId: string): Promise<void> {
    const sku = await this.skuRepository.findById(skuId);
    if (sku === null) {
      throw new SkuNotFoundError(skuId);
    }
  }

  private async findOwnedOrThrow(skuId: string, imageId: string): Promise<SkuImageEntity> {
    await this.assertSkuExists(skuId);
    const image = await this.repository.findById(imageId);
    if (image === null || image.skuId !== skuId) {
      throw new ImageNotFoundError(imageId);
    }
    return image;
  }

  private async toResponse(image: SkuImageEntity): Promise<SkuImageResponseDto> {
    const url = await this.objectStorage.getSignedUrl(image.objectKey);
    return {
      id: image.id,
      skuId: image.skuId,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
      mimeType: image.mimeType,
      fileSize: Number(image.fileSize),
      width: image.width,
      height: image.height,
      url,
      createdAt: image.createdAt,
    };
  }
}

function extensionOf(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}
