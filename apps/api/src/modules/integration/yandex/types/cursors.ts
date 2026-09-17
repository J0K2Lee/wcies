/**
 * Yandex adapter cursors (opaque to the sync layer, interpreted only by the
 * YandexAdapter; persisted verbatim in sync_cursors.cursor_data).
 *
 * Yandex business-level APIs need the resolved {businessId, campaignId} -
 * resolved once from GET /v2/campaigns and carried inside the cursors so a
 * paged walk costs no extra identity lookups (docs/integrations/yandex.md §7).
 */

/** Resolved token identity - not a secret, safe to persist inside cursors. */
export interface YxIdentity {
  readonly businessId: string;
  readonly campaignId: string;
}

/** Listing enumeration state: offer-mappings pageToken walk. */
export interface YxListingCursor extends YxIdentity {
  readonly kind: 'YX_LISTING';
  readonly pageToken: string | null;
}

/**
 * Order polling state: a [updateFrom, updateTo] window (≤30 days per the
 * API contract) walked with pageToken; on completion the adapter hands back
 * a YX_ORDER_RESUME marker so the NEXT run opens a fresh overlapped window.
 */
export interface YxOrderWindowCursor extends YxIdentity {
  readonly kind: 'YX_ORDER_WINDOW';
  readonly updateFrom: string;
  readonly updateTo: string;
  readonly pageToken: string | null;
}

/** Stored between runs: the end of the last fully-processed window. */
export interface YxOrderResumeCursor extends YxIdentity {
  readonly kind: 'YX_ORDER_RESUME';
  readonly windowEnd: string;
}

/** Returns enumeration state: campaign returns pageToken walk. */
export interface YxReturnCursor extends YxIdentity {
  readonly kind: 'YX_RETURN';
  readonly pageToken: string | null;
}

/** Re-delivered boundary overlap (idempotent ingest absorbs duplicates). */
export const ORDER_WINDOW_OVERLAP_MS = 60_000;
/** Initial catch-up window when no cursor exists yet (API cap: 30 days). */
export const INITIAL_ORDER_WINDOW_DAYS = 7;

export function hasYxIdentity(value: unknown): value is YxIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { businessId?: unknown }).businessId === 'string' &&
    typeof (value as { campaignId?: unknown }).campaignId === 'string'
  );
}

export function isYxListingCursor(value: unknown): value is YxListingCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'YX_LISTING' &&
    hasYxIdentity(value) &&
    (typeof (value as { pageToken?: unknown }).pageToken === 'string' ||
      (value as { pageToken?: unknown }).pageToken === null)
  );
}

export function isYxOrderWindowCursor(value: unknown): value is YxOrderWindowCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'YX_ORDER_WINDOW' &&
    hasYxIdentity(value) &&
    typeof (value as { updateFrom?: unknown }).updateFrom === 'string' &&
    typeof (value as { updateTo?: unknown }).updateTo === 'string' &&
    (typeof (value as { pageToken?: unknown }).pageToken === 'string' ||
      (value as { pageToken?: unknown }).pageToken === null)
  );
}

export function isYxOrderResumeCursor(value: unknown): value is YxOrderResumeCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'YX_ORDER_RESUME' &&
    hasYxIdentity(value) &&
    typeof (value as { windowEnd?: unknown }).windowEnd === 'string'
  );
}

export function isYxReturnCursor(value: unknown): value is YxReturnCursor {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'YX_RETURN' &&
    hasYxIdentity(value) &&
    (typeof (value as { pageToken?: unknown }).pageToken === 'string' ||
      (value as { pageToken?: unknown }).pageToken === null)
  );
}
