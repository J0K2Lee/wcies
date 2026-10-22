import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Job } from 'bullmq';
import { ListingSyncProcessor } from './sync.processors';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { ListingSyncService } from '../services/listing-sync.service';
import { OrderSyncService } from '../services/order-sync.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

function build() {
  const jobRepo = {
    claimRunning: vi.fn().mockResolvedValue(true),
    findById: vi.fn().mockResolvedValue({ id: 'job-1', storeId: 'store-1' }),
    finalize: vi.fn().mockResolvedValue(undefined),
  };
  const listingSync = { execute: vi.fn().mockResolvedValue(undefined) };
  const orderSync = { enrichPlatformImages: vi.fn().mockResolvedValue({ updated: 3 }) };
  const logger = { warn: vi.fn(), error: vi.fn() };
  const processor = new ListingSyncProcessor(
    jobRepo as unknown as SyncJobRepository,
    listingSync as unknown as ListingSyncService,
    orderSync as unknown as OrderSyncService,
    logger as unknown as AppLoggerService,
  );
  return { processor, jobRepo, listingSync, orderSync };
}

const job = { data: { syncJobId: 'job-1' } } as Job<{ syncJobId: string }>;

describe('ListingSyncProcessor (2026-10-22 订单行图片回补)', () => {
  it('backfills order-line images for the same store after a listing sync', async () => {
    const ctx = build();
    await ctx.processor.process(job);

    expect(ctx.listingSync.execute).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1' }));
    expect(ctx.orderSync.enrichPlatformImages).toHaveBeenCalledWith('store-1');
    // listing 结果必须等图片回补完成后再返回（顺序有意义：先刷 listing 才有图源）。
    expect(
      ctx.listingSync.execute.mock.invocationCallOrder[0]! <
        ctx.orderSync.enrichPlatformImages.mock.invocationCallOrder[0]!,
    ).toBe(true);
  });

  it('does not backfill when the job row cannot be claimed', async () => {
    const ctx = build();
    ctx.jobRepo.claimRunning.mockResolvedValue(false);
    await ctx.processor.process(job);
    expect(ctx.orderSync.enrichPlatformImages).not.toHaveBeenCalled();
  });
});
