import { ReactNode } from 'react';
import { colors } from '../tokens';

/**
 * Read-only info grid (task §30): label + value rows for detail drawers.
 * Prefer this over forms for anything the user is not editing.
 */
export interface InfoGridProps {
  items: Array<{ label: string; children: ReactNode; span?: 1 | 2 | 3 }>;
  /** Column count of the underlying grid (default 3 like a detail drawer). */
  columns?: 2 | 3;
}

export function InfoGrid({ items, columns = 3 }: InfoGridProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        rowGap: 0,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            gridColumn: `span ${item.span ?? 1}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            padding: '10px 20px 10px 0',
            borderBottom: `1px solid ${colors.borderSoft}`,
          }}
        >
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>{item.label}</span>
          <span
            style={{
              fontSize: 14,
              color: colors.textPrimary,
              wordBreak: 'break-word',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {item.children}
          </span>
        </div>
      ))}
    </div>
  );
}
