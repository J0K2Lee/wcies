/**
 * Shared cross-app types with no business or framework dependencies.
 * Keep this package small: only stable primitives live here
 * (AGENTS.md §74 / docs monorepo rules: no big-bang `packages/types`).
 */

/** Standard pagination metadata returned by list endpoints. */
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Success envelope for single-object endpoints. */
export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
}

/** Success envelope for paginated list endpoints. */
export interface ApiPaginatedResponse<TItem> {
  success: true;
  data: TItem[];
  meta: PageMeta;
}

/** Machine-readable error code, format `DOMAIN_REASON` (e.g. INVENTORY_INSUFFICIENT_STOCK). */
export type ApiErrorCode = string;

/** Standard error envelope. Never contains SQL, stack traces or secrets. */
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details: Record<string, unknown>;
  };
  requestId: string;
}

export {
  ean13CheckDigit,
  isValidEan13,
  validate69Barcode,
  type BarcodeValidationResult,
} from './barcode.js';
