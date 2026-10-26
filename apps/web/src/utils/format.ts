/**
 * Shared display formatters (Phase 2 task §45-§46): one time format per context,
 * grouped numbers, and compact durations. Pages must not hand-roll date strings.
 */

import { formatQtyText } from '@wcies/shared';

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
 * 数量显示（用户规则 2026-10-26）：**整数**。
 *
 * 后端数量以「毫单位」存、按 3 位小数返回（"1.000"），业务口径是整件；整数值
 * 直接显示为整数（带千分位）。历史/异常数据若真的带小数，保留最多 3 位小数——
 * 宁可显示 1.5，也不静默四舍五入成 2。
 */
export function fmtQty(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return formatQtyText(value);
}

/**
 * 货币显示（用户规则 2026-10-26，方案 B）：**金额 + ISO 4217 代码后缀**。
 *
 *   fmtMoney('320.5500', 'CNY')  → '320.55 CNY'
 *   fmtMoney('5879.0000', 'RUB') → '5,879.00 RUB'
 *   fmtMoney('643', '643')       → '6.43 RUB'（数字码先归一化）
 *
 * 为什么不用符号：¥ 同时是 CNY/JPY，$ 覆盖多种货币，多种卢布（RUB/BYN/KZT）
 * 靠符号更分不出来。代码是唯一标识，新币种零成本接入，右对齐时数字部分也整齐。
 * 符号只允许出现在文案里，不进入数值区。
 *
 * 币种是**必填参数**（用户 2026-10-26）：我们没有「默认币种」这回事——漏传就是
 * 没想清楚这条数据用什么币种。调用方必须显式给（可以是 null 表示「未知」），
 * 未知时显示 '320.55 —'，绝不默认成人民币。
 */
export function fmtMoney(
  value: string | number | null | undefined,
  currency: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    return String(value);
  }
  const body = num.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const code = normalizeCurrencyCode(currency);
  return code === null ? `${body} —` : `${body} ${code}`;
}

/**
 * 币种码归一化（展示层防御）：ISO 数字码 → 字母码。
 * 后端摄入时已归一化，这里只兜住历史数据/新数据源。
 */
const ISO_NUMERIC_CURRENCIES: Record<string, string> = {
  '643': 'RUB',
  '810': 'RUB',
  '156': 'CNY',
  '840': 'USD',
  '978': 'EUR',
  '398': 'KZT',
  '933': 'BYN',
};

export function normalizeCurrencyCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  if (raw === '') {
    return null;
  }
  const mapped = ISO_NUMERIC_CURRENCIES[raw];
  if (mapped !== undefined) {
    return mapped;
  }
  const upper = raw.toUpperCase();
  return upper === 'RUR' ? 'RUB' : upper;
}

/** Money cell with sign semantics: expenses render in danger color tokens. */
export function moneyTone(direction: string): 'success' | 'danger' {
  return direction === 'INCOME' ? 'success' : 'danger';
}
