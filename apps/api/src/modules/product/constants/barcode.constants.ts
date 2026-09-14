/**
 * Public barcode vocabulary (task §29). Exported for cross-module use
 * (import handlers); 69-codes fall under EAN/GTIN semantics.
 */
export const BARCODE_TYPES = ['EAN', 'GTIN', 'MANUFACTURER', 'INTERNAL', 'OTHER'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

/**
 * Internal barcode format (decision 0017, 2026-09-14): `W%08d`, e.g.
 * `W00000014`. The `WCSKU%08d` prefix printed too many modules for a small
 * label; the sequence itself is unchanged.
 *
 * Kept in ONE place on purpose: the generator has two code paths (the regular
 * route and the onboarding transaction) and they may never drift.
 *
 * Previously issued `WCSKU…` barcodes stay valid - they are opaque unique
 * strings, and labels already stuck to physical goods cannot be reprinted.
 */
export const INTERNAL_BARCODE_PREFIX = 'W';
export const INTERNAL_BARCODE_DIGITS = 8;

/** Formats a sequence value as an internal barcode (e.g. `W00000014`). */
export function formatInternalBarcode(sequenceValue: number | string): string {
  return `${INTERNAL_BARCODE_PREFIX}${String(sequenceValue).padStart(INTERNAL_BARCODE_DIGITS, '0')}`;
}
