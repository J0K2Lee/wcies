import { ReactNode } from 'react';
import { colors } from '../tokens';

/**
 * Quiet hint line inside the context rail (UI spec §4.2, Phase 3 T1.4) —
 * typically the "click a row to…" copy in the idle state. Pages must use
 * this instead of hand-written spans.
 */
export interface RailHintProps {
  children: ReactNode;
}

export function RailHint({ children }: RailHintProps) {
  return (
    <span
      style={{
        fontSize: 12.5,
        lineHeight: '20px',
        color: colors.textTertiary,
        display: 'block',
        paddingTop: 8,
      }}
    >
      {children}
    </span>
  );
}
