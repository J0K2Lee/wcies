import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ErpOrderStatus } from '../enums/order.constants';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { ORDER_PICKING_STATE_PORT, OrderPickingStatePort } from '../ports/order-picking-state.port';

/**
 * ERP order status machine (Sprint 3 task §5/§23; the rollup model is frozen
 * in docs/business-rules/orders.md §7). Business code NEVER writes
 * orders.erp_status directly - every change goes through here and leaves a
 * history row (AGENTS.md §38-§39).
 *
 * Rollup priority (see orders.md):
 *   CANCELLED (sticky) > EXCEPTION (no fulfillable line at all) > PICKING
 *   (open picking items) > PICKED (all fulfillable picked) > partial/full
 *   BACKORDERED > READY_TO_PICK.
 */
@Injectable()
export class OrderStatusService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly orderRepo: OrderRepository,
    private readonly itemRepo: OrderItemRepository,
    private readonly historyRepo: OrderStatusHistoryRepository,
    @Inject(forwardRef(() => ORDER_PICKING_STATE_PORT))
    private readonly pickingState: OrderPickingStatePort,
  ) {}

  /** Derives + persists the rollup status; no-op when nothing changed. */
  async recomputeOrderStatus(
    orderId: string,
    operator: OperatorContext,
    reason: string,
  ): Promise<ErpOrderStatus> {
    const order = await this.orderRepo.findById(orderId);
    if (order === null) {
      return 'NEW';
    }
    if (order.erpStatus === 'CANCELLED') {
      return order.erpStatus;
    }
    const next = await this.deriveRollupStatus(orderId, order.erpStatus);
    if (next !== order.erpStatus) {
      await this.transition(orderId, next, operator, reason);
    }
    return next;
  }

  /** Explicit transition (creation NEW, cancel CANCELLED). Writes history. */
  async transition(
    orderId: string,
    toStatus: ErpOrderStatus,
    operator: OperatorContext,
    reason: string,
    fromStatus?: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (runner) => {
      const current = await this.orderRepo.findById(orderId);
      const from = fromStatus ?? current?.erpStatus ?? null;
      await this.orderRepo.updateErpStatus(runner, orderId, toStatus);
      await this.historyRepo.insert(runner, {
        orderId,
        fromStatus: from,
        toStatus,
        reason: reason.slice(0, 500),
        operatorId: operator.userId,
        operatorName: operator.username,
      });
    });
  }

  private async deriveRollupStatus(
    orderId: string,
    current: ErpOrderStatus,
  ): Promise<ErpOrderStatus> {
    const items = await this.itemRepo.findByOrderId(orderId);
    if (items.length === 0) {
      return 'NEW';
    }
    const fulfillable = items.filter(
      (item) => item.mappingStatus !== 'FAILED' && item.fulfillmentStatus !== 'RELEASED',
    );
    if (fulfillable.length === 0) {
      // Nothing left to fulfill: pure mapping failures keep the exception
      // status; a fully released order is on its way to CANCELLED anyway.
      return items.some((item) => item.mappingStatus === 'FAILED') ? 'EXCEPTION' : current;
    }
    if ((await this.pickingState.countActivePickingItems(orderId)) > 0) {
      return 'PICKING';
    }
    if (fulfillable.every((item) => item.fulfillmentStatus === 'PICKED')) {
      return 'PICKED';
    }
    const waiting = fulfillable.filter(
      (item) => item.fulfillmentStatus === 'BACKORDERED' || item.fulfillmentStatus === 'PENDING',
    );
    if (waiting.length > 0) {
      return waiting.length === fulfillable.length ? 'BACKORDERED' : 'PARTIALLY_BACKORDERED';
    }
    return 'READY_TO_PICK';
  }
}
