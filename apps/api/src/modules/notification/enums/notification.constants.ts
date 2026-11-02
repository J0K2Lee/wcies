import { NOTIFICATION_EVENTS } from '../events/notification-events';

/**
 * Notification typed constants (Sprint 4 task §47-§51; AGENTS.md §52:
 * business modules publish events, the Notification module decides channels).
 */

/**
 * 可用的通知事件类型（从事件目录派生）。
 *
 * 2026-11-02 修复：这里原本手写四个事件，新增事件只登记到事件目录时，订阅接口
 * 的 `@IsIn` 会以 400 拒绝（实测订阅「买家新消息」报
 * `eventType must be one of …ORDER_INTERCEPTION_REQUIRED…`）。改为从
 * `NOTIFICATION_EVENTS` 派生——目录里有什么就能订阅什么，两处清单不会再漂移。
 */
export const NOTIFICATION_TYPES: readonly string[] = Object.keys(NOTIFICATION_EVENTS);
export type NotificationType = keyof typeof NOTIFICATION_EVENTS;

/** Delivery channels (task §49): SYSTEM must work; FEISHU needs config. */
export const NOTIFICATION_CHANNELS = ['SYSTEM', 'FEISHU'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Lifecycle (task §48). */
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED', 'CANCELLED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Reference owners used by Sprint 4 publishers. */
export const NOTIFICATION_REFERENCE_TYPES = ['ORDER', 'ORDER_ITEM', 'ORDER_INTERCEPTION'] as const;
export type NotificationReferenceType = (typeof NOTIFICATION_REFERENCE_TYPES)[number];
