import { OperatorContext } from '../../operation-log/operation-log.service';

/**
 * Read/control surface the order module needs from the picking module
 * (Sprint 3). Implemented by PickingService and provided via this token;
 * OrderModule imports PickingModule with forwardRef (picking also needs
 * order public services), and the injection is @Optional so the status
 * machine stays unit-testable without picking.
 */
export const ORDER_PICKING_STATE_PORT = Symbol('ORDER_PICKING_STATE_PORT');

/** 取消订单时拣货域的撤行结果（订单域据此决定拦截/释放）。 */
export interface PickingCancelOutcome {
  /** 被置为 CANCELLED 的拣货行数。 */
  cancelledRows: number;
  /** 本次撤出的数量合计（未拣部分）。 */
  cancelledQty: string;
  /** 该订单在拣货任务里已拣过的行（需要生成拦截）。 */
  pickedRows: Array<{ orderItemId: string; reservationId: string; pickedQty: string }>;
  /** 该订单有拣货行被处理过的 orderItemId（预约已由拣货域释放，订单域不要再释放）。 */
  handledOrderItemIds: string[];
  cancelledTaskIds: string[];
  completedTaskIds: string[];
}

export interface OrderPickingStatePort {
  /** Count of this order's items that sit in a CREATED/IN_PROGRESS picking task. */
  countActivePickingItems(orderId: string): Promise<number>;

  /**
   * 订单取消时按行撤出拣货任务（2026-11-03，用户确认口径：已拣的全部进拦截、
   * 剩余不再拣）。
   *
   * - 未拣行 / 部分拣行 → 行置 `CANCELLED` 并记录撤出数量；未拣余量从预约里
   *   释放（整笔释放 or `RELEASE_REMAINDER`）；
   * - 已全拣行 → 保持 `PICKED`，返回给订单域生成拦截；
   * - 任务收口：还有 PENDING 行继续；没有 PENDING 且存在 PICKED → COMPLETED；
   *   全部被撤 → CANCELLED。
   */
  cancelOrderItemsForOrder(
    orderId: string,
    operator: OperatorContext,
    reason: string,
  ): Promise<PickingCancelOutcome>;

  /** Minimal picking-task summaries of an order (detail view). */
  listTasksForOrder(orderId: string): Promise<
    Array<{
      id: string;
      pickingNo: string;
      warehouseId: string;
      status: string;
      totalItems: number;
      pickedItems: number;
      createdAt: Date;
    }>
  >;
}
