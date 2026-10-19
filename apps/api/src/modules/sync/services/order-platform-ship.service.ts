import { Injectable } from '@nestjs/common';
import {
  PlatformAdapter,
  PlatformOrderRaw,
  PlatformShipmentPreparation,
  StoreContext,
} from '@wcies/platform-contracts';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { OrderService } from '../../order/services/order.service';
import { OrderListSortField } from '../../order/enums/order.constants';
import { ExceptionService } from '../../exception/services/exception.service';
import { ShippingLabelService } from '../../shipment/services/shipping-label.service';
import { mergePdfs } from '../../shipment/services/pdf-merge';
import { ShippingLabelDto } from '../../shipment/dto/shipment.dto';
import { PlatformCapabilityUnsupportedError } from '../../integration/integration.errors';
import { DomainError } from '../../../common/errors/domain.error';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { SyncContextService } from './sync-context.service';

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
}

export interface BatchShippingLabelResult {
  total: number;
  succeeded: number;
  failed: number;
  /** 成功面单合并成的单个 PDF（base64）；合并失败或全部失败时为 null。 */
  mergedPdfBase64: string | null;
  /** 合并 PDF 的总页数（每张面单通常 1 页）。 */
  mergedPageCount: number;
  results: BatchShippingLabelItem[];
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
    private readonly operationLog: OperationLogService,
    private readonly logger: AppLoggerService,
  ) {}

  /**
   * 获取运单号: asks the platform to accept the order for dispatch (OZON 组包)
   * and stores the resulting facts. Idempotent - an order the platform already
   * accepted produces NO platform write and just refreshes the local facts.
   */
  async prepareShipment(
    orderId: string,
    operator: OperatorContext,
  ): Promise<PrepareShipmentResult> {
    const order = await this.orderService.getOrderOrThrow(orderId);
    const { adapter, context } = await this.resolveStore(order.storeId);

    const prepare = requireCapability(adapter, 'prepareShipment', '平台组包/获取运单号');
    let result: PlatformShipmentPreparation;
    try {
      result = await prepare(context, { platformOrderId: order.platformOrderId });
    } catch (error: unknown) {
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
    await this.orderService.applySyncedPlatformFacts(
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

    return {
      orderId: order.id,
      orderNo: order.orderNo,
      platformCode: adapter.platformCode,
      trackingNumber: result.trackingNumber,
      platformStatus: result.platformStatus,
      alreadyPrepared: result.alreadyPrepared,
      assemblyPending: result.assemblyPending === true,
      platformWritePerformed: !result.alreadyPrepared && result.assemblyPending !== true,
    };
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
    for (const orderId of new Set(orderIds)) {
      try {
        const result = await this.prepareShipment(orderId, operator);
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
      } catch (error: unknown) {
        results.push(this.batchFailureOf(orderId, error));
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  /**
   * 批量打单（用户指示 2026-10-17）：逐单顺序取面单（**串行**，尊重平台面单
   * 接口限流），单笔失败不影响其余。默认复用本地已存档面单，不重复打平台。
   *
   * 成功面单在服务端**合并成一个 PDF**（`mergedPdfBase64`）：平台面单自带纸张
   * 尺寸（OZON 实测 57.9×40mm），只有交给浏览器原生 PDF 查看器打印才能保持
   * 原尺寸；嵌进 HTML 打印页会被缩放成 A4（2026-10-17 用户实测报错）。
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
    const results: BatchShippingLabelItem[] = [];
    const labelIds: string[] = [];
    // 打印顺序 = 列表当前排序（2026-10-19 用户要求）。服务端按同一排序口径
    // 重排后逐单取面单，合并 PDF 的页序即与列表一致；查不到的 id 追加在末尾，
    // 仍按原来的逐笔失败路径报错。
    const unique = [...new Set(orderIds)];
    const ordered = await this.orderService.findIdsInListOrder(
      unique,
      options.sortBy,
      options.sortOrder,
    );
    const found = new Set(ordered);
    for (const orderId of [...ordered, ...unique.filter((id) => !found.has(id))]) {
      // 先读一次订单拿单号（失败结果也要有可读标识）；读不到由 catch 处理。
      let orderNo: string | null = null;
      try {
        const order = await this.orderService.getOrderOrThrow(orderId);
        orderNo = order.orderNo;
        const label = await this.fetchShippingLabel(orderId, options, operator);
        labelIds.push(label.id);
        results.push({
          orderId,
          orderNo,
          ok: true,
          code: null,
          message: null,
          signedUrl: label.signedUrl,
          fileName: label.fileName,
        });
      } catch (error: unknown) {
        results.push({
          orderId,
          orderNo,
          ok: false,
          code: error instanceof DomainError ? error.code : 'ORDER_SHIPPING_LABEL_FAILED',
          message: error instanceof Error ? error.message : String(error),
          signedUrl: null,
          fileName: null,
        });
      }
    }

    let mergedPdfBase64: string | null = null;
    let mergedPageCount = 0;
    if (labelIds.length > 0) {
      try {
        const buffers: Buffer[] = [];
        for (const labelId of labelIds) {
          buffers.push(await this.labelService.bytesOfLabel(labelId));
        }
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

    const failed = results.filter((item) => !item.ok).length;
    return {
      total: results.length,
      succeeded: results.length - failed,
      failed,
      mergedPdfBase64,
      mergedPageCount,
      results,
    };
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

  /**
   * 打单: fetches the platform-generated label PDF, archives it in the private
   * bucket and returns a signed URL for the browser to print. Reuses the
   * stored copy unless `refresh` is set, so repeated clicks do not re-hit the
   * platform (its label API is rate-limited and all-or-nothing per request).
   */
  async fetchShippingLabel(
    orderId: string,
    options: { refresh: boolean },
    operator: OperatorContext,
  ): Promise<ShippingLabelDto> {
    const order = await this.orderService.getOrderOrThrow(orderId);

    if (!options.refresh) {
      const stored = await this.labelService.findLatestOrderLabel(order.id, 'PLATFORM_API');
      if (stored !== null) {
        return stored;
      }
    }

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
    this.logger.log(
      `platform label archived order=${order.orderNo} store=${context.storeId} bytes=${file.bytes.byteLength}`,
      'OrderPlatformShipService',
    );
    return label;
  }

  /** Order-scoped labels already archived (no platform call). */
  async listShippingLabels(orderId: string): Promise<ShippingLabelDto[]> {
    await this.orderService.getOrderOrThrow(orderId);
    return this.labelService.listByOrder(orderId);
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
