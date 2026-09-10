import { ReactNode } from 'react';
import { colors, shadows, typography } from '../tokens';

/**
 * KPI card per Plan D (task §22): small icon + title + big number + aux line +
 * a light trend hint. Deliberately monochrome — no colored big cards.
 */
export interface MetricCardProps {
  icon: ReactNode;
  title: string;
  value: ReactNode;
  aux?: ReactNode;
  /** Light trend hint, e.g. "↑ 12 较昨日". */
  trend?: { direction: 'up' | 'down' | 'flat'; text: string };
  onClick?: () => void;
}

export function MetricCard({ icon, title, value, aux, trend, onClick }: MetricCardProps) {
  const trendColor =
    trend === undefined
      ? colors.textTertiary
      : trend.direction === 'up'
        ? colors.success
        : trend.direction === 'down'
          ? colors.danger
          : colors.textTertiary;
  return (
    <div
      onClick={onClick}
      role={onClick === undefined ? undefined : 'button'}
      tabIndex={onClick === undefined ? undefined : 0}
      onKeyDown={
        onClick === undefined
          ? undefined
          : (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
      }
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '18px 20px 16px',
        background: colors.container,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        boxShadow: shadows.card,
        cursor: onClick === undefined ? undefined : 'pointer',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span aria-hidden style={{ color: colors.primary, display: 'inline-flex', fontSize: 16 }}>
          {icon}
        </span>
        <span style={{ fontSize: 13, color: colors.textSecondary, fontWeight: 500 }}>{title}</span>
      </div>
      <div
        style={{
          fontSize: typography.kpi.size,
          fontWeight: typography.kpi.weight,
          lineHeight: typography.kpi.lineHeight,
          color: colors.textPrimary,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {(aux !== undefined || trend !== undefined) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            minHeight: 20,
          }}
        >
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>{aux}</span>
          {trend !== undefined && (
            <span
              style={{ fontSize: 12, color: trendColor, fontWeight: 500, whiteSpace: 'nowrap' }}
            >
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '—'} {trend.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
