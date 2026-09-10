import { Tooltip } from 'antd';
import { fmtDateTime, relativeTime } from '../../utils/format';

/**
 * Relative time with the absolute timestamp on hover (Phase 2 task §45):
 * "5 分钟前" in the table, "2026-09-10 16:30:22" in the tooltip.
 */
export interface RelativeTimeProps {
  value: string | null | undefined;
  fallback?: string;
}

export function RelativeTime({ value, fallback = '—' }: RelativeTimeProps) {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: '#98A2B3' }}>{fallback}</span>;
  }
  return (
    <Tooltip title={fmtDateTime(value)}>
      <span style={{ fontVariantNumeric: 'tabular-nums', cursor: 'default' }}>
        {relativeTime(value)}
      </span>
    </Tooltip>
  );
}
