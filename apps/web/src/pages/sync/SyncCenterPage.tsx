import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudSyncOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtDuration, fmtNumber } from '../../utils/format';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  EntityLink,
  ErrorState,
  FilterBar,
  InfoGrid,
  KpiRow,
  MetricCard,
  PageHeader,
  PlatformTag,
  RailHint,
  RawDataBlock,
  RelativeTime,
  SectionCard,
  StatusBadge,
  SyncStatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Sync Center (Phase 2 task §12-§19): KPI cards + dense job table answering
 * "正在同步什么、哪些失败、为什么失败", a job context rail with error
 * preview, a detail drawer with statistics/cursors, and the existing webhook
 * raw-event tab. Manual trigger (POST /sync/orders|listings) is real.
 */

interface SyncJobRow {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformCode: string;
  syncType: 'ORDER_SYNC' | 'LISTING_SYNC';
  status: string;
  triggerType: string;
  startedAt: string | null;
  finishedAt: string | null;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  retryCount: number;
  cursorBefore: Record<string, unknown> | null;
  cursorAfter: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  durationMs: number | null;
}

interface RawEventRow {
  id: string;
  platform: string;
  storeId: string;
  eventType: string;
  externalEventId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

type Envelope<T> = { data: T; meta: { total: number } };

/** Task type → Chinese label (task §15; backend only has these two types). */
const SYNC_TYPE_META: Record<string, string> = {
  ORDER_SYNC: '订单',
  LISTING_SYNC: '商品',
};

const TRIGGER_TYPE_META: Record<string, string> = {
  MANUAL: '手动',
  SCHEDULED: '定时',
  WEBHOOK: 'Webhook',
  RETRY: '重试',
};

const EVENT_STATUS_META: Record<
  string,
  { tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info'; label: string }
> = {
  PROCESSED: { tone: 'success', label: '已处理' },
  FAILED: { tone: 'danger', label: '失败' },
  REJECTED: { tone: 'warning', label: '已拒绝' },
  PENDING: { tone: 'neutral', label: '待处理' },
  PROCESSING: { tone: 'info', label: '处理中' },
  SKIPPED: { tone: 'neutral', label: '已跳过' },
};

export function SyncCenterPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [storeId, setStoreId] = useState<string | undefined>();
  const [syncType, setSyncType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [detailJobId, setDetailJobId] = useState<string | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [eventPage, setEventPage] = useState(1);
  const [eventDetail, setEventDetail] = useState<RawEventRow | null>(null);
  const [triggerForm] = Form.useForm();

  const jobs = useApiQuery<Envelope<SyncJobRow[]>>(
    '/api/v1/sync/jobs',
    {
      page,
      pageSize: 20,
      ...(storeId ? { storeId } : {}),
      ...(syncType ? { syncType } : {}),
      ...(status ? { status } : {}),
    },
    ['sync-jobs', page, storeId, syncType, status],
  );
  const events = useApiQuery<Envelope<RawEventRow[]>>(
    '/api/v1/sync/events',
    { page: eventPage, pageSize: 20, ...(storeId ? { storeId } : {}) },
    ['sync-events', eventPage, storeId],
  );
  const stores = useApiQuery<
    Envelope<Array<{ id: string; storeCode: string; name: string; platformCode: string }>>
  >('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores', 'for-sync']);

  // KPI totals per status — lightweight pageSize=1 count queries (task §14).
  const runningCount = useApiQuery<Envelope<SyncJobRow[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 1, status: 'RUNNING' },
    ['sync-jobs', 'count', 'RUNNING'],
  );
  const pendingCount = useApiQuery<Envelope<SyncJobRow[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 1, status: 'PENDING' },
    ['sync-jobs', 'count', 'PENDING'],
  );
  const failedCount = useApiQuery<Envelope<SyncJobRow[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 1, status: 'FAILED' },
    ['sync-jobs', 'count', 'FAILED'],
  );
  const successCount = useApiQuery<Envelope<SyncJobRow[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 1, status: 'SUCCESS' },
    ['sync-jobs', 'count', 'SUCCESS'],
  );

  // Poll while any visible job is in flight (task §12 "看懂正在同步什么").
  const rows = jobs.data?.data ?? [];
  const hasActive = rows.some((job) => job.status === 'PENDING' || job.status === 'RUNNING');
  useEffect(() => {
    if (!hasActive) {
      return;
    }
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActive, queryClient]);

  const selectedJob = useMemo(
    () => rows.find((job) => job.id === selectedJobId) ?? null,
    [rows, selectedJobId],
  );
  const detailJob = useMemo(
    () => rows.find((job) => job.id === detailJobId) ?? null,
    [rows, detailJobId],
  );

  const triggerMutation = useMutation({
    mutationFn: ({
      type,
      storeId,
      storeLabel,
    }: {
      type: 'orders' | 'listings';
      storeId: string;
      storeLabel: string;
    }) =>
      apiPost<SyncJobRow>(`/api/v1/sync/${type}`, { storeId }).then((job) => ({ job, storeLabel })),
    onSuccess: ({ job, storeLabel }) => {
      // The trigger response returns the job before enrichment (empty
      // storeCode), so the message uses the label from the request context.
      void message.success(
        `同步任务已创建（${SYNC_TYPE_META[job.syncType] ?? ''} · ${storeLabel}），状态将自动刷新`,
      );
      setTriggerOpen(false);
      triggerForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ---- Context rail (task §18) ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedJob === null) {
      // 空闲态统计与 KPI 卡去重（规范 §2）：只保留最近失败任务列表 + 提示。
      const recentFailed = rows.filter((job) => job.status === 'FAILED').slice(0, 5);
      return {
        defaultCollapsed: true,
        children: (
          <>
            <ContextSection title="同步概览">
              <RailHint>
                任务分布见上方指标卡；点击任务行查看处理进度与错误，失败任务可从右栏重新执行。
              </RailHint>
            </ContextSection>
            {recentFailed.length > 0 && (
              <ContextSection title={`最近失败（${recentFailed.length}）`}>
                {recentFailed.map((job) => (
                  <ContextMetric
                    key={job.id}
                    label={`${SYNC_TYPE_META[job.syncType] ?? job.syncType} · ${job.storeCode}`}
                    value={<SyncStatusBadge status={job.status} />}
                    onClick={() => setSelectedJobId(job.id)}
                  />
                ))}
              </ContextSection>
            )}
            <ContextSection title="同步启停">
              <RailHint>
                自动同步开关在店铺管理 → 店铺详情内配置；同步中心不直接停用同步（不改 API）。
              </RailHint>
              <EntityLink to="/stores" primary="前往店铺管理" />
            </ContextSection>
          </>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={`${SYNC_TYPE_META[selectedJob.syncType] ?? selectedJob.syncType}同步 · ${selectedJob.storeCode}`}
          subtitle={selectedJob.storeName}
          badge={<SyncStatusBadge status={selectedJob.status} />}
          meta={<PlatformTag code={selectedJob.platformCode} />}
        />
      ),
      children: (
        <>
          <ContextSection title="任务概况">
            <ContextMetric
              label="Job ID"
              value={
                <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  {selectedJob.id.slice(0, 8)}…
                </span>
              }
            />
            <ContextMetric
              label="触发方式"
              value={TRIGGER_TYPE_META[selectedJob.triggerType] ?? selectedJob.triggerType}
            />
            <ContextMetric
              label="开始时间"
              value={<RelativeTime value={selectedJob.startedAt ?? selectedJob.createdAt} />}
            />
            <ContextMetric label="耗时" value={fmtDuration(selectedJob.durationMs)} />
            <ContextMetric
              label="成功"
              value={
                <span style={{ color: colors.success }}>{fmtNumber(selectedJob.successCount)}</span>
              }
            />
            <ContextMetric
              label="失败"
              value={
                selectedJob.failedCount > 0 ? (
                  <span style={{ color: colors.danger }}>{fmtNumber(selectedJob.failedCount)}</span>
                ) : (
                  '0'
                )
              }
            />
          </ContextSection>
          {selectedJob.errorCode !== null && (
            <ContextSection title="最近错误">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <StatusBadge tone="danger" label={selectedJob.errorCode} />
                <span
                  style={{ fontSize: 12.5, color: colors.textSecondary, wordBreak: 'break-word' }}
                >
                  {selectedJob.errorMessage ?? '（无详细说明）'}
                </span>
              </div>
            </ContextSection>
          )}
          <ContextAction>
            <Space orientation="vertical" style={{ width: '100%' }} size={8}>
              <Button block onClick={() => setDetailJobId(selectedJob.id)}>
                查看详情
              </Button>
              {/* 重新执行 = 唯一入口（右栏）；与「立即同步」（触发新任务、可选全店铺）
                  区分：这里针对当前失败任务按同参数重跑，L1 轻确认。 */}
              <Popconfirm
                title="重新执行该同步任务？"
                description={`将按同参数重跑（${SYNC_TYPE_META[selectedJob.syncType] ?? selectedJob.syncType} · ${selectedJob.storeCode}）。`}
                okText="重新执行"
                cancelText="取消"
                onConfirm={() =>
                  triggerMutation.mutate({
                    type: selectedJob.syncType === 'ORDER_SYNC' ? 'orders' : 'listings',
                    storeId: selectedJob.storeId,
                    storeLabel: selectedJob.storeCode,
                  })
                }
              >
                <Button block icon={<PlayCircleOutlined />} loading={triggerMutation.isPending}>
                  重新执行
                </Button>
              </Popconfirm>
            </Space>
          </ContextAction>
        </>
      ),
    };
  }, [selectedJob, jobs.data, rows, triggerMutation.isPending, triggerMutation.mutate]);
  useContextRail(railContent);

  const jobColumns = [
    {
      title: '任务',
      key: 'job',
      width: 150,
      render: (_: unknown, row: SyncJobRow) => (
        <div>
          <div style={{ fontWeight: 550 }}>
            {SYNC_TYPE_META[row.syncType] ?? row.syncType}同步
            <span style={{ fontSize: 12, color: colors.textTertiary, marginLeft: 6 }}>
              {TRIGGER_TYPE_META[row.triggerType] ?? row.triggerType}
            </span>
          </div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: colors.textTertiary }}>
            {row.id.slice(0, 8)}…
          </div>
        </div>
      ),
    },
    {
      title: '平台',
      dataIndex: 'platformCode',
      key: 'platform',
      width: 100,
      render: (value: string) => <PlatformTag code={value} />,
    },
    {
      title: '店铺',
      key: 'store',
      width: 140,
      render: (_: unknown, row: SyncJobRow) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.storeCode}</div>
          <div
            style={{
              fontSize: 12.5,
              color: colors.textTertiary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.storeName}
          </div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'syncType',
      key: 'syncType',
      width: 76,
      render: (value: string) => SYNC_TYPE_META[value] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 96,
      render: (value: string) => <SyncStatusBadge status={value} />,
    },
    {
      title: '处理',
      key: 'counts',
      width: 130,
      render: (_: unknown, row: SyncJobRow) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
          <span style={{ color: colors.success }}>{row.successCount}</span>
          <span style={{ color: colors.textTertiary }}> / </span>
          <span style={{ color: colors.textTertiary }}>{row.skippedCount}</span>
          <span style={{ color: colors.textTertiary }}> / </span>
          <span style={{ color: row.failedCount > 0 ? colors.danger : colors.textTertiary }}>
            {row.failedCount}
          </span>
        </span>
      ),
    },
    {
      title: '开始时间',
      key: 'started',
      width: 110,
      render: (_: unknown, row: SyncJobRow) => (
        <RelativeTime value={row.startedAt ?? row.createdAt} />
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      key: 'duration',
      width: 90,
      render: (value: number | null) => fmtDuration(value),
    },
    {
      title: '错误',
      key: 'error',
      ellipsis: true,
      render: (_: unknown, row: SyncJobRow) =>
        row.errorCode === null ? (
          <span style={{ color: colors.textTertiary }}>—</span>
        ) : (
          <Tooltip title={row.errorMessage ?? undefined}>
            <span style={{ color: colors.danger, fontSize: 12.5 }}>{row.errorCode}</span>
          </Tooltip>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="同步中心"
        description="监控平台商品、订单等同步任务与 Webhook 事件"
        secondary={
          <Tooltip title="刷新任务列表">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
                void queryClient.invalidateQueries({ queryKey: ['sync-events'] });
              }}
            >
              刷新
            </Button>
          </Tooltip>
        }
        primary={
          <Button type="primary" icon={<CloudSyncOutlined />} onClick={() => setTriggerOpen(true)}>
            立即同步
          </Button>
        }
      />

      <KpiRow>
        <MetricCard
          icon={<PlayCircleOutlined />}
          title="运行中"
          value={fmtNumber(runningCount.data?.meta.total ?? 0)}
          aux="全部店铺"
        />
        <MetricCard
          icon={<ClockCircleOutlined />}
          title="等待处理"
          value={fmtNumber(pendingCount.data?.meta.total ?? 0)}
          aux="队列中"
        />
        <MetricCard
          icon={<CheckCircleOutlined />}
          title="累计成功"
          value={fmtNumber(successCount.data?.meta.total ?? 0)}
          aux="SUCCESS 任务"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="累计失败"
          value={fmtNumber(failedCount.data?.meta.total ?? 0)}
          aux="需要重新执行"
        />
      </KpiRow>

      <FilterBar>
        <Select
          allowClear
          placeholder="店铺"
          style={{ width: 200 }}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setEventPage(1);
            setStoreId(value);
          }}
          showSearch
          optionFilterProp="label"
          options={(stores.data?.data ?? []).map((store) => ({
            value: store.id,
            label: `${store.storeCode} · ${store.name}`,
          }))}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 120 }}
          value={syncType}
          onChange={(value) => {
            setPage(1);
            setSyncType(value);
          }}
          options={[
            { value: 'ORDER_SYNC', label: '订单同步' },
            { value: 'LISTING_SYNC', label: '商品同步' },
          ]}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={[
            { value: 'PENDING', label: '等待中' },
            { value: 'RUNNING', label: '运行中' },
            { value: 'SUCCESS', label: '成功' },
            { value: 'PARTIAL', label: '部分成功' },
            { value: 'FAILED', label: '失败' },
          ]}
        />
      </FilterBar>

      <Tabs
        defaultActiveKey="jobs"
        items={[
          {
            key: 'jobs',
            label: '同步任务',
            children: (
              <SectionCard flush>
                {jobs.isError ? (
                  <ErrorState
                    description={(jobs.error as Error | null)?.message}
                    onRetry={() => void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] })}
                    retrying={jobs.isFetching}
                  />
                ) : (
                  <DataTable<SyncJobRow>
                    rowKey="id"
                    loading={jobs.isLoading}
                    dataSource={rows}
                    columns={jobColumns}
                    emptyTitle="暂无同步任务"
                    emptyDescription="点击右上角立即同步，或等待定时任务触发"
                    pagination={{
                      current: page,
                      pageSize: 20,
                      total: jobs.data?.meta.total ?? 0,
                      onChange: setPage,
                      showSizeChanger: false,
                    }}
                    onRow={(record) => ({
                      onClick: () =>
                        setSelectedJobId(record.id === selectedJobId ? null : record.id),
                      onDoubleClick: () => setDetailJobId(record.id),
                      style: {
                        cursor: 'pointer',
                        background: record.id === selectedJobId ? colors.primarySoft : undefined,
                      },
                    })}
                  />
                )}
              </SectionCard>
            ),
          },
          {
            key: 'events',
            label: 'Webhook 事件',
            children: (
              <SectionCard flush>
                <DataTable<RawEventRow>
                  rowKey="id"
                  loading={events.isLoading}
                  dataSource={events.data?.data ?? []}
                  emptyTitle="暂无 Webhook 事件"
                  emptyDescription="平台 Webhook 推送将在这里显示"
                  pagination={{
                    current: eventPage,
                    pageSize: 20,
                    total: events.data?.meta.total ?? 0,
                    onChange: setEventPage,
                    showSizeChanger: false,
                  }}
                  onRow={(record) => ({
                    // 事件行：单击选中（视觉），双击打开报文 Drawer（与其他页一致）。
                    onClick: () => setSelectedJobId(selectedJobId === record.id ? null : record.id),
                    onDoubleClick: () => setEventDetail(record),
                    style: {
                      cursor: 'pointer',
                      background: selectedJobId === record.id ? colors.primarySoft : undefined,
                    },
                  })}
                  columns={[
                    {
                      title: '平台',
                      dataIndex: 'platform',
                      key: 'platform',
                      width: 100,
                      render: (value: string) => <PlatformTag code={value} />,
                    },
                    { title: '事件类型', dataIndex: 'eventType', key: 'eventType' },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      key: 'status',
                      width: 96,
                      render: (value: string) => {
                        const meta = EVENT_STATUS_META[value] ?? {
                          tone: 'neutral' as const,
                          label: value,
                        };
                        return <StatusBadge tone={meta.tone} label={meta.label} hint={value} />;
                      },
                    },
                    {
                      title: '接收时间',
                      dataIndex: 'receivedAt',
                      key: 'receivedAt',
                      width: 110,
                      render: (value: string) => <RelativeTime value={value} />,
                    },
                    {
                      title: '处理时间',
                      dataIndex: 'processedAt',
                      key: 'processedAt',
                      width: 110,
                      render: (value: string | null) => <RelativeTime value={value} />,
                    },
                    {
                      title: '错误',
                      key: 'error',
                      ellipsis: true,
                      render: (_: unknown, row: RawEventRow) =>
                        row.errorCode === null ? (
                          <span style={{ color: colors.textTertiary }}>—</span>
                        ) : (
                          <Tooltip title={row.errorMessage ?? undefined}>
                            <span style={{ color: colors.danger, fontSize: 12.5 }}>
                              {row.errorCode}
                            </span>
                          </Tooltip>
                        ),
                    },
                  ]}
                />
              </SectionCard>
            ),
          },
        ]}
      />

      {/* ---- Job detail drawer (task §19) ---- */}
      <Drawer
        title="同步任务详情"
        size={640}
        open={detailJobId !== null}
        onClose={() => setDetailJobId(null)}
        destroyOnHidden
      >
        {detailJob !== null ? (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <section>
              <DrawerSectionTitle>任务概要</DrawerSectionTitle>
              <InfoGrid
                columns={2}
                items={[
                  { label: '状态', children: <SyncStatusBadge status={detailJob.status} /> },
                  {
                    label: '平台 / 店铺',
                    children: (
                      <PlatformTag
                        code={detailJob.platformCode}
                        suffix={`${detailJob.storeCode} · ${detailJob.storeName}`}
                      />
                    ),
                  },
                  {
                    label: '任务类型',
                    children: `${SYNC_TYPE_META[detailJob.syncType] ?? detailJob.syncType}同步`,
                  },
                  {
                    label: '触发方式',
                    children: TRIGGER_TYPE_META[detailJob.triggerType] ?? detailJob.triggerType,
                  },
                  {
                    label: '开始时间',
                    children: fmtDateTime(detailJob.startedAt ?? detailJob.createdAt),
                  },
                  {
                    label: '结束时间',
                    children:
                      detailJob.finishedAt === null ? '—' : fmtDateTime(detailJob.finishedAt),
                  },
                  { label: '耗时', children: fmtDuration(detailJob.durationMs) },
                  {
                    label: 'Job ID',
                    children: (
                      <Typography.Text code copyable style={{ fontSize: 12 }}>
                        {detailJob.id}
                      </Typography.Text>
                    ),
                  },
                ]}
              />
            </section>

            <section>
              <DrawerSectionTitle>处理统计</DrawerSectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                <StatTile
                  label="总数"
                  value={fmtNumber(
                    detailJob.successCount + detailJob.failedCount + detailJob.skippedCount,
                  )}
                />
                <StatTile label="成功" value={fmtNumber(detailJob.successCount)} tone="success" />
                <StatTile
                  label="失败"
                  value={fmtNumber(detailJob.failedCount)}
                  tone={detailJob.failedCount > 0 ? 'danger' : undefined}
                />
                <StatTile label="跳过" value={fmtNumber(detailJob.skippedCount)} />
              </div>
            </section>

            <section>
              <DrawerSectionTitle>错误</DrawerSectionTitle>
              {detailJob.errorCode === null ? (
                <div style={{ fontSize: 13, color: colors.textTertiary }}>本任务无错误记录</div>
              ) : (
                <div
                  style={{
                    border: `1px solid ${colors.dangerBorder}`,
                    background: colors.dangerBg,
                    borderRadius: 8,
                    padding: '10px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: colors.danger }}>
                    {detailJob.errorCode}
                  </span>
                  <span
                    style={{ fontSize: 12.5, color: colors.textSecondary, wordBreak: 'break-word' }}
                  >
                    {detailJob.errorMessage ?? '（无详细说明）'}
                  </span>
                  <span style={{ fontSize: 12, color: colors.textTertiary }}>
                    发生于 {fmtDateTime(detailJob.finishedAt ?? detailJob.createdAt)}
                  </span>
                </div>
              )}
            </section>

            <section>
              <DrawerSectionTitle>游标（Cursor）</DrawerSectionTitle>
              <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                <CursorField label="执行前游标" value={detailJob.cursorBefore} />
                <CursorField label="执行后游标" value={detailJob.cursorAfter} />
              </Space>
            </section>
            {/* 重新执行的唯一入口在右栏（本抽屉只读，Phase 3 T6）。 */}
          </Space>
        ) : (
          <div style={{ padding: '40px 0', textAlign: 'center', color: colors.textTertiary }}>
            加载中…
          </div>
        )}
      </Drawer>

      {/* ---- Webhook event payload drawer (existing feature, restyled) ---- */}
      <Drawer
        title={eventDetail ? `${eventDetail.platform} / ${eventDetail.eventType}` : '事件详情'}
        size={640}
        open={eventDetail !== null}
        onClose={() => setEventDetail(null)}
        destroyOnHidden
      >
        {eventDetail !== null && (
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <InfoGrid
              columns={2}
              items={[
                {
                  label: '事件 ID',
                  children: (
                    <Typography.Text code copyable style={{ fontSize: 12 }}>
                      {eventDetail.id}
                    </Typography.Text>
                  ),
                },
                {
                  label: '状态',
                  children: (
                    <StatusBadge
                      tone={
                        (EVENT_STATUS_META[eventDetail.status] ?? { tone: 'neutral' as const }).tone
                      }
                      label={EVENT_STATUS_META[eventDetail.status]?.label ?? eventDetail.status}
                      hint={eventDetail.status}
                    />
                  ),
                },
                {
                  label: '平台事件 ID',
                  children: eventDetail.externalEventId ?? '（无，按 payload hash 去重）',
                },
                {
                  label: 'Payload Hash',
                  children: (
                    <span style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {eventDetail.payloadHash}
                    </span>
                  ),
                },
                { label: '接收时间', children: fmtDateTime(eventDetail.receivedAt) },
                {
                  label: '处理时间',
                  children:
                    eventDetail.processedAt === null ? '—' : fmtDateTime(eventDetail.processedAt),
                },
              ]}
            />
            <section>
              <DrawerSectionTitle>原始报文</DrawerSectionTitle>
              <RawDataBlock data={eventDetail.payload} />
            </section>
          </Space>
        )}
      </Drawer>

      {/* ---- Manual trigger modal ---- */}
      <Modal
        title="立即同步"
        open={triggerOpen}
        afterOpenChange={(open) => {
          if (!open) {
            triggerForm.resetFields();
          }
        }}
        onCancel={() => setTriggerOpen(false)}
        onOk={() =>
          void triggerForm.validateFields().then((values) => {
            const store = (stores.data?.data ?? []).find((item) => item.id === values.storeId);
            triggerMutation.mutate({
              type: values.type as 'orders' | 'listings',
              storeId: values.storeId as string,
              storeLabel: store === undefined ? '' : `${store.storeCode} · ${store.name}`,
            });
          })
        }
        confirmLoading={triggerMutation.isPending}
      >
        <Form form={triggerForm} layout="vertical" initialValues={{ type: 'orders' }}>
          <Form.Item
            name="storeId"
            label="店铺"
            rules={[{ required: true, message: '请选择店铺' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择要同步的店铺"
              options={(stores.data?.data ?? []).map((store) => ({
                value: store.id,
                label: `${store.storeCode} · ${store.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="type" label="同步类型">
            <Radio.Group
              options={[
                { value: 'orders', label: '订单同步' },
                { value: 'listings', label: '商品（Listing）同步' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function DrawerSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}>
      {children}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  const color =
    tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.textPrimary;
  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <span style={{ fontSize: 12, color: colors.textTertiary }}>{label}</span>
      <span
        style={{
          fontSize: 20,
          fontWeight: 650,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CursorField({ label, value }: { label: string; value: Record<string, unknown> | null }) {
  return (
    <div>
      <span style={{ fontSize: 12.5, color: colors.textTertiary }}>{label}</span>
      <Typography.Paragraph style={{ margin: 0 }}>
        <Typography.Text code copyable style={{ fontSize: 12 }}>
          {JSON.stringify(value)}
        </Typography.Text>
      </Typography.Paragraph>
    </div>
  );
}
