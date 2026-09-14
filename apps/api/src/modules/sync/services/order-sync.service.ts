import { Injectable } from '@nestjs/common';
import { PlatformAdapter, PlatformOrderRaw, StoreContext } from '@wcies/platform-contracts';
import { DomainError } from '../../../common/errors/domain.error';
import { OrderIngestionService } from '../../order/services/order-ingestion.service';
import { OrderPlatformFactsInput, OrderService } from '../../order/services/order.service';
import { NormalizedOrderInputDto } from '../../order/dto/order.dto';
import { SyncJobEntity } from '../entities/sync-job.entity';
import { SyncJobRepository } from '../repositories/sync-job.repository';
import { SyncCursorRepository } from '../repositories/sync-cursor.repository';
import { SyncContextService } from './sync-context.service';
import { errorCodeOf, errorMessageOf } from './listing-sync.service';
import { SyncFailureAlertService } from './sync-failure-alert.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OperatorContext } from '../../operation-log/operation-log.service';

const SYSTEM_OPERATOR: OperatorContext = { userId: null, username: 'sync-engine' };

/**
 * Cap of the per-run targeted re-read pass (Sprint 9 T1): each candidate
 * costs one /v3/posting/fbs/get call, so the oldest non-terminal orders go
 * first (they carry the most deadline pressure).
 */
const PLATFORM_REFRESH_BATCH = 100;

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
 * Order sync execution (Sprint 5 task §21-§25; Sprint 9 T1 adds platform
 * fact maintenance for already-ingested orders).
 *
 * Strict chain: adapter.fetchOrders -> NormalizedOrderInput ->
 * OrderIngestionService. SKU mapping / reservation / backorder / exceptions
 * are ALL the ingestion service's existing logic - never re-implemented here.
 *
 * Cursor rule (task §25):
 * - business-level line outcomes (BACKORDERED / mapping FAILED) count as
 *   successfully ingested facts - the cursor advances;
 * - transport / parse / system failures fail the job; the cursor stays.
 *
 * Sprint 9 T1 - two passes per run:
 * 1. window pass: new orders by in_process_at window (existing behavior);
 *    a re-delivered known order is compared-and-updated instead of skipped.
 * 2. refresh pass: the window cursor NEVER revisits old orders, so
 *    non-terminal orders are re-read by posting number through the adapter's
 *    targeted-re-read capability (same verified endpoint the webhook hint
 *    path uses) - that is how platform cancellations and deadline changes
 *    become visible (planning §1.3).
 */
@Injectable()
export class OrderSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly ingestionService: OrderIngestionService,
    private readonly orderService: OrderService,
    private readonly jobRepo: SyncJobRepository,
    private readonly cursorRepo: SyncCursorRepository,
    private readonly failureAlert: SyncFailureAlertService,
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
      if (result === 'INGESTED' || result === 'UPDATED') {
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
          } else if (result === 'UPDATED') {
            // Known order whose platform facts moved (Sprint 9 T1).
            successCount += 1;
          } else if (result === 'DUPLICATE') {
            // Already-known order, nothing changed: successful no-op.
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
      // Pass 2 (Sprint 9 T1): the window never revisits old orders, so
      // re-read the store's non-terminal orders by posting number to observe
      // platform cancellations / status / deadline changes. Facts-only; the
      // cursor outcome above is unaffected.
      const refreshed = await this.refreshPlatformFacts(store.id, adapter, context);
      successCount += refreshed.updated;
      skippedCount += refreshed.unchanged;
      failedCount += refreshed.failed;
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
  ): Promise<'INGESTED' | 'DUPLICATE' | 'UPDATED' | 'FAILED'> {
    const input: NormalizedOrderInputDto = {
      storeId,
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus ?? undefined,
      fulfillmentMode: order.fulfillmentMode ?? undefined,
      orderedAt: order.orderedAt,
      shipmentDeadline: order.shipmentDeadline ?? undefined,
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
      if (result.alreadyIngested) {
        // Sprint 9 T1: a known order is compared-and-updated instead of a
        // blind skip - status/deadline/rawData facts, platform_status_history,
        // cancel propagation and deadline re-evaluation happen inside.
        const facts = await this.orderService.applySyncedPlatformFacts(
          this.toFactsInput(storeId, order, syncSource),
          SYSTEM_OPERATOR,
        );
        return facts.changed ? 'UPDATED' : 'DUPLICATE';
      }
      if (order.platformCancelled === true) {
        // Created-and-cancelled between two polls: the fresh order went
        // through the normal reserve pipeline, so cancel it right away
        // through the existing chain.
        await this.orderService.cancel(
          result.orderId,
          SYSTEM_OPERATOR,
          `平台状态更新为 cancelled，自动取消（平台单号 ${order.platformOrderId}）`,
        );
      }
      return 'INGESTED';
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

  /**
   * Pass 2 (Sprint 9 T1): targeted re-read of non-terminal orders. One
   * posting per call through the adapter's verified re-read capability;
   * per-order failures degrade to failedCount, never aborting the run
   * (§36).
   */
  private async refreshPlatformFacts(
    storeId: string,
    adapter: PlatformAdapter,
    context: StoreContext,
  ): Promise<{ updated: number; unchanged: number; failed: number }> {
    if (adapter.fetchOrdersByPlatformIds === undefined) {
      return { updated: 0, unchanged: 0, failed: 0 };
    }
    const candidates = await this.orderService.listPlatformRefreshCandidates(
      storeId,
      PLATFORM_REFRESH_BATCH,
    );
    let updated = 0;
    let unchanged = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        const pages = await adapter.fetchOrdersByPlatformIds(context, [candidate.platformOrderId]);
        for (const raw of pages) {
          const facts = await this.orderService.applySyncedPlatformFacts(
            this.toFactsInput(storeId, raw, 'POLLING'),
            SYSTEM_OPERATOR,
          );
          if (facts.changed) {
            updated += 1;
          } else {
            unchanged += 1;
          }
        }
      } catch (error: unknown) {
        if (error instanceof DomainError) {
          this.logger.warn('platform fact refresh failed for one order', {
            module: 'sync',
            storeId,
            platformOrderId: candidate.platformOrderId,
            code: error.code,
            message: error.message,
          });
          failed += 1;
          continue;
        }
        throw error;
      }
    }
    return { updated, unchanged, failed };
  }

  private toFactsInput(
    storeId: string,
    order: PlatformOrderRaw,
    source: 'POLLING' | 'WEBHOOK',
  ): OrderPlatformFactsInput {
    return {
      storeId,
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus ?? null,
      platformCancelled: order.platformCancelled === true,
      shipmentDeadline: order.shipmentDeadline ?? null,
      rawData: order.rawData ?? null,
      source,
    };
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
    // Sprint 9 T2: turn consecutive failures into a deduped SYNC_FAILED
    // exception (and auto-resolve it once the store syncs again).
    await this.failureAlert.onFinalized(syncJob.storeId);
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
