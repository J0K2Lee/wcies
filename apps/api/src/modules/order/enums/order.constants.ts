/**
 * Sprint 3 typed order constants (AGENTS.md §64: no scattered magic
 * strings; adding a value here is a business-rule change that must be
 * reflected in docs/business-rules/orders.md).
 */

import { PlatformOrderStage } from '@wcies/platform-contracts';

/**
 * 平台已事实发货的阶段（用户指示 2026-10-14）：货物在平台侧已经发走
 * （运输中 / 已妥投）。此时 WCIES 内部「预发货」状态与现实矛盾——缺货
 * 行与缺货/时限异常按平台事实收敛，见 OrderPlatformShippedService
 * （docs/business-rules/orders.md §7a.0）。
 */
const PLATFORM_SHIPPED_STAGES: readonly PlatformOrderStage[] = ['IN_TRANSIT', 'DELIVERED'];

export function isPlatformShippedStage(stage: string | null | undefined): boolean {
  return (
    typeof stage === 'string' && (PLATFORM_SHIPPED_STAGES as readonly string[]).includes(stage)
  );
}

/**
 * ERP order status (task §5). ALLOCATING is a reserved value - Sprint 3
 * ingestion allocates in one pass and never enters it. SHIPPED and
 * PARTIALLY_SHIPPED arrive with Sprint 4 (a shipment actually shipping);
 * PARTIALLY_SHIPPED is real, not reserved: one order can ship across
 * several shipments or leave backordered lines behind. DELIVERED / RETURNED
 * belong to later sprints and are NOT defined here.
 */
export const ERP_ORDER_STATUSES = [
  'NEW',
  'ALLOCATING',
  'READY_TO_PICK',
  'PARTIALLY_BACKORDERED',
  'BACKORDERED',
  'PICKING',
  'PICKED',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'CANCELLED',
  'EXCEPTION',
] as const;
export type ErpOrderStatus = (typeof ERP_ORDER_STATUSES)[number];

/**
 * Order-item fulfillment status (task §8) - the inventory-level fact.
 * EXTERNAL_FULFILLED（用户指示 2026-09-17）：FBO/FBP 等外部履约行——平台
 * 仓库持货发货，不占用内部库存、不进入拣货流程，业务状态随平台事件流转。
 */
export const ORDER_ITEM_FULFILLMENT_STATUSES = [
  'PENDING',
  'RESERVED',
  'BACKORDERED',
  'PICKED',
  'SHIPPED',
  'RELEASED',
  'EXTERNAL_FULFILLED',
] as const;
export type OrderItemFulfillmentStatus = (typeof ORDER_ITEM_FULFILLMENT_STATUSES)[number];

/** Order-item SKU-mapping status (task §7) - guessing a SKU is forbidden. */
export const ORDER_ITEM_MAPPING_STATUSES = ['PENDING', 'MAPPED', 'FAILED'] as const;
export type OrderItemMappingStatus = (typeof ORDER_ITEM_MAPPING_STATUSES)[number];

/**
 * Order interception status (task §57, frozen set). Sprint 3 only CREATES
 * rows (CREATED); the locate/return-to-stock workflow is a later sprint.
 */
export const ORDER_INTERCEPTION_STATUSES = [
  'CREATED',
  'ASSIGNED',
  'LOCATING',
  'INTERCEPTED',
  'FAILED',
  'RETURNED_TO_STOCK',
  'CLOSED',
] as const;
export type OrderInterceptionStatus = (typeof ORDER_INTERCEPTION_STATUSES)[number];

/** Reservation reference written by order allocation (task §20). */
export const ORDER_RESERVATION_REFERENCE_TYPE = 'ORDER' as const;
/** Idempotency key of an order line's reservation. */
export const orderReserveKey = (orderItemId: string): string => `ORDER_RESERVE:${orderItemId}`;
/** Idempotency key of an order line's cancel-release. */
export const orderReleaseKey = (orderItemId: string): string => `ORDER_RELEASE:${orderItemId}`;

/**
 * Dual-axis list filters (2026-09-15, docs/business-rules/orders.md §17a).
 * Axis 1 - logistics stage of the ORDER header:
 *   PENDING    erp_status NOT IN (SHIPPED, CANCELLED) - includes divergent
 *              orders (platform delivered but ERP not shipped) **except**
 *              external-fulfillment orders (see EXTERNAL)
 *   EXTERNAL   外部履约单（FBO/FBP/FBW/FBY，ERP 无可履约行）尚未平台妥投
 *              （用户指示 2026-10-16）：ERP 无内部动作，独立 Tab 收纳，
 *              不再混入「待处理」；平台发货后随 erp_status 转 SHIPPED 归入
 *              IN_TRANSIT，妥投后归入 COMPLETED。
 *   IN_TRANSIT erp_status = SHIPPED and platform stage not DELIVERED
 *              (platform_stage NULL counts as not delivered - unsynced)
 *   COMPLETED  erp_status = SHIPPED and platform_stage = DELIVERED（已签收）
 *   CANCELLED  erp_status = CANCELLED（已取消，2026-10-19 从「全部」独立成 Tab）
 */
export const ORDER_STAGE_FILTERS = [
  'PENDING',
  'EXTERNAL',
  'IN_TRANSIT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type OrderStageFilter = (typeof ORDER_STAGE_FILTERS)[number];

/**
 * 订单列表排序字段白名单（2026-10-14 用户指示：SKU 编码 / 下单时间 / 发货
 * 时限）。repository 只按这里的值映射 ORDER BY，防注入；排序语义见
 * order.repository 的 orderSortOf。
 */
export const ORDER_LIST_SORT_FIELDS = ['orderedAt', 'skuCode', 'shipmentDeadline'] as const;
export type OrderListSortField = (typeof ORDER_LIST_SORT_FIELDS)[number];

/**
 * Axis 2 - goods state chips (line-level facts, orders.md §17b). A chip is
 * answered by EXISTS subqueries so orders whose rollup status hides a line
 * problem (e.g. PARTIALLY_SHIPPED + one BACKORDERED line) stay findable.
 */
export const ORDER_GOODS_STATE_FILTERS = [
  'PURCHASED',
  'TO_PICK',
  'PICKING',
  'LABEL_PRINTED',
  'TO_SHIP',
  'BACKORDERED',
  'MAPPING_FAILED',
  'SHIPMENT_OVERDUE',
  'ABNORMAL',
] as const;
export type OrderGoodsStateFilter = (typeof ORDER_GOODS_STATE_FILTERS)[number];

/**
 * Platform-logistics stall threshold (dual-axis §2.4, user-ruled): an order
 * whose platform_stage has been IN_TRANSIT for longer than this raises
 * ORDER_TRACKING_STALLED. The clock anchors on the platform's OWN timestamp
 * (orders.platform_stage_changed_at), never our receive time.
 */
export const ORDER_TRACKING_STALL_DAYS = 3;
