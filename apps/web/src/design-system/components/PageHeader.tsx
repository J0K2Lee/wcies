import { ReactNode } from 'react';
import { typography } from '../tokens';

/**
 * Unified page header (task §55): title + description on the left, secondary
 * and primary actions on the right. Every redesigned page starts with this.
 */
export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned secondary action(s). */
  secondary?: ReactNode;
  /** Right-aligned primary action — at most one per page. */
  primary?: ReactNode;
  /** Extra row under the header (e.g. tabs) rendered full width. */
  extra?: ReactNode;
}

export function PageHeader({ title, description, secondary, primary, extra }: PageHeaderProps) {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 20,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: typography.pageTitle.size,
            fontWeight: typography.pageTitle.weight,
            lineHeight: typography.pageTitle.lineHeight,
            color: '#172033',
          }}
        >
          {title}
        </h1>
        {description !== undefined && (
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 13.5,
              lineHeight: '20px',
              color: '#667085',
            }}
          >
            {description}
          </p>
        )}
      </div>
      {(secondary !== undefined || primary !== undefined) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
            paddingTop: 4,
          }}
        >
          {secondary}
          {primary}
        </div>
      )}
      {extra !== undefined && <div style={{ width: '100%' }}>{extra}</div>}
    </header>
  );
}
