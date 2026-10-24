import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { SyncTriggerType, SyncType } from '../sync.constants';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncCursorRepository } from '../repositories/sync-cursor.repository';
import { SyncContextService } from './sync-context.service';
import { SyncAlreadyRunningError } from '../errors/sync-errors';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

export interface SyncDispatchJobPayload {
  readonly syncJobId: string;
}

/**
 * Sync dispatch (Sprint 5 task §15/§31): creates the guarded SyncJob row
 * FIRST (DB single flight), then enqueues the BullMQ job (second guard).
 * HTTP callers get 202 immediately - never a blocking platform call.
 */
@Injectable()
export class SyncDispatchService {
  constructor(
    @InjectQueue(QUEUE_NAMES.orderSync)
    private readonly orderSyncQueue: Queue<SyncDispatchJobPayload>,
    @InjectQueue(QUEUE_NAMES.listingSync)
    private readonly listingSyncQueue: Queue<SyncDispatchJobPayload>,
    @InjectQueue(QUEUE_NAMES.categoryTree)
    private readonly categoryTreeQueue: Queue<SyncDispatchJobPayload>,
    @InjectQueue(QUEUE_NAMES.enrichment)
    private readonly enrichmentQueue: Queue<SyncDispatchJobPayload>,
    private readonly jobRepo: SyncJobRepository,
    private readonly cursorRepo: SyncCursorRepository,
    private readonly contextService: SyncContextService,
    private readonly logger: AppLoggerService,
  ) {}

  async dispatch(input: {
    storeId: string;
    syncType: SyncType;
    trigger: SyncTriggerType;
  }): Promise<SyncJobEntity> {
    // Fail fast on unsyncable stores (missing credential etc.) BEFORE
    // creating any job row - Store A's failure never touches Store B.
    const { store } = await this.contextService.resolveSyncableStore(input.storeId);
    const cursorBefore = await this.cursorRepo.cursorData(input.storeId, input.syncType);

    const job = await this.jobRepo.insertPending({
      storeId: input.storeId,
      syncType: input.syncType,
      triggerType: input.trigger,
      cursorBefore,
    });
    if (job === null) {
      const active = await this.jobRepo.findActiveByStoreAndType(input.storeId, input.syncType);
      throw new SyncAlreadyRunningError(input.storeId, input.syncType, active?.id ?? null);
    }

    const queueByType: Record<SyncType, Queue<SyncDispatchJobPayload>> = {
      ORDER_SYNC: this.orderSyncQueue,
      LISTING_SYNC: this.listingSyncQueue,
      CATEGORY_TREE_SYNC: this.categoryTreeQueue,
      PRODUCT_ENRICHMENT_SYNC: this.enrichmentQueue,
    };
    try {
      await queueByType[input.syncType].add(
        'run',
        { syncJobId: job.id },
        {
          // One attempt: retries are NEW dispatches (cursor never advanced, so
          // a re-run is lossless); BullMQ-level retries would find the job
          // already claimed and skip anyway.
          attempts: 1,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 24 * 3600 },
          jobId: `syncjob-${job.id}`,
        },
      );
    } catch (error: unknown) {
      // 入队失败必须立刻把 PENDING 行收口（2026-10-24）：否则这条行会变成
      // 单飞墓碑，该 store+type 之后再也派发不出去（实证 11 个店铺卡 5h）。
      await this.jobRepo
        .finalize(job.id, {
          status: 'FAILED',
          errorCode: 'SYNC_DISPATCH_FAILED',
          errorMessage:
            error instanceof Error ? error.message.slice(0, 400) : 'failed to enqueue sync job',
        })
        .catch(() => undefined);
      throw error;
    }

    this.logger.info('sync job dispatched', {
      module: 'sync',
      storeId: store.id,
      syncType: input.syncType,
      trigger: input.trigger,
      syncJobId: job.id,
    });
    return job;
  }
}
