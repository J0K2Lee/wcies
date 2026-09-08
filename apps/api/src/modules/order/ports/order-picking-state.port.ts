import { OperatorContext } from '../../operation-log/operation-log.service';

/**
 * Read/control surface the order module needs from the picking module
 * (Sprint 3). Implemented by PickingService and provided via this token;
 * OrderModule imports PickingModule with forwardRef (picking also needs
 * order public services), and the injection is @Optional so the status
 * machine stays unit-testable without picking.
 */
export const ORDER_PICKING_STATE_PORT = Symbol('ORDER_PICKING_STATE_PORT');

export interface OrderPickingStatePort {
  /** Count of this order's items that sit in a CREATED/IN_PROGRESS picking task. */
  countActivePickingItems(orderId: string): Promise<number>;

  /** True when any picking item of the order has pickedQty > 0 (cancel blocker). */
  hasPickedProgress(orderId: string): Promise<boolean>;

  /**
   * Cancels the order's picking tasks whose items ALL have pickedQty = 0
   * (no inventory touched) and frees their order-item links. Returns the
   * cancelled task ids.
   */
  cancelZeroProgressTasksForOrder(orderId: string, operator: OperatorContext): Promise<string[]>;

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
