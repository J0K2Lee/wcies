/**
 * Purchase-domain typed constants (AGENTS.md §64: no scattered magic
 * strings). Adding a value is a business-rule change that must be reflected
 * in docs/business-rules/purchase.md first.
 */

/** Purchase order lifecycle (purchase.md §3.2; decision 0013). */
export const PURCHASE_ORDER_STATUSES = [
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** Purchase receipt lifecycle (purchase.md §4.2): RECEIVED is irreversible. */
export const PURCHASE_RECEIPT_STATUSES = ['DRAFT', 'RECEIVED', 'CANCELLED'] as const;
export type PurchaseReceiptStatus = (typeof PURCHASE_RECEIPT_STATUSES)[number];

/**
 * Derived per-order-line procurement state (purchase.md §3.5). NEVER stored
 * on order_items - always recomputed from purchase_order_items (AGENTS.md
 * §13: derived values must not become a second source of truth).
 */
export const PROCUREMENT_STATES = ['NOT_ORDERED', 'ORDERED', 'ARRIVED'] as const;
export type ProcurementState = (typeof PROCUREMENT_STATES)[number];
