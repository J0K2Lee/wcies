import { ProcurementState } from '../../purchase/enums/purchase.constants';

/**
 * Read surface the order module needs from the purchase module (Sprint 7
 * task §10/T3.3). Implemented by PurchaseOrderService and provided via this
 * token; both modules use forwardRef (same pattern as ORDER_PICKING_STATE_PORT)
 * because purchase also consumes order public services. The order module
 * must never import purchase repositories (AGENTS.md §9).
 */
export const ORDER_PROCUREMENT_PORT = Symbol('ORDER_PROCUREMENT_PORT');

export interface OrderProcurementPort {
  /**
   * Derived procurement state per order line (purchase.md §3.5): NOT_ORDERED
   * when no live PO item is linked, ORDERED while received < ordered,
   * ARRIVED once received >= ordered. Lines absent from the map default to
   * NOT_ORDERED.
   */
  getProcurementStatesByOrderItemIds(
    orderItemIds: readonly string[],
  ): Promise<Record<string, ProcurementState>>;

  /**
   * Order-line ids currently linked to a NON-cancelled purchase order. The
   * order list uses this to power the 待采购 filter (BACKORDERED + MAPPED
   * lines NOT in this list).
   */
  listActiveOrderItemIds(): Promise<readonly string[]>;
}
