/**
 * Shared display formatters (Phase 2 task §45-§46): one time format per context,
 * grouped numbers, and compact durations. Pages must not hand-roll date strings.
 */

/** Absolute timestamp for tooltips / detail views: 2026-09-10 16:30:22 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Historical timestamp for table columns: 2026-09-08 14:20 */
export function fmtDateTimeShort(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** Date-only label for period fields (对账期间等): 2026-09-08 */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Relative label for recent events: 5 分钟前 / 3 小时前 / 2 天前. */
export function relativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) {
    return iso;
  }
  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days} 天前`;
  }
  return fmtDateTimeShort(iso);
}

/** Compact duration: 4200 → "4.2 秒", 130000 → "2 分 10 秒". */
export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} 秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return `${minutes} 分 ${restSeconds} 秒`;
}

/** Grouped integer: 1234 → "1,234". */
export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString('zh-CN');
}

/**
 * Money display (UI spec §9): NUMERIC strings from the backend are shown
 * as-is with thousand separators + the currency mark; NULL is the long
 * dash (a missing fact is never rendered as 0).
 */
export function fmtMoney(value: string | null | undefined, currency?: string | null): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    return value;
  }
  const mark = currency === 'CNY' || currency === undefined || currency === null ? '¥' : currency;
  const body = num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return mark === '¥' ? `¥${body}` : `${body} ${mark}`;
}

/** Money cell with sign semantics: expenses render in danger color tokens. */
export function moneyTone(direction: string): 'success' | 'danger' {
  return direction === 'INCOME' ? 'success' : 'danger';
}
