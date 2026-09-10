import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tooltip,
} from 'antd';
import {
  CloudSyncOutlined,
  ShopOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtNumber } from '../../utils/format';
import {
  ActionMenu,
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  ErrorState,
  FilterBar,
  PageHeader,
  PlatformTag,
  RelativeTime,
  SectionCard,
  StatusBadge,
  SyncStatusBadge,
  MetricCard,
  useContextRail,
} from '../../design-system';

/**
 * Stores workbench (Phase 2 task §7-§11): KPI cards answering "哪些店铺正常/
 * 哪些需要处理", a dense store table with per-store sync health derived from
 * the latest sync jobs, a context rail and a detail drawer. All existing
 * Sprint business actions (create store, credentials, manual sync, enable/
 * disable) are preserved unchanged.
 */

interface StoreRow {
  id: string;
  platformId: string;
  platformCode: string;
  platformName: string;
  storeCode: string;
  name: string;
  sellerId: string | null;
  defaultCurrency: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  credentialConfigured: boolean;
  bindingCount: number;
}

interface SyncJobLite {
  id: string;
  storeId: string;
  syncType: 'ORDER_SYNC' | 'LISTING_SYNC';
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

interface SyncOverview {
  storeId: string;
  platformCode: string;
  credential: {
    credentialId: string | null;
    configured: boolean;
    lastValidatedAt: string | null;
    lastValidationStatus: string | null;
    lastValidationError: string | null;
  } | null;
  lastOrderSync: { status: string; finishedAt: string | null } | null;
  lastListingSync: { status: string; finishedAt: string | null } | null;
  consecutiveFailures: number;
  activeJobId: string | null;
}

interface CredentialRow {
  id: string;
  credentialType: string;
  status: string;
  configured: boolean;
  lastValidatedAt: string | null;
  lastValidationStatus: string | null;
  lastValidationError: string | null;
  updatedAt: string;
}

interface BindingRow {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  fulfillmentMode: string;
  status: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

/** Latest job per store per sync type, derived once from the recent-jobs query. */
function buildLatestJobMap(jobs: SyncJobLite[]): Map<string, SyncJobLite> {
  const map = new Map<string, SyncJobLite>();
  for (const job of jobs) {
    const key = `${job.storeId}:${job.syncType}`;
    const current = map.get(key);
    if (current === undefined || job.createdAt > current.createdAt) {
      map.set(key, job);
    }
  }
  return map;
}

function latestJobAt(latest: Map<string, SyncJobLite>, storeId: string): SyncJobLite | undefined {
  const order = latest.get(`${storeId}:ORDER_SYNC`);
  const listing = latest.get(`${storeId}:LISTING_SYNC`);
  if (order === undefined) {
    return listing;
  }
  if (listing === undefined) {
    return order;
  }
  return order.createdAt >= listing.createdAt ? order : listing;
}

export function StoresPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [platformId, setPlatformId] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [credentialOpen, setCredentialOpen] = useState(false);
  const [form] = Form.useForm();
  const [credentialForm] = Form.useForm();

  // Deep link from the global palette: focus=<storeId> selects the row and
  // opens its detail drawer (Phase 2 task §33).
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (focus !== null) {
      setSelectedId(focus);
      setDetailId(focus);
    }
  }, [searchParams]);

  const effectiveKeyword = keyword.trim();

  const list = useApiQuery<Envelope<StoreRow[]>>(
    '/api/v1/stores',
    {
      page,
      pageSize: 50,
      ...(platformId ? { platformId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(effectiveKeyword ? { keyword: effectiveKeyword } : {}),
    },
    ['stores', page, platformId, statusFilter, effectiveKeyword],
  );
  const platforms = useApiQuery<Envelope<Array<{ id: string; code: string; name: string }>>>(
    '/api/v1/platforms',
    {},
    ['platforms-for-stores'],
  );
  // One recent-jobs query feeds every store row's sync health (task §76).
  const recentJobs = useApiQuery<Envelope<SyncJobLite[]>>(
    '/api/v1/sync/jobs',
    { page: 1, pageSize: 100 },
    ['sync-jobs-recent'],
  );

  const rows = list.data?.data ?? [];
  const latest = useMemo(() => buildLatestJobMap(recentJobs.data?.data ?? []), [recentJobs.data]);

  // Per-store overview is fetched once for whichever store is focused
  // (rail preview or drawer) — a single cached call, not per row.
  const focusId = selectedId ?? detailId;
  const overviewQuery = useApiQuery<{ data: SyncOverview }>(
    '/api/v1/sync/stores/{storeId}/overview',
    {},
    ['store-sync-overview', focusId],
    { storeId: focusId ?? '' },
    focusId !== null,
  );
  const overview = overviewQuery.data?.data;
  const credentials = useApiQuery<Envelope<CredentialRow[]>>(
    '/api/v1/stores/{storeId}/credentials',
    {},
    ['store-credentials', detailId],
    { storeId: detailId ?? '' },
    detailId !== null,
  );
  const bindings = useApiQuery<Envelope<BindingRow[]>>(
    '/api/v1/stores/{storeId}/warehouse-bindings',
    { page: 1, pageSize: 50 },
    ['store-bindings', detailId],
    { storeId: detailId ?? '' },
    detailId !== null,
  );

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = useMemo(
    () => rows.find((row) => row.id === detailId) ?? null,
    [rows, detailId],
  );

  const refreshStore = (id: string | null) => {
    void queryClient.invalidateQueries({ queryKey: ['stores'] });
    if (id !== null) {
      void queryClient.invalidateQueries({ queryKey: ['store-detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['store-credentials', id] });
      void queryClient.invalidateQueries({ queryKey: ['store-sync-overview', id] });
    }
  };

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiPost('/api/v1/stores', values),
    onSuccess: () => {
      void message.success('店铺已创建');
      setCreateOpen(false);
      form.resetFields();
      refreshStore(null);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const credentialMutation = useMutation({
    mutationFn: (values: { clientId: string; apiKey: string }) =>
      apiPost(
        '/api/v1/stores/{storeId}/credentials',
        { credentialType: 'MAIN_API', payload: values },
        { storeId: detailId ?? '' },
      ),
    onSuccess: () => {
      void message.success('凭证已加密保存');
      setCredentialOpen(false);
      credentialForm.resetFields();
      refreshStore(detailId);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const validateMutation = useMutation({
    mutationFn: (credentialId: string) =>
      apiPost<{ validationStatus: string; error: string | null }>(
        '/api/v1/stores/{storeId}/credentials/{id}/validate',
        {},
        { storeId: detailId ?? '', id: credentialId },
      ),
    onSuccess: (result) => {
      if (result.validationStatus === 'VALID') {
        void message.success('连接验证通过');
      } else if (result.validationStatus === 'INVALID') {
        void message.error(`认证失败：${result.error ?? ''}`);
      } else {
        void message.warning(`验证出错：${result.error ?? ''}`);
      }
      refreshStore(detailId);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: ({ storeId, type }: { storeId: string; type: 'orders' | 'listings' }) =>
      apiPost<SyncJobLite>(`/api/v1/sync/${type}`, { storeId }),
    onSuccess: () => {
      void message.success('同步任务已创建，可在同步中心查看进度');
      void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
      void queryClient.invalidateQueries({ queryKey: ['store-sync-overview'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/stores/{id}/${action}`, {}, { id }),
    onSuccess: () => {
      void message.success('状态已更新');
      refreshStore(null);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ---- KPI (task §8.1): derived from the loaded page + latest jobs only ----
  const kpi = useMemo(() => {
    const syncFailed = rows.filter(
      (row) => latestJobAt(latest, row.id)?.status === 'FAILED',
    ).length;
    const needsAttention = rows.filter((row) => {
      if (row.status !== 'ACTIVE') {
        return false;
      }
      if (!row.credentialConfigured) {
        return true;
      }
      const job = latestJobAt(latest, row.id);
      return job !== undefined && job.status === 'PARTIAL';
    }).length;
    const healthy = rows.filter((row) => {
      if (row.status !== 'ACTIVE' || !row.credentialConfigured) {
        return false;
      }
      const job = latestJobAt(latest, row.id);
      return job === undefined || (job.status !== 'FAILED' && job.status !== 'PARTIAL');
    }).length;
    const inactive = rows.filter((row) => row.status !== 'ACTIVE').length;
    return { syncFailed, needsAttention, healthy, inactive };
  }, [rows, latest]);

  const triggerFor = (storeId: string, type: 'orders' | 'listings') => {
    syncMutation.mutate({ storeId, type });
  };

  // ---- Context rail (task §10) ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="店铺概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 家店铺`} />
            <ContextMetric
              label={<span style={{ color: colors.danger }}>同步异常</span>}
              value={kpi.syncFailed}
            />
            <ContextMetric label="需要关注" value={kpi.needsAttention} />
            <ContextMetric label="正常" value={kpi.healthy} />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击店铺行查看连接与同步状态；可从右栏直接触发手动同步。
            </span>
          </ContextSection>
        ),
      };
    }
    const job = latestJobAt(latest, selectedRow.id);
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.name}
          subtitle={selectedRow.storeCode}
          badge={
            <StatusBadge
              tone={selectedRow.status === 'ACTIVE' ? 'success' : 'neutral'}
              label={selectedRow.status === 'ACTIVE' ? '正常' : '停用'}
              hint={selectedRow.status}
            />
          }
          meta={<PlatformTag code={selectedRow.platformCode} suffix={selectedRow.platformName} />}
        />
      ),
      children: (
        <>
          <ContextSection title="连接状态">
            <ContextMetric
              label="API 凭证"
              value={
                selectedRow.credentialConfigured ? (
                  <span style={{ color: colors.success }}>已配置</span>
                ) : (
                  <span style={{ color: colors.warning }}>未配置</span>
                )
              }
            />
            {overview?.credential?.lastValidationStatus !== undefined &&
              overview?.credential !== null && (
                <ContextMetric
                  label="验证状态"
                  value={
                    overview.credential.lastValidationStatus === 'VALID'
                      ? '已连接'
                      : overview.credential.lastValidationStatus === 'INVALID'
                        ? '认证失败'
                        : '未验证'
                  }
                />
              )}
            <ContextMetric label="绑定仓库" value={`${selectedRow.bindingCount} 个`} />
          </ContextSection>
          <ContextSection title="最近同步">
            <ContextMetric
              label="最后同步"
              value={
                job ? (
                  <SyncStatusBadge status={job.status} />
                ) : (
                  <span style={{ color: colors.textTertiary }}>从未同步</span>
                )
              }
            />
            {job !== undefined && (
              <ContextMetric
                label="同步时间"
                value={<RelativeTime value={job.finishedAt ?? job.createdAt} />}
              />
            )}
            {overview !== undefined && overview.consecutiveFailures > 0 && (
              <ContextMetric
                label={<span style={{ color: colors.danger }}>连续失败</span>}
                value={overview.consecutiveFailures}
              />
            )}
          </ContextSection>
          <ContextAction>
            <Space direction="vertical" style={{ width: '100%' }} size={8}>
              <Button block onClick={() => setDetailId(selectedRow.id)}>
                查看详情
              </Button>
              <Dropdown
                menu={{
                  items: [
                    { key: 'orders', label: '同步订单' },
                    { key: 'listings', label: '同步商品（Listing）' },
                  ],
                  onClick: ({ key }) =>
                    triggerFor(selectedRow.id, key === 'orders' ? 'orders' : 'listings'),
                }}
                trigger={['click']}
              >
                <Button block icon={<CloudSyncOutlined />} loading={syncMutation.isPending}>
                  立即同步
                </Button>
              </Dropdown>
            </Space>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, overview, latest, kpi, list.data, syncMutation.isPending, syncMutation]);
  useContextRail(railContent);

  const columns = [
    {
      title: '店铺',
      dataIndex: 'name',
      key: 'name',
      render: (_: unknown, row: StoreRow) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.name}
          </div>
          <div style={{ fontSize: 12.5, color: colors.textTertiary }}>{row.storeCode}</div>
        </div>
      ),
    },
    {
      title: '平台',
      dataIndex: 'platformCode',
      key: 'platform',
      width: 120,
      render: (_: unknown, row: StoreRow) => <PlatformTag code={row.platformCode} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: string) => (
        <StatusBadge
          tone={value === 'ACTIVE' ? 'success' : 'neutral'}
          label={value === 'ACTIVE' ? '启用' : '停用'}
          hint={value}
        />
      ),
    },
    {
      title: '授权',
      dataIndex: 'credentialConfigured',
      key: 'credential',
      width: 96,
      render: (value: boolean) =>
        value ? (
          <StatusBadge tone="success" label="已配置" />
        ) : (
          <StatusBadge tone="warning" label="未连接" />
        ),
    },
    {
      title: '商品同步',
      key: 'listingSync',
      width: 100,
      render: (_: unknown, row: StoreRow) => {
        const job = latest.get(`${row.id}:LISTING_SYNC`);
        return job === undefined ? (
          <span style={{ color: colors.textTertiary }}>—</span>
        ) : (
          <SyncStatusBadge status={job.status} />
        );
      },
    },
    {
      title: '订单同步',
      key: 'orderSync',
      width: 100,
      render: (_: unknown, row: StoreRow) => {
        const job = latest.get(`${row.id}:ORDER_SYNC`);
        return job === undefined ? (
          <span style={{ color: colors.textTertiary }}>—</span>
        ) : (
          <SyncStatusBadge status={job.status} />
        );
      },
    },
    {
      title: '最后同步',
      key: 'lastSync',
      width: 110,
      render: (_: unknown, row: StoreRow) => {
        const job = latestJobAt(latest, row.id);
        return <RelativeTime value={job?.finishedAt ?? job?.createdAt} />;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 92,
      render: (_: unknown, row: StoreRow) => (
        <ActionMenu
          primary={
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              onClick={() => setDetailId(row.id)}
            >
              详情
            </Button>
          }
          items={[
            {
              key: 'sync-orders',
              label: '同步订单',
              icon: <CloudSyncOutlined />,
              onClick: () => triggerFor(row.id, 'orders'),
            },
            {
              key: 'sync-listings',
              label: '同步商品（Listing）',
              icon: <CloudSyncOutlined />,
              onClick: () => triggerFor(row.id, 'listings'),
            },
            {
              key: 'exceptions',
              label: '查看异常',
              icon: <WarningOutlined />,
              onClick: () => {
                setSelectedId(null);
                void navigate(`/exceptions?storeId=${row.id}`);
              },
            },
            { type: 'divider' },
            {
              key: 'toggle',
              danger: row.status === 'ACTIVE',
              label: row.status === 'ACTIVE' ? '停用店铺' : '启用店铺',
              onClick: () =>
                statusMutation.mutate({
                  id: row.id,
                  action: row.status === 'ACTIVE' ? 'deactivate' : 'activate',
                }),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="店铺管理"
        description="管理所有销售平台店铺、连接状态与同步状态"
        secondary={
          <Tooltip title="刷新列表与同步状态">
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ['stores'] });
                void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
              }}
            >
              刷新
            </Button>
          </Tooltip>
        }
        primary={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            添加店铺
          </Button>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <MetricCard
          icon={<ShopOutlined />}
          title="全部店铺"
          value={fmtNumber(list.data?.meta.total ?? 0)}
          aux={kpi.inactive > 0 ? `其中停用 ${kpi.inactive}` : undefined}
        />
        <MetricCard
          icon={<ShopOutlined />}
          title="正常"
          value={fmtNumber(kpi.healthy)}
          aux="启用且凭证已配置"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="需要关注"
          value={fmtNumber(kpi.needsAttention)}
          aux="凭证未配置或部分成功"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="同步异常"
          value={fmtNumber(kpi.syncFailed)}
          aux="最近任务失败"
        />
      </div>

      <FilterBar>
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 140 }}
          value={platformId}
          onChange={(value) => {
            setPage(1);
            setPlatformId(value);
          }}
          options={(platforms.data?.data ?? []).map((platform) => ({
            value: platform.id,
            label: platform.code,
          }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 110 }}
          value={statusFilter}
          onChange={(value) => {
            setPage(1);
            setStatusFilter(value);
          }}
          options={[
            { value: 'ACTIVE', label: '启用' },
            { value: 'INACTIVE', label: '停用' },
          ]}
        />
        <Input.Search
          placeholder="搜索店铺编码 / 名称"
          allowClear
          defaultValue={effectiveKeyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['stores'] })}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<StoreRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            columns={columns}
            emptyTitle="暂无店铺"
            emptyDescription="调整筛选条件，或点击右上角添加店铺"
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
          />
        )}
      </SectionCard>

      {/* ---- Store detail drawer (task §11) ---- */}
      <Drawer
        title={detailRow !== null ? `${detailRow.name}（${detailRow.storeCode}）` : '店铺详情'}
        width={640}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        destroyOnHidden
      >
        {detailRow !== null && (
          <StoreDetailBody
            store={detailRow}
            overview={overview}
            credentials={credentials.data?.data ?? []}
            credentialsLoading={credentials.isLoading}
            bindings={bindings.data?.data ?? []}
            bindingsLoading={bindings.isLoading}
            onValidate={(id) => validateMutation.mutate(id)}
            validating={validateMutation.isPending}
            onConfigure={() => setCredentialOpen(true)}
            onSync={(type) => triggerFor(detailRow.id, type)}
            syncing={syncMutation.isPending}
            onToggle={() =>
              statusMutation.mutate({
                id: detailRow.id,
                action: detailRow.status === 'ACTIVE' ? 'deactivate' : 'activate',
              })
            }
            toggling={statusMutation.isPending}
          />
        )}
      </Drawer>

      {/* ---- Create store modal (existing business flow) ---- */}
      <Modal
        title="添加店铺"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="platformId" label="平台" rules={[{ required: true }]}>
            <Select
              options={(platforms.data?.data ?? []).map((platform) => ({
                value: platform.id,
                label: `${platform.code} · ${platform.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="storeCode" label="店铺编码" rules={[{ required: true }]}>
            <Input placeholder="如 OZON-A" />
          </Form.Item>
          <Form.Item name="name" label="店铺名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="sellerId" label="Seller ID">
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="defaultCurrency" label="币种" initialValue="RUB">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'RUB', label: 'RUB' },
                  { value: 'CNY', label: 'CNY' },
                  { value: 'USD', label: 'USD' },
                ]}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* ---- Credential modal (existing business flow) ---- */}
      <Modal
        title="配置 MAIN_API 凭证"
        open={credentialOpen}
        onCancel={() => setCredentialOpen(false)}
        onOk={() =>
          void credentialForm.validateFields().then((values) => credentialMutation.mutate(values))
        }
        confirmLoading={credentialMutation.isPending}
      >
        <Form form={credentialForm} layout="vertical">
          <Form.Item
            name="clientId"
            label="Client ID"
            rules={[{ required: true, message: '请输入 Client ID' }]}
          >
            <Input placeholder="OZON 后台的 Client ID" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="加密存储，不会回显" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** Drawer body: 基础信息 / Connection / 同步状态 / 仓库绑定 (task §11). */
function StoreDetailBody({
  store,
  overview,
  credentials,
  credentialsLoading,
  bindings,
  bindingsLoading,
  onValidate,
  validating,
  onConfigure,
  onSync,
  syncing,
  onToggle,
  toggling,
}: {
  store: StoreRow;
  overview: SyncOverview | undefined;
  credentials: CredentialRow[];
  credentialsLoading: boolean;
  bindings: BindingRow[];
  bindingsLoading: boolean;
  onValidate: (credentialId: string) => void;
  validating: boolean;
  onConfigure: () => void;
  onSync: (type: 'orders' | 'listings') => void;
  syncing: boolean;
  onToggle: () => void;
  toggling: boolean;
}) {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <section>
        <SectionTitle>基础信息</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 0 }}>
          <InfoField label="店铺名称" value={store.name} />
          <InfoField label="店铺编码" value={store.storeCode} />
          <InfoField
            label="平台"
            value={<PlatformTag code={store.platformCode} suffix={store.platformName} />}
          />
          <InfoField
            label="Store ID"
            value={<span style={{ fontSize: 12, fontFamily: 'monospace' }}>{store.id}</span>}
          />
          <InfoField
            label="状态"
            value={
              <StatusBadge
                tone={store.status === 'ACTIVE' ? 'success' : 'neutral'}
                label={store.status === 'ACTIVE' ? '启用' : '停用'}
                hint={store.status}
              />
            }
          />
          <InfoField label="创建时间" value={fmtDateTime(store.createdAt)} />
          <InfoField label="Seller ID" value={store.sellerId ?? '—'} />
          <InfoField label="币种" value={store.defaultCurrency ?? '—'} />
        </div>
      </section>

      <section>
        <SectionTitle
          action={
            <Button size="small" type="primary" onClick={onConfigure}>
              配置 MAIN_API 凭证
            </Button>
          }
        >
          Connection / 凭证
        </SectionTitle>
        <DataTable<CredentialRow>
          rowKey="id"
          size="small"
          loading={credentialsLoading}
          dataSource={credentials}
          pagination={false}
          emptyTitle="暂无凭证"
          emptyDescription="配置 MAIN_API 凭证后才能连接平台"
          columns={[
            { title: '类型', dataIndex: 'credentialType', width: 110 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (value: string) => (
                <StatusBadge
                  tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                  label={value === 'ACTIVE' ? '启用' : value}
                  hint={value}
                />
              ),
            },
            {
              title: '验证状态',
              dataIndex: 'lastValidationStatus',
              width: 110,
              render: (value: string | null) =>
                value === 'VALID' ? (
                  <StatusBadge tone="success" label="已连接" />
                ) : value === 'INVALID' ? (
                  <StatusBadge tone="danger" label="认证失败" />
                ) : value === 'ERROR' ? (
                  <StatusBadge tone="warning" label="验证出错" />
                ) : (
                  <StatusBadge tone="neutral" label="未验证" />
                ),
            },
            {
              title: '最后验证',
              dataIndex: 'lastValidatedAt',
              render: (value: string | null) => <RelativeTime value={value} fallback="未验证" />,
            },
            {
              title: '操作',
              key: 'actions',
              width: 110,
              render: (_: unknown, row: CredentialRow) => (
                <Button size="small" loading={validating} onClick={() => onValidate(row.id)}>
                  验证连接
                </Button>
              ),
            },
          ]}
        />
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
          凭证加密存储，任何情况下不回显明文（•••••••）。
        </p>
      </section>

      <section>
        <SectionTitle>同步状态</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 0 }}>
          <InfoField
            label="订单同步（最近）"
            value={
              overview?.lastOrderSync ? (
                <Space size={6}>
                  <SyncStatusBadge status={overview.lastOrderSync.status} />
                  <RelativeTime value={overview.lastOrderSync.finishedAt} />
                </Space>
              ) : overview === undefined ? (
                '加载中…'
              ) : (
                '从未同步'
              )
            }
          />
          <InfoField
            label="商品同步（最近）"
            value={
              overview?.lastListingSync ? (
                <Space size={6}>
                  <SyncStatusBadge status={overview.lastListingSync.status} />
                  <RelativeTime value={overview.lastListingSync.finishedAt} />
                </Space>
              ) : overview === undefined ? (
                '加载中…'
              ) : (
                '从未同步'
              )
            }
          />
          <InfoField
            label="连续失败"
            value={
              overview !== undefined && overview.consecutiveFailures > 0 ? (
                <span style={{ color: colors.danger }}>{overview.consecutiveFailures} 次</span>
              ) : (
                '0 次'
              )
            }
          />
          <InfoField
            label="运行中任务"
            value={
              overview?.activeJobId !== undefined && overview.activeJobId !== null ? '有' : '无'
            }
          />
        </div>
        <Space style={{ marginTop: 12 }}>
          <Button type="primary" loading={syncing} onClick={() => onSync('orders')}>
            手动同步订单
          </Button>
          <Button loading={syncing} onClick={() => onSync('listings')}>
            手动同步商品（Listing）
          </Button>
        </Space>
      </section>

      <section>
        <SectionTitle>仓库绑定</SectionTitle>
        <DataTable<BindingRow>
          rowKey="id"
          size="small"
          loading={bindingsLoading}
          dataSource={bindings}
          pagination={false}
          emptyTitle="暂无仓库绑定"
          emptyDescription="店铺尚未绑定履约仓库"
          columns={[
            { title: '仓库', dataIndex: 'warehouseCode', width: 100 },
            { title: '名称', dataIndex: 'warehouseName' },
            { title: '履约模式', dataIndex: 'fulfillmentMode', width: 130 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (value: string) => (
                <StatusBadge
                  tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                  label={value === 'ACTIVE' ? '启用' : value}
                  hint={value}
                />
              ),
            },
          ]}
        />
      </section>

      <section>
        {store.status === 'ACTIVE' ? (
          <Button danger loading={toggling} onClick={onToggle}>
            停用店铺
          </Button>
        ) : (
          <Button type="primary" loading={toggling} onClick={onToggle}>
            启用店铺
          </Button>
        )}
      </section>
    </Space>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}
    >
      <span style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary }}>{children}</span>
      {action}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '9px 16px 9px 0',
        borderBottom: `1px solid ${colors.borderSoft}`,
      }}
    >
      <span style={{ fontSize: 12.5, color: colors.textTertiary }}>{label}</span>
      <span
        style={{
          fontSize: 13.5,
          color: colors.textPrimary,
          wordBreak: 'break-word',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
