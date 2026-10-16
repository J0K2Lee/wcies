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
export function labelOf(map: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return map[value] ?? value;
}

/** Shape every domain status META table shares (UI spec §5.1). */
export interface StatusMeta {
  tone: StatusTone;
  label: string;
  /** Optional longer explanation rendered as the badge tooltip. */
  hint?: string;
}

/** ERP order status → badge tone + Chinese label (OrdersPage + Dashboard). */
export const ERP_STATUS_META: Record<string, StatusMeta> = {
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

/**
 * Order item fulfillment status → tone + label (Orders detail, decision #15).
 * 与后端 ORDER_ITEM_FULFILLMENT_STATUSES 一一对应（order.constants.ts）；
 * 行出库后随物流流转，SHIPPED 显示为「运输中」（用户指示 2026-10-13）。
 */
export const FULFILLMENT_STATUS_META: Record<string, StatusMeta> = {
  PENDING: { tone: 'neutral', label: '待处理' },
  RESERVED: { tone: 'info', label: '已占用' },
  BACKORDERED: { tone: 'warning', label: '缺货' },
  PICKED: { tone: 'success', label: '已拣货' },
  SHIPPED: { tone: 'success', label: '运输中' },
  RELEASED: { tone: 'neutral', label: '已释放' },
  EXTERNAL_FULFILLED: { tone: 'info', label: '外部履约' },
};

/** Picking task status → tone + label. */
export const PICKING_STATUS_META: Record<string, StatusMeta> = {
  CREATED: { tone: 'neutral', label: '已创建' },
  IN_PROGRESS: { tone: 'info', label: '进行中' },
  COMPLETED: { tone: 'success', label: '已完成' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Inventory row status → tone + label. */
export const INVENTORY_STATUS_META: Record<string, StatusMeta> = {
  IN_STOCK: { tone: 'success', label: '有可售' },
  OUT_OF_STOCK: { tone: 'danger', label: '无可售' },
};

/** SKU status → tone + label. */
export const SKU_STATUS_META: Record<string, StatusMeta> = {
  ACTIVE: { tone: 'success', label: '启用' },
  INACTIVE: { tone: 'neutral', label: '停用' },
  DRAFT: { tone: 'neutral', label: '草稿' },
};

/** Sync job status → tone + label (Dashboard rail). */
export const SYNC_STATUS_META: Record<string, StatusMeta> = {
  PENDING: { tone: 'neutral', label: '等待中' },
  RUNNING: { tone: 'info', label: '运行中' },
  SUCCESS: { tone: 'success', label: '成功' },
  PARTIAL: { tone: 'warning', label: '部分成功' },
  FAILED: { tone: 'danger', label: '失败' },
};

/** Import job status → tone + label (ImportPage, G3). */
export const IMPORT_STATUS_META: Record<string, StatusMeta> = {
  VALIDATED: { tone: 'info', label: '已校验', hint: '已解析并校验，等待确认导入' },
  PENDING_IMPORT: { tone: 'warning', label: '待导入' },
  IMPORTING: { tone: 'info', label: '导入中' },
  COMPLETED: { tone: 'success', label: '已完成' },
  FAILED: { tone: 'danger', label: '失败' },
};

/** Import job type → label (ImportPage). */
export const IMPORT_TYPE_LABEL: Record<string, string> = {
  SKU: 'SKU（含条码/商品）',
  BARCODE: '条码',
  WAREHOUSE: '仓库',
  BIN: '库位',
  LISTING_MAPPING: 'Listing 映射',
  INITIAL_INVENTORY: '库存初始化',
};

/** Order interception status → tone + label (Interceptions pages, G3). */
export const INTERCEPTION_STATUS_META: Record<string, StatusMeta> = {
  CREATED: { tone: 'info', label: '已创建' },
  ASSIGNED: { tone: 'info', label: '已指派' },
  LOCATING: { tone: 'info', label: '查找中', hint: '拦截人正在库内定位实物' },
  INTERCEPTED: { tone: 'warning', label: '已拦截', hint: '实物已找到，等待扫码回库' },
  FAILED: { tone: 'danger', label: '失败', hint: '未找到实物或回库失败' },
  RETURNED_TO_STOCK: { tone: 'success', label: '已回库' },
  CLOSED: { tone: 'neutral', label: '已关闭' },
};

/** Shipment status → tone + label (Shipments pages, G3). */
export const SHIPMENT_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: { tone: 'neutral', label: '草稿' },
  READY_TO_PACK: { tone: 'info', label: '待打包' },
  PACKING: { tone: 'info', label: '打包中' },
  READY_TO_SHIP: { tone: 'info', label: '待发货' },
  SHIPPED: { tone: 'success', label: '已发货' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
  EXCEPTION: { tone: 'danger', label: '异常' },
};

/** Package status → tone + label (Shipment detail / PackageWork, G3). */
export const PACKAGE_STATUS_META: Record<string, StatusMeta> = {
  OPEN: { tone: 'info', label: '待打包', hint: '包裹已创建，等待扫码打包' },
  SEALED: { tone: 'success', label: '已封箱' },
  SHIPPED: { tone: 'success', label: '已发货' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
  REPACK_REQUIRED: { tone: 'warning', label: '需重新打包', hint: '拦截/作废后需拆箱重打' },
};

/** Reservation (库存占用) status → tone + label (G3, page-local table removed). */
export const RESERVATION_STATUS_META: Record<string, StatusMeta> = {
  ACTIVE: { tone: 'info', label: '已占用' },
  PICKED: { tone: 'info', label: '已拣货', hint: '实物已离开库位，等待出库' },
  RELEASED: { tone: 'neutral', label: '已释放' },
  CONSUMED: { tone: 'success', label: '已出库' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Inventory transaction type → tone + label (库存流水, G3). */
export const TRANSACTION_TYPE_META: Record<string, StatusMeta> = {
  INITIAL_STOCK: { tone: 'neutral', label: '期初建账' },
  RECEIVE: { tone: 'success', label: '入库' },
  RESERVE: { tone: 'info', label: '占用' },
  RELEASE: { tone: 'neutral', label: '释放占用' },
  PICK: { tone: 'info', label: '拣货' },
  UNPICK: { tone: 'neutral', label: '取消拣货' },
  SHIP: { tone: 'info', label: '出库' },
  RETURN_PICKED: { tone: 'success', label: '拦截回库' },
  MOVE_BIN: { tone: 'neutral', label: '移库' },
  MANUAL_ADJUSTMENT: { tone: 'warning', label: '人工调整' },
};

/** Return batch status → tone + label (ReturnsPage, migrated per G3). */
export const RETURN_BATCH_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: { tone: 'neutral', label: '草稿' },
  RECEIVED: { tone: 'info', label: '已收货', hint: '实物已到仓，可逐行检验' },
  COMPLETED: { tone: 'success', label: '已完成' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Return line inspection condition → tone + label (ReturnsPage, G3). */
export const RETURN_CONDITION_META: Record<string, StatusMeta> = {
  PENDING: { tone: 'info', label: '待检验' },
  SELLABLE: { tone: 'success', label: '合格回库' },
  DEFECTIVE: { tone: 'danger', label: '不合格（隔离）' },
  LOST: { tone: 'warning', label: '缺失' },
};

/** Notification delivery status → tone + label (Bell + NotificationsPage, G3). */
export const NOTIFICATION_STATUS_META: Record<string, StatusMeta> = {
  PENDING: { tone: 'info', label: '投递中' },
  SENT: { tone: 'success', label: '已送达' },
  FAILED: { tone: 'danger', label: '投递失败' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Finance payout status → tone + label (finance pages, Sprint 10 G3). */
export const FINANCE_PAYOUT_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: { tone: 'neutral', label: '草稿' },
  CONFIRMED: { tone: 'success', label: '已确认', hint: '已生成关联销售收入流水' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Finance transaction category → tone + label (finance pages, Sprint 10 G3). */
export const FINANCE_CATEGORY_META: Record<string, StatusMeta> = {
  SALE_INCOME: { tone: 'success', label: '销售收入' },
  SALE_REFUND: { tone: 'danger', label: '订单退款' },
  PURCHASE_PAYMENT: { tone: 'warning', label: '采购付款' },
  SUPPLIER_REFUND: { tone: 'info', label: '供应商退款' },
  PLATFORM_FEE: { tone: 'warning', label: '平台费用' },
  LOGISTICS_FEE: { tone: 'warning', label: '物流费用' },
  OTHER_INCOME: { tone: 'success', label: '其他收入' },
  OTHER_EXPENSE: { tone: 'neutral', label: '其他支出' },
};

/** Derived purchase payment state → tone + label (payables page, G3). */
export const PURCHASE_PAYMENT_STATE_META: Record<string, StatusMeta> = {
  NOTHING_TO_PAY: { tone: 'neutral', label: '无需付款', hint: '采购单未登记成本' },
  UNPAID: { tone: 'warning', label: '未付款' },
  PARTIAL: { tone: 'info', label: '部分付款' },
  PAID: { tone: 'success', label: '已付清' },
  OVERPAID: { tone: 'danger', label: '超付', hint: '已付金额超过应付' },
};

/** Transfer order status → tone + label (transfer page, Sprint 10 G3). */
export const TRANSFER_STATUS_META: Record<string, StatusMeta> = {
  DRAFT: { tone: 'neutral', label: '草稿' },
  CONFIRMED: { tone: 'success', label: '已确认', hint: '库存已双段移动' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

/** Notification event type → tone + label (Bell + NotificationsPage, G3). */
export const NOTIFICATION_TYPE_META: Record<string, StatusMeta> = {
  ORDER_INTERCEPTION_REQUIRED: { tone: 'warning', label: '需要拦截' },
  ORDER_INTERCEPTION_FAILED: { tone: 'danger', label: '拦截失败' },
};

/**
 * Fulfillment mode metadata (bindings / listings).
 *
 * Mirrors `FULFILLMENT_MODE_PLATFORM` / `FULFILLMENT_MODE_CATEGORY` in
 * apps/api/src/modules/platform/constants/platform.constants.ts, which is the
 * source of truth. Kept as one table so the dropdown (platform filter +
 * category grouping) and the list column read the same facts.
 *
 * `category` is the seller-facing business model (who holds and ships);
 * `label` is the platform's own vocabulary, which is what the platform
 * back office shows and what order ingestion matches on.
 */
export const FULFILLMENT_CATEGORY_LABEL: Record<string, string> = {
  SELF_MANAGED: '自管仓',
  SEMI_MANAGED: '半托管',
  MANAGED: '托管仓',
};

export const FULFILLMENT_MODE_META: Record<
  string,
  { platform: string; category: string; label: string; hint: string }
> = {
  OZON_RFBS: {
    platform: 'OZON',
    category: 'SELF_MANAGED',
    label: 'realFBS',
    hint: '卖家持货，自行发货给买家',
  },
  OZON_FBS: {
    platform: 'OZON',
    category: 'SELF_MANAGED',
    label: 'FBS',
    hint: '卖家持货，发货至 OZON 分拣中心',
  },
  OZON_FBP: {
    platform: 'OZON',
    category: 'SEMI_MANAGED',
    label: 'FBP',
    hint: '卖家备货至平台国内合作仓，平台负责跨境与尾程',
  },
  OZON_FBO: {
    platform: 'OZON',
    category: 'MANAGED',
    label: 'FBO',
    hint: 'OZON 仓库持货并发货',
  },
  WB_FBS: {
    platform: 'WB',
    category: 'SELF_MANAGED',
    label: 'FBS',
    hint: '卖家持货，按单发货至 WB 仓',
  },
  WB_FBW: {
    platform: 'WB',
    category: 'MANAGED',
    label: 'FBW',
    hint: 'WB 仓库持货并发货',
  },
  YANDEX_FBS: {
    platform: 'YANDEX',
    category: 'SELF_MANAGED',
    label: 'FBS',
    hint: '卖家持货并自行发货',
  },
  YANDEX_FBY: {
    platform: 'YANDEX',
    category: 'MANAGED',
    label: 'FBY',
    hint: 'Yandex 仓库持货并发货',
  },
};

/** "自管仓 · FBS" — category first (business view), then the platform code. */
export function fulfillmentModeLabel(mode: string): string {
  const meta = FULFILLMENT_MODE_META[mode];
  if (meta === undefined) {
    return mode;
  }
  return `${FULFILLMENT_CATEGORY_LABEL[meta.category] ?? meta.category} · ${meta.label}`;
}

/**
 * Kept for existing call sites that render a bare mode string; delegates to
 * the table above so labels cannot drift between pages.
 */
export const FULFILLMENT_MODE_LABEL: Record<string, string> = Object.fromEntries(
  Object.keys(FULFILLMENT_MODE_META).map((mode) => [mode, fulfillmentModeLabel(mode)]),
);

/**
 * 外部履约判定（用户指示 2026-10-16）：FBO/FBP/FBW/FBY（托管/半托管）由平台
 * 仓库持货发货，ERP 无内部动作。镜像后端 `isExternalFulfillmentMode`
 * （platform.constants.ts）——完整常量（OZON_FBP）与订单短码（FBP）都要识别。
 * 前端仅用于展示判断（如外部履约单不显示发货时限倒计时）；事实仍以后端为准。
 */
const EXTERNAL_FULFILLMENT_TOKENS = ['FBO', 'FBP', 'FBW', 'FBY'];

export function isExternalFulfillmentMode(mode: string | null | undefined): boolean {
  if (typeof mode !== 'string' || mode === '') {
    return false;
  }
  const meta = FULFILLMENT_MODE_META[mode];
  if (meta !== undefined && (meta.category === 'MANAGED' || meta.category === 'SEMI_MANAGED')) {
    return true;
  }
  const suffix = mode.includes('_') ? mode.slice(mode.lastIndexOf('_') + 1) : mode;
  return EXTERNAL_FULFILLMENT_TOKENS.includes(suffix);
}

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

// ---- Legacy label-only views (derived from the META tables, Phase 3 G3) ----
// One source of truth: these are pure projections so they cannot drift. They
// exist only while pages migrate to the META tables; removed in Phase 3 T7.

/** @deprecated use IMPORT_STATUS_META */
export const IMPORT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(IMPORT_STATUS_META).map(([key, meta]) => [key, meta.label]),
);

/** @deprecated use INTERCEPTION_STATUS_META */
export const INTERCEPTION_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(INTERCEPTION_STATUS_META).map(([key, meta]) => [key, meta.label]),
);

/** @deprecated use SHIPMENT_STATUS_META */
export const SHIPMENT_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(SHIPMENT_STATUS_META).map(([key, meta]) => [key, meta.label]),
);

/** @deprecated use PACKAGE_STATUS_META */
export const PACKAGE_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(PACKAGE_STATUS_META).map(([key, meta]) => [key, meta.label]),
);

/** @deprecated use RESERVATION_STATUS_META */
export const RESERVATION_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(RESERVATION_STATUS_META).map(([key, meta]) => [key, meta.label]),
);

/** @deprecated use TRANSACTION_TYPE_META */
export const TRANSACTION_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(TRANSACTION_TYPE_META).map(([key, meta]) => [key, meta.label]),
);
