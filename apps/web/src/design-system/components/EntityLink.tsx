import { Link } from 'react-router';
import { ReactNode } from 'react';
import { colors } from '../tokens';

/**
 * Inline link to a related entity (Phase 2 task §24): used in context rails
 * and drawers to jump from one workspace to the referenced object
 * (exception → order, sync job → store, notification → source).
 */
export interface EntityLinkProps {
  to: string;
  icon?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
}

export function EntityLink({ to, icon, primary, secondary }: EntityLinkProps) {
  return (
    <Link
      to={to}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        minWidth: 0,
        color: colors.primary,
        fontSize: 13,
      }}
    >
      {icon !== undefined && (
        <span aria-hidden style={{ display: 'inline-flex', color: colors.textTertiary }}>
          {icon}
        </span>
      )}
      <span style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {primary}
      </span>
      {secondary !== undefined && (
        <span
          style={{
            color: colors.textTertiary,
            fontSize: 12.5,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {secondary}
        </span>
      )}
    </Link>
  );
}
