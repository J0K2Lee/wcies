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
import { orderReserveKey } from '../enums/order.constants';
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

    const erpStatus = await this.statusService.recomputeOrderStatus(
      order.id,
      operator,
      '订单摄入完成，按行结果汇总',
    );
    // 外部履约订单（FBO/FBP）发货由平台负责，发货时限不构成内部作业压力，
    // 不评估 ORDER_SHIPMENT_DEADLINE_NEAR（用户指示 2026-09-17）。
    if (!isExternalFulfillmentMode(order.fulfillmentMode)) {
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

    // 2a. 外部履约行：平台负责履约，内部不占库存（不阻塞）。
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

    const fresh = (await this.itemRepo.findById(item.id)) as OrderItemEntity;
    let outcome: { reserved: boolean; reservationId: string | null };
    try {
      outcome = await this.allocateMappedItem(order, fresh, operator);
    } catch (error: unknown) {
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
   * Multi-warehouse decisions belong to a later sprint.
   */
  private async resolveWarehouse(storeId: string): Promise<string | null> {
    const bindings = await this.bindingService.listActiveByStore(storeId);
    const candidates = bindings
      .map((entry) => entry.binding)
      .sort((a, b) => {
        const byPriority = a.priority - b.priority;
        if (byPriority !== 0) {
          return byPriority;
        }
        const aFbo = a.fulfillmentMode.includes('FBO') ? 1 : 0;
        const bFbo = b.fulfillmentMode.includes('FBO') ? 1 : 0;
        return aFbo - bFbo;
      });
    return candidates[0]?.warehouseId ?? null;
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
