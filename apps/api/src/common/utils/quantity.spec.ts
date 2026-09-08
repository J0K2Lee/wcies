import { describe, expect, it } from 'vitest';
import {
  formatQty,
  parseQty,
  QuantityInvalidError,
  QuantityRangeError,
  QuantityScaleError,
  qtyFromDb,
} from './quantity';

describe('quantity milli-unit strategy (task §58)', () => {
  it('parses plain integers, decimals and negatives exactly', () => {
    expect(parseQty('3')).toBe(3000n);
    expect(parseQty('3.5')).toBe(3500n);
    expect(parseQty('3.500')).toBe(3500n);
    expect(parseQty('0.001')).toBe(1n);
    expect(parseQty('-2.25')).toBe(-2250n);
    expect(parseQty('0')).toBe(0n);
    expect(parseQty(3)).toBe(3000n);
    expect(parseQty(3.5)).toBe(3500n);
  });

  it('rejects malformed or over-precise values', () => {
    expect(() => parseQty('')).toThrow(QuantityInvalidError);
    expect(() => parseQty('abc')).toThrow(QuantityInvalidError);
    expect(() => parseQty('1e3')).toThrow(QuantityInvalidError);
    expect(() => parseQty('1.2345')).toThrow(QuantityScaleError);
    expect(() => parseQty('1,5')).toThrow(QuantityInvalidError);
    expect(() => parseQty('--1')).toThrow(QuantityInvalidError);
  });

  it('round-trips through formatQty without float drift', () => {
    for (const value of ['0', '0.001', '12.345', '999999999999999.999', '-0.125']) {
      expect(formatQty(parseQty(value))).toBe(
        `${value.split('.')[0]}.${(value.split('.')[1] ?? '').padEnd(3, '0')}`,
      );
    }
    expect(formatQty(12345n)).toBe('12.345');
    expect(formatQty(-1n)).toBe('-0.001');
    expect(formatQty(0n)).toBe('0.000');
  });

  it('guards the NUMERIC(18,3) range', () => {
    expect(() => parseQty('1000000000000000')).toThrow(QuantityRangeError); // 16 int digits
    expect(() => formatQty(10n ** 18n)).toThrow(QuantityRangeError);
    expect(() => parseQty('999999999999999.999')).not.toThrow(); // 15 int digits, max legal
  });

  it('treats null DB values as zero', () => {
    expect(qtyFromDb(null)).toBe(0n);
    expect(qtyFromDb('7.000')).toBe(7000n);
  });

  it('accumulates 0.1 + 0.2 without float drift', () => {
    const sum = parseQty('0.1') + parseQty('0.2');
    expect(formatQty(sum)).toBe('0.300');
  });
});
