import { describe, expect, it } from 'vitest';
import {
  MoneyInvalidError,
  amountFromDb,
  formatAmount,
  mulAmountByQty,
  parseAmount,
} from './money';

describe('money utils (NUMERIC 18,4 string arithmetic, finance.md §2)', () => {
  it('parses and formats canonical amounts', () => {
    expect(formatAmount(parseAmount('107'))).toBe('107.0000');
    expect(formatAmount(parseAmount('107.5'))).toBe('107.5000');
    expect(formatAmount(parseAmount('0.0001'))).toBe('0.0001');
    expect(formatAmount(parseAmount(59.9))).toBe('59.9000');
  });

  it('rejects malformed amounts', () => {
    expect(() => parseAmount('')).toThrow(MoneyInvalidError);
    expect(() => parseAmount('-5')).toThrow(MoneyInvalidError);
    expect(() => parseAmount('abc')).toThrow(MoneyInvalidError);
    // SQL NUMERIC sums may carry >4 fraction digits - tolerated + rounded.
    expect(formatAmount(parseAmount('1.23456'))).toBe('1.2346');
    // ...but anything beyond 10 fraction digits is still malformed.
    expect(() => parseAmount('1.12345678901')).toThrow(MoneyInvalidError);
  });

  it('amountFromDb is null-safe', () => {
    expect(amountFromDb(null)).toBeNull();
    expect(amountFromDb(undefined)).toBeNull();
    expect(amountFromDb('')).toBeNull();
    expect(amountFromDb('12.3400')).toBe(123400n);
  });

  it('multiplies unit price by quantity with half-up rounding at 4 digits', () => {
    // 107.0000 x 2.000 = 214.0000
    expect(formatAmount(mulAmountByQty(parseAmount('107'), '2'))).toBe('214.0000');
    // 59.9000 x 1.500 = 89.8500
    expect(formatAmount(mulAmountByQty(parseAmount('59.9'), '1.5'))).toBe('89.8500');
    // 0.0001 x 1.500 = 0.00015 -> half-up at 1e-4 -> 0.0002
    expect(formatAmount(mulAmountByQty(parseAmount('0.0001'), '1.5'))).toBe('0.0002');
    // 0.0001 x 1.000 stays
    expect(formatAmount(mulAmountByQty(parseAmount('0.0001'), '1'))).toBe('0.0001');
    // 33.3333 x 3.000 = 99.9999
    expect(formatAmount(mulAmountByQty(parseAmount('33.3333'), '3'))).toBe('99.9999');
  });
});
