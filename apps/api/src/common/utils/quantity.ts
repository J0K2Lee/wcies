/**
 * Project-wide quantity strategy (Sprint 2 task §58).
 *
 * Inventory quantities are NUMERIC(18,3) in PostgreSQL and cross the API as
 * strings. TypeORM returns numeric columns as strings and JS `Number(...)`
 * conversions reintroduce float drift, so ALL quantity arithmetic in the
 * inventory core happens on integer milli-units (bigint) instead:
 *
 *   "12.345"  <->  12345n
 *
 * The scale is fixed at 3 (NUMERIC(18,3)), so a decimal library is not
 * needed; no new dependency is introduced (AGENTS.md §73).
 */

export const QTY_SCALE = 3;

const FACTOR = 10n ** BigInt(QTY_SCALE);
/** NUMERIC(18,3) allows 15 integer digits -> |milli| < 10^18. */
const MAX_ABS_MILLI = 10n ** 18n;

export class QuantityInvalidError extends Error {
  constructor(value: string | number) {
    super(`非法数量格式: ${String(value)}`);
    this.name = 'QuantityInvalidError';
  }
}

export class QuantityScaleError extends Error {
  constructor(value: string | number) {
    super(`数量最多 ${QTY_SCALE} 位小数: ${String(value)}`);
    this.name = 'QuantityScaleError';
  }
}

export class QuantityRangeError extends Error {
  constructor(value: string | number) {
    super(`数量超出 NUMERIC(18,3) 范围: ${String(value)}`);
    this.name = 'QuantityRangeError';
  }
}

/**
 * Parses a quantity into integer milli-units.
 * Accepts "3", "3.5", "3.500", "-2.25", 3, 3.5; rejects "", "abc", "1.2345",
 * "1e3", NaN/Infinity.
 */
export function parseQty(value: string | number): bigint {
  const text =
    typeof value === 'number'
      ? Number.isInteger(value)
        ? String(value)
        : String(value)
      : value.trim();
  if (text === '') {
    throw new QuantityInvalidError(value);
  }
  const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (match === null) {
    throw new QuantityInvalidError(value);
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const intPart = BigInt(match[2]!);
  const fracText = match[3] ?? '';
  if (fracText.length > QTY_SCALE) {
    throw new QuantityScaleError(value);
  }
  const fracPart = BigInt(fracText.padEnd(QTY_SCALE, '0') || '0');
  const milli = sign * (intPart * FACTOR + fracPart);
  if (milli >= MAX_ABS_MILLI || milli <= -MAX_ABS_MILLI) {
    throw new QuantityRangeError(value);
  }
  return milli;
}

/** Formats milli-units back to the canonical NUMERIC(18,3) string, e.g. "12.345". */
export function formatQty(milli: bigint): string {
  if (milli >= MAX_ABS_MILLI || milli <= -MAX_ABS_MILLI) {
    throw new QuantityRangeError(milli.toString());
  }
  const negative = milli < 0n;
  const abs = negative ? -milli : milli;
  const intPart = abs / FACTOR;
  const fracPart = (abs % FACTOR).toString().padStart(QTY_SCALE, '0');
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/** Entity numeric columns are strings; this re-parses them for math. */
export function qtyFromDb(value: string | null): bigint {
  if (value === null) {
    return 0n;
  }
  return parseQty(value);
}

/** Adds milli-unit quantities with range protection. */
export function addQty(a: bigint, b: bigint): bigint {
  const sum = a + b;
  if (sum >= MAX_ABS_MILLI || sum <= -MAX_ABS_MILLI) {
    throw new QuantityRangeError(sum.toString());
  }
  return sum;
}

/** True when the textual quantity is a positive value (> 0). */
export function isPositiveQty(value: string | null): boolean {
  return value !== null && parseQty(value) > 0n;
}
