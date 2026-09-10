import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Skeleton, Tabs } from 'antd';
import {
  AlertOutlined,
  AppstoreOutlined,
  ShopOutlined,
  TransactionOutlined,
} from '@ant-design/icons';
import {
  ContextMetric,
  ContextSection,
  DataTable,
  EmptyState,
  ERP_STATUS_META,
  MetricCard,
  PageHeader,
  PlatformTag,
  SectionCard,
  StatusBadge,
  SYNC_STATUS_META,
  TrendChart,
  colors,
  useContextRail,
  ContextRailContent,
  TrendPoint,
} from '../design-system';
import { useApiQuery } from '../api/hooks';

/**
 * Dashboard (redesign task §20-§25) — the most complete three-column page.
 * All numbers come from existing APIs (list meta.total / light queries);
 * nothing is fabricated for visual effect (task §21).
 */

interface OrderListItem {
  id: string;
  orderNo: string;
  storeName: string;
  platformCode: string;
  erpStatus: string;
  orderedAt: string;
  itemsCount: number;
  openExceptionsCount: number;
  backorderedCount: number;
  mappingFailedCount: number;
}

interface StoreItem {
  id: string;
  name: string;
  storeCode: string;
  platformCode: string;
  status: string;
}

interface SyncJobItem {
  id: string;
  storeId: string;
  storeCode: string;
  platformCode: string;
  syncType: string;
  status: string;
  finishedAt: string | null;
  createdAt: string;
  errorMessage: string | null;
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

type Envelope<T> = { data: T; meta: { total: number } };

const RECENT_TAB_GROUPS: Array<{
  key: string;
  label: string;
  match: (row: OrderListItem) => boolean;
}> = [
  { key: 'all', label: '全部', match: () => true },
  {
    key: 'pending',
    label: '待处理',
    match: (row) => row.erpStatus === 'NEW' || row.erpStatus === 'ALLOCATING',
  },
  {
    key: 'processing',
    label: '处理中',
    match: (row) =>
      row.erpStatus === 'READY_TO_PICK' ||
      row.erpStatus === 'PICKING' ||
      row.erpStatus === 'PICKED',
  },
  {
    key: 'shipped',
    label: '已发货',
    match: (row) => row.erpStatus === 'SHIPPED' || row.erpStatus === 'PARTIALLY_SHIPPED',
  },
  {
    key: 'exception',
    label: '异常',
    match: (row) =>
      row.erpStatus === 'EXCEPTION' ||
      row.erpStatus === 'BACKORDERED' ||
      row.erpStatus === 'PARTIALLY_BACKORDERED' ||
      row.openExceptionsCount > 0,
  },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) {
    return '夜深了';
  }
  if (hour < 12) {
    return '早上好';
  }
  if (hour < 18) {
    return '下午好';
  }
  return '晚上好';
}

function fmtDate(date: Date): string {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日 星期${weekdays[date.getDay()]}`;
}

function fmtTime(value: string): string {
  return value.slice(11, 16);
}

function fmtRelative(value: string | null): string {
  if (value === null) {
    return '—';
  }
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  return `${Math.round(hours / 24)} 天前`;
}

const EXCEPTION_LABELS: Record<string, string> = {
  ORDER_SKU_MAPPING_FAILED: 'Mapping 失败',
  ORDER_OUT_OF_STOCK: '订单缺货',
  ORDER_INVALID_STATE: '状态非法',
  ORDER_INTERCEPTION_FAILED: '拦截失败',
};

export function DashboardPage() {
  // ---- Data: existing list APIs only, meta.total drives KPI numbers ----
  const recentOrders = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 100 },
    ['dashboard-orders'],
  );
  const pendingOrders = useApiQuery<Envelope<OrderListItem[]>>(
    '/api/v1/orders',
    { page: 1, pageSize: 1, erpStatus: 'NEW' },
    ['dashboard-orders-pending'],
  );
  const outOfStock = useApiQuery<Envelope<unknown[]>>(
    '/api/v1/inventory',
    { page: 1, pageSize: 1, status: 'OUT_OF_STOCK' },
    ['dashboard-inventory-oos'],
  );
  const skusTotal = useApiQuery<Envelope<unknown[]>>('/api/v1/skus', { page: 1, pageSize: 1 }, [
    'dashboard-skus-total',
  ]);
  const skusUnmapped = useApiQuery<Envelope<unknown[]>>(
    '/api/v1/skus',
    { page: 1, pageSize: 1, hasListing: 'false' },
    ['dashboard-skus-unmapped'],
  );
  const stores = useApiQuery<Envelope<StoreItem[]>>('/api/v1/stores', { page: 1, pageSize: 100 }, [
    'dashboard-stores',
  ]);
  const syncJobs = useApiQuery<Envelope<SyncJobItem[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 20 },
    ['dashboard-sync-jobs'],
  );
  const exceptions = useApiQuery<Envelope<ExceptionItem[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 20, status: 'OPEN' },
    ['dashboard-exceptions'],
  );

  // ---- Derived numbers (all real, from the queries above) ----
  const orders = recentOrders.data?.data ?? [];
  const storeList = stores.data?.data ?? [];
  const jobs = syncJobs.data?.data ?? [];
  const openExceptions = exceptions.data?.data ?? [];

  const platformOptions = useMemo(() => {
    const codes = new Map<string, number>();
    for (const store of storeList) {
      codes.set(store.platformCode, (codes.get(store.platformCode) ?? 0) + 1);
    }
    return [...codes.entries()].map(([code, count]) => ({ code, count }));
  }, [storeList]);

  const navigate = useNavigate();
  const [platformFilter, setPlatformFilter] = useState<string | undefined>();
  const filteredOrders = useMemo(
    () =>
      platformFilter === undefined
        ? orders
        : orders.filter((order) => order.platformCode === platformFilter),
    [orders, platformFilter],
  );
  const filteredJobs = useMemo(
    () =>
      platformFilter === undefined
        ? jobs
        : jobs.filter((job) => job.platformCode === platformFilter),
    [jobs, platformFilter],
  );

  const [activeTab, setActiveTab] = useState('all');
  const tabOrders = useMemo(() => {
    const group =
      RECENT_TAB_GROUPS.find((entry) => entry.key === activeTab) ?? RECENT_TAB_GROUPS[0]!;
    return filteredOrders.filter(group.match);
  }, [filteredOrders, activeTab]);

  const trendPoints = useMemo<TrendPoint[]>(() => {
    const days = 7;
    const buckets = new Map<string, number>();
    for (let index = days - 1; index >= 0; index -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - index);
      buckets.set(day.toISOString().slice(0, 10), 0);
    }
    for (const order of filteredOrders) {
      const key = order.orderedAt.slice(0, 10);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    return [...buckets.entries()].map(([key, value]) => ({
      label: `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`,
      value,
    }));
  }, [filteredOrders]);

  const mappingCoverage = useMemo(() => {
    const total = skusTotal.data?.meta.total ?? 0;
    const unmapped = skusUnmapped.data?.meta.total ?? 0;
    return { total, unmapped, mapped: Math.max(0, total - unmapped) };
  }, [skusTotal.data, skusUnmapped.data]);

  const activeStores = storeList.filter((store) => store.status === 'ACTIVE');
  const failedJobs = filteredJobs.filter(
    (job) => job.status === 'FAILED' || job.status === 'PARTIAL',
  );
  const railStoreList = filteredStoresOf(storeList, platformFilter);
  const todayOrders = trendPoints[trendPoints.length - 1]?.value ?? 0;
  const yesterdayOrders = trendPoints[trendPoints.length - 2]?.value ?? 0;
  const pendingCount = pendingOrders.data?.meta.total ?? 0;
  const todoCount = pendingCount + openExceptions.length;

  // ---- Context rail (task §24) ----
  const railContent = useMemo<ContextRailContent>(
    () => ({
      children: (
        <>
          <ContextSection title="店铺状态" extra={`${railStoreList.length} 家`}>
            {storeList.length === 0 && stores.isLoading ? (
              <Skeleton active paragraph={false} />
            ) : railStoreList.length === 0 ? (
              <EmptyState title="暂无店铺" description="请先在店铺管理中添加店铺。" />
            ) : (
              <>
                {railStoreList.slice(0, 6).map((store) => {
                  const lastJob = latestJobFor(jobs, store.id);
                  return (
                    <div
                      key={store.id}
                      style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 0' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PlatformTag code={store.platformCode} />
                        <span style={{ fontSize: 13, color: colors.textPrimary, fontWeight: 500 }}>
                          {store.name}
                        </span>
                        <span style={{ marginLeft: 'auto' }}>
                          <StatusBadge
                            tone={store.status === 'ACTIVE' ? 'success' : 'neutral'}
                            label={store.status === 'ACTIVE' ? '正常' : store.status}
                            showDot={false}
                          />
                        </span>
                      </div>
                      <span style={{ fontSize: 12, color: colors.textTertiary, paddingLeft: 2 }}>
                        {lastJob === undefined
                          ? '暂无同步记录'
                          : `同步${SYNC_STATUS_META[lastJob.status]?.label ?? lastJob.status} · ${fmtRelative(lastJob.finishedAt ?? lastJob.createdAt)}`}
                      </span>
                    </div>
                  );
                })}
                {railStoreList.length > 6 && (
                  <span style={{ fontSize: 12, color: colors.textTertiary, paddingTop: 4 }}>
                    还有 {railStoreList.length - 6} 家店铺未展示
                  </span>
                )}
              </>
            )}
          </ContextSection>
          <ContextSection
            title="同步异常"
            extra={failedJobs.length === 0 ? undefined : `${failedJobs.length} 项`}
          >
            {failedJobs.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无同步异常</span>
            ) : (
              failedJobs.slice(0, 5).map((job) => (
                <div
                  key={job.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}
                >
                  <StatusBadge tone="danger" label={job.storeCode} showDot={false} />
                  <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                    {job.syncType === 'ORDER_SYNC' ? '订单同步' : 'Listing 同步'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: colors.textTertiary }}>
                    {fmtRelative(job.finishedAt ?? job.createdAt)}
                  </span>
                </div>
              ))
            )}
          </ContextSection>
          <ContextSection
            title="今日风险"
            extra={openExceptions.length === 0 ? undefined : `${openExceptions.length} 项`}
          >
            {openExceptions.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无待处理异常</span>
            ) : (
              openExceptions
                .slice(0, 5)
                .map((exception) => (
                  <ContextMetric
                    key={exception.id}
                    label={
                      <StatusBadge
                        tone={exception.severity === 'HIGH' ? 'danger' : 'warning'}
                        label={EXCEPTION_LABELS[exception.exceptionType] ?? exception.exceptionType}
                        showDot={false}
                      />
                    }
                    value={fmtRelative(exception.createdAt)}
                  />
                ))
            )}
          </ContextSection>
        </>
      ),
    }),
    [storeList, railStoreList, stores.isLoading, jobs, failedJobs, openExceptions, platformFilter],
  );
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title={`${greeting()}，Admin`}
        description={`今天是 ${fmtDate(new Date())} · 当前有 ${todoCount} 个待处理事项`}
        secondary={
          <Link to="/sync" style={{ fontSize: 13.5, color: colors.primary }}>
            同步中心
          </Link>
        }
        primary={
          <PlatformSelect
            value={platformFilter}
            onChange={setPlatformFilter}
            options={platformOptions}
            allCount={storeList.length}
          />
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <MetricCard
          icon={<TransactionOutlined />}
          title="待处理订单"
          value={pendingOrders.isLoading ? <Skeleton active paragraph={false} /> : pendingCount}
          aux={`今日 ${todayOrders} 单 · 昨日 ${yesterdayOrders} 单`}
        />
        <MetricCard
          icon={<AlertOutlined />}
          title="缺货预警"
          value={
            outOfStock.isLoading ? (
              <Skeleton active paragraph={false} />
            ) : (
              (outOfStock.data?.meta.total ?? 0)
            )
          }
          aux="无可售库存记录"
        />
        <MetricCard
          icon={<AppstoreOutlined />}
          title="Mapping 覆盖率"
          value={
            skusTotal.isLoading ? (
              <Skeleton active paragraph={false} />
            ) : mappingCoverage.total === 0 ? (
              '—'
            ) : (
              `${Math.round((mappingCoverage.mapped / mappingCoverage.total) * 100)}%`
            )
          }
          aux={`${mappingCoverage.mapped} / ${mappingCoverage.total} 个 SKU 已映射`}
        />
        <MetricCard
          icon={<ShopOutlined />}
          title="店铺在线"
          value={stores.isLoading ? <Skeleton active paragraph={false} /> : activeStores.length}
          aux={`共 ${storeList.length} 家店铺`}
        />
      </div>

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

      <SectionCard
        title="最近订单"
        flush
        extra={
          <Link to="/orders" style={{ fontSize: 13, color: colors.primary }}>
            查看全部
          </Link>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          style={{ padding: '4px 20px 0' }}
          items={RECENT_TAB_GROUPS.map((group) => ({
            key: group.key,
            label: `${group.label} (${filteredOrders.filter(group.match).length})`,
          }))}
        />
        <DataTable<OrderListItem>
          rowKey="id"
          loading={recentOrders.isLoading}
          dataSource={tabOrders.slice(0, 10)}
          pagination={false}
          onRow={(record) => ({
            onClick: () => {
              void navigate(`/orders?keyword=${encodeURIComponent(record.orderNo)}`);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            { title: '订单号', dataIndex: 'orderNo', width: 130 },
            {
              title: '平台 / 店铺',
              key: 'platform',
              width: 200,
              render: (_: unknown, row: OrderListItem) => (
                <PlatformTag code={row.platformCode} suffix={row.storeName} />
              ),
            },
            {
              title: '商品',
              key: 'items',
              width: 90,
              align: 'right',
              render: (_: unknown, row: OrderListItem) => `${row.itemsCount} 件`,
            },
            {
              title: 'ERP 状态',
              dataIndex: 'erpStatus',
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
                      异常 {row.openExceptionsCount}
                    </span>
                  )}
                </span>
              ),
            },
            {
              title: '下单时间',
              dataIndex: 'orderedAt',
              width: 90,
              render: (value: string) => fmtTime(value),
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}

function filteredStoresOf(storeList: StoreItem[], platform: string | undefined): StoreItem[] {
  return platform === undefined ? storeList : storeList.filter((s) => s.platformCode === platform);
}

function latestJobFor(jobs: SyncJobItem[], storeId: string): SyncJobItem | undefined {
  return jobs.find((job) => job.storeId === storeId);
}

/** Lightweight inline platform filter: 全部店铺 / each platform with count. */
function PlatformSelect({
  value,
  onChange,
  options,
  allCount,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: Array<{ code: string; count: number }>;
  allCount: number;
}) {
  const itemStyle = (active: boolean): React.CSSProperties => ({
    padding: '5px 12px',
    borderRadius: 8,
    border: `1px solid ${active ? colors.primary : colors.border}`,
    background: active ? colors.primarySoft : colors.container,
    color: active ? colors.primaryActive : colors.textSecondary,
    fontSize: 13,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="平台筛选">
      <button
        type="button"
        style={itemStyle(value === undefined)}
        onClick={() => onChange(undefined)}
      >
        全部店铺 · {allCount}
      </button>
      {options.map((option) => (
        <button
          key={option.code}
          type="button"
          style={itemStyle(value === option.code)}
          onClick={() => onChange(option.code)}
        >
          {option.code} · {option.count}
        </button>
      ))}
    </div>
  );
}
