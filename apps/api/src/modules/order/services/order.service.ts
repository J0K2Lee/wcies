import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { StoreService } from '../../store/services/store.service';
import { NotificationService } from '../../notification/services/notification.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { SkuImageService } from '../../product/services/sku-image.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRepository, OrderListFilters } from '../repositories/order.repository';
import { OrderListSortField } from '../enums/order.constants';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { PlatformStatusHistoryRepository } from '../repositories/platform-status-history.repository';
import { OrderStatusService } from './order-status.service';
import { OrderDeadlineExceptionService } from './order-deadline-exception.service';
import { OrderTrackingStallService } from './order-tracking-stall.service';
import { OrderIngestionService } from './order-ingestion.service';
import { OrderPlatformShippedService } from './order-platform-shipped.service';
import { ErpOrderStatus, isPlatformShippedStage, orderReleaseKey } from '../enums/order.constants';
import {
  OrderInvalidStateError,
  OrderItemNotFoundError,
  OrderNotFoundError,
} from '../errors/order.errors';
import { ORDER_PICKING_STATE_PORT, OrderPickingStatePort } from '../ports/order-picking-state.port';
import { ORDER_INTERCEPTION_PORT, OrderInterceptionPort } from '../ports/order-interception.port';
import { ORDER_PROCUREMENT_PORT, OrderProcurementPort } from '../ports/order-procurement.port';
import { isExternalFulfillmentMode } from '../../platform/constants/platform.constants';
import { PlatformAdapterRegistry } from '../../integration/platform-adapter.registry';
import { DomainError } from '../../../common/errors/domain.error';
import {
  OrderBatchMarkExternalFulfillmentItemDto,
  OrderBatchMarkExternalFulfillmentResultDto,
  OrderDetailDto,
  OrderListItemDto,
} from '../dto/order.dto';

/**
 * Order application service (Sprint 3): list/detail, cancellation with
 * per-line inventory handling, and backorder retry. Stock is only ever
 * touched through the exported Inventory services (AGENTS.md §10).
 *
 * Sprint 9 T1 adds platform FACT maintenance for already-ingested orders
 * (compare-and-update platform_status / shipment_deadline / raw_data +
 * platform_status_history + automatic cancel propagation), and T6 adds the
 * "mark externally fulfilled" close-out action.
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderRepo: OrderRepository,
    private readonly itemRepo: OrderItemRepository,
    private readonly historyRepo: OrderStatusHistoryRepository,
    private readonly platformStatusHistoryRepo: PlatformStatusHistoryRepository,
    private readonly statusService: OrderStatusService,
    private readonly deadlineExceptionService: OrderDeadlineExceptionService,
    private readonly stallService: OrderTrackingStallService,
    private readonly ingestionService: OrderIngestionService,
    /**
     * 平台已事实发货的收敛（用户指示 2026-10-14）：归一化阶段
     * IN_TRANSIT / DELIVERED 的订单按平台事实关闭内部缺货/时限状态，
     * 除未映射异常外不阻塞。同步遭遇、摄入、映射修复三条路径共用。
     */
    private readonly platformShipped: OrderPlatformShippedService,
    private readonly reservationService: ReservationService,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly exceptionService: ExceptionService,
    private readonly storeService: StoreService,
    private readonly skuImageService: SkuImageService,
    private readonly operationLog: OperationLogService,
    private readonly notification: NotificationService,
    private readonly logger: AppLoggerService,
    @Inject(forwardRef(() => ORDER_PICKING_STATE_PORT))
    private readonly pickingState: OrderPickingStatePort,
    @Inject(forwardRef(() => ORDER_INTERCEPTION_PORT))
    private readonly interceptionPort: OrderInterceptionPort,
    @Inject(forwardRef(() => ORDER_PROCUREMENT_PORT))
    private readonly procurementPort: OrderProcurementPort,
    /**
     * Capability FLAGS only (2026-09-18 fulfillment flow). The registry is the
     * sanctioned way for core modules to learn which capabilities a platform
     * exposes without importing platform internals (AGENTS.md §32/§33); no
     * platform call is ever made from here.
     */
    private readonly adapterRegistry: PlatformAdapterRegistry,
  ) {}

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  /**
   * 自动拣货批量入口的候选集（2026-09-18 用户指示）：erpStatus =
   * READY_TO_PICK（待拣货）的订单，可按店铺过滤，按订单时间倒序取 limit 条。
   * 只返回标识，拣货任务的创建/去重由 picking 模块负责（AGENTS §7/§9）。
   */
  async listReadyToPickOrders(filters: {
    storeId?: string;
    limit: number;
  }): Promise<Array<{ id: string; orderNo: string }>> {
    const { rows } = await this.orderRepo.listWithAggregates(
      {
        erpStatus: 'READY_TO_PICK',
        ...(filters.storeId !== undefined ? { storeId: filters.storeId } : {}),
      },
      filters.limit,
      0,
    );
    return rows.map((row) => ({ id: row.order.id, orderNo: row.order.orderNo }));
  }

  async list(
    filters: OrderListFilters & { pendingProcurement?: boolean },
    page: { page: number; pageSize: number },
  ): Promise<{ items: OrderListItemDto[]; meta: PageMeta }> {
    let effectiveFilters: OrderListFilters = filters;
    if (filters.pendingProcurement === true) {
      // 待采购视角（purchase.md §3.5）：存在缺货行、且其缺口尚未被在途采购覆盖。
      // 覆盖口径按 SKU×仓的在途数量按分配优先级逐行切分（决策 0023），由采购模块
      // 端口给出结论；本仓库只负责订单行事实，不跨模块写 SQL（AGENTS.md §9）。
      const shortItemIds = await this.procurementPort.listShortItemIds();
      const orderIds = await this.orderRepo.findOrderIdsWithBackorderedLinesIn(shortItemIds);
      effectiveFilters = { ...filters, orderIds };
    }
    if (effectiveFilters.goodsState === 'PURCHASED') {
      // 已采购（2026-10-21 决策 0023）：存在缺货行且该行的缺口已被在途采购覆盖。
      // 不再有「已到货」这一档——到货的货会直接参与分配，缺货行随之消失。
      const coveredItemIds = await this.procurementPort.listCoveredItemIds();
      const orderIds = await this.orderRepo.findOrderIdsWithBackorderedLinesIn(coveredItemIds);
      effectiveFilters = { ...effectiveFilters, goodsState: undefined, orderIds };
    }
    const { rows, total } = await this.orderRepo.listWithAggregates(
      effectiveFilters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    // Dual-axis §2.3 in-line markers: for the page's BACKORDERED lines, the
    // derived coverage (purchase.md §3.5) comes through the port - one
    // round-trip for the whole page, never per-line queries and never a
    // cross-module SQL (AGENTS.md §9).
    const backorderedIdsByOrder = await this.orderRepo.findBackorderedItemIdsByOrderIds(
      rows.map((row) => row.order.id),
    );
    const allBackorderedIds = [...backorderedIdsByOrder.values()].flat();
    const coverageByItem = await this.procurementPort.getCoverageByOrderItemIds(allBackorderedIds);
    const items: OrderListItemDto[] = rows.map((row) => {
      let covered = 0;
      let short = 0;
      let unbound = 0;
      for (const itemId of backorderedIdsByOrder.get(row.order.id) ?? []) {
        const coverage = coverageByItem[itemId];
        if (coverage?.warehouseBound === false) {
          // 店铺未绑定仓库（2026-10-24 用户指示）：不是缺货，单列计数。
          unbound += 1;
        } else if (coverage?.coverage === 'COVERED') {
          covered += 1;
        } else {
          short += 1;
        }
      }
      return {
        id: row.order.id,
        orderNo: row.order.orderNo,
        storeId: row.order.storeId,
        storeName: row.storeName,
        storeCurrency: row.storeCurrency,
        platformCode: row.platformCode,
        platformOrderId: row.order.platformOrderId,
        platformStatus: row.order.platformStatus,
        platformStage: row.order.platformStage,
        labelPrintedAt: row.order.labelPrintedAt,
        externalFulfilledAt: row.order.externalFulfilledAt,
        erpStatus: row.order.erpStatus,
        fulfillmentMode: row.order.fulfillmentMode,
        currency: row.order.currency,
        orderedAt: row.order.orderedAt,
        shipmentDeadline: row.order.shipmentDeadline,
        platformTrackingNo: row.order.platformTrackingNo,
        syncSource: row.order.syncSource,
        createdAt: row.order.createdAt,
        itemsCount: row.itemsCount,
        reservedCount: row.reservedCount,
        backorderedCount: row.backorderedCount,
        pickedCount: row.pickedCount,
        mappingFailedCount: row.mappingFailedCount,
        openExceptionsCount: row.openExceptionsCount,
        firstSkuCode: row.firstSkuCode,
        skuKindCount: row.skuKindCount,
        backorderedCoveredCount: covered,
        backorderedShortCount: short,
        backorderedUnboundCount: unbound,
        isUrgent: row.order.isUrgent,
      };
    });
    return { items, meta: { page: page.page, pageSize: page.pageSize, total } };
  }

  /**
   * 同步去重（2026-10-23）：按 raw_data 字段批量反查本店铺已有订单。
   * 用于「同一张平台订单出现在两个数据源」的场景（WB FBS 任务流 + 统计流水），
   * 命中即跳过，避免重复建单。
   */
  /**
   * 按平台标识（platform_order_id / raw.rid）批量反查已有订单，供同步层做
   * 跨数据源去重（2026-10-24）。
   */
  async findOrderIdsByPlatformIdentifiers(
    storeId: string,
    identifiers: readonly string[],
  ): Promise<Map<string, string>> {
    return this.orderRepo.findIdsByPlatformIdentifiers(storeId, identifiers);
  }

  async findOrderIdsByRawField(
    storeId: string,
    field: string,
    values: readonly string[],
  ): Promise<Map<string, string>> {
    return this.orderRepo.findIdsByRawField(storeId, field, values);
  }

  /** Public facts-only read for sync/backfill; no adapter dependency. */
  async listMissingPlatformImages(
    storeId: string,
    orderId?: string,
  ): Promise<
    Array<{
      id: string;
      orderId: string;
      platformSkuId: string | null;
      sellerSku: string | null;
    }>
  > {
    return this.itemRepo.findMissingPlatformImages(storeId, orderId);
  }

  /** Public store-scoped batch write; never mutates mapping or inventory. */
  async savePlatformImages(
    storeId: string,
    images: readonly { orderItemId: string; imageUrl: string }[],
    operator: OperatorContext,
  ): Promise<number> {
    const updated = await this.itemRepo.savePlatformImages(storeId, images);
    for (const id of updated) {
      await this.operationLog.record({
        entityType: 'ORDER_ITEM',
        entityId: id,
        entityCode: id,
        action: 'UPDATE',
        changes: { platformImageUrl: { from: null, to: 'PLATFORM_IMAGE_ATTACHED' } },
        operator,
      });
    }
    return updated.length;
  }

  async getDetail(id: string): Promise<OrderDetailDto> {
    const order = await this.getOrderOrThrow(id);
    const [store, items, history, platformStatusHistory, interceptions] = await Promise.all([
      this.storeService.getEntityWithPlatform(order.storeId),
      this.itemRepo.findByOrderIdWithSku(order.id),
      this.historyRepo.listByOrderId(order.id),
      this.platformStatusHistoryRepo.listByOrderId(order.id),
      this.interceptionPort.listByOrderId(order.id),
    ]);

    const itemDtos = await Promise.all(
      items.map(async ({ item, skuCode, skuName, latestPurchasePrice }) => {
        let reservation: OrderDetailDto['items'][number]['reservation'] = null;
        if (item.reservationId !== null) {
          try {
            const dto = await this.inventoryQuery.getReservation(item.reservationId);
            reservation = {
              id: dto.id,
              reservationNo: dto.reservationNo,
              status: dto.status,
              lines: dto.lines.map((line) => ({
                binId: line.binId,
                binCode: line.binCode,
                quantity: line.quantity,
                pickedQty: line.pickedQty,
                status: line.status,
              })),
            };
          } catch {
            reservation = null;
          }
        }
        const exceptions = await this.exceptionService.listByReference('ORDER_ITEM', item.id);
        return {
          id: item.id,
          orderId: item.orderId,
          lineNo: item.lineNo,
          platformProductId: item.platformProductId,
          platformSkuId: item.platformSkuId,
          sellerSku: item.sellerSku,
          offerId: item.offerId,
          listingSkuId: item.listingSkuId,
          skuId: item.skuId,
          skuCode,
          skuName,
          latestPurchasePrice,
          warehouseId: item.warehouseId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          imageUrl: item.skuId === null ? (item.platformImageUrl ?? null) : null,
          imageSource: null as 'INTERNAL' | 'PLATFORM' | null,
          fulfillmentStatus: item.fulfillmentStatus,
          mappingStatus: item.mappingStatus,
          // 缺口覆盖（purchase.md §3.5 派生，2026-10-21 决策 0023）——未映射行
          // 无采购语义，保持 NULL。
          procurementCoverage: null as 'COVERED' | 'SHORT' | null,
          procurementGapQty: null as string | null,
          procurementInTransitQty: null as string | null,
          procurementWarehouseId: null as string | null,
          storeWarehouseUnbound: false,
          reservationId: item.reservationId,
          reservation,
          rawData: item.rawData,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
          exceptions: exceptions.map((exception) => ({
            id: exception.id,
            exceptionNo: exception.exceptionNo,
            exceptionType: exception.exceptionType,
            status: exception.status,
            message: exception.message,
          })),
        };
      }),
    );

    // One port round-trip for the whole order keeps the derived coverage
    // consistent and avoids per-line queries (purchase.md §3.5).
    const mappedItemIds = items
      .filter(({ item }) => item.skuId !== null)
      .map(({ item }) => item.id);
    const coverageByItem = await this.procurementPort.getCoverageByOrderItemIds(mappedItemIds);
    for (const dto of itemDtos) {
      const coverage = coverageByItem[dto.id];
      if (coverage === undefined) continue;
      dto.procurementCoverage = coverage.coverage;
      dto.procurementGapQty = coverage.gapQty;
      dto.procurementInTransitQty = coverage.inTransitQty;
      dto.procurementWarehouseId = coverage.warehouseId;
      dto.storeWarehouseUnbound = !coverage.warehouseBound;
    }

    // Mapping switches authority to the internal SKU, even if it has no image.
    const imageUrls = await this.resolvePrimaryImages(items);
    for (const dto of itemDtos) {
      if (dto.skuId !== null) dto.imageUrl = imageUrls.get(dto.skuId) ?? null;
      dto.imageSource = dto.imageUrl === null ? null : dto.skuId === null ? 'PLATFORM' : 'INTERNAL';
    }

    const pickingTasks = await this.pickingState.listTasksForOrder(order.id);

    return {
      id: order.id,
      orderNo: order.orderNo,
      storeId: order.storeId,
      storeName: store?.store.name ?? '',
      storeCurrency: store?.store.defaultCurrency ?? null,
      platformCode: store?.platformCode ?? '',
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus,
      platformStage: order.platformStage,
      labelPrintedAt: order.labelPrintedAt,
      externalFulfilledAt: order.externalFulfilledAt,
      externalFulfillmentReason: order.externalFulfillmentReason,
      erpStatus: order.erpStatus,
      fulfillmentMode: order.fulfillmentMode,
      currency: order.currency,
      orderedAt: order.orderedAt,
      shipmentDeadline: order.shipmentDeadline,
      platformTrackingNo: order.platformTrackingNo,
      platformCapabilities: this.platformCapabilitiesOf(store?.platformCode ?? null),
      rawData: order.rawData,
      remark: order.remark,
      syncSource: order.syncSource,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      items: itemDtos,
      history: history.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        reason: entry.reason,
        operatorName: entry.operatorName,
        createdAt: entry.createdAt,
      })),
      // Separate timeline of RAW platform transitions (Sprint 9 T1, decision
      // 5 = B); the frontend merges it with `history` by createdAt.
      platformStatusHistory: platformStatusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        source: entry.source,
        platformChangedAt: entry.platformChangedAt ?? null,
        operatorName: entry.operatorName,
        createdAt: entry.createdAt,
      })),
      interceptions: interceptions.map((entry) => ({
        id: entry.id,
        interceptionNo: entry.interceptionNo,
        orderItemId: entry.orderItemId,
        warehouseId: entry.warehouseId,
        status: entry.status,
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
      pickingTasks,
    };
  }

  /**
   * SKU 主图（signed URL）批量解析：订单行图片取内部 SKU 主图，
   * 每个 SKU 一次查询（订单行数有限，不做额外缓存层）。
   */
  private async resolvePrimaryImages(
    items: Array<{ item: OrderItemEntity }>,
  ): Promise<Map<string, string>> {
    const skuIds = [
      ...new Set(
        items.map(({ item }) => item.skuId).filter((skuId): skuId is string => skuId !== null),
      ),
    ];
    const urlBySku = new Map<string, string>();
    await Promise.all(
      skuIds.map(async (skuId) => {
        const images = await this.skuImageService.listBySku(skuId);
        const primary = images.find((image) => image.isPrimary) ?? images[0];
        if (primary !== undefined) {
          urlBySku.set(skuId, primary.url);
        }
      }),
    );
    return urlBySku;
  }

  // --------------------------------------------------------------------------
  // Backorder retry (task §24/§73)
  // --------------------------------------------------------------------------

  /**
   * Retry allocation for one line (task §24).
   *
   * Three entry states:
   *  - MAPPED + (BACKORDERED | PENDING): stock retry, no re-resolution.
   *  - MAPPED + other status: rejected (409) - the line neither needs stock
   *    nor has a mapping problem to fix.
   *  - FAILED: the mapping may have been repaired since ingestion (e.g. the
   *    operator just quick-onboarded the variant), so the line is ALWAYS
   *    re-resolved with the same store-scoped rules; stock is only reserved
   *    when the line's status allows it (BACKORDERED / PENDING). Repairing the
   *    mapping must not be gated on the allocation status - otherwise a
   *    RELEASED / non-allocatable line could never leave FAILED, keeping its
   *    mapping exception open and the order stuck in EXCEPTION
   *    (orders-page 快速建档自动重试, 2026-10-14).
   */
  async retryAllocation(
    orderItemId: string,
    operator: OperatorContext,
  ): Promise<{
    orderItemId: string;
    fulfillmentStatus: string;
    reserved: boolean;
    /** True when this call repaired a FAILED platform mapping. */
    mappingRepaired: boolean;
  }> {
    const item = await this.itemRepo.findById(orderItemId);
    if (item === null) {
      throw new OrderItemNotFoundError(orderItemId);
    }
    const order = await this.getOrderOrThrow(item.orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，不能重新分配库存', { orderId: order.id });
    }
    const allocatable =
      item.fulfillmentStatus === 'BACKORDERED' || item.fulfillmentStatus === 'PENDING';

    // 映射仍失败的行：**先修映射，再按分配状态决定是否占库存**（2026-10-14 修正
    // 顺序）。此前是「先卡状态、后修映射」：分配状态不属于 BACKORDERED/PENDING
    // 的行（典型：已释放/不持有内部库存的 RELEASED 行）即使平台变体已补齐映射，
    // 也会被状态守卫 409 拦住 —— 订单页「快速建档后自动重试映射」对这类行表现为
    // 失效：映射补不上、映射异常常开、订单卡在 EXCEPTION。
    if (item.mappingStatus === 'FAILED') {
      const retried = await this.ingestionService.retryFailedMappingItem(order, item, operator, {
        allocate: allocatable,
      });
      if (!retried.resolved) {
        // Still unmapped: tell the operator exactly what the resolver saw.
        throw new OrderInvalidStateError(
          '该订单行仍未匹配到内部 SKU：请确认 SKU 映射中该平台变体已补齐并保存',
          { orderItemId: item.id, resolveCode: retried.code },
        );
      }
      // retryFailedMappingItem already recomputes the rollup status.
      const afterRetry = await this.itemRepo.findById(orderItemId);
      return {
        orderItemId,
        fulfillmentStatus: afterRetry?.fulfillmentStatus ?? item.fulfillmentStatus,
        reserved: retried.reserved,
        mappingRepaired: true,
      };
    }

    if (!allocatable) {
      throw new OrderInvalidStateError(
        `订单行状态 ${item.fulfillmentStatus} 不允许重试分配（仅 BACKORDERED / PENDING）`,
        { orderItemId: item.id, fulfillmentStatus: item.fulfillmentStatus },
      );
    }

    if (item.mappingStatus !== 'MAPPED' || item.skuId === null) {
      throw new OrderInvalidStateError('订单行未成功映射 SKU，不能重试分配', {
        orderItemId: item.id,
        mappingStatus: item.mappingStatus,
      });
    }

    // 外部履约（ERP 建议#6 修复 2026-09-28）：平台持货行的重试永不占用内部
    // 库存——行直接 EXTERNAL_FULFILLED；平台已发货（IN_TRANSIT / DELIVERED）
    // 时订单随平台事实立即 SHIPPED，与 applySyncedPlatformFacts 保持一致。
    if (isExternalFulfillmentMode(order.fulfillmentMode)) {
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'EXTERNAL_FULFILLED',
        });
        await this.exceptionService.resolveByReferenceInTx(runner, {
          exceptionType: 'ORDER_OUT_OF_STOCK',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
        });
      });
      if (order.platformStage === 'IN_TRANSIT' || order.platformStage === 'DELIVERED') {
        await this.statusService.transition(
          order.id,
          'SHIPPED',
          operator,
          `平台履约流转：重新分配时平台已发货（${order.platformStage}，外部履约 ${order.fulfillmentMode}）`,
        );
      } else {
        await this.statusService.recomputeOrderStatus(
          order.id,
          operator,
          `第 ${item.lineNo} 行重新分配（外部履约，等待平台发货事实）`,
        );
      }
      const afterExternal = await this.itemRepo.findById(orderItemId);
      return {
        orderItemId,
        fulfillmentStatus: afterExternal?.fulfillmentStatus ?? 'EXTERNAL_FULFILLED',
        reserved: false,
        mappingRepaired: false,
      };
    }

    // 平台已事实发货（用户指示 2026-10-14）：货物在平台侧已经发走，重试
    // 占库存会被现实否证——RESERVED 会随已发货订单把库存锁死。订单由
    // 同步链路按平台事实收敛（缺货行转外部履约完成、关缺货异常、转
    // SHIPPED，见 OrderPlatformShippedService），此处明确拒绝并说明，
    // 避免运营对同一缺货事实反复点击。外部履约行在上方已提前处理。
    if (isPlatformShippedStage(order.platformStage)) {
      throw new OrderInvalidStateError(
        `该订单平台已事实发货（${order.platformStage}），内部缺货状态将按平台事实自动收敛，无需重新分配`,
        { orderId: order.id, orderItemId: item.id, platformStage: order.platformStage },
      );
    }

    const outcome = await this.ingestionService.allocateMappedItem(order, item, operator);
    if (outcome.reserved) {
      // Success: close the OPEN out-of-stock exception.
      await this.dataSource.transaction(async (runner) => {
        await this.exceptionService.resolveByReferenceInTx(runner, {
          exceptionType: 'ORDER_OUT_OF_STOCK',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
        });
      });
      await this.statusService.recomputeOrderStatus(
        order.id,
        operator,
        `第 ${item.lineNo} 行重新分配成功`,
      );
    } else {
      // 缺货（orders.md §5.A/§5.B.2）：PENDING 行必须落到 BACKORDERED 并
      // 创建缺货异常——静默停在 PENDING 会让操作员看不到任何待办。对已是
      // BACKORDERED 的行这是幂等重写；createInTx 幂等，不产生重复异常。
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'BACKORDERED',
        });
        await this.exceptionService.createInTx(runner, {
          exceptionType: 'ORDER_OUT_OF_STOCK',
          severity: 'MEDIUM',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
          storeId: order.storeId,
          message: `订单 ${order.orderNo} 第 ${item.lineNo} 行重试分配后仍库存不足`,
          details: { orderNo: order.orderNo, lineNo: item.lineNo },
        });
      });
      await this.statusService.recomputeOrderStatus(
        order.id,
        operator,
        `第 ${item.lineNo} 行重试分配仍库存不足`,
      );
    }
    const fresh = await this.itemRepo.findById(orderItemId);
    return {
      orderItemId,
      fulfillmentStatus: fresh?.fulfillmentStatus ?? item.fulfillmentStatus,
      reserved: outcome.reserved,
      mappingRepaired: false,
    };
  }

  /**
   * 手工释放订单行的库存占用（用户要求 2026-10-26）：已占用（RESERVED）行可以
   * 主动退回「待分配」，且释放后不立即重新分配。
   *
   * - 走 InventoryService 的正常释放链路（`orderDomain: true`，幂等键沿用
   *   `ORDER_RELEASE:<itemId>`，与取消共用），库存流水/余额由库存模块写；
   * - 行落到 **PENDING**（= 待分配 / 缺货的未分配态），清掉 reservationId 与
   *   warehouseId——行不再声称持有任何仓库的库存；
   * - **不触发自动重新分配**：库存增加监听器只在入库 / 移位 / 调拨入库等真实库存
   *   增加时广播，释放占用只是把可售还回去，不产生该事件；后续真实入库仍会按
   *   FIFO 自动分配（既有规则），这里只是不做「释放后立刻抢回」；
   * - 不新建缺货异常：这是运营主动决策，不是库存/数据故障；缺货视图与采购覆盖
   *   按行状态派生，天然会重新显示。
   */
  async releaseItemReservation(
    orderItemId: string,
    operator: OperatorContext,
  ): Promise<{
    orderItemId: string;
    orderId: string;
    fulfillmentStatus: string;
    orderErpStatus: ErpOrderStatus;
    releasedReservationId: string;
  }> {
    const item = await this.itemRepo.findById(orderItemId);
    if (item === null) {
      throw new OrderItemNotFoundError(orderItemId);
    }
    const order = await this.getOrderOrThrow(item.orderId);
    if (order.erpStatus === 'CANCELLED' || order.erpStatus === 'SHIPPED') {
      throw new OrderInvalidStateError('订单已取消或已发货，不能释放库存占用', {
        orderId: order.id,
        erpStatus: order.erpStatus,
      });
    }
    if (item.fulfillmentStatus !== 'RESERVED' || item.reservationId === null) {
      throw new OrderInvalidStateError('该行当前没有库存占用，只有「已占用」行可以释放', {
        orderItemId: item.id,
        fulfillmentStatus: item.fulfillmentStatus,
      });
    }
    // 拣货任务行仍引用这笔占用：先释放会让任务与实际库存脱节（拣完无法出库）。
    // 要求先完成或取消任务，而不是替运营猜。
    if ((await this.pickingState.countActivePickingItems(order.id)) > 0) {
      throw new OrderInvalidStateError(
        '订单存在进行中的拣货任务，请先完成或取消拣货任务再释放该行',
        { orderId: order.id, orderItemId: item.id },
      );
    }

    const reservationId = item.reservationId;
    await this.reservationService.releaseReservation(reservationId, {
      operator,
      idempotencyKey: orderReleaseKey(item.id),
      remark: `manual release order=${order.orderNo} line=${item.lineNo}`,
      orderDomain: true,
    });
    await this.dataSource.transaction(async (runner) => {
      await this.itemRepo.updateFulfillment(runner, item.id, {
        fulfillmentStatus: 'PENDING',
        reservationId: null,
        warehouseId: null,
      });
    });
    const orderErpStatus = await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      `第 ${item.lineNo} 行手工释放库存占用，回到待分配`,
    );
    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: 'RELEASE_RESERVATION',
      changes: {
        fulfillmentStatus: { from: 'RESERVED', to: 'PENDING' },
        reservationId: { from: reservationId, to: null },
        orderItemId: { from: null, to: item.id },
        lineNo: { from: null, to: item.lineNo },
      },
      operator,
    });
    return {
      orderItemId: item.id,
      orderId: order.id,
      fulfillmentStatus: 'PENDING',
      orderErpStatus,
      releasedReservationId: reservationId,
    };
  }

  // --------------------------------------------------------------------------
  // Cancellation (task §52-§55/§79-§81)
  // --------------------------------------------------------------------------

  async cancel(
    orderId: string,
    operator: OperatorContext,
    reason?: string,
  ): Promise<{ orderId: string; erpStatus: string; releasedItems: number; interceptions: number }> {
    const order = await this.getOrderOrThrow(orderId);
    if (order.erpStatus === 'CANCELLED') {
      return { orderId, erpStatus: 'CANCELLED', releasedItems: 0, interceptions: 0 };
    }
    const items = await this.itemRepo.findByOrderId(order.id);

    // 拣货中取消（2026-11-03 用户确认口径）：**已拣的全部进拦截、剩余不再拣**。
    // 此前只要有扫码进度就整单拒绝取消，平台取消后拣货员继续把剩下的拣完再做
    // 拦截——大量无效劳动。现在由拣货域按行撤出：未拣/部分拣行置 CANCELLED 并
    // 释放未拣余量，已拣行返回给这里生成拦截。
    const pickingOutcome = await this.pickingState.cancelOrderItemsForOrder(
      order.id,
      operator,
      reason ?? '订单取消',
    );
    const handledByPicking = new Set(pickingOutcome.handledOrderItemIds);
    const pickedByItem = new Map(
      pickingOutcome.pickedRows.map((row) => [row.orderItemId, row.pickedQty]),
    );

    let released = 0;
    let interceptionNos = 0;
    for (const item of items) {
      if (item.fulfillmentStatus === 'RELEASED' || item.fulfillmentStatus === 'SHIPPED') {
        // SHIPPED goods have left the warehouse: in-warehouse interception is
        // forbidden (Sprint 4 task §45) - the line stays SHIPPED and any
        // recovery belongs to the future Return / Logistics flow.
        continue;
      }
      // 本地跟随最新的行状态：拣了部分就被取消的行会被改成 PICKED，后面的
      // 分流必须按「已拣」走拦截，不能还按内存里的旧 RESERVED 去释放。
      let fulfillmentStatus = item.fulfillmentStatus;
      const partiallyPickedQty = pickedByItem.get(item.id) ?? null;
      if (partiallyPickedQty !== null && fulfillmentStatus !== 'PICKED') {
        // 拣了一半就被取消：行转 PICKED（事实是「已拣这些」），拦截数量由预约
        // 里真实的 picked_qty 决定（itemFacts），不会用订购数量充数。
        await this.dataSource.transaction(async (manager) => {
          await this.itemRepo.updateFulfillment(manager, item.id, {
            fulfillmentStatus: 'PICKED',
          });
        });
        fulfillmentStatus = 'PICKED';
      }
      if (fulfillmentStatus === 'RESERVED' && handledByPicking.has(item.id)) {
        // 拣货域已释放该行预约（整笔或余量），这里只同步行状态。
        await this.setItemReleased(item);
        released += 1;
        continue;
      }
      if (fulfillmentStatus === 'RESERVED' && item.reservationId !== null) {
        await this.reservationService.releaseReservation(item.reservationId, {
          operator,
          idempotencyKey: orderReleaseKey(item.id),
          remark: `cancel order=${order.orderNo}${reason ? `; ${reason}` : ''}`,
          // 订单域入口标志（2026-10-15）：ORDER 来源预约的裸 release 被库存层
          // 拒绝，只有订单自身的取消链路可释放，并同步行状态 + rollup。
          orderDomain: true,
        });
        await this.setItemReleased(item);
        released += 1;
      } else if (fulfillmentStatus === 'PICKED') {
        // NEVER unpick / release / restore availability (task §55/§81) - the
        // interception module owns finding the physical unit and returning it.
        await this.interceptionPort.createForCancelledPickedItem({
          orderId: order.id,
          storeId: order.storeId,
          orderNo: order.orderNo,
          orderItemId: item.id,
          warehouseId: item.warehouseId as string,
          // 任务原因要说明「为什么需要拦截」；订单取消原因另在订单状态历史里，
          // 直接搬过来会让人以为拦截任务本身是因为平台改状态而创建的。
          reason:
            reason === undefined || reason === ''
              ? `订单 ${order.orderNo} 取消时该行已拣货，需要拦截找回实体商品`
              : `订单 ${order.orderNo} 取消（${reason}）；该行已拣货，需要拦截找回实体商品`,
        });
        interceptionNos += 1;
      } else {
        // BACKORDERED / PENDING / mapping-FAILED: no stock was ever locked
        // (task §54) - go straight to the cancelled terminal state.
        await this.setItemReleased(item);
        released += 1;
      }
    }

    await this.statusService.transition(orderId, 'CANCELLED', operator, reason ?? '订单取消');
    // 拣货中取消的仓库通知（2026-11-03）：撤出了哪些未拣行、多少已拣待拦截。
    // 通知失败绝不影响取消本身（publishEvent 内部已兜底，这里再包一层取店铺信息）。
    if (pickingOutcome.cancelledRows > 0 || pickingOutcome.pickedRows.length > 0) {
      try {
        const store = await this.storeService.getEntityById(order.storeId);
        const pickedTotal = pickingOutcome.pickedRows.reduce(
          (sum, row) => sum + parseQty(row.pickedQty),
          0n,
        );
        await this.notification.notifyPickingOrderCancelled({
          storeId: order.storeId,
          storeCode: store?.storeCode ?? order.storeId,
          storeName: store?.name ?? null,
          orderId: order.id,
          orderNo: order.orderNo,
          cancelledRows: pickingOutcome.cancelledRows,
          cancelledQty: pickingOutcome.cancelledQty,
          pickedQty: formatQty(pickedTotal),
        });
      } catch (error: unknown) {
        this.logger.warn(
          `picking cancel notification failed order=${order.orderNo}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'OrderService',
        );
      }
    }
    // A cancelled order will never ship: its deadline alert (if any) is done,
    // and the out-of-stock exceptions of its never-reserved lines are moot -
    // a platform-cancelled BACKORDERED order must not keep nagging for stock
    // that will never be purchased for it (Sprint 9 T1, orders.md §8).
    await this.resolveDeadlineException(order.id);
    await this.resolveClosedLineExceptions(items);
    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: 'CANCEL',
      changes: {
        erpStatus: { from: order.erpStatus, to: 'CANCELLED' },
        releasedItems: { from: null, to: released },
        interceptions: { from: null, to: interceptionNos },
      },
      operator,
    });
    return {
      orderId,
      erpStatus: 'CANCELLED',
      releasedItems: released,
      interceptions: interceptionNos,
    };
  }

  // --------------------------------------------------------------------------
  // Platform fact updates for already-ingested orders (Sprint 9 T1)
  // --------------------------------------------------------------------------

  /**
   * Fallback re-read rotation candidates for ORDER_SYNC (dual-axis T2):
   * orders whose PLATFORM stage is non-terminal and whose last confirmed
   * facts check is older than the fallback window. Selection no longer
   * consults erp_status - see the repository for the full rationale.
   */
  async listPlatformRefreshCandidates(
    storeId: string,
    options: {
      limit: number;
      hours: { awaitingShipment: number; inTransit: number; delivered: number };
    },
  ): Promise<Array<{ id: string; platformOrderId: string }>> {
    return this.orderRepo.listPlatformRefreshCandidates(storeId, options);
  }

  /**
   * Compare-and-update the platform FACTS of an already-ingested order and
   * propagate consequences (Sprint 9 T1, orders.md §7a):
   *
   * - only platform status / deadline / raw data / stage / channel facts are written -
   *   NEVER erp_status directly (AGENTS.md §38);
   * - a platform_status transition appends platform_status_history;
   * - platform cancellation runs the EXISTING cancel() chain (Reserved ->
   *   release, Picked -> interception, BACKORDERED -> plain close);
   * - the deadline exception is re-evaluated on every encounter (time
   *   passes even when no fact changed);
   * - a platform-shipped stage (IN_TRANSIT / DELIVERED) converges the order
   *   through OrderPlatformShippedService on every encounter (2026-10-14:
   *   factually shipped orders are never blocked by out-of-stock; only
   *   unmapped exceptions may still block);
   * - unchanged facts write NOTHING (idempotent re-sync).
   */
  /**
   * 外部履约 → 内部履约时把行放回待处理（2026-10-24）。
   * 只处理「没有占用、仍是 EXTERNAL_FULFILLED」的行；已发货/已释放的不碰。
   */
  private async requeueExternallyFulfilledLines(
    order: OrderEntity,
    operator: OperatorContext,
  ): Promise<void> {
    const items = await this.itemRepo.findByOrderId(order.id);
    const target = items.filter(
      (item) => item.fulfillmentStatus === 'EXTERNAL_FULFILLED' && item.reservationId === null,
    );
    if (target.length === 0) {
      return;
    }
    await this.dataSource.transaction(async (runner) => {
      for (const item of target) {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'PENDING',
        });
      }
      await this.exceptionService.createInTx(runner, {
        exceptionType: 'ORDER_INVALID_STATE',
        severity: 'MEDIUM',
        referenceType: 'ORDER',
        referenceId: order.id,
        storeId: order.storeId,
        message: `订单 ${order.orderNo} 的履约方式由外部履约改为内部履约，${target.length} 行已重置为待处理，请重新分配库存`,
        details: {
          orderNo: order.orderNo,
          from: 'EXTERNAL_FULFILLED',
          to: 'PENDING',
          resetLines: target.length,
        },
      });
    });
    await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      '履约方式改为内部履约：行重置为待处理',
    );
  }

  async applySyncedPlatformFacts(
    input: OrderPlatformFactsInput,
    operator: OperatorContext,
  ): Promise<OrderPlatformFactsResult> {
    const order = await this.orderRepo.findByStoreAndPlatformOrder(
      input.storeId,
      input.platformOrderId,
    );
    if (order === null) {
      // Concurrent window pass just created it, or it was deleted - nothing
      // to update; the next encounter handles it.
      return {
        applied: false,
        changed: false,
        cancelled: false,
        trackingNumberAssigned: false,
        platformTrackingNo: null,
      };
    }

    const oldStatus = order.platformStatus ?? null;
    const newStatus = input.platformStatus ?? null;
    // NULL input must never count as a change: historical rows whose
    // platform_status IS NULL keep their value until the platform actually
    // delivers one (planning §1.3 point 4).
    const statusChanged = newStatus !== null && newStatus !== oldStatus;
    // Stage facts (dual-axis T1): same null-keeps-stored rule. The stage is
    // rewritten ONLY on a real transition; its anchor takes the mapper's
    // platform timestamp and falls back to NOW when the platform omitted it
    // (docs §2.4) - never the other way around.
    const newStage = input.platformStage ?? null;
    const stageChanged = newStage !== null && newStage !== order.platformStage;
    // Missing platform facts must never erase a previously observed channel.
    const newFulfillmentMode = input.fulfillmentMode ?? null;
    const fulfillmentModeChanged =
      newFulfillmentMode !== null && newFulfillmentMode !== order.fulfillmentMode;
    const newDeadline = toInstantOrNull(input.shipmentDeadline);
    const deadlineChanged = !sameInstant(newDeadline, order.shipmentDeadline ?? null);
    // Platform waybill number (2026-09-18): same null-keeps-stored rule as the
    // other facts - the platform only assigns it once, and later re-reads that
    // omit it must not erase it.
    const newTrackingNo = input.platformTrackingNo ?? null;
    const trackingNoChanged = newTrackingNo !== null && newTrackingNo !== order.platformTrackingNo;
    // Key-order-insensitive comparison: PG jsonb normalizes key order on the
    // round-trip, so a naive JSON.stringify diff would flag EVERY re-sync as
    // changed and break the zero-write idempotency rule.
    const rawChanged =
      input.preserveRawData !== true &&
      canonicalJson(input.rawData ?? null) !== canonicalJson(order.rawData ?? null);

    let cancelled = false;
    if (
      statusChanged ||
      deadlineChanged ||
      rawChanged ||
      stageChanged ||
      fulfillmentModeChanged ||
      trackingNoChanged
    ) {
      const effectiveDeadline = newDeadline ?? order.shipmentDeadline ?? null;
      const effectiveRawData = input.rawData ?? order.rawData ?? null;
      await this.dataSource.transaction(async (runner) => {
        await this.orderRepo.updatePlatformFacts(runner, order.id, {
          platformStatus: newStatus ?? oldStatus,
          shipmentDeadline: effectiveDeadline,
          ...(input.preserveRawData === true ? {} : { rawData: effectiveRawData }),
          ...(fulfillmentModeChanged ? { fulfillmentMode: newFulfillmentMode } : {}),
          ...(trackingNoChanged ? { platformTrackingNo: newTrackingNo } : {}),
          ...(stageChanged
            ? {
                platformStage: newStage,
                platformStageChangedAt: toInstantOrNull(input.platformStageChangedAt),
              }
            : {}),
        });
        if (statusChanged) {
          await this.platformStatusHistoryRepo.insert(runner, {
            orderId: order.id,
            fromStatus: oldStatus,
            toStatus: newStatus,
            source: input.source,
            operatorName: operator.username,
            // Platform-side transition time (docs §2.4): the webhook event's
            // changed_state_date wins, then the mapper's stage anchor; NULL
            // falls back to the row's created_at (our observation time).
            platformChangedAt:
              toInstantOrNull(input.platformChangedAt ?? null) ??
              toInstantOrNull(input.platformStageChangedAt),
          });
        }
      });
    }

    // 履约方式由外部（平台仓）改为内部（卖家仓）——2026-10-24 兜底：
    // 此前只改订单头，行仍是 EXTERNAL_FULFILLED，订单卡在 NEW 且两边都不展示
    // （实证 3 张）。行必须回到 PENDING 才能重新分配；同时留一条可见异常，
    // 不让状态在没有提示的情况下改变。
    if (
      fulfillmentModeChanged &&
      isExternalFulfillmentMode(order.fulfillmentMode) &&
      !isExternalFulfillmentMode(newFulfillmentMode)
    ) {
      await this.requeueExternallyFulfilledLines(order, operator);
    }

    // Platform cancellation -> the existing cancel chain (decision 1-D1b=A).
    // Repeated cancelled re-syncs hit cancel()'s idempotent early return and
    // the reservation release's ORDER_RELEASE:<orderItemId> idempotency key.
    if (input.platformCancelled && order.erpStatus !== 'CANCELLED') {
      // Dual-axis T4: goods that already LEFT the warehouse cannot be
      // recovered in-house - flag the shipped-line cancellation for the
      // return/refund follow-up BEFORE the cancel chain closes the rest.
      await this.flagCancelledAfterShip(order, input);
      await this.cancel(
        order.id,
        operator,
        `平台状态更新为 cancelled，自动取消（平台单号 ${input.platformOrderId}）`,
      );
      cancelled = true;
    } else {
      // 平台已事实发货（用户指示 2026-10-14）：归一化阶段进入
      // IN_TRANSIT / DELIVERED（OZON delivering / delivered）即货物在平台
      // 侧已经发走——与履约模式无关（外部履约同样如此，2026-09-17 起）。
      // 内部「预发货」状态与现实矛盾：缺货行转外部履约完成、关闭缺货 /
      // 时限异常；除未映射异常外不阻塞——无未映射行时订单随平台事实转
      // SHIPPED（收敛逻辑见 OrderPlatformShippedService）。阶段取
      // 「本次事实 ?? 库内阶段」：回读载荷缺 stage 时不得推翻已事实发货。
      const effectiveStage = newStage ?? order.platformStage;
      if (isPlatformShippedStage(effectiveStage)) {
        await this.platformShipped.apply(
          order,
          operator,
          `平台已事实发货（stage ${effectiveStage}${
            isExternalFulfillmentMode(newFulfillmentMode ?? order.fulfillmentMode)
              ? `，外部履约 ${newFulfillmentMode ?? order.fulfillmentMode}`
              : ''
          }）：内部缺货/时限状态与现实矛盾，按平台事实关闭`,
        );
      } else if (!isExternalFulfillmentMode(newFulfillmentMode ?? order.fulfillmentMode)) {
        // Time-based re-evaluation even when nothing changed (deadline was
        // far at ingest, now < 24h). No-op writes when the OPEN state is
        // correct. 外部履约订单不评估发货时限（平台负责发货，时限不构成
        // 内部作业压力）。
        await this.deadlineExceptionService.evaluate({
          id: order.id,
          orderNo: order.orderNo,
          storeId: order.storeId,
          shipmentDeadline: newDeadline ?? order.shipmentDeadline ?? null,
        });
      }
    }
    // Stall re-evaluation on EVERY encounter (dual-axis T4, orders.md §16A):
    // a stalled order is precisely one where nothing changed, so gating on
    // change would never catch it. The effective anchor mirrors the write
    // semantics above: a fresh stage transition takes the mapper's platform
    // timestamp (falling back to NOW); an unchanged stage keeps the stored
    // anchor.
    const effectiveStageAnchor = stageChanged
      ? (toInstantOrNull(input.platformStageChangedAt) ?? new Date())
      : order.platformStageChangedAt;
    await this.stallService.evaluate({
      id: order.id,
      orderNo: order.orderNo,
      storeId: order.storeId,
      platformStage: newStage ?? order.platformStage,
      platformStageChangedAt: effectiveStageAnchor,
    });
    // Rotation cursor (dual-axis T2): every CONFIRMED re-read advances the
    // slot, changed or not - that is what makes the fallback pass fair.
    await this.dataSource.transaction(async (runner) => {
      await this.orderRepo.markPlatformFactsChecked(runner, order.id);
    });
    return {
      applied: true,
      changed:
        statusChanged || deadlineChanged || rawChanged || stageChanged || fulfillmentModeChanged,
      cancelled,
      // 平台首次给出运单号：调用方据此补一次面单预取（2026-10-21，A 方案）。
      trackingNumberAssigned: trackingNoChanged && newTrackingNo !== null,
      // 有效值（null-keeps-stored）：调用方据此回填发货单。
      platformTrackingNo: newTrackingNo ?? order.platformTrackingNo ?? null,
    };
  }

  /**
   * 这批订单在订单列表当前排序下的顺序（2026-10-19 批量打印面单：装订顺序
   * 与列表一致）。只返回存在的订单；调用方补上查不到的 id 以便逐笔报错。
   */
  async findIdsInListOrder(
    ids: readonly string[],
    sortBy: OrderListSortField | undefined,
    sortOrder: 'asc' | 'desc' | undefined,
  ): Promise<string[]> {
    return this.orderRepo.findIdsInListOrder(ids, sortBy, sortOrder);
  }

  /**
   * 标记面单已打印（用户指示 2026-10-19）：人工确认后置位，幂等——只对尚未
   * 打印的订单生效，重复确认不会刷新时间也不会重复写审计。
   * 不是 ERP 状态（AGENTS.md §38），只用于「已打印」胶囊与「已打单」筛选。
   */
  async markLabelPrinted(
    ids: readonly string[],
    operator: OperatorContext,
  ): Promise<{ total: number; updated: number; orderIds: string[] }> {
    const unique = [...new Set(ids)];
    const marked = await this.orderRepo.markLabelPrinted(unique, new Date());
    for (const row of marked) {
      await this.operationLog.record({
        entityType: 'ORDER',
        entityId: row.id,
        entityCode: row.orderNo,
        action: 'MARK_LABEL_PRINTED',
        changes: { labelPrintedAt: { from: null, to: new Date().toISOString() } },
        operator,
      });
    }
    return { total: unique.length, updated: marked.length, orderIds: marked.map((r) => r.id) };
  }

  // --------------------------------------------------------------------------
  // Urgent marking (用户指示 2026-10-16, ADR 0022)
  // --------------------------------------------------------------------------

  /**
   * 标记 / 取消加急（用户指示 2026-10-16，ADR 0022）。
   *
   * 加急只是订单的业务标注：置顶展示 + 缺货到货后优先参与库存分配排序，
   * NOT an ERP status（AGENTS.md §38）——不写 erp_status / 不写状态历史，
   * 只落 is_urgent + urgent_marked_at 与操作日志（AGENTS §39 可追溯）。
   *
   * 终态限制：SHIPPED / CANCELLED 订单不可加急（加急对已完结订单无意义，
   * 且它们不再参与分配）。已在目标状态时幂等返回，不重复写日志。
   */
  async setUrgent(
    orderId: string,
    urgent: boolean,
    operator: OperatorContext,
  ): Promise<{ orderId: string; orderNo: string; isUrgent: boolean }> {
    const order = await this.getOrderOrThrow(orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，不能标记加急', { orderId });
    }
    if (order.erpStatus === 'SHIPPED') {
      throw new OrderInvalidStateError('订单已发货，不能标记加急', { orderId });
    }
    if (order.isUrgent === urgent) {
      // 幂等：重复标记同一状态是 no-op（不重复写操作日志）。
      return { orderId: order.id, orderNo: order.orderNo, isUrgent: order.isUrgent };
    }
    const markedAt = urgent ? new Date() : order.urgentMarkedAt;
    await this.orderRepo.setUrgent(order.id, urgent, markedAt);
    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: urgent ? 'MARK_URGENT' : 'UNMARK_URGENT',
      changes: { isUrgent: { from: order.isUrgent, to: urgent } },
      operator,
    });
    return { orderId: order.id, orderNo: order.orderNo, isUrgent: urgent };
  }

  /**
   * 记录平台运单号（2026-10-22）。WB 的运单号只能从面单响应拿到（`parcelId`），
   * 订单列表/统计接口都不返回，所以不走 applySyncedPlatformFacts——那条路径
   * 需要整组平台事实，会顺带重算时限与异常。这里只补运单号，已有值不覆盖。
   */
  async recordPlatformTrackingNo(
    orderId: string,
    trackingNumber: string,
    operator: OperatorContext,
  ): Promise<boolean> {
    const trimmed = trackingNumber.trim();
    if (trimmed === '') {
      return false;
    }
    const order = await this.getOrderOrThrow(orderId);
    if (order.platformTrackingNo !== null) {
      return false;
    }
    const written = await this.orderRepo.setPlatformTrackingNoIfMissing(order.id, trimmed);
    if (!written) {
      return false;
    }
    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: 'SYNC_PLATFORM_TRACKING',
      changes: { platformTrackingNo: { from: null, to: trimmed } },
      operator,
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // External fulfillment close-out (Sprint 9 T6)
  // --------------------------------------------------------------------------

  /**
   * Marks an order as fulfilled OUTSIDE WCIES (Sprint 9 T6, decision 6 = A):
   * the goods never entered our warehouses, so no inventory transaction is
   * produced (AGENTS.md §14). Close-out = lines to RELEASED + order to
   * SHIPPED (no new ERP state, orders.md §8A) + reason/operator recorded +
   * the order's out-of-stock / deadline exceptions closed.
   *
   * Lines holding stock (RESERVED / PICKED) reject the action - releasing a
   * reservation or unpicking IS inventory movement and belongs to cancel()
   * / interception, not to this marker.
   */
  async markExternalFulfillment(
    orderId: string,
    operator: OperatorContext,
    reason: string,
  ): Promise<{ orderId: string; erpStatus: string; releasedItems: number }> {
    const order = await this.getOrderOrThrow(orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，无需标记外部履约', { orderId });
    }
    if (order.erpStatus === 'SHIPPED') {
      throw new OrderInvalidStateError('订单已发货，无需标记外部履约', { orderId });
    }
    const items = await this.itemRepo.findByOrderId(order.id);
    // 已拣货的行不能自动释放（2026-10-23）：货已经从货架取出，释放库存会让账面
    // 与实际不符（AGENTS §16/§42 的 Picked ≠ Reserved 原则）。这类单必须先走
    // 拦截/退回，再标记外部履约。
    const picked = items.filter((item) => item.fulfillmentStatus === 'PICKED');
    if (picked.length > 0) {
      throw new OrderInvalidStateError('订单存在已拣货的行，需先走拦截/退回库存再标记外部履约', {
        orderId,
        blockingLineNos: picked.map((item) => item.lineNo),
      });
    }

    // 已占用（RESERVED）的行是标记流程的一部分：先释放占用再关账
    // （2026-10-23 用户需求）。释放走订单域入口，行状态与 rollup 同步。
    const reserved = items.filter(
      (item) => item.fulfillmentStatus === 'RESERVED' && item.reservationId !== null,
    );
    for (const item of reserved) {
      await this.reservationService.releaseReservation(item.reservationId as string, {
        operator,
        idempotencyKey: orderReleaseKey(item.id),
        remark: `mark external fulfillment order=${order.orderNo}`,
        orderDomain: true,
      });
    }

    let released = 0;
    for (const item of items) {
      if (item.fulfillmentStatus === 'SHIPPED' || item.fulfillmentStatus === 'RELEASED') {
        continue;
      }
      await this.setItemReleased(item);
      released += 1;
    }

    const trimmedReason = reason.trim().slice(0, 450);
    await this.statusService.transition(
      orderId,
      'SHIPPED',
      operator,
      `标记外部履约：${trimmedReason}`,
    );
    await this.orderRepo.setExternalFulfillmentMark(orderId, new Date(), trimmedReason);
    await this.resolveDeadlineException(orderId);
    await this.resolveClosedLineExceptions(items);
    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: 'MARK_EXTERNAL_FULFILLMENT',
      changes: {
        erpStatus: { from: order.erpStatus, to: 'SHIPPED' },
        reason: { from: null, to: trimmedReason },
        releasedItems: { from: null, to: released },
      },
      operator,
    });
    return { orderId, erpStatus: 'SHIPPED', releasedItems: released };
  }

  /**
   * 取消外部履约标记（2026-10-23 用户需求）。
   *
   * 标记只是账面上把订单关账为 SHIPPED；平台侧可能还没真正发货。此时允许撤销：
   * 把标记写下的 RELEASED 行回到 PENDING（可重新分配），清掉标记，重算状态。
   *
   * 允许条件：本单确实被标记过；平台尚未开始运输（platform_stage 不是
   * IN_TRANSIT/DELIVERED）。平台已发货/已签收的单不回退——那已经是既成事实。
   */
  async cancelExternalFulfillment(
    orderId: string,
    operator: OperatorContext,
    reason?: string,
  ): Promise<{ orderId: string; orderNo: string; erpStatus: string; restoredItems: number }> {
    const order = await this.getOrderOrThrow(orderId);
    if (order.externalFulfilledAt === null) {
      throw new OrderInvalidStateError('该订单没有外部履约标记，无法取消', { orderId });
    }
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，无需取消外部履约标记', { orderId });
    }
    if (order.platformStage === 'IN_TRANSIT' || order.platformStage === 'DELIVERED') {
      throw new OrderInvalidStateError('平台已发货/已签收，不能取消外部履约标记（货已离开）', {
        orderId,
        platformStage: order.platformStage,
      });
    }

    const items = await this.itemRepo.findByOrderId(order.id);
    let restored = 0;
    for (const item of items) {
      if (item.fulfillmentStatus !== 'RELEASED') {
        continue; // SHIPPED 行是既成事实，不动
      }
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'PENDING',
          reservationId: null,
        });
      });
      restored += 1;
    }

    await this.orderRepo.setExternalFulfillmentMark(order.id, null, null);
    await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      `取消外部履约标记${reason === undefined || reason.trim() === '' ? '' : `：${reason.trim()}`}`,
    );
    const updated = await this.getOrderOrThrow(order.id);
    await this.operationLog.record({
      entityType: 'ORDER',
      entityId: order.id,
      entityCode: order.orderNo,
      action: 'CANCEL_EXTERNAL_FULFILLMENT',
      changes: {
        erpStatus: { from: order.erpStatus, to: updated.erpStatus },
        restoredItems: { from: null, to: restored },
        reason: { from: order.externalFulfillmentReason, to: null },
      },
      operator,
    });
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      erpStatus: updated.erpStatus,
      restoredItems: restored,
    };
  }

  /**
   * 批量标记外部履约（订单页多选, 2026-10-14）：逐单复用
   * markExternalFulfillment 的全部校验与关账逻辑（同一 reason 记入每单的
   * 状态历史与操作日志），单笔失败（域错误，如订单已发货 / 存在已占用库存
   * 行）只记录结果、不拖垮整批（AGENTS §36）。不产生任何库存流水——
   * 这正是该动作与批量发货的本质区别。
   */
  async markExternalFulfillmentBatch(
    orderIds: string[],
    reason: string,
    operator: OperatorContext,
  ): Promise<OrderBatchMarkExternalFulfillmentResultDto> {
    const results: OrderBatchMarkExternalFulfillmentItemDto[] = [];
    for (const orderId of new Set(orderIds)) {
      // 预读一次拿 orderNo 供结果标注；订单不可读时它保持 null。
      const order = await this.orderRepo.findById(orderId);
      try {
        const result = await this.markExternalFulfillment(orderId, operator, reason);
        results.push({
          orderId,
          orderNo: order?.orderNo ?? null,
          ok: true,
          code: null,
          message: null,
          erpStatus: result.erpStatus,
          releasedItems: result.releasedItems,
        });
      } catch (error: unknown) {
        results.push({
          orderId,
          orderNo: order?.orderNo ?? null,
          ok: false,
          code:
            error instanceof DomainError ? error.code : 'ORDER_MARK_EXTERNAL_FULFILLMENT_FAILED',
          message: error instanceof Error ? error.message : String(error),
          erpStatus: null,
          releasedItems: null,
        });
      }
    }
    const failed = results.filter((item) => !item.ok).length;
    return { total: results.length, succeeded: results.length - failed, failed, results };
  }

  // --------------------------------------------------------------------------
  // Fulfillment-state callbacks (picking / shipment / interception modules)
  // --------------------------------------------------------------------------

  /** RESERVED items with their reservation, ready for picking-task creation. */
  async listReservedItemsForPicking(
    orderId: string,
  ): Promise<Array<{ item: OrderItemEntity; order: OrderEntity }>> {
    const order = await this.getOrderOrThrow(orderId);
    const items = (await this.itemRepo.findByOrderId(order.id)).filter(
      (item) => item.fulfillmentStatus === 'RESERVED' && item.reservationId !== null,
    );
    return items.map((item) => ({ item, order }));
  }

  /**
   * PICKED items of an order, ready for shipment creation (Sprint 4 task
   * §13): only fully picked lines may enter a shipment; BACKORDERED /
   * RESERVED / mapping-FAILED lines are excluded.
   */
  async listPickedItemsForShipment(orderId: string): Promise<
    Array<{
      orderItemId: string;
      skuId: string;
      warehouseId: string;
      quantity: string;
      reservationId: string;
    }>
  > {
    const order = await this.getOrderOrThrow(orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，不能创建发货单', { orderId: order.id });
    }
    return (await this.itemRepo.findByOrderId(order.id))
      .filter(
        (item) =>
          item.fulfillmentStatus === 'PICKED' &&
          item.skuId !== null &&
          item.warehouseId !== null &&
          item.reservationId !== null,
      )
      .map((item) => ({
        orderItemId: item.id,
        skuId: item.skuId as string,
        warehouseId: item.warehouseId as string,
        quantity: item.quantity,
        reservationId: item.reservationId as string,
      }));
  }

  /** Cross-module read of one line's fulfillment facts (plain DTO shape). */
  async getItemFulfillment(orderItemId: string): Promise<{
    orderId: string;
    orderItemId: string;
    storeId: string;
    skuId: string | null;
    warehouseId: string | null;
    quantity: string;
    fulfillmentStatus: string;
    reservationId: string | null;
  }> {
    const item = await this.itemRepo.findById(orderItemId);
    if (item === null) {
      throw new OrderItemNotFoundError(orderItemId);
    }
    const order = await this.getOrderOrThrow(item.orderId);
    return {
      orderId: item.orderId,
      orderItemId: item.id,
      storeId: order.storeId,
      skuId: item.skuId,
      warehouseId: item.warehouseId,
      quantity: item.quantity,
      fulfillmentStatus: item.fulfillmentStatus,
      reservationId: item.reservationId,
    };
  }

  /**
   * Marks a line PICKED inside the CALLER's transaction (Sprint 4 P0: the
   * picking increment, the inventory pick and this status change commit or
   * roll back together). The order rollup runs AFTER commit.
   */
  /** 订单是否已取消（拣货扫码兜底校验用，2026-11-03）。 */
  async isOrderCancelled(orderId: string): Promise<boolean> {
    const order = await this.orderRepo.findById(orderId);
    return order !== null && order.erpStatus === 'CANCELLED';
  }

  async markItemPickedInTx(manager: EntityManager, orderItemId: string): Promise<void> {
    const item = await this.itemRepo.findByIdTx(manager, orderItemId);
    if (item === null || item.fulfillmentStatus !== 'RESERVED') {
      return;
    }
    await this.itemRepo.updateFulfillment(manager, item.id, { fulfillmentStatus: 'PICKED' });
  }

  /** Post-commit rollup recompute after a picking scan completed a line. */
  async recomputeAfterPick(
    orderItemId: string,
    operator: OperatorContext,
  ): Promise<ErpOrderStatus | null> {
    const item = await this.itemRepo.findById(orderItemId);
    if (item === null) {
      return null;
    }
    return this.statusService.recomputeOrderStatus(item.orderId, operator, '拣货完成');
  }

  /**
   * Marks a line SHIPPED inside the shipment-ship transaction (Sprint 4 task
   * §22-§24); only called when the line's full quantity has actually left
   * stock. The order rollup runs AFTER commit.
   */
  async markItemShippedInTx(manager: EntityManager, orderItemId: string): Promise<void> {
    const item = await this.itemRepo.findByIdTx(manager, orderItemId);
    if (item === null || item.fulfillmentStatus !== 'PICKED') {
      return;
    }
    await this.itemRepo.updateFulfillment(manager, item.id, { fulfillmentStatus: 'SHIPPED' });
  }

  /** Post-commit rollup recompute after a shipment shipped the line. */
  async recomputeAfterShip(orderId: string, operator: OperatorContext): Promise<ErpOrderStatus> {
    const status = await this.statusService.recomputeOrderStatus(orderId, operator, '正式出库完成');
    if (status === 'SHIPPED') {
      // Fully shipped before the platform deadline alert becomes moot.
      await this.resolveDeadlineException(orderId);
    }
    return status;
  }

  /** Closes the OPEN ORDER_SHIPMENT_DEADLINE_NEAR of an order, if present. */
  private async resolveDeadlineException(orderId: string): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      await this.exceptionService.resolveByReferenceInTx(runner, {
        exceptionType: 'ORDER_SHIPMENT_DEADLINE_NEAR',
        referenceType: 'ORDER',
        referenceId: orderId,
      });
    });
  }

  /**
   * Dual-axis T4: a platform cancellation hitting an order that already
   * SHIPPED (at least one SHIPPED line) raises ORDER_CANCELLED_AFTER_SHIP -
   * the shipped lines stay SHIPPED, stock stays moved, and recovery belongs
   * to the return/refund process. Created through the exception center
   * (never bypassed, AGENTS.md §52/§53); (type, reference) OPEN dedup makes
   * repeated cancelled re-syncs a no-op.
   */
  private async flagCancelledAfterShip(
    order: OrderEntity,
    input: OrderPlatformFactsInput,
  ): Promise<void> {
    const items = await this.itemRepo.findByOrderId(order.id);
    const shippedLines = items.filter((item) => item.fulfillmentStatus === 'SHIPPED');
    if (shippedLines.length === 0) {
      return;
    }
    await this.exceptionService.create({
      exceptionType: 'ORDER_CANCELLED_AFTER_SHIP',
      severity: 'HIGH',
      referenceType: 'ORDER',
      referenceId: order.id,
      storeId: order.storeId,
      message: `订单 ${order.orderNo} 已被平台取消，但存在 ${shippedLines.length} 个已发货行（货已出库）——请走退货/退款流程处理，库存不会自动恢复`,
      details: {
        orderNo: order.orderNo,
        platformOrderId: input.platformOrderId,
        shippedLineNos: shippedLines.map((item) => item.lineNo),
      },
    });
  }

  /**
   * Closes the OPEN line-level exceptions that stop mattering once an order
   * will never be fulfilled internally (cancelled / externally fulfilled):
   * ORDER_OUT_OF_STOCK (no one will buy stock for it, Sprint 9 T1/T6) and
   * ORDER_SKU_MAPPING_FAILED (the line is closed, so an unmapped variant is
   * no longer actionable — leaving it open re-raised EXCEPTION on orders that
   * were already shipped externally, 2026-10-20). No-op when none are open.
   */
  private async resolveClosedLineExceptions(items: OrderItemEntity[]): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      for (const item of items) {
        for (const exceptionType of ['ORDER_OUT_OF_STOCK', 'ORDER_SKU_MAPPING_FAILED'] as const) {
          await this.exceptionService.resolveByReferenceInTx(runner, {
            exceptionType,
            referenceType: 'ORDER_ITEM',
            referenceId: item.id,
          });
        }
      }
    });
  }

  /**
   * Marks a line RELEASED inside the interception return-to-stock transaction
   * (Sprint 4 task §37): the goods are physically back in a bin, so the line
   * reaches the cancelled terminal state together with the stock patch.
   */
  async markItemReleasedInTx(manager: EntityManager, orderItemId: string): Promise<void> {
    const item = await this.itemRepo.findByIdTx(manager, orderItemId);
    if (item === null || item.fulfillmentStatus !== 'PICKED') {
      return;
    }
    await this.itemRepo.updateFulfillment(manager, item.id, { fulfillmentStatus: 'RELEASED' });
  }

  /** Post-commit rollup recompute after an interception returned the line. */
  async recomputeAfterInterception(
    orderId: string,
    operator: OperatorContext,
  ): Promise<ErpOrderStatus> {
    return this.statusService.recomputeOrderStatus(orderId, operator, '拦截回库完成');
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  /**
   * Cross-module read (returns T5): resolve an order id by the business key
   * (storeId + platformOrderId). Store-scoped by construction (AGENTS.md
   * §26/§35). Null when the platform order id is unknown in WCIES - callers
   * decide what that means (e.g. RETURN_ORDER_NOT_FOUND).
   */
  async findIdByStoreAndPlatformOrder(
    storeId: string,
    platformOrderId: string,
  ): Promise<string | null> {
    const order = await this.orderRepo.findByStoreAndPlatformOrder(storeId, platformOrderId);
    return order?.id ?? null;
  }

  async getOrderOrThrow(id: string): Promise<OrderEntity> {
    const order = await this.orderRepo.findById(id);
    if (order === null) {
      throw new OrderNotFoundError(id);
    }
    return order;
  }

  /**
   * 关联订单的首个商品图（2026-11-02，买家消息卡片显示主图）。
   *
   * 消息本身常常没有 sku（OZON `context.sku` 多数为空），但会话一旦带上
   * `order_number`，就能从订单行取平台商品图（`order_items.platform_image_url`，
   * 摄入时已落库）。只读、store-scoped；无订单/无图片返回 null。
   */
  async firstItemImageForPlatformOrder(
    storeId: string,
    platformOrderId: string,
  ): Promise<string | null> {
    const orderId = await this.findIdByStoreAndPlatformOrder(storeId, platformOrderId);
    if (orderId === null) {
      return null;
    }
    const items = await this.itemRepo.findByOrderId(orderId);
    for (const item of items) {
      if (item.platformImageUrl !== null && item.platformImageUrl !== '') {
        return item.platformImageUrl;
      }
    }
    return null;
  }

  /**
   * Which order-fulfillment capabilities the store's platform exposes
   * (2026-09-18). Pure capability lookup - no platform call, no platform
   * vocabulary; a platform that has not implemented a capability reports
   * false so the UI hides the action instead of failing at click time
   * (AGENTS.md §88).
   */
  private platformCapabilitiesOf(platformCode: string | null): {
    prepareShipment: boolean;
    fetchShippingLabel: boolean;
  } {
    if (platformCode === null || platformCode === '' || !this.adapterRegistry.has(platformCode)) {
      return { prepareShipment: false, fetchShippingLabel: false };
    }
    const adapter = this.adapterRegistry.getAdapter(platformCode);
    return {
      prepareShipment: typeof adapter.prepareShipment === 'function',
      fetchShippingLabel: typeof adapter.fetchShippingLabel === 'function',
    };
  }

  private async setItemReleased(item: OrderItemEntity): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      await this.itemRepo.updateFulfillment(runner, item.id, { fulfillmentStatus: 'RELEASED' });
    });
  }
}

/** Platform facts delivered by a sync for an already-ingested order (T1). */
export interface OrderPlatformFactsInput {
  storeId: string;
  platformOrderId: string;
  /** Raw platform status string; null = the platform did not deliver one. */
  platformStatus: string | null;
  /** Mapper-derived channel fact; undefined/null keeps the stored value. */
  fulfillmentMode?: string | null;
  /** Mapper-derived flag - platform vocabulary never leaks into core (§31). */
  platformCancelled: boolean;
  /**
   * Normalized platform logistics stage (dual-axis T1); null = unclassified
   * or not delivered - the stored stage is kept.
   */
  platformStage: string | null;
  /** Platform's own timestamp for entering the stage; null = observation now. */
  platformStageChangedAt: Date | string | null;
  /**
   * Webhook-only hint: the event payload's changed_state_date, preferred as
   * the platform-side time on the status-history row (docs §2.4). Null on
   * the re-read paths.
   */
  platformChangedAt?: Date | string | null;
  shipmentDeadline: Date | string | null;
  /**
   * Platform waybill number (OZON `tracking_number`, 2026-09-18). Null /
   * undefined keeps the stored value - a fact set that omits it must never
   * wipe a number already known.
   */
  platformTrackingNo?: string | null;
  rawData: Record<string, unknown> | null;
  /**
   * 报表型数据源（2026-10-24）：只更新事实，绝不覆盖订单的 raw_data——
   * 统计流水不能顶掉作业单的原始数据（数字 id / 装配信息都在里面）。
   */
  preserveRawData?: boolean;
  /** Channel that delivered the facts (ORDER_SYNC / WEBHOOK / ...). */
  source: string;
}

export interface OrderPlatformFactsResult {
  /** False when the order does not exist (race) - nothing was touched. */
  applied: boolean;
  /** True when at least one platform fact column was rewritten. */
  changed: boolean;
  /** True when this call propagated a platform cancellation. */
  cancelled: boolean;
  /**
   * True when the platform waybill number was first observed in this call.
   * Used by the sync layer to schedule the label prefetch (2026-10-21) -
   * platform labels only exist after 组包 assigns a waybill.
   */
  trackingNumberAssigned: boolean;
  /**
   * 本次调用后订单上有效的平台运单号（未观察到变化时为库内已有值）。
   * 供 sync 层把运单号回填到已建的发货单（发货单是快照，不会自愈）。
   */
  platformTrackingNo: string | null;
}

function sameInstant(a: Date | string | null, b: Date | string | null): boolean {
  const left = a === null ? null : new Date(a).getTime();
  const right = b === null ? null : new Date(b).getTime();
  if (left === null || right === null) {
    return left === right;
  }
  return left === right;
}

function toInstantOrNull(value: Date | string | null): Date | null {
  if (value === null) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Stable JSON form: object keys sorted recursively, so two payloads that
 *  differ only in key order (e.g. before/after a PG jsonb round-trip)
 *  compare equal. */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}
