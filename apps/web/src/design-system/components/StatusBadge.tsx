import { Tooltip } from 'antd';
import { ReactNode } from 'react';
import { colors } from '../tokens';

/**
 * Unified status badge (task §56). Pages must pick a semantic tone instead of
 * random Tag colors. State is conveyed by text + dot, never color alone.
 */

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';

const TONE_STYLES: Record<StatusTone, { bg: string; border: string; text: string; dot: string }> = {
  success: {
    bg: colors.successBg,
    border: colors.successBorder,
    text: colors.success,
    dot: colors.success,
  },
  warning: {
    bg: colors.warningBg,
    border: colors.warningBorder,
    text: colors.warning,
    dot: colors.warning,
  },
  danger: {
    bg: colors.dangerBg,
    border: colors.dangerBorder,
    text: colors.danger,
    dot: colors.danger,
  },
  info: { bg: colors.infoBg, border: colors.infoBorder, text: colors.info, dot: colors.info },
  neutral: {
    bg: colors.neutralBg,
    border: colors.neutralBorder,
    text: colors.neutral,
    dot: colors.neutral,
  },
  purple: {
    bg: colors.purpleBg,
    border: colors.purpleBorder,
    text: colors.purple,
    dot: colors.purple,
  },
};

export interface StatusBadgeProps {
  /** Semantic tone — decides the whole color pair. */
  tone: StatusTone;
  /** Short status label, e.g. READY_TO_PICK. */
  label: ReactNode;
  /** Optional longer explanation for hover / screen readers. */
  hint?: string;
  /** Hide the dot for very dense tables (text still carries the state). */
  showDot?: boolean;
}

export function StatusBadge({ tone, label, hint, showDot = true }: StatusBadgeProps) {
  const style = TONE_STYLES[tone];
  const badge = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 8px',
        borderRadius: 6,
        background: style.bg,
        border: `1px solid ${style.border}`,
        color: style.text,
        fontSize: 12,
        lineHeight: '20px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {showDot && (
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: style.dot,
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
  if (hint === undefined) {
    return badge;
  }
  return (
    <Tooltip title={hint}>
      <span style={{ cursor: 'default' }}>{badge}</span>
    </Tooltip>
  );
}

// ---- Domain status maps (kept here so every page shares one mapping) ----

/** ERP order status → badge tone + Chinese label (OrdersPage + Dashboard). */
export const ERP_STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  NEW: { tone: 'neutral', label: '待处理' },
  ALLOCATING: { tone: 'info', label: '分配中' },
  READY_TO_PICK: { tone: 'info', label: '待拣货' },
  PARTIALLY_BACKORDERED: { tone: 'warning', label: '部分缺货' },
  BACKORDERED: { tone: 'warning', label: '缺货' },
  PICKING: { tone: 'info', label: '拣货中' },
  PICKED: { tone: 'success', label: '已拣货' },
  PARTIALLY_SHIPPED: { tone: 'success', label: '部分发货' },
  SHIPPED: { tone: 'success', label: '已发货' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
  EXCEPTION: { tone: 'danger', label: '异常' },
};

/** Order item fulfillment status → tone (Orders detail). */
export const FULFILLMENT_STATUS_META: Record<string, StatusTone> = {
  PENDING: 'neutral',
  RESERVED: 'info',
  BACKORDERED: 'warning',
  PICKED: 'success',
  RELEASED: 'neutral',
};

/** Picking task status → tone + label. */
export const PICKING_STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  CREATED: { tone: 'neutral', label: '已创建' },
  IN_PROGRESS: { tone: 'info', label: '进行中' },
  COMPLETED: { tone: 'success', label: '已完成' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Inventory row status → tone + label. */
export const INVENTORY_STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  IN_STOCK: { tone: 'success', label: '有可售' },
  OUT_OF_STOCK: { tone: 'danger', label: '无可售' },
};

/** SKU status → tone + label. */
export const SKU_STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  ACTIVE: { tone: 'success', label: '启用' },
  INACTIVE: { tone: 'neutral', label: '停用' },
  DRAFT: { tone: 'neutral', label: '草稿' },
};

/** Sync job status → tone + label (Dashboard rail). */
export const SYNC_STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  PENDING: { tone: 'neutral', label: '等待中' },
  RUNNING: { tone: 'info', label: '运行中' },
  SUCCESS: { tone: 'success', label: '成功' },
  PARTIAL: { tone: 'warning', label: '部分成功' },
  FAILED: { tone: 'danger', label: '失败' },
};
