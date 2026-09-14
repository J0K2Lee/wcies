/**
 * Exception-center typed constants (AGENTS.md §64 / Sprint 3 task §26-§27).
 * Adding a value here is a business-rule change and must be reflected in
 * docs/business-rules/orders.md.
 */

/** Exception types (Sprint 3 task §26; Sprint 4 adds interception failure). */
export const EXCEPTION_TYPES = [
  'ORDER_SKU_MAPPING_FAILED',
  'ORDER_OUT_OF_STOCK',
  'ORDER_INVALID_STATE',
  'ORDER_INTERCEPTION_FAILED',
  /**
   * Sprint 7 (user-confirmed Q3, orders.md §16): platform shipment deadline
   * is near (<24h) or already past on an order that has not fully shipped.
   * Reference: ORDER/orderId. Auto-resolved on SHIPPED / CANCELLED.
   */
  'ORDER_SHIPMENT_DEADLINE_NEAR',
  /**
   * Sprint 9 T2 (decision 3): a store's scheduled sync keeps failing. One
   * OPEN row per store (reference STORE/storeId); details carries the
   * per-syncType consecutive-failure counts. Auto-resolved as soon as every
   * sync type of the store is healthy again.
   */
  'SYNC_FAILED',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/** Technical severity ladder for the minimal center (task §25 field). */
export const EXCEPTION_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

/** Lifecycle: never physically deleted (task §27). */
export const EXCEPTION_STATUSES = ['OPEN', 'RESOLVED', 'IGNORED'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

/** Reference owners used by exception creators (STORE since Sprint 9 T2). */
export const EXCEPTION_REFERENCE_TYPES = [
  'ORDER',
  'ORDER_ITEM',
  'ORDER_INTERCEPTION',
  'STORE',
] as const;
export type ExceptionReferenceType = (typeof EXCEPTION_REFERENCE_TYPES)[number];
