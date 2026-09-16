/**
 * Sprint 10 transfer typed constants (AGENTS.md §64; transfer.md, frozen
 * 2026-09-17).
 */

export const TRANSFER_ORDER_STATUSES = ['DRAFT', 'CONFIRMED', 'CANCELLED'] as const;
export type TransferOrderStatus = (typeof TRANSFER_ORDER_STATUSES)[number];

/** Inventory idempotency keys per leg (transfer.md §5). */
export const transferOutKey = (lineId: string): string => `TRANSFER_OUT:${lineId}`;
export const transferInKey = (lineId: string): string => `TRANSFER_IN:${lineId}`;
