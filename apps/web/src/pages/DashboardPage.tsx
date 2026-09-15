import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Button, Skeleton } from 'antd';
import {
  AlertOutlined,
  CloudSyncOutlined,
  ShopOutlined,
  TransactionOutlined,
} from '@ant-design/icons';
import {
  colors,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  KpiRow,
  MetricCard,
  PageHeader,
  PlatformTag,
  RelativeTime,
  SectionCard,
  StatusBadge,
  SYNC_STATUS_META,
  SyncStatusBadge,
  TrendChart,
  TrendPoint,
  useContextRail,
} from '../design-system';
import { useApiQuery } from '../api/hooks';
import { fmtNumber } from '../utils/format';

/**
 * Dashboard — 运营看板 (operations board).
 *
 * Every number on this page comes from a real list API (meta.total or rows
 * actually returned); nothing is fabricated. Structure:
 *   1. KPI row: 待处理订单 (orders erpStatus=NEW total) / 待处理异常
 *      (exceptions status=OPEN total) / 同步失败任务 (FAILED jobs within the
 *      latest sync-jobs page) / 凭证未配置的活跃店铺 (active stores without
 *      credentials, derived from the stores list).
 *   2. 运营待办: top OPEN exceptions + active stores missing credentials.
 *   3. 订单趋势: daily buckets aggregated from the latest 100 orders.
 *   4. 同步异常流: FAILED / PARTIAL jobs from the latest sync-jobs page.
 * Context rail: 同步异常 + 库存预警 (inventory OUT_OF_STOCK rows).
 */

interface OrderListItem {
  id: string;
  orderedAt: string;
}

interface StoreRow {
  id: string;
  name: string;
  storeCode: string;
  platformCode: string;
  status: string;
  credentialConfigured: boolean;
}

interface SyncJobItem {
  id: string;
  storeCode: string;
  storeName: string;
  platformCode: string;
  syncType: string;
  status: string;
  successCount: number;
  failedCount: number;
  errorMessage: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface ExceptionItem {
  id: string;
  exceptionNo: string;
  exceptionType: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
}

interface InventoryRow {
  id: string;
  skuCode: string;
  warehouseCode: string;
  sellableAvailableQty: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

/** Exception type → label (backend enum values only; raw value as fallback). */
const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  ORDER_SKU_MAPPING_FAILED: 'SKU 映射失败',
  ORDER_OUT_OF_STOCK: '订单缺货',
  ORDER_INVALID_STATE: '订单状态异常',
  ORDER_INTERCEPTION_FAILED: '拦截失败',
  ORDER_SHIPMENT_DEADLINE_NEAR: '发货时限临近',
  SYNC_FAILED: '同步失败',
  ORDER_TRACKING_STALLED: '物流停滞',
  ORDER_CANCELLED_AFTER_SHIP: '已发货被平台取消',
  RETURN_ORDER_NOT_FOUND: '退货订单未找到',
  RETURN_DIFFERENCE: '退货差异',
};

/** Sync job type → label. */
const SYNC_TYPE_LABEL: Record<string, string> = {
  ORDER_SYNC: '订单同步',
  LISTING_SYNC: '商品同步',
};

function severityTone(severity: string): 'danger' | 'warning' | 'neutral' {
  if (severity === 'HIGH') {
    return 'danger';
  }
  if (severity === 'MEDIUM') {
    return 'warning';
  }
  return 'neutral';
}

function fmtDate(date: Date): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 星期${weekdays[date.getDay()]}`;
}

const TODO_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 0',
  cursor: 'pointer',
  borderBottom: `1px solid ${colors.borderSoft}`,
};

export function DashboardPage() {
  const navigate = useNavigate();

  // ---- Data: real list APIs only (queryKey[0] = entity, shared prefix) ----
  // 待处理 uses the dual-axis stage filter (orders.md §17a): everything not
  // yet SHIPPED/CANCELLED - backordered and divergent orders included. The
  // old erpStatus=NEW count was always 0 (NEW never survives ingestion).
  const pendingOrdersCount = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 1, stage: 'PENDING' },
    ['orders', 'count', 'PENDING'],
  );
  const recentOrders = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 100 },
    ['orders', 'dashboard', 'recent'],
  );
  const openExceptions = useApiQuery<Envelope<ExceptionItem[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 5, status: 'OPEN' },
    ['exceptions', 'dashboard', 'OPEN'],
  );
  const syncJobs = useApiQuery<Envelope<SyncJobItem[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 100 },
    ['sync-jobs', 'dashboard', 'recent'],
  );
  const activeStores = useApiQuery<Envelope<StoreRow[]>>(
    '/api/v1/stores',
    { page: 1, pageSize: 100, status: 'ACTIVE' },
    ['stores', 'dashboard', 'active'],
  );
  const oosInventory = useApiQuery<Envelope<InventoryRow[]>>(
    '/api/v1/inventory',
    { page: 1, pageSize: 5, status: 'OUT_OF_STOCK' },
    ['inventory', 'dashboard', 'oos'],
  );

  // ---- Derived numbers (all real, from the queries above) ----
  const orders = recentOrders.data?.data ?? [];
  const exceptions = openExceptions.data?.data ?? [];
  const jobs = syncJobs.data?.data ?? [];
  const stores = activeStores.data?.data ?? [];
  const oosRows = oosInventory.data?.data ?? [];

  const pendingCount = pendingOrdersCount.data?.meta.total ?? 0;
  const openExceptionTotal = openExceptions.data?.meta.total ?? 0;
  const oosTotal = oosInventory.data?.meta.total ?? 0;

  const failedJobCount = useMemo(
    () => jobs.filter((job) => job.status === 'FAILED').length,
    [jobs],
  );
  const partialJobCount = useMemo(
    () => jobs.filter((job) => job.status === 'PARTIAL').length,
    [jobs],
  );
  const abnormalJobs = useMemo(
    () => jobs.filter((job) => job.status === 'FAILED' || job.status === 'PARTIAL'),
    [jobs],
  );
  const storesWithoutCredential = useMemo(
    () => stores.filter((store) => !store.credentialConfigured),
    [stores],
  );

  // Trend: daily buckets over the last 7 days, aggregated from the latest
  // 100 orders returned by /api/v1/orders (real rows, no fabricated points).
  const trendPoints = useMemo<TrendPoint[]>(() => {
    const days = 7;
    const buckets = new Map<string, number>();
    for (let index = days - 1; index >= 0; index -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - index);
      buckets.set(day.toISOString().slice(0, 10), 0);
    }
    for (const order of orders) {
      const key = order.orderedAt.slice(0, 10);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    return [...buckets.entries()].map(([key, value]) => ({
      label: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`,
      value,
    }));
  }, [orders]);

  const todayOrders = trendPoints[trendPoints.length - 1]?.value ?? 0;
  const yesterdayOrders = trendPoints[trendPoints.length - 2]?.value ?? 0;
  const latestException = exceptions[0];

  // ---- Context rail: 同步异常 + 库存预警 (no store list — avoids echoing
  // the KPI row; both sections rest on the real queries above) ----
  const railContent = useMemo<ContextRailContent>(
    () => ({
      defaultCollapsed: true,
      children: (
        <>
          <ContextSection
            title="同步异常"
            extra={abnormalJobs.length === 0 ? undefined : `${abnormalJobs.length} 项`}
          >
            {syncJobs.isLoading ? (
              <Skeleton active paragraph={false} />
            ) : abnormalJobs.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                最近 {jobs.length} 个任务无失败
              </span>
            ) : (
              abnormalJobs.slice(0, 5).map((job) => (
                <ContextMetric
                  key={job.id}
                  label={
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {job.storeName}
                      <StatusBadge
                        tone={SYNC_STATUS_META[job.status]?.tone ?? 'neutral'}
                        label={SYNC_STATUS_META[job.status]?.label ?? job.status}
                        hint={job.status}
                        showDot={false}
                      />
                    </span>
                  }
                  value={
                    <span style={{ fontSize: 12, color: colors.textTertiary }}>
                      <RelativeTime value={job.finishedAt ?? job.createdAt} />
                    </span>
                  }
                  onClick={() => void navigate('/sync')}
                />
              ))
            )}
          </ContextSection>
          <ContextSection
            title="库存预警"
            extra={oosTotal === 0 ? undefined : `${fmtNumber(oosTotal)} 项`}
          >
            {oosInventory.isLoading ? (
              <Skeleton active paragraph={false} />
            ) : oosTotal === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无可售库存预警</span>
            ) : (
              <>
                {oosRows.map((row) => (
                  <ContextMetric
                    key={row.id}
                    label={`${row.skuCode} · ${row.warehouseCode}`}
                    value={`可售 ${fmtNumber(Number(row.sellableAvailableQty))}`}
                    onClick={() => void navigate('/inventory?status=OUT_OF_STOCK')}
                  />
                ))}
                <ContextMetric
                  label="无可售库存记录"
                  value={fmtNumber(oosTotal)}
                  strong
                  onClick={() => void navigate('/inventory?status=OUT_OF_STOCK')}
                />
              </>
            )}
          </ContextSection>
        </>
      ),
    }),
    [
      syncJobs.isLoading,
      jobs.length,
      abnormalJobs,
      oosInventory.isLoading,
      oosRows,
      oosTotal,
      navigate,
    ],
  );
  useContextRail(railContent);

  const kpiSkeleton = <Skeleton active paragraph={false} />;

  return (
    <div>
      <PageHeader
        title="运营看板"
        description={`今天是 ${fmtDate(new Date())} · 待处理订单 ${fmtNumber(pendingCount)} · 待处理异常 ${fmtNumber(openExceptionTotal)} · 同步失败 ${fmtNumber(failedJobCount)}`}
        secondary={
          <Button icon={<CloudSyncOutlined />} onClick={() => void navigate('/sync')}>
            同步中心
          </Button>
        }
      />

      {/* ---- 1. KPI row (real meta.total / row counts only) ---- */}
      <KpiRow>
        <MetricCard
          icon={<TransactionOutlined />}
          title="待处理订单"
          value={pendingOrdersCount.isLoading ? kpiSkeleton : fmtNumber(pendingCount)}
          aux={
            recentOrders.isLoading
              ? undefined
              : `今日 ${todayOrders} 单 · 昨日 ${yesterdayOrders} 单`
          }
          onClick={() => void navigate('/orders')}
        />
        <MetricCard
          icon={<AlertOutlined />}
          title="待处理异常"
          value={openExceptions.isLoading ? kpiSkeleton : fmtNumber(openExceptionTotal)}
          aux={
            openExceptions.isLoading || latestException === undefined
              ? openExceptions.isLoading
                ? undefined
                : '暂无待处理异常'
              : `最近：${EXCEPTION_TYPE_LABEL[latestException.exceptionType] ?? latestException.exceptionType}`
          }
          onClick={() => void navigate('/exceptions')}
        />
        <MetricCard
          icon={<CloudSyncOutlined />}
          title="同步失败任务"
          value={syncJobs.isLoading ? kpiSkeleton : fmtNumber(failedJobCount)}
          aux={
            syncJobs.isLoading
              ? undefined
              : `最近 ${jobs.length} 个任务内${partialJobCount > 0 ? ` · 另有部分成功 ${partialJobCount}` : ''}`
          }
          onClick={() => void navigate('/sync')}
        />
        <MetricCard
          icon={<ShopOutlined />}
          title="凭证未配置的活跃店铺"
          value={activeStores.isLoading ? kpiSkeleton : fmtNumber(storesWithoutCredential.length)}
          aux={
            activeStores.isLoading
              ? undefined
              : `活跃店铺共 ${fmtNumber(activeStores.data?.meta.total ?? 0)} 家`
          }
          onClick={() => void navigate('/stores')}
        />
      </KpiRow>

      {/* ---- 2. 运营待办: OPEN exceptions + active stores without credentials ---- */}
      <SectionCard
        title="运营待办"
        style={{ marginBottom: 16 }}
        extra={
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            点击条目跳转至对应工作台处理
          </span>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.textPrimary }}>
                待处理异常
              </span>
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                {openExceptionTotal > 0 ? `${fmtNumber(openExceptionTotal)} 项` : ''}
              </span>
            </div>
            {openExceptions.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : exceptions.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无待处理异常</span>
            ) : (
              <>
                {exceptions.map((row) => (
                  <div
                    key={row.id}
                    style={TODO_ROW_STYLE}
                    onClick={() => void navigate('/exceptions')}
                  >
                    <StatusBadge
                      tone={severityTone(row.severity)}
                      label={EXCEPTION_TYPE_LABEL[row.exceptionType] ?? row.exceptionType}
                      hint={`${row.exceptionType} · ${row.severity}`}
                      showDot={false}
                    />
                    <span
                      title={row.message}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                        color: colors.textSecondary,
                      }}
                    >
                      {row.message}
                    </span>
                    <RelativeTime value={row.createdAt} />
                  </div>
                ))}
                {openExceptionTotal > exceptions.length && (
                  <span
                    style={{
                      fontSize: 12,
                      color: colors.textTertiary,
                      paddingTop: 6,
                      display: 'block',
                    }}
                  >
                    仅显示前 {exceptions.length} 条，共 {fmtNumber(openExceptionTotal)} 条
                  </span>
                )}
              </>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600, color: colors.textPrimary }}>
                未配置凭证的活跃店铺
              </span>
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                {storesWithoutCredential.length > 0
                  ? `${fmtNumber(storesWithoutCredential.length)} 项`
                  : ''}
              </span>
            </div>
            {activeStores.isLoading ? (
              <Skeleton active paragraph={{ rows: 3 }} />
            ) : storesWithoutCredential.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                活跃店铺凭证均已配置
              </span>
            ) : (
              <>
                {storesWithoutCredential.slice(0, 5).map((store) => (
                  <div
                    key={store.id}
                    style={TODO_ROW_STYLE}
                    onClick={() => void navigate('/stores')}
                  >
                    <PlatformTag code={store.platformCode} />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                        color: colors.textSecondary,
                      }}
                    >
                      {store.name}
                    </span>
                    <span style={{ fontSize: 12, color: colors.textTertiary }}>
                      {store.storeCode}
                    </span>
                    <StatusBadge
                      tone="warning"
                      label="未配置凭证"
                      hint="credentialConfigured = false"
                      showDot={false}
                    />
                  </div>
                ))}
                {storesWithoutCredential.length > 5 && (
                  <span
                    style={{
                      fontSize: 12,
                      color: colors.textTertiary,
                      paddingTop: 6,
                      display: 'block',
                    }}
                  >
                    仅显示前 5 条，共 {fmtNumber(storesWithoutCredential.length)} 条
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ---- 3. 订单趋势 (real rows: latest 100 orders bucketed by day) ---- */}
      <SectionCard
        title="订单趋势（近 7 日）"
        extra={
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            基于最近 100 条订单按日聚合
          </span>
        }
        style={{ marginBottom: 16 }}
      >
        {recentOrders.isLoading ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <TrendChart points={trendPoints} />
        )}
      </SectionCard>

      {/* ---- 4. 同步异常流: FAILED / PARTIAL jobs from the latest page ---- */}
      <SectionCard
        title="同步异常流"
        flush
        extra={
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            统计口径：最近 100 个任务
          </span>
        }
      >
        <DataTable<SyncJobItem>
          rowKey="id"
          loading={syncJobs.isLoading}
          dataSource={abnormalJobs.slice(0, 8)}
          pagination={false}
          emptyTitle="暂无同步异常"
          emptyDescription="最近 100 个同步任务中没有失败或部分成功的任务"
          onRow={() => ({
            onClick: () => {
              void navigate('/sync');
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: '店铺',
              key: 'store',
              width: 220,
              render: (_: unknown, row: SyncJobItem) => (
                <PlatformTag
                  code={row.platformCode}
                  suffix={`${row.storeName}（${row.storeCode}）`}
                />
              ),
            },
            {
              title: '任务类型',
              dataIndex: 'syncType',
              width: 110,
              render: (value: string) => SYNC_TYPE_LABEL[value] ?? value,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => <SyncStatusBadge status={value} />,
            },
            {
              title: '成功 / 失败',
              key: 'counts',
              width: 110,
              align: 'right',
              render: (_: unknown, row: SyncJobItem) => `${row.successCount} / ${row.failedCount}`,
            },
            {
              title: '结束时间',
              key: 'finishedAt',
              width: 110,
              render: (_: unknown, row: SyncJobItem) => (
                <RelativeTime value={row.finishedAt ?? row.createdAt} />
              ),
            },
            {
              title: '错误信息',
              dataIndex: 'errorMessage',
              render: (value: string | null) => (
                <span
                  title={value ?? undefined}
                  style={{
                    display: 'block',
                    maxWidth: 320,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: 12.5,
                    color: colors.textTertiary,
                  }}
                >
                  {value ?? '—'}
                </span>
              ),
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
