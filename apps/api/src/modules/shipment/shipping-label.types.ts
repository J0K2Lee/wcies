/**
 * 面单模块的公开类型（跨模块可用，AGENTS §9）。
 *
 * 放在模块根目录而不是 `repositories/` / `entities/`：sync 层的清理任务需要
 * 描述「清理候选」与游标，但不得跨模块 import 对方的仓库内部实现。
 */

/** One row the background purge sweep may delete the object bytes for. */
export interface ShippingLabelPurgeCandidate {
  id: string;
  objectKey: string;
  fileName: string;
  createdAt: Date;
}

/** Keyset cursor of the purge sweep (ordered by createdAt, then id). */
export interface ShippingLabelPurgeCursor {
  createdAt: Date;
  id: string;
}
