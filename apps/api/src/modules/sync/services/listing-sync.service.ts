import { Injectable } from '@nestjs/common';
import { PlatformListingRaw } from '@wcies/platform-contracts';
import { ListingService } from '../../listing/services/listing.service';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncCursorRepository } from '../repositories/sync-cursor.repository';
import { SyncContextService } from './sync-context.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';

export interface ListingSyncOutcome {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  successCount: number;
  failedCount: number;
  skippedCount: number;
  finalCursor: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Listing sync execution (Sprint 5 task §17-§20).
 *
 * Walks adapter pages; every listing is applied through the Listing module's
 * upsert (raw data preserved, human mappings untouchable). The cursor only
 * advances (persisted) when the run finishes SUCCESS/PARTIAL (task §25).
 */
@Injectable()
export class ListingSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly listingService: ListingService,
    private readonly jobRepo: SyncJobRepository,
    private readonly cursorRepo: SyncCursorRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async execute(syncJob: SyncJobEntity): Promise<void> {
    const outcome = await this.run(syncJob);
    await this.finalize(syncJob, outcome);
  }

  private async run(syncJob: SyncJobEntity): Promise<ListingSyncOutcome> {
    const { store, adapter } = await this.contextService.resolveSyncableStore(syncJob.storeId);
    const context = await this.contextService.buildStoreContext(store);

    let cursor: unknown = syncJob.cursorBefore;
    let successCount = 0;
    const failedCount = 0;
    let skippedCount = 0;
    let finalCursor: Record<string, unknown> | null;

    try {
      for (;;) {
        const page = await adapter.fetchListings(context, cursor);
        for (const listing of page.items) {
          const result = await this.applyOne(store.id, listing);
          if (result === 'SKIPPED') {
            skippedCount += 1;
          } else {
            successCount += 1;
          }
        }
        cursor = page.nextCursor;
        finalCursor = (page.nextCursor as Record<string, unknown> | null) ?? null;
        if (!page.hasMore) {
          // Full enumeration completed: next run restarts from the beginning
          // (a listing sync is always a full authoritative walk).
          finalCursor = null;
          break;
        }
      }
      return {
        status: failedCount > 0 ? 'PARTIAL' : 'SUCCESS',
        successCount,
        failedCount,
        skippedCount,
        finalCursor,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error: unknown) {
      // Transport/parse/system failure: job FAILED, cursor stays where it
      // was (task §49) - the next run re-walks from cursorBefore.
      return {
        status: 'FAILED',
        successCount,
        failedCount,
        skippedCount,
        finalCursor: null,
        errorCode: errorCodeOf(error),
        errorMessage: errorMessageOf(error),
      };
    }
  }

  private async applyOne(
    storeId: string,
    listing: PlatformListingRaw,
  ): Promise<'APPLIED' | 'SKIPPED'> {
    await this.listingService.applyPlatformListing({
      storeId,
      platformProductId: listing.platformProductId,
      title: listing.title,
      url: listing.url,
      platformStatus: listing.platformStatus,
      skus: listing.skus.map((sku) => ({
        platformSkuId: sku.platformSkuId,
        offerId: sku.offerId,
        sellerSku: sku.sellerSku,
        rawData: sku.rawData,
      })),
      rawData: listing.rawData,
    });
    return 'APPLIED';
  }

  private async finalize(syncJob: SyncJobEntity, outcome: ListingSyncOutcome): Promise<void> {
    const advanced = outcome.status === 'SUCCESS' || outcome.status === 'PARTIAL';
    await this.jobRepo.finalize(syncJob.id, {
      status: outcome.status,
      successCount: outcome.successCount,
      failedCount: outcome.failedCount,
      skippedCount: outcome.skippedCount,
      // FAILED keeps cursorAfter = cursorBefore so the dashboard shows why
      // the cursor did not advance.
      cursorAfter: advanced ? outcome.finalCursor : syncJob.cursorBefore,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    });
    await this.cursorRepo.upsert({
      storeId: syncJob.storeId,
      syncType: 'LISTING_SYNC',
      cursorData: advanced ? outcome.finalCursor : undefined,
      lastSuccessAt: advanced ? new Date() : undefined,
      resetFailures: advanced,
      incrementFailures: outcome.status === 'FAILED',
    });
    this.logger.info('listing sync finished', {
      module: 'sync',
      storeId: syncJob.storeId,
      syncJobId: syncJob.id,
      status: outcome.status,
      successCount: outcome.successCount,
      skippedCount: outcome.skippedCount,
      cursorAdvanced: advanced,
    });
  }
}

export function errorCodeOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code);
  }
  return 'SYNC_INTERNAL_ERROR';
}

export function errorMessageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Never persist anything that looks like a credential.
  return redact(message);
}

const SECRET_HINT = /(api[-_]?key|authorization|client[-_]?secret|bearer)/i;
function redact(message: string): string {
  if (SECRET_HINT.test(message)) {
    return 'error message redacted (possible secret content)';
  }
  return message.slice(0, 2000);
}
