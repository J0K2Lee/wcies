import { useEffect, useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Tabs,
  Timeline,
  Tooltip,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExportOutlined } from '@ant-design/icons';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { apiPost, useApiQuery } from '../../api/hooks';
import {
  ActionMenu,
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntityLink,
  EntitySummary,
  ERP_STATUS_META,
  FULFILLMENT_STATUS_META,
  FilterBar,
  InfoGrid,
  PageHeader,
  PlatformTag,
  SectionCard,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

/**
 * Orders workbench (redesign task §37-§43): status tabs with counts, dense
 * table, order context rail (risk-first: mapping failed / backordered with
 * retry) and a full detail drawer. Cancel / retry-allocation / create-picking
 * / ingest flows are the unchanged Sprint 3 business logic.
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
  createdAt: string;
  itemsCount: number;
  reservedCount: number;
  backorderedCount: number;
  pickedCount: number;
  mappingFailedCount: number;
  openExceptionsCount: number;
}

interface OrderItem {
  id: string;
  lineNo: number;
  skuCode: string;
  skuName: string;
  quantity: string;
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
  storeName: string;
  platformCode: string;
  platformOrderId: string;
  platformStatus: string | null;
  erpStatus: string;
  fulfillmentMode: string | null;
  currency: string | null;
  orderedAt: string;
  shipmentDeadline: string | null;
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

/** Status tabs (task §39) — ERP status mapping per tab. */
const STATUS_TABS: Array<{ key: string; label: string; erpStatus?: string; risk?: boolean }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待处理', erpStatus: 'NEW' },
  { key: 'picking', label: '拣货中', erpStatus: 'PICKING' },
  { key: 'ready', label: '待发货', erpStatus: 'READY_TO_PICK' },
  { key: 'shipped', label: '已发货', erpStatus: 'SHIPPED' },
  { key: 'exception', label: '异常', erpStatus: 'EXCEPTION' },
];

/** 固定 JSON Fixtures（task §66 Case A–F 的单店可复用形态） */
const FIXTURES: Array<{ label: string; json: Record<string, unknown> }> = [
  {
    label: 'Case A: 单SKU正常订单',
    json: {
      platformOrderId: 'MOCK-A-001',
      items: [{ platformSkuId: 'MOCK-SKU-A', quantity: '2' }],
    },
  },
  {
    label: 'Case B: 多SKU正常订单',
    json: {
      platformOrderId: 'MOCK-B-001',
      items: [
        { platformSkuId: 'MOCK-SKU-A', quantity: '1' },
        { platformSkuId: 'MOCK-SKU-B', quantity: '3' },
      ],
    },
  },
  {
    label: 'Case C: 一个SKU缺货',
    json: {
      platformOrderId: 'MOCK-C-001',
      items: [{ platformSkuId: 'MOCK-SKU-A', quantity: '999' }],
    },
  },
  {
    label: 'Case D: 一个Listing无法映射',
    json: {
      platformOrderId: 'MOCK-D-001',
      items: [{ platformSkuId: 'NO-SUCH-MAPPING', quantity: '1' }],
    },
  },
];

const PROCUREMENT_META: Record<string, { tone: 'danger' | 'info' | 'success'; label: string }> = {
  NOT_ORDERED: { tone: 'danger', label: '待采购' },
  ORDERED: { tone: 'info', label: '已采购' },
  ARRIVED: { tone: 'success', label: '已到货' },
};

function fmtDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
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

export function OrdersPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  const [activeTab, setActiveTab] = useState('all');
  const [storeId, setStoreId] = useState<string | undefined>();
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  const [pendingProcurement, setPendingProcurement] = useState(false);
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
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestJson, setIngestJson] = useState(
    JSON.stringify(
      { platformOrderId: 'MOCK-A-001', items: [{ platformSkuId: 'MOCK-SKU-A', quantity: '2' }] },
      null,
      2,
    ),
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

  const tabErpStatus = STATUS_TABS.find((tab) => tab.key === activeTab)?.erpStatus;
  const query = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    {
      page,
      pageSize: 20,
      ...(keyword ? { keyword } : {}),
      ...(tabErpStatus ? { erpStatus: tabErpStatus } : {}),
      ...(storeId ? { storeId } : {}),
      ...(pendingProcurement ? { pendingProcurement: 'true' } : {}),
    },
    ['orders', page, keyword, tabErpStatus, storeId, pendingProcurement],
  );

  // Tab counts: light meta.total queries for the headline tabs (task §39).
  const pendingCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 1, erpStatus: 'NEW' },
    ['orders-count-pending'],
  );
  const exceptionCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 1, erpStatus: 'EXCEPTION' },
    ['orders-count-exception'],
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
      message.success(`已标记外部履约（关账 ${result.releasedItems} 行），订单转入 SHIPPED`);
      setExternalTarget(null);
      externalForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`标记失败：${error.message}`),
  });

  /** 跳转到 SKU 映射工作台并自动搜索该行的平台标识（快捷建档入口）。 */
  const openMappingWorkbench = (item: {
    platformSkuId: string | null;
    sellerSku: string | null;
    offerId: string | null;
  }) => {
    const keyword = mappingSearchKeyword(item);
    if (keyword === null || keyword.trim() === '') {
      message.warning(
        '该订单行没有任何平台 SKU 标识（platformSkuId / sellerSku / offerId），无法自动搜索',
      );
      return;
    }
    void navigate(
      `/platform-mappings?keyword=${encodeURIComponent(keyword.trim())}&mappingState=UNMAPPED`,
    );
  };

  const retryMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiPost<{ reserved: boolean; fulfillmentStatus: string }>(
        '/api/v1/orders/items/{itemId}/retry-allocation',
        {},
        { itemId },
      ),
    onSuccess: (result: { reserved: boolean; fulfillmentStatus: string }) => {
      if (result.reserved) {
        message.success('重新分配成功，订单行已 RESERVED');
      } else if (result.fulfillmentStatus === 'BACKORDERED') {
        message.warning('映射已修复，但库存不足，订单行保持 BACKORDERED');
      } else {
        message.warning('库存仍然不足，保持 BACKORDERED');
      }
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => message.error(`重试失败：${error.message}`),
  });

  const createPickingMutation = useMutation({
    mutationFn: (orderId: string) =>
      apiPost<{ tasks: Array<{ pickingNo: string }> }>('/api/v1/picking-tasks', { orderId }),
    onSuccess: (result) => {
      message.success(`已创建拣货任务：${result.tasks.map((task) => task.pickingNo).join('、')}`);
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
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

  const ingestMutation = useMutation({
    mutationFn: (body: unknown) =>
      apiPost<{ orderNo: string; erpStatus: string; alreadyIngested: boolean }>(
        '/api/v1/orders/ingest',
        body,
      ),
    onSuccess: (result: { orderNo: string; erpStatus: string; alreadyIngested: boolean }) => {
      message.success(
        `${result.alreadyIngested ? '幂等重放' : '摄入成功'}：${result.orderNo} → ${result.erpStatus}`,
      );
      setIngestOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error: Error) => message.error(`摄入失败：${error.message}`),
  });

  const list = query.data?.data ?? [];
  const detail = detailId !== null ? detailQuery.data?.data : undefined;
  const detailDeadline = detail === undefined ? null : deadlineBadge(detail.shipmentDeadline);
  const selectedRow = useMemo(
    () => list.find((row) => row.id === selectedId) ?? null,
    [list, selectedId],
  );
  const railDetail = selectedId !== null ? detailQuery.data?.data : undefined;

  // ---- Context rail: risk-first order preview (task §41-§42) ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="订单概览">
            <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 单`} />
            <ContextMetric label="待处理（NEW）" value={pendingCount.data?.meta.total ?? 0} />
            <ContextMetric
              label={<span style={{ color: colors.danger }}>异常（EXCEPTION）</span>}
              value={exceptionCount.data?.meta.total ?? 0}
            />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击订单行快速预览风险与状态；异常订单可直接在右栏重试分配。
            </span>
          </ContextSection>
        ),
      };
    }
    const statusMeta = ERP_STATUS_META[selectedRow.erpStatus] ?? {
      tone: 'neutral' as const,
      label: selectedRow.erpStatus,
    };
    const deadline = deadlineBadge(selectedRow.shipmentDeadline);
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
          title={selectedRow.orderNo}
          subtitle={null}
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
                  平台 SKU 无法映射内部 SKU。请先在 SKU映射 中补齐该平台变体的映射，
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
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        onClick={() => openMappingWorkbench(item)}
                      >
                        去建档
                      </Button>
                      <Button
                        size="small"
                        loading={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(item.id)}
                      >
                        重试映射
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </ContextSection>
          )}
          {selectedRow.mappingFailedCount > 0 &&
            failedMappingItems.length > 0 &&
            mappingSearchKeyword(failedMappingItems[0]!) !== null && (
              // 与异常中心一致的「关联操作」入口: EntityLink 深链到映射工作台
              <ContextSection title="关联操作">
                {/* 目标是 /listings「SKU映射」工作台（快速建档所在），与异常中心
                    「前往 SKU 映射」同一深链格式；/platform-mappings 是映射总览。 */}
                <EntityLink
                  to={`/listings?keyword=${encodeURIComponent(
                    mappingSearchKeyword(failedMappingItems[0]!) ?? '',
                  )}`}
                  icon={<ExportOutlined />}
                  primary="映射失败行 · 去快捷建档"
                  secondary={`自动搜索 ${mappingSearchKeyword(failedMappingItems[0]!)}`}
                />
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
              查看完整订单
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, railDetail, retryMutation, query.data, pendingCount.data, exceptionCount.data]);
  useContextRail(railContent);

  const itemColumns = [
    { title: '#', dataIndex: 'lineNo', key: 'lineNo', width: 40 },
    {
      title: 'SKU',
      key: 'sku',
      render: (_: unknown, row: OrderItem) =>
        row.skuId === null ? (
          <StatusBadge tone="purple" label="无法映射" hint="ORDER_SKU_MAPPING_FAILED" />
        ) : (
          <div>
            <div style={{ fontWeight: 550 }}>{row.skuCode}</div>
            <div style={{ fontSize: 12.5, color: colors.textSecondary }}>{row.skuName}</div>
          </div>
        ),
    },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 70, align: 'right' as const },
    {
      title: '履约状态',
      dataIndex: 'fulfillmentStatus',
      key: 'fulfillmentStatus',
      width: 130,
      render: (value: string) => (
        <StatusBadge
          tone={FULFILLMENT_STATUS_META[value]?.tone ?? 'neutral'}
          label={FULFILLMENT_STATUS_META[value]?.label ?? value}
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
            <StatusBadge tone={meta.tone} label={meta.label} hint={value} />
            {registerable && (
              <Button
                size="small"
                type="primary"
                ghost
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
      title: '库存分配（Bin × 数量）',
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
              />
            ))}
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: unknown, row: OrderItem) => {
        // FAILED lines are retryable too: the mapping may have been repaired
        // in the SKU workbench since ingestion, and the backend re-resolves
        // the line on retry (a FAILED line has no other way out).
        const retryable =
          (row.mappingStatus === 'MAPPED' || row.mappingStatus === 'FAILED') &&
          (row.fulfillmentStatus === 'BACKORDERED' || row.fulfillmentStatus === 'PENDING');
        if (row.mappingStatus !== 'FAILED' && !retryable) {
          return null;
        }
        return (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {row.mappingStatus === 'FAILED' && (
              <Button size="small" type="primary" ghost onClick={() => openMappingWorkbench(row)}>
                去建档
              </Button>
            )}
            {retryable && (
              <Button
                size="small"
                loading={retryMutation.isPending}
                onClick={() => retryMutation.mutate(row.id)}
              >
                重新尝试分配
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  const tabLabel = (tab: (typeof STATUS_TABS)[number]): string => {
    if (tab.key === 'all') {
      return `全部 (${query.data?.meta.total ?? 0})`;
    }
    if (tab.key === 'pending') {
      return `待处理 (${pendingCount.data?.meta.total ?? 0})`;
    }
    if (tab.key === 'exception') {
      return `异常 (${exceptionCount.data?.meta.total ?? 0})`;
    }
    return tab.label;
  };

  return (
    <div>
      <PageHeader
        title="订单管理"
        description="统一管理各平台订单及内部履约状态"
        primary={
          <Button type="primary" onClick={() => setIngestOpen(true)}>
            摄入测试订单
          </Button>
        }
        extra={
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setPage(1);
              setActiveTab(key);
            }}
            items={STATUS_TABS.map((tab) => ({ key: tab.key, label: tabLabel(tab) }))}
          />
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="订单号 / 平台订单号"
          allowClear
          defaultValue={keyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索订单"
        />
        <Button
          type={pendingProcurement ? 'primary' : 'default'}
          danger={!pendingProcurement}
          ghost={pendingProcurement}
          onClick={() => {
            setPage(1);
            setPendingProcurement((value) => !value);
          }}
        >
          待采购
        </Button>
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
            setPlatformFilter(value);
            setStoreId(undefined);
            setPage(1);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<OrderListItem>
          rowKey="id"
          loading={query.isLoading}
          dataSource={list}
          pagination={{
            current: page,
            pageSize: 20,
            total: query.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 单`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无订单"
          emptyDescription="当前筛选下没有订单，可摄入测试订单验证流程。"
          columns={[
            { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 130 },
            {
              title: '平台 / 店铺',
              key: 'platform',
              width: 190,
              render: (_: unknown, row: OrderListItem) => (
                <PlatformTag code={row.platformCode} suffix={row.storeName} />
              ),
            },
            {
              title: '商品',
              key: 'items',
              width: 170,
              render: (_: unknown, row: OrderListItem) => {
                if (row.mappingFailedCount > 0) {
                  return (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span>{row.itemsCount} 行</span>
                      <StatusBadge tone="purple" label={`映射失败 ${row.mappingFailedCount}`} />
                    </span>
                  );
                }
                return (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <span>{row.itemsCount} 行</span>
                    {row.backorderedCount > 0 && (
                      <StatusBadge tone="warning" label={`缺货 ${row.backorderedCount}`} />
                    )}
                    {row.reservedCount > 0 && (
                      <StatusBadge
                        tone="info"
                        label={`Reserved ${row.reservedCount}`}
                        showDot={false}
                      />
                    )}
                  </span>
                );
              },
            },
            {
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
                    <span style={{ fontSize: 12, color: colors.danger, fontWeight: 600 }}>
                      ×{row.openExceptionsCount}
                    </span>
                  )}
                  {platformDivergent(row.platformStatus, value) && (
                    <Tooltip
                      title={`平台状态 ${row.platformStatus}：平台侧已发货/送达，系统未发货`}
                    >
                      <span style={{ fontSize: 12, color: colors.warning, fontWeight: 600 }}>
                        ⚠
                      </span>
                    </Tooltip>
                  )}
                </span>
              ),
            },
            {
              title: '时限',
              dataIndex: 'shipmentDeadline',
              key: 'shipmentDeadline',
              width: 130,
              render: (value: string | null) => {
                const badge = deadlineBadge(value);
                return badge === null ? (
                  '—'
                ) : (
                  <StatusBadge tone={badge.tone} label={badge.label} hint={badge.exact} />
                );
              },
            },
            {
              title: '下单时间',
              dataIndex: 'orderedAt',
              key: 'orderedAt',
              width: 150,
              render: (value: string) => fmtDateTime(value),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              fixed: 'right',
              render: (_: unknown, row: OrderListItem) => (
                <ActionMenu
                  primary={
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4 }}
                      onClick={() => setDetailId(row.id)}
                    >
                      查看
                    </Button>
                  }
                  items={[
                    {
                      key: 'view',
                      label: '查看详情',
                      onClick: () => setDetailId(row.id),
                    },
                    ...(row.erpStatus !== 'CANCELLED'
                      ? [
                          {
                            key: 'cancel',
                            label: '取消订单',
                            danger: true,
                            onClick: () => {
                              modal.confirm({
                                title: `取消订单 ${row.orderNo}？`,
                                content:
                                  'Reserved 行将释放库存；Picked 行将创建拦截任务（不自动恢复库存）。',
                                okText: '取消订单',
                                cancelText: '返回',
                                onOk: () => {
                                  cancelMutation.mutate(row.id);
                                },
                              });
                            },
                          },
                        ]
                      : []),
                    ...(row.erpStatus !== 'CANCELLED' && row.erpStatus !== 'SHIPPED'
                      ? [
                          {
                            key: 'mark-external',
                            label: '标记外部履约',
                            onClick: () => {
                              setExternalTarget(row);
                              externalForm.setFieldsValue({ reason: '' });
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              ),
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={880}
        title={
          detail !== undefined && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>{detail.orderNo}</span>
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
            <div style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                loading={createPickingMutation.isPending}
                disabled={
                  detail.erpStatus === 'CANCELLED' ||
                  !detail.items.some((item) => item.fulfillmentStatus === 'RESERVED')
                }
                onClick={() => createPickingMutation.mutate(detail.id)}
              >
                创建拣货任务
              </Button>
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
                          { title: '状态', dataIndex: 'status', width: 110 },
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
                              { title: '状态', dataIndex: 'status', width: 110 },
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
                  label: 'Raw Data',
                  children:
                    detail.rawData === null ? (
                      <span style={{ color: colors.textTertiary }}>无平台原始数据</span>
                    ) : (
                      <pre
                        style={{
                          maxHeight: 420,
                          overflow: 'auto',
                          fontSize: 12,
                          background: '#F8F9FB',
                          padding: 12,
                          borderRadius: 8,
                        }}
                      >
                        {JSON.stringify(detail.rawData, null, 2)}
                      </pre>
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
        title={`标记外部履约：${externalTarget?.orderNo ?? ''}`}
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
            仓库、在系统外完成的订单（如线下采购直发买家）。订单行将关账（RELEASED）、订单转入
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

      <Modal
        title="摄入测试订单（NormalizedOrderInput，管理员）"
        open={ingestOpen}
        onCancel={() => setIngestOpen(false)}
        onOk={() => {
          try {
            const body = JSON.parse(ingestJson) as Record<string, unknown>;
            if (body.storeId === undefined) {
              const firstStore = storesQuery.data?.data[0];
              if (firstStore === undefined) {
                message.error('没有可用店铺，请在 JSON 中显式指定 storeId');
                return;
              }
              body.storeId = firstStore.id;
            }
            if (body.orderedAt === undefined) {
              body.orderedAt = new Date().toISOString();
            }
            ingestMutation.mutate(body);
          } catch {
            message.error('JSON 格式错误');
          }
        }}
        okText="摄入"
        cancelText="关闭"
        width={640}
        confirmLoading={ingestMutation.isPending}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {FIXTURES.map((fixture) => (
              <Button
                key={fixture.label}
                size="small"
                onClick={() => setIngestJson(JSON.stringify(fixture.json, null, 2))}
              >
                {fixture.label}
              </Button>
            ))}
          </div>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            storeId 默认取第一个店铺；items 行使用平台 SKU 标识（platformSkuId / sellerSku /
            offerId）。
          </span>
          <Input.TextArea
            rows={10}
            value={ingestJson}
            onChange={(event) => setIngestJson(event.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
