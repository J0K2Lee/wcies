/**
 * 自动同步频率的「数字 + 单位」换算（用户 2026-10-26）。
 *
 * 落库统一是分钟（settings.sync.*SyncIntervalMinutes），单位只影响输入与展示；
 * 下限/上限与后端 sync.constants.ts 的 SYNC_INTERVAL_FLOOR_MINUTES /
 * SYNC_INTERVAL_MAX_MINUTES 保持一致。
 */
export const SYNC_INTERVAL_UNITS = [
  { value: 'MINUTE', label: '分钟', factor: 1 },
  { value: 'HOUR', label: '小时', factor: 60 },
  { value: 'DAY', label: '天', factor: 1_440 },
] as const;

export type SyncIntervalUnit = (typeof SYNC_INTERVAL_UNITS)[number]['value'];

export const SYNC_INTERVAL_FLOOR = { ORDER_SYNC: 1, LISTING_SYNC: 5 } as const;

export const SYNC_INTERVAL_MAX_MINUTES = 43_200;

export function intervalFactor(unit: SyncIntervalUnit): number {
  return SYNC_INTERVAL_UNITS.find((item) => item.value === unit)?.factor ?? 1;
}

/** 默认用能整除的最大单位展示：120 → 2 小时，2880 → 2 天，90 → 90 分钟。 */
export function preferredUnit(minutes: number): SyncIntervalUnit {
  if (minutes % 1_440 === 0) {
    return 'DAY';
  }
  if (minutes % 60 === 0) {
    return 'HOUR';
  }
  return 'MINUTE';
}

export interface SyncIntervalDraft {
  amount: number | null;
  unit: SyncIntervalUnit;
}

export function toDraftInterval(minutes: number | null): SyncIntervalDraft {
  if (minutes === null) {
    return { amount: null, unit: 'MINUTE' };
  }
  const unit = preferredUnit(minutes);
  return { amount: minutes / intervalFactor(unit), unit };
}

/** 换单位时按总时长换算，四舍五入到 2 位小数（90 分钟 → 1.5 小时）。 */
export function convertDraft(draft: SyncIntervalDraft, unit: SyncIntervalUnit): SyncIntervalDraft {
  if (draft.amount === null) {
    return { amount: null, unit };
  }
  const totalMinutes = draft.amount * intervalFactor(draft.unit);
  return { amount: Math.round((totalMinutes / intervalFactor(unit)) * 100) / 100, unit };
}

/** 草稿 → 落库分钟数（夹到该业务的下限与全局上限）；空值返回 null。 */
export function draftToMinutes(draft: SyncIntervalDraft, floorMinutes: number): number | null {
  if (draft.amount === null || draft.amount <= 0) {
    return null;
  }
  return Math.min(
    Math.max(Math.round(draft.amount * intervalFactor(draft.unit)), floorMinutes),
    SYNC_INTERVAL_MAX_MINUTES,
  );
}

/** 「实际生效」文案：整天/整小时用大单位，否则按分钟。 */
export function formatInterval(minutes: number): string {
  if (minutes % 1_440 === 0) {
    return `每 ${minutes / 1_440} 天`;
  }
  if (minutes % 60 === 0) {
    return `每 ${minutes / 60} 小时`;
  }
  if (minutes > 60) {
    return `每 ${(minutes / 60).toFixed(1)} 小时`;
  }
  return `每 ${minutes} 分钟`;
}
