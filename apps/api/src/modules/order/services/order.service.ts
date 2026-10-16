import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { StoreService } from '../../store/services/store.service';
import { SkuImageService } from '../../product/services/sku-image.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRepository, OrderListFilters } from '../repositories/order.repository';
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
      // 待采购 view (purchase.md §3.5): orders with a MAPPED BACKORDERED line
      // that no live purchase order covers. The purchase module supplies the
      // covered line ids through its port; this repo owns the line facts.
      const activeOrderItemIds = await this.procurementPort.listActiveOrderItemIds();
      const orderIds =
        await this.orderRepo.findOrderIdsWithUncoveredBackorderedLines(activeOrderItemIds);
      effectiveFilters = { ...filters, orderIds };
    }
    const { rows, total } = await this.orderRepo.listWithAggregates(
      effectiveFilters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    // Dual-axis §2.3 in-line markers: for the page's BACKORDERED lines, the
    // derived procurement states (purchase.md §3.5) come through the port -
    // one round-trip for the whole page, never per-line queries and never a
    // cross-module SQL (AGENTS.md §9).
    const backorderedIdsByOrder = await this.orderRepo.findBackorderedItemIdsByOrderIds(
      rows.map((row) => row.order.id),
    );
    const allBackorderedIds = [...backorderedIdsByOrder.values()].flat();
    const procurementStates =
      await this.procurementPort.getProcurementStatesByOrderItemIds(allBackorderedIds);
    const items: OrderListItemDto[] = rows.map((row) => {
      let ordered = 0;
      let arrived = 0;
      for (const itemId of backorderedIdsByOrder.get(row.order.id) ?? []) {
        const state = procurementStates[itemId];
        if (state === 'ORDERED') {
          ordered += 1;
        } else if (state === 'ARRIVED') {
          arrived += 1;
        }
      }
      return {
        id: row.order.id,
        orderNo: row.order.orderNo,
        storeId: row.order.storeId,
        storeName: row.storeName,
        platformCode: row.platformCode,
        platformOrderId: row.order.platformOrderId,
        platformStatus: row.order.platformStatus,
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
        backorderedOrderedCount: ordered,
        backorderedArrivedCount: arrived,
      };
    });
    return { items, meta: { page: page.page, pageSize: page.pageSize, total } };
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
          // Derived procurement state (purchase.md §3.5) - NULL for unmapped
          // lines where procurement is meaningless.
          procurementState: null as string | null,
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

    // One port round-trip for the whole order keeps the derived procurement
    // states consistent and avoids per-line queries (purchase.md §3.5).
    const mappedItemIds = items
      .filter(({ item }) => item.skuId !== null)
      .map(({ item }) => item.id);
    const procurementStates =
      await this.procurementPort.getProcurementStatesByOrderItemIds(mappedItemIds);
    for (const dto of itemDtos) {
      dto.procurementState = procurementStates[dto.id] ?? null;
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
      platformCode: store?.platformCode ?? '',
      platformOrderId: order.platformOrderId,
      platformStatus: order.platformStatus,
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

    // Block cancel while any picking item already moved stock (orders.md §8).
    if (await this.pickingState.hasPickedProgress(order.id)) {
      await this.exceptionService.create({
        exceptionType: 'ORDER_INVALID_STATE',
        severity: 'HIGH',
        referenceType: 'ORDER',
        referenceId: order.id,
        storeId: order.storeId,
        message: `订单 ${order.orderNo} 拣货进行中（已产生拣货库存移动），取消被拒绝`,
        details: { orderNo: order.orderNo },
      });
      throw new OrderInvalidStateError('订单拣货进行中，需先完成或取消拣货任务', {
        orderId: order.id,
      });
    }
    await this.pickingState.cancelZeroProgressTasksForOrder(orderId, operator);

    let released = 0;
    let interceptionNos = 0;
    for (const item of items) {
      if (item.fulfillmentStatus === 'RELEASED' || item.fulfillmentStatus === 'SHIPPED') {
        // SHIPPED goods have left the warehouse: in-warehouse interception is
        // forbidden (Sprint 4 task §45) - the line stays SHIPPED and any
        // recovery belongs to the future Return / Logistics flow.
        continue;
      }
      if (item.fulfillmentStatus === 'RESERVED' && item.reservationId !== null) {
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
      } else if (item.fulfillmentStatus === 'PICKED') {
        // NEVER unpick / release / restore availability (task §55/§81) - the
        // interception module owns finding the physical unit and returning it.
        await this.interceptionPort.createForCancelledPickedItem({
          orderId: order.id,
          orderNo: order.orderNo,
          orderItemId: item.id,
          warehouseId: item.warehouseId as string,
          reason,
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
    // A cancelled order will never ship: its deadline alert (if any) is done,
    // and the out-of-stock exceptions of its never-reserved lines are moot -
    // a platform-cancelled BACKORDERED order must not keep nagging for stock
    // that will never be purchased for it (Sprint 9 T1, orders.md §8).
    await this.resolveDeadlineException(order.id);
    await this.resolveStockExceptions(items);
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
    options: { limit: number; fallbackHours: number },
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
      return { applied: false, changed: false, cancelled: false };
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
          rawData: effectiveRawData,
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
    };
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
    const blocking = items.filter(
      (item) => item.fulfillmentStatus === 'RESERVED' || item.fulfillmentStatus === 'PICKED',
    );
    if (blocking.length > 0) {
      throw new OrderInvalidStateError(
        '订单存在已占用库存的行（RESERVED / PICKED），请走取消订单流程释放或拦截库存，不能标记外部履约',
        {
          orderId,
          blockingLineNos: blocking.map((item) => item.lineNo),
        },
      );
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
    await this.resolveDeadlineException(orderId);
    await this.resolveStockExceptions(items);
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
   * Closes the OPEN ORDER_OUT_OF_STOCK exceptions of the given lines: an
   * order that will never ship (cancelled / externally fulfilled) must stop
   * asking for stock (Sprint 9 T1/T6). No-op when none are open.
   */
  private async resolveStockExceptions(items: OrderItemEntity[]): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      for (const item of items) {
        await this.exceptionService.resolveByReferenceInTx(runner, {
          exceptionType: 'ORDER_OUT_OF_STOCK',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
        });
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
