import { describe, expect, it } from 'vitest';
import { WarehouseBinBatchInvalidError } from '../errors/warehouse-errors';
import { expandRange } from './warehouse-bin.service';

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
