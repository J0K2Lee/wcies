/**
 * Sprint 3 typed picking constants (AGENTS.md §64; adding a value here is a
 * business-rule change and must be reflected in docs/business-rules/orders.md).
 */

/** Picking task status (task §30). */
export const PICKING_TASK_STATUSES = ['CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type PickingTaskStatus = (typeof PICKING_TASK_STATUSES)[number];

/** Picking item status (task §31) - a rejected scan adds NO new status. */
export const PICKING_ITEM_STATUSES = ['PENDING', 'PICKED'] as const;
export type PickingItemStatus = (typeof PICKING_ITEM_STATUSES)[number];
