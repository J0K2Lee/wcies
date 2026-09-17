/**
 * Wildberries adapter cursors (opaque to the sync layer, interpreted only by
 * the WbAdapter; persisted verbatim in sync_cursors.cursor_data).
 *
 * WB orders need a DUAL-source walk (docs/integrations/wildberries.md §3):
 * FBS/DBS assembly tasks from marketplace /api/v3/orders and DBW buyout rows
 * from statistics /api/v1/supplier/orders. One run cursor carries both
 * sources' positions; the stored RESUME marker carries them across runs.
 */

/** Listing enumeration state: cards/list cursor {updatedAt, nmID} echo. */
export interface WbListingCursor {
  readonly kind: 'WB_LISTING';
  readonly updatedAt: number;
  readonly nmId: number;
}

/**
 * In-run order state machine. `phase` walks FBS first, then statistics:
 * - FBS: pages marketplace /api/v3/orders with the `next` cursor inside the
 *   [windowFrom, windowTo] creation window (≤30 days per request);
 * - STATS: ONE statistics call per run (the endpoint allows 1 req/min).
 */
export interface WbOrderRunCursor {
  readonly kind: 'WB_ORDER_RUN';
  readonly phase: 'FBS' | 'STATS';
  /** Window start (ISO UTC). */
  readonly windowFrom: string;
  /** Window end (ISO UTC). */
  readonly windowTo: string;
  /** Marketplace pagination cursor (0 = first page). */
  readonly next: number;
  /**
   * Statistics incremental cursor: the last row's `lastChangeDate` (Moscow
   * RFC3339) - stored verbatim to avoid timezone round-trip drift.
   */
  readonly statsFrom: string;
}

/** Stored between runs: end of the last FBS window + statistics position. */
export interface WbOrderResumeCursor {
  readonly kind: 'WB_ORDER_RESUME';
  readonly windowEnd: string;
  readonly statsFrom: string;
}

export function isWbListingCursor(value: unknown): value is WbListingCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'WB_LISTING' &&
    typeof (value as { updatedAt?: unknown }).updatedAt === 'number' &&
    typeof (value as { nmId?: unknown }).nmId === 'number'
  );
}

export function isWbOrderRunCursor(value: unknown): value is WbOrderRunCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'WB_ORDER_RUN' &&
    ((value as { phase?: unknown }).phase === 'FBS' ||
      (value as { phase?: unknown }).phase === 'STATS') &&
    typeof (value as { windowFrom?: unknown }).windowFrom === 'string' &&
    typeof (value as { windowTo?: unknown }).windowTo === 'string' &&
    typeof (value as { next?: unknown }).next === 'number' &&
    typeof (value as { statsFrom?: unknown }).statsFrom === 'string'
  );
}

export function isWbOrderResumeCursor(value: unknown): value is WbOrderResumeCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'WB_ORDER_RESUME' &&
    typeof (value as { windowEnd?: unknown }).windowEnd === 'string' &&
    typeof (value as { statsFrom?: unknown }).statsFrom === 'string'
  );
}

/** Re-delivered boundary overlap (idempotent ingest absorbs duplicates). */
export const ORDER_WINDOW_OVERLAP_MS = 60_000;
/** Initial catch-up window when no cursor exists yet. */
export const INITIAL_ORDER_WINDOW_DAYS = 7;
/** Moscow time offset the statistics endpoints require (UTC+3, docs §3b). */
export const MSK_OFFSET_SUFFIX = '+03:00';

/** Formats an instant as the Moscow-time RFC3339 statistics endpoints expect. */
export function toMskRfc3339(date: Date): string {
  return date.toISOString().replace('Z', MSK_OFFSET_SUFFIX);
}
