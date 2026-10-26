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

/**
 * Trigger vocabulary. SYSTEM = a sync the system chained after another
 * finished (e.g. OZON LISTING_SYNC auto-dispatches PRODUCT_ENRICHMENT_SYNC so
 * the onboarding weight/dims prefill stays fresh with no manual step).
 */
export const SYNC_TRIGGER_TYPES = ['MANUAL', 'SCHEDULED', 'WEBHOOK', 'RETRY', 'SYSTEM'] as const;
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
 * Platforms whose product attributes need a dedicated v4 attributes pass
 * (variant rows otherwise carry no usable weight/dimensions). LISTING_SYNC
 * chains the enrichment automatically for these (2026-10-05, two steps in
 * one) - the manual trigger stays as a repair path. WB/Yandex harvest their
 * attributes natively in the listing mappers and must NOT be chained (the
 * standalone run would fail as unsupported).
 */
export const ENRICHMENT_SUPPORTED_PLATFORMS: readonly string[] = ['OZON'];

/** 自动轮询间隔（分钟）：店铺可在 `settings.sync.*SyncIntervalMinutes` 覆盖系统默认。 */
export const SYNC_INTERVAL_MINUTES_OPTIONS = [1, 5, 10, 15, 30, 60] as const;

/** 每种同步类型允许的最小间隔（分钟）：订单高频安全，商品链接受平台限流约束。 */
export const SYNC_INTERVAL_FLOOR_MINUTES: Record<'ORDER_SYNC' | 'LISTING_SYNC', number> = {
  ORDER_SYNC: 1,
  LISTING_SYNC: 5,
};

/**
 * 间隔上限：30 天。店铺侧以「数字 + 单位（分/小时/天）」填写，所以上限必须容得下
 * 按天表达的值；再大就属于「基本不同步」，应当直接关掉开关。
 */
export const SYNC_INTERVAL_MAX_MINUTES = 43_200;

/**
 * Store-level sync enablement (task §57 staged rollout): scheduled syncs only
 * run for stores whose `settings.sync` explicitly opts in. Manual sync is
 * always allowed.
 *
 * 2026-10-26（用户要求「自动同步的频率应该可以设置」）：间隔也可以按店铺设置，
 * 缺省跟随 ENV 里的系统默认（`ORDER_SYNC_INTERVAL_SECONDS` 等）。
 */
export interface StoreSyncSettings {
  orderSyncEnabled?: boolean;
  listingSyncEnabled?: boolean;
  /** 店铺自定义订单轮询间隔（分钟）；null = 跟随系统默认。 */
  orderSyncIntervalMinutes: number | null;
  /** 店铺自定义商品链接轮询间隔（分钟）；null = 跟随系统默认。 */
  listingSyncIntervalMinutes: number | null;
}

/**
 * 店铺自定义间隔的容错解析：只接受 floor..1440 的整数分钟；非法值（含低于平台
 * 安全下限的）一律视为「跟随系统默认」，不静默改写成别的频率。
 */
function readIntervalMinutes(raw: unknown, floor: number): number | null {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < floor || parsed > SYNC_INTERVAL_MAX_MINUTES) {
    return null;
  }
  return parsed;
}

export function readStoreSyncSettings(settings: Record<string, unknown> | null): StoreSyncSettings {
  const sync = settings?.['sync'];
  if (typeof sync !== 'object' || sync === null) {
    return {
      orderSyncIntervalMinutes: null,
      listingSyncIntervalMinutes: null,
    };
  }
  const raw = sync as Record<string, unknown>;
  return {
    orderSyncEnabled: raw['orderSyncEnabled'] === true,
    listingSyncEnabled: raw['listingSyncEnabled'] === true,
    orderSyncIntervalMinutes: readIntervalMinutes(
      raw['orderSyncIntervalMinutes'],
      SYNC_INTERVAL_FLOOR_MINUTES.ORDER_SYNC,
    ),
    listingSyncIntervalMinutes: readIntervalMinutes(
      raw['listingSyncIntervalMinutes'],
      SYNC_INTERVAL_FLOOR_MINUTES.LISTING_SYNC,
    ),
  };
}

/**
 * 生效间隔（分钟），调度器与店铺同步概览共用：
 *
 * - ENV 秒数为 0 = **系统级关闭**：店铺自定义值不能把它重新打开（null）；
 * - 店铺有自定义值时按分钟取用，并夹到该类型的安全下限（商品链接 5 分钟）；
 * - 店铺没设置时用 ENV 系统默认（同样夹到下限，避免 ENV 配得过低）。
 */
export function effectiveSyncIntervalMinutes(
  storeMinutes: number | null,
  envSeconds: number,
  syncType: 'ORDER_SYNC' | 'LISTING_SYNC',
): number | null {
  if (!Number.isFinite(envSeconds) || envSeconds <= 0) {
    return null;
  }
  const floorMinutes = SYNC_INTERVAL_FLOOR_MINUTES[syncType];
  if (storeMinutes !== null) {
    return Math.max(storeMinutes, floorMinutes);
  }
  return Math.max(envSeconds, floorMinutes * 60) / 60;
}

/**
 * Sprint 9 T2 (decision 3): a store's (SYNC_FAILED, STORE) exception opens
 * once ANY of its sync types fails this many times in a row, and resolves
 * when every sync type of the store is healthy again.
 */
export const SYNC_FAILED_CONSECUTIVE_FAILURES = 3;

/** Payload of a wcies.webhook background job (raw event follow-up). */
export interface WebhookJobPayload {
  readonly rawEventId: string;
}
