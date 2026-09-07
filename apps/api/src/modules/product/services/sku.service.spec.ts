import { describe, expect, it } from 'vitest';
import {
  assertDimensionsConsistent,
  computeVolumeCm3,
  SkuDimensionsInvalidError,
} from './sku.service';

describe('computeVolumeCm3 (task §23: volume is backend-computed)', () => {
  it('computes length x width x height', () => {
    expect(computeVolumeCm3(35.5, 12.2, 3.4)).toBe(1472.54);
    expect(computeVolumeCm3(10, 10, 10)).toBe(1000);
  });

  it('returns null unless all three dimensions exist', () => {
    expect(computeVolumeCm3(null, 10, 10)).toBeNull();
    expect(computeVolumeCm3(10, null, null)).toBeNull();
    expect(computeVolumeCm3(null, null, null)).toBeNull();
  });

  it('rounds to 3 decimals (column numeric(18,3))', () => {
    expect(computeVolumeCm3(3.333, 3.333, 3.333)).toBe(37.026);
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
