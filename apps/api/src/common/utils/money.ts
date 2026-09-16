/**
 * Money helpers for NUMERIC(18,4) columns (AGENTS.md §58: financial amounts
 * are DECIMAL in the DB and travel as strings; all arithmetic here is BigInt
 * on a fixed 1e-4 scale so floating point can never touch an amount).
 *
 * Quantities are the 1e-3-scale millis of common/utils/quantity.ts.
 */

import { parseQty } from './quantity';

export const MONEY_SCALE = 4n;
const MONEY_SCALE_FACTOR = 10_000n;
const QTY_SCALE_FACTOR = 1000n;

export class MoneyInvalidError extends Error {
  constructor(readonly input: string) {
    super(`金额格式错误: ${input}`);
    this.name = 'MoneyInvalidError';
  }
}

/** Parses "107.5" / "107" / number into scaled BigInt (1e-4). */
export function parseAmount(value: string | number): bigint {
  const text = typeof value === 'number' ? String(value) : value.trim();
  // Tolerant on the fraction length: SQL NUMERIC arithmetic (SUM/ROUND on
  // mixed 18,3 x 18,4 columns) legitimately returns more than 4 fraction
  // digits; anything past 4 is rounded HALF_UP so the 1e-4 scale holds.
  if (!/^\d{1,14}(\.\d{1,10})?$/.test(text)) {
    throw new MoneyInvalidError(text);
  }
  const [whole, fraction = ''] = text.split('.');
  const kept = (fraction + '0000').slice(0, 4);
  const rest = fraction.length > 4 ? Number(fraction[4]) : 0;
  let tail = BigInt(kept);
  if (rest >= 5) {
    tail += 1n;
  }
  return BigInt(whole!) * MONEY_SCALE_FACTOR + tail;
}

/** "107.5000" form, canonical NUMERIC string (4 fraction digits). */
export function formatAmount(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / MONEY_SCALE_FACTOR;
  const fraction = (abs % MONEY_SCALE_FACTOR).toString().padStart(Number(MONEY_SCALE), '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Parses a DB NUMERIC string ("107.5000") into scaled BigInt. */
export function amountFromDb(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  return parseAmount(value);
}

/**
 * unit_price × quantity: money (1e-4) × qty (1e-3) = 1e-7 intermediate,
 * rounded HALF_UP to the 1e-4 money scale (banker's-style tail rounding is
 * unnecessary at 4 digits against a 7-digit product).
 */
export function mulAmountByQty(unitPriceScaled: bigint, quantity: string): bigint {
  const qty = parseQty(quantity);
  const product = unitPriceScaled * qty; // scale 1e-7
  const half = QTY_SCALE_FACTOR / 2n; // 500 -> half of 1e3 tail
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const tail = abs % QTY_SCALE_FACTOR;
  let base = abs / QTY_SCALE_FACTOR;
  if (tail >= half) {
    base += 1n;
  }
  return negative ? -base : base;
}

/** a + b on scaled bigints (kept for readability at call sites). */
export function addAmounts(a: bigint, b: bigint): bigint {
  return a + b;
}

/** a - b on scaled bigints. */
export function subAmounts(a: bigint, b: bigint): bigint {
  return a - b;
}

/** Compares two DB amounts safely (null-safe: null sorts last). */
export function compareAmounts(a: string | null, b: string | null): number {
  const sa = amountFromDb(a);
  const sb = amountFromDb(b);
  if (sa === null && sb === null) return 0;
  if (sa === null) return 1;
  if (sb === null) return -1;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
