/**
 * Public barcode vocabulary (task §29). Exported for cross-module use
 * (import handlers); 69-codes fall under EAN/GTIN semantics.
 */
export const BARCODE_TYPES = ['EAN', 'GTIN', 'MANUFACTURER', 'INTERNAL', 'OTHER'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

/** Read-only cost suggestions returned by barcode resolution. */
export const BARCODE_COST_SOURCES = { MOVING_AVERAGE: 'MOVING_AVERAGE' } as const;
export type BarcodeCostSource = (typeof BARCODE_COST_SOURCES)[keyof typeof BARCODE_COST_SOURCES];

/**
 * Internal barcode format (decision 0019, 2026-10-09): 6-digit pure numeric
 * (e.g. `000014`), zero-padded from `seq_internal_barcode`. Labels were too
 * long under `W%08d` (decision 0017) - digits only is the shortest usable
 * Code128 payload for a small label, and real-world EAN/GTIN codes are 8-13
 * digits, so 6-digit internal values cannot be confused with them at scan
 * time.
 *
 * Kept in ONE place on purpose: the generator has two code paths (the regular
 * route and the onboarding transaction) and they may never drift.
 *
 * Existing system-generated barcodes (`WCSKU%08d` / `W%08d`) are CONVERTED
 * by migration 20261009_001 (user instruction 2026-10-09 - supersedes the
 * no-migration stance of decision 0017): the numeric part is preserved, so
 * converted values never collide with newly issued ones.
 */
export const INTERNAL_BARCODE_DIGITS = 6;

/** Formats a sequence value as an internal barcode (e.g. `000014`). */
export function formatInternalBarcode(sequenceValue: number | string): string {
  return String(sequenceValue).padStart(INTERNAL_BARCODE_DIGITS, '0');
}
