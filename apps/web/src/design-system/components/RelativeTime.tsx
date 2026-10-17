import { fmtDateTime, relativeTime } from '../../utils/format';

/**
 * Relative time with the absolute timestamp on hover (Phase 2 task §45):
 * 表格里「5 分钟前」，悬停看「2026-09-10 16:30:22」。
 *
 * 2026-10-17 体检 P1-6：改造前每个单元格都包一层 antd `Tooltip`。订单页 100 行 × 2 个
 * 时间列 = 200 个 rc-tooltip 实例常驻（含 trigger 与定位逻辑），却只在 hover 时有用，
 * 而且表格每次重渲染这些实例全部重建——是订单页重渲染成本的主要放大器之一。
 *
 * 改用原生 `title`：零实例、零浮层、零 JS，悬浮看绝对时间的能力完全不变（观感从
 * antd 浮层变成系统提示）。相对时间仍然在渲染时计算。
 */
export interface RelativeTimeProps {
  value: string | null | undefined;
  fallback?: string;
}

export function RelativeTime({ value, fallback = '—' }: RelativeTimeProps) {
  if (value === null || value === undefined || value === '') {
    return <span style={{ color: '#98A2B3' }}>{fallback}</span>;
  }
  return (
    <span
      title={fmtDateTime(value)}
      style={{ fontVariantNumeric: 'tabular-nums', cursor: 'default' }}
    >
      {relativeTime(value)}
    </span>
  );
}
