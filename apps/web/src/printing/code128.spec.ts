import { describe, expect, it } from 'vitest';
import { barsOf, encodeCode128B } from './code128';

/**
 * Code128-B encoder unit tests (Sprint 7 T6.4). Structural verification of
 * the standard: symbol widths, checksum math, quiet-zone-free alternation
 * and start/stop framing. The definitive acceptance (a scanner gun reads
 * the printed label) stays a manual step per the task book.
 */

describe('encodeCode128B', () => {
  it('frames every encoding with Start B and the 13-module Stop pattern', () => {
    const { bits } = encodeCode128B('W00000014');
    expect(bits.startsWith('11010010000')).toBe(true); // Start B (104)
    expect(bits.endsWith('1100011101011')).toBe(true); // Stop (106)
  });

  it('produces 11 modules per data/check symbol + 13 for stop', () => {
    const value = 'ZG-01-A05-1';
    const { bits, modules } = encodeCode128B(value);
    // start(11) + data*11 + check(11) + stop(13)
    expect(modules).toBe(11 + value.length * 11 + 11 + 13);
    expect(bits.length).toBe(modules);
  });

  // Decision 0017: the whole point of the short internal prefix is label
  // width - Code128 pays 11 modules per character, so dropping the four `CSKU`
  // characters removes exactly 4 x 11 = 44 modules from the same barcode.
  it('encodes the short internal barcode in 134 modules instead of 178', () => {
    const short = encodeCode128B('W00000014');
    const legacy = encodeCode128B('WCSKU00000014');
    expect(short.modules).toBe(11 + 9 * 11 + 11 + 13);
    expect(legacy.modules).toBe(11 + 13 * 11 + 11 + 13);
    expect(short.modules).toBe(134);
    expect(legacy.modules - short.modules).toBe(44);
  });

  it('computes the Code128 checksum (start + sum(value*pos)) mod 103', () => {
    // 'ABC' in subset B: values 33, 34, 35 (ASCII-32).
    // checksum = (104 + 33*1 + 34*2 + 35*3) mod 103 = (104+33+68+105)=310 mod 103 = 1
    const { bits } = encodeCode128B('ABC');
    const symbols: string[] = [];
    for (let i = 0; i < bits.length - 13; i += 11) {
      symbols.push(bits.slice(i, i + 11));
    }
    const checkSymbol = symbols[symbols.length - 1]!;
    // Value 1 pattern:
    expect(checkSymbol).toBe('11001101100');
  });

  it('alternates bars and spaces, starting and ending with a bar', () => {
    const { bits } = encodeCode128B('6971234567890');
    expect(bits[0]).toBe('1');
    expect(bits[bits.length - 1]).toBe('1');
    // No run longer than 4 modules exists in Code128 except none - assert max run.
    let maxRun = 1;
    let run = 1;
    for (let i = 1; i < bits.length; i += 1) {
      run = bits[i] === bits[i - 1] ? run + 1 : 1;
      maxRun = Math.max(maxRun, run);
    }
    expect(maxRun).toBeLessThanOrEqual(4);
  });

  it('throws on empty input and characters outside subset B', () => {
    expect(() => encodeCode128B('')).toThrow(/不能为空/);
    expect(() => encodeCode128B('WCIES-中文')).toThrow(/Code128-B/);
    expect(() => encodeCode128B('tab\tchar')).toThrow(/Code128-B/);
  });

  it('barsOf aggregates adjacent 1-modules into rect segments', () => {
    // '11 0 11 00 11 00' -> bars at 0(2), 3(2), 7(2).
    const bars = barsOf('11011001100');
    expect(bars).toEqual([
      { x: 0, width: 2 },
      { x: 3, width: 2 },
      { x: 7, width: 2 },
    ]);
    expect(bars.reduce((sum, bar) => sum + bar.width, 0)).toBe(6);
  });
});
