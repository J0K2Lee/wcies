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
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
