import { ReactNode } from 'react';
import { colors, shadows } from '../tokens';

/**
 * Flat white section container: 1px border + very soft shadow, optional small
 * title and an actions slot. No nested cards inside cards (task §66).
 */
export interface SectionCardProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Remove padding (e.g. when hosting a full-bleed table). */
  flush?: boolean;
  style?: React.CSSProperties;
}

export function SectionCard({ title, actions, children, flush = false, style }: SectionCardProps) {
  return (
    <section
      style={{
        background: colors.container,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        boxShadow: shadows.card,
        overflow: 'hidden',
        ...style,
      }}
    >
      {(title !== undefined || actions !== undefined) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '14px 20px',
            borderBottom: `1px solid ${colors.borderSoft}`,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: colors.textPrimary }}>{title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{actions}</div>
        </div>
      )}
      <div style={flush ? undefined : { padding: 20 }}>{children}</div>
    </section>
  );
}
