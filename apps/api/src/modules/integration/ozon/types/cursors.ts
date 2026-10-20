/**
 * OZON adapter cursors (opaque to the sync layer, interpreted only by the
 * OzonAdapter; persisted verbatim in sync_cursors.cursor_data).
 */

/** Listing enumeration state: /v3/product/list `last_id` pagination. */
export interface OzonListingCursor {
  readonly kind: 'OZON_LISTING';
  readonly lastId: string;
}

/**
 * Order polling state: a [since, to] window with offset pagination inside it.
 * The adapter walks pages within the window; when the window completes it
 * hands back an OZON_ORDER_RESUME marker so the NEXT run opens a fresh
 * window (slightly overlapped - idempotent ingest absorbs the overlap).
 */
export interface OzonOrderWindowCursor {
  readonly kind: 'OZON_ORDER_WINDOW';
  readonly since: string;
  readonly to: string;
  /**
   * v4 游标分页（2026-10-20）：OZON 不透明游标，首页缺省。旧版本这里存的是
   * offset —— 旧游标仍会被接受（offset 被忽略），窗口从头重扫，摄取幂等。
   */
  readonly cursor?: string;
}

/** Stored between runs: the end of the last fully-processed window. */
export interface OzonOrderResumeCursor {
  readonly kind: 'OZON_ORDER_RESUME';
  readonly windowEnd: string;
}

export function isOzonListingCursor(value: unknown): value is OzonListingCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'OZON_LISTING' &&
    typeof (value as { lastId?: unknown }).lastId === 'string'
  );
}

export function isOzonOrderWindowCursor(value: unknown): value is OzonOrderWindowCursor {
  const cursor = (value as { cursor?: unknown } | null)?.cursor;
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'OZON_ORDER_WINDOW' &&
    typeof (value as { since?: unknown }).since === 'string' &&
    typeof (value as { to?: unknown }).to === 'string' &&
    (cursor === undefined || typeof cursor === 'string')
  );
}

export function isOzonOrderResumeCursor(value: unknown): value is OzonOrderResumeCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'OZON_ORDER_RESUME' &&
    typeof (value as { windowEnd?: unknown }).windowEnd === 'string'
  );
}

/** Re-delivered boundary overlap (idempotent ingest absorbs duplicates). */
export const ORDER_WINDOW_OVERLAP_MS = 60_000;
/** Initial catch-up window when no cursor exists yet (task §30 catch-up). */
export const INITIAL_ORDER_WINDOW_DAYS = 7;

/** Targeted fetch of specific postings (webhook NEW_POSTING follow-up read). */
export interface OzonPostingNumbersCursor {
  readonly kind: 'OZON_POSTING_NUMBERS';
  readonly numbers: readonly string[];
}

export function isOzonPostingNumbersCursor(value: unknown): value is OzonPostingNumbersCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'OZON_POSTING_NUMBERS' &&
    Array.isArray((value as { numbers?: unknown }).numbers) &&
    (value as { numbers: unknown[] }).numbers.every((n) => typeof n === 'string')
  );
}

/** Cursor of /v2/returns/rfbs/list pages (dual-axis T5): last return_id. */
export interface OzonReturnCursor {
  readonly kind: 'OZON_RETURN';
  readonly lastReturnId: number;
}

export function isOzonReturnCursor(value: unknown): value is OzonReturnCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    'lastReturnId' in value &&
    typeof value.lastReturnId === 'number'
  );
}
