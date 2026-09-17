import { Injectable } from '@nestjs/common';
import { OzonAdapter } from '../../integration/ozon/ozon.adapter';
import { OzonProductAttributesItem } from '../../integration/ozon/types/api.types';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';
import { ListingService } from '../../listing/services/listing.service';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncContextService } from './sync-context.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { errorCodeOf, errorMessageOf } from './listing-sync.service';

/** v4 filter accepts up to 1000 product ids per call; stay conservative. */
const ENRICHMENT_BATCH = 100;
/** One run enriches at most this many products (restart for more). */
const ENRICHMENT_RUN_LIMIT = 5000;

/**
 * Sprint 8.5 T5: v4 attribute enrichment execution.
 *
 * Walks the store's variant rows that have no product_attributes payload
 * yet (idempotent), calls /v4/product/info/attributes in batches, and
 * merges each item VERBATIM into raw_data under the dedicated
 * product_attributes key - existing keys are never touched. Runs on the
 * SyncJob ledger; a partial failure keeps SUCCESS for what landed plus
 * PARTIAL/FAILED bookkeeping like the other syncs.
 */
@Injectable()
export class ProductEnrichmentSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly ozonAdapter: OzonAdapter,
    private readonly listingService: ListingService,
    private readonly jobRepo: SyncJobRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async execute(syncJob: SyncJobEntity): Promise<void> {
    try {
      const { store, adapter } = await this.contextService.resolveSyncableStore(syncJob.storeId);
      if (adapter.platformCode !== 'OZON') {
        // WB cards / Yandex offer-mappings carry characteristics natively -
        // no separate enrichment endpoint exists (plan §P4, 2026-09-18).
        throw new PlatformCapabilityUnsupportedError(
          adapter.platformCode,
          '商品属性增强同步',
          '该平台商品数据自带属性/规格，无需独立增强同步',
        );
      }
      const context = await this.contextService.buildStoreContext(store);

      const targets = await this.listingService.listEnrichmentTargets(
        syncJob.storeId,
        ENRICHMENT_RUN_LIMIT,
      );
      let successCount = 0;
      let failedCount = 0;
      for (let start = 0; start < targets.length; start += ENRICHMENT_BATCH) {
        const batch = targets.slice(start, start + ENRICHMENT_BATCH);
        const response = await this.ozonAdapter.fetchProductAttributes(context, batch);
        const items: readonly OzonProductAttributesItem[] = Array.isArray(response.result)
          ? response.result
          : [];
        const itemsByProduct = new Map<string, OzonProductAttributesItem>();
        for (const item of items) {
          itemsByProduct.set(String(item.id), item);
        }
        for (const platformProductId of batch) {
          const item = itemsByProduct.get(platformProductId);
          if (item === undefined) {
            // Missing products are counted, not fatal (AGENTS.md §49).
            failedCount += 1;
            continue;
          }
          successCount += await this.listingService.applyProductAttributes(
            syncJob.storeId,
            platformProductId,
            item,
          );
        }
      }
      const status = failedCount > 0 ? 'PARTIAL' : 'SUCCESS';
      await this.jobRepo.finalize(syncJob.id, {
        status,
        successCount,
        failedCount,
        cursorAfter: null,
      });
      this.logger.info('product enrichment finished', {
        module: 'sync',
        storeId: syncJob.storeId,
        syncJobId: syncJob.id,
        status,
        successCount,
        failedCount,
      });
    } catch (error: unknown) {
      await this.jobRepo.finalize(syncJob.id, {
        status: 'FAILED',
        errorCode: errorCodeOf(error),
        errorMessage: errorMessageOf(error),
      });
      this.logger.error(
        `product enrichment failed: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        { module: 'sync', storeId: syncJob.storeId, syncJobId: syncJob.id },
      );
    }
  }
}
