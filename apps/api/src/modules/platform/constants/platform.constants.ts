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

export function platformCodeOfFulfillmentMode(mode: FulfillmentMode): PlatformCode {
  return FULFILLMENT_MODE_PLATFORM[mode];
}

export function isFulfillmentMode(value: string): value is FulfillmentMode {
  return (FULFILLMENT_MODES as readonly string[]).includes(value);
}
