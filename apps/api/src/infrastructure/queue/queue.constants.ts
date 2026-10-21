/**
 * Queue names, `wcies.` prefixed. Business queues (order-sync etc.) are added
 * in later sprints; Sprint 0 ships the test queue only.
 */
export const QUEUE_NAMES = {
  test: 'wcies.test',
  import: 'wcies.import',
  notification: 'wcies.notification',
  orderSync: 'wcies.order-sync',
  listingSync: 'wcies.listing-sync',
  webhook: 'wcies.webhook',
  scheduler: 'wcies.scheduler',
  media: 'wcies.media',
  categoryTree: 'wcies.category-tree',
  enrichment: 'wcies.enrichment',
  /** 面单后台任务：预取归档 + 终态清理（2026-10-21）。 */
  label: 'wcies.label',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
