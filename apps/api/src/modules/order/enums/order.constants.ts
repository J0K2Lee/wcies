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

/** Order-item fulfillment status (task §8) - the inventory-level fact. */
export const ORDER_ITEM_FULFILLMENT_STATUSES = [
  'PENDING',
  'RESERVED',
  'BACKORDERED',
  'PICKED',
  'SHIPPED',
  'RELEASED',
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
