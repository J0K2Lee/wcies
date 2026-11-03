/**
 * Sprint 3 typed picking constants (AGENTS.md §64; adding a value here is a
 * business-rule change and must be reflected in docs/business-rules/orders.md).
 */

/** Picking task status (task §30). */
export const PICKING_TASK_STATUSES = ['CREATED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type PickingTaskStatus = (typeof PICKING_TASK_STATUSES)[number];

/** Picking item status (task §31) - a rejected scan adds NO new status. */
export const PICKING_ITEM_STATUSES = [
  'PENDING',
  'PICKED',
  /**
   * 订单在该行拣完前被取消（2026-11-03）：已拣部分进拦截，剩余不再拣。
   * 行保留不删——审计需要知道「撤了几件、为什么」。
   */
  'CANCELLED',
] as const;
export type PickingItemStatus = (typeof PICKING_ITEM_STATUSES)[number];
