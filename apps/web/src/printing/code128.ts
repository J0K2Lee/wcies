/**
 * Code 128-B encoder (Sprint 7 T6.1, decision 0007: Code128 is the scan
 * carrier - internal `W…` codes contain letters, so EAN-13 is not an
 * option). Self-implemented on purpose: no new dependencies allowed
 * (AGENTS.md §73), and the symbol set we print (ASCII 32..127) fits
 * subset B with no mode switching.
 *
 * Output is the module bit-string per symbol (1 = bar, 0 = space); bars and
 * spaces alternate starting with a bar. Every symbol is 11 modules wide
 * except STOP (13). The binary table below is the ISO/IEC 15417 standard
 * encoding (same table every Code128 implementation ships).
 */

/** Standard Code128 symbol patterns, index = symbol value 0..106. */
const PATTERNS: readonly string[] = [
  '11011001100',
  '11001101100',
  '11001100110',
  '10010011000',
  '10010001100',
  '10001001100',
  '10011001000',
  '10011000100',
  '10001100100',
  '11001001000',
  '11001000100',
  '11000100100',
  '10110011100',
  '10011011100',
  '10011001110',
  '10111001100',
  '10011101100',
  '10011100110',
  '11001110010',
  '11001011100',
  '11001001110',
  '11011100100',
  '11001110100',
  '11101101110',
  '11101001100',
  '11100101100',
  '11100100110',
  '11101100100',
  '11100110100',
  '11100110010',
  '11011011000',
  '11011000110',
  '11000110110',
  '10100011000',
  '10001011000',
  '10001000110',
  '10110001000',
  '10001101000',
  '10001100010',
  '11010001000',
  '11000101000',
  '11000100010',
  '10110111000',
  '10110001110',
  '10001101110',
  '10111011000',
  '10111000110',
  '10001110110',
  '11101110110',
  '11010001110',
  '11000101110',
  '11011101000',
  '11011100010',
  '11011101110',
  '11101011000',
  '11101000110',
  '11100010110',
  '11101101000',
  '11101100010',
  '11100011010',
  '11101111010',
  '11001000010',
  '11110001010',
  '10100110000',
  '10100001100',
  '10010110000',
  '10010000110',
  '10000101100',
  '10000100110',
  '10110010000',
  '10110000100',
  '10011010000',
  '10011000010',
  '10000110100',
  '10000110010',
  '11000010010',
  '11001010000',
  '11110111010',
  '11000010100',
  '10001111010',
  '10100111100',
  '10010111100',
  '10010011110',
  '10111100100',
  '10011110100',
  '10011110010',
  '11110100100',
  '11110010100',
  '11110010010',
  '11011011110',
  '11011110110',
  '11110110110',
  '10101111000',
  '10100011110',
  '10001011110',
  '10111101000',
  '10111100010',
  '11110101000',
  '11110100010',
  '10111011110',
  '10111101110',
  '11101011110',
  '11110101110',
  '11010000100',
  '11010010000',
  '11010011100',
  '1100011101011',
] as const;

const START_B = 104;
const STOP = 106;

export interface Code128Result {
  /** Full module bit-string (bars+spaces, bar first), including quiet-zone-free start..stop. */
  bits: string;
  /** Module count of the symbol (bits.length). */
  modules: number;
}

/**
 * Encodes `value` as Code 128-B. Throws on characters outside ASCII 32..127
 * (subset B cannot represent them; we do not implement A/C switching since
 * print payloads never need it).
 */
export function encodeCode128B(value: string): Code128Result {
  if (value.length === 0) {
    throw new Error('Code128 输入不能为空');
  }
  const values: number[] = [];
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 32 || code > 127) {
      throw new Error(`Code128-B 不支持字符 "${char}"（仅 ASCII 32..127）`);
    }
    values.push(code - 32);
  }

  // Checksum: start value + sum(value_i * position_i), position from 1.
  let checksum = START_B;
  values.forEach((symbolValue, index) => {
    checksum += symbolValue * (index + 1);
  });
  checksum %= 103;

  const bits = [
    PATTERNS[START_B]!,
    ...values.map((v) => PATTERNS[v]!),
    PATTERNS[checksum]!,
    PATTERNS[STOP]!,
  ].join('');
  return { bits, modules: bits.length };
}

/** SVG path-friendly bar segments: [x, width] in modules for 1-runs. */
export function barsOf(bits: string): Array<{ x: number; width: number }> {
  const bars: Array<{ x: number; width: number }> = [];
  let x = 0;
  while (x < bits.length) {
    if (bits[x] === '1') {
      let width = 1;
      while (bits[x + width] === '1') {
        width += 1;
      }
      bars.push({ x, width });
      x += width;
    } else {
      x += 1;
    }
  }
  return bars;
}
