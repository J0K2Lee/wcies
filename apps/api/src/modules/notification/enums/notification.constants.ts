/**
 * Notification typed constants (Sprint 4 task §47-§51; AGENTS.md §52:
 * business modules publish events, the Notification module decides channels).
 */

/** Domain event types consumed by the notification module (Sprint 4 set). */
export const NOTIFICATION_TYPES = [
  'ORDER_INTERCEPTION_REQUIRED',
  'ORDER_INTERCEPTION_FAILED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Delivery channels (task §49): SYSTEM must work; FEISHU needs config. */
export const NOTIFICATION_CHANNELS = ['SYSTEM', 'FEISHU'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Lifecycle (task §48). */
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Reference owners used by Sprint 4 publishers. */
export const NOTIFICATION_REFERENCE_TYPES = ['ORDER', 'ORDER_ITEM', 'ORDER_INTERCEPTION'] as const;
export type NotificationReferenceType = (typeof NOTIFICATION_REFERENCE_TYPES)[number];
