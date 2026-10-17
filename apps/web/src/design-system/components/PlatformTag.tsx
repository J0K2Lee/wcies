import { colors } from '../tokens';

/**
 * Unified platform identity (task §60): same size everywhere — a 22px mark
 * plus the platform name. No per-page font sizes or random colors.
 * Keyed by the DB platform code — WB, not WILDBERRIES (the old key never
 * matched so WB always fell to the fallback, Sprint 6 §11.4).
 */
const PLATFORM_META: Record<string, { label: string; text: string; bg: string; border: string }> = {
  OZON: { label: 'Ozon', text: '#0C5BFF', bg: '#EEF4FF', border: '#D5E3FF' },
  WB: { label: 'Wildberries', text: '#A3309B', bg: '#F9EEF9', border: '#EDD9EC' },
  WILDBERRIES: { label: 'Wildberries', text: '#A3309B', bg: '#F9EEF9', border: '#EDD9EC' },
  YANDEX: { label: 'Yandex', text: '#C00', bg: '#FDEEEE', border: '#F7D8D8' },
  YANDEX_MARKET: { label: 'Yandex', text: '#C00', bg: '#FDEEEE', border: '#F7D8D8' },
};

const FALLBACK = {
  label: '?',
  text: colors.neutral,
  bg: colors.neutralBg,
  border: colors.neutralBorder,
};

export interface PlatformTagProps {
  /** Platform code as stored on stores / orders, e.g. "OZON". */
  code: string | null | undefined;
  /** Render "OZON · Store A" style suffix next to the mark. */
  suffix?: string;
}

export function PlatformTag({ code, suffix }: PlatformTagProps) {
  const key = (code ?? '').toUpperCase();
  const meta = PLATFORM_META[key] ?? { ...FALLBACK, label: code ?? '-' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: 22,
          padding: '0 7px',
          borderRadius: 6,
          background: meta.bg,
          border: `1px solid ${meta.border}`,
          color: meta.text,
          fontSize: 11,
          fontWeight: 650,
          letterSpacing: 0.2,
          lineHeight: '20px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {meta.label}
      </span>
      {suffix !== undefined && (
        <span
          style={{
            color: colors.textSecondary,
            fontSize: 13,
            // 店铺名单行省略（2026-10-17）：此前没有 nowrap，「OZON 香港店」在
            // 紧凑列里会折成两行，把整行顶高；宁可省略也不能断行。
            whiteSpace: 'nowrap',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
