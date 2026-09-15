/**
 * Return-domain typed constants (dual-axis T5, 2026-09-15; AGENTS.md §64:
 * adding a value here is a business-rule change that must be reflected in
 * docs/business-rules/returns.md).
 */

/** Return batch status machine (returns.md §3.2, frozen). */
export const RETURN_BATCH_STATUSES = ['DRAFT', 'RECEIVED', 'COMPLETED', 'CANCELLED'] as const;
export type ReturnBatchStatus = (typeof RETURN_BATCH_STATUSES)[number];

/**
 * Inspection verdict of a return batch item (returns.md §3.3). PENDING =
 * not yet inspected; the three terminal values are one-shot write-once -
 * SELLABLE/DEFECTIVE write stock back, LOST records nothing.
 */
export const RETURN_ITEM_CONDITIONS = ['PENDING', 'SELLABLE', 'DEFECTIVE', 'LOST'] as const;
export type ReturnItemCondition = (typeof RETURN_ITEM_CONDITIONS)[number];

/** Idempotency key of a return item's stock write-back (returns.md §7). */
export const returnReceiptKey = (batchItemId: string): string => `RETURN_RECEIPT:${batchItemId}`;
