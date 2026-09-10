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

/**
 * Enum values must never render into the DOM raw: look them up in a label
 * map and fall back to the raw value HERE (one place), keeping the raw value
 * visible for troubleshooting (Sprint 6 task §11.3).
 */
export function labelOf(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return map[value] ?? value;
}

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

/** Order item fulfillment status → tone + label (Orders detail, decision #15). */
export const FULFILLMENT_STATUS_META: Record<string, { tone: StatusTone; label: string }> = {
  PENDING: { tone: 'neutral', label: '待处理' },
  RESERVED: { tone: 'info', label: '已占用' },
  BACKORDERED: { tone: 'warning', label: '缺货' },
  PICKED: { tone: 'success', label: '已拣货' },
  RELEASED: { tone: 'neutral', label: '已释放' },
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

/** Import job status → label (ImportPage). */
export const IMPORT_STATUS_LABEL: Record<string, string> = {
  VALIDATED: '已校验',
  PENDING_IMPORT: '待导入',
  IMPORTING: '导入中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

/** Order interception status → label (Interceptions pages). */
export const INTERCEPTION_STATUS_LABEL: Record<string, string> = {
  CREATED: '已创建',
  ASSIGNED: '已指派',
  LOCATING: '查找中',
  INTERCEPTED: '已拦截',
  FAILED: '失败',
  RETURNED_TO_STOCK: '已回库',
  CLOSED: '已关闭',
};

/** Shipment status → label (Shipments pages). */
export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  READY_TO_PACK: '待打包',
  PACKING: '打包中',
  READY_TO_SHIP: '待发货',
  SHIPPED: '已发货',
  CANCELLED: '已取消',
  EXCEPTION: '异常',
};

/** Package status → label (Shipment detail / PackageWork). */
export const PACKAGE_STATUS_LABEL: Record<string, string> = {
  OPEN: '打开',
  SEALED: '已封箱',
  SHIPPED: '已发货',
  CANCELLED: '已取消',
  REPACK_REQUIRED: '需重新打包',
};

/** Reservation (库存占用) status → label (decision #15). */
export const RESERVATION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '已占用',
  PICKED: '已拣货',
  RELEASED: '已释放',
  CONSUMED: '已出库',
  CANCELLED: '已取消',
};

/** Inventory transaction type → label (库存流水). */
export const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  INITIAL_STOCK: '期初建账',
  RECEIVE: '入库',
  RESERVE: '占用',
  RELEASE: '释放占用',
  PICK: '拣货',
  UNPICK: '取消拣货',
  SHIP: '出库',
  RETURN_PICKED: '拦截回库',
  MOVE_BIN: '移库',
  MANUAL_ADJUSTMENT: '人工调整',
};

/** Fulfillment mode → label (bindings / listings). */
export const FULFILLMENT_MODE_LABEL: Record<string, string> = {
  OZON_RFBS: 'OZON 真仓配送',
  OZON_FBS: 'OZON 真仓入库',
  OZON_FBO: 'OZON 平台仓',
  OZON_FBP: 'OZON 半托管',
  WB_FBS: 'WB 真仓配送',
  WB_FBW: 'WB 平台仓',
  YANDEX_FBS: 'Yandex 真仓配送',
  YANDEX_FBY: 'Yandex 平台仓',
};

/** Barcode type → label (SKU barcodes). */
export const BARCODE_TYPE_LABEL: Record<string, string> = {
  EAN: 'EAN 商品码',
  GTIN: 'GTIN',
  MANUFACTURER: '厂家条码',
  INTERNAL: '内部条码',
  OTHER: '其他',
};

/** Credential type → label (Stores). */
export const CREDENTIAL_TYPE_LABEL: Record<string, string> = {
  MAIN_API: '主 API',
};

/** Common ACTIVE/INACTIVE label. */
export const ACTIVE_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
  DISABLED: '停用',
};
