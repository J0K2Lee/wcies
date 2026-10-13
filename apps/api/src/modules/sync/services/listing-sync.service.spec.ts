import { describe, expect, it, vi } from 'vitest';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { ListingSyncService } from './listing-sync.service';

/**
 * Unit tests for the enrichment chain (2026-10-05): a finished listing walk
 * on an enrichment platform (OZON) auto-dispatches PRODUCT_ENRICHMENT_SYNC
 * with trigger SYSTEM - two steps in one, no manual 补齐 run. The chain is
 * best-effort by design: dispatch failures never retro-fail the finished
 * listing job, and unsupported/failed walks never dispatch.
 */

function buildSyncJob(): SyncJobEntity {
  return { id: 'job-1', storeId: 'store-1', cursorBefore: null } as unknown as SyncJobEntity;
}

interface Harness {
  service: ListingSyncService;
  contextService: { resolveSyncableStore: ReturnType<typeof vi.fn> };
  adapter: { fetchListings: ReturnType<typeof vi.fn> };
  jobRepo: { finalize: ReturnType<typeof vi.fn> };
  dispatchService: { dispatch: ReturnType<typeof vi.fn> };
  logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
}

function buildHarness(platformCode: string): Harness {
  const adapter = {
    platformCode,
    fetchListings: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
  };
  const contextService = {
    resolveSyncableStore: vi.fn().mockResolvedValue({ store: { id: 'store-1' }, adapter }),
    buildStoreContext: vi.fn().mockResolvedValue({}),
  };
  const jobRepo = { finalize: vi.fn().mockResolvedValue(undefined) };
  const dispatchService = { dispatch: vi.fn().mockResolvedValue({ id: 'chained-1' }) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = new ListingSyncService(
    contextService as never,
    { applyPlatformListing: vi.fn() } as never,
    jobRepo as never,
    { upsert: vi.fn() } as never,
    { onFinalized: vi.fn() } as never,
    dispatchService as never,
    logger as never,
  );
  return { service, contextService, adapter, jobRepo, dispatchService, logger };
}

describe('ListingSyncService enrichment chain (two steps in one)', () => {
  it('chains PRODUCT_ENRICHMENT_SYNC with trigger SYSTEM after an OZON SUCCESS walk', async () => {
    const h = buildHarness('OZON');
    await h.service.execute(buildSyncJob());
    expect(h.dispatchService.dispatch).toHaveBeenCalledTimes(1);
    expect(h.dispatchService.dispatch).toHaveBeenCalledWith({
      storeId: 'store-1',
      syncType: 'PRODUCT_ENRICHMENT_SYNC',
      trigger: 'SYSTEM',
    });
    expect(h.jobRepo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'SUCCESS' }),
    );
  });

  it('never chains for platforms without enrichment support (WB/YX harvest natively)', async () => {
    const h = buildHarness('YANDEX');
    await h.service.execute(buildSyncJob());
    expect(h.dispatchService.dispatch).not.toHaveBeenCalled();
    expect(h.jobRepo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'SUCCESS' }),
    );
  });

  it('never chains after a FAILED walk', async () => {
    const h = buildHarness('OZON');
    h.adapter.fetchListings.mockRejectedValue(new Error('ozon timeout'));
    await h.service.execute(buildSyncJob());
    expect(h.dispatchService.dispatch).not.toHaveBeenCalled();
    expect(h.jobRepo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('chain dispatch failure stays best-effort: the listing job keeps its SUCCESS', async () => {
    const h = buildHarness('OZON');
    h.dispatchService.dispatch.mockRejectedValue(new Error('queue down'));
    await h.service.execute(buildSyncJob());
    expect(h.jobRepo.finalize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'SUCCESS' }),
    );
    expect(h.logger.warn).toHaveBeenCalled();
  });
});
