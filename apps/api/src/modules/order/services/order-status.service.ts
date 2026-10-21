import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OperatorContext } from '../../operation-log/operation-log.service';
import { ErpOrderStatus, ERP_ORDER_STATUSES } from '../enums/order.constants';
import { OrderRepository } from '../repositories/order.repository';
import { OrderItemRepository } from '../repositories/order-item.repository';
import { OrderStatusHistoryRepository } from '../repositories/order-status-history.repository';
import { ORDER_PICKING_STATE_PORT, OrderPickingStatePort } from '../ports/order-picking-state.port';

/**
 * 未映射行只有在「仍需内部履约」时才阻塞订单。行一旦 RELEASED /
 * EXTERNAL_FULFILLED（平台或店小秘已事实发货），未映射就不再可执行，
 * 不得再把它当作异常依据——否则已 SHIPPED 的订单会被翻回 EXCEPTION
 * （2026-10-20，ORD00000065）。导出给 platform-shipped 收敛共用，
 * 避免两处判定漂移。
 */
export function isBlockingMappingFailure(item: {
  mappingStatus: string;
  fulfillmentStatus: string;
}): boolean {
  return (
    item.mappingStatus === 'FAILED' &&
    item.fulfillmentStatus !== 'RELEASED' &&
    item.fulfillmentStatus !== 'EXTERNAL_FULFILLED'
  );
}

function isErpOrderStatus(value: string | null): value is ErpOrderStatus {
  return value !== null && (ERP_ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * 订单是否已到「不再打面单」的终态（用户指示 2026-10-21）。
 *
 * - CANCELLED：平台或人工取消，面单已作废；
 * - COMPLETED：列表的派生阶段口径 `erp_status='SHIPPED' AND
 *   platform_stage='DELIVERED'`（orders.md §17a）。**注意**：平台已妥投但
 *   ERP 尚未 SHIPPED 的「背离单」不在其中——它们仍可能需要打单。
 *
 * 这是「禁打」与「面单清理候选」共用的唯一定义，避免两处口径漂移。
 */
export function isOrderLabelPrintBlocked(order: {
  erpStatus: string;
  platformStage: string | null;
}): boolean {
  return (
    order.erpStatus === 'CANCELLED' ||
    (order.erpStatus === 'SHIPPED' && order.platformStage === 'DELIVERED')
  );
}

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
      // - 仍有「待内部履约」的 mapping FAILED 行 → EXCEPTION（未映射阻塞）。
      // - 否则（FAILED 行都已释放 / 全部 EXTERNAL_FULFILLED / RELEASED）保持
      //   当前状态：已 SHIPPED 的保持 SHIPPED，新摄入的外部履约单停在 NEW 等
      //   平台事件推进。
      // EXCEPTION 的成立前提是「存在待履约的 mapping FAILED 行」——前提消失后
      // 不得保留（2026-10-16 用户 bug：FBP 行映射修复为 EXTERNAL_FULFILLED 后订单
      // 仍卡 EXCEPTION，因为旧代码无条件返回 current 把陈旧 EXCEPTION 保留）。
      // 只有「仍待内部履约」的未映射行才构成阻塞：行一旦被标记外部履约
      // （RELEASED / EXTERNAL_FULFILLED，订单已由平台/店小秘发货）或订单取消，
      // 未映射就不再可执行，再拿它把已发货订单翻回 EXCEPTION 属于状态倒退
      // （2026-10-20 用户 bug：ORD00000065 已发货 → 异常 → 修复映射后才回
      // 已发货，中间那次 异常 就是这条规则造成的）。
      const blockingMappingFailures = items.some(isBlockingMappingFailure);
      if (blockingMappingFailures) {
        return 'EXCEPTION';
      }
      // 前提消失后恢复历史中最近一次真实状态：订单若曾被平台事实置为
      // SHIPPED 再误判回 EXCEPTION，恢复的应是 SHIPPED（2026-10-20，
      // 见 orders.md §7 rule 2），不能让已发货订单回到「待处理」。
      if (current === 'EXCEPTION') {
        const previous = await this.historyRepo.findLastStatusOtherThan(orderId, 'EXCEPTION');
        return isErpOrderStatus(previous) ? previous : 'NEW';
      }
      return current;
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
