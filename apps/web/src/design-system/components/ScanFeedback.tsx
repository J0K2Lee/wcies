import { colors } from '../tokens';

/**
 * Picking scan feedback (task §50-§51): a LARGE success/error block, not just
 * a toast. Success = light green slab with ✓, error = light red slab with ✕
 * plus expected vs scanned. Kept visible until the next scan.
 */
export interface ScanFeedbackData {
  kind: 'success' | 'error';
  title: string;
  /** Main line, e.g. "VK87-BLK" or "需要 VK87-BLK / 扫描 MOUSE-V7". */
  detail: React.ReactNode;
  /** Progress line, e.g. "2 / 2". */
  progress?: string;
}

export function ScanFeedback({ feedback }: { feedback: ScanFeedbackData | null }) {
  if (feedback === null) {
    return null;
  }
  const success = feedback.kind === 'success';
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 22px',
        borderRadius: 10,
        background: success ? colors.successBg : colors.dangerBg,
        border: `1px solid ${success ? colors.successBorder : colors.dangerBorder}`,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: colors.container,
          border: `2px solid ${success ? colors.success : colors.danger}`,
          color: success ? colors.success : colors.danger,
          fontSize: 22,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {success ? '✓' : '✕'}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 17,
            fontWeight: 650,
            color: success ? '#1F7A46' : '#A33530',
          }}
        >
          {feedback.title}
        </span>
        <span
          style={{
            fontSize: 15,
            color: success ? colors.success : colors.danger,
            wordBreak: 'break-word',
          }}
        >
          {feedback.detail}
        </span>
      </div>
      {feedback.progress !== undefined && (
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 26,
            fontWeight: 700,
            color: success ? colors.success : colors.danger,
            fontVariantNumeric: 'tabular-nums',
            flexShrink: 0,
          }}
        >
          {feedback.progress}
        </span>
      )}
    </div>
  );
}
