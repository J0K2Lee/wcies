import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PlatformAdapter,
  PlatformLabelFile,
  PlatformOrderLabelFile,
  PlatformOrderRaw,
  PlatformShipmentPreparation,
  StoreContext,
} from '@wcies/platform-contracts';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OrderService } from '../../order/services/order.service';
import { isOrderLabelPrintBlocked } from '../../order/services/order-status.service';
import { OrderListSortField } from '../../order/enums/order.constants';
import { ExceptionService } from '../../exception/services/exception.service';
import { ShipmentService } from '../../shipment/services/shipment.service';
import { ShippingLabelService } from '../../shipment/services/shipping-label.service';
import { mergePdfs } from '../../../common/pdf/document';
import { ShippingLabelDto } from '../../shipment/dto/shipment.dto';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';
import { PlatformApiError, PlatformBatchShapeError } from '../../integration/platform-error';
import { DomainError } from '../../../common/errors/domain.error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { LabelPrefetchService } from './label-prefetch.service';
import { SyncContextService } from './sync-context.service';
import { OrderCancelledOnPlatformError } from '../errors/sync-errors';

/** Outcome of the platform 组包 step, as reported back to the order page. */
export interface PrepareShipmentResult {
  orderId: string;
  orderNo: string;
  platformCode: string;
  /** Platform waybill number after preparation (null when not exposed yet). */
  trackingNumber: string | null;
  /** Platform status after preparation, verbatim platform vocabulary. */
  platformStatus: string | null;
  /** True when the platform had already accepted the order (no write made). */
  alreadyPrepared: boolean;
  /**
   * True when the platform ACCEPTED the assembly but has not confirmed it
   * yet (OZON processes 组包 asynchronously) - a success outcome; the
   * waybill simply is not readable yet and a later call converges.
   */
  assemblyPending: boolean;
  /** True when this call actually performed the platform write. */
  platformWritePerformed: boolean;
  /**
   * 平台「组包后即有面单」能力（WB / Yandex）。批量路径据此决定是否入队预取，
   * 不再回头查适配器（2026-10-22）。
   */
  labelReadyAfterPrepare: boolean;
}

/** One order's outcome inside a batch 获取运单号 (订单页多选, 2026-10-13). */
export interface BatchPrepareShipmentItem {
  orderId: string;
  orderNo: string | null;
  ok: boolean;
  code: string | null;
  message: string | null;
  trackingNumber: string | null;
  platformStatus: string | null;
  alreadyPrepared: boolean;
  assemblyPending: boolean;
}

export interface BatchPrepareShipmentResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchPrepareShipmentItem[];
}

/** One order's outcome inside a batch 打单 (批量打印面单, 2026-10-17). */
export interface BatchShippingLabelItem {
  orderId: string;
  orderNo: string | null;
  ok: boolean;
  code: string | null;
  message: string | null;
  signedUrl: string | null;
  fileName: string | null;
  /** true = 直接用本地存档，本次没有调用平台（2026-10-21）。 */
  fromArchive: boolean;
}

export interface BatchShippingLabelResult {
  total: number;
  succeeded: number;
  failed: number;
  /** 因订单已终态（完成/取消）被拒绝的单数（2026-10-21）。 */
  notPrintable: number;
  /** 成功面单合并成的单个 PDF（base64）；合并失败或全部失败时为 null。 */
  mergedPdfBase64: string | null;
  /** 合并 PDF 的总页数（每张面单通常 1 页）。 */
  mergedPageCount: number;
  results: BatchShippingLabelItem[];
}

/** The order facts this service needs; structurally satisfied by OrderEntity. */
interface OrderForLabel {
  id: string;
  orderNo: string;
  storeId: string;
  platformOrderId: string;
  platformTrackingNo: string | null;
  erpStatus: string;
  platformStage: string | null;
}

/** One order awaiting a platform label, keyed by the caller's order id. */
interface LabelFetchNeed {
  /**
   * 入参里的订单 id（与实体 id 相同）。用它作为结果键，保证返回顺序与入参
   * 完全一致，也避免把实体字段当作身份来源。
   */
  orderId: string;
  order: OrderForLabel;
}

/**
 * Order fulfillment platform operations (2026-09-18 flow): the platform-facing
 * half of 「获取运单号」 and 「打单」.
 *
 * Lives in the sync layer, next to PlatformWarehouseQueryService and for the
 * same reason: it needs store credentials (SyncContextService) and dispatches
 * to a platform implementation, while the order/shipment core stays ignorant
 * of which HTTP API a platform speaks (AGENTS.md §31/§33, arch Rule 5).
 *
 * SECURITY: `prepareShipment` performs a REAL platform state change. It is
 * only reachable through an explicit operator action, and the credential never
 * leaves this layer (AGENTS.md §29/§92).
 */
@Injectable()
export class OrderPlatformShipService {
  constructor(
    private readonly syncContext: SyncContextService,
    private readonly orderService: OrderService,
    private readonly exceptionService: ExceptionService,
    private readonly labelService: ShippingLabelService,
    private readonly shipmentService: ShipmentService,
    private readonly operationLog: OperationLogService,
    private readonly logger: AppLoggerService,
    private readonly config: ConfigService,
    private readonly labelPrefetch: LabelPrefetchService,
  ) {}

  /**
   * 获取运单号: asks the platform to accept the order for dispatch (OZON 组包)
   * and stores the resulting facts. Idempotent - an order the platform already
   * accepted produces NO platform write and just refreshes the local facts.
   */
  async prepareShipment(
    orderId: string,
    operator: OperatorContext,
    options: { enqueuePrefetch?: boolean } = {},
  ): Promise<PrepareShipmentResult> {
    const order = await this.orderService.getOrderOrThrow(orderId);
    const { adapter, context } = await this.resolveStore(order.storeId);

    const prepare = requireCapability(adapter, 'prepareShipment', '平台组包/获取运单号');
    let result: PlatformShipmentPreparation;
    try {
      result = await prepare(context, { platformOrderId: order.platformOrderId });
    } catch (error: unknown) {
      // 2026-10-27（平台已取消但 ERP 不知道）：组包失败最常见的原因之一就是
      // 平台已经取消了这张单。既然失败已经发生，顺手做一次定向回读——读到
      // 取消就**落库并走取消链**（释放占用 / 生成拦截 / 发通知），而不是只回
      // 一个 409 把事实丢掉（ORD00000746 实证）。
      const cancelled = await this.persistCancellationIfAny(order, operator, 'prepare');
      if (cancelled) {
        // 已取消的订单不再记 OPEN 失败异常（取消链自己会关闭相关异常），
        // 只把「平台已取消」这个事实性 409 返回给操作员。
        throw new OrderCancelledOnPlatformError(order.orderNo);
      }
      await this.reportPrepareFailure(order, error);
      throw error;
    }
    // A previous failure may have left an OPEN alert behind.
    await this.exceptionService.resolveByReference({
      exceptionType: 'ORDER_PLATFORM_SHIP_FAILED',
      referenceType: 'ORDER',
      referenceId: order.id,
    });

    // Persist the resulting platform facts through OrderService's public API.
    // A targeted RE-READ is preferred over the preparation result: it goes
    // through the platform mapper, so status, normalized stage, deadline,
    // waybill and raw_data are all refreshed by the single component that owns
    // the platform vocabulary (AGENTS.md §31/§33). OrderService alone owns
    // orders.erp_status - nothing here touches it (AGENTS.md §38).
    const fresh = await this.reReadOrder(adapter, context, order.platformOrderId);
    const facts = await this.orderService.applySyncedPlatformFacts(
      {
        storeId: order.storeId,
        platformOrderId: order.platformOrderId,
        platformStatus: fresh?.platformStatus ?? result.platformStatus,
        platformCancelled: fresh?.platformCancelled ?? false,
        platformStage: fresh?.platformStage ?? null,
        platformStageChangedAt: fresh?.platformStageChangedAt ?? null,
        shipmentDeadline: fresh?.shipmentDeadline ?? order.shipmentDeadline,
        platformTrackingNo: fresh?.platformTrackingNo ?? result.trackingNumber,
        rawData: fresh?.rawData ?? null,
        source: 'MANUAL',
      },
      operator,
    );
    // 运单号一旦可读，已建的发货单（快照）需要补齐（2026-10-21）。
    if (facts.platformTrackingNo !== null) {
      await this.shipmentService.backfillTrackingForOrder(
        order.id,
        facts.platformTrackingNo,
        operator,
      );
    }

    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: result.alreadyPrepared
        ? 'PLATFORM_SHIP_ALREADY_PREPARED'
        : result.assemblyPending === true
          ? 'PLATFORM_SHIP_SUBMITTED'
          : 'PLATFORM_SHIP_PREPARE',
      changes: {
        platformStatus: { from: order.platformStatus, to: result.platformStatus },
        trackingNumber: { from: order.platformTrackingNo, to: result.trackingNumber },
      },
      operator,
    });

    const prepared: PrepareShipmentResult = {
      orderId: order.id,
      orderNo: order.orderNo,
      platformCode: adapter.platformCode,
      trackingNumber: result.trackingNumber,
      platformStatus: result.platformStatus,
      alreadyPrepared: result.alreadyPrepared,
      assemblyPending: result.assemblyPending === true,
      platformWritePerformed: !result.alreadyPrepared && result.assemblyPending !== true,
      labelReadyAfterPrepare: adapter.labelReadyAfterPrepare === true,
    };
    if (options.enqueuePrefetch !== false) {
      await this.scheduleLabelPrefetch(order, prepared, prepared.labelReadyAfterPrepare);
    }
    return prepared;
  }

  /**
   * 组包成功后预取面单（用户指示 2026-10-21，A 方案）。
   *
   * 组包是面单的**唯一**可用前置：OZON 只在 posting 进入 awaiting_deliver
   * 后提供面单，且文档建议组包后 45–60 秒再取。因此这里只入队一个延迟任务，
   * 绝不等待平台——组包接口的响应时间不受影响；任务未就绪时按退避重试。
   *
   * 不满足「已有运单号 / 异步组包中」的订单不入队：连运单号都没有时平台
   * 必然没有面单，入队只会制造无意义的平台调用（用户明确要求减少访问）。
   */
  private async scheduleLabelPrefetch(
    order: OrderForLabel,
    result: PrepareShipmentResult,
    labelReadyAfterPrepare: boolean,
  ): Promise<void> {
    // WB / Yandex 一入供应单 / READY_TO_SHIP 就有面单，跟运单号无关；OZON 要等
    // posting 进入 awaiting_deliver（运单号出现或组包异步确认）才有（2026-10-22）。
    const needsLabel =
      result.assemblyPending === true || result.trackingNumber !== null || labelReadyAfterPrepare;
    if (!needsLabel) {
      return;
    }
    // 已组包过（本次没有平台写）说明面单可能早就绪，立即预取。
    const delayMs = result.alreadyPrepared ? 0 : this.labelPrefetch.delayMs();
    await this.labelPrefetch.enqueueForOrder(order.id, { delayMs });
  }

  /**
   * 批量获取运单号（订单页多选, 2026-10-13）：逐单复用 prepareShipment 的全部
   * 平台/幂等/事实回写逻辑，单笔失败（含平台报错）只记录结果，不拖垮整批
   * （AGENTS §43/§49）。仍是真实平台写操作，只能由操作员显式触发（§92）。
   */
  async prepareShipmentBatch(
    orderIds: string[],
    operator: OperatorContext,
  ): Promise<BatchPrepareShipmentResult> {
    const results: BatchPrepareShipmentItem[] = [];
    // 批量路径不逐单预取：50 单组包会变成 50 次平台面单调用，批量取单（B）
    // 才能把它们压成每 20 单一次。这里只收集，循环结束后按块入队。
    const prefetchOrderIds: string[] = [];
    for (const orderId of new Set(orderIds)) {
      try {
        const result = await this.prepareShipment(orderId, operator, { enqueuePrefetch: false });
        results.push({
          orderId,
          orderNo: result.orderNo,
          ok: true,
          code: null,
          message: null,
          trackingNumber: result.trackingNumber,
          platformStatus: result.platformStatus,
          alreadyPrepared: result.alreadyPrepared,
          assemblyPending: result.assemblyPending,
        });
        if (
          result.assemblyPending === true ||
          result.trackingNumber !== null ||
          result.labelReadyAfterPrepare
        ) {
          prefetchOrderIds.push(orderId);
        }
      } catch (error: unknown) {
        results.push(this.batchFailureOf(orderId, error));
      }
    }
    await this.labelPrefetch.enqueueBatch(prefetchOrderIds, {
      delayMs: this.labelPrefetch.delayMs(),
    });
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  /**
   * 批量打单（用户指示 2026-10-17；2026-10-21 起改为「批量取单」）：
   *
   * - 默认复用本地已存档面单，只有缺面单的订单才访问平台；
   * - 缺面单的订单按店铺分组、每 ≤20 单一次平台调用（OZON 上限），
   *   返回形状不可用时逐单降级；
   * - 终态订单（完成/取消）不再取单，逐单返回 ORDER_LABEL_NOT_PRINTABLE；
   * - 单笔失败不影响其余（AGENTS §36）。
   *
   * 成功面单在服务端**合并成一个 PDF**（`mergedPdfBase64`）：平台面单自带纸张
   * 尺寸，只有交给浏览器原生 PDF 查看器打印才能保持原尺寸。
   * 每单的 `signedUrl` 仍随结果返回，供单张补打/排查。
   */
  async fetchShippingLabelBatch(
    orderIds: string[],
    options: {
      refresh: boolean;
      /** 订单列表当前排序（决定 PDF 装订顺序，与列表一致）。 */
      sortBy?: OrderListSortField;
      sortOrder?: 'asc' | 'desc';
    },
    operator: OperatorContext,
  ): Promise<BatchShippingLabelResult> {
    // 打印顺序 = 列表当前排序（2026-10-19 用户要求）。查不到的 id 追加在末尾，
    // 仍走逐笔失败路径。
    const unique = [...new Set(orderIds)];
    const ordered = await this.orderService.findIdsInListOrder(
      unique,
      options.sortBy,
      options.sortOrder,
    );
    const found = new Set(ordered);
    const input = [...ordered, ...unique.filter((id) => !found.has(id))];

    const { items, labelIds } = await this.ensureLabelsArchived(input, operator, {
      refresh: options.refresh,
    });

    let mergedPdfBase64: string | null = null;
    let mergedPageCount = 0;
    if (labelIds.length > 0) {
      try {
        const buffers = await this.downloadLabels(labelIds);
        const merged = await mergePdfs(buffers);
        mergedPdfBase64 = Buffer.from(merged.bytes).toString('base64');
        mergedPageCount = merged.pageCount;
      } catch (error: unknown) {
        // 合并失败不影响逐单结果：前端会提示并允许逐张补打。
        this.logger.warn(
          `batch label merge failed (${labelIds.length} labels): ${String(error)}`,
          'OrderPlatformShipService',
        );
      }
    }

    const failed = items.filter((item) => !item.ok).length;
    return {
      total: items.length,
      succeeded: items.length - failed,
      failed,
      notPrintable: items.filter((item) => item.code === ORDER_LABEL_NOT_PRINTABLE).length,
      mergedPdfBase64,
      mergedPageCount,
      results: items,
    };
  }

  /**
   * 确保这些订单的平台面单已归档（预取任务与批量打印共用的单点，
   * 用户指示 2026-10-21）。返回逐单结果与「可合并的面单 id」（顺序同输入）。
   *
   * 终态禁打、存档复用、批量取单 + 逐单降级都在这里，调用方不需要各自
   * 再判一遍——预取任务、批量打印、单张打印行为因此完全一致。
   */
  async ensureLabelsArchived(
    orderIds: readonly string[],
    operator: OperatorContext,
    options: { refresh: boolean } = { refresh: false },
  ): Promise<{ items: BatchShippingLabelItem[]; labelIds: string[] }> {
    const unique = [...new Set(orderIds)];
    const outcomes = new Map<string, BatchShippingLabelItem>();
    const labelIds = new Map<string, string>();
    const needs: LabelFetchNeed[] = [];

    for (const orderId of unique) {
      let order: OrderForLabel;
      try {
        order = await this.orderService.getOrderOrThrow(orderId);
      } catch (error: unknown) {
        outcomes.set(orderId, this.labelFailure(orderId, null, error));
        continue;
      }

      if (isOrderLabelPrintBlocked(order)) {
        outcomes.set(orderId, {
          orderId,
          orderNo: order.orderNo,
          ok: false,
          code: ORDER_LABEL_NOT_PRINTABLE,
          message: '订单已完成或已取消，不再支持打印面单',
          signedUrl: null,
          fileName: null,
          fromArchive: false,
        });
        continue;
      }

      if (!options.refresh) {
        const stored = await this.labelService.findLatestOrderLabel(order.id, 'PLATFORM_API');
        if (stored !== null) {
          outcomes.set(orderId, {
            orderId,
            orderNo: order.orderNo,
            ok: true,
            code: null,
            message: null,
            signedUrl: stored.signedUrl,
            fileName: stored.fileName,
            fromArchive: true,
          });
          labelIds.set(orderId, stored.id);
          continue;
        }
      }
      needs.push({ orderId, order });
    }

    for (const group of groupByStore(needs)) {
      let store: { adapter: PlatformAdapter; context: StoreContext };
      try {
        store = await this.resolveStore(group.storeId);
      } catch (error: unknown) {
        for (const need of group.needs) {
          outcomes.set(need.orderId, this.labelFailure(need.orderId, need.order.orderNo, error));
        }
        continue;
      }
      // 平台自报的批量上限优先（WB ≤100），否则用全局配置（OZON ≤20）。
      const configured = this.config.get<number>('app.label.batchFetchChunk') ?? 20;
      const chunkSize = Math.max(1, store.adapter.labelBatchLimit ?? configured);
      for (let index = 0; index < group.needs.length; index += chunkSize) {
        await this.fetchLabelChunk(
          group.needs.slice(index, index + chunkSize),
          store,
          options,
          outcomes,
          labelIds,
          operator,
        );
      }
    }

    const items = unique.map(
      (orderId) =>
        outcomes.get(orderId) ?? this.labelFailure(orderId, null, new Error('面单结果缺失')),
    );
    const orderedLabelIds = unique
      .map((orderId) => labelIds.get(orderId))
      .filter((id): id is string => id !== undefined);
    return { items, labelIds: orderedLabelIds };
  }

  /** 一批评级：优先批量能力，失败/形状不符时逐单降级。 */
  private async fetchLabelChunk(
    needs: readonly LabelFetchNeed[],
    store: { adapter: PlatformAdapter; context: StoreContext },
    options: { refresh: boolean },
    outcomes: Map<string, BatchShippingLabelItem>,
    labelIds: Map<string, string>,
    operator: OperatorContext,
  ): Promise<void> {
    // Bind to the adapter: a detached prototype method runs with
    // `this === undefined` (2026-10-09 production 500 regression class).
    const batchFetch =
      typeof store.adapter.fetchShippingLabels === 'function'
        ? store.adapter.fetchShippingLabels.bind(store.adapter)
        : null;
    if (batchFetch === null) {
      await this.fetchLabelsOneByOne(needs, options, outcomes, labelIds, operator);
      return;
    }

    let files: readonly PlatformOrderLabelFile[];
    try {
      files = await batchFetch(
        store.context,
        needs.map((need) => need.order.platformOrderId),
      );
    } catch (error: unknown) {
      if (isLabelBatchFallbackWorthy(error)) {
        this.logger.warn(
          `batched label fetch unusable (${needs.length} orders), falling back to per-order: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'OrderPlatformShipService',
        );
        await this.fetchLabelsOneByOne(needs, options, outcomes, labelIds, operator);
        return;
      }
      for (const need of needs) {
        outcomes.set(need.orderId, this.labelFailure(need.orderId, need.order.orderNo, error));
      }
      return;
    }

    const byPlatformId = new Map(files.map((entry) => [entry.platformOrderId, entry.file]));
    for (const need of needs) {
      const file = byPlatformId.get(need.order.platformOrderId);
      if (file === undefined) {
        // 批量接口只返回已就绪的单；缺的视为「未就绪」，与单张路径同码。
        outcomes.set(need.orderId, {
          orderId: need.orderId,
          orderNo: need.order.orderNo,
          ok: false,
          code: 'PLATFORM_LABEL_NOT_READY',
          message: '平台尚未生成该订单的面单，稍后再试',
          signedUrl: null,
          fileName: null,
          fromArchive: false,
        });
        continue;
      }
      outcomes.set(need.orderId, await this.archiveLabel(need, file, operator, labelIds));
    }
  }

  private async fetchLabelsOneByOne(
    needs: readonly LabelFetchNeed[],
    options: { refresh: boolean },
    outcomes: Map<string, BatchShippingLabelItem>,
    labelIds: Map<string, string>,
    operator: OperatorContext,
  ): Promise<void> {
    for (const need of needs) {
      try {
        const label = await this.fetchShippingLabel(need.orderId, options, operator);
        outcomes.set(need.orderId, {
          orderId: need.orderId,
          orderNo: need.order.orderNo,
          ok: true,
          code: null,
          message: null,
          signedUrl: label.signedUrl,
          fileName: label.fileName,
          fromArchive: false,
        });
        labelIds.set(need.orderId, label.id);
      } catch (error: unknown) {
        // 同组包路径：取面单失败也可能是平台已取消。定向回读一次，读到取消
        // 就落库并走取消链，再把结果行标记为「不可打印」并说明已自动处理。
        const cancelled = await this.persistCancellationIfAny(need.order, operator, 'label');
        outcomes.set(
          need.orderId,
          cancelled
            ? {
                orderId: need.orderId,
                orderNo: need.order.orderNo,
                ok: false,
                code: ORDER_LABEL_NOT_PRINTABLE,
                message: '平台已取消该订单；系统已按平台事实转入取消并生成拦截任务',
                signedUrl: null,
                fileName: null,
                fromArchive: false,
              }
            : this.labelFailure(need.orderId, need.order.orderNo, error),
        );
      }
    }
  }

  private async archiveLabel(
    need: LabelFetchNeed,
    file: PlatformLabelFile,
    operator: OperatorContext,
    labelIds: Map<string, string>,
  ): Promise<BatchShippingLabelItem> {
    try {
      const label = await this.labelService.createPlatformLabelForOrder(
        {
          orderId: need.orderId,
          fileName: file.fileName,
          mimeType: file.mimeType,
          buffer: Buffer.from(file.bytes),
          externalLabelId: need.order.platformOrderId,
        },
        operator,
      );
      labelIds.set(need.orderId, label.id);
      // 取面单顺带拿到的运单号（WB parcelId）：订单与已建发货单都要补上。
      await this.persistLabelTracking(need.order, file.trackingNumber ?? null, operator);
      this.logger.log(
        `platform label archived order=${need.order.orderNo} via=batch bytes=${file.bytes.byteLength}`,
        'OrderPlatformShipService',
      );
      return {
        orderId: need.orderId,
        orderNo: need.order.orderNo,
        ok: true,
        code: null,
        message: null,
        signedUrl: label.signedUrl,
        fileName: label.fileName,
        fromArchive: false,
      };
    } catch (error: unknown) {
      return this.labelFailure(need.orderId, need.order.orderNo, error);
    }
  }

  private labelFailure(
    orderId: string,
    orderNo: string | null,
    error: unknown,
  ): BatchShippingLabelItem {
    return {
      orderId,
      orderNo,
      ok: false,
      code: error instanceof DomainError ? error.code : 'ORDER_SHIPPING_LABEL_FAILED',
      message: error instanceof Error ? error.message : String(error),
      signedUrl: null,
      fileName: null,
      fromArchive: false,
    };
  }

  /** 有界并发读取面单字节（合并前），避免 50 张串行下载。 */
  private async downloadLabels(labelIds: readonly string[]): Promise<Buffer[]> {
    const buffers: Array<Buffer | undefined> = new Array<Buffer | undefined>(labelIds.length);
    let next = 0;
    const workerCount = Math.min(5, labelIds.length);
    const workers = Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= labelIds.length) {
          return;
        }
        const labelId = labelIds[index];
        if (labelId === undefined) {
          return;
        }
        buffers[index] = await this.labelService.bytesOfLabel(labelId);
      }
    });
    await Promise.all(workers);
    return buffers.filter((buffer): buffer is Buffer => buffer !== undefined);
  }

  /**
   * 打单: fetches the platform-generated label PDF, archives it in the private
   * bucket and returns a signed URL for the browser to print. Reuses the
   * stored copy unless `refresh` is set, so repeated clicks do not re-hit the
   * platform (its label API is rate-limited and all-or-nothing per request).
   *
   * 终态订单（完成/取消）一律拒绝——即使本地还留着未清理的存档（用户指示
   * 2026-10-21）。这是禁打的唯一服务端入口。
   */
  async fetchShippingLabel(
    orderId: string,
    options: { refresh: boolean },
    operator: OperatorContext,
  ): Promise<ShippingLabelDto> {
    const order = await this.orderService.getOrderOrThrow(orderId);
    if (isOrderLabelPrintBlocked(order)) {
      throw new OrderLabelNotPrintableError({
        orderId: order.id,
        orderNo: order.orderNo,
        erpStatus: order.erpStatus,
        platformStage: order.platformStage,
      });
    }

    if (!options.refresh) {
      const stored = await this.labelService.findLatestOrderLabel(order.id, 'PLATFORM_API');
      if (stored !== null) {
        return stored;
      }
    }
    return this.fetchAndArchiveLabel(order, operator);
  }

  private async fetchAndArchiveLabel(
    order: OrderForLabel,
    operator: OperatorContext,
  ): Promise<ShippingLabelDto> {
    const { adapter, context } = await this.resolveStore(order.storeId);
    const fetchLabel = requireCapability(adapter, 'fetchShippingLabel', '平台面单下载');
    const file = await fetchLabel(context, { platformOrderId: order.platformOrderId });
    if (file === null) {
      throw new PlatformLabelNotReadyError({
        orderId: order.id,
        platformOrderId: order.platformOrderId,
      });
    }

    const label = await this.labelService.createPlatformLabelForOrder(
      {
        orderId: order.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        buffer: Buffer.from(file.bytes),
        externalLabelId: order.platformOrderId,
      },
      operator,
    );
    await this.persistLabelTracking(order, file.trackingNumber ?? null, operator);
    this.logger.log(
      `platform label archived order=${order.orderNo} store=${context.storeId} bytes=${file.bytes.byteLength}`,
      'OrderPlatformShipService',
    );
    return label;
  }

  /**
   * 取面单顺带拿到的运单号（WB 跨境贴纸的 parcelId）落库：订单列 + 已建发货单
   * 快照。已有值不覆盖（平台只分配一次）。
   */
  private async persistLabelTracking(
    order: OrderForLabel,
    trackingNumber: string | null,
    operator: OperatorContext,
  ): Promise<void> {
    if (trackingNumber === null || order.platformTrackingNo !== null) {
      return;
    }
    await this.orderService.recordPlatformTrackingNo(order.id, trackingNumber, operator);
    await this.shipmentService.backfillTrackingForOrder(order.id, trackingNumber, operator);
  }

  private batchFailureOf(orderId: string, error: unknown): BatchPrepareShipmentItem {
    return {
      orderId,
      orderNo: null,
      ok: false,
      code: error instanceof DomainError ? error.code : 'ORDER_PLATFORM_SHIP_FAILED',
      message: error instanceof Error ? error.message : String(error),
      trackingNumber: null,
      platformStatus: null,
      alreadyPrepared: false,
      assemblyPending: false,
    };
  }

  /** Order-scoped labels already archived (no platform call). */
  async listShippingLabels(orderId: string): Promise<ShippingLabelDto[]> {
    await this.orderService.getOrderOrThrow(orderId);
    return this.labelService.listByOrder(orderId);
  }

  /**
   * 面单归档成功后的定向事实回读（2026-10-21）。
   *
   * 面单能取到，本身就说明平台已完成注册——这是这条链路上最可靠、不依赖
   * webhook 的信号。OZON 的 TYPE_STATE_CHANGED 不推送 awaiting_deliver 这一跳
   * （全历史 521 条事件实证），而常规回读的兜底是 24 小时，太慢；因此在预取
   * 归档成功后主动读一次，把 awaiting_deliver + 运单号及时落库，并把运单号
   * 回填到已建的发货单。
   *
   * 只对「运单号仍为空」的订单执行：已有运单号的一律跳过，不产生额外调用。
   * 返回 true 表示确实发起并应用了一次回读。
   */
  async refreshFactsAfterLabel(orderId: string, operator: OperatorContext): Promise<boolean> {
    const order = await this.orderService.getOrderOrThrow(orderId);
    if (order.platformTrackingNo !== null) {
      return false;
    }
    const { adapter, context } = await this.resolveStore(order.storeId);
    const fresh = await this.reReadOrder(adapter, context, order.platformOrderId);
    if (fresh === null) {
      return false;
    }
    const facts = await this.orderService.applySyncedPlatformFacts(
      {
        storeId: order.storeId,
        platformOrderId: order.platformOrderId,
        platformStatus: fresh.platformStatus,
        platformCancelled: fresh.platformCancelled ?? false,
        platformStage: fresh.platformStage ?? null,
        platformStageChangedAt: fresh.platformStageChangedAt ?? null,
        shipmentDeadline: fresh.shipmentDeadline ?? order.shipmentDeadline,
        platformTrackingNo: fresh.platformTrackingNo ?? null,
        rawData: fresh.rawData,
        source: 'POLLING',
      },
      operator,
    );
    if (facts.platformTrackingNo !== null) {
      await this.shipmentService.backfillTrackingForOrder(
        order.id,
        facts.platformTrackingNo,
        operator,
      );
    }
    return true;
  }

  /**
   * Raises the exception-center alert for a genuinely failed platform write.
   *
   * Only 5xx-class failures qualify: a 4xx from the adapter means an
   * operator-fixable precondition (the platform status does not allow
   * assembly, the platform has no such capability, assembly is still running)
   * and the operator sees that message directly - turning every such click
   * into an exception row would drown the center in noise.
   */
  private async reportPrepareFailure(
    order: { id: string; orderNo: string; storeId: string; platformOrderId: string },
    error: unknown,
  ): Promise<void> {
    const httpStatus = error instanceof DomainError ? error.httpStatus : 500;
    if (httpStatus < 500) {
      return;
    }
    this.logger.warn(
      `platform prepare-shipment failed order=${order.orderNo} store=${order.storeId}: ${String(error)}`,
      'OrderPlatformShipService',
    );
    await this.exceptionService.create({
      exceptionType: 'ORDER_PLATFORM_SHIP_FAILED',
      severity: 'HIGH',
      referenceType: 'ORDER',
      referenceId: order.id,
      storeId: order.storeId,
      message: `订单 ${order.orderNo} 平台组包/获取运单号失败：${
        error instanceof Error ? error.message : String(error)
      }`,
      details: {
        orderNo: order.orderNo,
        platformOrderId: order.platformOrderId,
        code: error instanceof DomainError ? error.code : 'UNKNOWN',
      },
    });
  }

  /**
   * 定向回读：平台已取消时把事实落库（applySyncedPlatformFacts → 取消链：
   * 释放占用 / PICKED 行生成拦截 / 通知），返回是否发生了取消。
   *
   * 只服务于「动作已经失败」的路径（组包 / 取面单）：这些路径上平台拒绝的
   * 最常见原因就是订单已被取消，而此前的事实被丢掉了（2026-10-27 实证：
   * ORD00000746 打印时平台报 cancelled，ERP 仍停在已拣货、没有拦截与通知）。
   *
   * 任何失败都吞掉并记日志：这里只是「顺手把事实补上」，不能把原本要返回的
   * 平台错误替换成内部错误。
   */
  private async persistCancellationIfAny(
    order: OrderForLabel,
    operator: OperatorContext,
    source: 'prepare' | 'label',
  ): Promise<boolean> {
    try {
      const { adapter, context } = await this.resolveStore(order.storeId);
      const fresh = await this.reReadOrder(adapter, context, order.platformOrderId);
      if (fresh === null || fresh.platformCancelled !== true) {
        return false;
      }
      const facts = await this.orderService.applySyncedPlatformFacts(
        {
          storeId: order.storeId,
          platformOrderId: order.platformOrderId,
          platformStatus: fresh.platformStatus ?? null,
          platformCancelled: true,
          platformStage: fresh.platformStage ?? null,
          platformStageChangedAt: fresh.platformStageChangedAt ?? null,
          shipmentDeadline: fresh.shipmentDeadline ?? null,
          rawData: fresh.rawData ?? null,
          source: 'MANUAL',
        },
        operator,
      );
      this.logger.warn(
        `platform cancellation discovered while ${source}: order=${order.orderNo} cancelled=${String(
          facts.cancelled,
        )}`,
        'OrderPlatformShipService',
      );
      return facts.cancelled === true || facts.applied;
    } catch (error: unknown) {
      this.logger.warn(
        `cancellation re-read failed order=${order.orderNo} during ${source}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'OrderPlatformShipService',
      );
      return false;
    }
  }

  private async resolveStore(
    storeId: string,
  ): Promise<{ adapter: PlatformAdapter; context: StoreContext }> {
    const { store, adapter } = await this.syncContext.resolveSyncableStore(storeId);
    const context = await this.syncContext.buildStoreContext(store);
    return { adapter, context };
  }

  /**
   * Targeted re-read of one order through the adapter's normalized mapper.
   * Returns null when the adapter cannot do a targeted read (the caller then
   * falls back to the preparation result) or when the platform no longer
   * returns the posting.
   */
  private async reReadOrder(
    adapter: PlatformAdapter,
    context: StoreContext,
    platformOrderId: string,
  ): Promise<PlatformOrderRaw | null> {
    if (typeof adapter.fetchOrdersByPlatformIds !== 'function') {
      return null;
    }
    try {
      const orders = await adapter.fetchOrdersByPlatformIds(context, [platformOrderId]);
      return orders.find((candidate) => candidate.platformOrderId === platformOrderId) ?? null;
    } catch (error: unknown) {
      // The write already succeeded; a failed refresh must not turn the
      // operator's action into an error (AGENTS.md §49). The regular order
      // sync re-reads this order anyway.
      this.logger.warn(
        `post-prepare re-read failed order=${platformOrderId} store=${context.storeId}: ${String(error)}`,
        'OrderPlatformShipService',
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------

type CapabilityMethod<K extends 'prepareShipment' | 'fetchShippingLabel'> = NonNullable<
  PlatformAdapter[K]
>;

/**
 * Resolves an optional adapter capability. A platform that does not implement
 * it is reported as unsupported - never silently skipped and never guessed
 * (AGENTS.md §88), which is what lets the UI say "该平台暂不支持" truthfully.
 */
function requireCapability<K extends 'prepareShipment' | 'fetchShippingLabel'>(
  adapter: PlatformAdapter,
  method: K,
  capabilityLabel: string,
): CapabilityMethod<K> {
  const candidate = adapter[method];
  if (typeof candidate !== 'function') {
    throw new PlatformCapabilityUnsupportedError(
      adapter.platformCode,
      capabilityLabel,
      '该平台尚未接入此发货能力（缺少经核实的平台接口事实）',
    );
  }
  // Bind back to the adapter: a detached prototype method would run with
  // `this === undefined` and crash inside the platform implementation.
  return candidate.bind(adapter) as CapabilityMethod<K>;
}

/** The platform has not generated a printable label for the order yet. */
export class PlatformLabelNotReadyError extends DomainError {
  readonly code = 'PLATFORM_LABEL_NOT_READY';
  readonly httpStatus = 409;

  constructor(details: { orderId: string; platformOrderId: string }) {
    super('平台尚未生成该订单的面单。请先点「获取运单号」完成平台上组包，稍后再试。', {
      ...details,
    });
  }
}

/** Stable code of the terminal-order print refusal (完成/取消后禁打). */
const ORDER_LABEL_NOT_PRINTABLE = 'ORDER_LABEL_NOT_PRINTABLE';

/**
 * 订单已完成或已取消，不再支持打印面单（用户指示 2026-10-21）。
 * 面单字节可能在后台清理之前仍存在，但终态禁打与清理无关——它由订单状态
 * 直接决定，立即可靠。
 */
export class OrderLabelNotPrintableError extends DomainError {
  readonly code = ORDER_LABEL_NOT_PRINTABLE;
  readonly httpStatus = 409;

  constructor(details: {
    orderId: string;
    orderNo: string;
    erpStatus: string;
    platformStage: string | null;
  }) {
    super('订单已完成或已取消，不再支持打印面单', { ...details });
  }
}

/** 按店铺分组（适配器/凭证是店铺级的）。 */
function groupByStore(
  needs: readonly LabelFetchNeed[],
): Array<{ storeId: string; needs: LabelFetchNeed[] }> {
  const groups = new Map<string, LabelFetchNeed[]>();
  for (const need of needs) {
    const existing = groups.get(need.order.storeId);
    if (existing === undefined) {
      groups.set(need.order.storeId, [need]);
    } else {
      existing.push(need);
    }
  }
  return [...groups.entries()].map(([storeId, groupNeeds]) => ({
    storeId,
    needs: groupNeeds,
  }));
}

/**
 * 批量取单是否应降级为逐单：
 * - 返回形状无法与订单一一对应（`PlatformBatchShapeError`）；
 * - 平台以 4xx 业务错误拒绝（OZON「一个单不可取则整批不成」，逐单才能把坏单
 *   隔离出来）。
 *
 * 5xx / 鉴权 / 网络 / 限流（429）一律不降级：它们是「整条链路暂时不可用」，
 * 逐单重试只会把同一个失败放大成 N 倍并继续消耗平台配额。2026-11-03 的 429
 * 事故就是这样放大的——1 单的批量失败后又原样重试了一次，15 单的批量则变成
 * 60 次请求，把限流窗口一直撑满。
 */
function isLabelBatchFallbackWorthy(error: unknown): boolean {
  if (error instanceof PlatformBatchShapeError) {
    return true;
  }
  if (error instanceof PlatformApiError) {
    const status = error.platformError.httpStatus;
    return (
      typeof status === 'number' &&
      status >= 400 &&
      status < 500 &&
      status !== 429 &&
      status !== 408
    );
  }
  return false;
}
