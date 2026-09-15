import { App, Button, Tooltip } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { colors, typography } from '../tokens';

/**
 * Raw platform payload block (UI spec §8.4, Phase 3 T1.5). One pre block for
 * Order raw data / exception context / sync payloads: token background,
 * monospace via the DS token, and a copy button. Replaces the per-page
 * hand-rolled <pre> with hex backgrounds.
 */
export interface RawDataBlockProps {
  data: unknown;
  /** Scroll cap in px (default matches the old order drawer). */
  maxHeight?: number;
}

export function RawDataBlock({ data, maxHeight = 420 }: RawDataBlockProps) {
  const { message } = App.useApp();
  const text = JSON.stringify(data, null, 2) ?? String(data);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      void message.success('已复制到剪贴板');
    } catch {
      void message.error('复制失败，请手动选择复制');
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <pre
        style={{
          maxHeight,
          overflow: 'auto',
          margin: 0,
          fontSize: 12,
          lineHeight: '20px',
          fontFamily: typography.monoFamily,
          background: colors.canvas,
          border: `1px solid ${colors.borderSoft}`,
          color: colors.textPrimary,
          padding: 12,
          borderRadius: 8,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {text}
      </pre>
      <Tooltip title="复制 JSON">
        <Button
          size="small"
          icon={<CopyOutlined />}
          aria-label="复制 JSON"
          onClick={() => void copy()}
          style={{ position: 'absolute', top: 8, right: 8 }}
        />
      </Tooltip>
    </div>
  );
}
