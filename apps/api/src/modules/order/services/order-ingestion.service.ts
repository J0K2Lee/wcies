import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
import { formatAmount, mulAmountByQty, parseAmount } from '../../../common/utils/money';
import { StoreService } from '../../store/services/store.service';
import { StoreNotFoundError } from '../../store/errors/store-errors';
import { ListingResolverService } from '../../listing/services/listing-resolver.service';
import {
  ListingSkuResolveAmbiguousError,
  ListingSkuResolveFailedError,
} from '../../listing/errors/listing-errors';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InsufficientStockError } from '../../inventory/errors/inventory.errors';
import { ExceptionService } from '../../exception/services/exception.service';
import { WarehousePlatformBindingService } from '../../warehouse/services/warehouse-platform-binding.service';
import { isExternalFulfillmentMode } from '../../platform/constants/platform.constants';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { NormalizedOrderInput } from '../dto/order.dto';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { OrderStatusService } from './order-status.service';
import { OrderDeadlineExceptionService } from './order-deadline-exception.service';
import { OrderPlatformShippedService } from './order-platform-shipped.service';
import { orderReserveKey, isPlatformShippedStage } from '../enums/order.constants';
import { OrderIngestInvalidError } from '../errors/order.errors';

export interface OrderIngestResult {
  orderId: string;
  orderNo: string;
  erpStatus: string;
  /** True when (storeId, platformOrderId) already existed and nothing was recreated. */
  alreadyIngested: boolean;
  itemResults: Array<{
    orderItemId: string;
    lineNo: number;
    mappingStatus: string;
    fulfillmentStatus: string;
    skuId: string | null;
    reservationId: string | null;
  }>;
}

/**
 * Normalized order ingestion (Sprint 3 task §11-§24).
 *
 * Accepts the WCIES-standard NormalizedOrderInput - never a platform DTO and
 * never containing OZON/WB/YANDEX branches (task §12). Transaction strategy
 * (task §83, frozen in orders.md §14):
 *
 *   tx A: order + PENDING items + history(null -> NEW)
 *   per item (isolated): resolve -> tx B mapping -> reserveStock (inventory
 *   tx) -> tx C line status + exception
 *   tx E: order rollup status + history
 *
 * Failures map to line-level outcomes (FAILED / BACKORDERED + exception);
 * they never roll the order away.
 */
@Injectable()
export class OrderIngestionService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storeService: StoreService,
    private readonly resolver: ListingResolverService,
    private readonly reservationService: ReservationService,
    private readonly bindingService: WarehousePlatformBindingService,
    private readonly exceptionService: ExceptionService,
    private readonly orderRepo: OrderRepository,
    private readonly itemRepo: OrderItemRepository,
    private readonly historyRepo: OrderStatusHistoryRepository,
    private readonly statusService: OrderStatusService,
    private readonly deadlineExceptionService: OrderDeadlineExceptionService,
    /**
     * 平台已事实发货的收敛（用户指示 2026-10-14）：摄入时 / 映射修复时
     * 平台阶段已 IN_TRANSIT / DELIVERED 的订单，按平台事实关闭内部缺货
     * 状态，除未映射异常外不阻塞。
     */
    private readonly platformShipped: OrderPlatformShippedService,
    private readonly logger: AppLoggerService,
  ) {}

  async ingest(input: NormalizedOrderInput, operator: OperatorContext): Promise<OrderIngestResult> {
    const store = await this.storeService.getEntityById(input.storeId);
    if (store === null) {
      throw new StoreNotFoundError(input.storeId);
    }

    const existing = await this.orderRepo.findByStoreAndPlatformOrder(
      input.storeId,
      input.platformOrderId,
    );
    if (existing !== null) {
      return this.buildResult(existing, true);
    }

    // tx A: the order skeleton always survives (task §18/§68).
    let order: OrderEntity;
    try {
      order = await this.dataSource.transaction(async (runner) => {
        const orderNo = await this.orderRepo.nextOrderNo(runner);
        const created = await this.orderRepo.insertWithItems(
          runner,
          {
            orderNo,
            storeId: input.storeId,
            platformOrderId: input.platformOrderId,
            platformStatus: input.platformStatus ?? null,
            platformStage: input.platformStage ?? null,
            platformStageChangedAt: input.platformStageChangedAt ?? null,
            erpStatus: 'NEW',
            fulfillmentMode: input.fulfillmentMode ?? null,
            currency: input.currency ?? null,
            orderedAt: input.orderedAt,
            shipmentDeadline: input.shipmentDeadline ?? null,
            platformTrackingNo: input.platformTrackingNo ?? null,
            rawData: input.rawData ?? null,
            remark: input.remark ?? null,
            syncSource: input.syncSource ?? 'API',
          },
          input.items.map((item, index) => ({
            lineNo: index + 1,
            platformProductId: item.platformProductId ?? null,
            platformSkuId: item.platformSkuId ?? null,
            sellerSku: item.sellerSku ?? null,
            offerId: item.offerId ?? null,
            quantity: formatQty(parseQty(item.quantity)),
            unitPrice: item.unitPrice ?? null,
            totalPrice: lineTotalPrice(item.unitPrice, item.quantity),
            rawData: item.rawData ?? null,
          })),
        );
        await this.historyRepo.insert(runner, {
          orderId: created.id,
          fromStatus: null,
          toStatus: 'NEW',
          reason: '订单摄入创建',
          operatorId: operator.userId,
          operatorName: operator.username,
        });
        return created;
      });
    } catch (error: unknown) {
      if (isUniqueViolationOnOrders(error)) {
        // Concurrent duplicate ingest: exactly one order wins (task §84).
        const winner = await this.orderRepo.findByStoreAndPlatformOrder(
          input.storeId,
          input.platformOrderId,
        );
        if (winner !== null) {
          this.logger.log(
            `order ingest idempotent replay store=${input.storeId} platformOrderId=${input.platformOrderId} orderId=${winner.id}`,
            'OrderIngestionService',
          );
          return this.buildResult(winner, true);
        }
      }
      throw error;
    }

    // Per-item allocation, isolated failures (task §17/§22).
    const items = await this.itemRepo.findByOrderId(order.id);
    for (const item of items) {
      await this.allocateItem(order, item, operator);
    }

    let erpStatus = await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      '订单摄入完成，按行结果汇总',
    );
    // 平台已事实发货（stage IN_TRANSIT / DELIVERED，用户指示 2026-10-14）：
    // 订单摄入时平台上就已发走——内部缺货/时限状态与现实矛盾，按平台事实
    // 收敛（缺货行已在上方 2a 转外部履约完成）；除未映射异常外不阻塞，
    // 无未映射行时订单随平台事实转 SHIPPED。外部履约订单（FBO/FBP）发货
    // 由平台负责，同样不评估 ORDER_SHIPMENT_DEADLINE_NEAR（用户指示
    // 2026-09-17）。
    if (isPlatformShippedStage(order.platformStage)) {
      const converged = await this.platformShipped.apply(
        order,
        operator,
        `订单摄入时平台已事实发货（${order.platformStage}）：内部缺货/时限状态与现实矛盾，按平台事实关闭`,
      );
      erpStatus = converged.erpStatus;
    } else if (!isExternalFulfillmentMode(order.fulfillmentMode)) {
      await this.deadlineExceptionService.evaluate(order);
    }
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      erpStatus,
      alreadyIngested: false,
      itemResults: (await this.itemRepo.findByOrderId(order.id)).map((item) => ({
        orderItemId: item.id,
        lineNo: item.lineNo,
        mappingStatus: item.mappingStatus,
        fulfillmentStatus: item.fulfillmentStatus,
        skuId: item.skuId,
        reservationId: item.reservationId,
      })),
    };
  }

  /**
   * Store-scoped resolution of one line (task §15-§16). Extracted so the
   * retry path re-resolves a previously FAILED line with the SAME rules
   * instead of trusting a stale mappingStatus.
   */
  private async resolveItemSku(
    order: OrderEntity,
    item: OrderItemEntity,
  ): Promise<
    | { ok: true; skuId: string; listingSkuId: string | null }
    | { ok: false; code: string; details: Record<string, unknown> }
  > {
    try {
      // Decision 0016: offer id is NOT passed - it is editable on the
      // platform, so it can never be the basis of order resolution.
      const resolved = await this.resolver.resolveInternalSku({
        storeId: order.storeId,
        platformSkuId: item.platformSkuId ?? undefined,
        sellerSku: item.sellerSku ?? undefined,
      });
      return { ok: true, skuId: resolved.internalSkuId, listingSkuId: resolved.listingSkuId };
    } catch (error: unknown) {
      if (
        error instanceof ListingSkuResolveFailedError ||
        error instanceof ListingSkuResolveAmbiguousError
      ) {
        return { ok: false, code: error.code, details: error.details };
      }
      throw error;
    }
  }

  /**
   * Maps one line to an internal SKU and reserves stock; every outcome is
   * persisted line-locally (task §17/§19/§22).
   *
   * 平台已事实发货（用户指示 2026-10-14）：订单同步到时平台阶段已是
   * IN_TRANSIT / DELIVERED（OZON delivering / delivered）——货物在平台侧
   * 已经发走，内部不预留、不拣货、不产生缺货异常，行直接进入
   * EXTERNAL_FULFILLED（订单头收敛见 ingest 末尾）。
   *
   * 外部履约（用户指示 2026-09-17）：FBO / FBP 模式的订单行由平台仓库持货
   * 发货——不解析内部仓库、不占用库存、不进入拣货流程，行直接进入
   * EXTERNAL_FULFILLED；业务状态随平台 webhook / 事实同步自动流转（见
   * OrderService.applySyncedPlatformFacts），不阻塞。
   */
  private async allocateItem(
    order: OrderEntity,
    item: OrderItemEntity,
    operator: OperatorContext,
  ): Promise<void> {
    // 1. Store-scoped resolution via the existing resolver (task §15-§16).
    const resolution = await this.resolveItemSku(order, item);
    const resolveFailure = resolution.ok
      ? null
      : { code: resolution.code, details: resolution.details };
    const resolvedSkuId = resolution.ok ? resolution.skuId : null;
    const resolvedListingSkuId = resolution.ok ? resolution.listingSkuId : null;

    if (resolveFailure !== null) {
      // No guessing (task §70): FAILED + exception, other lines continue.
      const failure = resolveFailure;
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateMapping(runner, item.id, { mappingStatus: 'FAILED' });
        await this.exceptionService.createInTx(runner, {
          exceptionType: 'ORDER_SKU_MAPPING_FAILED',
          severity: 'HIGH',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
          storeId: order.storeId,
          message: `订单 ${order.orderNo} 第 ${item.lineNo} 行无法映射 Internal SKU（${failure.code}）`,
          details: {
            ...failure.details,
            orderNo: order.orderNo,
            platformOrderId: order.platformOrderId,
            lineNo: item.lineNo,
            identifiers: {
              platformSkuId: item.platformSkuId,
              sellerSku: item.sellerSku,
              offerId: item.offerId,
            },
          },
        });
      });
      return;
    }

    // 2. Persist the mapping result.
    const skuId = resolvedSkuId as string;
    const listingSkuId = resolvedListingSkuId;
    await this.dataSource.transaction(async (runner) => {
      await this.itemRepo.updateMapping(runner, item.id, {
        mappingStatus: 'MAPPED',
        skuId,
        listingSkuId,
      });
    });

    // 2a. 平台已事实发货（stage IN_TRANSIT / DELIVERED，用户指示
    // 2026-10-14）：同步到的订单在平台上已经发走（OZON delivering /
    // delivered）——内部不预留、不拣货、不产生缺货异常（缺货与现实
    // 矛盾），行直接外部履约完成，语义同 2b：平台侧履约，不占内部库存。
    // 订单头收敛（转 SHIPPED / 保持未映射阻塞）见 ingest 末尾。
    if (isPlatformShippedStage(order.platformStage)) {
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'EXTERNAL_FULFILLED',
        });
      });
      return;
    }

    // 2b. 外部履约行：平台负责履约，内部不占库存（不阻塞）。
    if (isExternalFulfillmentMode(order.fulfillmentMode)) {
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'EXTERNAL_FULFILLED',
        });
      });
      return;
    }

    // 3. Warehouse: first ACTIVE platform-binding warehouse, lowest priority
    //    (Sprint 3 policy, orders.md §4.6).
    const warehouseId = await this.resolveWarehouse(order.storeId);
    if (warehouseId === null) {
      // 无法分配仓库 = 该行未持有任何库存，与 rollup「PENDING 视为缺货」
      // 的口径对齐：行置 BACKORDERED + 异常，缺货筛选/待采购/自动重分配
      // 都能看到它（人工测试修复 2026-09-17）。
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'BACKORDERED',
        });
        await this.exceptionService.createInTx(runner, {
          exceptionType: 'ORDER_INVALID_STATE',
          severity: 'HIGH',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
          storeId: order.storeId,
          message: `订单 ${order.orderNo} 第 ${item.lineNo} 行无法分配仓库：店铺没有已绑定平台仓库的可用仓库`,
          details: { orderNo: order.orderNo, lineNo: item.lineNo },
        });
      });
      return;
    }

    // 4. Reserve through the inventory core (task §19-§21).
    try {
      const reservation = await this.reservationService.reserveStock({
        skuId,
        warehouseId,
        quantity: item.quantity,
        referenceType: 'ORDER',
        referenceId: item.id,
        idempotencyKey: orderReserveKey(item.id),
        remark: `order=${order.orderNo} line=${item.lineNo}`,
        operator,
      });
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'RESERVED',
          reservationId: reservation.id,
          warehouseId,
        });
      });
    } catch (error: unknown) {
      if (error instanceof InsufficientStockError) {
        // Order survives; the line backorders (task §22).
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
            message: `订单 ${order.orderNo} 第 ${item.lineNo} 行库存不足`,
            details: { orderNo: order.orderNo, lineNo: item.lineNo, ...error.details },
          });
        });
        return;
      }
      throw error;
    }
  }

  /**
   * Re-resolves a previously FAILED line and allocates it (task §24).
   *
   * A human may have repaired the listing mapping after the line failed, so
   * the stored mappingStatus/skuId are stale evidence and must not gate the
   * retry - resolution runs again with the same store-scoped rules. On
   * success the line is promoted to MAPPED and the OPEN
   * ORDER_SKU_MAPPING_FAILED exception is closed.
   */
  async retryFailedMappingItem(
    order: OrderEntity,
    item: OrderItemEntity,
    operator: OperatorContext,
    options?: {
      /**
       * false = 只修映射不占库存（2026-10-14）：行当前不持有内部库存
       * （如 RELEASED），分配会被业务状态拒绝，但映射与异常仍必须修复。
       */
      allocate?: boolean;
    },
  ): Promise<
    | { resolved: false; code: string }
    | { resolved: true; reserved: boolean; reservationId: string | null }
  > {
    const resolution = await this.resolveItemSku(order, item);
    if (!resolution.ok) {
      // Still unresolvable: keep FAILED, keep the exception, report the code.
      return { resolved: false, code: resolution.code };
    }

    await this.dataSource.transaction(async (runner) => {
      await this.itemRepo.updateMapping(runner, item.id, {
        mappingStatus: 'MAPPED',
        skuId: resolution.skuId,
        listingSkuId: resolution.listingSkuId,
      });
    });
    // The mapping blocker is gone: close its exception so the order can roll
    // up out of EXCEPTION (a stock exception may still be raised below).
    await this.dataSource.transaction(async (runner) => {
      await this.exceptionService.resolveByReferenceInTx(runner, {
        exceptionType: 'ORDER_SKU_MAPPING_FAILED',
        referenceType: 'ORDER_ITEM',
        referenceId: item.id,
      });
    });
    this.logger.log('Order line re-resolved after mapping repair', {
      module: 'order',
      orderNo: order.orderNo,
      lineNo: item.lineNo,
      skuId: resolution.skuId,
    });

    // 外部履约（ERP 建议#6 修复 2026-09-28）：FBO/FBP/FBW/FBY 行由平台仓库
    // 持货发货，与摄入路径（allocateItem 2a）同样**不占内部库存、不进拣货**。
    // 平台已发货（platform_stage IN_TRANSIT / DELIVERED）时订单随平台事实
    // 立即转 SHIPPED——这正是此前 FBP 订单被映射异常卡在 待处理/异常 的根因：
    // 摄入时映射失败挂异常，恢复路径又误走内部库存分配。
    if (isExternalFulfillmentMode(order.fulfillmentMode)) {
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'EXTERNAL_FULFILLED',
        });
        // 历史重试可能留过 ORDER_OUT_OF_STOCK，行转外部履约后内部缺货语义消失。
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
          `平台履约流转：映射修复时平台已发货（${order.platformStage}，外部履约 ${order.fulfillmentMode}）`,
        );
      } else {
        await this.statusService.recomputeOrderStatus(
          order.id,
          operator,
          `第 ${item.lineNo} 行映射修复（外部履约，等待平台发货事实）`,
        );
      }
      return { resolved: true, reserved: false, reservationId: null };
    }

    // 平台已事实发货（stage IN_TRANSIT / DELIVERED，用户指示 2026-10-14）：
    // 自管履约（FBS/RFBS）订单在平台上已经发走——映射虽已修复，但货物
    // 不在我们手里，占内部库存会被现实否证。行转外部履约完成并关闭缺货
    // 异常；无其他未映射行时订单随平台事实转 SHIPPED（收敛逻辑见
    // OrderPlatformShippedService），否则保持由未映射异常阻塞。
    if (isPlatformShippedStage(order.platformStage)) {
      await this.platformShipped.apply(
        order,
        operator,
        `第 ${item.lineNo} 行映射修复：平台已事实发货（${order.platformStage}），缺货状态与现实矛盾，按平台事实关闭`,
      );
      return { resolved: true, reserved: false, reservationId: null };
    }

    // 只修映射（allocate=false）：行当前状态不允许占用内部库存时，映射修复
    // 本身（+ 关映射异常 + 重算 rollup）就是要的结果——不能再往下走分配，
    // 否则会把不该占库存的行改成 BACKORDERED/RESERVED（2026-10-14）。
    if (options?.allocate === false) {
      await this.statusService.recomputeOrderStatus(
        order.id,
        operator,
        `第 ${item.lineNo} 行映射修复（当前状态 ${item.fulfillmentStatus}，未分配内部库存）`,
      );
      return { resolved: true, reserved: false, reservationId: null };
    }

    const fresh = (await this.itemRepo.findById(item.id)) as OrderItemEntity;
    let outcome: { reserved: boolean; reservationId: string | null };
    try {
      outcome = await this.allocateMappedItem(order, fresh, operator);
    } catch (error: unknown) {
      if (error instanceof OrderIngestInvalidError) {
        // 配置性失败（典型：店铺没有绑定仓库）。摄入路径此时写 BACKORDERED +
        // ORDER_INVALID_STATE（2026-09-17）；修复路径此前直接抛错，行会**永远
        // 停在 PENDING**：映射异常已关，页面上既没有缺货徽标也没有任何异常可看
        // （2026-10-23 实证 ORD00000544）。这里与摄入路径对齐。
        await this.recordAllocationBlocked(order, item, operator);
        return { resolved: true, reserved: false, reservationId: null };
      }
      // 映射已修复：无论分配是否成功，rollup 必须重算——否则订单头会永远
      // 停留在 EXCEPTION，与「异常已解决」的行事实自相矛盾（分配错误本身
      // 照常抛给调用方）。
      await this.statusService.recomputeOrderStatus(
        order.id,
        operator,
        `第 ${item.lineNo} 行映射修复后重试分配失败`,
      );
      throw error;
    }

    if (!outcome.reserved) {
      // The line entered this path as FAILED (i.e. never allocated), so a
      // failed reservation must be recorded the same way ingestion records
      // it - otherwise the line sits in PENDING with no stock exception and
      // no path forward.
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
          message: `订单 ${order.orderNo} 第 ${item.lineNo} 行映射修复后仍库存不足`,
          details: { orderNo: order.orderNo, lineNo: item.lineNo, skuId: resolution.skuId },
        });
      });
    }
    // The mapping blocker is gone either way: roll the order status up so it
    // can leave EXCEPTION (a stock blocker now shows as BACKORDERED).
    await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      outcome.reserved
        ? `第 ${item.lineNo} 行映射修复后分配成功`
        : `第 ${item.lineNo} 行映射修复后仍库存不足`,
    );
    return { resolved: true, ...outcome };
  }

  /**
   * 配置性失败的行级可见化（与摄入路径同口径）：行置 BACKORDERED、写
   * ORDER_INVALID_STATE 异常、重算订单状态。自吞失败不打扰调用方。
   */
  private async recordAllocationBlocked(
    order: OrderEntity,
    item: OrderItemEntity,
    operator: OperatorContext,
  ): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      await this.itemRepo.updateFulfillment(runner, item.id, {
        fulfillmentStatus: 'BACKORDERED',
      });
      await this.exceptionService.createInTx(runner, {
        exceptionType: 'ORDER_INVALID_STATE',
        severity: 'HIGH',
        referenceType: 'ORDER_ITEM',
        referenceId: item.id,
        storeId: order.storeId,
        message: `订单 ${order.orderNo} 第 ${item.lineNo} 行无法分配仓库：店铺没有已绑定平台仓库的可用仓库`,
        details: { orderNo: order.orderNo, lineNo: item.lineNo },
      });
    });
    await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      `第 ${item.lineNo} 行映射修复后仍无法分配仓库`,
    );
  }

  /**
   * 映射修复后的批量收敛（2026-10-15 用户 bug 报告）：一个平台变体补齐映射
   * （快速建档 / 人工映射）后，同店铺引用该变体的全部 FAILED 订单行自动重试
   * ——不再要求逐单手动点「重试映射」。候选按店铺 + 平台标识宽松匹配（与
   * 摄入解析同一标识语义，decision 0016：platform_sku_id 优先、seller_sku
   * 次之、offer_id 永不参与），精确判定交给逐行 retryFailedMappingItem——
   * resolve 不过的行保持 FAILED。单行失败自吞（日志），不拖垮批次；调用方
   * 是操作员的建档/映射动作，操作日志沿用该操作员（可追溯触发人）。
   */
  async retryFailedMappingForVariant(
    input: { storeId: string; platformSkuId: string | null; sellerSku: string | null },
    operator: OperatorContext,
  ): Promise<{ scanned: number; repaired: number; reserved: number }> {
    if (input.platformSkuId === null && input.sellerSku === null) {
      // 变体没有任何可用于订单行匹配的标识：无事可做（也无法误匹配）。
      return { scanned: 0, repaired: 0, reserved: 0 };
    }
    const candidates = await this.itemRepo.findFailedMappingLineCandidates(
      input.storeId,
      input.platformSkuId,
      input.sellerSku,
      50,
    );
    let repaired = 0;
    let reserved = 0;
    for (const candidate of candidates) {
      try {
        const item = await this.itemRepo.findById(candidate.itemId);
        const order = item === null ? null : await this.orderRepo.findById(item.orderId);
        if (item === null || order === null || order.erpStatus === 'CANCELLED') {
          continue;
        }
        const outcome = await this.retryFailedMappingItem(order, item, operator, {
          allocate:
            item.fulfillmentStatus === 'BACKORDERED' || item.fulfillmentStatus === 'PENDING',
        });
        if (outcome.resolved) {
          repaired += 1;
          if (outcome.reserved) {
            reserved += 1;
          }
        }
      } catch (error: unknown) {
        this.logger.warn(
          `mapping-repair batch retry failed for item ${candidate.itemId}: ${String(error)}`,
          'OrderIngestionService',
        );
      }
    }
    if (repaired > 0) {
      this.logger.log('batch mapping repair after variant mapping committed', {
        module: 'order',
        storeId: input.storeId,
        platformSkuId: input.platformSkuId,
        scanned: candidates.length,
        repaired,
        reserved,
      });
    }
    return { scanned: candidates.length, repaired, reserved };
  }

  /**
   * 兜底收敛（2026-10-20）：订单同步末尾对「仍未映射」的行做有界扫描，把
   * 现在已经能解析的行修好。
   *
   * 为什么需要：变体级收敛只挂在映射写入上（新建/绑定/启用链接），而这些
   * 写入可能发生在订单行已失败之后很久——历史遗留行、或任何未来新增的写入
   * 路径漏掉收敛时，订单会一直停在映射异常，只能人工逐单重试。此处逐个调用
   * 同一套 resolve + retryFailedMappingItem，未解析的行保持 FAILED（一次
   * 索引查询的成本），已解析的行自动转 MAPPED 并占用库存/关异常。
   *
   * 批量上限固定且最旧优先，单店每轮成本可控；任何单行失败只记日志。
   */
  async convergeStaleMappingFailures(
    storeId: string,
    operator: OperatorContext,
    limit = 40,
  ): Promise<{ scanned: number; repaired: number; reserved: number; restored: number }> {
    const candidates = await this.itemRepo.findFailedMappingItemIds(storeId, limit);
    let repaired = 0;
    let reserved = 0;
    for (const itemId of candidates) {
      try {
        const item = await this.itemRepo.findById(itemId);
        const order = item === null ? null : await this.orderRepo.findById(item.orderId);
        if (item === null || order === null || order.erpStatus === 'CANCELLED') {
          continue;
        }
        const outcome = await this.retryFailedMappingItem(order, item, operator, {
          allocate:
            item.fulfillmentStatus === 'BACKORDERED' || item.fulfillmentStatus === 'PENDING',
        });
        if (outcome.resolved) {
          repaired += 1;
          if (outcome.reserved) {
            reserved += 1;
          }
        }
      } catch (error: unknown) {
        this.logger.warn(
          `stale mapping-repair sweep failed for item ${itemId}: ${String(error)}`,
          'OrderIngestionService',
        );
      }
    }
    const restored = await this.restoreReleasedExceptionOrders(storeId, operator, limit);
    if (repaired > 0 || restored > 0) {
      this.logger.log('stale mapping-repair sweep converged order lines', {
        module: 'order',
        storeId,
        scanned: candidates.length,
        repaired,
        reserved,
        restored,
      });
    }
    return { scanned: candidates.length, repaired, reserved, restored };
  }

  /**
   * 已释放行的异常收口与误判恢复（2026-10-20）：行已 RELEASED /
   * EXTERNAL_FULFILLED 时未映射/缺货都没有可执行的待办，异常必须关闭；
   * 订单若是被旧规则翻回 EXCEPTION，重算会按历史回到真实持有态（多为
   * SHIPPED）。不修复这些订单就要等 24h 的平台事实刷新窗口，期间已发货
   * 订单一直显示「异常」。
   */
  private async restoreReleasedExceptionOrders(
    storeId: string,
    operator: OperatorContext,
    limit: number,
  ): Promise<number> {
    let restored = 0;
    const candidates = await this.orderRepo.findOrdersWithReleasedLineExceptions(storeId, limit);
    for (const candidate of candidates) {
      try {
        await this.resolveReleasedLineExceptions(candidate.id);
        if (candidate.erpStatus !== 'EXCEPTION') {
          continue;
        }
        const next = await this.statusService.recomputeOrderStatus(
          candidate.id,
          operator,
          '未映射行已释放，恢复订单真实状态',
        );
        if (next !== 'EXCEPTION') {
          restored += 1;
        }
      } catch (error: unknown) {
        this.logger.warn(
          `stale exception-order restore failed for order ${candidate.id}: ${String(error)}`,
          'OrderIngestionService',
        );
      }
    }
    return restored;
  }

  private async resolveReleasedLineExceptions(orderId: string): Promise<void> {
    const items = await this.itemRepo.findByOrderId(orderId);
    const released = items.filter(
      (item) =>
        item.fulfillmentStatus === 'RELEASED' || item.fulfillmentStatus === 'EXTERNAL_FULFILLED',
    );
    if (released.length === 0) {
      return;
    }
    await this.dataSource.transaction(async (runner) => {
      for (const item of released) {
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

  /** Retry entry shared with OrderService.retryAllocation (task §24). */
  async allocateMappedItem(
    order: OrderEntity,
    item: OrderItemEntity,
    operator: OperatorContext,
  ): Promise<{ reserved: boolean; reservationId: string | null }> {
    const warehouseId = await this.resolveWarehouse(order.storeId);
    if (warehouseId === null) {
      throw new OrderIngestInvalidError('店铺没有可用的库存绑定仓库', {
        storeId: order.storeId,
      });
    }
    try {
      const reservation = await this.reservationService.reserveStock({
        skuId: item.skuId as string,
        warehouseId,
        quantity: item.quantity,
        referenceType: 'ORDER',
        referenceId: item.id,
        idempotencyKey: orderReserveKey(item.id),
        remark: `retry order=${order.orderNo} line=${item.lineNo}`,
        operator,
      });
      await this.dataSource.transaction(async (runner) => {
        await this.itemRepo.updateFulfillment(runner, item.id, {
          fulfillmentStatus: 'RESERVED',
          reservationId: reservation.id,
          warehouseId,
        });
      });
      // 占用成功 = 此前的配置性失败（如"店铺未绑定仓库"，自动重分配写入的
      // 行级 ORDER_INVALID_STATE）已解除：幂等关闭，无则不动。
      await this.exceptionService.resolveByReference({
        exceptionType: 'ORDER_INVALID_STATE',
        referenceType: 'ORDER_ITEM',
        referenceId: item.id,
      });
      return { reserved: true, reservationId: reservation.id };
    } catch (error: unknown) {
      if (error instanceof InsufficientStockError) {
        return { reserved: false, reservationId: null };
      }
      throw error;
    }
  }

  /**
   * Store -> first ACTIVE platform-binding warehouse (priority ASC; ties
   * prefer non-FBO modes because FBO stock is platform-managed, orders.md
   * §4.6; 用户指示 2026-09-17：仓库解析改走「仓库绑定平台仓库」).
   * 规则实现于 WarehousePlatformBindingService.resolveDefaultWarehouseId
   * （2026-10-16 提取共享，收货草稿兜底同源）。
   */
  private async resolveWarehouse(storeId: string): Promise<string | null> {
    return this.bindingService.resolveDefaultWarehouseId(storeId);
  }

  private async buildResult(
    order: OrderEntity,
    alreadyIngested: boolean,
  ): Promise<OrderIngestResult> {
    const items = await this.itemRepo.findByOrderId(order.id);
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      erpStatus: order.erpStatus,
      alreadyIngested,
      itemResults: items.map((item) => ({
        orderItemId: item.id,
        lineNo: item.lineNo,
        mappingStatus: item.mappingStatus,
        fulfillmentStatus: item.fulfillmentStatus,
        skuId: item.skuId,
        reservationId: item.reservationId,
      })),
    };
  }
}

function isUniqueViolationOnOrders(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as {
    code?: string;
    constraint?: string;
    driverError?: { code?: string; constraint?: string };
  };
  const driver = candidate.driverError ?? candidate;
  return driver.code === '23505' && driver.constraint === 'uq_orders_store_platform';
}

/**
 * Line total = unit_price × quantity (finance.md §2). No price -> NULL
 * (a missing fact is never fabricated as 0).
 */
function lineTotalPrice(unitPrice: string | null | undefined, quantity: string): string | null {
  if (unitPrice === null || unitPrice === undefined || unitPrice === '') {
    return null;
  }
  return formatAmount(mulAmountByQty(parseAmount(unitPrice), quantity));
}
