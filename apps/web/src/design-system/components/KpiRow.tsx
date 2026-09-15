import { ReactNode } from 'react';

/**
 * Standard grid row for MetricCards (UI spec §2, Phase 3 T1.3). Pages wrap
 * their KPI cards in this instead of hand-rolling a grid, so card spacing is
 * identical everywhere.
 */
export interface KpiRowProps {
  children: ReactNode;
}

export function KpiRow({ children }: KpiRowProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        gap: 16,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}
