import { colors } from '../tokens';

/**
 * Unified empty / error states (task §59): one quiet line of title +
 * description, never a loud illustration.
 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Error variant adds the retry action slot and danger text. */
  error?: boolean;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, error = false, action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '40px 24px',
        textAlign: 'center',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: error ? colors.danger : colors.border,
        }}
      />
      <span
        style={{
          fontSize: 13.5,
          fontWeight: 500,
          color: error ? colors.danger : colors.textSecondary,
        }}
      >
        {title}
      </span>
      {description !== undefined && (
        <span style={{ fontSize: 12.5, color: colors.textTertiary }}>{description}</span>
      )}
      {action !== undefined && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
