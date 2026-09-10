import { ReactNode } from 'react';
import { colors, shadows } from '../tokens';

/**
 * Flat white section container: 1px border + very soft shadow, optional small
 * title, hint and actions slot. No nested cards inside cards (task §66).
 */
export interface SectionCardProps {
  title?: ReactNode;
  /** Small right-aligned hint next to the title (e.g. a "查看全部" link). */
  extra?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Remove padding (e.g. when hosting a full-bleed table). */
  flush?: boolean;
  style?: React.CSSProperties;
}

export function SectionCard({
  title,
  extra,
  actions,
  children,
  flush = false,
  style,
}: SectionCardProps) {
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
      {(title !== undefined || actions !== undefined || extra !== undefined) && (
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {extra}
            {actions}
          </div>
        </div>
      )}
      <div style={flush ? undefined : { padding: 20 }}>{children}</div>
    </section>
  );
}
