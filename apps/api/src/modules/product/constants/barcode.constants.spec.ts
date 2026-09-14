import { describe, expect, it } from 'vitest';
import { BARCODE_TYPES, INTERNAL_BARCODE_PREFIX, formatInternalBarcode } from './barcode.constants';

/**
 * Decision 0017 (2026-09-14): internal barcodes are `W%08d` - the `WCSKU`
 * prefix printed too many Code128 modules for a small label. The sequence
 * itself is untouched, so the padding rule is the contract under test.
 */
describe('formatInternalBarcode (decision 0017)', () => {
  it('pads to 8 digits behind the single-letter prefix', () => {
    expect(INTERNAL_BARCODE_PREFIX).toBe('W');
    expect(formatInternalBarcode(14)).toBe('W00000014');
    expect(formatInternalBarcode(1)).toBe('W00000001');
    expect(formatInternalBarcode('7')).toBe('W00000007');
  });

  it('treats the width as a MINIMUM - the sequence overflows, never truncates', () => {
    expect(formatInternalBarcode(99_999_999)).toBe('W99999999');
    expect(formatInternalBarcode(100_000_000)).toBe('W100000000');
  });

  it('keeps the type vocabulary intact alongside the new format', () => {
    expect(BARCODE_TYPES).toContain('INTERNAL');
  });
});
