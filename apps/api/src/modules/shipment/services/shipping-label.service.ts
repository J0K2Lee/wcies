import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { ObjectStorageService } from '../../../infrastructure/storage/object-storage.service';
import { OrderService } from '../../order/services/order.service';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { PackageRepository } from '../repositories/package.repository';
import { ShippingLabelRepository } from '../repositories/shipping-label.repository';
import { PackageNotFoundError, ShippingLabelInvalidError } from '../errors/shipment.errors';
import { ShippingLabelSource } from '../enums/shipment.constants';
import { ShippingLabelDto } from '../dto/shipment.dto';

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);
const MAX_LABEL_SIZE = 10 * 1024 * 1024;

/**
 * Shipping-label metadata + manual upload (Sprint 4 task §19-§21).
 *
 * Files go through ObjectStorageService ONLY (never an S3 SDK, AGENTS.md §68)
 * into the private bucket; viewing/printing uses short-lived signed URLs, so
 * the browser can open the PDF and print A4 without any desktop helper.
 *
 * 2026-09-18: also owns ORDER-scoped labels fetched from the platform API
 * (source PLATFORM_API): the platform 面单 exists as soon as the platform
 * accepts the order for dispatch, which is before any internal Shipment
 * exists. Same storage rules, same signed-URL viewing.
 */
@Injectable()
export class ShippingLabelService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly packageRepo: PackageRepository,
    private readonly labelRepo: ShippingLabelRepository,
    private readonly objectStorage: ObjectStorageService,
    private readonly operationLog: OperationLogService,
    private readonly orderService: OrderService,
  ) {}

  async upload(
    shipmentId: string,
    input: { fileName: string; mimeType: string; buffer: Buffer; packageId?: string },
    operator: OperatorContext,
  ): Promise<ShippingLabelDto> {
    const shipment = await this.shipmentRepo.findById(shipmentId);
    if (shipment === null) {
      throw new ShippingLabelInvalidError('发货单不存在', { shipmentId });
    }
    if (input.packageId !== undefined) {
      const pkg = await this.packageRepo.findById(input.packageId);
      if (pkg === null || pkg.shipmentId !== shipmentId) {
        throw new PackageNotFoundError(input.packageId);
      }
    }
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new ShippingLabelInvalidError('面单仅支持 PDF / PNG / JPEG 文件', {
        mimeType: input.mimeType,
      });
    }
    if (input.buffer.byteLength > MAX_LABEL_SIZE) {
      throw new ShippingLabelInvalidError('面单文件过大（上限 10MB）', {
        size: input.buffer.byteLength,
      });
    }

    const extension = extensionOf(input.mimeType);
    const objectKey = `shipping-labels/${randomUUID()}.${extension}`;
    await this.objectStorage.upload({
      key: objectKey,
      body: new Uint8Array(input.buffer),
      contentType: input.mimeType,
    });

    const label = await this.labelRepo.insert(this.dataSource.manager, {
      shipmentId,
      packageId: input.packageId ?? null,
      labelType: 'SHIPPING',
      objectKey,
      fileName: sanitizeFileName(input.fileName, extension),
      mimeType: input.mimeType,
      fileSize: input.buffer.byteLength,
      source: 'MANUAL_UPLOAD',
      uploadedBy: operator.userId,
    });
    await this.operationLog.record({
      entityType: 'SHIPPING_LABEL',
      entityId: label.id,
      entityCode: label.fileName,
      action: 'UPLOAD',
      changes: {
        shipmentId: { from: null, to: shipmentId },
        objectKey: { from: null, to: objectKey },
      },
      operator,
    });
    return this.toDto(label, await this.objectStorage.getSignedUrl(label.objectKey));
  }

  async listByShipment(shipmentId: string): Promise<ShippingLabelDto[]> {
    const labels = await this.labelRepo.listByShipmentId(shipmentId);
    return Promise.all(
      labels.map(async (label) =>
        this.toDto(label, await this.objectStorage.getSignedUrl(label.objectKey)),
      ),
    );
  }

  /** Order-scoped labels (platform 面单, fetched before a Shipment exists). */
  async listByOrder(orderId: string): Promise<ShippingLabelDto[]> {
    await this.orderService.getOrderOrThrow(orderId);
    const labels = await this.labelRepo.listByOrderId(orderId);
    return Promise.all(
      labels.map(async (label) =>
        this.toDto(label, await this.objectStorage.getSignedUrl(label.objectKey)),
      ),
    );
  }

  /**
   * 读取面单文件字节（服务端内部使用：批量打印时合并成一个 PDF，用户指示
   * 2026-10-17）。对外仍只返回签名 URL（AGENTS.md §68）。
   */
  async bytesOfLabel(labelId: string): Promise<Buffer> {
    const label = await this.labelRepo.findById(labelId);
    if (label === null) {
      throw new ShippingLabelInvalidError('面单不存在', { labelId });
    }
    return this.objectStorage.download(label.objectKey);
  }

  /** Reuses the newest stored order label of a source, if any (no re-fetch). */
  async findLatestOrderLabel(
    orderId: string,
    source: ShippingLabelSource,
  ): Promise<ShippingLabelDto | null> {
    const label = await this.labelRepo.findLatestByOrderAndSource(orderId, source);
    if (label === null) {
      return null;
    }
    return this.toDto(label, await this.objectStorage.getSignedUrl(label.objectKey));
  }

  /**
   * Stores a PLATFORM_API label fetched for an order (2026-09-18 fulfillment
   * flow). The bytes come from the platform adapter, never from a client
   * upload; the order is the owner because no Shipment exists yet (one is
   * only created from PICKED lines). Same private bucket + signed-URL rule as
   * the manual path (AGENTS.md §68).
   */
  async createPlatformLabelForOrder(
    input: {
      orderId: string;
      fileName: string;
      mimeType: string;
      buffer: Buffer;
      externalLabelId: string | null;
    },
    operator: OperatorContext,
  ): Promise<ShippingLabelDto> {
    await this.orderService.getOrderOrThrow(input.orderId);
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new ShippingLabelInvalidError(`平台面单格式不支持：${input.mimeType}`, {
        mimeType: input.mimeType,
      });
    }
    if (input.buffer.byteLength > MAX_LABEL_SIZE) {
      throw new ShippingLabelInvalidError('面单文件过大（上限 10MB）', {
        size: input.buffer.byteLength,
      });
    }

    const extension = extensionOf(input.mimeType);
    const objectKey = `shipping-labels/${randomUUID()}.${extension}`;
    await this.objectStorage.upload({
      key: objectKey,
      body: new Uint8Array(input.buffer),
      contentType: input.mimeType,
    });

    const label = await this.labelRepo.insert(this.dataSource.manager, {
      shipmentId: null,
      orderId: input.orderId,
      packageId: null,
      labelType: 'SHIPPING',
      objectKey,
      fileName: sanitizeFileName(input.fileName, extension),
      mimeType: input.mimeType,
      fileSize: input.buffer.byteLength,
      source: 'PLATFORM_API',
      externalLabelId: input.externalLabelId,
      uploadedBy: operator.userId,
    });
    await this.operationLog.record({
      entityType: 'SHIPPING_LABEL',
      entityId: label.id,
      entityCode: label.fileName,
      action: 'FETCH_PLATFORM_LABEL',
      changes: {
        orderId: { from: null, to: input.orderId },
        objectKey: { from: null, to: objectKey },
        externalLabelId: { from: null, to: input.externalLabelId },
      },
      operator,
    });
    return this.toDto(label, await this.objectStorage.getSignedUrl(label.objectKey));
  }

  private toDto(
    label: {
      id: string;
      shipmentId: string | null;
      orderId: string | null;
      packageId: string | null;
      labelType: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      source: string;
      externalLabelId: string | null;
      createdAt: Date;
    },
    signedUrl: string,
  ): ShippingLabelDto {
    return {
      id: label.id,
      shipmentId: label.shipmentId,
      orderId: label.orderId,
      packageId: label.packageId,
      labelType: label.labelType,
      fileName: label.fileName,
      mimeType: label.mimeType,
      fileSize: label.fileSize,
      source: label.source,
      externalLabelId: label.externalLabelId,
      createdAt: label.createdAt,
      signedUrl,
    };
  }
}

function extensionOf(mimeType: string): string {
  if (mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (mimeType === 'image/png') {
    return 'png';
  }
  return 'jpg';
}

function sanitizeFileName(name: string, extension: string): string {
  const trimmed = name.trim().slice(0, 200);
  return trimmed === '' ? `label.${extension}` : trimmed;
}
