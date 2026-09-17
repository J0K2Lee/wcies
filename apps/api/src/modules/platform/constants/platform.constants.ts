export const PLATFORM_CODES = ['OZON', 'WB', 'YANDEX'] as const;
export type PlatformCode = (typeof PLATFORM_CODES)[number];

export const PLATFORM_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PlatformStatus = (typeof PLATFORM_STATUSES)[number];

export const PLATFORM_STATUS_ACTIVE: PlatformStatus = 'ACTIVE';

/**
 * First-stage fulfillment-mode vocabulary (Sprint 1 spec §41). The DB stores
 * VARCHAR; this typed constant is the application-level contract. Platform
 * semantics live here + in bindings - never in the inventory core
 * (AGENTS.md §31).
 */
export const FULFILLMENT_MODES = [
  'OZON_RFBS',
  'OZON_FBS',
  'OZON_FBO',
  'OZON_FBP',
  'WB_FBS',
  'WB_FBW',
  'YANDEX_FBS',
  'YANDEX_FBY',
] as const;
export type FulfillmentMode = (typeof FULFILLMENT_MODES)[number];

/** Each fulfillment mode belongs to exactly one platform. */
const FULFILLMENT_MODE_PLATFORM: Record<FulfillmentMode, PlatformCode> = {
  OZON_RFBS: 'OZON',
  OZON_FBS: 'OZON',
  OZON_FBO: 'OZON',
  OZON_FBP: 'OZON',
  WB_FBS: 'WB',
  WB_FBW: 'WB',
  YANDEX_FBS: 'YANDEX',
  YANDEX_FBY: 'YANDEX',
};

/**
 * Business category of a fulfillment mode (business-model layer, 2026-09-11).
 *
 * The stored value stays platform-specific (OZON_FBO ...) because order
 * ingestion and the adapters branch on it - e.g. orders.md §4.6 prefers
 * non-FBO bindings as inventory source, implemented as
 * `fulfillmentMode.includes('FBO')` in OrderIngestionService. This category
 * is a DERIVED, display-facing grouping only: it answers "who holds and ships
 * the goods?" in the seller's vocabulary. It is never persisted, so it can
 * not drift from the mode it is derived from.
 */
export const FULFILLMENT_CATEGORIES = ['SELF_MANAGED', 'SEMI_MANAGED', 'MANAGED'] as const;
export type FulfillmentCategory = (typeof FULFILLMENT_CATEGORIES)[number];

/**
 * 自管仓   - seller holds the stock and fulfils the order (incl. shipping to a
 *            platform sorting hub, which is still seller-side stock).
 * 半托管   - seller supplies stock to a platform-partner warehouse; the
 *            platform runs cross-border delivery and last mile.
 * 托管仓   - the platform warehouse holds the stock and ships it.
 */
const FULFILLMENT_MODE_CATEGORY: Record<FulfillmentMode, FulfillmentCategory> = {
  OZON_RFBS: 'SELF_MANAGED',
  OZON_FBS: 'SELF_MANAGED',
  WB_FBS: 'SELF_MANAGED',
  YANDEX_FBS: 'SELF_MANAGED',
  OZON_FBP: 'SEMI_MANAGED',
  OZON_FBO: 'MANAGED',
  WB_FBW: 'MANAGED',
  YANDEX_FBY: 'MANAGED',
};

export function platformCodeOfFulfillmentMode(mode: FulfillmentMode): PlatformCode {
  return FULFILLMENT_MODE_PLATFORM[mode];
}

export function fulfillmentCategoryOf(mode: FulfillmentMode): FulfillmentCategory {
  return FULFILLMENT_MODE_CATEGORY[mode];
}

/** Modes a store of the given platform may bind (store platform must match). */
export function fulfillmentModesForPlatform(platformCode: PlatformCode): FulfillmentMode[] {
  return FULFILLMENT_MODES.filter((mode) => FULFILLMENT_MODE_PLATFORM[mode] === platformCode);
}

export function isFulfillmentMode(value: string): value is FulfillmentMode {
  return (FULFILLMENT_MODES as readonly string[]).includes(value);
}

/**
 * 外部履约判定（用户指示 2026-09-17）：半托管 / 托管仓模式的履约流程在
 * 平台侧完成，业务状态随 webhook / 平台事实自动流转，不进入内部
 * 预留-拣货-发货流程。
 *
 * 订单头存的履约模式有两种形态：绑定用的是完整常量（OZON_FBO），而订单
 * 摄入来自平台 mapper 的短码（FBO / FBP / FBW / FBY）。两种都要识别。
 */
const EXTERNAL_FULFILLMENT_TOKENS = ['FBO', 'FBP', 'FBW', 'FBY'] as const;

export function isExternalFulfillmentMode(mode: string | null | undefined): boolean {
  if (typeof mode !== 'string' || mode === '') {
    return false;
  }
  const normalized = isFulfillmentMode(mode) ? FULFILLMENT_MODE_CATEGORY[mode] : mode;
  if (normalized === 'MANAGED' || normalized === 'SEMI_MANAGED') {
    return true;
  }
  const suffix = mode.includes('_') ? mode.slice(mode.lastIndexOf('_') + 1) : mode;
  return (EXTERNAL_FULFILLMENT_TOKENS as readonly string[]).includes(suffix);
}
