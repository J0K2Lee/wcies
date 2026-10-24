import { describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { SyncSchedulerProcessor } from './webhook-scheduler.processors';
import { SyncDispatchService } from '../services/sync-dispatch.service';
import { SyncContextService } from '../services/sync-context.service';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { StoreService } from '../../store/services/store.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { readStoreSyncSettings } from '../sync.constants';

/**
 * Sprint 9 T2 acceptance: the scheduler is DOUBLE-gated - the ENV interval
 * must be > 0 AND the store must opt in via settings.sync.orderSyncEnabled.
 * Either gate closed => no dispatch (planning §1.4).
 */

function buildProcessor(env: Record<string, string>, settings: unknown) {
  const dispatch = vi.fn().mockResolvedValue({ id: 'job-1' });
  const processor = new SyncSchedulerProcessor(
    {} as Queue,
    new ConfigService(env),
    { dispatch } as unknown as SyncDispatchService,
    { resolveSyncableStore: vi.fn().mockResolvedValue({}) } as unknown as SyncContextService,
    {
      failStaleRunning: vi.fn().mockResolvedValue(undefined),
      failStalePending: vi.fn().mockResolvedValue(0),
    } as unknown as SyncJobRepository,
    {
      listAllActive: vi.fn().mockResolvedValue([{ id: 'store-1', settings }]),
    } as unknown as StoreService,
    { warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService,
  );
  return { processor, dispatch };
}

describe('SyncSchedulerProcessor 坏死任务回收（2026-10-24）', () => {
  it('每次 tick 同时回收 RUNNING 与「等不到执行」的 PENDING', async () => {
    const failStaleRunning = vi.fn().mockResolvedValue(0);
    const failStalePending = vi.fn().mockResolvedValue(3);
    const processor = new SyncSchedulerProcessor(
      {} as Queue,
      new ConfigService({ ORDER_SYNC_INTERVAL_SECONDS: '0' }),
      { dispatch: vi.fn() } as unknown as SyncDispatchService,
      { resolveSyncableStore: vi.fn() } as unknown as SyncContextService,
      { failStaleRunning, failStalePending } as unknown as SyncJobRepository,
      { listAllActive: vi.fn().mockResolvedValue([]) } as unknown as StoreService,
      { warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService,
    );
    await processor.process({ data: {} } as never);
    expect(failStaleRunning).toHaveBeenCalledWith(10);
    expect(failStalePending).toHaveBeenCalledWith(10);
  });
});

describe('SyncSchedulerProcessor store gating (Sprint 9 T2)', () => {
  it('readStoreSyncSettings treats absent sync settings as all-off', () => {
    expect(readStoreSyncSettings(null)).toEqual({});
    expect(readSyncSettingsOf({ sync: { orderSyncEnabled: true } })).toEqual({
      orderSyncEnabled: true,
      listingSyncEnabled: false,
    });
  });

  it('does not dispatch ORDER_SYNC when the store has not opted in', async () => {
    const { processor, dispatch } = buildProcessor({ ORDER_SYNC_INTERVAL_SECONDS: '300' }, null);
    await processor.process({ data: {} } as never);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches ORDER_SYNC for an opted-in store (SCHEDULED trigger)', async () => {
    const { processor, dispatch } = buildProcessor(
      { ORDER_SYNC_INTERVAL_SECONDS: '300' },
      { sync: { orderSyncEnabled: true } },
    );
    await processor.process({ data: {} } as never);
    expect(dispatch).toHaveBeenCalledWith({
      storeId: 'store-1',
      syncType: 'ORDER_SYNC',
      trigger: 'SCHEDULED',
    });
  });

  it('never dispatches when both intervals are 0 (default off)', async () => {
    const { processor, dispatch } = buildProcessor(
      {},
      { sync: { orderSyncEnabled: true, listingSyncEnabled: true } },
    );
    await processor.process({ data: {} } as never);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch LISTING_SYNC when only orderSyncEnabled is set', async () => {
    const { processor, dispatch } = buildProcessor(
      { ORDER_SYNC_INTERVAL_SECONDS: '300', LISTING_SYNC_INTERVAL_SECONDS: '300' },
      { sync: { orderSyncEnabled: true } },
    );
    await processor.process({ data: {} } as never);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ syncType: 'ORDER_SYNC' }));
  });
});

function readSyncSettingsOf(settings: Record<string, unknown> | null) {
  return readStoreSyncSettings(settings);
}
