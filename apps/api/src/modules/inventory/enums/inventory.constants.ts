/**
 * Sprint 2 typed business constants (AGENTS.md §64: no scattered magic
 * strings; adding a value here is a business-rule change that must be
 * reflected in docs/business-rules/inventory.md).
 */

/** Inventory quality condition (task §5; only SELLABLE participates in sellable stock). */
export const INVENTORY_CONDITIONS = [
  'SELLABLE',
  'QC_PENDING',
  'DEFECTIVE',
  'REPAIR',
  'SCRAPPED',
] as const;
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number];

/** Reservation header status (task §15). */
export const RESERVATION_STATUSES = [
  'ACTIVE',
  'PICKED',
  'RELEASED',
  'CONSUMED',
  'CANCELLED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Reservation line status - mirrors header transitions per bin line. */
export const RESERVATION_LINE_STATUSES = ['ACTIVE', 'PICKED', 'RELEASED', 'CONSUMED'] as const;
export type ReservationLineStatus = (typeof RESERVATION_LINE_STATUSES)[number];

/**
 * Legal reservation header transitions (task §29/§31/§33/§34).
 * CANCELLED exists for the future order-cancel flow; Sprint 2 release covers
 * cancel-before-pick at the inventory level, so no Sprint 2 transition
 * enters CANCELLED.
 */
export const RESERVATION_TRANSITIONS: Readonly<
  Record<ReservationStatus, readonly ReservationStatus[]>
> = {
  ACTIVE: ['PICKED', 'RELEASED'],
  PICKED: ['ACTIVE', 'CONSUMED'],
  RELEASED: [],
  CONSUMED: [],
  CANCELLED: [],
};

/**
 * Business event / transaction types (task §16, §20-§38). One per inventory
 * core action; future modules (purchase/transfer/return) add their own types
 * instead of reusing these. RETURN_PICKED is the Sprint 4 interception
 * return-to-stock primitive: Picked - N while On Hand stays untouched
 * (picking never reduced it).
 */
export const INVENTORY_EVENT_TYPES = [
  'INITIAL_STOCK',
  'RECEIVE',
  'RESERVE',
  'RELEASE',
  'PICK',
  'UNPICK',
  'SHIP',
  'RETURN_PICKED',
  /**
   * 未拣余量释放（2026-11-03，拣货中取消）：只把预约里「还没拣」的数量退回
   * 可售，已拣部分保持 Picked（由拦截任务找回）。与 RELEASE 的区别：RELEASE
   * 释放整行数量，对部分拣的行会把 reserved 减成负数。
   */
  'RELEASE_REMAINDER',
  'MOVE_BIN',
  'MANUAL_ADJUSTMENT',
  /**
   * Warehouse-to-warehouse transfer legs (Sprint 10, transfer.md §5): OUT
   * decrements the source bin, IN increments the destination bin; both are
   * written by the SAME transfer-order confirmation transaction.
   */
  'TRANSFER_OUT',
  'TRANSFER_IN',
] as const;
export type InventoryEventType = (typeof INVENTORY_EVENT_TYPES)[number];

export const INVENTORY_TRANSACTION_TYPES = INVENTORY_EVENT_TYPES;
export type InventoryTransactionType = InventoryEventType;

/**
 * Business source of an inventory action (task §14): reservations/events are
 * decoupled from the future Order module via generic references. IMPORT is
 * used by the INITIAL_INVENTORY import template (task §46-§47).
 * PURCHASE_RECEIPT marks receive-stock lines written by purchase-receipt
 * confirmation (Sprint 7, user-confirmed Q1, decision 0013 §5) so the ledger
 * reconciles by document origin instead of reading as manual adjustments.
 */
export const INVENTORY_REFERENCE_TYPES = [
  'MANUAL',
  'TEST',
  'ORDER',
  'IMPORT',
  'PURCHASE_RECEIPT',
  /**
   * Return-batch inspection write-back (returns.md §3.3): SELLABLE/DEFECTIVE
   * goods physically returned through a return batch re-enter the ledger via
   * receiveStockInTx with this reference (referenceId = return batch item).
   */
  'RETURN_RECEIPT',
  /**
   * Transfer-order stock writes (Sprint 10, transfer.md §5):
   * referenceId = transfer order line id on both legs.
   */
  'TRANSFER',
] as const;
export type InventoryReferenceType = (typeof INVENTORY_REFERENCE_TYPES)[number];

/** Reservation references in the first phase (task §14). */
export const RESERVATION_REFERENCE_TYPES = ['TEST', 'MANUAL', 'ORDER'] as const;
export type ReservationReferenceType = (typeof RESERVATION_REFERENCE_TYPES)[number];

/** Computed row availability for the inventory list API (task §41 `status`). */
export const INVENTORY_ROW_STATUSES = ['IN_STOCK', 'OUT_OF_STOCK'] as const;
export type InventoryRowStatus = (typeof INVENTORY_ROW_STATUSES)[number];

/**
 * Serial-tracked unit status (Sprint 3 task §42). SN is per-unit tracking
 * detail, never a second stock fact source; SHIPPED belongs to the Shipment
 * sprint and is never entered in Sprint 3.
 */
export const INVENTORY_SERIAL_STATUSES = ['IN_STOCK', 'RESERVED', 'PICKED', 'SHIPPED'] as const;
export type InventorySerialStatus = (typeof INVENTORY_SERIAL_STATUSES)[number];
