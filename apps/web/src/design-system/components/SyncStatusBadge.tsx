import { StatusBadge, SYNC_STATUS_META } from './StatusBadge';

/**
 * Sync job status badge (Phase 2 task §16): human label + semantic tone, raw
 * enum code kept in the tooltip. Shared by Sync Center, Stores and Dashboard.
 */
export interface SyncStatusBadgeProps {
  status: string;
}

export function SyncStatusBadge({ status }: SyncStatusBadgeProps) {
  const meta = SYNC_STATUS_META[status] ?? { tone: 'neutral' as const, label: status };
  return <StatusBadge tone={meta.tone} label={meta.label} hint={status} />;
}
