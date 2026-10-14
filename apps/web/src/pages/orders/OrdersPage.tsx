import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Select,
  Tabs,
  Timeline,
  Tooltip,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { apiGet, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import { buildOzonProductUrl, buildPlatformProductUrl } from '../../utils/platformUrl';
import { ListingOnboardModal, OnboardMatchIdentifiers } from '../../components/ListingOnboardModal';
import {
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
  PageHeader,
  PICKING_STATUS_META,
  PlatformTag,
  RailHint,
  RawDataBlock,
  INTERCEPTION_STATUS_META,
  SectionCard,
  StatusBadge,
  colors,
  RelativeTime,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

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
  erpStatus: string;
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
  erpStatus: string;
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
  { key: 'inTransit', label: '待收货', stage: 'IN_TRANSIT' },
  { key: 'completed', label: '已完成', stage: 'COMPLETED' },
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
    tooltip: '已过平台发货时限且订单未发完（含部分发货剩余行未出）',
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

interface ColumnSetting {
  key: string;
  visible: boolean;
}

interface OrdersViewSettings {
  /** 默认展开所有订单行。 */
  defaultExpandAll: boolean;
  /** 每页显示的订单行数。 */
  pageSize: number;
  /** 展开行主图缩略图边长（px，方形不裁剪）。 */
  thumbnailSize: number;
  /** 主表列（数组顺序即显示顺序）。 */
  mainColumns: ColumnSetting[];
  /** 展开行列（数组顺序即显示顺序）。 */
  expandedColumns: ColumnSetting[];
}

const VIEW_SETTINGS_KEY = 'wcies.orders.view.v1';

const DEFAULT_VIEW_SETTINGS: OrdersViewSettings = {
  defaultExpandAll: false,
  pageSize: 20,
  thumbnailSize: 48,
  mainColumns: [
    { key: 'platformOrderId', visible: true },
    { key: 'items', visible: true },
    { key: 'erpStatus', visible: true },
    { key: 'store', visible: true },
    { key: 'fulfillmentMode', visible: true },
    { key: 'shipmentDeadline', visible: true },
    { key: 'orderedAt', visible: true },
    // 平台运单号是「获取运单号」的结果，默认放到列设置里由用户开启，
    // 避免默认视图多出大量空列（未组包订单本来就没有运单号）。
    { key: 'platformTrackingNo', visible: false },
  ],
  expandedColumns: [
    { key: 'image', visible: true },
    { key: 'sku', visible: true },
    { key: 'offerId', visible: true },
    { key: 'quantity', visible: true },
    { key: 'unitPrice', visible: true },
    { key: 'totalPrice', visible: true },
    { key: 'latestPurchasePrice', visible: true },
    { key: 'fulfillmentStatus', visible: true },
  ],
};

function loadViewSettings(): OrdersViewSettings {
  try {
    const raw = localStorage.getItem(VIEW_SETTINGS_KEY);
    if (raw === null) {
      return DEFAULT_VIEW_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<OrdersViewSettings>;
    return {
      ...DEFAULT_VIEW_SETTINGS,
      ...parsed,
      // 前向兼容：新增列自动出现在尾部。
      mainColumns:
        parsed.mainColumns === undefined
          ? DEFAULT_VIEW_SETTINGS.mainColumns
          : [
              ...parsed.mainColumns,
              ...DEFAULT_VIEW_SETTINGS.mainColumns.filter(
                (column) => !parsed.mainColumns?.some((existing) => existing.key === column.key),
              ),
            ],
      expandedColumns:
        parsed.expandedColumns === undefined
          ? DEFAULT_VIEW_SETTINGS.expandedColumns
          : [
              ...parsed.expandedColumns,
              ...DEFAULT_VIEW_SETTINGS.expandedColumns.filter(
                (column) =>
                  !parsed.expandedColumns?.some((existing) => existing.key === column.key),
              ),
            ],
    };
  } catch {
    return DEFAULT_VIEW_SETTINGS;
  }
}

const MAIN_COLUMN_LABELS: Record<string, string> = {
  platformOrderId: '订单号',
  items: '商品',
  erpStatus: 'ERP 状态',
  store: '店铺',
  fulfillmentMode: '履约方式',
  shipmentDeadline: '时限',
  orderedAt: '下单时间',
};

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

/** 强匹配标识：订单解析只认 platform_sku_id（决策 0016），其次 seller_sku /
 *  offer_id——与映射工作台 keyword 搜索的字段一一对应。 */
function mappingSearchKeyword(item: {
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
}): string | null {
  return item.platformSkuId ?? item.sellerSku ?? item.offerId;
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
 */
function deadlineBadgeFor(
  deadline: string | null,
  erpStatus: string,
): ReturnType<typeof deadlineBadge> {
  if (deadline === null || erpStatus === 'CANCELLED') {
    return null;
  }
  const badge = deadlineBadge(deadline);
  if (erpStatus === 'SHIPPED') {
    return { tone: 'neutral', label: '已发货', exact: badge === null ? '' : badge.exact };
  }
  return badge;
}

/**
 * 展开行内容（用户指示 2026-09-18 bug 修复）：每个展开行自带订单详情查询
 * ——与右栏/抽屉共用同一 `['order-detail', orderId]` 缓存键，互不重复请求。
 * 此前展开内容依赖「当前选中订单」的详情，「默认展开所有订单行」开启时
 * 未选中任何行导致全部显示「暂无商品明细」。
 */
function ExpandedOrderItems({
  order,
  columns,
  selectedItem,
  onItemRowClick,
}: {
  order: OrderListItem;
  columns: Array<ColumnsType<OrderItem>[number]>;
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
  return (
    <Image.PreviewGroup>
      <DataTable<OrderItem>
        size="small"
        rowKey="id"
        dataSource={detail.items}
        pagination={false}
        emptyTitle="无商品行"
        columns={columns}
        onRow={(item) => ({
          // 点击展开行 → 侧边栏显示该 SKU 信息（用户指示 2026-09-17）；
          // 同时选中所属订单，供右栏详情查询使用。
          onClick: () => onItemRowClick(item),
          style: {
            cursor: 'pointer',
            background: selectedItem?.id === item.id ? colors.primarySoft : undefined,
          },
        })}
      />
    </Image.PreviewGroup>
  );
}

export function OrdersPage() {
  const { message, modal, notification } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
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
  const query = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    {
      page,
      pageSize: viewSettings.pageSize,
      ...(keyword ? { keyword } : {}),
      // 平台筛选是真实 API 过滤（用户反馈 2026-09-28：此前只过滤店铺下拉，
      // 列表纹丝不动，出现“选着 YANDEX 却显示 OZON 订单”）。
      ...(platformFilter ? { platform: platformFilter } : {}),
      ...(stageOfActiveTab ? { stage: stageOfActiveTab } : {}),
      ...(goodsState ? { goodsState } : {}),
      ...(storeId ? { storeId } : {}),
      ...(fulfillmentModeFilter ? { fulfillmentMode: fulfillmentModeFilter } : {}),
    },
    [
      'orders',
      page,
      keyword,
      platformFilter,
      stageOfActiveTab,
      goodsState,
      storeId,
      fulfillmentModeFilter,
    ],
  );

  // Tab counts: light meta.total queries, one per stage tab, ALL carrying the
  // current store/keyword filters so the counts and the list never disagree
  // (acceptance §2; the old counters ignored every filter).
  const countFilters = {
    page: 1,
    pageSize: 1,
    ...(keyword ? { keyword } : {}),
    ...(platformFilter ? { platform: platformFilter } : {}),
    ...(storeId ? { storeId } : {}),
  } as Record<string, unknown>;
  const allCount = useApiQuery<Envelope<OrderListItem[]>>('/api/v1/orders', countFilters, [
    'orders-count',
    'ALL',
    keyword,
    platformFilter,
    storeId,
  ]);
  const pendingCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'PENDING' },
    ['orders-count', 'PENDING', keyword, platformFilter, storeId],
  );
  const inTransitCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'IN_TRANSIT' },
    ['orders-count', 'IN_TRANSIT', keyword, platformFilter, storeId],
  );
  const completedCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { ...countFilters, stage: 'COMPLETED' },
    ['orders-count', 'COMPLETED', keyword, platformFilter, storeId],
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
  const shippingLabelMutation = useMutation({
    mutationFn: ({ id, refresh }: { id: string; refresh: boolean }) =>
      apiPost<{ id: string; fileName: string; signedUrl: string }>(
        '/api/v1/orders/{id}/shipping-label',
        {},
        { id },
        refresh ? { refresh: 'true' } : undefined,
      ),
    onSuccess: (label: { fileName: string; signedUrl: string }) => {
      message.success(`面单已就绪（${label.fileName}），已在新标签页打开，可直接打印`);
      window.open(label.signedUrl, '_blank', 'noopener');
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

  // 自动创建拣货任务（2026-09-18 用户指示）：为当前筛选店铺下所有「待拣货」
  // 订单批量生成拣货单；已有进行中任务的订单由后端跳过（幂等）。
  const autoCreatePickingMutation = useMutation({
    mutationFn: (filterStoreId: string | undefined) =>
      apiPost<{
        candidates: number;
        created: number;
        skipped: number;
        failed: number;
        createdTaskNos: string[];
        failures: Array<{ orderNo: string; code: string; message: string }>;
      }>('/api/v1/picking-tasks/auto-create', {
        ...(filterStoreId !== undefined && filterStoreId !== '' ? { storeId: filterStoreId } : {}),
        limit: 100,
      }),
    onSuccess: (result) => {
      const parts = [`新建 ${result.created} 个任务`];
      if (result.skipped > 0) {
        parts.push(`跳过 ${result.skipped}（已有进行中任务）`);
      }
      if (result.failed > 0) {
        parts.push(`失败 ${result.failed}`);
      }
      message.success(`自动创建拣货任务：${parts.join('，')}`);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`自动创建失败：${error.message}`),
  });

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

  const list = query.data?.data ?? [];
  const detail = detailId !== null ? detailQuery.data?.data : undefined;
  const detailDeadline =
    detail === undefined ? null : deadlineBadgeFor(detail.shipmentDeadline, detail.erpStatus);
  const selectedRow = useMemo(
    () => list.find((row) => row.id === selectedId) ?? null,
    [list, selectedId],
  );
  const railDetail = selectedId !== null ? detailQuery.data?.data : undefined;

  /**
   * 展开行列注册表（用户指示 2026-09-17）：主图方形不裁剪、新增最近采购价；
   * 列的显示顺序/显隐由视图设置驱动。数据复用右栏已共享的 detail 查询
   * （§68），展开不产生额外请求。
   */
  const expandedCurrency = detail !== undefined ? detail.currency : (railDetail?.currency ?? null);
  const expandedColumnDefs = useMemo<Record<string, ColumnsType<OrderItem>[number]>>(
    () => ({
      image: {
        title: '主图',
        key: 'image',
        width: viewSettings.thumbnailSize + 20,
        render: (_: unknown, row: OrderItem) =>
          row.imageUrl === null ? (
            <div
              style={{
                width: viewSettings.thumbnailSize,
                height: viewSettings.thumbnailSize,
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
                  width={viewSettings.thumbnailSize}
                  height={viewSettings.thumbnailSize}
                  style={{
                    objectFit: 'contain',
                    borderRadius: 6,
                    background: colors.neutralBg,
                    cursor: 'zoom-in',
                  }}
                />
              </span>
            </Tooltip>
          ),
      },
      sku: {
        title: 'SKU',
        key: 'sku',
        render: (_: unknown, row: OrderItem) =>
          row.skuId === null ? (
            <div>
              <StatusBadge
                tone="purple"
                label="无法映射"
                hint="缺少 SKU 映射，去 SKU 映射补齐后重试"
                showDot={false}
              />
              <div style={{ fontSize: 12, color: colors.textTertiary, marginTop: 2 }}>
                {row.platformSkuId ?? row.sellerSku ?? `第 ${row.lineNo} 行`}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 550 }}>{row.skuCode}</div>
              <div style={{ fontSize: 12.5, color: colors.textSecondary }}>{row.skuName}</div>
            </div>
          ),
      },
      offerId: {
        title: 'Offer ID',
        key: 'offerId',
        width: 170,
        render: (_: unknown, row: OrderItem) => (
          <span style={{ fontSize: 12.5, wordBreak: 'break-all' as const }}>
            {row.offerId ?? '—'}
          </span>
        ),
      },
      quantity: {
        title: '数量',
        dataIndex: 'quantity',
        key: 'quantity',
        width: 70,
        align: 'right' as const,
        render: (value: string) => Number(value),
      },
      unitPrice: {
        title: '单价',
        dataIndex: 'unitPrice',
        key: 'unitPrice',
        width: 110,
        align: 'right' as const,
        render: (value: string | null) => fmtMoney(value, expandedCurrency),
      },
      totalPrice: {
        title: '小计',
        dataIndex: 'totalPrice',
        key: 'totalPrice',
        width: 110,
        align: 'right' as const,
        render: (value: string | null) => fmtMoney(value, expandedCurrency),
      },
      latestPurchasePrice: {
        title: '最近采购价',
        dataIndex: 'latestPurchasePrice',
        key: 'latestPurchasePrice',
        width: 110,
        align: 'right' as const,
        render: (value: string | null, row: OrderItem) =>
          value === null ? (
            <span style={{ color: colors.textTertiary }}>—</span>
          ) : (
            <Tooltip title={`SKU 主数据维护值（当前行数 ×${Number(row.quantity)}）`}>
              <span style={{ fontSize: 12.5 }}>{fmtMoney(value, expandedCurrency)}</span>
            </Tooltip>
          ),
      },
      fulfillmentStatus: {
        title: '履约状态',
        dataIndex: 'fulfillmentStatus',
        key: 'fulfillmentStatus',
        width: 110,
        render: (value: string) => (
          <StatusBadge
            tone={FULFILLMENT_STATUS_META[value]?.tone ?? 'neutral'}
            label={FULFILLMENT_STATUS_META[value]?.label ?? value}
            showDot={false}
          />
        ),
      },
    }),
    [expandedCurrency, viewSettings.thumbnailSize],
  );

  const expandedColumns = useMemo(
    () =>
      viewSettings.expandedColumns
        .filter((column) => column.visible)
        .map((column) => expandedColumnDefs[column.key])
        .filter((column) => column !== undefined),
    [viewSettings.expandedColumns, expandedColumnDefs],
  );

  /** 快速建档：按订单行标识反查商品链接（storeId 来自列表行，单击选中即有）。 */
  const openQuickOnboard = useCallback(
    (item: OrderItem, storeId: string) => {
      const keyword = mappingSearchKeyword(item);
      if (keyword === null || keyword.trim() === '') {
        void message.warning(
          '该订单行没有任何平台 SKU 标识（platformSkuId / sellerSku / offerId），无法定位',
        );
        return;
      }
      setOnboardLookupPending(true);
      apiGet<Array<{ id: string }>>('/api/v1/listings', {
        storeId,
        keyword: keyword.trim(),
        mappingState: 'UNMAPPED',
        page: 1,
        pageSize: 5,
      })
        .then((result) => {
          const listing = result.data[0];
          if (listing === undefined) {
            void message.warning(
              '未在本店铺找到该平台标识对应的未映射商品链接：请确认该变体已同步到本地',
            );
            return;
          }
          setQuickOnboard({
            listingId: listing.id,
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
    [message],
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
      const procurementMeta =
        selectedItem.procurementState === null
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
              <Button
                block
                type="primary"
                disabled={
                  selectedItem.skuId === null ||
                  selectedItem.procurementState === 'ORDERED' ||
                  selectedItem.procurementState === 'ARRIVED'
                }
                onClick={() => setRegisterItem(selectedItem)}
              >
                创建采购单
              </Button>
              {selectedItem.skuId !== null && selectedItem.procurementState !== null && (
                <RailHint>
                  {selectedItem.procurementState === 'NOT_ORDERED'
                    ? '为该订单行登记采购；同一订单行重复登记会被系统拒绝。'
                    : '该行已有进行中/已到货的采购，不能重复登记。'}
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
          <>
            <ContextSection title="订单概览">
              <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 单`} />
              <ContextMetric label="待处理" value={pendingCount.data?.meta.total ?? 0} />
              <ContextMetric label="待收货" value={inTransitCount.data?.meta.total ?? 0} />
              <ContextMetric label="已完成" value={completedCount.data?.meta.total ?? 0} />
              <RailHint>
                点击订单行快速预览风险与状态；缺货订单可在右栏重试分配或登记采购。
              </RailHint>
            </ContextSection>
            <ContextAction>
              <Button
                block
                type="primary"
                loading={autoCreatePickingMutation.isPending}
                onClick={() => autoCreatePickingMutation.mutate(storeId)}
              >
                自动创建拣货任务
              </Button>
              <RailHint>
                为当前店铺筛选下所有「待拣货」订单批量生成拣货单；已有进行中任务的订单自动跳过。
              </RailHint>
            </ContextAction>
          </>
        ),
      };
    }
    const statusMeta = ERP_STATUS_META[selectedRow.erpStatus] ?? {
      tone: 'neutral' as const,
      label: selectedRow.erpStatus,
    };
    const deadline = deadlineBadgeFor(selectedRow.shipmentDeadline, selectedRow.erpStatus);
    // 发货流程按钮显隐（2026-09-18）。能力来自后端的能力位——前端不判断平台，
    // 后端也不靠平台名硬编码：没接入发货能力的平台这两个按钮就不出现。
    const canPrepareShipment =
      (railDetail?.platformCapabilities.prepareShipment ?? false) &&
      selectedRow.erpStatus !== 'SHIPPED' &&
      selectedRow.erpStatus !== 'CANCELLED';
    // 平台面单要有平台运单号才打得出来（OZON 仅在组包后分配运单号）；
    // 已存档面单也保留入口，方便重复打印。
    const canPrintLabel =
      (railDetail?.platformCapabilities.fetchShippingLabel ?? false) &&
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
          {/* 发货流程（2026-09-18）：运单号与面单都是平台事实，直接展示；
              仓库内部出库仍在「发货」按钮里走既有阶梯。
              分区位置遵循 UI 规范 §4.2：概要（订单概况 / 发货物流）→ 风险 → 操作区。 */}
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
            <ContextSection title="最近状态">
              <Timeline
                items={railDetail.history.slice(0, 4).map((entry) => ({
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
          )}
          <ContextAction>
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
            {/* 快速建档 = 修复类次操作（§3.1 primary 语义是"推进动作"，且每视图
                ≤1；与创建拣货任务/发货并存时降级为 default，避免双 primary）。 */}
            {failedMappingItems.length > 0 &&
              mappingSearchKeyword(failedMappingItems[0]!) !== null && (
                <Button
                  block
                  style={{ marginTop: 8 }}
                  loading={onboardLookupPending}
                  onClick={() => openQuickOnboard(failedMappingItems[0]!, selectedRow.storeId)}
                >
                  快速建档
                </Button>
              )}
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
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedItem,
    selectedRow,
    railDetail,
    retryMutation.isPending,
    createPickingMutation.isPending,
    autoCreatePickingMutation.isPending,
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
    storeId,
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
        if (value === null) {
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
      width: 170,
      render: (_: unknown, row: OrderListItem) => (
        <div>
          <div style={{ fontWeight: 550, wordBreak: 'break-all' }}>{row.platformOrderId}</div>
          <div style={{ fontSize: 12, color: colors.textTertiary }}>{row.orderNo}</div>
        </div>
      ),
    },
    items: {
      title: '商品',
      key: 'items',
      width: 170,
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
        return (
          <span
            style={{
              display: 'inline-flex',
              gap: 6,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span>{row.itemsCount} 行</span>
            {row.backorderedCount > 0 && (
              <StatusBadge tone="warning" label={`缺货 ${row.backorderedCount}`} />
            )}
            {row.backorderedOrderedCount > 0 && (
              <Tooltip title={`缺货行中已登记采购 ${row.backorderedOrderedCount} 行（采购未到货）`}>
                <StatusBadge
                  tone="info"
                  label={`已采购 ${row.backorderedOrderedCount}`}
                  showDot={false}
                />
              </Tooltip>
            )}
            {row.backorderedArrivedCount > 0 && (
              <Tooltip
                title={`缺货行中采购已到货 ${row.backorderedArrivedCount} 行，可「重新尝试分配」`}
              >
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
                    已到货 {row.backorderedArrivedCount}
                  </Button>
                ) : (
                  <StatusBadge
                    tone="success"
                    label={`已到货 ${row.backorderedArrivedCount}`}
                    hint="请先展开订单加载明细，再点击重新分配"
                    showDot={false}
                  />
                )}
              </Tooltip>
            )}
            {row.reservedCount > 0 && (
              <StatusBadge tone="info" label={`已占用 ${row.reservedCount}`} showDot={false} />
            )}
          </span>
        );
      },
    },
    erpStatus: {
      title: 'ERP 状态',
      dataIndex: 'erpStatus',
      key: 'erpStatus',
      width: 130,
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
    store: {
      title: '店铺',
      key: 'store',
      width: 190,
      render: (_: unknown, row: OrderListItem) => (
        <PlatformTag code={row.platformCode} suffix={row.storeName} />
      ),
    },
    fulfillmentMode: {
      title: '履约方式',
      key: 'fulfillmentMode',
      width: 100,
      render: (_: unknown, row: OrderListItem) => {
        const mode = fulfillmentModeChip(row.fulfillmentMode);
        return mode === null ? (
          '—'
        ) : (
          <StatusBadge tone="neutral" label={mode.short} hint={mode.hint} showDot={false} />
        );
      },
    },
    shipmentDeadline: {
      title: '时限',
      dataIndex: 'shipmentDeadline',
      key: 'shipmentDeadline',
      width: 130,
      render: (value: string | null, row: OrderListItem) => {
        const badge = deadlineBadgeFor(value, row.erpStatus);
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
      render: (value: string | null) => value ?? '—',
    },
    orderedAt: {
      title: '下单时间',
      dataIndex: 'orderedAt',
      key: 'orderedAt',
      width: 150,
      render: (value: string) => <RelativeTime value={value} />,
    },
  };

  const mainColumns = viewSettings.mainColumns
    .filter((column) => column.visible)
    .map((column) => mainColumnDefs[column.key])
    .filter((column) => column !== undefined);

  /** 默认展开所有订单行（视图设置）时整页展开，点击仅选中（侧边栏）。 */
  const expandedRowKeys = useMemo(() => {
    if (viewSettings.defaultExpandAll) {
      const ids = list.map((row) => row.id);
      return selectedId === null ? ids : [...new Set([...ids, selectedId])];
    }
    return selectedId === null ? [] : [selectedId];
  }, [viewSettings.defaultExpandAll, list, selectedId]);

  const stageCountOf = (tabKey: string): number => {
    if (tabKey === 'all') {
      return allCount.data?.meta.total ?? 0;
    }
    if (tabKey === 'pending') {
      return pendingCount.data?.meta.total ?? 0;
    }
    if (tabKey === 'inTransit') {
      return inTransitCount.data?.meta.total ?? 0;
    }
    return completedCount.data?.meta.total ?? 0;
  };

  return (
    <div>
      <PageHeader
        title="订单管理"
        description="统一管理各平台订单及内部履约状态"
        secondary={<Button onClick={() => setViewOpen(true)}>视图设置</Button>}
        extra={
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
          human attention. Tooltips state the exact backend predicate. */}
      <div style={{ marginBottom: 12 }}>
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
      </div>

      <SectionCard flush>
        <DataTable<OrderListItem>
          rowKey="id"
          loading={query.isLoading}
          dataSource={list}
          pagination={{
            current: page,
            pageSize: viewSettings.pageSize,
            total: query.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 单`,
            onChange: setPage,
          }}
          expandable={{
            // 选中即展开（用户指示 2026-09-17）：行点击选择驱动展开/收起，
            // 不显示独立展开列；内容复用 railDetail（已缓存详情）。
            // 视图设置「默认展开所有订单行」时整页展开，点击仅选中（侧边栏）。
            expandedRowKeys: expandedRowKeys,
            showExpandColumn: false,
            expandedRowRender: (record: OrderListItem) => (
              <div onClick={(event) => event.stopPropagation()}>
                <ExpandedOrderItems
                  order={record}
                  columns={expandedColumns}
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
          onRow={(record) => ({
            onClick: () => {
              setSelectedItemId(null);
              setSelectedId(record.id === selectedId ? null : record.id);
            },
            onDoubleClick: () => setDetailId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无订单"
          emptyDescription="当前筛选下没有订单；新订单由平台同步自动进入系统。"
          columns={mainColumns}
        />
      </SectionCard>

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
              主图缩略图：
              <Select
                size="small"
                style={{ width: 90 }}
                value={viewSettings.thumbnailSize}
                options={[48, 64, 88].map((size) => ({ value: size, label: `${size}px` }))}
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
              <div style={{ fontWeight: 600, marginBottom: 8 }}>展开行列（拖动排序，勾选显示）</div>
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
          // 建档已把 platform_listing_skus 落成 MAPPED：立即对触发行的订单行
          // 重试映射/分配，不再要求操作员手动点「重试映射」（2026-10-09）。
          // 结果提示由 retryMutation 的 onSuccess/onError 给出。
          const itemId = quickOnboard?.orderItemId ?? null;
          if (itemId !== null) {
            retryMutation.mutate(itemId);
          } else {
            void message.info('已建档并映射：请点「重试映射」重新分配库存');
          }
        }}
        zIndex={1100}
      />
    </div>
  );
}
