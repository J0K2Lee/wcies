import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { IMAGE_MIME_TYPES, MAX_IMAGE_SIZE_BYTES } from '../entities/sku-image.entity';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { SkuImageService } from './sku-image.service';
import { SkuService } from './sku.service';

export interface SkuImageImportJobPayload {
  readonly skuId: string;
  readonly imageUrl: string;
}

/** System operator for background image imports (audit trail stays complete). */
const SYSTEM_OPERATOR: OperatorContext = { userId: null, username: 'system' };

/**
 * Sprint 8.5 T6: async CDN -> own-bucket image transfer for onboarding.
 *
 * STRICTLY post-commit: quick onboarding enqueues AFTER its transaction
 * succeeds, so an image failure never rolls back (or blocks) master-data
 * facts, and no external HTTP ever runs inside the onboarding transaction.
 * The processor downloads `color_image ?? primary_image` and stores it
 * through the regular SkuImageService channel (private bucket + signed
 * URLs).
 *
 * V1 (2026-10-13): the `products.main_image_id` backfill branch is gone
 * with the product layer - the first imported image is the SKU's primary
 * image, full stop.
 */
@Injectable()
export class SkuImageImportService {
  constructor(
    @InjectQueue(QUEUE_NAMES.media)
    private readonly queue: Queue<SkuImageImportJobPayload>,
    private readonly skuImageService: SkuImageService,
    private readonly skuService: SkuService,
    private readonly logger: AppLoggerService,
  ) {}

  /** Enqueue (after commit). Returns false when there is nothing to import. */
  async scheduleFromOnboard(skuId: string, imageUrl: string | null): Promise<boolean> {
    if (imageUrl === null || imageUrl.trim() === '') {
      return false;
    }
    await this.queue.add(
      'import',
      { skuId, imageUrl: imageUrl.trim() },
      {
        // Idempotent per SKU: a redelivery of the same job id is skipped by
        // BullMQ, and the processor itself re-checks existing images.
        jobId: `sku-image-import-${skuId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
    return true;
  }

  /**
   * Worker body. Throws on transport problems so BullMQ retries; returns a
   * status string for the job result.
   */
  async process(payload: SkuImageImportJobPayload): Promise<'imported' | 'skipped'> {
    const sku = await this.skuService.getEntityById(payload.skuId);
    if (sku === null) {
      // The SKU was force-deleted between commit and processing - nothing
      // to attach the image to; not an error.
      return 'skipped';
    }
    const existing = await this.skuImageService.listBySku(payload.skuId);
    if (existing.length > 0) {
      return 'skipped';
    }

    const file = await this.download(payload.imageUrl);
    const image = await this.skuImageService.upload(
      payload.skuId,
      file,
      SYSTEM_OPERATOR,
      // Fresh onboarding SKU has no images yet - first import is primary.
      { isPrimary: true },
    );
    this.logger.info('sku image imported from platform cdn', {
      module: 'product',
      skuId: payload.skuId,
      objectKey: image.id,
    });
    return 'imported';
  }

  /** Downloads with the same whitelist/size cap as a manual upload. */
  private async download(
    imageUrl: string,
  ): Promise<{ buffer: Buffer; mimeType: string; size: number }> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`image download failed: HTTP ${response.status}`);
    }
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!(IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new Error(`image download rejected: unsupported content-type "${mimeType}"`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(
        `image download rejected: ${buffer.byteLength} bytes exceeds ${MAX_IMAGE_SIZE_BYTES}`,
      );
    }
    return { buffer, mimeType, size: buffer.byteLength };
  }
}
