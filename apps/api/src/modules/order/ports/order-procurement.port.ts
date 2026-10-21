import {
  OrderItemProcurementCoverage,
  ProcurementCoverageState,
} from '../../purchase/services/procurement-coverage.service';

/**
 * Read surface the order module needs from the purchase module (Sprint 7
 * task §10/T3.3). Implemented by PurchaseOrderService and provided via this
 * token; both modules use forwardRef (same pattern as ORDER_PICKING_STATE_PORT)
 * because purchase also consumes order public services. The order module
 * must never import purchase repositories (AGENTS.md §9).
 *
 * 2026-10-21：采购以「SKU + 仓」为单位，订单行只表达需求与覆盖。旧的
 * NOT_ORDERED/ORDERED/ARRIVED（按采购单链接派生）已退役。
 */
export const ORDER_PROCUREMENT_PORT = Symbol('ORDER_PROCUREMENT_PORT');

export type { OrderItemProcurementCoverage, ProcurementCoverageState };

export interface OrderProcurementPort {
  /**
   * 行级采购覆盖（衍生）：COVERED = 该行被在途采购按优先级覆盖；
   * SHORT = 未覆盖（缺口 > 0）；不在 map 中的行 = 采购覆盖不适用
   * （已分配/终态/未映射/店铺无绑定仓）。
   */
  getCoverageByOrderItemIds(
    orderItemIds: readonly string[],
  ): Promise<Record<string, OrderItemProcurementCoverage>>;

  /** 被在途覆盖的订单行 id（「已采购」筛选）。 */
  listCoveredItemIds(): Promise<readonly string[]>;

  /** 未被覆盖的缺货行 id（「缺货 / 待采购」筛选）。 */
  listShortItemIds(): Promise<readonly string[]>;
}
