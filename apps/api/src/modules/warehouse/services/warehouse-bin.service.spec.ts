import { describe, expect, it } from 'vitest';
import { WarehouseBinBatchInvalidError } from '../errors/warehouse-errors';
import { expandRange, formatBinCode, formatRack, normalizeSegment } from './warehouse-bin.service';

describe('expandRange (batch bin generation, task §41)', () => {
  it('expands inclusive numeric ranges keeping zero padding', () => {
    expect(expandRange('A01', 'A05', 'rack')).toEqual(['A01', 'A02', 'A03', 'A04', 'A05']);
    expect(expandRange('01', '04', 'level')).toEqual(['01', '02', '03', '04']);
  });

  it('accepts single-element ranges', () => {
    expect(expandRange('A01', 'A01', 'rack')).toEqual(['A01']);
  });

  it('grows width when numbers exceed the padding', () => {
    expect(expandRange('A09', 'A11', 'rack')).toEqual(['A09', 'A10', 'A11']);
  });

  it('rejects non-numeric endpoints', () => {
    expect(() => expandRange('ABC', 'ABD', 'rack')).toThrow(WarehouseBinBatchInvalidError);
  });

  it('rejects mismatched prefixes', () => {
    expect(() => expandRange('A01', 'B05', 'rack')).toThrow(WarehouseBinBatchInvalidError);
  });

  it('rejects reversed ranges', () => {
    expect(() => expandRange('A05', 'A01', 'rack')).toThrow(WarehouseBinBatchInvalidError);
  });
});

describe('formatBinCode (decision 0010: one string, warehouse-prefixed)', () => {
  it('builds warehouseCode-rack-level', () => {
    expect(formatBinCode('ZG-01', 'A05', '1')).toBe('ZG-01-A05-1');
  });

  it('appends the optional position segment', () => {
    expect(formatBinCode('ZG-01', 'A05', '1', '02')).toBe('ZG-01-A05-1-02');
  });

  it('treats an empty or null position as absent', () => {
    expect(formatBinCode('ZG-01', 'A05', '1', '')).toBe('ZG-01-A05-1');
    expect(formatBinCode('ZG-01', 'A05', '1', null)).toBe('ZG-01-A05-1');
  });
});

describe('formatRack (zone prefixes the rack, shared by both create paths)', () => {
  it('combines zone and zero-padded rack number', () => {
    expect(formatRack('A', 1)).toBe('A01');
    expect(formatRack('A', 12)).toBe('A12');
  });

  it('grows the padding past 99 instead of wrapping', () => {
    expect(formatRack('B', 100)).toBe('B100');
  });

  it('omits the prefix when there is no zone', () => {
    expect(formatRack(null, 3)).toBe('03');
  });
});

describe('normalizeSegment (01 and 1 must not become two codes)', () => {
  it('drops leading zeros from numeric segments', () => {
    expect(normalizeSegment('01')).toBe('1');
    expect(normalizeSegment('02')).toBe('2');
    expect(normalizeSegment('10')).toBe('10');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeSegment('  3  ')).toBe('3');
  });

  it('keeps free-form imported segments untouched', () => {
    expect(normalizeSegment('A01')).toBe('A01');
  });

  it('returns null for empty or missing input', () => {
    expect(normalizeSegment('')).toBeNull();
    expect(normalizeSegment('   ')).toBeNull();
    expect(normalizeSegment(undefined)).toBeNull();
    expect(normalizeSegment(null)).toBeNull();
  });
});
