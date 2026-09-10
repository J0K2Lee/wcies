import { ReactNode } from 'react';
import { colors } from '../tokens';

/**
 * Selected-entity header used at the top of the context rail (task §29):
 * image (optional), primary identity line, secondary line, status badge.
 */
export interface EntitySummaryProps {
  image?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
}

export function EntitySummary({ image, title, subtitle, badge, meta }: EntitySummaryProps) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
      {image !== undefined && <div style={{ flexShrink: 0 }}>{image}</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 650,
            color: colors.textPrimary,
            wordBreak: 'break-word',
          }}
        >
          {title}
        </div>
        {subtitle !== undefined && (
          <div style={{ fontSize: 13, color: colors.textSecondary, wordBreak: 'break-word' }}>
            {subtitle}
          </div>
        )}
        {badge !== undefined && <div style={{ marginTop: 3 }}>{badge}</div>}
        {meta !== undefined && <div style={{ marginTop: 2 }}>{meta}</div>}
      </div>
    </div>
  );
}
