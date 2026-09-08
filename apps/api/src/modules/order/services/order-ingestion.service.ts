import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { formatQty, parseQty } from '../../../common/utils/quantity';
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
import { StoreWarehouseBindingService } from '../../warehouse/services/store-warehouse-binding.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { NormalizedOrderInput } from '../dto/order.dto';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { OrderStatusService } from './order-status.service';
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
    private readonly bindingService: StoreWarehouseBindingService,
    private readonly exceptionService: ExceptionService,
    private readonly orderRepo: OrderRepository,
    private readonly itemRepo: OrderItemRepository,
    private readonly historyRepo: OrderStatusHistoryRepository,
    private readonly statusService: OrderStatusService,
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
            erpStatus: 'NEW',
            fulfillmentMode: input.fulfillmentMode ?? null,
            currency: input.currency ?? null,
            orderedAt: input.orderedAt,
            rawData: input.rawData ?? null,
            remark: input.remark ?? null,
          },
          input.items.map((item, index) => ({
            lineNo: index + 1,
            platformProductId: item.platformProductId ?? null,
            platformSkuId: item.platformSkuId ?? null,
            sellerSku: item.sellerSku ?? null,
            offerId: item.offerId ?? null,
            quantity: formatQty(parseQty(item.quantity)),
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
   * Maps one line to an internal SKU and reserves stock; every outcome is
   * persisted line-locally (task §17/§19/§22).
   */
  private async allocateItem(
    order: OrderEntity,
    item: OrderItemEntity,
    operator: OperatorContext,
  ): Promise<void> {
    // 1. Store-scoped resolution via the existing resolver (task §15-§16).
    let resolvedSkuId: string | null = null;
    let resolvedListingSkuId: string | null = null;
    let resolveFailure: { code: string; details: Record<string, unknown> } | null = null;
    try {
      const resolved = await this.resolver.resolveInternalSku({
        storeId: order.storeId,
        platformSkuId: item.platformSkuId ?? undefined,
        sellerSku: item.sellerSku ?? undefined,
        offerId: item.offerId ?? undefined,
      });
      resolvedSkuId = resolved.internalSkuId;
      resolvedListingSkuId = resolved.listingSkuId;
    } catch (error: unknown) {
      if (
        error instanceof ListingSkuResolveFailedError ||
        error instanceof ListingSkuResolveAmbiguousError
      ) {
        resolveFailure = { code: error.code, details: error.details };
      } else {
        throw error;
      }
    }

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

    // 3. Warehouse: first ACTIVE inventory-source binding, lowest priority
    //    (Sprint 3 policy, orders.md §4.6).
    const warehouseId = await this.resolveWarehouse(order.storeId);
    if (warehouseId === null) {
      await this.dataSource.transaction(async (runner) => {
        await this.exceptionService.createInTx(runner, {
          exceptionType: 'ORDER_INVALID_STATE',
          severity: 'HIGH',
          referenceType: 'ORDER_ITEM',
          referenceId: item.id,
          storeId: order.storeId,
          message: `订单 ${order.orderNo} 第 ${item.lineNo} 行无法分配仓库：店铺没有可用的库存绑定仓库`,
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
   * Store -> first ACTIVE inventory-source binding warehouse (priority ASC;
   * ties prefer non-FBO modes because FBO stock is platform-managed,
   * orders.md §4.6). Multi-warehouse decisions belong to a later sprint.
   */
  private async resolveWarehouse(storeId: string): Promise<string | null> {
    const page = await this.bindingService.list({ storeId, page: 1, pageSize: 100 });
    const candidates = page.items
      .filter((binding) => binding.status === 'ACTIVE' && binding.isInventorySource)
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
