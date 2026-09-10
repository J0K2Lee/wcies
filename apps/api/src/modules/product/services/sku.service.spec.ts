import { describe, expect, it } from 'vitest';
import { SkuDimensionsInvalidError } from '../errors/sku-errors';
import { assertDimensionsConsistent, computeVolumeMm3 } from './sku.service';

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
