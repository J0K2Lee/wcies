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
  /**
   * Dual-axis T4 (2026-09-15, orders.md §16A): the platform logistics stage
   * has been IN_TRANSIT for more than 3 days with no movement. Reference:
   * ORDER/orderId. The stall clock anchors on the PLATFORM's own timestamp
   * (orders.platform_stage_changed_at), never our receive time. Evaluated on
   * EVERY fallback-rotation encounter (stalled orders are exactly the ones
   * where nothing changes); auto-resolved when the stage reaches DELIVERED /
   * CANCELLED - including via the pure re-read path (no webhook dependency).
   */
  'ORDER_TRACKING_STALLED',
  /**
   * Dual-axis T4 (2026-09-15, orders.md §15): the platform cancelled an
   * order that WCIES had already SHIPPED. The cancel chain still runs (other
   * lines release / intercept) but SHIPPED lines stay SHIPPED with stock
   * untouched - recovery is a return/refund process, not an in-warehouse
   * action. Reference: ORDER/orderId. Not auto-resolved: a human closes it
   * after the return path completes.
   */
  'ORDER_CANCELLED_AFTER_SHIP',
  /**
   * Dual-axis T5 (returns.md §2.2/§3.5): a platform return record cannot be
   * linked to any WCIES order (HIGH, reference PLATFORM_RETURN), or a return
   * batch item was inspected DEFECTIVE/LOST while linked to a platform
   * record (MEDIUM, reference RETURN_BATCH_ITEM - claim/appeal follow-up).
   */
  'RETURN_ORDER_NOT_FOUND',
  'RETURN_DIFFERENCE',
  /**
   * Order fulfillment flow (2026-09-18, orders.md §15C): the platform WRITE of
   * 「获取运单号」 (OZON 组包) failed with a platform/infrastructure error, or
   * the platform accepted the request but never confirmed assembly. Operator-
   * fixable preconditions (wrong platform status, unsupported platform, async
   * in progress) do NOT raise this - only genuine platform-side failures.
   * Reference: ORDER/orderId. Auto-resolved by the next successful prepare.
   */
  'ORDER_PLATFORM_SHIP_FAILED',
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
  /** A platform return record (dual-axis T5). */
  'PLATFORM_RETURN',
  /** One line of a return batch (dual-axis T5). */
  'RETURN_BATCH_ITEM',
] as const;
export type ExceptionReferenceType = (typeof EXCEPTION_REFERENCE_TYPES)[number];
