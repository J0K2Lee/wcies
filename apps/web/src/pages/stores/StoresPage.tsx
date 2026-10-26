import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Tag,
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
import { apiDelete, apiPatch, apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';
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
  typography,
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
  /** 入站 webhook 回调地址（后端按 PUBLIC_BASE_URL + 平台 + 店铺编码生成）。 */
  webhookUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  credentialConfigured: boolean;
  bindingCount: number;
}

/** 店铺记账币种：创建与编辑共用一份，避免两处不一致（2026-10-23）。 */
const STORE_CURRENCIES = ['RUB', 'CNY', 'USD'] as const;

/** 自动轮询频率档位（用户要求 2026-10-26：频率可按店铺设置）。 */
const ORDER_SYNC_INTERVAL_OPTIONS = [1, 5, 10, 15, 30, 60] as const;
const LISTING_SYNC_INTERVAL_OPTIONS = [5, 10, 15, 30, 60] as const;

/** 店铺自定义频率用 0 表示「跟随系统默认」（settings 里不写这个键）。 */
const SYNC_INTERVAL_FOLLOW_DEFAULT = 0;

/** settings.sync 的完整形状（null = 跟随系统默认）。 */
interface SyncSettingsPatch {
  orderSyncEnabled: boolean;
  listingSyncEnabled: boolean;
  orderSyncIntervalMinutes: number | null;
  listingSyncIntervalMinutes: number | null;
}

/** Sprint 9 T2: store sync toggles live under settings.sync (read-modify-write). */
function readSyncSettings(settings: Record<string, unknown> | null | undefined): {
  orderSyncEnabled: boolean;
  listingSyncEnabled: boolean;
  orderSyncIntervalMinutes: number | null;
  listingSyncIntervalMinutes: number | null;
} {
  const sync = settings?.['sync'];
  if (typeof sync !== 'object' || sync === null) {
    return {
      orderSyncEnabled: false,
      listingSyncEnabled: false,
      orderSyncIntervalMinutes: null,
      listingSyncIntervalMinutes: null,
    };
  }
  const raw = sync as Record<string, unknown>;
  return {
    orderSyncEnabled: raw['orderSyncEnabled'] === true,
    listingSyncEnabled: raw['listingSyncEnabled'] === true,
    orderSyncIntervalMinutes: readInterval(raw['orderSyncIntervalMinutes']),
    listingSyncIntervalMinutes: readInterval(raw['listingSyncIntervalMinutes']),
  };
}

function readInterval(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
  /** 生效的自动轮询间隔（分钟）；null = 系统级关闭（ENV=0）。 */
  orderSyncIntervalMinutes: number | null;
  listingSyncIntervalMinutes: number | null;
}

interface CredentialRow {
  id: string;
  credentialType: string;
  status: string;
  configured: boolean;
  lastValidatedAt: string | null;
  lastValidationStatus: string | null;
  lastValidationError: string | null;
  /** 有效期（2026-10-26）：null + validityDeclared=true = 长期。 */
  expiresAt: string | null;
  validityDeclared: boolean;
  daysLeft: number | null;
  updatedAt: string;
}

/** 仓库绑定平台仓库（用户指示 2026-09-17）：店铺详情展示「绑定了该店铺平台仓库的仓库」摘要。 */
interface PlatformBindingRow {
  id: string;
  platformWarehouseId: string;
  platformWarehouseName: string | null;
  remarkName: string | null;
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
 * OZON 走 Client ID + API Key；WB / YANDEX 均为单 API Key（2026-09-18
 * 起后端适配器已接入：wb.adapter.ts / yandex.adapter.ts）。YANDEX 凭证
 * 可选携带 campaignId（一个 Api-Key 覆盖整个柜面时用于多店铺定位）。
 */
interface PlatformCredentialSpec {
  /** 提示区文案：该平台需要哪些凭证字段。 */
  hint: string;
  /** true = 凭证表单需要 Client ID + API Key 两个字段。 */
  needsClientId: boolean;
  /**
   * Seller ID 是否作为主数据字段展示（用户指示 2026-09-18）：Seller ID 是
   * OZON 语境的概念；WB / YANDEX 的身份体系不同（WB 仅 API Token，YANDEX
   * 用 Campaign/Business ID），不显示该字段。店铺实体字段保留（§99）。
   */
  showsSellerId: boolean;
  /**
   * 凭证表单是否显示可选的 Campaign ID 输入（2026-09-18）：YANDEX 的一个
   * Api-Key 覆盖整个柜面，多 campaign 令牌必须在凭证 payload 里显式指定
   * campaignId（yandex.adapter 的身份解析规则），单 campaign 令牌可留空。
   */
  showsCampaignId?: boolean;
}

const PLATFORM_CREDENTIAL_SPECS: Record<string, PlatformCredentialSpec> = {
  OZON: {
    hint: '所需凭证：Client ID + API Key。创建后可继续配置凭证。',
    needsClientId: true,
    showsSellerId: true,
  },
  WB: {
    hint: '所需凭证：API 令牌（卖家后台创建，180 天有效期，到期需换发）。',
    needsClientId: false,
    showsSellerId: false,
  },
  YANDEX: {
    hint: '所需凭证：API 密钥（卖家后台直接创建，永久有效；令牌覆盖多店铺时可额外指定 Campaign ID）。',
    needsClientId: false,
    showsSellerId: false,
    showsCampaignId: true,
  },
};

const GENERIC_CREDENTIAL_SPEC: PlatformCredentialSpec = {
  hint: '所需凭证：API 凭证（以平台实际开通信息为准）。',
  needsClientId: false,
  showsSellerId: false,
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
  const [editForm] = Form.useForm<{ name: string; defaultCurrency?: string }>();
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

  // 搜索防抖（2026-10-17 体检 P0-3）：输入态即时回显，查询态防抖 300ms。
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);
  // 关键词（防抖后）变化时回到第 1 页，避免停在末页看到空结果。
  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);

  const list = useApiQuery<Envelope<StoreRow[]>>(
    '/api/v1/stores',
    {
      page,
      pageSize: 50,
      ...(platformId ? { platformId } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
    },
    ['stores', page, platformId, statusFilter, debouncedKeyword],
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
  const platformBindings = useApiQuery<Envelope<PlatformBindingRow[]>>(
    '/api/v1/stores/{storeId}/platform-bindings',
    { page: 1, pageSize: 50 },
    ['store-platform-bindings', detailId],
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
  const createValidityMode = Form.useWatch('validityMode', form) as
    'LONG_TERM' | 'DATE' | undefined;
  const credentialValidityMode = Form.useWatch('validityMode', credentialForm) as
    'LONG_TERM' | 'DATE' | undefined;
  const createPlatformCode = useMemo(
    () =>
      createPlatformOptions.find((platform) => platform.id === watchedCreatePlatformId)?.code ??
      null,
    [createPlatformOptions, watchedCreatePlatformId],
  );
  // 创建表单的平台规格（凭证字段 + Seller ID 可见性）随所选平台联动。
  const createCredentialSpec = credentialSpecForPlatform(createPlatformCode);

  const refreshStore = (id: string | null) => {
    void queryClient.invalidateQueries({ queryKey: ['stores'] });
    if (id !== null) {
      void queryClient.invalidateQueries({ queryKey: ['store-detail', id] });
      void queryClient.invalidateQueries({ queryKey: ['store-credentials', id] });
      void queryClient.invalidateQueries({ queryKey: ['store-sync-overview', id] });
    }
  };

  const createMutation = useMutation({
    // 创建 + 凭证一步完成（用户指示 2026-09-18）：表单内联的凭证字段不进
    // 店铺 payload，店铺创建成功后立即用同一份输入配置 MAIN_API 凭证。
    // 凭证保存失败不回滚店铺（店铺已存在事实），提示到详情页补配。
    mutationFn: async (values: Record<string, unknown>) => {
      const {
        credentialClientId,
        credentialApiKey,
        credentialCampaignId,
        validityMode,
        credentialExpiresAt,
        ...storePayload
      } = values;
      const created = await apiPost<StoreRow>('/api/v1/stores', storePayload);
      if (typeof credentialApiKey === 'string' && credentialApiKey !== '') {
        const spec = credentialSpecForPlatform(createPlatformCode);
        const payload: Record<string, unknown> = spec.needsClientId
          ? { clientId: credentialClientId ?? '', apiKey: credentialApiKey }
          : { apiKey: credentialApiKey };
        // YANDEX 多 campaign 令牌的身份解析依赖显式 campaignId（adapter 契约）。
        if (
          spec.showsCampaignId === true &&
          typeof credentialCampaignId === 'string' &&
          credentialCampaignId.trim() !== ''
        ) {
          payload.campaignId = credentialCampaignId.trim();
        }
        await apiPost(
          '/api/v1/stores/{storeId}/credentials',
          {
            credentialType: 'MAIN_API',
            payload,
            // 绑定 Key 必须声明有效期（2026-10-26）：长期或到期日。
            ...(validityMode === 'LONG_TERM'
              ? { longTerm: true }
              : {
                  expiresAt: (credentialExpiresAt as { toISOString(): string }).toISOString(),
                }),
          },
          { storeId: created.id },
        );
      }
      return created;
    },
    onSuccess: (created, values) => {
      void message.success(values.credentialApiKey ? '店铺已创建，凭证已加密保存' : '店铺已创建');
      setCreateOpen(false);
      form.resetFields();
      refreshStore(created.id);
      setDetailId(created.id);
      setSelectedId(created.id);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const credentialMutation = useMutation({
    mutationFn: (values: {
      clientId?: string;
      apiKey: string;
      campaignId?: string;
      storeId: string;
      credentialId?: string;
      validityMode: 'LONG_TERM' | 'DATE';
      expiresAt?: { toISOString(): string };
    }) => {
      // Per-platform payload (user suggestion #14): platforms whose MAIN_API
      // needs only an API key must not submit an empty clientId — the payload
      // keys are decided by the adapter contract, OZON = { clientId, apiKey }.
      const spec = credentialSpecForPlatform(credentialPlatformCode);
      const payload: Record<string, unknown> = spec.needsClientId
        ? { clientId: values.clientId ?? '', apiKey: values.apiKey }
        : { apiKey: values.apiKey };
      // YANDEX 多 campaign 令牌的身份解析依赖显式 campaignId（adapter 契约）。
      if (
        spec.showsCampaignId === true &&
        values.campaignId !== undefined &&
        values.campaignId.trim() !== ''
      ) {
        payload.campaignId = values.campaignId.trim();
      }
      const validity =
        values.validityMode === 'LONG_TERM'
          ? { longTerm: true }
          : { expiresAt: values.expiresAt?.toISOString() ?? '' };
      return values.credentialId === undefined
        ? apiPost(
            '/api/v1/stores/{storeId}/credentials',
            { credentialType: 'MAIN_API', payload, ...validity },
            { storeId: values.storeId },
          )
        : apiPatch(
            '/api/v1/stores/{storeId}/credentials/{id}',
            { credentialType: 'MAIN_API', payload, ...validity },
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
  // 2026-10-26: 频率也写在这里；null（跟随系统默认）就是删掉这个键。
  const syncSettingsMutation = useMutation({
    mutationFn: ({ store, patch }: { store: StoreRow; patch: Partial<SyncSettingsPatch> }) => {
      const current = readSyncSettings(store.settings);
      const next = { ...current, ...patch };
      const sync: Record<string, unknown> = {
        orderSyncEnabled: next.orderSyncEnabled,
        listingSyncEnabled: next.listingSyncEnabled,
      };
      if (next.orderSyncIntervalMinutes !== null) {
        sync['orderSyncIntervalMinutes'] = next.orderSyncIntervalMinutes;
      }
      if (next.listingSyncIntervalMinutes !== null) {
        sync['listingSyncIntervalMinutes'] = next.listingSyncIntervalMinutes;
      }
      return apiPatch(
        '/api/v1/stores/{id}',
        {
          settings: {
            ...(store.settings ?? {}),
            sync,
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

  /**
   * 编辑店铺基本信息（2026-10-23 用户反馈：币种设错了却改不了）。
   * 后端 UpdateStoreRequestDto 本来就支持 name / sellerId / defaultCurrency，
   * 只是弹窗此前只暴露了名称。
   */
  const renameStoreMutation = useMutation({
    mutationFn: ({
      id,
      name,
      defaultCurrency,
    }: {
      id: string;
      name: string;
      defaultCurrency?: string;
    }) =>
      apiPatch(
        '/api/v1/stores/{id}',
        { name, ...(defaultCurrency ? { defaultCurrency } : {}) },
        {
          id,
        },
      ),
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
                  editForm.setFieldsValue({
                    name: selectedRow.name,
                    defaultCurrency: selectedRow.defaultCurrency ?? undefined,
                  });
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
          <StatusBadge tone="success" label="已配置" showDot={false} />
        ) : (
          <StatusBadge tone="warning" label="未连接" showDot={false} />
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
            error={list.error}
            onRetry={() => void list.refetch()}
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
                  void navigate('/warehouses');
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
            bindings={platformBindings.data?.data ?? []}
            bindingsLoading={platformBindings.isLoading}
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
          <Form.Item name="name" label="店铺名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            {/* Seller ID 是 OZON 语境概念（用户指示 2026-09-18）：仅 OZON 显示；
                WB / YANDEX 身份体系不同，不显示。币种是通用店铺属性，俄区
                平台默认 RUB。 */}
            {createCredentialSpec.showsSellerId && (
              <Form.Item name="sellerId" label="Seller ID">
                <Input style={{ width: 180 }} />
              </Form.Item>
            )}
            <Form.Item name="defaultCurrency" label="币种" initialValue="RUB">
              <Select
                style={{ width: 100 }}
                options={STORE_CURRENCIES.map((currency) => ({
                  value: currency,
                  label: currency,
                }))}
              />
            </Form.Item>
          </Space>
          {(() => {
            // 选平台即出现对应凭证输入框（用户指示 2026-09-18）：创建与
            // API Key 配置一步完成。字段形态按平台联动——OZON 需要
            // Client ID + API Key，其他平台只显示 API Key（与凭证弹窗一致）。
            const spec = createCredentialSpec;
            if (watchedCreatePlatformId === undefined || watchedCreatePlatformId === null) {
              return (
                <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 0 }}>
                  选择平台后，此处将显示该平台的凭证输入框（MAIN_API，加密存储，不回显）。
                </p>
              );
            }
            return (
              <>
                <div
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: colors.textPrimary,
                    margin: '8px 0 4px',
                  }}
                >
                  平台凭证（MAIN_API）
                </div>
                <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
                  {spec.hint} 密钥加密存储，不会回显；创建成功即完成配置。
                </p>
                {spec.needsClientId && (
                  <Form.Item
                    name="credentialClientId"
                    label="Client ID"
                    preserve={false}
                    rules={[{ required: true, message: '请输入 Client ID' }]}
                  >
                    <Input placeholder="OZON 后台的 Client ID" />
                  </Form.Item>
                )}
                {spec.showsCampaignId === true && (
                  <Form.Item
                    name="credentialCampaignId"
                    label="Campaign ID"
                    preserve={false}
                    extra="一个 Api-Key 覆盖柜面下多个店铺时必填；填 API 的 campaign id（GET /v2/campaigns 返回的 id，不是后台通知页的 partnerId）。单店铺令牌可留空。"
                  >
                    <Input placeholder="如 216881164" />
                  </Form.Item>
                )}
                <Form.Item
                  name="credentialApiKey"
                  label="API Key"
                  extra={spec.needsClientId ? undefined : '加密存储，不会回显。'}
                  rules={[{ required: true, message: '请输入 API Key' }]}
                >
                  <Input.Password placeholder="加密存储，不会回显" />
                </Form.Item>
                {/* API Key 有效期（2026-10-26）：平台可能强制过期，必须声明其一。 */}
                <Form.Item
                  name="validityMode"
                  label="API Key 有效期"
                  initialValue="DATE"
                  rules={[{ required: true, message: '请选择长期有效或到期日' }]}
                >
                  <Radio.Group
                    options={[
                      { value: 'DATE', label: '指定到期日' },
                      { value: 'LONG_TERM', label: '长期有效（无有效期）' },
                    ]}
                  />
                </Form.Item>
                {createValidityMode === 'DATE' && (
                  <Form.Item
                    name="credentialExpiresAt"
                    label="到期时间"
                    rules={[{ required: true, message: '请选择 API Key 到期时间' }]}
                  >
                    <DatePicker showTime style={{ width: '100%' }} />
                  </Form.Item>
                )}
              </>
            );
          })()}
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
                {spec.showsCampaignId === true && (
                  <Form.Item
                    name="campaignId"
                    label="Campaign ID"
                    extra="一个 Api-Key 覆盖柜面下多个店铺时必填；填 API 的 campaign id（GET /v2/campaigns 返回的 id，不是后台通知页的 partnerId）。单店铺令牌可留空。"
                  >
                    <Input placeholder="如 216881164" />
                  </Form.Item>
                )}
                <Form.Item
                  name="apiKey"
                  label="API Key"
                  extra={spec.needsClientId ? undefined : '加密存储，不会回显。'}
                  rules={[{ required: true, message: '请输入 API Key' }]}
                >
                  <Input.Password placeholder="加密存储，不会回显" />
                </Form.Item>
                {/* API Key 有效期（2026-10-26）：必须声明「到期日」或「长期」。 */}
                <Form.Item
                  name="validityMode"
                  label="API Key 有效期"
                  initialValue="DATE"
                  rules={[{ required: true, message: '请选择长期有效或到期日' }]}
                >
                  <Radio.Group
                    options={[
                      { value: 'DATE', label: '指定到期日' },
                      { value: 'LONG_TERM', label: '长期有效（无有效期）' },
                    ]}
                  />
                </Form.Item>
                {credentialValidityMode === 'DATE' && (
                  <Form.Item
                    name="expiresAt"
                    label="到期时间"
                    rules={[{ required: true, message: '请选择 API Key 到期时间' }]}
                  >
                    <DatePicker showTime style={{ width: '100%' }} />
                  </Form.Item>
                )}
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
              ...(values.defaultCurrency !== undefined &&
              values.defaultCurrency !== null &&
              values.defaultCurrency !== ''
                ? { defaultCurrency: String(values.defaultCurrency) }
                : {}),
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
          initialValues={{
            name: editTarget === null ? '' : editTarget.name,
            defaultCurrency: editTarget?.defaultCurrency ?? undefined,
          }}
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
          <Form.Item
            name="defaultCurrency"
            label="币种"
            tooltip="该店铺订单金额的记账币种。接入时填错可以在这里改，只影响展示/换算口径，不改历史订单已落的金额。"
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择币种"
              options={STORE_CURRENCIES.map((currency) => ({
                value: currency,
                label: currency,
              }))}
            />
          </Form.Item>
          <span style={{ fontSize: 12.5, color: colors.textTertiary, display: 'block' }}>
            店铺编码与所属平台不可修改；改名与改币种都会记入操作日志。
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
  bindings: PlatformBindingRow[];
  bindingsLoading: boolean;
  onValidate: (credentialId: string) => void;
  validating: boolean;
  onEditCredential: (credentialId: string) => void;
  onToggleCredential: (credentialId: string, action: 'enable' | 'disable') => void;
  onDeleteCredential: (credential: CredentialRow) => void;
  onConfigure: () => void;
  onToggleSyncSetting: (patch: Partial<SyncSettingsPatch>) => void;
  syncSettingsSaving: boolean;
}) {
  const syncSettings = readSyncSettings(store.settings);
  // Sprint 9 T2 freshness: automatic polling is ON but the last successful
  // order sync is older than 3x the effective interval (至少 15 分钟) -> flag red.
  // 2026-10-26：间隔可配到 60 分钟，固定 15 分钟阈值会对慢频店铺误报。
  const lastOrderFinishedAt = overview?.lastOrderSync?.finishedAt ?? null;
  const effectiveOrderMinutes = overview?.orderSyncIntervalMinutes ?? null;
  const orderStaleMs =
    effectiveOrderMinutes === null
      ? ORDER_SYNC_STALE_MS
      : Math.max(ORDER_SYNC_STALE_MS, effectiveOrderMinutes * 60_000 * 3);
  const orderSyncStale =
    syncSettings.orderSyncEnabled &&
    lastOrderFinishedAt !== null &&
    Date.now() - new Date(lastOrderFinishedAt).getTime() > orderStaleMs;
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
              children: (
                <span style={{ fontSize: 12, fontFamily: typography.monoFamily }}>{store.id}</span>
              ),
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
                  showDot={false}
                />
              ),
            },
            {
              title: '有效期',
              key: 'expiresAt',
              width: 170,
              render: (_: unknown, row: CredentialRow) => {
                // 有效期（2026-10-26）：历史未声明的提示补全；到期前 7 天起告警。
                if (!row.validityDeclared) {
                  return (
                    <StatusBadge
                      tone="warning"
                      label="未声明"
                      hint="请编辑凭证，选择「长期有效」或填写到期时间"
                      showDot={false}
                    />
                  );
                }
                if (row.expiresAt === null) {
                  return <StatusBadge tone="success" label="长期" showDot={false} />;
                }
                const days = row.daysLeft ?? 0;
                return (
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: 12.5 }}>{row.expiresAt.slice(0, 10)}</span>
                    <StatusBadge
                      tone={days <= 0 ? 'danger' : days <= 7 ? 'warning' : 'neutral'}
                      label={days <= 0 ? '已过期' : `${days} 天`}
                      showDot={false}
                    />
                  </span>
                );
              },
            },
            {
              title: '验证状态',
              dataIndex: 'lastValidationStatus',
              width: 110,
              render: (value: string | null) =>
                value === 'VALID' ? (
                  <StatusBadge tone="success" label="已连接" showDot={false} />
                ) : value === 'INVALID' ? (
                  <StatusBadge tone="danger" label="认证失败" showDot={false} />
                ) : value === 'ERROR' ? (
                  <StatusBadge tone="warning" label="验证出错" showDot={false} />
                ) : (
                  <StatusBadge tone="neutral" label="未验证" showDot={false} />
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

      {store.platformCode === 'OZON' && <OzonWebhookSection store={store} />}
      {(store.platformCode === 'YANDEX' || store.platformCode === 'WB') && (
        <CabinetWebhookSection store={store} />
      )}

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
            订单自动同步已开启，但超过 {Math.round(orderStaleMs / 60_000)}{' '}
            分钟没有成功记录——请检查同步任务或凭证。
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
              gap: 6,
              padding: '9px 16px 9px 0',
              borderBottom: `1px solid ${colors.borderSoft}`,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12.5,
                color: colors.textTertiary,
              }}
            >
              订单自动同步
              <Switch
                checked={syncSettings.orderSyncEnabled}
                loading={syncSettingsSaving}
                disabled={store.status !== 'ACTIVE'}
                onChange={(checked) => onToggleSyncSetting({ orderSyncEnabled: checked })}
              />
            </span>
            <Select
              size="small"
              style={{ width: 180 }}
              value={syncSettings.orderSyncIntervalMinutes ?? SYNC_INTERVAL_FOLLOW_DEFAULT}
              disabled={store.status !== 'ACTIVE' || !syncSettings.orderSyncEnabled}
              onChange={(value: number) =>
                onToggleSyncSetting({
                  orderSyncIntervalMinutes: value === SYNC_INTERVAL_FOLLOW_DEFAULT ? null : value,
                })
              }
              options={[
                { value: SYNC_INTERVAL_FOLLOW_DEFAULT, label: '跟随系统默认' },
                ...ORDER_SYNC_INTERVAL_OPTIONS.map((minutes) => ({
                  value: minutes,
                  label: `每 ${minutes} 分钟`,
                })),
              ]}
            />
            <span style={{ fontSize: 12, color: colors.textTertiary }}>
              {overview === undefined
                ? '生效频率加载中…'
                : overview.orderSyncIntervalMinutes === null
                  ? '自动轮询已被系统全局关闭（ORDER_SYNC_INTERVAL_SECONDS=0）'
                  : `实际生效：每 ${fmtNumber(overview.orderSyncIntervalMinutes)} 分钟`}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: '9px 16px 9px 0',
              borderBottom: `1px solid ${colors.borderSoft}`,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12.5,
                color: colors.textTertiary,
              }}
            >
              商品链接自动同步
              <Switch
                checked={syncSettings.listingSyncEnabled}
                loading={syncSettingsSaving}
                disabled={store.status !== 'ACTIVE'}
                onChange={(checked) => onToggleSyncSetting({ listingSyncEnabled: checked })}
              />
            </span>
            <Select
              size="small"
              style={{ width: 180 }}
              value={syncSettings.listingSyncIntervalMinutes ?? SYNC_INTERVAL_FOLLOW_DEFAULT}
              disabled={store.status !== 'ACTIVE' || !syncSettings.listingSyncEnabled}
              onChange={(value: number) =>
                onToggleSyncSetting({
                  listingSyncIntervalMinutes: value === SYNC_INTERVAL_FOLLOW_DEFAULT ? null : value,
                })
              }
              options={[
                { value: SYNC_INTERVAL_FOLLOW_DEFAULT, label: '跟随系统默认' },
                ...LISTING_SYNC_INTERVAL_OPTIONS.map((minutes) => ({
                  value: minutes,
                  label: `每 ${minutes} 分钟`,
                })),
              ]}
            />
            <span style={{ fontSize: 12, color: colors.textTertiary }}>
              {overview === undefined
                ? '生效频率加载中…'
                : overview.listingSyncIntervalMinutes === null
                  ? '自动轮询已被系统全局关闭（LISTING_SYNC_INTERVAL_SECONDS=0）'
                  : `实际生效：每 ${fmtNumber(overview.listingSyncIntervalMinutes)} 分钟`}
            </span>
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
          开关与频率只影响调度器的自动轮询；手动同步始终可用（入口在列表页右栏）。商品同步默认仅手动（Sprint
          9 决策 2）。变更在该店铺的下一次派发起生效，不会打断正在运行的任务。
        </p>
      </section>

      <section>
        <div
          style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}
        >
          平台仓库绑定
        </div>
        <DataTable<PlatformBindingRow>
          rowKey="id"
          size="small"
          loading={bindingsLoading}
          dataSource={bindings}
          pagination={false}
          emptyTitle="暂无平台仓库绑定"
          emptyDescription="内部仓库尚未绑定本店铺的平台仓库（去仓库管理页绑定）"
          columns={[
            { title: '平台仓库 ID', dataIndex: 'platformWarehouseId', width: 170 },
            {
              title: '名称',
              render: (_: unknown, row: PlatformBindingRow) =>
                row.remarkName ?? row.platformWarehouseName ?? '—',
            },
            { title: '所属仓库', dataIndex: 'warehouseName' },
            { title: '履约模式', dataIndex: 'fulfillmentMode', width: 110 },
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

/**
 * Yandex / WB 的 webhook 说明分节（2026-10-22 用户要求：店铺配置里至少要有
 * 订阅地址与说明）。
 *
 * 这两个平台的订阅方式与 OZON 不同，本系统没有「一键订阅」：
 * - Yandex：只能在卖家后台「设置 → API 和模块 → API 通知」手填地址；
 * - WB：webhook API 仅对目录云服务开放（docs/integrations/wildberries.md §5b），
 *   自部署场景以轮询为主，接收端保留待命。
 * 所以这里只展示回调地址 + 平台侧操作说明，不提供写操作。
 */
function CabinetWebhookSection({ store }: { store: StoreRow }) {
  const { message } = AntdApp.useApp();
  const url = store.webhookUrl ?? null;
  const isYandex = store.platformCode === 'YANDEX';

  return (
    <section>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}>
        Webhook 订阅
      </div>
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>回调地址</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
            <Typography.Text code copyable={url !== null} style={{ fontSize: 12.5 }}>
              {url ?? 'PUBLIC_BASE_URL 未配置，无法生成回调地址'}
            </Typography.Text>
            {url !== null && (
              <Button
                size="small"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(url)
                    .then(() => message.success('回调地址已复制'))
                    .catch(() => message.error('复制失败，请手动选中复制'));
                }}
              >
                复制
              </Button>
            )}
          </div>
        </div>
        {isYandex ? (
          <div style={{ fontSize: 12.5, color: colors.textSecondary, lineHeight: 1.7 }}>
            在 Yandex 卖家后台「设置 → API 和模块 → API 通知」里填写上面的地址，
            事件类型勾选订单创建 / 状态变化 / 取消，范围选本店铺所属柜面。
            <br />
            Yandex 的推送不签名，系统靠「来源 IP 白名单 + 报文 campaignId 必须等于本店凭证
            campaignId」识别来源；<b>订阅错店铺时事件会显示「已拒绝」，订单不受影响</b>
            （订单仍由 5 分钟轮询同步）。Yandex 实际投递到该地址后追加的
            <Typography.Text code style={{ fontSize: 12 }}>
              /notification
            </Typography.Text>
            路径，两个路径本系统都接收。
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: colors.textSecondary, lineHeight: 1.7 }}>
            WB 的 webhook 订阅接口目前只对已入驻解决方案目录的服务开放（自建系统申请 403），
            因此本店以 <b>5 分钟轮询</b>为主链路，接收端已实现、待拿到服务令牌后即可启用。
            若将来可用：在上述地址创建订阅，并把平台返回的 secret 配到本店 WEBHOOK 凭证，
            推送校验即生效。
          </div>
        )}
      </Space>
    </section>
  );
}

/** OZON 事件订阅状态视图（GET /stores/{id}/webhooks/ozon/subscription）。 */
interface OzonWebhookSubscriptionView {
  subscribed: boolean;
  subscriptionId: number | null;
  url: string;
  enabled: boolean | null;
  types: string[];
  expectedTypes: string[];
  otherUrlCount: number;
}

/**
 * OZON 店铺详情的「事件订阅」分节（用户需求 2026-10-09：找不到 OZON 事件
 * 订阅的配置入口）。
 *
 * OZON 的 push notifications 既能去卖家后台配置，也能通过平台 API 管理；
 * 这里暴露 API 管理入口：查看订阅状态、一键订阅/对齐推荐事件集、退订。
 * 订阅/退订是真实平台写操作（AGENTS.md §92），按钮均经二次确认。
 */
function OzonWebhookSection({ store }: { store: StoreRow }) {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();

  const query = useApiQuery<{ data: OzonWebhookSubscriptionView }>(
    '/api/v1/stores/{storeId}/webhooks/ozon/subscription',
    {},
    ['ozon-webhook-subscription', store.id],
    { storeId: store.id },
  );
  const view = query.data?.data ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ozon-webhook-subscription', store.id] });
  };

  const subscribeMutation = useMutation({
    mutationFn: () =>
      apiPost<OzonWebhookSubscriptionView>(
        '/api/v1/stores/{storeId}/webhooks/ozon/subscription',
        {},
        { storeId: store.id },
      ),
    onSuccess: (result) => {
      message.success(
        result.enabled === false
          ? '已写入订阅配置（平台侧仍处于暂停，稍后自动复测）'
          : '已订阅/对齐事件推送',
      );
      invalidate();
    },
    onError: (error: Error) => void message.error(`订阅失败：${error.message}`),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: () =>
      apiDelete('/api/v1/stores/{storeId}/webhooks/ozon/subscription', { storeId: store.id }),
    onSuccess: () => {
      message.success('已退订：订单等事件回到轮询同步兜底');
      invalidate();
    },
    onError: (error: Error) => void message.error(`退订失败：${error.message}`),
  });

  const requestSubscribe = () => {
    modal.confirm({
      title: '订阅/对齐 OZON 事件推送？',
      content:
        '将在 OZON 平台侧把本店回调地址订阅为推荐事件集（新发货单、发货单取消/状态变化、商品创建/更新）。已在卖家后台订阅过也能执行：事件类型会收敛为推荐集合。轮询同步始终兜底，退订不影响历史数据。',
      okText: '确认订阅',
      cancelText: '返回',
      onOk: () => {
        subscribeMutation.mutate();
      },
    });
  };

  const requestUnsubscribe = () => {
    modal.confirm({
      title: '退订 OZON 事件推送？',
      content:
        '删除平台侧本店回调地址的订阅（只删本店地址，不影响同账户其他系统的订阅）。订单/商品变化回到轮询同步，实时性下降。',
      okText: '确认退订',
      okButtonProps: { danger: true },
      cancelText: '返回',
      onOk: () => {
        unsubscribeMutation.mutate();
      },
    });
  };

  const missingTypes =
    view === null ? [] : view.expectedTypes.filter((type) => !view.types.includes(type));

  return (
    <section>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 10 }}>
        事件订阅（Push notifications）
      </div>
      {query.isLoading ? (
        <span style={{ fontSize: 12.5, color: colors.textTertiary }}>订阅状态加载中…</span>
      ) : query.isError ? (
        <span style={{ fontSize: 12.5, color: colors.danger }}>
          读取订阅状态失败：
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </span>
      ) : view === null ? (
        <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无订阅数据</span>
      ) : (
        <>
          <InfoGrid
            columns={2}
            items={[
              {
                label: '订阅状态',
                children: !view.subscribed ? (
                  <StatusBadge
                    tone="neutral"
                    label="未订阅"
                    hint="轮询同步兜底中"
                    showDot={false}
                  />
                ) : view.enabled === false ? (
                  <StatusBadge
                    tone="warning"
                    label="已暂停"
                    hint="平台自动暂停（长期失败/超时）；点「订阅/对齐」可恢复"
                    showDot={false}
                  />
                ) : (
                  <StatusBadge tone="success" label="推送中" showDot={false} />
                ),
              },
              {
                label: '回调地址',
                children: (
                  <Typography.Text
                    copyable={{ text: view.url }}
                    style={{ fontSize: 12, fontFamily: typography.monoFamily }}
                  >
                    {view.url}
                  </Typography.Text>
                ),
              },
            ]}
          />
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {view.types.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>未订阅任何事件类型</span>
            ) : (
              view.types.map((type) => (
                <Tag key={type} style={{ margin: 0 }}>
                  {type}
                </Tag>
              ))
            )}
          </div>
          {view.subscribed && missingTypes.length > 0 && (
            <p style={{ fontSize: 12.5, color: colors.warning, margin: '8px 0 0' }}>
              缺少推荐事件：{missingTypes.join('、')}（点「订阅/对齐事件」补齐）
            </p>
          )}
          {view.otherUrlCount > 0 && (
            <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
              该 OZON 账户下还有 {view.otherUrlCount} 个其他回调地址的订阅（可能属于其他系
              统）；本入口只管理本店地址。
            </p>
          )}
          <Space style={{ marginTop: 12 }}>
            <Button
              type="primary"
              size="small"
              loading={subscribeMutation.isPending}
              disabled={store.status !== 'ACTIVE'}
              onClick={requestSubscribe}
            >
              订阅 / 对齐事件
            </Button>
            {view.subscribed && (
              <Button
                size="small"
                danger
                loading={unsubscribeMutation.isPending}
                onClick={requestUnsubscribe}
              >
                退订
              </Button>
            )}
          </Space>
          <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '8px 0 0' }}>
            也可在 OZON 卖家后台 Settings → Push notifications 用上方回调地址手工配置；
            接收失败平台会自动补送，轮询调度始终兜底。
          </p>
        </>
      )}
    </section>
  );
}
