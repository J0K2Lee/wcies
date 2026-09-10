import { CSSProperties, ReactNode } from 'react';

/**
 * Unified filter bar (task §54): [Search] [Select] [Select] ... + right-aligned
 * actions, one control height and one gap across all management pages.
 */
export interface FilterBarProps {
  children: ReactNode;
  /** Right-aligned actions (buttons / dropdowns). */
  actions?: ReactNode;
  style?: CSSProperties;
}

export function FilterBar({ children, actions, style }: FilterBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        flexWrap: 'wrap',
        padding: '12px 16px',
        background: '#FFFFFF',
        border: '1px solid #E7E9EE',
        borderRadius: 12,
        marginBottom: 16,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
        {children}
      </div>
      {actions !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  );
}
