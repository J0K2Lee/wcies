import { StatusTone } from './StatusBadge';
import { StatusBadge } from './StatusBadge';

/**
 * Exception severity indicator (Phase 2 task §23, §25): a calm badge mapping
 * the backend severity enum to a label + tone. Never a red row background —
 * risk is conveyed by this badge and (optionally) a 2px row accent.
 */
const RISK_META: Record<string, { tone: StatusTone; label: string }> = {
  HIGH: { tone: 'danger', label: '高风险' },
  MEDIUM: { tone: 'warning', label: '中风险' },
  LOW: { tone: 'neutral', label: '低风险' },
};

export interface RiskIndicatorProps {
  severity: string;
}

export function RiskIndicator({ severity }: RiskIndicatorProps) {
  const meta = RISK_META[severity] ?? { tone: 'neutral' as const, label: severity };
  return <StatusBadge tone={meta.tone} label={meta.label} hint={severity} />;
}

/** Row accent color for open high-risk exceptions (task §25: 2px left bar). */
export function riskAccentColor(severity: string, status: string): string | undefined {
  if (status === 'OPEN' && severity === 'HIGH') {
    return '#C4433C';
  }
  if (status === 'OPEN' && severity === 'MEDIUM') {
    return '#C2760F';
  }
  return undefined;
}
