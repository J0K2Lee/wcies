import { describe, expect, it, vi } from 'vitest';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { SyncSchedulerProcessor } from './webhook-scheduler.processors';
import { SyncDispatchService } from '../services/sync-dispatch.service';
import { SyncContextService } from '../services/sync-context.service';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { StoreService } from '../../store/services/store.service';
import { CredentialExpiryService } from '../../store/services/credential-expiry.service';
import { WebhookHealthService } from '../services/webhook-health.service';
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
    { scanIfDue: vi.fn().mockResolvedValue(0) } as unknown as CredentialExpiryService,
    {
      scanIfDue: vi.fn().mockResolvedValue({ scanned: 0, paused: 0, unhealthy: 0 }),
    } as unknown as WebhookHealthService,
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
      { scanIfDue: vi.fn().mockResolvedValue(0) } as unknown as CredentialExpiryService,
      {
        scanIfDue: vi.fn().mockResolvedValue({ scanned: 0, paused: 0, unhealthy: 0 }),
      } as unknown as WebhookHealthService,
      { warn: vi.fn(), info: vi.fn() } as unknown as AppLoggerService,
    );
    await processor.process({ data: {} } as never);
    expect(failStaleRunning).toHaveBeenCalledWith(10);
    expect(failStalePending).toHaveBeenCalledWith(10);
  });
});

describe('SyncSchedulerProcessor store gating (Sprint 9 T2)', () => {
  it('readStoreSyncSettings treats absent sync settings as all-off / default interval', () => {
    expect(readStoreSyncSettings(null)).toEqual({
      orderSyncIntervalMinutes: null,
      listingSyncIntervalMinutes: null,
    });
    expect(readSyncSettingsOf({ sync: { orderSyncEnabled: true } })).toEqual({
      orderSyncEnabled: true,
      listingSyncEnabled: false,
      orderSyncIntervalMinutes: null,
      listingSyncIntervalMinutes: null,
    });
  });

  it('accepts store intervals within bounds and ignores values below the floor', () => {
    expect(
      readSyncSettingsOf({
        sync: { orderSyncIntervalMinutes: 15, listingSyncIntervalMinutes: 30 },
      }),
    ).toMatchObject({ orderSyncIntervalMinutes: 15, listingSyncIntervalMinutes: 30 });
    // 商品链接下限 5 分钟：0 / 3 都不接受，回落到系统默认。
    expect(
      readSyncSettingsOf({ sync: { orderSyncIntervalMinutes: 0, listingSyncIntervalMinutes: 3 } }),
    ).toMatchObject({ orderSyncIntervalMinutes: null, listingSyncIntervalMinutes: null });
  });

  it('按「天」填写的值也能落库（上限 30 天），超过上限视为未设置', async () => {
    expect(readSyncSettingsOf({ sync: { orderSyncIntervalMinutes: 2_880 } })).toMatchObject({
      orderSyncIntervalMinutes: 2_880,
    });
    expect(readSyncSettingsOf({ sync: { orderSyncIntervalMinutes: 43_201 } })).toMatchObject({
      orderSyncIntervalMinutes: null,
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

/**
 * 频率可按店铺设置（用户要求 2026-10-26）：店铺间隔覆盖 ENV 系统默认；
 * ENV=0 是系统级关闭，店铺值不能把它重新打开。
 */
describe('SyncSchedulerProcessor 店铺级频率', () => {
  it('店铺自定义间隔覆盖系统默认（15 分钟档之前不再重复派发）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
      const { processor, dispatch } = buildProcessor(
        { ORDER_SYNC_INTERVAL_SECONDS: '300' },
        { sync: { orderSyncEnabled: true, orderSyncIntervalMinutes: 15 } },
      );
      await processor.process({ data: {} } as never);
      expect(dispatch).toHaveBeenCalledTimes(1);

      // 系统默认是 5 分钟：若店铺值没生效，这里会再派发一次。
      vi.setSystemTime(new Date('2026-10-26T00:06:00Z'));
      await processor.process({ data: {} } as never);
      expect(dispatch).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2026-10-26T00:16:00Z'));
      await processor.process({ data: {} } as never);
      expect(dispatch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('店铺间隔低于安全下限时按系统默认（商品链接 5 分钟）', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-26T00:00:00Z'));
      const { processor, dispatch } = buildProcessor(
        { LISTING_SYNC_INTERVAL_SECONDS: '1800' },
        { sync: { listingSyncEnabled: true, listingSyncIntervalMinutes: 1 } },
      );
      await processor.process({ data: {} } as never);
      expect(dispatch).toHaveBeenCalledTimes(1);

      // 1 分钟被拒（低于 5 分钟下限）→ 回落到 ENV 的 30 分钟。
      vi.setSystemTime(new Date('2026-10-26T00:10:00Z'));
      await processor.process({ data: {} } as never);
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ENV 关闭时店铺自定义间隔也无效（系统级开关优先）', async () => {
    const { processor, dispatch } = buildProcessor(
      {},
      { sync: { orderSyncEnabled: true, orderSyncIntervalMinutes: 5 } },
    );
    await processor.process({ data: {} } as never);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

function readSyncSettingsOf(settings: Record<string, unknown> | null) {
  return readStoreSyncSettings(settings);
}
