import { describe, expect, it } from 'vitest';
import { BARCODE_TYPES, formatInternalBarcode } from './barcode.constants';

/**
 * Decision 0019 (2026-10-09): internal barcodes are 6-digit pure numeric.
 * The sequence itself is untouched, so the padding rule is the contract
 * under test.
 */
describe('formatInternalBarcode (decision 0019)', () => {
  it('pads to 6 digits with no prefix', () => {
    expect(formatInternalBarcode(14)).toBe('000014');
    expect(formatInternalBarcode(1)).toBe('000001');
    expect(formatInternalBarcode('7')).toBe('000007');
  });

  it('treats the width as a MINIMUM - the sequence overflows, never truncates', () => {
    expect(formatInternalBarcode(999_999)).toBe('999999');
    expect(formatInternalBarcode(1_000_000)).toBe('1000000');
  });

  it('keeps the type vocabulary intact alongside the new format', () => {
    expect(BARCODE_TYPES).toContain('INTERNAL');
  });
});
