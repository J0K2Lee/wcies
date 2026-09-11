import { describe, expect, it } from 'vitest';
import { SkuDimensionsInvalidError } from '../errors/sku-errors';
import { assertDimensionsConsistent, computeVolumeMm3, toNumeric } from './sku.service';

describe('toNumeric (cleared InputNumber must not become "null" in SQL)', () => {
  it('serializes finite numbers for numeric columns', () => {
    expect(toNumeric(0)).toBe('0');
    expect(toNumeric(950)).toBe('950');
    expect(toNumeric(299.5)).toBe('299.5');
  });

  it('maps null/undefined to SQL NULL (the SKU-create failure of 2026-09-11)', () => {
    // antd InputNumber sends null when the user clears the field. Treating it
    // like a value produced the literal string "null", which Postgres rejected
    // with `invalid input syntax for type numeric`, surfacing to the user as an
    // opaque "Database error" on a perfectly valid form submission.
    expect(toNumeric(null)).toBeNull();
    expect(toNumeric(undefined)).toBeNull();
  });

  it('maps non-finite values to SQL NULL rather than letting them reach the driver', () => {
    expect(toNumeric(Number.NaN)).toBeNull();
    expect(toNumeric(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toNumeric(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe('computeVolumeMm3 (task §23: volume is backend-computed; integer mm)', () => {
  it('computes length x width x height', () => {
    expect(computeVolumeMm3(355, 122, 34)).toBe(1_472_540);
    expect(computeVolumeMm3(100, 100, 100)).toBe(1_000_000);
  });

  it('returns null unless all three dimensions exist', () => {
    expect(computeVolumeMm3(null, 100, 100)).toBeNull();
    expect(computeVolumeMm3(100, null, null)).toBeNull();
    expect(computeVolumeMm3(null, null, null)).toBeNull();
  });
});

describe('assertDimensionsConsistent (all-or-none)', () => {
  it('accepts complete or empty dimension sets', () => {
    expect(() => assertDimensionsConsistent(1, 2, 3)).not.toThrow();
    expect(() => assertDimensionsConsistent(null, null, null)).not.toThrow();
    expect(() => assertDimensionsConsistent(undefined, undefined, undefined)).not.toThrow();
  });

  it('rejects partial dimension sets', () => {
    expect(() => assertDimensionsConsistent(1, null, null)).toThrow(SkuDimensionsInvalidError);
    expect(() => assertDimensionsConsistent(1, 2, null)).toThrow(SkuDimensionsInvalidError);
    expect(() => assertDimensionsConsistent(null, 2, 3)).toThrow(SkuDimensionsInvalidError);
  });

  it('treats undefined merges as absent (update flows)', () => {
    expect(() => assertDimensionsConsistent(undefined, 2, 3)).toThrow(SkuDimensionsInvalidError);
  });
});
