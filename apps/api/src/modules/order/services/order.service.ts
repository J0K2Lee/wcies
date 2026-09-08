import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PageMeta } from '@wcies/shared';
import { OperatorContext, OperationLogService } from '../../operation-log/operation-log.service';
import { ReservationService } from '../../inventory/services/reservation.service';
import { InventoryQueryService } from '../../inventory/services/inventory-query.service';
import { ExceptionService } from '../../exception/services/exception.service';
import { StoreService } from '../../store/services/store.service';
import { AppLoggerService } from '../../../common/logger/app-logger.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderItemEntity } from '../entities/order-item.entity';
import { OrderRepository, OrderListFilters } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { OrderStatusService } from './order-status.service';
import { OrderIngestionService } from './order-ingestion.service';
import { ErpOrderStatus, orderReleaseKey } from '../enums/order.constants';
import {
  OrderInvalidStateError,
  OrderItemNotFoundError,
  OrderNotFoundError,
} from '../errors/order.errors';
import { ORDER_PICKING_STATE_PORT, OrderPickingStatePort } from '../ports/order-picking-state.port';
import { ORDER_INTERCEPTION_PORT, OrderInterceptionPort } from '../ports/order-interception.port';
import { OrderDetailDto, OrderListItemDto } from '../dto/order.dto';

/**
 * Order application service (Sprint 3): list/detail, cancellation with
 * per-line inventory handling, and backorder retry. Stock is only ever
 * touched through the exported Inventory services (AGENTS.md §10).
 */
@Injectable()
export class OrderService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderRepo: OrderRepository,
    private readonly itemRepo: OrderItemRepository,
    private readonly historyRepo: OrderStatusHistoryRepository,
    private readonly statusService: OrderStatusService,
    private readonly ingestionService: OrderIngestionService,
    private readonly reservationService: ReservationService,
    private readonly inventoryQuery: InventoryQueryService,
    private readonly exceptionService: ExceptionService,
    private readonly storeService: StoreService,
    private readonly operationLog: OperationLogService,
    private readonly logger: AppLoggerService,
    @Inject(forwardRef(() => ORDER_PICKING_STATE_PORT))
    private readonly pickingState: OrderPickingStatePort,
    @Inject(forwardRef(() => ORDER_INTERCEPTION_PORT))
    private readonly interceptionPort: OrderInterceptionPort,
  ) {}

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async list(
    filters: OrderListFilters,
    page: { page: number; pageSize: number },
  ): Promise<{ items: OrderListItemDto[]; meta: PageMeta }> {
    const { rows, total } = await this.orderRepo.listWithAggregates(
      filters,
      page.pageSize,
      (page.page - 1) * page.pageSize,
    );
    return {
      items: rows.map((row) => ({
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
        createdAt: row.order.createdAt,
        itemsCount: row.itemsCount,
        reservedCount: row.reservedCount,
        backorderedCount: row.backorderedCount,
        pickedCount: row.pickedCount,
        mappingFailedCount: row.mappingFailedCount,
        openExceptionsCount: row.openExceptionsCount,
      })),
      meta: { page: page.page, pageSize: page.pageSize, total },
    };
  }

  async getDetail(id: string): Promise<OrderDetailDto> {
    const order = await this.getOrderOrThrow(id);
    const [store, items, history, interceptions] = await Promise.all([
      this.storeService.getEntityWithPlatform(order.storeId),
      this.itemRepo.findByOrderIdWithSku(order.id),
      this.historyRepo.listByOrderId(order.id),
      this.interceptionPort.listByOrderId(order.id),
    ]);

    const itemDtos = await Promise.all(
      items.map(async ({ item, skuCode, skuName }) => {
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
          warehouseId: item.warehouseId,
          quantity: item.quantity,
          fulfillmentStatus: item.fulfillmentStatus,
          mappingStatus: item.mappingStatus,
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
      rawData: order.rawData,
      remark: order.remark,
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

  // --------------------------------------------------------------------------
  // Backorder retry (task §24/§73)
  // --------------------------------------------------------------------------

  async retryAllocation(
    orderItemId: string,
    operator: OperatorContext,
  ): Promise<{
    orderItemId: string;
    fulfillmentStatus: string;
    reserved: boolean;
  }> {
    const item = await this.itemRepo.findById(orderItemId);
    if (item === null) {
      throw new OrderItemNotFoundError(orderItemId);
    }
    const order = await this.getOrderOrThrow(item.orderId);
    if (order.erpStatus === 'CANCELLED') {
      throw new OrderInvalidStateError('订单已取消，不能重新分配库存', { orderId: order.id });
    }
    if (item.mappingStatus !== 'MAPPED' || item.skuId === null) {
      throw new OrderInvalidStateError('订单行未成功映射 SKU，不能重试分配', {
        orderItemId: item.id,
        mappingStatus: item.mappingStatus,
      });
    }
    if (item.fulfillmentStatus !== 'BACKORDERED' && item.fulfillmentStatus !== 'PENDING') {
      throw new OrderInvalidStateError(
        `订单行状态 ${item.fulfillmentStatus} 不允许重试分配（仅 BACKORDERED / PENDING）`,
        { orderItemId: item.id, fulfillmentStatus: item.fulfillmentStatus },
      );
    }

    const outcome = await this.ingestionService.allocateMappedItem(order, item, operator);
    if (outcome.reserved) {
      // Success: close the OPEN out-of-stock exception (no new spam on
      // failure - the OPEN row stays, task §24).
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
    }
    const fresh = await this.itemRepo.findById(orderItemId);
    return {
      orderItemId,
      fulfillmentStatus: fresh?.fulfillmentStatus ?? item.fulfillmentStatus,
      reserved: outcome.reserved,
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
    return {
      orderId: item.orderId,
      orderItemId: item.id,
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
    return this.statusService.recomputeOrderStatus(orderId, operator, '正式出库完成');
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

  async getOrderOrThrow(id: string): Promise<OrderEntity> {
    const order = await this.orderRepo.findById(id);
    if (order === null) {
      throw new OrderNotFoundError(id);
    }
    return order;
  }

  private async setItemReleased(item: OrderItemEntity): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      await this.itemRepo.updateFulfillment(runner, item.id, { fulfillmentStatus: 'RELEASED' });
    });
  }
}
