import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { requestContextStorage } from '../../../common/context/request-context';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { SyncDispatchService } from '../services/sync-dispatch.service';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { WebhookProcessService } from '../services/webhook.service';
import { readStoreSyncSettings, WebhookJobPayload } from '../sync.constants';
import { StoreService } from '../../store/services/store.service';
import { SyncContextService } from '../services/sync-context.service';

/** Consumes webhook follow-up processing (task §28: fast HTTP, slow work here). */
@Processor(QUEUE_NAMES.webhook)
export class WebhookProcessor extends WorkerHost {
  constructor(private readonly processService: WebhookProcessService) {
    super();
  }

  async process(job: Job<WebhookJobPayload>): Promise<string> {
    return requestContextStorage.run({ requestId: `webhook:${job.data.rawEventId}` }, async () => {
      await this.processService.process(job.data.rawEventId);
      return job.data.rawEventId;
    });
  }
}

/**
 * Scheduled polling (Sprint 5 task §30/§57): a repeatable tick that
 * dispatches ORDER_SYNC / LISTING_SYNC per opted-in store.
 *
 * Rollout safety: frequencies come from ENV (never hard-coded), default
 * OFF, and a store only joins scheduled sync when its
 * `settings.sync.orderSyncEnabled / listingSyncEnabled` is true - the
 * Manual -> single store -> fleet rollout from task §57.
 */
@Processor(QUEUE_NAMES.scheduler)
export class SyncSchedulerProcessor extends WorkerHost {
  private lastOrderDispatchAt = new Map<string, number>();
  private lastListingDispatchAt = new Map<string, number>();

  constructor(
    @InjectQueue(QUEUE_NAMES.scheduler) private readonly schedulerQueue: Queue,
    private readonly config: ConfigService,
    private readonly dispatchService: SyncDispatchService,
    private readonly contextService: SyncContextService,
    private readonly jobRepo: SyncJobRepository,
    private readonly storeService: StoreService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<Record<string, never>>): Promise<string> {
    return requestContextStorage.run({ requestId: `scheduler:${job.id ?? 'tick'}` }, async () => {
      // Crash recovery: a worker restart leaves RUNNING jobs orphaned; fail
      // them so single-flight re-opens (cursor never advanced, re-run safe).
      await this.jobRepo.failStaleRunning(10);
      // 同一件事的另一半（2026-10-24）：进程在「写 sync_jobs」与「入队」之间
      // 退出会留下 PENDING 墓碑，把该 store+type 永久锁死（实证 11 个店铺卡 5h）。
      // PENDING 正常几秒内就会被 claim，10 分钟还没动必然是丢了队列任务。
      const stalePending = await this.jobRepo.failStalePending(10);
      if (stalePending > 0) {
        this.logger.warn('recovered stale PENDING sync jobs', {
          module: 'sync',
          count: stalePending,
        });
      }

      const orderIntervalMs = this.intervalMs('ORDER_SYNC_INTERVAL_SECONDS', 0, 60);
      const listingIntervalMs = this.intervalMs('LISTING_SYNC_INTERVAL_SECONDS', 0, 300);
      if (orderIntervalMs === 0 && listingIntervalMs === 0) {
        return 'ticked';
      }

      const stores = await this.storeService.listAllActive();
      for (const store of stores) {
        const settings = readStoreSyncSettings(store.settings);
        try {
          // Fail fast on unsyncable stores (credential etc.).
          await this.contextService.resolveSyncableStore(store.id);
        } catch {
          continue; // Store A's problem never blocks Store B (task §14/§44).
        }
        if (orderIntervalMs > 0 && settings.orderSyncEnabled === true) {
          await this.dispatchIfDue(
            store.id,
            'ORDER_SYNC',
            orderIntervalMs,
            this.lastOrderDispatchAt,
          );
        }
        if (listingIntervalMs > 0 && settings.listingSyncEnabled === true) {
          await this.dispatchIfDue(
            store.id,
            'LISTING_SYNC',
            listingIntervalMs,
            this.lastListingDispatchAt,
          );
        }
      }
      return 'ticked';
    });
  }

  private async dispatchIfDue(
    storeId: string,
    syncType: 'ORDER_SYNC' | 'LISTING_SYNC',
    intervalMs: number,
    lastDispatchAt: Map<string, number>,
  ): Promise<void> {
    const last = lastDispatchAt.get(storeId) ?? 0;
    if (Date.now() - last < intervalMs) {
      return;
    }
    try {
      await this.dispatchService.dispatch({ storeId, syncType, trigger: 'SCHEDULED' });
      lastDispatchAt.set(storeId, Date.now());
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String(error.code)
          : 'UNKNOWN';
      if (code !== 'SYNC_ALREADY_RUNNING') {
        this.logger.warn('scheduled dispatch failed', {
          module: 'sync',
          storeId,
          syncType,
          code,
        });
      }
    }
  }

  private intervalMs(key: string, fallbackSeconds: number, minSeconds: number): number {
    const raw = this.config.get<string>(key);
    if (raw === undefined || raw === '') {
      return fallbackSeconds * 1000;
    }
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) {
      return fallbackSeconds * 1000;
    }
    // Frequencies below the documented-safe floor are clamped, never honored.
    return Math.max(seconds, minSeconds) * 1000;
  }
}
