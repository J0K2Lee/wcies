import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { requestContextStorage } from '../../../common/context/request-context';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { QUEUE_NAMES } from '../../../infrastructure/queue/queue.constants';
import { SyncDispatchJobPayload } from '../services/sync-dispatch.service';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { CategoryTreeSyncService } from '../services/category-tree-sync.service';
import { ListingSyncService } from '../services/listing-sync.service';
import { OrderSyncService } from '../services/order-sync.service';
import { ProductEnrichmentSyncService } from '../services/product-enrichment-sync.service';

/**
 * Consumes ORDER_SYNC jobs (Sprint 5 task §16/§51). Processor = orchestration
 * only: claim the guarded job row, delegate to the sync service, and let the
 * service own business outcomes. No platform or order logic here.
 */
@Processor(QUEUE_NAMES.orderSync)
export class OrderSyncProcessor extends WorkerHost {
  constructor(
    private readonly jobRepo: SyncJobRepository,
    private readonly syncService: OrderSyncService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<SyncDispatchJobPayload>): Promise<string> {
    try {
      return await requestContextStorage.run(
        { requestId: `syncjob-${job.data.syncJobId}` },
        async () => {
          const claimed = await this.jobRepo.claimRunning(job.data.syncJobId);
          if (!claimed) {
            // Duplicate delivery or stale job (crashed worker) - skip safely.
            this.logger.warn('order sync job not claimable (stale/duplicate)', {
              module: 'sync',
              syncJobId: job.data.syncJobId,
            });
            return 'skipped';
          }
          const syncJob = await this.jobRepo.findById(job.data.syncJobId);
          if (syncJob === null) {
            return 'missing';
          }
          await this.syncService.execute(syncJob);
          return syncJob.id;
        },
      );
    } catch (error: unknown) {
      // A processor crash must not leave the guard row RUNNING forever:
      // mark FAILED (cursor untouched) and surface the error.
      await this.jobRepo
        .finalize(job.data.syncJobId, {
          status: 'FAILED',
          errorCode: error instanceof Error ? 'SYNC_PROCESSOR_ERROR' : 'SYNC_PROCESSOR_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
      this.logger.error(
        `order sync processor failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        {
          module: 'sync',
          syncJobId: job.data.syncJobId,
        },
      );
      throw error;
    }
  }
}

/** Consumes LISTING_SYNC jobs - same orchestration-only contract. */
@Processor(QUEUE_NAMES.listingSync)
export class ListingSyncProcessor extends WorkerHost {
  constructor(
    private readonly jobRepo: SyncJobRepository,
    private readonly syncService: ListingSyncService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<SyncDispatchJobPayload>): Promise<string> {
    try {
      return await requestContextStorage.run(
        { requestId: `syncjob-${job.data.syncJobId}` },
        async () => {
          const claimed = await this.jobRepo.claimRunning(job.data.syncJobId);
          if (!claimed) {
            this.logger.warn('listing sync job not claimable (stale/duplicate)', {
              module: 'sync',
              syncJobId: job.data.syncJobId,
            });
            return 'skipped';
          }
          const syncJob = await this.jobRepo.findById(job.data.syncJobId);
          if (syncJob === null) {
            return 'missing';
          }
          await this.syncService.execute(syncJob);
          return syncJob.id;
        },
      );
    } catch (error: unknown) {
      await this.jobRepo
        .finalize(job.data.syncJobId, {
          status: 'FAILED',
          errorCode: 'SYNC_PROCESSOR_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
      this.logger.error(
        `listing sync processor failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        {
          module: 'sync',
          syncJobId: job.data.syncJobId,
        },
      );
      throw error;
    }
  }
}

/** Consumes CATEGORY_TREE_SYNC jobs - same orchestration-only contract. */
@Processor(QUEUE_NAMES.categoryTree)
export class CategoryTreeSyncProcessor extends WorkerHost {
  constructor(
    private readonly jobRepo: SyncJobRepository,
    private readonly syncService: CategoryTreeSyncService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<SyncDispatchJobPayload>): Promise<string> {
    try {
      return await requestContextStorage.run(
        { requestId: `syncjob-${job.data.syncJobId}` },
        async () => {
          const claimed = await this.jobRepo.claimRunning(job.data.syncJobId);
          if (!claimed) {
            this.logger.warn('category tree sync job not claimable (stale/duplicate)', {
              module: 'sync',
              syncJobId: job.data.syncJobId,
            });
            return 'skipped';
          }
          const syncJob = await this.jobRepo.findById(job.data.syncJobId);
          if (syncJob === null) {
            return 'missing';
          }
          await this.syncService.execute(syncJob);
          return syncJob.id;
        },
      );
    } catch (error: unknown) {
      await this.jobRepo
        .finalize(job.data.syncJobId, {
          status: 'FAILED',
          errorCode: 'SYNC_PROCESSOR_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
      this.logger.error(
        `category tree sync processor failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', syncJobId: job.data.syncJobId },
      );
      throw error;
    }
  }
}

/** Consumes PRODUCT_ENRICHMENT_SYNC jobs - same orchestration-only contract. */
@Processor(QUEUE_NAMES.enrichment)
export class ProductEnrichmentSyncProcessor extends WorkerHost {
  constructor(
    private readonly jobRepo: SyncJobRepository,
    private readonly syncService: ProductEnrichmentSyncService,
    private readonly logger: AppLoggerService,
  ) {
    super();
  }

  async process(job: Job<SyncDispatchJobPayload>): Promise<string> {
    try {
      return await requestContextStorage.run(
        { requestId: `syncjob-${job.data.syncJobId}` },
        async () => {
          const claimed = await this.jobRepo.claimRunning(job.data.syncJobId);
          if (!claimed) {
            this.logger.warn('product enrichment job not claimable (stale/duplicate)', {
              module: 'sync',
              syncJobId: job.data.syncJobId,
            });
            return 'skipped';
          }
          const syncJob = await this.jobRepo.findById(job.data.syncJobId);
          if (syncJob === null) {
            return 'missing';
          }
          await this.syncService.execute(syncJob);
          return syncJob.id;
        },
      );
    } catch (error: unknown) {
      await this.jobRepo
        .finalize(job.data.syncJobId, {
          status: 'FAILED',
          errorCode: 'SYNC_PROCESSOR_ERROR',
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
      this.logger.error(
        `product enrichment processor failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', syncJobId: job.data.syncJobId },
      );
      throw error;
    }
  }
}
