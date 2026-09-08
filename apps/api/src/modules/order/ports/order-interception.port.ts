/**
 * Port: interception creation (Sprint 4 task §29/§31).
 *
 * OrderService.cancel creates an interception row when a PICKED line is
 * cancelled, but the interception workflow (scan / return-to-stock) lives in
 * its own module with its own repositories. The port keeps the dependency
 * direction one-way: OrderModule only knows the interface, InterceptionModule
 * provides the implementation (same pattern as ORDER_PICKING_STATE_PORT).
 */
export interface OrderInterceptionCreateInput {
  orderId: string;
  orderNo: string;
  orderItemId: string;
  warehouseId: string;
  /** Why the order was cancelled (stored on the interception as context). */
  reason?: string;
}

export interface OrderInterceptionCreated {
  id: string;
  interceptionNo: string;
}

export const ORDER_INTERCEPTION_PORT = Symbol('ORDER_INTERCEPTION_PORT');

export interface OrderInterceptionSummary {
  id: string;
  interceptionNo: string;
  orderItemId: string | null;
  warehouseId: string;
  status: string;
  reason: string | null;
  createdAt: Date;
}

export interface OrderInterceptionPort {
  createForCancelledPickedItem(
    input: OrderInterceptionCreateInput,
  ): Promise<OrderInterceptionCreated>;

  /** Interceptions of one order (order-detail read model). */
  listByOrderId(orderId: string): Promise<OrderInterceptionSummary[]>;
}
