import { Injectable } from '@nestjs/common';
import { OzonCategoryTreeService } from '../../integration/ozon/ozon-category-tree.service';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncContextService } from './sync-context.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { errorCodeOf, errorMessageOf } from './listing-sync.service';

/**
 * Sprint 8.5 T3a: manual category-tree sync execution.
 *
 * Store-credential-scoped but platform-level data: the OZON tree itself is
 * global, so the cached node set is keyed by the store's PLATFORM (any OZON
 * store's credentials refresh the same rows). Recorded on the SyncJob ledger
 * like every sync (AGENTS.md §43/§44); no cursor - a run is one full pull.
 *
 * OZON-only by design (2026-09-18): Yandex's tree endpoint carries a
 * deprecation notice and offers carry their own category (first release
 * skips the full tree); WB's tree assembly is low priority (plan §P4).
 */
@Injectable()
export class CategoryTreeSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly treeService: OzonCategoryTreeService,
    private readonly jobRepo: SyncJobRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async execute(syncJob: SyncJobEntity): Promise<void> {
    try {
      const { store, adapter } = await this.contextService.resolveSyncableStore(syncJob.storeId);
      if (adapter.platformCode !== 'OZON') {
        throw new PlatformCapabilityUnsupportedError(
          adapter.platformCode,
          '类目树同步',
          '首发范围仅 OZON（Yandex 类目接口有弃用倾向、商品自带类目；WB 构树低优先级）',
        );
      }
      const context = await this.contextService.buildStoreContext(store);
      const result = await this.treeService.syncTree(context, store.platformId);
      await this.jobRepo.finalize(syncJob.id, {
        status: 'SUCCESS',
        successCount: result.totalNodes,
        cursorAfter: null,
      });
      this.logger.info('category tree sync finished', {
        module: 'sync',
        storeId: syncJob.storeId,
        syncJobId: syncJob.id,
        totalNodes: result.totalNodes,
      });
    } catch (error: unknown) {
      await this.jobRepo.finalize(syncJob.id, {
        status: 'FAILED',
        errorCode: errorCodeOf(error),
        errorMessage: errorMessageOf(error),
      });
      this.logger.error(
        `category tree sync failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', storeId: syncJob.storeId, syncJobId: syncJob.id },
      );
    }
  }
}
