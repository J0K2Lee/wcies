/**
 * Public barcode vocabulary (task §29). Exported for cross-module use
 * (import handlers); 69-codes fall under EAN/GTIN semantics.
 */
export const BARCODE_TYPES = ['EAN', 'GTIN', 'MANUFACTURER', 'INTERNAL', 'OTHER'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];
