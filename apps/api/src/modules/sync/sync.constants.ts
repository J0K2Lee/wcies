/** Sync domain vocabulary (Sprint 5 task §10-§12). Centralized - no magic
 *  strings in services (AGENTS.md §64). */

export const SYNC_TYPES = [
  'LISTING_SYNC',
  'ORDER_SYNC',
  // Sprint 8.5: manual, store-credential-scoped reference-data syncs.
  'CATEGORY_TREE_SYNC',
  'PRODUCT_ENRICHMENT_SYNC',
] as const;
export type SyncType = (typeof SYNC_TYPES)[number];

export const SYNC_JOB_STATUSES = ['PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'] as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[number];

export const SYNC_TRIGGER_TYPES = ['MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY'] as const;
export type SyncTriggerType = (typeof SYNC_TRIGGER_TYPES)[number];

export const RAW_EVENT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'SKIPPED',
  'REJECTED',
] as const;
export type RawEventStatus = (typeof RAW_EVENT_STATUSES)[number];

/** Which queue serves which sync type. */
export const SYNC_TYPE_QUEUES: Record<
  SyncType,
  'orderSync' | 'listingSync' | 'categoryTree' | 'enrichment'
> = {
  ORDER_SYNC: 'orderSync',
  LISTING_SYNC: 'listingSync',
  CATEGORY_TREE_SYNC: 'categoryTree',
  PRODUCT_ENRICHMENT_SYNC: 'enrichment',
};

export const ORDER_SYNC_SOURCE = {
  POLLING: 'POLLING',
  WEBHOOK: 'WEBHOOK',
} as const;

/**
 * Store-level sync enablement (task §57 staged rollout): scheduled syncs only
 * run for stores whose `settings.sync` explicitly opts in. Manual sync is
 * always allowed.
 */
export interface StoreSyncSettings {
  orderSyncEnabled?: boolean;
  listingSyncEnabled?: boolean;
}

export function readStoreSyncSettings(settings: Record<string, unknown> | null): StoreSyncSettings {
  const sync = settings?.['sync'];
  if (typeof sync !== 'object' || sync === null) {
    return {};
  }
  const raw = sync as Record<string, unknown>;
  return {
    orderSyncEnabled: raw['orderSyncEnabled'] === true,
    listingSyncEnabled: raw['listingSyncEnabled'] === true,
  };
}

/** Payload of a wcies.webhook background job (raw event follow-up). */
export interface WebhookJobPayload {
  readonly rawEventId: string;
}
