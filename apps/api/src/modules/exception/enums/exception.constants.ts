/**
 * Exception-center typed constants (AGENTS.md §64 / Sprint 3 task §26-§27).
 * Adding a value here is a business-rule change and must be reflected in
 * docs/business-rules/orders.md.
 */

/** Sprint 3 exception types (task §26). */
export const EXCEPTION_TYPES = [
  'ORDER_SKU_MAPPING_FAILED',
  'ORDER_OUT_OF_STOCK',
  'ORDER_INVALID_STATE',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/** Technical severity ladder for the minimal center (task §25 field). */
export const EXCEPTION_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ExceptionSeverity = (typeof EXCEPTION_SEVERITIES)[number];

/** Lifecycle: never physically deleted (task §27). */
export const EXCEPTION_STATUSES = ['OPEN', 'RESOLVED', 'IGNORED'] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

/** Reference owners used by Sprint 3 creators. */
export const EXCEPTION_REFERENCE_TYPES = ['ORDER', 'ORDER_ITEM'] as const;
export type ExceptionReferenceType = (typeof EXCEPTION_REFERENCE_TYPES)[number];
