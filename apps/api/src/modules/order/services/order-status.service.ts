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
 *   (open picking items) > SHIPPED (all fulfillable shipped) >
 *   PARTIALLY_SHIPPED (some shipped, rest still fulfillable) > PICKED (all
 *   fulfillable picked) > partial/full BACKORDERED > READY_TO_PICK.
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
    // EXTERNAL_FULFILLED（用户指示 2026-09-17）与 RELEASED 同样不属于内部
    // 可履约行：平台仓库持货发货，等待平台事件推进订单（applySyncedPlatform
    // Facts 自动转 SHIPPED）。
    const fulfillable = items.filter(
      (item) =>
        item.mappingStatus !== 'FAILED' &&
        item.fulfillmentStatus !== 'RELEASED' &&
        item.fulfillmentStatus !== 'EXTERNAL_FULFILLED',
    );
    if (fulfillable.length === 0) {
      // Nothing left to fulfill (orders.md §7 rule 2/EXTERNAL_FULFILLED 说明):
      // - 仍有 mapping FAILED 行 → EXCEPTION（未映射阻塞）。
      // - 否则（全部 EXTERNAL_FULFILLED / RELEASED）保持当前状态：已 SHIPPED
      //   的保持 SHIPPED，新摄入的外部履约单停在 NEW 等平台事件推进。
      // 但 EXCEPTION 的成立前提是「存在 mapping FAILED 行」——前提消失后不得
      // 保留（2026-10-16 用户 bug：FBP 行映射修复为 EXTERNAL_FULFILLED 后订单
      // 仍卡 EXCEPTION，因为旧代码无条件返回 current 把陈旧 EXCEPTION 保留）。
      // 陈旧的 EXCEPTION 回落到失败前的持有态 NEW。
      if (items.some((item) => item.mappingStatus === 'FAILED')) {
        return 'EXCEPTION';
      }
      return current === 'EXCEPTION' ? 'NEW' : current;
    }
    if ((await this.pickingState.countActivePickingItems(orderId)) > 0) {
      return 'PICKING';
    }
    if (fulfillable.every((item) => item.fulfillmentStatus === 'SHIPPED')) {
      return 'SHIPPED';
    }
    if (fulfillable.some((item) => item.fulfillmentStatus === 'SHIPPED')) {
      return 'PARTIALLY_SHIPPED';
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
