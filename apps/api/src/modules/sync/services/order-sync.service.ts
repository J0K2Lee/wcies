import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { ListingService } from '../../listing/services/listing.service';
import { extractYandexOfferImageUrl } from '../../integration/yandex/yandex.mapper';
import { extractWbCardImageUrl } from '../../integration/wildberries/wb.mapper';
import { LabelPrefetchService } from './label-prefetch.service';
import { SystemSettingsService } from '../../system/services/system-settings.service';
import { ShipmentService } from '../../shipment/services/shipment.service';

const SYSTEM_OPERATOR: OperatorContext = { userId: null, username: 'sync-engine' };

/**
 * Cap of the per-run targeted re-read pass (Sprint 9 T1): each candidate
 * costs one /v3/posting/fbs/get call, so the oldest non-terminal orders go
 * first (they carry the most deadline pressure).
 */
const PLATFORM_REFRESH_BATCH = 100;

/**
 * Pass-3 兜底收敛每轮重试的未映射订单行上限（2026-10-20）。每行一次
 * store-scoped resolver 查询；最旧优先，积压会在后续轮次继续轮到。
 */
const STALE_MAPPING_SWEEP_BATCH = 40;

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
/**
 * 一页数据里的单条订单该怎么处理（2026-10-24）。
 *
 * - `UPDATE_ONLY`（报表型数据源，如 WB 统计流水）：只更新已存在的订单；
 *   找不到就跳过——它不在我们的作业范围（已在别处装配走/取消）。
 * - `CREATE_OR_UPDATE`：没有就建；已有且是**同一个 ID** 时走既有的
 *   比较-更新路径；已有但匹配的是**另一个标识**（同一张单的别名，例如
 *   统计单的 srid 命中装配单的 rid），只更新事实、不建第二张。
 */
export type OrderHandlingDecision = 'INGEST' | 'UPDATE_FACTS' | 'SKIP';

export function decideOrderHandling(
  order: { platformOrderId: string; ingestPolicy?: 'CREATE_OR_UPDATE' | 'UPDATE_ONLY' },
  existing: { orderId: string; matchedBy: string } | null,
): OrderHandlingDecision {
  if (order.ingestPolicy === 'UPDATE_ONLY') {
    return existing === null ? 'SKIP' : 'UPDATE_FACTS';
  }
  if (existing !== null && existing.matchedBy !== order.platformOrderId) {
    return 'UPDATE_FACTS';
  }
  return 'INGEST';
}

@Injectable()
export class OrderSyncService {
  constructor(
    private readonly contextService: SyncContextService,
    private readonly config: ConfigService,
    private readonly ingestionService: OrderIngestionService,
    private readonly orderService: OrderService,
    private readonly listingService: ListingService,
    private readonly jobRepo: SyncJobRepository,
    private readonly cursorRepo: SyncCursorRepository,
    private readonly failureAlert: SyncFailureAlertService,
    private readonly logger: AppLoggerService,
    private readonly labelPrefetch: LabelPrefetchService,
    private readonly shipmentService: ShipmentService,
    private readonly systemSettings: SystemSettingsService,
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
    options: { platformChangedAt?: Date | null } = {},
  ): Promise<{ ingested: number; duplicates: number; failed: number }> {
    const { store } = await this.contextService.resolveSyncableStore(storeId);
    let ingested = 0;
    let duplicates = 0;
    let failed = 0;
    for (const order of orders) {
      const result = await this.ingestOne(store.id, order, syncSource, options);
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

  /** Shared with the dev backfill. Failures never alter ingestion/cursor outcomes. */
  async enrichPlatformImages(
    storeId: string,
    orderId?: string,
    dryRun = false,
  ): Promise<{ candidates: number; wouldUpdate: number; updated: number; failed: boolean }> {
    let candidates = 0;
    let wouldUpdate = 0;
    try {
      const rows = await this.orderService.listMissingPlatformImages(storeId, orderId);
      candidates = rows.length;
      if (candidates === 0) return { candidates, wouldUpdate, updated: 0, failed: false };
      const { store, adapter, platformCode } =
        await this.contextService.resolveSyncableStore(storeId);
      let updates: Array<{ orderItemId: string; imageUrl: string }> = [];
      if (platformCode === 'YANDEX') {
        updates = await this.resolveYandexImages(storeId, rows);
      } else if (platformCode === 'WB') {
        // WB 没有按条码取图的平台端点（docs/integrations/wildberries.md），
        // 图片来源同样是 listing 卡片（2026-10-22）。
        updates = await this.resolveWbImages(storeId, rows);
      } else {
        const ids = [
          ...new Set(rows.flatMap((row) => (row.platformSkuId ? [row.platformSkuId] : []))),
        ];
        if (adapter.fetchProductImages === undefined || ids.length === 0) {
          this.logger.warn('platform order images unavailable', {
            module: 'sync',
            storeId,
            orderId,
            candidates,
          });
          return { candidates, wouldUpdate, updated: 0, failed: false };
        }
        const context = await this.contextService.buildStoreContext(store);
        const images = await adapter.fetchProductImages(context, ids);
        updates = rows.flatMap((row) => {
          const imageUrl = row.platformSkuId === null ? null : images.get(row.platformSkuId);
          return imageUrl ? [{ orderItemId: row.id, imageUrl }] : [];
        });
      }
      wouldUpdate = updates.length;
      if (wouldUpdate < candidates) {
        this.logger.warn('platform order images missing', {
          module: 'sync',
          storeId,
          orderId,
          missingCount: candidates - wouldUpdate,
        });
      }
      const updated =
        dryRun || updates.length === 0
          ? 0
          : await this.orderService.savePlatformImages(storeId, updates, SYSTEM_OPERATOR);
      return { candidates, wouldUpdate, updated, failed: false };
    } catch (error: unknown) {
      // Do not echo URLs, credentials, raw responses or arbitrary error messages.
      this.logger.warn('platform order image enrichment failed', {
        module: 'sync',
        storeId,
        orderId,
        code: error instanceof DomainError ? error.code : 'IMAGE_ENRICHMENT_FAILED',
      });
      return { candidates, wouldUpdate, updated: 0, failed: true };
    }
  }

  /**
   * Yandex 订单行补图（2026-09-28，ERP 建议#2）：Yandex business-orders 行内
   * 没有 marketSku（docs/integrations/yandex.md §8.3），platformSkuId 落库为
   * null，OZON 式按 platformSkuId 的 adapter 取图链路无键可用。改按
   * seller_sku（mapper 落的就是 offerId）反查本店铺已同步 Listing，从
   * offer-mappings 自带的 offer.pictures（vendored 官方规范：字符串数组，
   * 第一条为主图）提取，不发起任何平台 API 调用。同一 sellerSku 挂多条
   * 链接时（§25 允许）取最新 Listing 先到先得。
   */
  private async resolveYandexImages(
    storeId: string,
    rows: ReadonlyArray<{ id: string; sellerSku: string | null }>,
  ): Promise<Array<{ orderItemId: string; imageUrl: string }>> {
    const sellerSkus = [...new Set(rows.flatMap((row) => (row.sellerSku ? [row.sellerSku] : [])))];
    if (sellerSkus.length === 0) {
      return [];
    }
    const media = await this.listingService.findListingMediaBySellerSkus(storeId, sellerSkus);
    const imageBySellerSku = new Map<string, string>();
    for (const entry of media) {
      if (imageBySellerSku.has(entry.sellerSku)) continue;
      // 只从 offer.pictures 取图；listingUrl 是商品页地址不是图片地址。
      const imageUrl = extractYandexOfferImageUrl(entry.listingRawData);
      if (imageUrl !== null) {
        imageBySellerSku.set(entry.sellerSku, imageUrl);
      }
    }
    return rows.flatMap((row) => {
      const imageUrl = row.sellerSku === null ? undefined : imageBySellerSku.get(row.sellerSku);
      return imageUrl ? [{ orderItemId: row.id, imageUrl }] : [];
    });
  }

  /**
   * WB 订单行补图（2026-10-22）：订单行自带条码（platform_sku_id），卡片
   * `sizes[].skus[]` 会以同一批条码落成 listing 变体，所以按条码反查最稳
   * （vendorCode 会被卖家改名）。纯 DB 读取，零平台调用；同一张卡片的多条
   * 变体共享同一组 photos，先到先得。
   */
  private async resolveWbImages(
    storeId: string,
    rows: ReadonlyArray<{ id: string; platformSkuId: string | null }>,
  ): Promise<Array<{ orderItemId: string; imageUrl: string }>> {
    const skuIds = [
      ...new Set(rows.flatMap((row) => (row.platformSkuId ? [row.platformSkuId] : []))),
    ];
    if (skuIds.length === 0) {
      return [];
    }
    const media = await this.listingService.findListingMediaByPlatformSkuIds(storeId, skuIds);
    const imageBySkuId = new Map<string, string>();
    for (const entry of media) {
      if (imageBySkuId.has(entry.platformSkuId)) continue;
      const imageUrl = extractWbCardImageUrl(entry.listingRawData);
      if (imageUrl !== null) {
        imageBySkuId.set(entry.platformSkuId, imageUrl);
      }
    }
    return rows.flatMap((row) => {
      const imageUrl = row.platformSkuId === null ? undefined : imageBySkuId.get(row.platformSkuId);
      return imageUrl ? [{ orderItemId: row.id, imageUrl }] : [];
    });
  }

  /**
   * 收集本页里「已存在记录」的关联键（双源去重）。一次查询覆盖整页，
   * 无 dedupeByRawField 的行不参与。
   */
  /** 本页所有订单的候选标识（platformOrderId / raw.rid / raw.srid / 去重值）。 */
  private identifiersOf(order: PlatformOrderRaw): string[] {
    const raws = [order.rawData?.['rid'], order.rawData?.['srid']];
    const values = [
      order.platformOrderId,
      ...raws.map((value) => (typeof value === 'string' ? value : null)),
    ];
    if (order.dedupeByRawField !== undefined) {
      values.push(order.dedupeByRawField.value);
    }
    return [...new Set(values.filter((value): value is string => value !== null && value !== ''))];
  }

  /** 一次批量反查：标识 → 已有订单 id（跨数据源去重的基础）。 */
  private async collectExistingIdentifiers(
    storeId: string,
    items: readonly PlatformOrderRaw[],
  ): Promise<Map<string, string>> {
    const identifiers = new Set<string>();
    for (const item of items) {
      for (const identifier of this.identifiersOf(item)) {
        identifiers.add(identifier);
      }
    }
    if (identifiers.size === 0) {
      return new Map();
    }
    return this.orderService.findOrderIdsByPlatformIdentifiers(storeId, [...identifiers]);
  }

  /** 命中本店铺已有订单时返回匹配方式，供调用方判断「同 ID」还是「别名」。 */
  private matchExistingOrder(
    order: PlatformOrderRaw,
    existingByKey: Map<string, string>,
  ): { orderId: string; matchedBy: string } | null {
    for (const identifier of this.identifiersOf(order)) {
      const orderId = existingByKey.get(identifier);
      if (orderId !== undefined) {
        return { orderId, matchedBy: identifier };
      }
    }
    return null;
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
        // 跨数据源识别（2026-10-24）：同一张平台单可能以两个不同 ID 出现
        // （WB：装配任务的数字 id / rid 与统计行的 srid）。这里按本店铺批量反查
        // 一次，命中的行按「同一张单」处理——更新事实，绝不重复建单。
        const existingByKey = await this.collectExistingIdentifiers(store.id, page.items);
        for (const order of page.items) {
          const existing = this.matchExistingOrder(order, existingByKey);
          const decision = decideOrderHandling(order, existing);
          if (decision !== 'INGEST') {
            if (decision === 'SKIP') {
              skippedCount += 1;
              continue;
            }
            // 只更新事实：报表行不得覆盖作业单的 raw_data（数字 id 在里面）。
            const facts = await this.orderService.applySyncedPlatformFacts(
              this.toFactsInput(store.id, order, 'POLLING', { preserveRawData: true }),
              SYSTEM_OPERATOR,
            );
            if (facts.changed) {
              successCount += 1;
            } else {
              skippedCount += 1;
            }
            continue;
          }
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
      // Pass 3（2026-10-20 兜底收敛）：映射可能在订单行失败之后才建立
      // （历史遗留、Excel 导入、重新启用链接）。变体级收敛只在映射写入时
      // 触发，这里每轮对仍未映射的行做有界重试，把已可解析的行自愈。
      // 纯附加：任何失败只记日志，不改变同步结果与游标。
      await this.convergeStaleMappings(store.id);
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
    options: { platformChangedAt?: Date | null } = {},
  ): Promise<'INGESTED' | 'DUPLICATE' | 'UPDATED' | 'FAILED'> {
    const input: NormalizedOrderInputDto = {
      storeId,
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus ?? undefined,
      platformStage: order.platformStage ?? undefined,
      platformStageChangedAt: order.platformStageChangedAt ?? undefined,
      fulfillmentMode: order.fulfillmentMode ?? undefined,
      orderedAt: order.orderedAt,
      shipmentDeadline: order.shipmentDeadline ?? undefined,
      platformTrackingNo: order.platformTrackingNo ?? undefined,
      currency: order.currency ?? undefined,
      items: order.items.map((item) => ({
        platformProductId: item.platformProductId ?? undefined,
        platformSkuId: item.platformSkuId ?? undefined,
        sellerSku: item.sellerSku ?? undefined,
        offerId: item.offerId ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? undefined,
        rawData: item.rawData,
      })),
      rawData: order.rawData,
      syncSource,
    };
    try {
      const result = await this.ingestionService.ingest(input, SYSTEM_OPERATOR);
      // Best-effort after commit; both polling and webhook share this path.
      await this.enrichPlatformImages(storeId, result.orderId);
      if (result.alreadyIngested) {
        // Sprint 9 T1: a known order is compared-and-updated instead of a
        // blind skip - status/deadline/rawData facts, platform_status_history,
        // cancel propagation and deadline re-evaluation happen inside.
        const facts = await this.orderService.applySyncedPlatformFacts(
          this.toFactsInput(storeId, order, syncSource, options),
          SYSTEM_OPERATOR,
        );
        // 运单号首次出现 = 平台刚完成组包，面单此时才有（2026-10-21）。
        if (facts.trackingNumberAssigned) {
          await this.labelPrefetch.enqueueFromSync(result.orderId);
          if (facts.platformTrackingNo !== null) {
            await this.shipmentService.backfillTrackingForOrder(
              result.orderId,
              facts.platformTrackingNo,
              SYSTEM_OPERATOR,
            );
          }
        }
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

  /** Pass 3 兜底收敛：失败只记日志，绝不影响同步结果。 */
  private async convergeStaleMappings(storeId: string): Promise<void> {
    try {
      await this.ingestionService.convergeStaleMappingFailures(
        storeId,
        SYSTEM_OPERATOR,
        STALE_MAPPING_SWEEP_BATCH,
      );
    } catch (error: unknown) {
      this.logger.warn('stale mapping-repair sweep failed', {
        module: 'sync',
        storeId,
        code: errorCodeOf(error),
      });
    }
  }

  /**
   * Pass 2 (dual-axis T2): fair on-demand re-read rotation, replacing the
   * former "re-read every non-ERP-terminal order every run" sweep.
   *
   * Candidates are selected by PLATFORM stage (never erp_status - an
   * erp_status='SHIPPED' order stays observable until the platform reports
   * DELIVERED/CANCELLED, which is exactly fix A3) whose last CONFIRMED check
   * is older than ORDER_STATE_FALLBACK_HOURS. Ordering by checked-at ASC
   * NULLS FIRST rotates fairly: unchanged facts never monopolize the budget
   * (their checked-at advances with every pass) and stalled orders keep
   * being observed until they reach a platform terminal state, so stalled
   * exceptions can auto-resolve even with webhooks paused (ozon.md §6.5).
   * One posting per call; per-order failures degrade to failedCount (§36).
   */
  private async refreshPlatformFacts(
    storeId: string,
    adapter: PlatformAdapter,
    context: StoreContext,
  ): Promise<{ updated: number; unchanged: number; failed: number }> {
    if (adapter.fetchOrdersByPlatformIds === undefined) {
      return { updated: 0, unchanged: 0, failed: 0 };
    }
    // 分阶段阈值（2026-10-27，系统设置可改）：AWAITING_SHIPMENT 最勤——
    // 取消几乎都发生在"还没交给平台"的阶段，24h 一刀切会让人工等一天。
    const hours = await this.systemSettings.getOrderFallbackHours();
    const candidates = await this.orderService.listPlatformRefreshCandidates(storeId, {
      limit: PLATFORM_REFRESH_BATCH,
      hours,
    });
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
          if (facts.trackingNumberAssigned) {
            await this.labelPrefetch.enqueueFromSync(candidate.id);
            if (facts.platformTrackingNo !== null) {
              await this.shipmentService.backfillTrackingForOrder(
                candidate.id,
                facts.platformTrackingNo,
                SYSTEM_OPERATOR,
              );
            }
          }
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
    options: { platformChangedAt?: Date | null; preserveRawData?: boolean } = {},
  ): OrderPlatformFactsInput {
    return {
      storeId,
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus ?? null,
      platformCancelled: order.platformCancelled === true,
      fulfillmentMode: order.fulfillmentMode ?? null,
      platformStage: order.platformStage ?? null,
      platformStageChangedAt: order.platformStageChangedAt ?? null,
      // Webhook-only hint: the event payload's changed_state_date, used as
      // the platform-side time on the history row (docs §2.4). Null on the
      // polling path - the mapper's stage anchor applies there.
      platformChangedAt: options.platformChangedAt ?? null,
      shipmentDeadline: order.shipmentDeadline ?? null,
      platformTrackingNo: order.platformTrackingNo ?? null,
      rawData: options.preserveRawData === true ? null : (order.rawData ?? null),
      ...(options.preserveRawData === true ? { preserveRawData: true } : {}),
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
