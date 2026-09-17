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
  Popconfirm,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from 'antd';
import {
  CloudSyncOutlined,
  ShopOutlined,
  PlusOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useSearchParams, useNavigate } from 'react-router';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtNumber } from '../../utils/format';
import {
  ActionMenu,
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  DeleteConfirmModal,
  EntitySummary,
  EntityLink,
  ErrorState,
  FilterBar,
  InfoGrid,
  KpiRow,
  PageHeader,
  PlatformTag,
  RailHint,
  RelativeTime,
  SectionCard,
  StatusBadge,
  StatusSwitch,
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
  settings: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  credentialConfigured: boolean;
  bindingCount: number;
}

/** Sprint 9 T2: store sync toggles live under settings.sync (read-modify-write). */
function readSyncSettings(settings: Record<string, unknown> | null | undefined): {
  orderSyncEnabled: boolean;
  listingSyncEnabled: boolean;
} {
  const sync = settings?.['sync'];
  if (typeof sync !== 'object' || sync === null) {
    return { orderSyncEnabled: false, listingSyncEnabled: false };
  }
  const raw = sync as Record<string, unknown>;
  return {
    orderSyncEnabled: raw['orderSyncEnabled'] === true,
    listingSyncEnabled: raw['listingSyncEnabled'] === true,
  };
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
  lastCategoryTreeSync: { status: string; finishedAt: string | null } | null;
  lastProductEnrichmentSync: { status: string; finishedAt: string | null } | null;
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

/** Sprint 9 T2: staleness threshold for the order-sync freshness marker. */
const ORDER_SYNC_STALE_MS = 15 * 60 * 1000;

/**
 * 平台 → 主 API 凭证所需字段（用户建议 #14）。纯展示用静态映射：
 * OZON 走 Client ID + API Key（adapter 已接入，见 ozon.adapter.ts 的
 * `expected { clientId, apiKey }`）；WB / YANDEX 的 adapter 尚未接入，
 * 单 API Key 只是前端占位描述，以平台实际开通信息为准。
 */
interface PlatformCredentialSpec {
  /** 提示区文案：该平台需要哪些凭证字段。 */
  hint: string;
  /** true = 凭证表单需要 Client ID + API Key 两个字段。 */
  needsClientId: boolean;
}

const PLATFORM_CREDENTIAL_SPECS: Record<string, PlatformCredentialSpec> = {
  OZON: {
    hint: '所需凭证：Client ID + API Key。创建后可继续配置凭证。',
    needsClientId: true,
  },
  WB: {
    hint: '所需凭证：API 密钥（后端适配器尚未接入，以平台实际开通信息为准）。',
    needsClientId: false,
  },
  YANDEX: {
    hint: '所需凭证：API 密钥（后端适配器尚未接入，以平台实际开通信息为准）。',
    needsClientId: false,
  },
};

const GENERIC_CREDENTIAL_SPEC: PlatformCredentialSpec = {
  hint: '所需凭证：API 凭证（以平台实际开通信息为准）。',
  needsClientId: false,
};

function credentialSpecForPlatform(
  platformCode: string | null | undefined,
): PlatformCredentialSpec {
  if (platformCode !== undefined && platformCode !== null && platformCode !== '') {
    const spec = PLATFORM_CREDENTIAL_SPECS[platformCode];
    if (spec !== undefined) {
      return spec;
    }
  }
  return GENERIC_CREDENTIAL_SPEC;
}

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
  // 店铺基础信息编辑（改名）。此前页面无任何 PATCH /stores/{id} 的名称入口，
  // 后端契约一直支持（storeCode / platform 不可改）。
  const [editTarget, setEditTarget] = useState<StoreRow | null>(null);
  const [editForm] = Form.useForm<{ name: string }>();
  const [deleting, setDeleting] = useState<StoreRow | null>(null);
  const [credentialOpen, setCredentialOpen] = useState(false);
  // Id snapshot taken when the credential modal opens: the drawer's onClose
  // may null out detailId while the modal is open - the submission must use
  // the store it was opened for (modal chain fix).
  const [credentialStoreId, setCredentialStoreId] = useState<string | null>(null);
  // Platform code snapshot taken alongside the id: drives the per-platform
  // credential field labels (user suggestion #14). Kept in state because a
  // freshly created store may not be in `rows` yet when the modal opens.
  const [credentialPlatformCode, setCredentialPlatformCode] = useState<string | null>(null);
  // null = create a new credential; an id = replace that credential's payload.
  const [editingCredentialId, setEditingCredentialId] = useState<string | null>(null);
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
    ['sync-jobs', 'recent'],
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
  // Create modal: the credential hint follows the chosen platform. Derived
  // from the form's platformId (options only exist once platforms load).
  const createPlatformOptions = platforms.data?.data ?? [];
  const watchedCreatePlatformId = Form.useWatch('platformId', form);
  const createPlatformCode = useMemo(
    () =>
      createPlatformOptions.find((platform) => platform.id === watchedCreatePlatformId)?.code ??
      null,
    [createPlatformOptions, watchedCreatePlatformId],
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
    mutationFn: (values: Record<string, unknown>) => apiPost<StoreRow>('/api/v1/stores', values),
    onSuccess: (created) => {
      void message.success('店铺已创建');
      setCreateOpen(false);
      form.resetFields();
      refreshStore(null);
      // 用户建议 #14: creation flows straight into credential setup so the
      // user does not have to find the new row first. Cancelling there does
      // NOT undo the store - it is already created at this point.
      setDetailId(created.id);
      setSelectedId(created.id);
      openCredentialModalFor(created.id, created.platformCode);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const credentialMutation = useMutation({
    mutationFn: (values: {
      clientId?: string;
      apiKey: string;
      storeId: string;
      credentialId?: string;
    }) => {
      // Per-platform payload (user suggestion #14): platforms whose MAIN_API
      // needs only an API key must not submit an empty clientId — the payload
      // keys are decided by the adapter contract, OZON = { clientId, apiKey }.
      const payload = credentialSpecForPlatform(credentialPlatformCode).needsClientId
        ? { clientId: values.clientId ?? '', apiKey: values.apiKey }
        : { apiKey: values.apiKey };
      return values.credentialId === undefined
        ? apiPost(
            '/api/v1/stores/{storeId}/credentials',
            {
              credentialType: 'MAIN_API',
              payload,
            },
            { storeId: values.storeId },
          )
        : apiPatch(
            '/api/v1/stores/{storeId}/credentials/{id}',
            {
              credentialType: 'MAIN_API',
              payload,
            },
            { storeId: values.storeId, id: values.credentialId },
          );
    },
    onSuccess: (_data, variables) => {
      void message.success(
        variables.credentialId === undefined ? '凭证已加密保存' : '凭证已更新（重新加密）',
      );
      setCredentialOpen(false);
      setEditingCredentialId(null);
      credentialForm.resetFields();
      refreshStore(credentialStoreId);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // Enable / disable keep the stored secret; only the credential's status
  // changes, so a disabled key can be brought back without re-entering it.
  const credentialStatusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'enable' | 'disable' }) =>
      apiPost(
        `/api/v1/stores/{storeId}/credentials/{id}/${action}`,
        {},
        { storeId: detailId ?? '', id },
      ),
    onSuccess: (_data, variables) => {
      void message.success(variables.action === 'enable' ? '凭证已启用' : '凭证已停用');
      refreshStore(detailId);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const credentialDeleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiDelete('/api/v1/stores/{storeId}/credentials/{id}', { storeId: detailId ?? '', id }),
    onSuccess: () => {
      void message.success('凭证已删除');
      refreshStore(detailId);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  /** Opens the credential modal for a known store + its platform code (field labels follow the platform). */
  const openCredentialModalFor = (storeId: string, platformCode: string | null) => {
    setCredentialStoreId(storeId);
    setCredentialPlatformCode(platformCode);
    setEditingCredentialId(null);
    credentialForm.resetFields();
    setCredentialOpen(true);
  };

  const openCredentialModal = (storeId: string) => {
    // Manual opens come from the store list / drawer: resolve the platform
    // from the loaded rows so the field labels stay platform-aware.
    const store = rows.find((row) => row.id === storeId) ?? null;
    openCredentialModalFor(storeId, store !== null ? store.platformCode : null);
  };

  /** Editing re-encrypts a replacement payload (the stored secret never leaves the server). */
  const openEditCredentialModal = (storeId: string, credentialId: string) => {
    openCredentialModalFor(storeId, detailRow !== null ? detailRow.platformCode : null);
    setEditingCredentialId(credentialId);
  };

  const submitCredential = () => {
    if (credentialStoreId === null) {
      void message.error('店铺上下文丢失，请重新打开后重试');
      return;
    }
    void credentialForm.validateFields().then((values) =>
      credentialMutation.mutate({
        ...values,
        storeId: credentialStoreId,
        credentialId: editingCredentialId ?? undefined,
      }),
    );
  };

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

  // Sprint 9 T2: toggle settings.sync.orderSyncEnabled / listingSyncEnabled
  // through the existing PATCH /stores/:id (backend merges, never replaces).
  const syncSettingsMutation = useMutation({
    mutationFn: ({
      store,
      patch,
    }: {
      store: StoreRow;
      patch: Partial<{ orderSyncEnabled: boolean; listingSyncEnabled: boolean }>;
    }) => {
      const current = readSyncSettings(store.settings);
      const next = { ...current, ...patch };
      return apiPatch(
        '/api/v1/stores/{id}',
        {
          settings: {
            ...(store.settings ?? {}),
            sync: {
              orderSyncEnabled: next.orderSyncEnabled,
              listingSyncEnabled: next.listingSyncEnabled,
            },
          },
        },
        { id: store.id },
      );
    },
    onSuccess: (_data, variables) => {
      void message.success('同步设置已保存');
      void queryClient.invalidateQueries({ queryKey: ['stores'] });
      void queryClient.invalidateQueries({
        queryKey: ['store-sync-overview', variables.store.id],
      });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/stores/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('店铺已删除');
      if (detailId === id) {
        setDetailId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      refreshStore(null);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const renameStoreMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiPatch('/api/v1/stores/{id}', { name }, { id }),
    onSuccess: () => {
      void message.success('店铺已保存');
      setEditTarget(null);
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
            <RailHint>
              店铺健康度见上方指标卡；点击店铺行查看连接与同步状态，可从右栏直接触发手动同步。
            </RailHint>
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
              label={selectedRow.status === 'ACTIVE' ? '启用' : '停用'}
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
          <ContextSection title="基本信息">
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="店铺"
              disableHint="停用后不再同步订单与商品"
              loading={statusMutation.isPending}
              onChange={(next) =>
                statusMutation.mutate({
                  id: selectedRow.id,
                  action: next ? 'activate' : 'deactivate',
                })
              }
            />
          </ContextSection>
          {selectedRow.status !== 'CANCELLED' && (
            <ContextSection title="关联操作">
              <EntityLink
                to={`/exceptions?storeId=${selectedRow.id}`}
                icon={<WarningOutlined />}
                primary="查看该店铺异常"
              />
            </ContextSection>
          )}
          <ContextAction>
            <Space orientation="vertical" style={{ width: '100%' }} size={8}>
              <Button block onClick={() => setDetailId(selectedRow.id)}>
                查看详情
              </Button>
              <Dropdown
                menu={{
                  items: [
                    { key: 'orders', label: '同步订单' },
                    { key: 'listings', label: '同步商品链接' },
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
              <Button
                block
                onClick={() => {
                  setEditTarget(selectedRow);
                  editForm.setFieldsValue({ name: selectedRow.name });
                }}
              >
                编辑
              </Button>
              <Button block danger onClick={() => setDeleting(selectedRow)}>
                删除
              </Button>
            </Space>
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    overview,
    latest,
    kpi,
    list.data,
    syncMutation.isPending,
    statusMutation.isPending,
    statusMutation.mutate,
  ]);
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
          showDot={false}
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
            新建店铺
          </Button>
        }
      />

      <KpiRow>
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
      </KpiRow>

      <FilterBar>
        <Input.Search
          placeholder="搜索店铺编码 / 名称"
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索店铺"
        />
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 140 }}
          showSearch
          optionFilterProp="label"
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
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              onDoubleClick: () => setDetailId(record.id),
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
        size={640}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        destroyOnHidden
        extra={
          detailRow !== null && (
            <Space>
              <Button
                size="small"
                onClick={() => {
                  void navigate(`/store-bindings?storeId=${detailRow.id}`);
                }}
              >
                管理绑定
              </Button>
              <Button size="small" danger onClick={() => setDeleting(detailRow)}>
                删除
              </Button>
            </Space>
          )
        }
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
            onEditCredential={(id) =>
              detailRow !== null && openEditCredentialModal(detailRow.id, id)
            }
            onToggleCredential={(id, action) => credentialStatusMutation.mutate({ id, action })}
            onDeleteCredential={(credential) => credentialDeleteMutation.mutate(credential.id)}
            onConfigure={() => detailRow !== null && openCredentialModal(detailRow.id)}
            onToggleSyncSetting={(patch) =>
              syncSettingsMutation.mutate({ store: detailRow, patch })
            }
            syncSettingsSaving={syncSettingsMutation.isPending}
          />
        )}
      </Drawer>

      {/* ---- Delete store (L2, shared DS modal) ---- */}
      <DeleteConfirmModal
        open={deleting !== null}
        title={`删除店铺 ${deleting?.name ?? ''}？`}
        description="仅零引用（无凭证/绑定/商品链接/订单/同步记录）的店铺可删除；被引用时会返回具体原因。"
        confirmLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            deleteMutation.mutate(deleting.id);
          }
        }}
        onCancel={() => setDeleting(null)}
      />

      {/* ---- Create store modal (existing business flow) ---- */}
      <Modal
        title="新建店铺"
        open={createOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
            店铺编码创建后自动生成（按平台递增：ON/WS/YX-序号）。
          </p>
          <Form.Item name="platformId" label="平台" rules={[{ required: true }]}>
            <Select
              options={createPlatformOptions.map((platform) => ({
                value: platform.id,
                label: platform.name,
              }))}
            />
          </Form.Item>
          {(() => {
            const spec = credentialSpecForPlatform(createPlatformCode);
            return (
              <Typography.Text
                type="secondary"
                style={{ display: 'block', fontSize: 12.5, marginBottom: 12 }}
              >
                {spec.hint}
              </Typography.Text>
            );
          })()}
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

      {/* ---- Credential modal (create or replace payload) ---- */}
      <Modal
        title={editingCredentialId === null ? '配置主 API 凭证' : '编辑主 API 凭证（替换密钥）'}
        open={credentialOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            credentialForm.resetFields();
            setEditingCredentialId(null);
            setCredentialPlatformCode(null);
          }
        }}
        onCancel={() => setCredentialOpen(false)}
        onOk={submitCredential}
        confirmLoading={credentialMutation.isPending}
      >
        {(() => {
          const configured = (credentials.data?.data ?? [])[0];
          return configured !== undefined ? (
            <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
              当前已配置：主 API · 更新时间 {fmtDateTime(configured.updatedAt)}。
              提交后将以新值覆盖（密钥加密存储，不回显）。
            </p>
          ) : (
            <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
              尚未配置凭证。密钥加密存储，不会回显。
            </p>
          );
        })()}
        <Form form={credentialForm} layout="vertical">
          {(() => {
            // 字段标签按平台联动（用户建议 #14）：OZON 需要 Client ID + API Key，
            // 其他平台只显示单个 API Key 输入（clientId 隐藏且不提交）。
            const spec = credentialSpecForPlatform(credentialPlatformCode);
            return (
              <>
                {spec.needsClientId && (
                  <Form.Item
                    name="clientId"
                    label="Client ID"
                    rules={[{ required: true, message: '请输入 Client ID' }]}
                  >
                    <Input placeholder="OZON 后台的 Client ID" />
                  </Form.Item>
                )}
                <Form.Item
                  name="apiKey"
                  label="API Key"
                  extra={
                    spec.needsClientId
                      ? undefined
                      : '后端适配器尚未接入该平台，字段要求以平台实际开通信息为准。'
                  }
                  rules={[{ required: true, message: '请输入 API Key' }]}
                >
                  <Input.Password placeholder="加密存储，不会回显" />
                </Form.Item>
              </>
            );
          })()}
        </Form>
      </Modal>

      <Modal
        title={`编辑店铺：${editTarget?.storeCode ?? ''}`}
        open={editTarget !== null}
        onCancel={() => setEditTarget(null)}
        onOk={() => {
          void editForm.validateFields().then((values) =>
            renameStoreMutation.mutate({
              id: (editTarget as StoreRow).id,
              name: values.name.trim(),
            }),
          );
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameStoreMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={editForm}
          layout="vertical"
          preserve={false}
          initialValues={{ name: editTarget === null ? '' : editTarget.name }}
        >
          <Form.Item
            name="name"
            label="店铺名称"
            rules={[
              { required: true, message: '请输入店铺名称' },
              { max: 200, message: '最长 200 字' },
            ]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <span style={{ fontSize: 12.5, color: colors.textTertiary, display: 'block' }}>
            店铺编码与所属平台不可修改；改名会记入操作日志。
          </span>
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
  onEditCredential,
  onToggleCredential,
  onDeleteCredential,
  onConfigure,
  onToggleSyncSetting,
  syncSettingsSaving,
}: {
  store: StoreRow;
  overview: SyncOverview | undefined;
  credentials: CredentialRow[];
  credentialsLoading: boolean;
  bindings: BindingRow[];
  bindingsLoading: boolean;
  onValidate: (credentialId: string) => void;
  validating: boolean;
  onEditCredential: (credentialId: string) => void;
  onToggleCredential: (credentialId: string, action: 'enable' | 'disable') => void;
  onDeleteCredential: (credential: CredentialRow) => void;
  onConfigure: () => void;
  onToggleSyncSetting: (
    patch: Partial<{ orderSyncEnabled: boolean; listingSyncEnabled: boolean }>,
  ) => void;
  syncSettingsSaving: boolean;
}) {
  const syncSettings = readSyncSettings(store.settings);
  // Sprint 9 T2 freshness: automatic polling is ON but the last successful
  // order sync is older than 3x the 300s interval -> flag red.
  const lastOrderFinishedAt = overview?.lastOrderSync?.finishedAt ?? null;
  const orderSyncStale =
    syncSettings.orderSyncEnabled &&
    lastOrderFinishedAt !== null &&
    Date.now() - new Date(lastOrderFinishedAt).getTime() > ORDER_SYNC_STALE_MS;
  return (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <section>
        <div
          style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}
        >
          基础信息
        </div>
        <InfoGrid
          columns={2}
          items={[
            { label: '店铺名称', children: store.name },
            { label: '店铺编码', children: store.storeCode },
            {
              label: '平台',
              children: <PlatformTag code={store.platformCode} suffix={store.platformName} />,
            },
            {
              label: '店铺 ID',
              children: <span style={{ fontSize: 12, fontFamily: 'monospace' }}>{store.id}</span>,
            },
            {
              label: '状态',
              children: (
                <StatusBadge
                  tone={store.status === 'ACTIVE' ? 'success' : 'neutral'}
                  label={store.status === 'ACTIVE' ? '启用' : '停用'}
                  hint={store.status}
                  showDot={false}
                />
              ),
            },
            { label: '创建时间', children: fmtDateTime(store.createdAt) },
            { label: 'Seller ID', children: store.sellerId ?? '—' },
            { label: '币种', children: store.defaultCurrency ?? '—' },
          ]}
        />
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary }}>
            Connection / 凭证
          </span>
          {
            <Button size="small" type="primary" onClick={onConfigure}>
              配置主 API 凭证
            </Button>
          }
        </div>
        <DataTable<CredentialRow>
          rowKey="id"
          size="small"
          loading={credentialsLoading}
          dataSource={credentials}
          pagination={false}
          emptyTitle="暂无凭证"
          emptyDescription="配置主 API 凭证后才能连接平台"
          columns={[
            {
              title: '类型',
              dataIndex: 'credentialType',
              width: 110,
              render: (value: string) => (value === 'MAIN_API' ? '主 API' : value),
            },
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
              width: 210,
              render: (_: unknown, row: CredentialRow) => (
                <Space size={4}>
                  <Button
                    size="small"
                    loading={validating}
                    disabled={row.status !== 'ACTIVE'}
                    onClick={() => onValidate(row.id)}
                  >
                    验证
                  </Button>
                  <ActionMenu
                    items={[
                      {
                        key: 'edit',
                        label: '编辑（替换密钥）',
                        onClick: () => onEditCredential(row.id),
                      },
                      row.status === 'ACTIVE'
                        ? {
                            key: 'disable',
                            label: '停用',
                            onClick: () => onToggleCredential(row.id, 'disable'),
                          }
                        : {
                            key: 'enable',
                            label: '启用',
                            onClick: () => onToggleCredential(row.id, 'enable'),
                          },
                    ]}
                  />
                  {/* 子资源行删除 = small danger + Popconfirm（UI 规范 §7）。 */}
                  <Popconfirm
                    title="确认删除该凭证？"
                    description="删除后需重新录入 Client ID 与 API Key 才能连接平台。"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => onDeleteCredential(row)}
                  >
                    <Button size="small" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
          凭证加密存储，任何情况下不回显明文（•••••••）。
        </p>
      </section>

      <section>
        <div
          style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}
        >
          同步状态
        </div>
        <InfoGrid
          columns={2}
          items={[
            {
              label: '订单同步（最近）',
              children: overview?.lastOrderSync ? (
                <Space size={6}>
                  <SyncStatusBadge status={overview.lastOrderSync.status} />
                  <span
                    style={orderSyncStale ? { color: colors.danger, fontWeight: 600 } : undefined}
                  >
                    <RelativeTime value={overview.lastOrderSync.finishedAt} />
                  </span>
                </Space>
              ) : overview === undefined ? (
                '加载中…'
              ) : (
                '从未同步'
              ),
            },
            {
              label: '商品同步（最近）',
              children: overview?.lastListingSync ? (
                <Space size={6}>
                  <SyncStatusBadge status={overview.lastListingSync.status} />
                  <RelativeTime value={overview.lastListingSync.finishedAt} />
                </Space>
              ) : overview === undefined ? (
                '加载中…'
              ) : (
                '从未同步'
              ),
            },
            {
              label: '类目树（最近）',
              children: overview?.lastCategoryTreeSync ? (
                <Space size={6}>
                  <SyncStatusBadge status={overview.lastCategoryTreeSync.status} />
                  <RelativeTime value={overview.lastCategoryTreeSync.finishedAt} />
                </Space>
              ) : (
                '从未同步'
              ),
            },
            {
              label: '商品属性增强（最近）',
              children: overview?.lastProductEnrichmentSync ? (
                <Space size={6}>
                  <SyncStatusBadge status={overview.lastProductEnrichmentSync.status} />
                  <RelativeTime value={overview.lastProductEnrichmentSync.finishedAt} />
                </Space>
              ) : (
                '从未同步'
              ),
            },
            {
              label: '连续失败',
              children:
                overview !== undefined && overview.consecutiveFailures > 0 ? (
                  <span style={{ color: colors.danger }}>{overview.consecutiveFailures} 次</span>
                ) : (
                  '0 次'
                ),
            },
            {
              label: '运行中任务',
              children:
                overview?.activeJobId !== undefined && overview.activeJobId !== null ? '有' : '无',
            },
          ]}
        />
        {orderSyncStale && (
          <p style={{ fontSize: 12.5, color: colors.danger, margin: '8px 0 0' }}>
            订单自动同步已开启，但超过 15 分钟没有成功记录——请检查同步任务或凭证。
          </p>
        )}
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
          手动同步入口在列表页选中店铺后的右侧栏「立即同步」。
        </p>
      </section>

      <section>
        <div
          style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}
        >
          自动同步（定时轮询）
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 12 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '9px 16px 9px 0',
              borderBottom: `1px solid ${colors.borderSoft}`,
            }}
          >
            <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
              订单自动同步（约 5 分钟一次）
            </span>
            <Switch
              checked={syncSettings.orderSyncEnabled}
              loading={syncSettingsSaving}
              disabled={store.status !== 'ACTIVE'}
              onChange={(checked) => onToggleSyncSetting({ orderSyncEnabled: checked })}
            />
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              padding: '9px 16px 9px 0',
              borderBottom: `1px solid ${colors.borderSoft}`,
            }}
          >
            <span style={{ fontSize: 12.5, color: colors.textTertiary }}>商品链接自动同步</span>
            <Switch
              checked={syncSettings.listingSyncEnabled}
              loading={syncSettingsSaving}
              disabled={store.status !== 'ACTIVE'}
              onChange={(checked) => onToggleSyncSetting({ listingSyncEnabled: checked })}
            />
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
          开关只影响调度器的自动轮询；手动同步始终可用（入口在列表页右栏）。商品同步默认仅手动（Sprint
          9 决策 2）。
        </p>
      </section>

      <section>
        <div
          style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}
        >
          仓库绑定
        </div>
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
                  label={value === 'ACTIVE' ? '启用' : '停用'}
                  hint={value}
                  showDot={false}
                />
              ),
            },
          ]}
        />
      </section>
    </Space>
  );
}
