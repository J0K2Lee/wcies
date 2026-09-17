/**
 * Sprint 3 typed order constants (AGENTS.md §64: no scattered magic
 * strings; adding a value here is a business-rule change that must be
 * reflected in docs/business-rules/orders.md).
 */

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
 *              orders (platform delivered but ERP not shipped)
 *   IN_TRANSIT erp_status = SHIPPED and platform stage not DELIVERED
 *              (platform_stage NULL counts as not delivered - unsynced)
 *   COMPLETED  erp_status = SHIPPED and platform_stage = DELIVERED
 */
export const ORDER_STAGE_FILTERS = ['PENDING', 'IN_TRANSIT', 'COMPLETED'] as const;
export type OrderStageFilter = (typeof ORDER_STAGE_FILTERS)[number];

/**
 * Axis 2 - goods state chips (line-level facts, orders.md §17b). A chip is
 * answered by EXISTS subqueries so orders whose rollup status hides a line
 * problem (e.g. PARTIALLY_SHIPPED + one BACKORDERED line) stay findable.
 */
export const ORDER_GOODS_STATE_FILTERS = [
  'TO_PICK',
  'PICKING',
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
