import { Injectable } from '@nestjs/common';
import { PlatformOrderRaw } from '@wcies/platform-contracts';
import { DomainError } from '../../../common/errors/domain.error';
import { OrderIngestionService } from '../../order/services/order-ingestion.service';
import { NormalizedOrderInputDto } from '../../order/dto/order.dto';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncCursorRepository } from '../repositories/sync-cursor.repository';
import { SyncContextService } from './sync-context.service';
import { errorCodeOf, errorMessageOf } from './listing-sync.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OperatorContext } from '../../operation-log/operation-log.service';

const SYSTEM_OPERATOR: OperatorContext = { userId: null, username: 'sync-engine' };

export interface OrderSyncOutcome {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  successCount: number;
  failedCount: number;
  skippedCount: number;
  finalCursor: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Order sync execution (Sprint 5 task §21-§25).
 *
 * Strict chain: adapter.fetchOrders -> NormalizedOrderInput ->
 * OrderIngestionService. SKU mapping / reservation / backorder / exceptions
 * are ALL the ingestion service's existing logic - never re-implemented here.
 *
 * Cursor rule (task §25):
 * - business-level line outcomes (BACKORDERED / mapping FAILED) count as
 *   successfully ingested facts - the cursor advances;
 * - transport / parse / system failures fail the job; the cursor stays.
 */
@Injectable()
export class OrderSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly ingestionService: OrderIngestionService,
    private readonly jobRepo: SyncJobRepository,
    private readonly cursorRepo: SyncCursorRepository,
    private readonly logger: AppLoggerService,
  ) {}

  async execute(syncJob: SyncJobEntity): Promise<void> {
    const outcome = await this.run(syncJob);
    await this.finalize(syncJob, outcome);
  }

  /** Targeted ingest used by the webhook processor (task §45/§52). */
  async ingestPlatformOrders(
    storeId: string,
    orders: readonly PlatformOrderRaw[],
    syncSource: 'POLLING' | 'WEBHOOK',
  ): Promise<{ ingested: number; duplicates: number; failed: number }> {
    const { store } = await this.contextService.resolveSyncableStore(storeId);
    let ingested = 0;
    let duplicates = 0;
    let failed = 0;
    for (const order of orders) {
      const result = await this.ingestOne(store.id, order, syncSource);
      if (result === 'INGESTED') {
        ingested += 1;
      } else if (result === 'DUPLICATE') {
        duplicates += 1;
      } else {
        failed += 1;
      }
    }
    return { ingested, duplicates, failed };
  }

  private async run(syncJob: SyncJobEntity): Promise<OrderSyncOutcome> {
    const { store, adapter } = await this.contextService.resolveSyncableStore(syncJob.storeId);
    const context = await this.contextService.buildStoreContext(store);

    let cursor: unknown = syncJob.cursorBefore;
    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let finalCursor: Record<string, unknown> | null;

    try {
      for (;;) {
        const page = await adapter.fetchOrders(context, cursor);
        for (const order of page.items) {
          const result = await this.ingestOne(store.id, order, 'POLLING');
          if (result === 'INGESTED') {
            successCount += 1;
          } else if (result === 'DUPLICATE') {
            // Already-known order: platform fact re-delivered (task §24) -
            // a duplicate is a successful no-op, not a failure.
            skippedCount += 1;
          } else {
            failedCount += 1;
          }
        }
        cursor = page.nextCursor;
        finalCursor = (page.nextCursor as Record<string, unknown> | null) ?? null;
        if (!page.hasMore) {
          break;
        }
      }
      // Domain-level ingest failures (malformed line etc.) mark PARTIAL: the
      // platform FACT was delivered, remaining orders processed; cursor
      // advances so one bad order can never wedge the store (task §22).
      return {
        status: failedCount > 0 ? 'PARTIAL' : 'SUCCESS',
        successCount,
        failedCount,
        skippedCount,
        finalCursor,
        errorCode: failedCount > 0 ? 'ORDER_INGEST_LINE_FAILED' : null,
        errorMessage: failedCount > 0 ? `${failedCount} order(s) failed domain-level ingest` : null,
      };
    } catch (error: unknown) {
      // HTTP / parse / DB system failure: FAILED, cursor not advanced (§49).
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

  private async ingestOne(
    storeId: string,
    order: PlatformOrderRaw,
    syncSource: 'POLLING' | 'WEBHOOK',
  ): Promise<'INGESTED' | 'DUPLICATE' | 'FAILED'> {
    const input: NormalizedOrderInputDto = {
      storeId,
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus ?? undefined,
      fulfillmentMode: order.fulfillmentMode ?? undefined,
      orderedAt: order.orderedAt,
      currency: order.currency ?? undefined,
      items: order.items.map((item) => ({
        platformProductId: item.platformProductId ?? undefined,
        platformSkuId: item.platformSkuId ?? undefined,
        sellerSku: item.sellerSku ?? undefined,
        offerId: item.offerId ?? undefined,
        quantity: item.quantity,
        rawData: item.rawData,
      })),
      rawData: order.rawData,
      syncSource,
    };
    try {
      const result = await this.ingestionService.ingest(input, SYSTEM_OPERATOR);
      return result.alreadyIngested ? 'DUPLICATE' : 'INGESTED';
    } catch (error: unknown) {
      // Domain errors (bad line shape, unknown store...) are per-order
      // failures; system errors (DB down) abort the whole run.
      if (error instanceof DomainError) {
        this.logger.warn('order ingest failed for one platform order', {
          module: 'sync',
          storeId,
          platformOrderId: order.platformOrderId,
          code: error.code,
          message: error.message,
        });
        return 'FAILED';
      }
      throw error;
    }
  }

  private async finalize(syncJob: SyncJobEntity, outcome: OrderSyncOutcome): Promise<void> {
    const advanced = outcome.status === 'SUCCESS' || outcome.status === 'PARTIAL';
    await this.jobRepo.finalize(syncJob.id, {
      status: outcome.status,
      successCount: outcome.successCount,
      failedCount: outcome.failedCount,
      skippedCount: outcome.skippedCount,
      cursorAfter: advanced ? outcome.finalCursor : syncJob.cursorBefore,
      errorCode: outcome.errorCode,
      errorMessage: outcome.errorMessage,
    });
    await this.cursorRepo.upsert({
      storeId: syncJob.storeId,
      syncType: 'ORDER_SYNC',
      cursorData: advanced ? outcome.finalCursor : undefined,
      lastSuccessAt: advanced ? new Date() : undefined,
      resetFailures: advanced,
      incrementFailures: outcome.status === 'FAILED',
    });
    this.logger.info('order sync finished', {
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
