import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Queue } from 'bullmq';
import { SkuImageImportService } from './sku-image-import.service';
import { SkuImageService } from './sku-image.service';
import { SkuService } from './sku.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

/**
 * Sprint 8.5 T6: CDN -> own-bucket image import. Upload goes through the
 * regular SkuImageService channel (whitelist + size cap) and the first image
 * of a fresh SKU becomes primary. V1: the products.main_image_id backfill is
 * gone with the product layer. Failures throw so BullMQ retries.
 */

function buildService(overrides?: { sku?: { id: string } | null; existingImages?: unknown[] }) {
  const queue = { add: vi.fn(async () => ({})) } as unknown as Queue;
  const skuImageService = {
    listBySku: vi.fn(async () => overrides?.existingImages ?? []),
    upload: vi.fn(async () => ({ id: 'img-1', objectKey: 'products/1/skus/s1/x.jpg' })),
  } as unknown as SkuImageService;
  const skuService = {
    getEntityById: vi.fn(async () => overrides?.sku ?? null),
  } as unknown as SkuService;
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as AppLoggerService;
  const service = new SkuImageImportService(queue, skuImageService, skuService, logger);
  return { service, queue, skuImageService, skuService };
}

describe('SkuImageImportService', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('schedules a job with the sku-scoped idempotent jobId', async () => {
    const ctx = buildService();
    await ctx.service.scheduleFromOnboard('sku-1', 'https://cdn/img.jpg');
    expect(ctx.queue.add).toHaveBeenCalledWith(
      'import',
      { skuId: 'sku-1', imageUrl: 'https://cdn/img.jpg' },
      expect.objectContaining({ jobId: 'sku-image-import-sku-1', attempts: 5 }),
    );
  });

  it('ignores empty urls (nothing to import)', async () => {
    const ctx = buildService();
    expect(await ctx.service.scheduleFromOnboard('sku-1', null)).toBe(false);
    expect(await ctx.service.scheduleFromOnboard('sku-1', '  ')).toBe(false);
    expect(ctx.queue.add).not.toHaveBeenCalled();
  });

  it('downloads and uploads as the primary SKU image', async () => {
    const ctx = buildService({ sku: { id: 'sku-1' } });
    const status = await ctx.service.process({ skuId: 'sku-1', imageUrl: 'https://cdn/img.jpg' });
    expect(status).toBe('imported');
    expect(ctx.skuImageService.upload).toHaveBeenCalledWith(
      'sku-1',
      expect.objectContaining({ mimeType: 'image/jpeg', size: 3 }),
      expect.anything(),
      { isPrimary: true },
    );
  });

  it('skips when the SKU already has images (idempotent retry)', async () => {
    const ctx = buildService({
      sku: { id: 'sku-1' },
      existingImages: [{ id: 'old' }],
    });
    const status = await ctx.service.process({ skuId: 'sku-1', imageUrl: 'https://cdn/img.jpg' });
    expect(status).toBe('skipped');
    expect(ctx.skuImageService.upload).not.toHaveBeenCalled();
  });

  it('skips when the SKU no longer exists (deleted between commit and processing)', async () => {
    const ctx = buildService({ sku: null });
    const status = await ctx.service.process({ skuId: 'gone', imageUrl: 'https://cdn/img.jpg' });
    expect(status).toBe('skipped');
  });

  it('rejects unsupported content types (throws -> BullMQ retry)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('nope', { status: 200, headers: { 'content-type': 'text/html' } }),
      ),
    );
    const ctx = buildService({ sku: { id: 'sku-1' } });
    await expect(
      ctx.service.process({ skuId: 'sku-1', imageUrl: 'https://cdn/img.jpg' }),
    ).rejects.toThrow(/unsupported content-type/);
  });

  it('throws on download HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 404 })),
    );
    const ctx = buildService({ sku: { id: 'sku-1' } });
    await expect(
      ctx.service.process({ skuId: 'sku-1', imageUrl: 'https://cdn/img.jpg' }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
