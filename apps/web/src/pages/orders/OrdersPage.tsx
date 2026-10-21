import { Key, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ColumnsType } from 'antd/es/table';
import {
  App as AntdApp,
  Button,
  Checkbox,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Tabs,
  Timeline,
  Tooltip,
} from 'antd';
import { CopyOutlined, DownOutlined, FlagFilled, UpOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { apiGet, apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { buildOzonProductUrl, buildPlatformProductUrl } from '../../utils/platformUrl';
import { openShippingLabelPrintWindow, showMergedPdfInWindow } from '../../printing/print-browser';
import { ListingOnboardModal, OnboardMatchIdentifiers } from '../../components/ListingOnboardModal';
import { ListingVariantMapModal } from '../../components/ListingVariantMapModal';
import {
  ActionIsland,
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  ERP_STATUS_META,
  FilterChips,
  FULFILLMENT_STATUS_META,
  FULFILLMENT_MODE_META,
  FilterBar,
  InfoGrid,
  isExternalFulfillmentMode,
  PageHeader,
  PICKING_STATUS_META,
  PlatformTag,
  RailHint,
  RawDataBlock,
  rowInteractionProps,
  INTERCEPTION_STATUS_META,
  SectionCard,
  StatusBadge,
  colors,
  RelativeTime,
  useContextRail,
  ContextRailContent,
} from '../../design-system';
import {
  ColumnSetting,
  OrdersViewSettings,
  loadViewSettings,
  VIEW_SETTINGS_KEY,
} from './view-settings';

/**
 * Orders workbench (redesign task §37-§43; 用户指示 2026-09-17 改造)：
 * - 视图设置（原「摄入测试订单」按钮位置）：默认展开全部、每页行数、
 *   主表/展开行列显隐与拖动排序、主图缩略图尺寸（localStorage 持久化）；
 * - 履约方式独立列 + 筛选（「平台/店铺」列改为「店铺」，仅平台图标+店铺名）；
 * - 展开行：方形主图（不裁剪）、最近采购价；点击展开行 → 侧边栏 SKU 信息
 *   + 创建采购单（复用登记采购弹窗）；
 * - 下单时间显示为日期+时间点。
 */

interface OrderListItem {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  platformCode: string;
  platformOrderId: string;
  platformStatus: string | null;
  /** 归一化物流阶段（平台事实）：AWAITING_SHIPMENT/IN_TRANSIT/DELIVERED，未同步为 null。 */
  platformStage: string | null;
  erpStatus: string;
  /** 面单已打印时间（人工确认）；null = 未打印。 */
  labelPrintedAt: string | null;
  fulfillmentMode: string | null;
  currency: string | null;
  orderedAt: string;
  /** Platform-required ship-by time (OZON shipment_date); platform fact, not ERP state. */
  shipmentDeadline: string | null;
  /**
   * 平台运单号（平台事实，2026-09-18 发货流程）。OZON 只在组包后分配，
   * 所以在只拿到 awaiting_packaging 的订单上它为空。
   */
  platformTrackingNo: string | null;
  createdAt: string;
  itemsCount: number;
  reservedCount: number;
  backorderedCount: number;
  /** Backordered lines whose live purchase order is registered (dual-axis §2.3). */
  backorderedOrderedCount: number;
  /** Backordered lines whose purchase already fully arrived (dual-axis §2.3). */
  backorderedArrivedCount: number;
  pickedCount: number;
  mappingFailedCount: number;
  openExceptionsCount: number;
  /** 该单 SKU 编码的字典序最小值（SKU 列展示 + SKU 排序键）；全行未映射为 null。 */
  firstSkuCode: string | null;
  /** 该单不同 SKU 编码的种类数。 */
  skuKindCount: number;
  /** 加急订单（ADR 0022）：列表恒定置顶，缺货到货后优先分配。 */
  isUrgent: boolean;
}

interface OrderItem {
  id: string;
  lineNo: number;
  skuCode: string;
  skuName: string;
  /** SKU 主数据维护的最近采购价（master-data.md §4.3；用户指示 2026-09-17 展示）。 */
  latestPurchasePrice: string | null;
  quantity: string;
  unitPrice: string | null;
  totalPrice: string | null;
  imageUrl: string | null;
  /**
   * 主图来源（T8 建议#4）：INTERNAL = 内部 SKU 主图；PLATFORM = 未映射行
   * 回退的平台公开图片直链。用于「平台图」角标区分，与内部主图不混淆。
   */
  imageSource: 'INTERNAL' | 'PLATFORM' | null;
  fulfillmentStatus: string;
  mappingStatus: string;
  /** Derived procurement state (purchase.md §3.5); NULL for unmapped lines. */
  procurementState: string | null;
  /** Platform identifiers of the line; present even when mapping FAILED. */
  platformProductId: string | null;
  platformSkuId: string | null;
  offerId: string | null;
  sellerSku: string | null;
  skuId: string | null;
  reservationId: string | null;
  reservation: {
    reservationNo: string;
    status: string;
    lines: Array<{ binCode: string; quantity: string; pickedQty: string }>;
  } | null;
  exceptions: Array<{
    exceptionNo: string;
    exceptionType: string;
    status: string;
    message: string;
  }>;
}

interface OrderDetail {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  platformCode: string;
  platformOrderId: string;
  platformStatus: string | null;
  platformStage: string | null;
  erpStatus: string;
  labelPrintedAt: string | null;
  fulfillmentMode: string | null;
  currency: string | null;
  orderedAt: string;
  shipmentDeadline: string | null;
  /** 平台运单号（平台事实）；出库时自动带入发货单物流单号。 */
  platformTrackingNo: string | null;
  /** 该店铺平台是否支持发货写能力；前端据此显隐「获取运单号 / 打单」按钮。 */
  platformCapabilities: { prepareShipment: boolean; fetchShippingLabel: boolean };
  syncSource: string | null;
  rawData: Record<string, unknown> | null;
  items: OrderItem[];
  history: Array<{
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    operatorName: string | null;
    createdAt: string;
  }>;
  /** Raw platform status transitions (Sprint 9 T1); merged into the timeline. */
  platformStatusHistory: Array<{
    fromStatus: string | null;
    toStatus: string;
    source: string | null;
    operatorName: string | null;
    createdAt: string;
  }> | null;
  interceptions: Array<{
    interceptionNo: string;
    status: string;
    orderItemId: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  pickingTasks: Array<{
    id: string;
    pickingNo: string;
    status: string;
    totalItems: number;
    pickedItems: number;
  }>;
}

type Envelope<T> = { data: T; meta: { total: number } };

/** 平台面单（订单级，source=PLATFORM_API）；signedUrl 为短期签名地址。 */
interface ShippingLabelItem {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  source: string;
  createdAt: string;
  signedUrl: string;
}

/**
 * Axis 1 - order logistics stage tabs (dual-axis §2.1, orders.md §17a).
 * Default view is 待处理: everything not yet shipped/cancelled, so
 * backordered and divergent orders are front and center. The stage semantics
 * live on the BACKEND (`stage` query param); the tab only maps to its value.
 */
const STAGE_TABS: Array<{ key: string; label: string; stage?: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理', stage: 'PENDING' },
  // 外部履约单（FBO/FBP/FBW/FBY）独立收纳（用户指示 2026-10-16）：ERP 无内部
  // 动作，此前混在「待处理」里像待办。平台发货后随 erp_status 转 SHIPPED 归入
  // 「待收货」，妥投后归入「已完成」。
  { key: 'external', label: '外部履约', stage: 'EXTERNAL' },
  // 2026-10-19：「待收货」更名为「已发货」（= 已发货未签收）。
  { key: 'inTransit', label: '已发货', stage: 'IN_TRANSIT' },
  { key: 'completed', label: '已完成', stage: 'COMPLETED' },
  // 已取消独立成 Tab（2026-10-19）：此前只在「全部」里可见。
  { key: 'cancelled', label: '已取消', stage: 'CANCELLED' },
];

/**
 * Axis 2 - line-level goods-state chips (dual-axis §2.2, orders.md §17b).
 * Single-select on top of the stage tab; the predicates run on the backend
 * (`goodsState` query param) so chips catch orders whose rollup status hides
 * a line problem (e.g. PARTIALLY_SHIPPED + one BACKORDERED line).
 * Rendered via DS FilterChips (Phase 3 T3): flow chips default tone, risk
 * chips danger tone, grouped with a divider.
 */
const GOODS_STATE_CHIPS: Array<{
  key: string;
  label: string;
  flow: boolean;
  tooltip: string;
}> = [
  { key: 'ALL', label: '全部', flow: true, tooltip: '不按货物状态筛选（仅一级物流阶段）' },
  {
    key: 'PURCHASED',
    label: '已采购',
    flow: true,
    tooltip: '存在缺货行且该行采购状态为「已采购」（已下单未收完；已到货不计）',
  },
  {
    key: 'TO_PICK',
    label: '待拣货',
    flow: true,
    tooltip: '存在已占用待拣货的订单行',
  },
  {
    key: 'PICKING',
    label: '拣货中',
    flow: true,
    tooltip: '订单存在未完成的拣货任务（可同时命中「待拣货」）',
  },
  {
    key: 'LABEL_PRINTED',
    label: '已打单',
    flow: true,
    tooltip: '面单已打印且订单尚未发货',
  },
  {
    key: 'TO_SHIP',
    label: '待发货',
    flow: true,
    tooltip: '存在已拣货待出库的订单行',
  },
  {
    key: 'BACKORDERED',
    label: '缺货',
    flow: false,
    tooltip: '存在库存不足的订单行；行内可见「已采购 / 已到货」',
  },
  {
    key: 'MAPPING_FAILED',
    label: '映射失败',
    flow: false,
    tooltip: '存在无法映射内部 SKU 的订单行（不知道是什么 SKU，去 SKU 映射补齐后重试）',
  },
  {
    key: 'SHIPMENT_OVERDUE',
    label: '发货超时',
    flow: false,
    tooltip:
      '已过平台发货时限且订单未发完（含部分发货剩余行未出）；平台已事实发货（运输中/已送达）的订单不算发货超时',
  },
  {
    key: 'ABNORMAL',
    label: '异常',
    flow: false,
    tooltip: '缺货 ∪ 映射失败 ∪ 发货超时 ∪ 物流停滞（在途超 3 天未动）任一命中',
  },
];

const PROCUREMENT_META: Record<string, { tone: 'danger' | 'info' | 'success'; label: string }> = {
  NOT_ORDERED: { tone: 'danger', label: '待采购' },
  ORDERED: { tone: 'info', label: '已采购' },
  ARRIVED: { tone: 'success', label: '已到货' },
};

// ---------------------------------------------------------------------------
// 视图设置（用户指示 2026-09-17）：localStorage 持久化，缺省值前向兼容合并。
// ---------------------------------------------------------------------------

const MAIN_COLUMN_LABELS: Record<string, string> = {
  platformOrderId: '订单号',
  items: '商品',
  sku: 'SKU',
  erpStatus: 'ERP 状态',
  logistics: '物流',
  storeFulfillment: '店铺·履约',
  shipmentDeadline: '时限',
  orderedAt: '下单时间',
  platformTrackingNo: '运单号',
};

/**
 * 排序预设（2026-10-14 用户指示）：视图设置弹窗「默认排序」下拉的选项；
 * 值格式 `字段:方向`。列表页按钮只切会话态（三字段固定方向），
 * 默认排序在这里配置。
 */
const SORT_PRESETS: Array<{
  value: string;
  label: string;
  sortBy: OrdersViewSettings['defaultSortBy'];
  sortOrder: OrdersViewSettings['defaultSortOrder'];
}> = [
  { value: 'orderedAt:desc', label: '下单时间 新→旧', sortBy: 'orderedAt', sortOrder: 'desc' },
  { value: 'orderedAt:asc', label: '下单时间 旧→新', sortBy: 'orderedAt', sortOrder: 'asc' },
  { value: 'skuCode:asc', label: 'SKU 编码 A→Z', sortBy: 'skuCode', sortOrder: 'asc' },
  { value: 'skuCode:desc', label: 'SKU 编码 Z→A', sortBy: 'skuCode', sortOrder: 'desc' },
  {
    value: 'shipmentDeadline:asc',
    label: '发货时限 近→远',
    sortBy: 'shipmentDeadline',
    sortOrder: 'asc',
  },
  {
    value: 'shipmentDeadline:desc',
    label: '发货时限 远→近',
    sortBy: 'shipmentDeadline',
    sortOrder: 'desc',
  },
];

/**
 * 列表排序按钮（用户指示 2026-10-14 图示：默认排序 / 下单时间 / 发货时间 /
 * SKU）。字段按钮只切当前会话（方向固定：下单时间新→旧、发货时限近→远、
 * SKU A→Z）；再点已选中的按钮回到默认排序。默认值在视图设置配置。
 */
const SORT_FIELD_BUTTONS: Array<{
  field: OrdersViewSettings['defaultSortBy'];
  label: string;
  sortBy: OrdersViewSettings['defaultSortBy'];
  sortOrder: OrdersViewSettings['defaultSortOrder'];
}> = [
  { field: 'orderedAt', label: '下单时间排序', sortBy: 'orderedAt', sortOrder: 'desc' },
  {
    field: 'shipmentDeadline',
    label: '发货时间排序',
    sortBy: 'shipmentDeadline',
    sortOrder: 'asc',
  },
  { field: 'skuCode', label: 'SKU排序', sortBy: 'skuCode', sortOrder: 'asc' },
];

const EXPANDED_COLUMN_LABELS: Record<string, string> = {
  image: '主图',
  sku: 'SKU',
  offerId: 'Offer ID',
  quantity: '数量',
  unitPrice: '单价',
  totalPrice: '小计',
  latestPurchasePrice: '最近采购价',
  fulfillmentStatus: '履约状态',
};

/**
 * 列设置面板：原生 HTML5 拖拽排序（不引入新依赖）+ 复选框显隐。
 */
function SortableColumnList({
  labelFor,
  columns,
  onReorder,
  onToggleVisible,
}: {
  labelFor: Record<string, string>;
  columns: ColumnSetting[];
  onReorder: (from: number, to: number) => void;
  onToggleVisible: (key: string) => void;
}) {
  const dragIndex = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {columns.map((column, index) => (
        <div
          key={column.key}
          draggable
          onDragStart={() => {
            dragIndex.current = index;
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOverIndex(index);
          }}
          onDragLeave={() => {
            setDragOverIndex((current) => (current === index ? null : current));
          }}
          onDrop={(event) => {
            event.preventDefault();
            if (dragIndex.current !== null && dragIndex.current !== index) {
              onReorder(dragIndex.current, index);
            }
            dragIndex.current = null;
            setDragOverIndex(null);
          }}
          onDragEnd={() => {
            dragIndex.current = null;
            setDragOverIndex(null);
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            borderRadius: 6,
            border: `1px solid ${dragOverIndex === index ? colors.primary : colors.border}`,
            background: dragOverIndex === index ? colors.primarySoft : undefined,
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          <span style={{ color: colors.textTertiary, fontSize: 12, letterSpacing: 1 }}>≡</span>
          <Checkbox checked={column.visible} onChange={() => onToggleVisible(column.key)} />
          <span style={{ fontSize: 13 }}>{labelFor[column.key] ?? column.key}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 履约模式 chip 文案（T8 建议#1）：FBS → FBS、RFBS → rFBS、FBP → FBP，
 * 其余（含未知新值）原样展示；null 不展示。共享包的 FULFILLMENT_MODE_LABEL
 * 是「自管仓 · FBS」完整文案，列表内用短 chip。
 */
function fulfillmentModeChip(mode: string | null): { short: string; hint: string } | null {
  if (mode === null) {
    return null;
  }
  const meta = FULFILLMENT_MODE_META[mode];
  if (meta !== undefined) {
    return { short: meta.label, hint: meta.hint };
  }
  if (mode === 'RFBS' || mode.endsWith('_RFBS')) {
    return { short: 'rFBS', hint: mode };
  }
  if (mode.includes('_')) {
    return { short: mode.slice(mode.lastIndexOf('_') + 1), hint: mode };
  }
  return { short: mode, hint: mode };
}

/**
 * 订单级物流阶段（用户指示 2026-10-19）：平台事实，与 ERP 状态两轴分离。
 * 待揽收 = 平台尚未交给承运商；运输中 = 已交承运商未签收；已签收 = 妥投。
 * 未归类/未同步（null）显示 `—`，不猜。
 */
const LOGISTICS_STAGE_META: Record<
  string,
  { tone: 'neutral' | 'info' | 'success'; label: string; hint: string }
> = {
  AWAITING_SHIPMENT: { tone: 'neutral', label: '待揽收', hint: '平台尚未交给承运商' },
  IN_TRANSIT: { tone: 'info', label: '运输中', hint: '已交承运商，尚未签收' },
  DELIVERED: { tone: 'success', label: '已签收', hint: '平台已妥投' },
  CANCELLED: { tone: 'neutral', label: '已取消', hint: '平台已取消' },
};

/** 履约方式胶囊配色（用户指示 2026-10-19）：rFBS/FBS 蓝、FBP/FBO 绿、FBW 紫、FBY 黄。 */
function fulfillmentModeTone(
  mode: string | null,
): 'info' | 'success' | 'purple' | 'warning' | 'neutral' {
  if (mode === null) {
    return 'neutral';
  }
  const short = (mode.includes('_') ? mode.slice(mode.lastIndexOf('_') + 1) : mode).toUpperCase();
  if (short === 'RFBS' || short === 'FBS') {
    return 'info';
  }
  if (short === 'FBP' || short === 'FBO') {
    return 'success';
  }
  if (short === 'FBW') {
    return 'purple';
  }
  if (short === 'FBY') {
    return 'warning';
  }
  return 'neutral';
}

/**
 * 复制到剪贴板（2026-10-19 用户指示）。局域网 http 属于非安全上下文，
 * navigator.clipboard 不可用，因此保留 execCommand 兜底。
 */
function copyToClipboard(text: string): boolean {
  if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return true;
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 行内复制按钮：空值不渲染；点击不冒泡（避免触发行选中/展开）。 */
function CopyTextButton({ value, title }: { value: string | null; title: string }) {
  const { message } = AntdApp.useApp();
  if (value === null || value === '') {
    return null;
  }
  return (
    <Button
      type="text"
      size="small"
      aria-label={`复制${title}`}
      title={`复制${title}`}
      style={{ padding: '0 4px', height: 18, minWidth: 18, color: colors.textTertiary }}
      onClick={(event) => {
        event.stopPropagation();
        const ok = copyToClipboard(value);
        if (ok) {
          void message.success(`${title}已复制`);
        } else {
          void message.error('复制失败，请手动选择文本复制');
        }
      }}
    >
      <CopyOutlined style={{ fontSize: 12 }} />
    </Button>
  );
}

/**
 * 履约方式筛选选项（用户反馈 2026-09-28）：从 FULFILLMENT_MODE_META 派生，
 * 不再写死 4 个 OZON 短码（旧列表缺 WB 的 FBW 和 Yandex 的 FBY）。
 * 选了平台只列该平台的有效短码；未选平台列出全部短码。短码取全码 `_` 后缀，
 * 与订单头 fulfillment_mode 的 mapper 短码一致。
 */
function fulfillmentModeOptionsFor(
  platform: string | undefined,
): Array<{ value: string; label: string }> {
  const byShort = new Map<string, string>();
  for (const [fullMode, meta] of Object.entries(FULFILLMENT_MODE_META)) {
    if (platform !== undefined && meta.platform !== platform) {
      continue;
    }
    const short = fullMode.slice(fullMode.indexOf('_') + 1);
    if (!byShort.has(short)) {
      byShort.set(short, fulfillmentModeChip(short)?.short ?? short);
    }
  }
  return [...byShort].map(([value, label]) => ({ value, label }));
}

/**
 * Sprint 9 T1.4 divergence marker: the platform reports shipped-side progress
 * (delivering / delivered) while the ERP order has not shipped. Pure display
 * of platform FACTS - ORD00000001-style offline-fulfilled orders.
 */
function platformDivergent(platformStatus: string | null, erpStatus: string): boolean {
  if (platformStatus !== 'delivering' && platformStatus !== 'delivered') {
    return false;
  }
  return erpStatus !== 'SHIPPED' && erpStatus !== 'CANCELLED';
}

/**
 * 订单是否已到「不再打面单」的终态（用户指示 2026-10-21）。
 *
 * 与后端 `isOrderLabelPrintBlocked` 同口径：CANCELLED，或
 * SHIPPED + platform_stage DELIVERED（列表的「已完成」）。
 * 平台已妥投但 ERP 尚未 SHIPPED 的背离单**不**禁打。
 */
function isLabelPrintBlocked(order: { erpStatus: string; platformStage: string | null }): boolean {
  return (
    order.erpStatus === 'CANCELLED' ||
    (order.erpStatus === 'SHIPPED' && order.platformStage === 'DELIVERED')
  );
}

/** 强匹配标识：订单解析只认 platform_sku_id（决策 0016），其次 seller_sku /
 *  offer_id——与映射工作台 keyword 搜索的字段一一对应。 */
function mappingSearchKeyword(item: {
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
}): string | null {
  return item.platformSkuId ?? item.sellerSku ?? item.offerId;
}

/** 订单行按需补链接的响应（2026-10-20，C 主 B 兜底）。 */
interface EnsureVariantOutcome {
  resolved: boolean;
  listingId: string | null;
  variantId: string | null;
  source: 'LOCAL' | 'PLATFORM' | 'ORDER_FACTS' | null;
  reason: 'NOT_FOUND' | 'UNSUPPORTED' | 'MISSING_IDENTIFIERS' | 'REFRESH_FAILED' | null;
}

/**
 * 平台取不到变体时的兜底确认：用订单事实在本地补建链接。文案区分三种
 * 失败原因，运营明确知道这是一次本地补建（而非平台回读成功）。
 */
function confirmOrderFactsBackfill(reason: EnsureVariantOutcome['reason']): Promise<boolean> {
  const detail =
    reason === 'UNSUPPORTED'
      ? '当前平台不支持按标识定向读取商品。'
      : reason === 'REFRESH_FAILED'
        ? '读取平台商品信息失败。'
        : '平台上查不到该变体（可能已删除或标识已变更）。';
  return new Promise((resolve) => {
    Modal.confirm({
      title: '未能从平台取回该商品变体',
      content: `${detail}可以用订单里已有的平台标识在本地补建商品链接，随后继续映射；补建的数据会由下次商品同步按平台事实校正。`,
      okText: '用订单信息补建',
      cancelText: '取消',
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/**
 * Shipment-deadline tiering (Sprint 7 task §8, orders.md §16): overdue /
 * <24h urgent (red), <3 days approaching (orange), otherwise neutral.
 * Pure display of a platform FACT - never an ERP status.
 */
function deadlineBadge(deadline: string | null): {
  tone: 'danger' | 'warning' | 'neutral';
  label: string;
  exact: string;
} | null {
  if (deadline === null) {
    return null;
  }
  const remainingMs = new Date(deadline).getTime() - Date.now();
  const absMinutes = Math.round(Math.abs(remainingMs) / 60000);
  const days = Math.floor(absMinutes / 1440);
  const hours = Math.floor((absMinutes % 1440) / 60);
  const minutes = absMinutes % 60;
  const span =
    days > 0 ? `${days}天${hours}小时` : hours > 0 ? `${hours}小时${minutes}分` : `${minutes}分`;
  const exact = fmtDateTime(deadline);
  if (remainingMs < 0) {
    return { tone: 'danger', label: `已超时 ${span}`, exact };
  }
  if (remainingMs < 24 * 60 * 60 * 1000) {
    return { tone: 'danger', label: `剩 ${span}`, exact };
  }
  if (remainingMs < 3 * 24 * 60 * 60 * 1000) {
    return { tone: 'warning', label: `剩 ${span}`, exact };
  }
  return { tone: 'neutral', label: `剩 ${span}`, exact };
}

/**
 * 发货时限只在「还没发出去」的阶段倒计时（用户反馈 2026-10-09）：
 * 已发货订单仍显示红/橙倒计时会误导——SHIPPED 后改为中性「已发货」+
 * 原截止时间；CANCELLED 的时限无意义，不再显示。
 * 平台侧已事实发货（delivering / delivered 差异单，用户指示 2026-10-14
 * 扩展）：货物在平台侧已经发走，时限同样不再构成内部压力——与 ERP
 * SHIPPED 同样按中性「已发货」展示（已发货但映射异常的订单不属于发货
 * 超时，倒计时继续飘红会自相矛盾）。
 * 外部履约单（用户指示 2026-10-16）：FBO/FBP 等由平台仓库发货，ERP 不评估
 * 发货时限异常，也就不显示倒计时（返回 null → 列渲染「—」），避免"看着
 * 紧急实则无事可做"。
 */
function deadlineBadgeFor(
  deadline: string | null,
  erpStatus: string,
  platformStatus: string | null = null,
  fulfillmentMode: string | null = null,
): ReturnType<typeof deadlineBadge> {
  if (deadline === null || erpStatus === 'CANCELLED') {
    return null;
  }
  if (isExternalFulfillmentMode(fulfillmentMode)) {
    return null;
  }
  const badge = deadlineBadge(deadline);
  if (erpStatus === 'SHIPPED' || platformDivergent(platformStatus, erpStatus)) {
    return { tone: 'neutral', label: '已发货', exact: badge === null ? '' : badge.exact };
  }
  return badge;
}

/**
 * 展开行内容 —— 纵向明细（2026-10-17 用户拍板）。
 *
 * 改造前这里是一张 8 列的「第二张表」，与主表 9 列形成两套互不相干的列网格：
 * 主表要横滚时子表跟着滚、右端永远露半截；子表还出现过「唯一没声明 width 的列
 * 吞掉近一半宽度」。改成纵向明细后：每个 SKU 行一块、字段纵向排布，不吃表格
 * 宽度，任何视口下都不会被裁切。
 *
 * 数据仍复用 `['order-detail', orderId]` 缓存键（§68），展开不产生额外请求。
 */
function ExpandedOrderItems({
  order,
  fields,
  thumbnailSize,
  selectedItem,
  onItemRowClick,
}: {
  order: OrderListItem;
  /** 明细要显示的字段 key（已按视图设置的显隐 + 顺序过滤）。 */
  fields: string[];
  thumbnailSize: number;
  selectedItem: OrderItem | null;
  onItemRowClick: (item: OrderItem) => void;
}) {
  const detailQuery = useApiQuery<Envelope<OrderDetail> & { data: OrderDetail }>(
    '/api/v1/orders/{id}',
    {},
    ['order-detail', order.id],
    { id: order.id },
  );
  if (detailQuery.isLoading) {
    return <span style={{ fontSize: 12.5, color: colors.textTertiary }}>商品明细加载中…</span>;
  }
  const detail = detailQuery.data?.data;
  if (detail === undefined || detail.id !== order.id) {
    return <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无商品明细</span>;
  }
  const totalQuantity = detail.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  // 合计只在**每一行都有小计**时才给（2026-10-17）：任一行价格缺失就只报件数，
  // 否则会把缺价的行按 0 计入，显示一个看起来精确其实是错的金额。
  const totalAmount =
    detail.items.length > 0 && detail.items.every((item) => item.totalPrice !== null)
      ? detail.items.reduce((sum, item) => sum + Number(item.totalPrice), 0)
      : null;
  return (
    <Image.PreviewGroup>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {detail.items.map((item, index) => (
          <ExpandedItemBlock
            key={item.id}
            item={item}
            currency={detail.currency}
            fields={fields}
            thumbnailSize={thumbnailSize}
            selected={selectedItem?.id === item.id}
            first={index === 0}
            onActivate={() => onItemRowClick(item)}
          />
        ))}
        {detail.items.length > 1 && (
          <div
            style={{
              fontSize: 12,
              color: colors.textSecondary,
              textAlign: 'right',
              padding: '8px 6px 0',
              marginTop: 6,
              borderTop: `1px solid ${colors.borderSoft}`,
            }}
          >
            {detail.items.length} 个 SKU · 共 {totalQuantity} 件
            {totalAmount === null
              ? ''
              : ` · 合计 ${fmtMoney(String(totalAmount), detail.currency)}`}
          </div>
        )}
      </div>
    </Image.PreviewGroup>
  );
}

/** 元信息行的取值（块头三项之外的字段）。 */
function expandedFieldText(key: string, item: OrderItem, currency: string | null): ReactNode {
  switch (key) {
    case 'offerId':
      return item.offerId ?? '—';
    case 'quantity':
      return `${Number(item.quantity)} 件`;
    case 'unitPrice':
      return fmtMoney(item.unitPrice, currency);
    case 'totalPrice':
      return fmtMoney(item.totalPrice, currency);
    case 'latestPurchasePrice':
      return item.latestPurchasePrice === null ? '—' : fmtMoney(item.latestPurchasePrice, currency);
    default:
      return '—';
  }
}

/** 单个 SKU 行：块头（图 + 编码 + 名称 + 履约状态）+ 元信息行。 */
function ExpandedItemBlock({
  item,
  currency,
  fields,
  thumbnailSize,
  selected,
  first,
  onActivate,
}: {
  item: OrderItem;
  currency: string | null;
  fields: string[];
  thumbnailSize: number;
  selected: boolean;
  first: boolean;
  onActivate: () => void;
}) {
  const visible = new Set(fields);
  // 主图 / SKU / 履约状态 固定在块头，其余字段按视图设置的顺序排在元信息行。
  const metaFields = fields.filter(
    (key) => key !== 'image' && key !== 'sku' && key !== 'fulfillmentStatus',
  );
  /**
   * 采购进度（2026-10-17 用户定稿）：只标「已采购 / 已到货」。
   * 「待采购」与「缺货」几乎总是同时出现，再挂一个红徽标只是噪音；
   * 需要时看履约状态就知道还没采购。
   */
  // 采购状态只在**仍缺货**（未分配库存）时有意义（用户指示 2026-10-19）：
  // 已占用/已拣/已出库/外部履约/已释放 → 不显示（派生值仍保留，行回到缺货会再现）。
  const unallocated =
    item.fulfillmentStatus === 'BACKORDERED' || item.fulfillmentStatus === 'PENDING';
  const procurement =
    unallocated && (item.procurementState === 'ORDERED' || item.procurementState === 'ARRIVED')
      ? (PROCUREMENT_META[item.procurementState] ?? null)
      : null;
  // 键盘可达（2026-10-17 体检 P2-9）：Enter / 空格 = 点击。
  const interaction = rowInteractionProps({
    selected,
    onActivate,
    label: `商品行 ${item.skuCode ?? item.offerId ?? `第 ${item.lineNo} 行`}`,
  });
  return (
    <div
      onClick={onActivate}
      {...interaction}
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        // 上下内边距 10 → 4（2026-10-17 用户要求压缩内容上下的区间）：块高从 93 降到 81。
        padding: '4px 6px',
        borderTop: first ? undefined : `1px solid ${colors.borderSoft}`,
        background: selected ? colors.primarySoft : undefined,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      {visible.has('image') && (
        // 缩略图正方形，边长由「视图设置 → 展开行主图尺寸」控制（2026-10-17）。
        // 默认 72 与右侧三行信息（实测 73px）基本等高，视觉上是对齐的。
        // 注：不要改成 height:'100%' + alignSelf:stretch —— 行高由最高子元素决定，
        // 图片用百分比高度会先按自然比例撑高，反而把整块拉到 102px。
        <div style={{ flex: '0 0 auto' }}>
          {item.imageUrl === null ? (
            <div
              style={{
                width: thumbnailSize,
                height: thumbnailSize,
                borderRadius: 6,
                background: colors.neutralBg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: colors.textTertiary,
                fontSize: 11,
              }}
            >
              无图
            </div>
          ) : (
            <Image
              src={item.imageUrl}
              width={thumbnailSize}
              height={thumbnailSize}
              style={{ objectFit: 'contain', borderRadius: 6, background: colors.neutralBg }}
            />
          )}
        </div>
      )}

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {visible.has('sku') &&
            (item.skuId === null ? (
              <StatusBadge
                tone="purple"
                label="无法映射"
                hint="缺少 SKU 映射，去 SKU 映射补齐后重试"
                showDot={false}
              />
            ) : (
              <>
                <span style={{ fontWeight: 550 }}>{item.skuCode}</span>
                <span
                  title={item.skuName ?? undefined}
                  style={{
                    fontSize: 12.5,
                    color: colors.textSecondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 420,
                  }}
                >
                  {item.skuName}
                </span>
                <CopyTextButton value={item.skuName} title="SKU 名称" />
              </>
            ))}
          {/* 右侧状态（2026-10-17 用户定稿）：采购进度 + 履约状态同一行右对齐。
              主行不再重复这些信息，所以这里每行都显示（哪怕整单状态一致）。 */}
          <span
            style={{
              marginLeft: 'auto',
              flex: '0 0 auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {procurement !== null && (
              <StatusBadge
                tone={procurement.tone}
                label={procurement.label}
                hint={
                  item.procurementState === 'ARRIVED'
                    ? '该行采购已到货，可在「商品」列点「重新分配」'
                    : '该行已登记采购，采购未到货'
                }
                showDot={false}
              />
            )}
            {visible.has('fulfillmentStatus') && (
              <StatusBadge
                tone={FULFILLMENT_STATUS_META[item.fulfillmentStatus]?.tone ?? 'neutral'}
                label={
                  FULFILLMENT_STATUS_META[item.fulfillmentStatus]?.label ?? item.fulfillmentStatus
                }
                showDot={false}
              />
            )}
          </span>
        </div>

        {metaFields.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 20px',
              marginTop: 6,
              fontSize: 12.5,
              color: colors.textPrimary,
            }}
          >
            {metaFields.map((key) => (
              <span
                key={key}
                style={key === 'offerId' ? { flexBasis: '100%', minWidth: 0 } : undefined}
              >
                <span style={{ color: colors.textTertiary }}>
                  {EXPANDED_COLUMN_LABELS[key] ?? key}
                </span>
                <span style={{ marginLeft: 6 }}>{expandedFieldText(key, item, currency)}</span>
                {key === 'offerId' && <CopyTextButton value={item.offerId} title="Offer ID" />}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 右栏「最近状态」（用户指示 2026-10-13）：最新状态在上，默认只显示最近
 * 两条；超过两条时在分区标题右侧给一个符号化展开按钮（↑/↓）控制全量显示。
 * 以订单 id 作 key 挂载，切换订单自动回到收起态。
 */
function RailRecentStatus({ history }: { history: OrderDetail['history'] }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () => [...history].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [history],
  );
  const visible = expanded ? sorted : sorted.slice(0, 2);
  return (
    <ContextSection
      title="最近状态"
      extra={
        sorted.length > 2 ? (
          <Button
            type="text"
            size="small"
            aria-label={expanded ? '收起状态历史' : '展开全部状态历史'}
            aria-expanded={expanded}
            icon={expanded ? <UpOutlined /> : <DownOutlined />}
            onClick={() => setExpanded((value) => !value)}
            style={{ padding: '0 4px', color: colors.textTertiary }}
          />
        ) : undefined
      }
    >
      <Timeline
        items={visible.map((entry) => ({
          content: (
            <div>
              <div style={{ fontSize: 13, color: colors.textPrimary }}>
                {ERP_STATUS_META[entry.toStatus]?.label ?? entry.toStatus}
              </div>
              <div style={{ fontSize: 12, color: colors.textTertiary }}>
                {fmtDateTime(entry.createdAt)}
              </div>
            </div>
          ),
        }))}
      />
    </ContextSection>
  );
}

export function OrdersPage() {
  const { message, modal, notification } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  // 搜索防抖（2026-10-17 体检 P0-3）：输入态即时回显，查询态防抖 300ms。
  // 改造前 keyword 直连查询参数，每敲一个字符就打一次 /api/v1/orders。
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);
  // 关键词（防抖后）变化时回到第 1 页：否则停在第 3 页搜索会看到「第 3 页的空结果」。
  // 代价：停在首页输入时只发 1 次请求；若当前页 > 1，会先后发「同页 + 新词」和
  // 「第 1 页 + 新词」两次（前者结果被丢弃），仍远好于改造前每敲一个字符都发一次。
  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);
  // Dual-axis default view: 待处理 (§2.1) - backordered orders are the norm,
  // not an edge case, so they open front and center.
  const [activeTab, setActiveTab] = useState('pending');
  const [goodsState, setGoodsState] = useState<string | undefined>();
  const [storeId, setStoreId] = useState<string | undefined>();
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  const [registerItem, setRegisterItem] = useState<OrderItem | null>(null);
  const [registerForm] = Form.useForm<{
    sourceNote?: string;
    quantity: number;
    unitCost?: number;
  }>();
  // Sprint 9 T6: the order being marked as externally fulfilled.
  const [externalTarget, setExternalTarget] = useState<OrderListItem | null>(null);
  const [externalForm] = Form.useForm<{ reason: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  /** 展开区被点中的订单行（侧边栏切换到 SKU 信息视图，用户指示 2026-09-17）。 */
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [arrivedRetryId, setArrivedRetryId] = useState<string | null>(null);
  const arrivedRetryLock = useRef(false);
  const [fulfillmentModeFilter, setFulfillmentModeFilter] = useState<string | undefined>();
  // 视图设置（用户指示 2026-09-17）：localStorage 持久化。
  const [viewSettings, setViewSettings] = useState<OrdersViewSettings>(loadViewSettings);
  const [viewOpen, setViewOpen] = useState(false);
  const updateViewSettings = useCallback((patch: Partial<OrdersViewSettings>) => {
    setViewSettings((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable (private mode etc.): session-only settings.
      }
      return next;
    });
  }, []);
  const reorderColumns = useCallback(
    (listKey: 'mainColumns' | 'expandedColumns') => (from: number, to: number) => {
      setViewSettings((current) => {
        const list = [...current[listKey]];
        const moved = list[from];
        if (moved === undefined) {
          return current;
        }
        list.splice(from, 1);
        list.splice(to, 0, moved);
        const next = { ...current, [listKey]: list };
        try {
          localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );
  const toggleColumnVisible = useCallback(
    (listKey: 'mainColumns' | 'expandedColumns') => (key: string) => {
      setViewSettings((current) => {
        const list = current[listKey].map((column) =>
          column.key === key ? { ...column, visible: !column.visible } : column,
        );
        const next = { ...current, [listKey]: list };
        try {
          localStorage.setItem(VIEW_SETTINGS_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  // Deep link from the global palette / exception center: focus=<orderId>
  // selects the row and opens its detail drawer (Phase 2 task §33).
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (focus !== null) {
      setSelectedId(focus);
      setDetailId(focus);
    }
  }, [searchParams]);

  const stageOfActiveTab = STAGE_TABS.find((tab) => tab.key === activeTab)?.stage;
  // 排序按钮的会话态（2026-10-14 用户指示）：初始取视图设置的默认排序；
  // 按钮切换只改会话态，「默认排序」按钮回到视图设置的默认。
  const [sessionSort, setSessionSort] = useState<{
    sortBy: OrdersViewSettings['defaultSortBy'];
    sortOrder: OrdersViewSettings['defaultSortOrder'];
  }>(() => ({ sortBy: viewSettings.defaultSortBy, sortOrder: viewSettings.defaultSortOrder }));
  const isDefaultSort =
    sessionSort.sortBy === viewSettings.defaultSortBy &&
    sessionSort.sortOrder === viewSettings.defaultSortOrder;
  const query = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    {
      page,
      pageSize: viewSettings.pageSize,
      ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
      // 平台筛选是真实 API 过滤（用户反馈 2026-09-28：此前只过滤店铺下拉，
      // 列表纹丝不动，出现“选着 YANDEX 却显示 OZON 订单”）。
      ...(platformFilter ? { platform: platformFilter } : {}),
      ...(stageOfActiveTab ? { stage: stageOfActiveTab } : {}),
      ...(goodsState ? { goodsState } : {}),
      ...(storeId ? { storeId } : {}),
      ...(fulfillmentModeFilter ? { fulfillmentMode: fulfillmentModeFilter } : {}),
      // 列表排序（2026-10-14）：按钮会话态；默认值也显式传，保证查询键稳定。
      sortBy: sessionSort.sortBy,
      sortOrder: sessionSort.sortOrder,
    },
    [
      'orders',
      page,
      // pageSize 必须在查询键里：useApiQuery 只用调用方给的 key 做缓存键，
      // params 不参与。此前漏了它，「每页行数」写回设置后键不变 → 不重新
      // 拉取，列表仍按旧条数渲染（2026-10-16 端到端验收发现）。
      viewSettings.pageSize,
      debouncedKeyword,
      platformFilter,
      stageOfActiveTab,
      goodsState,
      storeId,
      fulfillmentModeFilter,
      sessionSort.sortBy,
      sessionSort.sortOrder,
    ],
  );

  // Tab counts: light meta.total queries, one per stage tab, ALL carrying the
  // current store/keyword filters so the counts and the list never disagree
  // (acceptance §2; the old counters ignored every filter).
  const countFilters = {
    page: 1,
    pageSize: 1,
    ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
    ...(platformFilter ? { platform: platformFilter } : {}),
    ...(storeId ? { storeId } : {}),
  } as Record<string, unknown>;
  const allCount = useApiQuery<Envelope<OrderListItem[]>>('/api/v1/orders', countFilters, [
    'orders-count',
    'ALL',
    debouncedKeyword,
    platformFilter,
    storeId,
  ]);
  const pendingCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'PENDING' },
    ['orders-count', 'PENDING', debouncedKeyword, platformFilter, storeId],
  );
  const externalCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'EXTERNAL' },
    ['orders-count', 'EXTERNAL', debouncedKeyword, platformFilter, storeId],
  );
  const inTransitCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'IN_TRANSIT' },
    ['orders-count', 'IN_TRANSIT', debouncedKeyword, platformFilter, storeId],
  );
  const completedCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'COMPLETED' },
    ['orders-count', 'COMPLETED', debouncedKeyword, platformFilter, storeId],
  );
  const cancelledCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'CANCELLED' },
    ['orders-count', 'CANCELLED', debouncedKeyword, platformFilter, storeId],
  );

  const storesQuery = useApiQuery<
    Envelope<Array<{ id: string; name: string; storeCode: string; platformCode: string }>>
  >('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-for-orders']);

  // One cached detail query shared by the rail preview and the drawer (§68).
  const railDetailId = selectedId ?? detailId;
  const detailQuery = useApiQuery<Envelope<OrderDetail> & { data: OrderDetail }>(
    '/api/v1/orders/{id}',
    {},
    ['order-detail', railDetailId],
    railDetailId === null ? undefined : { id: railDetailId },
    railDetailId !== null,
  );

  // 平台面单列表（纯本地读，不触发平台调用）：有存档就让操作区直接给出打开入口。
  const labelsQuery = useApiQuery<{ data: ShippingLabelItem[] }>(
    '/api/v1/orders/{id}/shipping-labels',
    {},
    ['order-shipping-labels', railDetailId],
    railDetailId === null ? undefined : { id: railDetailId },
    railDetailId !== null,
  );
  const orderLabels = labelsQuery.data?.data ?? [];

  // ---- 加急标记（用户指示 2026-10-16）：行内旗标点击即切换 ----
  // 加急 = 列表恒定置顶 + 缺货到货后优先参与分配（ADR 0022）；非 ERP 状态。
  // 轻量、可逆、无平台副作用 → 不二次确认；终态订单按钮不渲染（后端亦拒绝）。
  const [urgentPendingId, setUrgentPendingId] = useState<string | null>(null);
  const toggleUrgentMutation = useMutation({
    mutationFn: ({ id, urgent }: { id: string; urgent: boolean }) =>
      apiPost<{ orderId: string; orderNo: string; isUrgent: boolean }>(
        '/api/v1/orders/{id}/urgent',
        { urgent },
        { id },
      ),
    onMutate: ({ id }) => {
      setUrgentPendingId(id);
    },
    onSuccess: (result) => {
      message.success(result.isUrgent ? '已标记加急（置顶优先）' : '已取消加急');
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`加急操作失败：${error.message}`),
    onSettled: () => setUrgentPendingId(null),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ releasedItems: number; interceptions: number }>(
        '/api/v1/orders/{id}/cancel',
        {},
        { id },
      ),
    onSuccess: (result: { releasedItems: number; interceptions: number }) => {
      message.success(
        `订单已取消（释放 ${result.releasedItems} 行${
          result.interceptions > 0 ? `，创建拦截任务 ${result.interceptions} 条` : ''
        }）`,
      );
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`取消失败：${error.message}`),
  });

  // Sprint 9 T6: close out an order fulfilled outside WCIES (no stock moves).
  const markExternalMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost<{ releasedItems: number }>(
        '/api/v1/orders/{id}/mark-external-fulfillment',
        {
          reason,
        },
        { id },
      ),
    onSuccess: (result: { releasedItems: number }) => {
      message.success(`已标记外部履约（关账 ${result.releasedItems} 行），订单转入已发货`);
      setExternalTarget(null);
      externalForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`标记失败：${error.message}`),
  });

  const retryMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiPost<{ reserved: boolean; fulfillmentStatus: string; mappingRepaired: boolean }>(
        '/api/v1/orders/items/{itemId}/retry-allocation',
        {},
        { itemId },
      ),
    onSuccess: (result: {
      reserved: boolean;
      fulfillmentStatus: string;
      mappingRepaired: boolean;
    }) => {
      // 映射修复先于分配（2026-10-14）：行当前状态不该占用内部库存时（如已释放
      // 的 RELEASED 行），后端只修映射、不占库存，此时报「已修复」而不是
      // 让运营以为库存问题没解决。
      if (result.reserved) {
        message.success('重新分配成功，订单行已占用');
      } else if (result.fulfillmentStatus === 'BACKORDERED') {
        message.warning('映射已修复，但库存不足，订单行保持缺货');
      } else if (result.mappingRepaired) {
        message.success(
          `映射已修复，映射异常已关闭（该行当前状态 ${result.fulfillmentStatus}，无需占用内部库存）`,
        );
      } else {
        message.warning('库存仍然不足，订单行保持缺货');
      }
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`重试失败：${error.message}`),
  });

  // ------------------------------------------------------------------
  // 发货流程（用户真实作业顺序：获取运单号 → 拣货 → 打单 → 发货）
  // ------------------------------------------------------------------

  /**
   * 获取运单号 = 平台组包（OZON awaiting_packaging → awaiting_deliver）。
   * 真实平台写操作，只有用户显式点击才会发生（AGENTS.md §92）；接口本身
   * 幂等，已组包时不会重复写平台。
   */
  const prepareShipmentMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<{
        trackingNumber: string | null;
        platformStatus: string | null;
        alreadyPrepared: boolean;
        assemblyPending: boolean;
      }>('/api/v1/orders/{id}/prepare-shipment', {}, { id }),
    onSuccess: (result: {
      trackingNumber: string | null;
      platformStatus: string | null;
      alreadyPrepared: boolean;
      assemblyPending: boolean;
    }) => {
      // 组包是异步的：平台受理后要过一会儿才转 awaiting_deliver 并分配
      // 运单号，受理中是正常结果，提示稍后再点一次即可收敛。
      const waybill =
        result.trackingNumber === null ? '平台暂未返回运单号' : `运单号 ${result.trackingNumber}`;
      message.success(
        result.alreadyPrepared
          ? `平台此前已组包（${waybill}）`
          : result.assemblyPending
            ? '组包已提交，平台处理中；运单号稍后可取，可再次点击「获取运单号」刷新'
            : `已完成平台组包（${waybill}）`,
      );
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`获取运单号失败：${error.message}`),
  });

  /** 打单：取平台面单 PDF（已存档则复用），新开标签页供浏览器打印。 */
  // ---- 面单已打印确认（用户指示 2026-10-19）----
  // 浏览器无法感知打印结果：打开面单后，等用户回到系统（window focus）再弹窗
  // 确认；确认后把该笔/整批标记为已打印（后端幂等）。
  const pendingPrintConfirmIds = useRef<string[] | null>(null);
  const labelPrintedMutation = useMutation({
    mutationFn: (orderIds: string[]) =>
      apiPost<{ total: number; updated: number; orderIds: string[] }>(
        '/api/v1/orders/batch-mark-label-printed',
        { orderIds },
      ),
    onSuccess: (result) => {
      void message.success(
        result.updated > 0
          ? `已标记面单已打印（${result.updated} 单）`
          : '这些订单此前已标记为已打印',
      );
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`标记已打印失败：${error.message}`),
  });
  const askPrintConfirmation = useCallback((orderIds: string[]) => {
    pendingPrintConfirmIds.current = orderIds;
  }, []);
  useEffect(() => {
    const onFocus = () => {
      const ids = pendingPrintConfirmIds.current;
      if (ids === null) {
        return;
      }
      // 一次性消费：避免每次窗口获得焦点都弹。
      pendingPrintConfirmIds.current = null;
      modal.confirm({
        title: '面单是否已打印？',
        content: `确认后把这 ${ids.length} 笔订单标记为「已打印」，用于「已打单」筛选。`,
        okText: '已打印',
        cancelText: '未打印',
        onOk: () => {
          labelPrintedMutation.mutate(ids);
        },
      });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [modal, labelPrintedMutation]);

  const shippingLabelMutation = useMutation({
    mutationFn: ({ id, refresh }: { id: string; refresh: boolean }) =>
      apiPost<{ id: string; fileName: string; signedUrl: string }>(
        '/api/v1/orders/{id}/shipping-label',
        {},
        { id },
        refresh ? { refresh: 'true' } : undefined,
      ),
    onSuccess: (
      label: { fileName: string; signedUrl: string },
      variables: { id: string; refresh: boolean },
    ) => {
      message.success(`面单已就绪（${label.fileName}），已在新标签页打开，可直接打印`);
      window.open(label.signedUrl, '_blank', 'noopener');
      askPrintConfirmation([variables.id]);
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`打单失败：${error.message}`),
  });

  /** 一键发货：自动建发货单+包裹装箱封箱 → 正式出库扣库存 → 订单 SHIPPED。 */
  const quickShipMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ orderErpStatus: string; shipments: Array<{ alreadyShipped: boolean }> }>(
        '/api/v1/orders/{id}/ship',
        {},
        { id },
      ),
    onSuccess: (result: {
      orderErpStatus: string;
      shipments: Array<{ alreadyShipped: boolean }>;
    }) => {
      const replayed = result.shipments.filter((shipment) => shipment.alreadyShipped).length;
      message.success(
        `发货完成（${result.shipments.length} 张发货单${
          replayed > 0 ? `，其中 ${replayed} 张此前已出库` : ''
        }），订单状态 ${result.orderErpStatus}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`发货失败：${error.message}`),
  });

  // Reuse the existing detail query and its exact key; never retry from list counts.
  const retryArrivedItems = async (orderId: string) => {
    try {
      const queryKey = ['order-detail', orderId];
      await queryClient.refetchQueries({ queryKey, exact: true }, { throwOnError: true });
      const current = queryClient.getQueryData<Envelope<OrderDetail>>(queryKey)?.data;
      if (current === undefined || current.id !== orderId) {
        message.error('订单明细不可用，请重新展开订单后重试');
        return;
      }
      const items = current.items.filter(
        (item) => item.fulfillmentStatus === 'BACKORDERED' && item.procurementState === 'ARRIVED',
      );
      let succeeded = 0;
      let backordered = 0;
      const failures: Array<{ id: string; label: string; message: string }> = [];
      for (const item of items) {
        try {
          const result = await apiPost<{ reserved: boolean; fulfillmentStatus: string }>(
            '/api/v1/orders/items/{itemId}/retry-allocation',
            {},
            { itemId: item.id },
          );
          if (result.reserved) {
            succeeded += 1;
          } else if (result.fulfillmentStatus === 'BACKORDERED') {
            backordered += 1;
          } else {
            failures.push({
              id: item.id,
              label: `第 ${item.lineNo} 行`,
              message: '未完成分配，请刷新明细核实当前状态',
            });
          }
        } catch (error: unknown) {
          failures.push({
            id: item.id,
            label: `第 ${item.lineNo} 行（${item.skuCode || item.offerId || item.id}）`,
            message: error instanceof Error ? error.message : '请求失败，请稍后重试',
          });
        }
      }
      notification.open({
        type: failures.length > 0 ? 'error' : backordered > 0 ? 'warning' : 'success',
        title: `成功 ${succeeded} / 仍缺货 ${backordered} / 失败 ${failures.length}`,
        description: (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <div>
              订单 {current.platformOrderId}
              {items.length === 0 ? '：当前没有已到货的缺货行，无需重试' : ''}
            </div>
            {failures.map((failure) => (
              <div key={failure.id}>
                {failure.label}：{failure.message}
              </div>
            ))}
          </div>
        ),
        duration: failures.length > 0 ? 0 : 6,
      });
    } catch (error: unknown) {
      message.error(`加载订单明细失败：${error instanceof Error ? error.message : '请稍后重试'}`);
    } finally {
      await Promise.all(
        ['orders', 'orders-count', 'order-detail', 'exceptions'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    }
  };

  const confirmArrivedRetry = (row: OrderListItem) => {
    if (arrivedRetryLock.current || retryMutation.isPending) {
      return;
    }
    arrivedRetryLock.current = true;
    setArrivedRetryId(row.id);
    const dialog = modal.confirm({
      title: '重新尝试分配',
      content: `该订单有 ${row.backorderedArrivedCount} 行货已到货，对其缺货行重新尝试分配？`,
      okText: '重新分配',
      cancelText: '取消',
      maskClosable: false,
      keyboard: false,
      onOk: async () => {
        dialog.update({ cancelButtonProps: { disabled: true }, closable: false });
        await retryArrivedItems(row.id);
      },
      afterClose: () => {
        arrivedRetryLock.current = false;
        setArrivedRetryId(null);
      },
    });
  };

  // ---- 快速建档（就地复用 SKU映射 的建档弹窗，不再跳转工作台） ----
  // 订单行只有平台标识：先在当前店铺反查所在商品链接（kw 命中变体级标识），
  // 再让共享弹窗按标识预选变体。orderItemId 供建档成功后自动重试映射。
  const [quickOnboard, setQuickOnboard] = useState<{
    listingId: string;
    match: OnboardMatchIdentifiers;
    /** 触发建档的订单行：建档完成后对其自动重试映射（用户需求 2026-10-09）。 */
    orderItemId: string | null;
  } | null>(null);
  const [onboardLookupPending, setOnboardLookupPending] = useState(false);
  // 打开商品链接（ERP 建议#3）按钮的反查 pending。
  const [platformLinkPending, setPlatformLinkPending] = useState(false);

  // ---- 多选批量（用户指示 2026-10-13）：跨分页保留勾选 ----
  // antd 的 preserveSelectedRowKeys 让翻页不清空 keys；这里另存一份行快照，
  // 让批量结果提示能标注不在当前页的订单（平台单号 > 内部单号 > id）。
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [selectedOrdersById, setSelectedOrdersById] = useState<Map<string, OrderListItem>>(
    () => new Map(),
  );
  const handleOrderSelectionChange = useCallback((keys: Key[], rows: OrderListItem[]) => {
    const ids = keys.map(String);
    setSelectedOrderIds(ids);
    setSelectedOrdersById((current) => {
      const next = new Map<string, OrderListItem>();
      for (const id of ids) {
        const kept = current.get(id);
        if (kept !== undefined) {
          next.set(id, kept);
        }
      }
      for (const row of rows) {
        next.set(row.id, row);
      }
      return next;
    });
  }, []);
  const labelOfSelectedOrder = useCallback(
    (orderId: string): string =>
      selectedOrdersById.get(orderId)?.platformOrderId ??
      selectedOrdersById.get(orderId)?.orderNo ??
      orderId,
    [selectedOrdersById],
  );
  const clearOrderSelection = useCallback(() => {
    setSelectedOrderIds([]);
    setSelectedOrdersById(new Map());
  }, []);

  const createPickingMutation = useMutation({
    mutationFn: (orderId: string) =>
      apiPost<{ tasks: Array<{ pickingNo: string }> }>('/api/v1/picking-tasks', { orderId }),
    onSuccess: (result) => {
      message.success(`已创建拣货任务：${result.tasks.map((task) => task.pickingNo).join('、')}`);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
  });

  // 自动创建拣货任务已于 2026-10-13 改造为「勾选订单 → 批量生成拣货单」：
  // 按钮从右栏迁到主页面批量条（用户指示），不再按店铺全量扫单。

  // ---- 多选批量操作（用户指示 2026-10-13）：页面底部浮岛（ActionIsland）驱动 ----
  // 三类动作都逐单在后端执行（单笔失败不拖垮整批），这里只聚合展示结果。

  const batchPickingMutation = useMutation({
    mutationFn: (orderIds: string[]) =>
      apiPost<{
        candidates: number;
        created: number;
        createdOrders: number;
        itemsTotal: number;
        skipped: number;
        failed: number;
        createdTaskNos: string[];
        failures: Array<{ orderNo: string; code: string; message: string }>;
      }>('/api/v1/picking-tasks/auto-create', { orderIds }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title:
          `批量生成拣货单：新建 ${result.created} 个任务（${result.createdOrders} 单 / ` +
          `${result.itemsTotal} 行，按仓合并），跳过 ${result.skipped}，失败 ${result.failed}`,
        description: (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.createdTaskNos.length > 0 && (
              <div>拣货单号：{result.createdTaskNos.join('、')}</div>
            )}
            {result.failures.map((failure) => (
              <div key={failure.orderNo}>
                {failure.orderNo}：{failure.message}
              </div>
            ))}
          </div>
        ),
        duration: result.failed > 0 ? 0 : 6,
      });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`批量生成拣货单失败：${error.message}`),
  });

  const batchPrepareMutation = useMutation({
    mutationFn: (orderIds: string[]) =>
      apiPost<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
          orderId: string;
          orderNo: string | null;
          ok: boolean;
          code?: string | null;
          message?: string | null;
          trackingNumber: string | null;
          platformStatus: string | null;
          alreadyPrepared: boolean;
          assemblyPending: boolean;
        }>;
      }>('/api/v1/orders/batch-prepare-shipment', { orderIds }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量获取运单号：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description: (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.results.map((item) => (
              <div key={item.orderId}>
                {labelOfSelectedOrder(item.orderId)}：
                {item.ok
                  ? item.assemblyPending
                    ? '组包已提交，平台处理中，运单号稍后可取'
                    : item.alreadyPrepared
                      ? `平台此前已组包${item.trackingNumber === null ? '' : `（${item.trackingNumber}）`}`
                      : `已组包${
                          item.trackingNumber === null ? '' : `（运单号 ${item.trackingNumber}）`
                        }`
                  : `失败（${item.message ?? item.code ?? '未知错误'}）`}
              </div>
            ))}
          </div>
        ),
        duration: result.failed > 0 ? 0 : 8,
      });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`批量获取运单号失败：${error.message}`),
  });

  const batchShipMutation = useMutation({
    mutationFn: (orderIds: string[]) =>
      apiPost<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
          orderId: string;
          orderNo: string | null;
          ok: boolean;
          code?: string | null;
          message?: string | null;
          orderErpStatus: string | null;
          shipments: Array<{ alreadyShipped: boolean }>;
        }>;
      }>('/api/v1/orders/batch-ship', { orderIds }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量发货：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description: (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.results.map((item) => (
              <div key={item.orderId}>
                {labelOfSelectedOrder(item.orderId)}：
                {item.ok
                  ? `已发货（订单状态 ${ERP_STATUS_META[item.orderErpStatus ?? '']?.label ?? item.orderErpStatus}）`
                  : `失败（${item.message ?? item.code ?? '未知错误'}）`}
              </div>
            ))}
          </div>
        ),
        duration: result.failed > 0 ? 0 : 8,
      });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`批量发货失败：${error.message}`),
  });

  const confirmBatchPicking = () => {
    if (selectedOrderIds.length === 0) {
      return;
    }
    modal.confirm({
      title: `为勾选的 ${selectedOrderIds.length} 个订单生成拣货单？`,
      content:
        '勾选订单的已占用（RESERVED）行按仓库合并生成拣货任务——同一仓库合并为一个任务' +
        '（合并拣货，一次巡回取齐多单）；已有进行中拣货任务的订单自动跳过。',
      okText: '生成拣货单',
      cancelText: '返回',
      onOk: () => {
        batchPickingMutation.mutate(selectedOrderIds);
      },
    });
  };

  const confirmBatchPrepare = () => {
    if (selectedOrderIds.length === 0) {
      return;
    }
    modal.confirm({
      title: `为勾选的 ${selectedOrderIds.length} 个订单获取运单号？`,
      content:
        '将逐单调用平台「组包」接口推进订单（OZON awaiting_deliver）并让平台分配运单号——' +
        '这是真实平台操作，会改变平台上的订单状态。已组包的订单不会重复提交；' +
        '单笔失败不影响其余订单。',
      okText: '批量获取运单号',
      cancelText: '返回',
      onOk: () => {
        batchPrepareMutation.mutate(selectedOrderIds);
      },
    });
  };

  const confirmBatchShip = () => {
    if (selectedOrderIds.length === 0) {
      return;
    }
    modal.confirm({
      title: `发货：勾选的 ${selectedOrderIds.length} 个订单？`,
      content:
        '逐单自动创建发货单与单包裹并封箱，然后正式出库：会扣减已拣货库存，' +
        '全部行出库后订单变为已发货。已出库的发货单不会重复扣减库存；单笔失败不影响其余订单。',
      okText: '确认批量发货',
      okButtonProps: { danger: true },
      cancelText: '返回',
      onOk: () => {
        batchShipMutation.mutate(selectedOrderIds);
      },
    });
  };

  // ---- 批量打印面单（用户指示 2026-10-17）----
  // 逐单取平台面单（后端串行、默认复用已存档），把所有成功的 PDF 放进**同一个**
  // 打印窗口一次打印——逐张 window.open 会被浏览器弹窗拦截。
  // 打印窗口必须在点击的同步栈里先打开（onClick 里调），拿到数据后再写入。
  const batchLabelMutation = useMutation({
    mutationFn: ({ orderIds }: { orderIds: string[]; printWindow: Window }) =>
      apiPost<{
        total: number;
        succeeded: number;
        failed: number;
        /** 终态（完成/取消）被拒绝的单数（2026-10-21）。 */
        notPrintable: number;
        mergedPdfBase64: string | null;
        mergedPageCount: number;
        results: Array<{
          orderId: string;
          orderNo: string | null;
          ok: boolean;
          code: string | null;
          message: string | null;
          signedUrl: string | null;
          fileName: string | null;
          /** true = 本次直接用本地存档，没有访问平台。 */
          fromArchive: boolean;
        }>;
      }>('/api/v1/orders/batch-shipping-label', {
        orderIds,
        // 面单装订顺序必须与列表一致（用户指示 2026-10-19）。
        sortBy: sessionSort.sortBy,
        sortOrder: sessionSort.sortOrder,
      }),
    onSuccess: (result, vars) => {
      const printable = result.results.filter(
        (item): item is typeof item & { signedUrl: string } => item.ok && item.signedUrl !== null,
      );
      if (printable.length === 0 || result.mergedPdfBase64 === null) {
        vars.printWindow.close();
        notification.warning({
          type: 'warning',
          title:
            printable.length === 0
              ? result.notPrintable > 0 && result.notPrintable === result.total
                ? '所选订单均已完成或已取消，不再支持打印面单'
                : '没有可打印的面单'
              : '面单合并失败，请逐张打印',
          description: (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {result.results.map((item) => (
                <div key={item.orderId}>
                  {item.orderNo ?? selectedOrdersById.get(item.orderId)?.orderNo ?? item.orderId}：
                  {item.ok
                    ? '面单已取到，可在右栏单张打印'
                    : (item.message ?? item.code ?? '未知错误')}
                </div>
              ))}
            </div>
          ),
          duration: 0,
        });
        return;
      }
      // 合并后的 PDF 交给浏览器原生查看器：保持平台面单原纸张尺寸（57.9×40mm）。
      showMergedPdfInWindow(vars.printWindow, result.mergedPdfBase64);
      // 整批确认（用户指示 2026-10-19）：回到系统后一次确认，标记本批全部。
      askPrintConfirmation(printable.map((item) => item.orderId));
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量打印面单：已合并 ${result.mergedPageCount} 页（成功 ${result.succeeded} / 共 ${result.total} 单）${
          result.notPrintable > 0 ? `，跳过 ${result.notPrintable} 单（完成/取消）` : ''
        }`,
        description:
          result.failed === 0 ? undefined : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {result.results
                .filter((item) => !item.ok)
                .map((item) => (
                  <div key={item.orderId}>
                    {item.orderNo ?? selectedOrdersById.get(item.orderId)?.orderNo ?? item.orderId}
                    ：{item.message ?? item.code ?? '未知错误'}
                  </div>
                ))}
            </div>
          ),
        duration: result.failed > 0 ? 0 : 6,
      });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error, vars) => {
      // 失败时关掉此前打开的空白打印窗口，别留下一个"正在准备面单…"的标签页。
      vars.printWindow.close();
      message.error(`批量打印面单失败：${error.message}`);
    },
  });

  /**
   * 批量打印前的准入过滤（用户指示 2026-10-21）：终态订单（完成/取消）不再
   * 支持打印面单。跨页选中的行可能不在本地缓存里，这类 id 交给后端用同一份
   * 口径判定（后端逐单返回 ORDER_LABEL_NOT_PRINTABLE）。
   */
  const labelEligibleOrderIds = useMemo(
    () =>
      selectedOrderIds.filter((id) => {
        const row = selectedOrdersById.get(id);
        return row === undefined || !isLabelPrintBlocked(row);
      }),
    [selectedOrderIds, selectedOrdersById],
  );
  const labelSkippedCount = selectedOrderIds.length - labelEligibleOrderIds.length;

  const confirmBatchPrintLabels = () => {
    if (selectedOrderIds.length === 0) {
      return;
    }
    if (labelEligibleOrderIds.length === 0) {
      void message.warning('所选订单均已完成或已取消，不再支持打印面单');
      return;
    }
    // 打印窗口必须在点击的同步栈里打开（否则被浏览器拦截）。因此先开窗，
    // 需要用户确认时取消则关掉它。
    const printWindow = openShippingLabelPrintWindow();
    if (printWindow === null) {
      void message.warning('浏览器拦截了打印窗口，请允许本站弹窗后重试');
      return;
    }
    if (labelSkippedCount > 0) {
      modal.confirm({
        title: '部分订单不再支持打印面单',
        content: `所选 ${selectedOrderIds.length} 单中有 ${labelSkippedCount} 单已完成或已取消，将被跳过。继续打印其余 ${labelEligibleOrderIds.length} 单？`,
        okText: '继续打印',
        cancelText: '返回',
        onOk: () => {
          batchLabelMutation.mutate({ orderIds: labelEligibleOrderIds, printWindow });
        },
        onCancel: () => {
          printWindow.close();
        },
      });
      return;
    }
    batchLabelMutation.mutate({ orderIds: labelEligibleOrderIds, printWindow });
  };

  // ---- 批量外部履约（用户指示 2026-10-14）：同一原因逐单关账 ----
  // 与批量发货的本质区别：不产生任何库存流水。已发货/已取消的单前端先排除，
  // 存在已占用（RESERVED/PICKED）行的单由后端逐单拒绝并说明原因。
  const [batchExternalOpen, setBatchExternalOpen] = useState(false);
  const [batchExternalForm] = Form.useForm<{ reason: string }>();
  const eligibleExternalOrderIds = useMemo(
    () =>
      selectedOrderIds.filter((id) => {
        const row = selectedOrdersById.get(id);
        return row === undefined || (row.erpStatus !== 'SHIPPED' && row.erpStatus !== 'CANCELLED');
      }),
    [selectedOrderIds, selectedOrdersById],
  );

  const batchMarkExternalMutation = useMutation({
    mutationFn: ({ orderIds, reason }: { orderIds: string[]; reason: string }) =>
      apiPost<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
          orderId: string;
          orderNo: string | null;
          ok: boolean;
          code?: string | null;
          message?: string | null;
          erpStatus: string | null;
          releasedItems: number | null;
        }>;
      }>('/api/v1/orders/batch-mark-external-fulfillment', { orderIds, reason }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量外部履约：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description: (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.results.map((item) => (
              <div key={item.orderId}>
                {labelOfSelectedOrder(item.orderId)}：
                {item.ok
                  ? `已关账 ${item.releasedItems ?? 0} 行，订单转${
                      ERP_STATUS_META[item.erpStatus ?? '']?.label ?? item.erpStatus
                    }`
                  : `失败（${item.message ?? item.code ?? '未知错误'}）`}
              </div>
            ))}
          </div>
        ),
        duration: result.failed > 0 ? 0 : 8,
      });
      setBatchExternalOpen(false);
      batchExternalForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`批量外部履约失败：${error.message}`),
  });

  const requestBatchMarkExternal = () => {
    if (selectedOrderIds.length === 0) {
      return;
    }
    if (eligibleExternalOrderIds.length === 0) {
      void message.warning('勾选的订单都已发货/已取消，没有可标记外部履约的订单');
      return;
    }
    batchExternalForm.setFieldsValue({ reason: '' });
    setBatchExternalOpen(true);
  };

  const registerPurchaseMutation = useMutation({
    mutationFn: (values: { sourceNote?: string; quantity: number; unitCost?: number }) => {
      const item = registerItem as OrderItem;
      return apiPost<{ poNo: string }>('/api/v1/purchase-orders', {
        sourceNote: values.sourceNote,
        items: [
          {
            skuId: item.skuId,
            orderItemId: item.id,
            quantity: String(values.quantity),
            ...(values.unitCost !== undefined && values.unitCost !== null
              ? { unitCost: String(values.unitCost) }
              : {}),
          },
        ],
      });
    },
    onSuccess: (result) => {
      message.success(`已登记采购：${result.poNo}`);
      setRegisterItem(null);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`登记失败：${error.message}`),
  });

  /**
   * 去收货（2026-10-16 用户需求）：已采购行（派生状态 ORDERED）直接跳到收货
   * 流程——后端从该行关联的有效采购单生成收货草稿（收货仓库：采购单意向 →
   * 店铺绑定仓兜底；默认库位按决策 0021），前端生成后跳收货单页并打开该草稿。
   * 幂等/防重复草稿由后端保证（已有草稿会 409 提示去编辑那张）。
   */
  const createReceiptFromItemMutation = useMutation({
    mutationFn: (orderItemId: string) =>
      apiPost<{ id: string; receiptNo: string }>(
        '/api/v1/purchase-receipts/from-order-item/{orderItemId}',
        {},
        { orderItemId },
      ),
    onSuccess: (result) => {
      message.success(`已生成收货单 ${result.receiptNo}（草稿），正在打开…`);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
      void navigate(`/purchase-receipts?receipt=${result.id}`);
    },
    onError: (error: Error) => message.error(`去收货失败：${error.message}`),
  });

  const list = query.data?.data ?? [];
  const detail = detailId !== null ? detailQuery.data?.data : undefined;
  const detailDeadline =
    detail === undefined
      ? null
      : deadlineBadgeFor(
          detail.shipmentDeadline,
          detail.erpStatus,
          detail.platformStatus,
          detail.fulfillmentMode,
        );
  const selectedRow = useMemo(
    () => list.find((row) => row.id === selectedId) ?? null,
    [list, selectedId],
  );
  const railDetail = selectedId !== null ? detailQuery.data?.data : undefined;

  /**
   * 展开行字段（2026-10-17 改纵向明细）：视图设置里的「展开列」语义从
   * 「第二张表的列」变成「明细块里显示哪些字段」—— 显隐照旧生效，
   * 顺序决定元信息行的排列；主图 / SKU / 履约状态 固定在块头，不参与排序。
   */
  const expandedFields = useMemo(
    () =>
      viewSettings.expandedColumns.filter((column) => column.visible).map((column) => column.key),
    [viewSettings.expandedColumns],
  );

  /**
   * 本地镜像缺失时的按需补链接（2026-10-20 用户决策：C 为主、B 兜底）。
   * 先用订单行自带的标识定向读一次平台变体；平台不支持/接口失败/查不到时
   * 由运营确认后用订单事实本地补建链接。两条路径都只补「链接 + UNMAPPED
   * 变体」，内部 SKU 仍由映射/建档流程决定。
   */
  const ensureVariantListing = useCallback(
    async (item: OrderItem, storeId: string): Promise<string | null> => {
      const base = {
        storeId,
        platformProductId: item.platformProductId ?? undefined,
        platformSkuId: item.platformSkuId ?? undefined,
        offerId: item.offerId ?? undefined,
        sellerSku: item.sellerSku ?? undefined,
      };
      const result = await apiPost<EnsureVariantOutcome>('/api/v1/listings/ensure-variant', {
        ...base,
        source: 'PLATFORM',
      });
      if (result.resolved && result.listingId !== null) {
        return result.listingId;
      }
      if (result.reason === 'MISSING_IDENTIFIERS') {
        void message.warning('该订单行缺少可建链的平台标识（商品 ID + SKU/卖家 SKU）');
        return null;
      }
      if (!(await confirmOrderFactsBackfill(result.reason))) {
        return null;
      }
      const fallback = await apiPost<EnsureVariantOutcome>('/api/v1/listings/ensure-variant', {
        ...base,
        source: 'ORDER_FACTS',
      });
      if (fallback.resolved && fallback.listingId !== null) {
        return fallback.listingId;
      }
      void message.warning('按订单信息补建链接失败：缺少商品 ID 或变体标识');
      return null;
    },
    [message],
  );

  /** 快速建档/SKU映射共用的反查：本地未映射变体 → 按需补链接。 */
  const resolveListingForItem = useCallback(
    async (item: OrderItem, storeId: string): Promise<string | null> => {
      const keyword = mappingSearchKeyword(item);
      if (keyword === null || keyword.trim() === '') {
        void message.warning(
          '该订单行没有任何平台 SKU 标识（platformSkuId / sellerSku / offerId），无法定位',
        );
        return null;
      }
      const local = await apiGet<Array<{ id: string }>>('/api/v1/listings', {
        storeId,
        keyword: keyword.trim(),
        mappingState: 'UNMAPPED',
        page: 1,
        pageSize: 5,
      });
      const listing = local.data[0];
      if (listing !== undefined) {
        return listing.id;
      }
      return ensureVariantListing(item, storeId);
    },
    [ensureVariantListing, message],
  );

  /** 快速建档：按订单行标识反查商品链接（storeId 来自列表行，单击选中即有）。 */
  const openQuickOnboard = useCallback(
    (item: OrderItem, storeId: string) => {
      setOnboardLookupPending(true);
      resolveListingForItem(item, storeId)
        .then((listingId) => {
          if (listingId === null) {
            return;
          }
          setQuickOnboard({
            listingId,
            match: {
              platformSkuId: item.platformSkuId,
              offerId: item.offerId,
              sellerSku: item.sellerSku,
            },
            orderItemId: item.id,
          });
        })
        .catch((error: Error) => void message.error(`定位商品链接失败：${error.message}`))
        .finally(() => setOnboardLookupPending(false));
    },
    [message, resolveListingForItem],
  );

  // ---- SKU映射（用户指示 2026-10-14）：未映射订单行 → 绑定已有内部 SKU ----
  // 与 openQuickOnboard 同样的反查（本店铺 + 未映射 + 平台标识），命中后打开
  // 与 SKU映射 页面相同的共享映射弹窗，并按订单行标识预选变体。
  const [variantMap, setVariantMap] = useState<{
    listingId: string;
    match: OnboardMatchIdentifiers;
    orderItemId: string;
  } | null>(null);
  const [variantMapLookupPending, setVariantMapLookupPending] = useState(false);

  const openVariantMap = useCallback(
    (item: OrderItem, storeId: string) => {
      setVariantMapLookupPending(true);
      resolveListingForItem(item, storeId)
        .then((listingId) => {
          if (listingId === null) {
            return;
          }
          setVariantMap({
            listingId,
            match: {
              platformSkuId: item.platformSkuId,
              offerId: item.offerId,
              sellerSku: item.sellerSku,
            },
            orderItemId: item.id,
          });
        })
        .catch((error: Error) => void message.error(`定位商品链接失败：${error.message}`))
        .finally(() => setVariantMapLookupPending(false));
    },
    [message, resolveListingForItem],
  );

  /**
   * 打开商品链接（ERP 建议#3，用户指示 2026-09-28：只加在商品行侧边栏操作区）。
   * 反查本店铺下订单行对应的商品链接：已映射行按 skuId 精确查，未映射行按
   * 平台标识 keyword 查；命中行优先用人工维护的 listing.url，否则按平台拼
   * 公开商品页（OZON/WB 规则已核实；Yandex 未核实 → 提示，不猜 URL §88）。
   */
  const openPlatformProductPage = useCallback(
    (item: OrderItem, storeId: string, platformCode: string) => {
      const skuId = item.skuId;
      const keyword = mappingSearchKeyword(item);
      if (skuId === null && (keyword === null || keyword.trim() === '')) {
        void message.warning('该订单行没有任何 SKU / 平台标识，无法定位商品链接');
        return;
      }
      // OZON（用户实测 2026-09-28）：商品页 URL 的键是订单行自带的平台 SKU
      // ID（非 Listing 的 product_id），直接拼链接，无需反查商品链接。
      if (platformCode === 'OZON' && item.platformSkuId !== null) {
        window.open(buildOzonProductUrl(item.platformSkuId), '_blank', 'noopener');
        return;
      }
      setPlatformLinkPending(true);
      apiGet<
        Array<{
          id: string;
          platformCode: string;
          platformProductId: string;
          url: string | null;
        }>
      >('/api/v1/listings', {
        storeId,
        page: 1,
        pageSize: 20,
        ...(skuId !== null ? { skuId } : { keyword: keyword!.trim() }),
      })
        .then((result) => {
          const listing = result.data.find((row) => row.platformCode === platformCode);
          if (listing === undefined) {
            void message.warning('未在本店铺找到该订单行对应的商品链接');
            return;
          }
          const url =
            listing.url ?? buildPlatformProductUrl(listing.platformCode, listing.platformProductId);
          if (url === null) {
            void message.warning(
              `暂不支持打开 ${listing.platformCode} 的平台商品页（该平台商品页 URL 规则未核实），可先在商品链接页维护 url`,
            );
            return;
          }
          window.open(url, '_blank', 'noopener');
        })
        .catch((error: Error) => void message.error(`定位商品链接失败：${error.message}`))
        .finally(() => setPlatformLinkPending(false));
    },
    [message],
  );

  // ---- Context rail: risk-first order preview (task §41-§42) ----
  // 点击展开行 → SKU 信息视图（用户指示 2026-09-17）；点击订单行恢复订单视图。
  const selectedItem =
    selectedItemId !== null
      ? (railDetail?.items.find((item) => item.id === selectedItemId) ?? null)
      : null;
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedItem !== null) {
      const fulfillmentMeta = FULFILLMENT_STATUS_META[selectedItem.fulfillmentStatus];
      // 采购状态/入口只在**仍缺货**的行有意义（用户指示 2026-10-19）。
      const skuUnallocated =
        selectedItem.fulfillmentStatus === 'BACKORDERED' ||
        selectedItem.fulfillmentStatus === 'PENDING';
      const procurementMeta =
        !skuUnallocated || selectedItem.procurementState === null
          ? null
          : (PROCUREMENT_META[selectedItem.procurementState] ?? null);
      return {
        defaultCollapsed: true,
        header: (
          <EntitySummary
            title={selectedItem.skuId !== null ? selectedItem.skuCode : '未映射订单行'}
            subtitle={selectedItem.skuName || `第 ${selectedItem.lineNo} 行`}
            badge={
              <StatusBadge
                tone={fulfillmentMeta?.tone ?? 'neutral'}
                label={fulfillmentMeta?.label ?? selectedItem.fulfillmentStatus}
                hint={selectedItem.fulfillmentStatus}
              />
            }
          />
        ),
        children: (
          <>
            <ContextSection title="SKU 信息">
              {selectedItem.skuId !== null ? (
                <>
                  <ContextMetric label="SKU 编码" value={selectedItem.skuCode} />
                  <ContextMetric label="SKU 名称" value={selectedItem.skuName} />
                  <ContextMetric label="数量" value={Number(selectedItem.quantity)} />
                  <ContextMetric
                    label="最近采购价"
                    value={
                      selectedItem.latestPurchasePrice === null
                        ? '—'
                        : fmtMoney(selectedItem.latestPurchasePrice, railDetail?.currency)
                    }
                  />
                  <ContextMetric
                    label="单价 / 小计"
                    value={`${fmtMoney(selectedItem.unitPrice, railDetail?.currency)} / ${fmtMoney(
                      selectedItem.totalPrice,
                      railDetail?.currency,
                    )}`}
                  />
                  {procurementMeta !== null && (
                    <ContextMetric
                      label="采购状态"
                      value={
                        <StatusBadge
                          tone={procurementMeta.tone}
                          label={procurementMeta.label}
                          showDot={false}
                        />
                      }
                    />
                  )}
                  <ContextMetric label="Offer ID" value={selectedItem.offerId ?? '—'} />
                  <ContextMetric label="平台 SKU" value={selectedItem.platformSkuId ?? '—'} />
                </>
              ) : (
                <ContextMetric
                  label="平台标识"
                  value={
                    selectedItem.platformSkuId ??
                    selectedItem.sellerSku ??
                    selectedItem.offerId ??
                    '—'
                  }
                />
              )}
            </ContextSection>
            <ContextAction>
              {skuUnallocated && selectedItem.procurementState === 'ORDERED' ? (
                // 已采购且有进行中采购单：不再允许重复登记，给「去收货」——
                // 从该行的采购单直接生成收货草稿（2026-10-16 用户需求）。
                <Button
                  block
                  type="primary"
                  loading={createReceiptFromItemMutation.isPending}
                  onClick={() => createReceiptFromItemMutation.mutate(selectedItem.id)}
                >
                  去收货
                </Button>
              ) : skuUnallocated ? (
                <Button
                  block
                  type="primary"
                  disabled={
                    selectedItem.skuId === null || selectedItem.procurementState === 'ARRIVED'
                  }
                  onClick={() => setRegisterItem(selectedItem)}
                >
                  创建采购单
                </Button>
              ) : null}
              {skuUnallocated &&
                selectedItem.skuId !== null &&
                selectedItem.procurementState !== null && (
                  <RailHint>
                    {selectedItem.procurementState === 'NOT_ORDERED'
                      ? '为该订单行登记采购；同一订单行重复登记会被系统拒绝。'
                      : selectedItem.procurementState === 'ORDERED'
                        ? '该行已登记采购；点「去收货」从对应采购单生成收货单（预填默认库位）。'
                        : '该行采购已全部到货，无需重复登记。'}
                  </RailHint>
                )}
              <Button
                block
                style={{ marginTop: 8 }}
                loading={platformLinkPending}
                onClick={() =>
                  openPlatformProductPage(
                    selectedItem,
                    railDetail?.storeId ?? selectedRow?.storeId ?? '',
                    railDetail?.platformCode ?? selectedRow?.platformCode ?? '',
                  )
                }
              >
                打开商品链接
              </Button>
              {selectedItem.skuId !== null && selectedItem.skuCode !== '' && (
                <Button
                  block
                  style={{ marginTop: 8 }}
                  // 用户指示 2026-10-19：跳转 SKU 管理时**只搜索**该 SKU，不打开详情。
                  onClick={() =>
                    void navigate(`/skus?keyword=${encodeURIComponent(selectedItem.skuCode)}`)
                  }
                >
                  在 SKU 管理搜索
                </Button>
              )}
              {selectedItem.fulfillmentStatus === 'BACKORDERED' && selectedItem.skuId !== null && (
                <Button
                  block
                  style={{ marginTop: 8 }}
                  loading={retryMutation.isPending}
                  onClick={() => retryMutation.mutate(selectedItem.id)}
                >
                  重新尝试分配
                </Button>
              )}
              {selectedItem.mappingStatus === 'FAILED' && (
                <>
                  {/* SKU映射（用户指示 2026-10-14）：把该未映射行绑定到已有内部
                      SKU，与 SKU映射 页面同一弹窗同一行为；映射完成自动对该行
                      重试映射/分配。 */}
                  <Button
                    block
                    style={{ marginTop: 8 }}
                    loading={variantMapLookupPending}
                    onClick={() =>
                      openVariantMap(
                        selectedItem,
                        railDetail?.storeId ?? selectedRow?.storeId ?? '',
                      )
                    }
                  >
                    SKU映射
                  </Button>
                  <Button
                    block
                    style={{ marginTop: 8 }}
                    loading={onboardLookupPending}
                    onClick={() =>
                      openQuickOnboard(
                        selectedItem,
                        railDetail?.storeId ?? selectedRow?.storeId ?? '',
                      )
                    }
                  >
                    快速建档
                  </Button>
                </>
              )}
            </ContextAction>
          </>
        ),
      };
    }
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="订单概览">
            <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 单`} />
            <ContextMetric label="待处理" value={pendingCount.data?.meta.total ?? 0} />
            <ContextMetric label="外部履约" value={externalCount.data?.meta.total ?? 0} />
            <ContextMetric label="已发货" value={inTransitCount.data?.meta.total ?? 0} />
            <ContextMetric label="已完成" value={completedCount.data?.meta.total ?? 0} />
            <ContextMetric label="已取消" value={cancelledCount.data?.meta.total ?? 0} />
            <RailHint>
              点击订单行快速预览风险与状态；缺货订单可在右栏重试分配或登记采购。批量操作
              （生成拣货单 / 获取运单号 /
              发货）在页面底部浮岛上，勾选订单行首复选框即可（跨分页保留）。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const statusMeta = ERP_STATUS_META[selectedRow.erpStatus] ?? {
      tone: 'neutral' as const,
      label: selectedRow.erpStatus,
    };
    const deadline = deadlineBadgeFor(
      selectedRow.shipmentDeadline,
      selectedRow.erpStatus,
      selectedRow.platformStatus,
      railDetail?.fulfillmentMode ?? selectedRow.fulfillmentMode,
    );
    // 发货流程按钮显隐（2026-09-18）。能力来自后端的能力位——前端不判断平台，
    // 后端也不靠平台名硬编码：没接入发货能力的平台这两个按钮就不出现。
    const canPrepareShipment =
      (railDetail?.platformCapabilities.prepareShipment ?? false) &&
      selectedRow.erpStatus !== 'SHIPPED' &&
      selectedRow.erpStatus !== 'CANCELLED';
    // 平台面单要有平台运单号才打得出来（OZON 仅在组包后分配运单号）；
    // 已存档面单也保留入口，方便重复打印。终态订单（完成/取消）一律不给入口
    // （用户指示 2026-10-21；后端同样拦截）。
    const labelPrintBlocked = isLabelPrintBlocked(selectedRow);
    const canPrintLabel =
      (railDetail?.platformCapabilities.fetchShippingLabel ?? false) &&
      !labelPrintBlocked &&
      (selectedRow.platformTrackingNo !== null || orderLabels.length > 0);
    const canQuickShip = selectedRow.erpStatus === 'PICKED';
    // Risk section: mapping failed (red) takes priority over backordered (orange).
    const riskItems =
      railDetail?.items.filter(
        (item) =>
          item.mappingStatus === 'FAILED' ||
          item.fulfillmentStatus === 'BACKORDERED' ||
          item.fulfillmentStatus === 'PENDING',
      ) ?? [];
    // FAILED lines carry no skuId, so they need their own list to stay
    // clickable in the rail.
    const failedMappingItems = riskItems.filter((item) => item.mappingStatus === 'FAILED');
    // 操作区上移（用户指示 2026-10-13）：紧跟「订单概况」基础信息渲染，
    // 避免右栏信息过长时操作按钮被挤出可视区；最近状态排在操作区之后。
    const railActions = (
      <>
        <Button block onClick={() => setDetailId(selectedRow.id)}>
          查看详情
        </Button>
        {/* 发货 = PICKED 订单的推进主操作（§4.3：主操作紧跟查看详情，每个
            视图 ≤1 个 primary）。一键出库：自动建发货单+单包裹封箱 →
            正式出库扣库存 → 订单 SHIPPED。正式出库属 UI 规范 §7 L2，
            确认弹窗带 danger ok。 */}
        {canQuickShip && (
          <Button
            block
            type="primary"
            style={{ marginTop: 8 }}
            loading={quickShipMutation.isPending}
            onClick={() => {
              modal.confirm({
                title: `发货：${selectedRow.platformOrderId}？`,
                content:
                  '自动创建发货单与单包裹并封箱，然后正式出库：会扣减已拣货库存，' +
                  '全部行出库后订单变为已发货。已出库的发货单不会重复扣减库存。',
                okText: '确认发货',
                okButtonProps: { danger: true },
                cancelText: '返回',
                onOk: () => {
                  quickShipMutation.mutate(selectedRow.id);
                },
              });
            }}
          >
            发货
          </Button>
        )}
        {/* 待拣货订单的推进主操作（2026-09-18 从详情弹窗迁至右栏操作区）：
            仅 READY_TO_PICK 且有 RESERVED 行、且无进行中拣货任务时显示；
            与「发货」（PICKED）互斥，保证同一视图只有一个 primary。 */}
        {selectedRow.erpStatus === 'READY_TO_PICK' &&
          !(railDetail?.pickingTasks ?? []).some(
            (task) => task.status === 'CREATED' || task.status === 'IN_PROGRESS',
          ) && (
            <Button
              block
              type="primary"
              style={{ marginTop: 8 }}
              loading={createPickingMutation.isPending}
              onClick={() => createPickingMutation.mutate(selectedRow.id)}
            >
              创建拣货任务
            </Button>
          )}
        {/* 获取运单号 = 平台组包（真实平台写操作）。流程第一步（先于拣货）；
            接口幂等，已组包时不会重复写平台。真实外部写超出 §7 分级表，
            按 L2 力度用 modal.confirm 说明后果（比 Popconfirm 重是刻意的）。 */}
        {canPrepareShipment && (
          <Button
            block
            style={{ marginTop: 8 }}
            loading={prepareShipmentMutation.isPending}
            onClick={() => {
              modal.confirm({
                title: `获取运单号：${selectedRow.platformOrderId}？`,
                content:
                  '将调用平台「组包」接口把该订单推进到待发货状态（OZON awaiting_deliver），' +
                  '这是真实平台操作：会改变平台上的订单状态，并让平台分配运单号。' +
                  '已组包的订单不会重复提交。',
                okText: '获取运单号',
                cancelText: '返回',
                onOk: () => {
                  prepareShipmentMutation.mutate(selectedRow.id);
                },
              });
            }}
          >
            {selectedRow.platformTrackingNo === null ? '获取运单号' : '重新获取运单号'}
          </Button>
        )}
        {/* 打单：取平台面单 PDF 并打开打印（已存档则直接复用）。 */}
        {canPrintLabel && (
          <Button
            block
            style={{ marginTop: 8 }}
            loading={shippingLabelMutation.isPending}
            onClick={() => shippingLabelMutation.mutate({ id: selectedRow.id, refresh: false })}
          >
            {orderLabels.length === 0 ? '打单（取平台面单）' : '打单（用已存档面单）'}
          </Button>
        )}
        {/* 终态订单：按钮消失，用一行说明为什么（2026-10-21）。 */}
        {labelPrintBlocked && (
          <RailHint>
            {selectedRow.erpStatus === 'CANCELLED'
              ? '订单已取消，面单已作废，不再支持打印。'
              : '订单已完成，面单已归档清理，不再支持打印。'}
          </RailHint>
        )}
        {/* 快速建档已从订单级操作区移除（用户指示 2026-10-14）：一个订单可能
            含多个 SKU，订单级按钮只能处理第一行、语义不清；建档入口收敛到
            SKU 行侧边栏（点开具体未映射行后操作）。 */}
        {selectedRow.erpStatus !== 'SHIPPED' && selectedRow.erpStatus !== 'CANCELLED' && (
          <Button
            block
            style={{ marginTop: 8 }}
            onClick={() => {
              setExternalTarget(selectedRow);
              externalForm.setFieldsValue({ reason: '' });
            }}
          >
            标记外部履约
          </Button>
        )}
        {selectedRow.erpStatus !== 'CANCELLED' && (
          <Button
            block
            danger
            style={{ marginTop: 8 }}
            onClick={() => {
              // 取消订单 = L2：modal.confirm + danger ok。
              modal.confirm({
                title: `取消订单 ${selectedRow.platformOrderId}？`,
                content: '已占用行将释放库存；已拣货行将创建拦截任务（不自动恢复库存）。',
                okText: '取消订单',
                okButtonProps: { danger: true },
                cancelText: '返回',
                onOk: () => {
                  cancelMutation.mutate(selectedRow.id);
                },
              });
            }}
          >
            取消订单
          </Button>
        )}
      </>
    );
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.platformOrderId}
          subtitle={`内部单号 ${selectedRow.orderNo}`}
          badge={
            <StatusBadge
              tone={statusMeta.tone}
              label={statusMeta.label}
              hint={selectedRow.erpStatus}
            />
          }
          meta={<PlatformTag code={selectedRow.platformCode} suffix={selectedRow.storeName} />}
        />
      ),
      children: (
        <>
          {selectedRow.mappingFailedCount > 0 && (
            <ContextSection title="风险">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <StatusBadge
                  tone="danger"
                  label={`ORDER_SKU_MAPPING_FAILED ×${selectedRow.mappingFailedCount}`}
                />
                <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                  平台 SKU 无法映射内部 SKU。请先在 SKU映射（关联操作）中补齐该平台变体的映射，
                  再点下方按钮重试——重试会按最新映射重新解析该行。
                </span>
                {failedMappingItems.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span style={{ fontSize: 13, color: colors.textSecondary }}>
                      {item.platformSkuId ?? item.offerId ?? `第 ${item.lineNo} 行`}
                    </span>
                    <Button
                      size="small"
                      loading={retryMutation.isPending}
                      style={{ marginLeft: 'auto' }}
                      onClick={() => retryMutation.mutate(item.id)}
                    >
                      重试映射
                    </Button>
                  </div>
                ))}
              </div>
            </ContextSection>
          )}
          {selectedRow.mappingFailedCount === 0 && selectedRow.backorderedCount > 0 && (
            <ContextSection title="风险">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <StatusBadge
                  tone="warning"
                  label={`BACKORDERED ×${selectedRow.backorderedCount}`}
                />
                {riskItems
                  .filter((item) => item.skuId !== null)
                  .slice(0, 3)
                  .map((item) => (
                    <div
                      key={item.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span style={{ fontSize: 13, color: colors.textSecondary }}>
                        {item.skuCode} ×{Number(item.quantity)}
                      </span>
                      <Button
                        size="small"
                        loading={retryMutation.isPending}
                        style={{ marginLeft: 'auto' }}
                        onClick={() => retryMutation.mutate(item.id)}
                      >
                        重新尝试分配
                      </Button>
                    </div>
                  ))}
              </div>
            </ContextSection>
          )}
          <ContextSection title="订单概况">
            <ContextMetric label="商品行" value={selectedRow.itemsCount} />
            <ContextMetric label="已占用" value={selectedRow.reservedCount} />
            <ContextMetric label="已拣货" value={selectedRow.pickedCount} />
            <ContextMetric
              label="异常"
              value={
                selectedRow.openExceptionsCount > 0 ? (
                  <span style={{ color: colors.danger }}>{selectedRow.openExceptionsCount}</span>
                ) : (
                  0
                )
              }
            />
            <ContextMetric label="下单时间" value={fmtDateTime(selectedRow.orderedAt)} />
            {deadline !== null && (
              <ContextMetric
                label={
                  <span
                    style={{
                      color:
                        deadline.tone === 'danger'
                          ? colors.danger
                          : deadline.tone === 'warning'
                            ? colors.warning
                            : colors.textSecondary,
                    }}
                  >
                    发货时限
                  </span>
                }
                value={
                  <span
                    style={{
                      color:
                        deadline.tone === 'danger'
                          ? colors.danger
                          : deadline.tone === 'warning'
                            ? colors.warning
                            : undefined,
                      fontWeight: deadline.tone === 'neutral' ? undefined : 650,
                    }}
                  >
                    {deadline.label}（{deadline.exact}）
                  </span>
                }
              />
            )}
          </ContextSection>
          {/* 操作区（用户指示 2026-10-13 上移）：紧跟订单概况基础信息，
              信息再长按钮也不会被挤出可视区。 */}
          <ContextAction>{railActions}</ContextAction>
          {/* 发货流程（2026-09-18）：运单号与面单都是平台事实，直接展示；
              仓库内部出库仍在「发货」按钮里走既有阶梯。 */}
          {(selectedRow.platformTrackingNo !== null ||
            canPrepareShipment ||
            orderLabels.length > 0) && (
            <ContextSection title="发货 / 物流">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <ContextMetric
                  label="平台运单号"
                  value={selectedRow.platformTrackingNo ?? '尚未获取（点「获取运单号」）'}
                />
                {orderLabels.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      平台面单 {orderLabels.length} 张
                    </span>
                    <Button
                      size="small"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => window.open(orderLabels[0]!.signedUrl, '_blank', 'noopener')}
                    >
                      打开面单
                    </Button>
                  </div>
                )}
              </div>
            </ContextSection>
          )}
          {railDetail !== undefined && railDetail.history.length > 0 && (
            <RailRecentStatus key={railDetail.id} history={railDetail.history} />
          )}
        </>
      ),
    };
  }, [
    selectedItem,
    selectedRow,
    railDetail,
    retryMutation.isPending,
    createPickingMutation.isPending,
    createReceiptFromItemMutation.isPending,
    prepareShipmentMutation.isPending,
    shippingLabelMutation.isPending,
    quickShipMutation.isPending,
    // 面单列表异步到达：不进依赖则「发货 / 物流」区与打单按钮停在旧态（§4.4）。
    orderLabels,
    query.data,
    pendingCount.data,
    inTransitCount.data,
    completedCount.data,
    cancelMutation.mutate,
    modal,
    onboardLookupPending,
    openQuickOnboard,
    openVariantMap,
    variantMapLookupPending,
  ]);
  useContextRail(railContent);

  const itemColumns = [
    { title: '#', dataIndex: 'lineNo', key: 'lineNo', width: 40 },
    {
      title: '图片',
      key: 'image',
      width: 60,
      render: (_: unknown, row: OrderItem) =>
        row.imageUrl === null ? (
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 6,
              background: colors.neutralBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: colors.textTertiary,
              fontSize: 11,
            }}
          >
            无图
          </div>
        ) : (
          <Tooltip title={row.imageSource === 'PLATFORM' ? '平台图' : undefined}>
            <span style={{ display: 'inline-block' }}>
              <Image
                src={row.imageUrl}
                width={40}
                height={40}
                style={{ objectFit: 'cover', borderRadius: 6 }}
                preview={{ mask: false }}
              />
            </span>
          </Tooltip>
        ),
    },
    {
      title: 'SKU',
      key: 'sku',
      render: (_: unknown, row: OrderItem) =>
        row.skuId === null ? (
          <StatusBadge
            tone="purple"
            label="无法映射"
            hint="缺少 SKU 映射，去 SKU 映射补齐后重试"
            showDot={false}
          />
        ) : (
          <div>
            <div style={{ fontWeight: 550 }}>{row.skuCode}</div>
            <div style={{ fontSize: 12.5, color: colors.textSecondary }}>{row.skuName}</div>
          </div>
        ),
    },
    {
      title: '最近采购价',
      dataIndex: 'latestPurchasePrice',
      key: 'latestPurchasePrice',
      width: 110,
      align: 'right' as const,
      render: (value: string | null) => (value === null ? '—' : fmtMoney(value, detail?.currency)),
    },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 70, align: 'right' as const },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 110,
      align: 'right' as const,
      render: (value: string | null) => fmtMoney(value, detail?.currency),
    },
    {
      title: '小计',
      dataIndex: 'totalPrice',
      key: 'totalPrice',
      width: 110,
      align: 'right' as const,
      render: (value: string | null) => fmtMoney(value, detail?.currency),
    },
    {
      title: '履约状态',
      dataIndex: 'fulfillmentStatus',
      key: 'fulfillmentStatus',
      width: 130,
      render: (value: string) => (
        <StatusBadge
          tone={FULFILLMENT_STATUS_META[value]?.tone ?? 'neutral'}
          label={FULFILLMENT_STATUS_META[value]?.label ?? value}
          showDot={false}
        />
      ),
    },
    {
      title: '采购状态',
      dataIndex: 'procurementState',
      key: 'procurementState',
      width: 150,
      render: (value: string | null, row: OrderItem) => {
        // 仅缺货行显示（用户指示 2026-10-19）：已分配库存后采购状态无意义。
        if (
          value === null ||
          (row.fulfillmentStatus !== 'BACKORDERED' && row.fulfillmentStatus !== 'PENDING')
        ) {
          return '—';
        }
        const meta = PROCUREMENT_META[value] ?? { tone: 'neutral' as const, label: value };
        const registerable =
          value === 'NOT_ORDERED' && row.fulfillmentStatus === 'BACKORDERED' && row.skuId !== null;
        return (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <StatusBadge tone={meta.tone} label={meta.label} hint={value} showDot={false} />
            {registerable && (
              <Button
                size="small"
                type="primary"
                onClick={(event) => {
                  event.stopPropagation();
                  setRegisterItem(row);
                }}
              >
                登记采购
              </Button>
            )}
          </span>
        );
      },
    },
    {
      title: '库存分配（库位 × 数量）',
      key: 'bins',
      render: (_: unknown, row: OrderItem) =>
        row.reservation === null ? (
          '—'
        ) : (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
              {row.reservation.reservationNo}
            </span>
            {row.reservation.lines.map((line, index) => (
              <StatusBadge
                key={index}
                tone={line.pickedQty === line.quantity ? 'success' : 'info'}
                label={`${line.binCode} ×${Number(line.quantity)}`}
                showDot={false}
              />
            ))}
          </span>
        ),
    },
    {
      title: '异常',
      key: 'exceptions',
      width: 200,
      // 行级异常列只反映待处理问题：RESOLVED/IGNORED 不再展示（历史在
      // 「异常」Tab 中保留）。
      render: (_: unknown, row: OrderItem) => {
        const open = row.exceptions.filter((exception) => exception.status === 'OPEN');
        return open.length === 0 ? (
          '—'
        ) : (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {open.map((exception) => (
              <StatusBadge
                key={exception.exceptionNo}
                tone="danger"
                label={exception.exceptionType}
                showDot={false}
              />
            ))}
          </span>
        );
      },
    },
  ];

  /**
   * 主表列注册表（用户指示 2026-09-17）：显示顺序/显隐由视图设置驱动；
   * 「平台 / 店铺」改为「店铺」（保持平台图标+店铺名，履约方式独立成列）；
   * 下单时间显示为日期+时间点。
   */
  const mainColumnDefs: Record<string, ColumnsType<OrderListItem>[number]> = {
    platformOrderId: {
      title: '订单号',
      key: 'platformOrderId',
      // 170 → 200（2026-10-17 用户反馈「很丑」）：17 位平台单号在连字符处被
      // break-all 硬断成两行（「0161741011-0036」/「-1」），首列三行、行高被顶到 75px。
      width: 200,
      render: (_: unknown, row: OrderListItem) => {
        // 加急旗标（用户指示 2026-10-16）：点击即切换。红=加急，黑白=普通。
        // 终态订单（已发货/已取消）不可切换，旗标仅以低饱和提示（后端亦拒绝）。
        const terminal = row.erpStatus === 'SHIPPED' || row.erpStatus === 'CANCELLED';
        const urgent = row.isUrgent;
        return (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <button
              type="button"
              aria-label={urgent ? '取消加急' : '标记加急'}
              aria-pressed={urgent}
              disabled={terminal || urgentPendingId === row.id}
              title={
                terminal
                  ? '已发货/已取消订单不可加急'
                  : urgent
                    ? '取消加急（取消后不再置顶、不再优先分配）'
                    : '标记加急（列表置顶、缺货到货优先分配库存）'
              }
              onClick={(event) => {
                event.stopPropagation();
                toggleUrgentMutation.mutate({ id: row.id, urgent: !urgent });
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                marginTop: 1,
                lineHeight: 1,
                cursor: terminal ? 'not-allowed' : 'pointer',
                color: urgent ? colors.danger : colors.textTertiary,
                opacity: terminal ? 0.4 : 1,
                fontSize: 15,
              }}
            >
              <FlagFilled />
            </button>
            <div style={{ minWidth: 0 }}>
              {/* 单号单行显示、超长才省略（悬浮看全号）；break-all 会把
                  「0161741011-0036-1」在连字符处切成两行，首列三行高。 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span
                  title={row.platformOrderId}
                  style={{
                    fontWeight: 550,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}
                >
                  {row.platformOrderId}
                </span>
                <CopyTextButton value={row.platformOrderId} title="平台订单号" />
                {urgent && (
                  <StatusBadge
                    tone="danger"
                    label="加急"
                    hint="加急订单：列表置顶，缺货到货后优先分配"
                    showDot={false}
                  />
                )}
              </div>
              <div style={{ fontSize: 12, color: colors.textTertiary }}>{row.orderNo}</div>
            </div>
          </div>
        );
      },
    },
    items: {
      title: '商品',
      key: 'items',
      width: 133,
      render: (_: unknown, row: OrderListItem) => {
        if (row.mappingFailedCount > 0) {
          return (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span>{row.itemsCount} 行</span>
              <StatusBadge
                tone="purple"
                label={`映射失败 ${row.mappingFailedCount}`}
                showDot={false}
              />
            </span>
          );
        }
        const distribution = [
          row.backorderedCount > 0 ? `缺货 ${row.backorderedCount}` : null,
          row.backorderedOrderedCount > 0 ? `已采购 ${row.backorderedOrderedCount}` : null,
          row.reservedCount > 0 ? `已占用 ${row.reservedCount}` : null,
        ].filter((part): part is string => part !== null);
        return (
          // 2026-10-17 用户定稿：主行只报「N 行」。缺货 / 已采购 / 已占用的行级细节
          // 挪进展开明细的每一块（能挂到具体 SKU 上），主行只在悬浮说明里汇总。
          <div
            title={
              distribution.length > 0
                ? `共 ${row.itemsCount} 行：${distribution.join('，')}（展开查看每行状态）`
                : undefined
            }
            style={{ minWidth: 0 }}
          >
            <div>{row.itemsCount} 行</div>

            {row.backorderedArrivedCount > 0 && (
              <div style={{ marginTop: 4 }}>
                {railDetail?.id === row.id && detailQuery.isSuccess ? (
                  <Button
                    size="small"
                    loading={arrivedRetryId === row.id}
                    disabled={arrivedRetryId !== null || retryMutation.isPending}
                    style={{ color: colors.success }}
                    onClick={(event) => {
                      event.stopPropagation();
                      confirmArrivedRetry(row);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    重新分配 {row.backorderedArrivedCount}
                  </Button>
                ) : (
                  <span
                    title="请先展开订单加载明细，再点击重新分配"
                    style={{ fontSize: 12, color: colors.success }}
                  >
                    已到货 {row.backorderedArrivedCount}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    sku: {
      title: 'SKU',
      key: 'sku',
      width: 140,
      render: (_: unknown, row: OrderListItem) =>
        row.firstSkuCode === null ? (
          <span style={{ color: colors.textTertiary }}>—</span>
        ) : (
          <Tooltip
            title={
              row.skuKindCount > 1 ? `该单共 ${row.skuKindCount} 种 SKU，展开查看明细` : undefined
            }
          >
            {/* 只显示首个 SKU 编码（2026-10-17）：此前末尾跟「等 N 种」，在 140px 列里
                被挤成两行（「等 2」/「种」）；多种 SKU 的提示改由悬浮说明承担，
                行数已在「商品」列表达。 */}
            <span
              style={{
                fontSize: 12.5,
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {row.firstSkuCode}
            </span>
          </Tooltip>
        ),
    },
    erpStatus: {
      title: 'ERP 状态',
      dataIndex: 'erpStatus',
      key: 'erpStatus',
      width: 105,
      render: (value: string, row: OrderListItem) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <StatusBadge
            tone={ERP_STATUS_META[value]?.tone ?? 'neutral'}
            label={ERP_STATUS_META[value]?.label ?? value}
            hint={value}
            showDot={false}
          />
          {row.openExceptionsCount > 0 && (
            <Tooltip
              title={`未处理异常 ${row.openExceptionsCount} 条（含缺货 ORDER_OUT_OF_STOCK、映射失败等行级异常；处理入口在异常中心或行内操作）`}
            >
              <span style={{ fontSize: 12, color: colors.danger, fontWeight: 600 }}>
                ×{row.openExceptionsCount}
              </span>
            </Tooltip>
          )}
          {platformDivergent(row.platformStatus, value) && (
            <Tooltip title={`平台状态 ${row.platformStatus}：平台侧已发货/送达，系统未发货`}>
              <span style={{ fontSize: 12, color: colors.warning, fontWeight: 600 }}>⚠</span>
            </Tooltip>
          )}
        </span>
      ),
    },
    logistics: {
      title: '物流',
      key: 'logistics',
      width: 132,
      render: (_: unknown, row: OrderListItem) => {
        // 物流进度列（用户指示 2026-10-19 定稿）：
        // - 已取消 → —；
        // - 外部履约单（FBO/FBP/FBW/FBY）由平台履约，**始终按物流阶段显示**，
        //   不显示打单状态（无需打单，用 — 表达）；
        // - 自管/半自管单：发货后才显示阶段（未发货时 AWAITING_SHIPMENT 只意味着
        //   「平台在等我们发货」，不是物流事实）；打单状态则从打单起就显示。
        if (row.erpStatus === 'CANCELLED') {
          return <span style={{ color: colors.textTertiary }}>—</span>;
        }
        const external = isExternalFulfillmentMode(row.fulfillmentMode);
        const shippedSide = row.erpStatus === 'SHIPPED' || row.erpStatus === 'PARTIALLY_SHIPPED';
        const meta = LOGISTICS_STAGE_META[row.platformStage ?? ''];
        const showPrinted = !external && row.labelPrintedAt !== null;
        const showStage = external || shippedSide;
        if (!showPrinted && (!showStage || meta === undefined)) {
          return <span style={{ color: colors.textTertiary }}>—</span>;
        }
        return (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {showPrinted && (
              <StatusBadge tone="success" label="已打印" hint="平台面单已打印" showDot={false} />
            )}
            {showStage &&
              (meta === undefined ? (
                <span style={{ color: colors.textTertiary }}>—</span>
              ) : (
                <StatusBadge tone={meta.tone} label={meta.label} hint={meta.hint} showDot={false} />
              ))}
          </span>
        );
      },
    },
    storeFulfillment: {
      title: '店铺·履约',
      key: 'storeFulfillment',
      // 合并列（2026-10-17 用户拍板 A 方案）：店铺与履约方式是同一件事的两个面，
      // 分两列白占近 300px，正是主表必须横向滚动的直接原因。现在合成
      // 「OZON 香港店 · rFBS」，订单一眼能读完，主表也回到不横滚。
      width: 210,
      render: (_: unknown, row: OrderListItem) => {
        const mode = fulfillmentModeChip(row.fulfillmentMode);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <PlatformTag code={row.platformCode} suffix={row.storeName} />
            {mode !== null && (
              // 履约方式改彩色胶囊（用户指示 2026-10-19）：不同模式不同颜色，
              // rFBS/FBS 蓝、FBP/FBO 绿、FBW 紫、FBY 黄。
              <StatusBadge
                tone={fulfillmentModeTone(row.fulfillmentMode)}
                label={mode.short}
                hint={mode.hint}
                showDot={false}
              />
            )}
          </span>
        );
      },
    },
    shipmentDeadline: {
      title: '时限',
      dataIndex: 'shipmentDeadline',
      key: 'shipmentDeadline',
      width: 104,
      render: (value: string | null, row: OrderListItem) => {
        const badge = deadlineBadgeFor(
          value,
          row.erpStatus,
          row.platformStatus,
          row.fulfillmentMode,
        );
        return badge === null ? (
          '—'
        ) : (
          <StatusBadge tone={badge.tone} label={badge.label} hint={badge.exact} showDot={false} />
        );
      },
    },
    platformTrackingNo: {
      title: '运单号',
      dataIndex: 'platformTrackingNo',
      key: 'platformTrackingNo',
      width: 170,
      render: (value: string | null, row: OrderListItem) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {/* 「已打印」默认在物流列展示；物流列被隐藏时，退回到单号前方显示
              （用户指示：胶囊显示在单号前），避免同一事实重复两次。 */}
          {row.labelPrintedAt !== null &&
            !logisticsColumnVisible &&
            !isExternalFulfillmentMode(row.fulfillmentMode) && (
              <StatusBadge tone="success" label="已打印" hint="平台面单已打印" showDot={false} />
            )}
          <span>{value ?? '—'}</span>
        </span>
      ),
    },
    orderedAt: {
      title: '下单时间',
      dataIndex: 'orderedAt',
      key: 'orderedAt',
      width: 94,
      render: (value: string) => <RelativeTime value={value} />,
    },
  };

  const logisticsColumnVisible = viewSettings.mainColumns.some(
    (column) => column.key === 'logistics' && column.visible,
  );
  const mainColumns = viewSettings.mainColumns
    .filter((column) => column.visible)
    .map((column) => mainColumnDefs[column.key])
    .filter((column) => column !== undefined);

  /**
   * 表格横向滚动宽度（2026-10-17 体检 P0-2）。
   * 9 列固定宽度合计 1380px，而主区可用宽度在 1600（右栏展开）只有 1044px、
   * 1366 只有 1110px —— 不声明 scroll.x 时 antd 会把列压窄，单元格内容折成
   * 两三行、行高翻倍。按**当前可见列**的宽度求和（列可在视图设置里增删），
   * 让表格在自身内部横滚，而不是牺牲列宽。
   */
  const tableScrollX = useMemo(() => {
    const columnsWidth = mainColumns.reduce((sum, column) => {
      // width 允许是百分比字符串；无法量化的按 120px 估算。
      const width = typeof column.width === 'number' ? column.width : 120;
      return sum + width;
    }, 0);
    // 行选择列（复选框）随内容自适应，预留 48px。
    return columnsWidth + 48;
  }, [mainColumns]);

  /** 默认展开所有订单行（视图设置）时整页展开，点击仅选中（侧边栏）。 */
  const expandedRowKeys = useMemo(() => {
    if (viewSettings.defaultExpandAll) {
      const ids = list.map((row) => row.id);
      return selectedId === null ? ids : [...new Set([...ids, selectedId])];
    }
    return selectedId === null ? [] : [selectedId];
  }, [viewSettings.defaultExpandAll, list, selectedId]);

  // 阶段 Tab 计数：显式按 tab key 取各自的服务端 total。此前是 if-else 链且把
  // 未知 key 兜底到 completedCount——新增「外部履约」Tab 时静默取了「已完成」
  // 的数（外部履约显示 21、实际 4）。改成显式查表，杜绝这类落空串数。
  const stageCounts: Record<string, number> = {
    all: allCount.data?.meta.total ?? 0,
    pending: pendingCount.data?.meta.total ?? 0,
    external: externalCount.data?.meta.total ?? 0,
    inTransit: inTransitCount.data?.meta.total ?? 0,
    completed: completedCount.data?.meta.total ?? 0,
    cancelled: cancelledCount.data?.meta.total ?? 0,
  };
  const stageCountOf = (tabKey: string): number => stageCounts[tabKey] ?? 0;

  // 浮岛与表格共用同一份总数（服务端 meta.total，不是当前页行数）。
  const totalCount = query.data?.meta.total ?? 0;

  // 任一批量动作在跑时，其余批量按钮一并禁用（互斥，避免同时对同一批单
  // 发起多个平台/库存写操作）。loading 自身的按钮视觉上已是禁用态。
  const anyBatchPending =
    batchPickingMutation.isPending ||
    batchPrepareMutation.isPending ||
    batchShipMutation.isPending ||
    batchMarkExternalMutation.isPending ||
    batchLabelMutation.isPending;

  return (
    <div>
      <PageHeader
        title="订单管理"
        description="统一管理各平台订单及内部履约状态"
        secondary={<Button onClick={() => setViewOpen(true)}>视图设置</Button>}
        extra={
          <>
            {/* 批量操作条已于 2026-10-16 迁入页面底部浮岛（ActionIsland）：
                分页与批量动作同处一条吸底浮岛，长列表无需滚回页首即可翻页/批量操作。
                浮岛必须挂在页面根节点下，不能留在 PageHeader.extra。 */}
            <Tabs
              activeKey={activeTab}
              onChange={(key) => {
                setPage(1);
                setActiveTab(key);
              }}
              items={STAGE_TABS.map((tab) => ({
                key: tab.key,
                label: `${tab.label} (${stageCountOf(tab.key)})`,
              }))}
            />
          </>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="订单号 / 平台订单号 / 商品 SKU / Offer ID"
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 320 }}
          aria-label="搜索订单"
        />
        <Select
          allowClear
          placeholder="店铺"
          style={{ width: 200 }}
          showSearch
          optionFilterProp="label"
          options={(storesQuery.data?.data ?? [])
            .filter(
              (store) => platformFilter === undefined || store.platformCode === platformFilter,
            )
            .map((store) => ({
              value: store.id,
              label: `${store.storeCode} · ${store.name}`,
            }))}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
        />
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 130 }}
          options={[...new Set((storesQuery.data?.data ?? []).map((s) => s.platformCode))].map(
            (code) => ({
              value: code,
              label: code,
            }),
          )}
          value={platformFilter}
          onChange={(value) => {
            setPage(1);
            setPlatformFilter(value);
            setStoreId(undefined);
            // 履约方式随平台联动（用户反馈 2026-09-28）：旧平台的短码对新平台
            // 无效（如 OZON 的 RFBS 对 WB），切换时直接清空已选值。
            setFulfillmentModeFilter(undefined);
          }}
        />
        <Select
          allowClear
          placeholder="履约方式"
          style={{ width: 130 }}
          value={fulfillmentModeFilter}
          onChange={(value) => {
            setPage(1);
            setFulfillmentModeFilter(value);
          }}
          options={fulfillmentModeOptionsFor(platformFilter)}
        />
      </FilterBar>

      {/* Axis 2: line-level goods-state chips (§2.2) - single select on top of
          the stage tab. Flow chips describe healthy progress; risk chips need
          human attention. Tooltips state the exact backend predicate.
          行末排序按钮组（2026-10-14 用户指示图示）：默认排序 / 下单时间 /
          发货时间 / SKU。按钮只切当前会话，默认排序在视图设置里配置。 */}
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <FilterChips
          chips={GOODS_STATE_CHIPS.map((chip) => ({
            key: chip.key,
            label: chip.label,
            tooltip: chip.tooltip,
            tone: chip.flow ? 'default' : 'risk',
            group: chip.flow ? 'flow' : 'risk',
          }))}
          value={goodsState ?? 'ALL'}
          onChange={(key) => {
            setPage(1);
            setGoodsState(key === undefined || key === 'ALL' ? undefined : key);
          }}
        />
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <Button
            size="small"
            type={isDefaultSort ? 'primary' : 'default'}
            onClick={() => {
              setPage(1);
              setSessionSort({
                sortBy: viewSettings.defaultSortBy,
                sortOrder: viewSettings.defaultSortOrder,
              });
            }}
          >
            默认排序
          </Button>
          {SORT_FIELD_BUTTONS.map((button) => {
            const active =
              sessionSort.sortBy === button.sortBy && sessionSort.sortOrder === button.sortOrder;
            return (
              <Button
                key={button.field}
                size="small"
                type={active ? 'primary' : 'default'}
                onClick={() => {
                  setPage(1);
                  // 再点已选中的按钮 = 回到默认排序（toggle）。
                  setSessionSort(
                    active
                      ? {
                          sortBy: viewSettings.defaultSortBy,
                          sortOrder: viewSettings.defaultSortOrder,
                        }
                      : { sortBy: button.sortBy, sortOrder: button.sortOrder },
                  );
                }}
              >
                {button.label}
              </Button>
            );
          })}
        </div>
      </div>

      <SectionCard flush>
        <DataTable<OrderListItem>
          rowKey="id"
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          dataSource={list}
          rowSelection={{
            selectedRowKeys: selectedOrderIds,
            // 跨分页选择（用户指示 2026-10-13）：翻页/筛选后勾选不丢。
            preserveSelectedRowKeys: true,
            onChange: handleOrderSelectionChange,
          }}
          // 分页从表格内部迁到页面底部浮岛（用户指示 2026-10-16）：状态仍全部
          // 受控在本组件（page / viewSettings.pageSize / meta.total），这里关掉
          // 表格自带分页即可，浮岛里的 <Pagination> 接管同一份状态。
          pagination={false}
          expandable={{
            // 选中即展开（用户指示 2026-09-17）：行点击选择驱动展开/收起，
            // 不显示独立展开列；内容复用 railDetail（已缓存详情）。
            // 视图设置「默认展开所有订单行」时整页展开，点击仅选中（侧边栏）。
            expandedRowKeys: expandedRowKeys,
            showExpandColumn: false,
            expandedRowRender: (record: OrderListItem) => (
              // 负外边距抵消 antd 展开行单元格的上下 padding（12px×2）：项目没有全局
              // 样式表、全站内联样式，无法直接改 .ant-table-expanded-row > td 的 padding，
              // 这里用 -6px 把上下各吃掉一半 → 展开块外的留白从 12 收到 6
              // （2026-10-17 用户要求压缩内容上下的区间）。
              <div onClick={(event) => event.stopPropagation()} style={{ margin: '-6px 0' }}>
                <ExpandedOrderItems
                  order={record}
                  fields={expandedFields}
                  thumbnailSize={viewSettings.thumbnailSize}
                  selectedItem={
                    selectedItemId !== null && railDetail !== undefined
                      ? (railDetail.items.find((item) => item.id === selectedItemId) ?? null)
                      : null
                  }
                  onItemRowClick={(item) => {
                    setSelectedItemId(item.id === selectedItemId ? null : item.id);
                    // 选中所属订单：右栏 SKU 视图的详情来自该订单的缓存查询。
                    setSelectedId(record.id);
                  }}
                />
              </div>
            ),
          }}
          onRow={(record) => {
            const activate = (): void => {
              /**
               * 选中分两级（2026-10-17 用户要求）：订单行 / 明细里的 SKU 行。
               * 用户先点明细里的 SKU、再点订单行时，焦点只是从 SKU 收回订单行，
               * **不该顺手把订单取消掉**；只有「焦点本来就在订单行」时，再点才是取消。
               */
              if (selectedId !== record.id) {
                setSelectedItemId(null);
                setSelectedId(record.id);
                return;
              }
              if (selectedItemId !== null) {
                // 焦点在 SKU 行 → 收回订单行，保持选中。
                setSelectedItemId(null);
                return;
              }
              setSelectedId(null);
            };
            return {
              onClick: (event) => {
                // 勾选复选框不触发行选中/展开（多选与单击选中互不干扰）。
                if ((event.target as HTMLElement).closest('.ant-table-selection-column') !== null) {
                  return;
                }
                activate();
              },
              onDoubleClick: () => setDetailId(record.id),
              // 键盘可达（2026-10-17 体检 P2-9）：Enter / 空格 = 行点击。
              ...rowInteractionProps({
                selected: record.id === selectedId,
                onActivate: activate,
                label: `订单 ${record.platformOrderId}`,
              }),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            };
          }}
          emptyTitle="暂无订单"
          emptyDescription="当前筛选下没有订单；新订单由平台同步自动进入系统。"
          scroll={{ x: tableScrollX }}
          columns={mainColumns}
        />
      </SectionCard>

      {/* ---- 底部动作浮岛（用户指示 2026-10-16）----
          分页与批量动作固定在主滚动区底部：长列表不必滚回页首即可翻页/批量操作。
          未勾选时只渲染分页行（行动行不渲染 → 选中行数随之隐藏）；
          勾选后行动行出现，浮岛边框转为 primary 作为唯一状态信号。
          位置约束：必须是页面根节点下的最后一个流内子节点，sticky 才能吸附在
          <main> 内（放 PageHeader.extra 会随头部滚出而失效）。 */}
      <ActionIsland
        summary={
          selectedOrderIds.length > 0 ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 550 }}>
                已选 {selectedOrderIds.length} 单
              </span>
              <span style={{ fontSize: 12, color: colors.textTertiary }}>（跨分页保留）</span>
            </>
          ) : undefined
        }
        actions={
          selectedOrderIds.length > 0 ? (
            <>
              <Button
                loading={batchPickingMutation.isPending}
                disabled={anyBatchPending}
                onClick={confirmBatchPicking}
              >
                批量生成拣货单
              </Button>
              <Button
                loading={batchPrepareMutation.isPending}
                disabled={anyBatchPending}
                onClick={confirmBatchPrepare}
              >
                批量获取运单号
              </Button>
              <Tooltip
                title={
                  labelEligibleOrderIds.length === 0
                    ? '所选订单均已完成或已取消，不再支持打印面单'
                    : labelSkippedCount > 0
                      ? `${labelSkippedCount} 单已完成/取消，将被跳过`
                      : undefined
                }
              >
                <Button
                  loading={batchLabelMutation.isPending}
                  disabled={anyBatchPending || labelEligibleOrderIds.length === 0}
                  onClick={confirmBatchPrintLabels}
                >
                  批量打印面单
                </Button>
              </Tooltip>
              <Button
                danger
                loading={batchShipMutation.isPending}
                disabled={anyBatchPending}
                onClick={confirmBatchShip}
              >
                批量发货
              </Button>
              <Button
                loading={batchMarkExternalMutation.isPending}
                disabled={anyBatchPending}
                onClick={requestBatchMarkExternal}
              >
                批量外部履约
              </Button>
              <Button type="text" onClick={clearOrderSelection}>
                清空选择
              </Button>
            </>
          ) : undefined
        }
        leading={
          <span style={{ fontSize: 13, color: colors.textSecondary }}>共 {totalCount} 单</span>
        }
        trailing={
          <Pagination
            current={page}
            pageSize={viewSettings.pageSize}
            total={totalCount}
            // 与「视图设置 → 每页行数」的可选值保持一致（2026-10-16）。
            pageSizeOptions={[10, 20, 50, 100]}
            // pageSize 是受控值（视图设置）：必须接住 size 变化写回设置，
            // 否则下拉选了新条数会被受控值打回（2026-10-14 用户报告的 bug）。
            onChange={(next, size) => {
              if (size !== viewSettings.pageSize) {
                setPage(1);
                updateViewSettings({ pageSize: size });
              } else {
                setPage(next);
              }
            }}
          />
        }
        // 无结果时整条浮岛收起（空状态卡片已说明「暂无订单」）。
        hidden={totalCount === 0}
      />

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={880}
        title={
          detail !== undefined && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>{detail.platformOrderId}</span>
          )
        }
        extra={
          detail !== undefined && (
            <PlatformTag code={detail.platformCode} suffix={detail.storeName} />
          )
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detail === undefined ? (
          <span style={{ color: colors.textTertiary }}>
            {detailQuery.isLoading ? '加载中…' : '无数据'}
          </span>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <StatusBadge
                tone={ERP_STATUS_META[detail.erpStatus]?.tone ?? 'neutral'}
                label={ERP_STATUS_META[detail.erpStatus]?.label ?? detail.erpStatus}
                hint={detail.erpStatus}
              />
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                平台状态 {detail.platformStatus ?? '—'}
              </span>
              {platformDivergent(detail.platformStatus, detail.erpStatus) && (
                <Tooltip title="平台侧已发货/送达，但系统内该订单尚未发货——请核实是否线下直发（可「标记外部履约」收口）或数据遗漏。">
                  <StatusBadge tone="danger" label="平台已发货，系统未发货" />
                </Tooltip>
              )}
            </div>
            <div style={{ marginBottom: 16 }}>
              <InfoGrid
                items={[
                  { label: '平台订单号', children: detail.platformOrderId },
                  { label: '内部单号', children: detail.orderNo },
                  { label: '履约模式', children: detail.fulfillmentMode ?? '—' },
                  { label: '币种', children: detail.currency ?? '—' },
                  { label: '下单时间', children: fmtDateTime(detail.orderedAt) },
                  {
                    label: '发货时限',
                    children:
                      detailDeadline === null ? (
                        '—'
                      ) : (
                        <span
                          style={{
                            color:
                              detailDeadline.tone === 'danger'
                                ? colors.danger
                                : detailDeadline.tone === 'warning'
                                  ? colors.warning
                                  : colors.textPrimary,
                            fontWeight: 600,
                          }}
                        >
                          {detailDeadline.exact}（{detailDeadline.label}）
                        </span>
                      ),
                  },
                  {
                    label: '同步来源',
                    children:
                      detail.syncSource === null
                        ? '—'
                        : detail.syncSource === 'POLLING'
                          ? '定时轮询'
                          : detail.syncSource === 'WEBHOOK'
                            ? 'Webhook'
                            : detail.syncSource === 'API'
                              ? 'API 摄入'
                              : detail.syncSource,
                  },
                  { label: '商品行', children: `${detail.items.length} 行` },
                ]}
              />
            </div>

            <Tabs
              items={[
                {
                  key: 'items',
                  label: `商品 (${detail.items.length})`,
                  children: (
                    <DataTable<OrderItem>
                      rowKey="id"
                      dataSource={detail.items}
                      pagination={false}
                      emptyTitle="无商品行"
                      columns={itemColumns}
                    />
                  ),
                },
                {
                  key: 'fulfillment',
                  label: `履约 (${detail.pickingTasks.length})`,
                  children:
                    detail.pickingTasks.length === 0 ? (
                      <span style={{ color: colors.textTertiary }}>无拣货任务</span>
                    ) : (
                      <DataTable<{
                        id: string;
                        pickingNo: string;
                        status: string;
                        pickedItems: number;
                        totalItems: number;
                      }>
                        rowKey="id"
                        dataSource={detail.pickingTasks}
                        pagination={false}
                        columns={[
                          { title: '拣货单号', dataIndex: 'pickingNo' },
                          {
                            title: '状态',
                            dataIndex: 'status',
                            width: 110,
                            render: (value: string) => (
                              <StatusBadge
                                tone={PICKING_STATUS_META[value]?.tone ?? 'neutral'}
                                label={PICKING_STATUS_META[value]?.label ?? value}
                                hint={value}
                                showDot={false}
                              />
                            ),
                          },
                          {
                            title: '进度',
                            width: 100,
                            align: 'right' as const,
                            render: (
                              _: unknown,
                              row: { pickedItems: number; totalItems: number },
                            ) => `${row.pickedItems} / ${row.totalItems}`,
                          },
                          {
                            title: '',
                            width: 110,
                            render: (_: unknown, row: { id: string }) => (
                              <Link to={`/picking/${row.id}`}>进入作业</Link>
                            ),
                          },
                        ]}
                      />
                    ),
                },
                {
                  key: 'exceptions',
                  label: `异常 (${
                    detail.items.reduce(
                      (sum, item) =>
                        sum + item.exceptions.filter((e) => e.status === 'OPEN').length,
                      0,
                    ) + detail.interceptions.length
                  })`,
                  children:
                    detail.items.every((item) => item.exceptions.length === 0) &&
                    detail.interceptions.length === 0 ? (
                      <span style={{ color: colors.textTertiary }}>无异常与拦截</span>
                    ) : (
                      <>
                        {detail.items.some((item) => item.exceptions.length > 0) && (
                          <DataTable<OrderItem>
                            rowKey="id"
                            dataSource={detail.items.filter((item) => item.exceptions.length > 0)}
                            pagination={false}
                            columns={[
                              { title: 'SKU', dataIndex: 'skuCode', width: 140 },
                              {
                                title: '异常',
                                render: (_: unknown, row: OrderItem) => (
                                  <span
                                    style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}
                                  >
                                    {row.exceptions.map((exception) => (
                                      <StatusBadge
                                        key={exception.exceptionNo}
                                        tone={exception.status === 'OPEN' ? 'danger' : 'neutral'}
                                        label={
                                          exception.status === 'OPEN'
                                            ? exception.exceptionType
                                            : `${exception.exceptionType}（已解决）`
                                        }
                                        showDot={false}
                                      />
                                    ))}
                                  </span>
                                ),
                              },
                              {
                                title: '说明',
                                render: (_: unknown, row: OrderItem) =>
                                  row.exceptions[0]?.message ?? '—',
                              },
                            ]}
                          />
                        )}
                        {detail.interceptions.length > 0 && (
                          <DataTable<{
                            interceptionNo: string;
                            status: string;
                            reason: string | null;
                            createdAt: string;
                          }>
                            rowKey="interceptionNo"
                            dataSource={detail.interceptions}
                            pagination={false}
                            columns={[
                              { title: '拦截单号', dataIndex: 'interceptionNo' },
                              {
                                title: '状态',
                                dataIndex: 'status',
                                width: 110,
                                render: (value: string) => (
                                  <StatusBadge
                                    tone={INTERCEPTION_STATUS_META[value]?.tone ?? 'neutral'}
                                    label={INTERCEPTION_STATUS_META[value]?.label ?? value}
                                    hint={value}
                                    showDot={false}
                                  />
                                ),
                              },
                              { title: '原因', dataIndex: 'reason' },
                              {
                                title: '创建时间',
                                dataIndex: 'createdAt',
                                render: (value: string) => fmtDateTime(value),
                              },
                            ]}
                          />
                        )}
                      </>
                    ),
                },
                {
                  key: 'history',
                  label: `状态历史 (${detail.history.length + (detail.platformStatusHistory?.length ?? 0)})`,
                  children: (
                    <Timeline
                      items={[
                        // Sprint 9 T1 (decision 5 = B): the ERP timeline and the
                        // raw platform timeline are stored separately and merged
                        // here by createdAt (newest first).
                        ...(detail.platformStatusHistory ?? []).map((entry) => ({
                          createdAt: entry.createdAt,
                          node: (
                            <div>
                              <span style={{ fontWeight: 600 }}>
                                {entry.fromStatus ?? '∅'} → {entry.toStatus}
                              </span>{' '}
                              <span
                                style={{
                                  fontSize: 11,
                                  color: colors.textTertiary,
                                  border: `1px solid ${colors.border}`,
                                  borderRadius: 4,
                                  padding: '0 4px',
                                }}
                              >
                                平台{entry.source ? ` · ${entry.source}` : ''}
                              </span>
                              <div style={{ color: colors.textTertiary, fontSize: 12.5 }}>
                                {fmtDateTime(entry.createdAt)} · {entry.operatorName ?? 'sync'}
                              </div>
                            </div>
                          ),
                        })),
                        ...detail.history.map((entry) => ({
                          createdAt: entry.createdAt,
                          node: (
                            <div>
                              <span style={{ fontWeight: 600 }}>
                                {ERP_STATUS_META[entry.fromStatus ?? '']?.label ??
                                  entry.fromStatus ??
                                  '∅'}{' '}
                                → {ERP_STATUS_META[entry.toStatus]?.label ?? entry.toStatus}
                              </span>
                              <div style={{ color: colors.textTertiary, fontSize: 12.5 }}>
                                {fmtDateTime(entry.createdAt)} · {entry.operatorName ?? 'system'}
                                {entry.reason ? ` · ${entry.reason}` : ''}
                              </div>
                            </div>
                          ),
                        })),
                      ]
                        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
                        .map((entry) => ({ content: entry.node }))}
                    />
                  ),
                },
                {
                  key: 'raw',
                  label: '原始数据',
                  children:
                    detail.rawData === null ? (
                      <span style={{ color: colors.textTertiary }}>无平台原始数据</span>
                    ) : (
                      <RawDataBlock data={detail.rawData} />
                    ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <Modal
        title={`登记采购：${registerItem?.skuCode ?? ''} ×${registerItem ? Number(registerItem.quantity) : ''}`}
        open={registerItem !== null}
        onCancel={() => setRegisterItem(null)}
        onOk={() => {
          void registerForm
            .validateFields()
            .then((values) => registerPurchaseMutation.mutate(values));
        }}
        okText="登记"
        cancelText="取消"
        confirmLoading={registerPurchaseMutation.isPending}
        destroyOnHidden
      >
        {/* destroyOnHidden remounts this form per open, so initialValues is
            re-read each time; setFieldsValue before mount gets lost. */}
        <Form
          form={registerForm}
          layout="vertical"
          preserve={false}
          initialValues={{ quantity: registerItem === null ? 1 : Number(registerItem.quantity) }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: colors.textTertiary,
              display: 'block',
              marginBottom: 12,
            }}
          >
            将为订单行 {registerItem?.id.slice(0, 8)}… 登记采购；同一订单行重复登记会被系统拒绝。
          </span>
          <Form.Item
            name="quantity"
            label="采购数量"
            rules={[{ required: true, message: '请输入采购数量' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unitCost" label="单位成本（可选，确认收货时计入移动平均）">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="如 59.9" />
          </Form.Item>
          <Form.Item
            name="sourceNote"
            label="货源说明（一次性网购填这里）"
            extra="如：淘宝 订单号 12345678；固定供应商请到采购单页面选择"
          >
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`标记外部履约：${externalTarget?.platformOrderId ?? ''}`}
        open={externalTarget !== null}
        onCancel={() => setExternalTarget(null)}
        onOk={() => {
          void externalForm.validateFields().then((values) =>
            markExternalMutation.mutate({
              id: (externalTarget as OrderListItem).id,
              reason: values.reason,
            }),
          );
        }}
        okText="标记并关账"
        cancelText="取消"
        confirmLoading={markExternalMutation.isPending}
        destroyOnHidden
      >
        <Form form={externalForm} layout="vertical" preserve={false}>
          <span
            style={{
              fontSize: 12.5,
              color: colors.textTertiary,
              display: 'block',
              marginBottom: 12,
            }}
          >
            适用于货物从未进入 WCIES
            仓库、在系统外完成的订单（如线下采购直发买家）。订单行将关账、订单转入
            SHIPPED，不产生任何库存流水，并关闭该订单的缺货/时限异常。存在 RESERVED / PICKED
            行的订单请走「取消订单」。
          </span>
          <Form.Item
            name="reason"
            label="外部履约原因（必填）"
            rules={[{ required: true, message: '请填写原因，如：线下采购直发买家' }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- 批量外部履约（用户指示 2026-10-14）：同一原因应用于全部勾选订单 ---- */}
      <Modal
        title={`批量标记外部履约：${eligibleExternalOrderIds.length} 个订单`}
        open={batchExternalOpen}
        onCancel={() => setBatchExternalOpen(false)}
        onOk={() => {
          void batchExternalForm
            .validateFields()
            .then((values) => {
              batchMarkExternalMutation.mutate({
                orderIds: eligibleExternalOrderIds,
                reason: values.reason,
              });
            })
            .catch(() => undefined);
        }}
        okText="标记并关账"
        cancelText="取消"
        confirmLoading={batchMarkExternalMutation.isPending}
        destroyOnHidden
      >
        <Form form={batchExternalForm} layout="vertical" preserve={false}>
          <span
            style={{
              fontSize: 12.5,
              color: colors.textTertiary,
              display: 'block',
              marginBottom: 12,
            }}
          >
            适用于货物从未进入 WCIES 仓库、在系统外完成的订单（如线下采购直发买家）。已发货 /
            已取消的订单已自动排除（勾选 {selectedOrderIds.length} 单，本次处理{' '}
            {eligibleExternalOrderIds.length} 单）；存在 RESERVED / PICKED
            行的订单会被拒绝并逐单提示原因。订单行将关账、订单转入已发货，不产生任何库存流水，并关闭相关缺货/时限异常。
          </span>
          <Form.Item
            name="reason"
            label="外部履约原因（必填，应用于全部订单）"
            rules={[{ required: true, message: '请填写原因，如：线下采购直发买家' }]}
          >
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- 视图设置（用户指示 2026-09-17） ---- */}
      <Modal
        title="视图设置"
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={
          <Button
            type="primary"
            onClick={() => {
              setViewOpen(false);
            }}
          >
            完成
          </Button>
        }
        width={720}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Checkbox
                checked={viewSettings.defaultExpandAll}
                onChange={(event) => updateViewSettings({ defaultExpandAll: event.target.checked })}
              />
              默认展开所有订单行
            </label>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              每页行数：
              <Select
                size="small"
                style={{ width: 90 }}
                value={viewSettings.pageSize}
                options={[10, 20, 50, 100].map((size) => ({ value: size, label: `${size} 行` }))}
                onChange={(value) => {
                  setPage(1);
                  updateViewSettings({ pageSize: value });
                }}
              />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              默认排序：
              <Select
                size="small"
                style={{ width: 140 }}
                value={`${viewSettings.defaultSortBy}:${viewSettings.defaultSortOrder}`}
                options={SORT_PRESETS.map((preset) => ({
                  value: preset.value,
                  label: preset.label,
                }))}
                onChange={(value) => {
                  const preset = SORT_PRESETS.find((item) => item.value === value);
                  if (preset === undefined) {
                    return;
                  }
                  setPage(1);
                  setSessionSort({ sortBy: preset.sortBy, sortOrder: preset.sortOrder });
                  updateViewSettings({
                    defaultSortBy: preset.sortBy,
                    defaultSortOrder: preset.sortOrder,
                  });
                }}
              />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              主图缩略图：
              <Select
                size="small"
                style={{ width: 90 }}
                value={viewSettings.thumbnailSize}
                options={[48, 72, 88].map((size) => ({ value: size, label: `${size}px` }))}
                onChange={(value) => updateViewSettings({ thumbnailSize: value })}
              />
            </span>
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>主表列（拖动排序，勾选显示）</div>
              <SortableColumnList
                labelFor={MAIN_COLUMN_LABELS}
                columns={viewSettings.mainColumns}
                onReorder={reorderColumns('mainColumns')}
                onToggleVisible={toggleColumnVisible('mainColumns')}
              />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                展开明细字段（勾选显示；顺序决定数值字段的排列）
              </div>
              <SortableColumnList
                labelFor={EXPANDED_COLUMN_LABELS}
                columns={viewSettings.expandedColumns}
                onReorder={reorderColumns('expandedColumns')}
                onToggleVisible={toggleColumnVisible('expandedColumns')}
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* ---- 快速建档弹窗（与 SKU映射 页面共用同一组件） ---- */}
      <ListingOnboardModal
        open={quickOnboard !== null}
        listingId={quickOnboard?.listingId ?? null}
        matchIdentifiers={quickOnboard?.match ?? null}
        onClose={() => setQuickOnboard(null)}
        onCompleted={() => {
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
          void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
          // 建档落成 MAPPED 后，后端已批量收敛该平台变体在同店铺引用的
          // 全部 FAILED 订单行（2026-10-15 bug 修复），前端不再对触发行
          // 单独 retry——行此时多已 RESERVED/缺货，再调 retry-allocation
          // 会被状态守卫 409 误报。列表/详情刷新后即可见修复结果。
        }}
        zIndex={1100}
      />

      {/* ---- SKU映射弹窗（2026-10-14，与 SKU映射 页面共用同一组件）：
          映射完成后对该订单行自动重试映射/分配，与快速建档后行为一致。 ---- */}
      <ListingVariantMapModal
        open={variantMap !== null}
        listingId={variantMap?.listingId ?? null}
        matchIdentifiers={variantMap?.match ?? null}
        onClose={() => setVariantMap(null)}
        onCompleted={() => {
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
          void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
          const itemId = variantMap?.orderItemId ?? null;
          if (itemId !== null) {
            retryMutation.mutate(itemId);
          }
        }}
        zIndex={1100}
      />
    </div>
  );
}
