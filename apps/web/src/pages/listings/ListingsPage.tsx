import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Alert, Button, Drawer, Form, Input, Modal, Select, Space } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiDelete, apiPatch, apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';
import {
  ACTIVE_STATUS_LABEL,
  ActionMenu,
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  CopyTextButton,
  DataTable,
  DeleteConfirmModal,
  EntitySummary,
  ErrorState,
  FilterBar,
  InfoGrid,
  PageHeader,
  PlatformTag,
  RelativeTime,
  SectionCard,
  StatusBadge,
  StatusSwitch,
  RailHint,
  labelOf,
  typography,
  useContextRail,
} from '../../design-system';
import { ListingOnboardModal } from '../../components/ListingOnboardModal';
import { ListingVariantMapModal } from '../../components/ListingVariantMapModal';

interface ListingRow {
  id: string;
  platformId: string;
  platformCode: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformProductId: string;
  title: string | null;
  url: string | null;
  status: string;
  updatedAt: string;
  mappingCount: number;
  mappingStatus: string;
  hasOrderException: boolean;
}

interface ListingSkuRow {
  id: string;
  listingId: string;
  skuId: string | null;
  skuCode: string | null;
  skuName: string | null;
  mappingStatus: string;
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
  status: string;
}

interface ListingDetail {
  id: string;
  platformCode: string;
  storeCode: string;
  storeName: string;
  platformProductId: string;
  title: string | null;
  url: string | null;
  status: string;
  updatedAt: string;
  lastSeenAt: string | null;
  skus: ListingSkuRow[];
}

/**
 * 新建映射弹窗：变体标识字段按平台显示（事实来源 = 各平台 mapper 写入规则 +
 * 决策 0016：订单只按 platform_sku_id / seller_sku 反查，offer_id 仅记录）：
 * - OZON：platform_sku_id = 平台 sku；seller_sku 同步不采集；offer_id 仅记录。
 * - WB：platform_sku_id = 尺寸条码（cards sizes[].skus）；seller_sku = 货号
 *   vendorCode（条码缺失时兜底解析）；offer_id 与 seller_sku 同值，不单独填写。
 * - YANDEX：seller_sku = offerId（订单解析键）；platform_sku_id = marketSku；
 *   offer_id 与 seller_sku 同值，不单独填写。
 * null = 该平台不使用此字段，表单中隐藏。
 */
interface VariantIdFieldConfig {
  platformSkuId: string;
  sellerSku: string | null;
  offerId: string | null;
  note: string;
}

const VARIANT_ID_FIELDS: Record<string, VariantIdFieldConfig> = {
  OZON: {
    platformSkuId: 'OZON sku',
    sellerSku: null,
    offerId: '仅记录',
    note: 'OZON：平台 SKU ID 填平台返回的 sku，订单按它反查内部 SKU；Offer ID 仅作平台事实记录，不参与解析。',
  },
  WB: {
    platformSkuId: '尺寸条码 sizes[].skus',
    sellerSku: '货号 vendorCode',
    offerId: null,
    note: 'Wildberries：平台 SKU ID 填尺寸条码（订单按它反查）；Seller SKU 填货号 vendorCode，条码缺失时兜底解析。',
  },
  YANDEX: {
    platformSkuId: 'marketSku',
    sellerSku: 'offerId',
    offerId: null,
    note: 'Yandex：Seller SKU 填 offerId（卖家 SKU 标识，订单按它反查）；平台 SKU ID 填 marketSku（offer-mappings 商品 SKU）。',
  },
};

const VARIANT_NOTE_GENERIC =
  '每个变体至少要填平台 SKU ID 或 Seller SKU：订单只按这两个标识反查内部 SKU（Offer ID 可被运营在平台侧修改，不作为解析依据）。选择平台后，标识字段按该平台的实际含义显示。';

const listingStatusBadge = (value: string, showDot = true) => (
  <StatusBadge
    tone={value === 'ACTIVE' ? 'success' : 'neutral'}
    label={labelOf(ACTIVE_STATUS_LABEL, value)}
    hint={value}
    showDot={showDot}
  />
);

export function ListingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [platformId, setPlatformId] = useState<string | undefined>();
  const [storeId, setStoreId] = useState<string | undefined>();
  const [mappingState, setMappingState] = useState<string | undefined>();
  // ?keyword= deep link from the exception center / mapping overview.
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  // 搜索防抖（2026-10-17 体检 P0-3）：输入态即时回显，查询态防抖 300ms。
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);
  // 关键词（防抖后）变化时回到第 1 页，避免停在末页看到空结果。
  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Modal-chain fix: snapshot the variant row (incl. listingId) the map modal
  // was opened for; the drawer's onClose may null detailId while the modal is
  // still open.
  const [mapTarget, setMapTarget] = useState<ListingSkuRow | null>(null);
  const [form] = Form.useForm();
  // Row actions act on a snapshotted row, so a closing drawer cannot blank the
  // id out from under an open modal (the same modal-chain fix as above).
  const [mappingEditTarget, setMappingEditTarget] = useState<ListingSkuRow | null>(null);
  const [mappingDeleteTarget, setMappingDeleteTarget] = useState<ListingSkuRow | null>(null);
  const [mappingEditForm] = Form.useForm();
  const [skuKeyword, setSkuKeyword] = useState('');
  const debouncedSkuKeyword = useDebouncedValue(skuKeyword);
  // Rail quick action (task: SKU映射): snapshot the listing row the modal was
  // opened for — the rail selection may change while the modal is open.
  const [railMapTarget, setRailMapTarget] = useState<ListingRow | null>(null);
  // 建档弹窗「改用已有档案」转场：直接以 (listing, 变体, SKU) 打开映射弹窗。
  const [mapSeed, setMapSeed] = useState<{
    listingId: string;
    variantId: string;
    skuId: string;
  } | null>(null);
  // Sprint 8 T1: quick onboarding (Product + SKU + optional barcode + mapping
  // in one transaction) from an unmapped listing / variant row. The dialog
  // itself is the shared ListingOnboardModal component.
  const [onboardListingId, setOnboardListingId] = useState<string | null>(null);
  const [onboardVariantId, setOnboardVariantId] = useState<string | null>(null);

  // Sprint 8.5 T3 tools: tree sync + one-click import.
  const [categoryToolsOpen, setCategoryToolsOpen] = useState(false);
  const [toolsStoreId, setToolsStoreId] = useState<string | null>(null);
  const [categoryImportPreview, setCategoryImportPreview] = useState<{
    stats: {
      totalNodes: number;
      skippedDisabled: number;
      skippedOrphaned: number;
      duplicateCompositeKeys: number;
      toCreate: { level1: number; level2: number; level3: number };
    };
    conflicts: Array<{ name: string; level: number; reason: string }>;
    previewTopLevels: Array<{
      nameZh: string;
      nameRu: string | null;
      level2Count: number;
      level3Count: number;
    }>;
  } | null>(null);
  /** Listing delete confirm (L2 shared modal) — only identity fields needed. */
  const [deletingListing, setDeletingListing] = useState<{
    id: string;
    platformProductId: string;
  } | null>(null);

  const list = useApiQuery<{ data: ListingRow[]; meta: { total: number } }>(
    '/api/v1/listings',
    {
      page,
      pageSize: 50,
      platformId,
      storeId,
      mappingState,
      keyword: debouncedKeyword || undefined,
    },
    ['listings', page, platformId, storeId, mappingState, debouncedKeyword],
  );
  const platforms = useApiQuery<{ data: Array<{ id: string; code: string; name: string }> }>(
    '/api/v1/platforms',
    {},
    ['platforms'],
  );
  const stores = useApiQuery<{
    data: Array<{ id: string; platformId: string; storeCode: string; name: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-lite']);
  // Reactive platform -> store cascading for the create-mapping modal:
  // server-side filtered so large store lists are never truncated.
  const createPlatformId = Form.useWatch('platformId', form);
  // Variant identifier fields display per selected platform (VARIANT_ID_FIELDS);
  // before a platform is chosen the generic triple stays visible.
  const createPlatformCode = (platforms.data?.data ?? []).find(
    (platform) => platform.id === createPlatformId,
  )?.code;
  const variantFieldConfig =
    createPlatformCode === undefined ? null : (VARIANT_ID_FIELDS[createPlatformCode] ?? null);
  const sellerSkuVisible = variantFieldConfig === null || variantFieldConfig.sellerSku !== null;
  const storesForPlatform = useApiQuery<{
    data: Array<{ id: string; platformId: string; storeCode: string; name: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100, platformId: createPlatformId }, [
    'stores-for-platform',
    createPlatformId ?? 'none',
  ]);
  const skus = useApiQuery<{ data: Array<{ id: string; skuCode: string; nameZh: string }> }>(
    '/api/v1/skus',
    { page: 1, pageSize: 50, keyword: debouncedSkuKeyword || undefined },
    ['skus-for-mapping', debouncedSkuKeyword],
  );
  const detail = useApiQuery<{ data: ListingDetail }>(
    '/api/v1/listings/{id}',
    {},
    ['listing-detail', detailId],
    {
      id: detailId ?? '',
    },
    detailId !== null,
  );
  const listingDetail = detail.data?.data;
  // Sprint 8 T3: unmapped-workbench counters (reuse the drawer's cache key).
  const mappingStats = useApiQuery<{ data: { mapped: number; unmapped: number } }>(
    '/api/v1/listings/mapping-stats',
    {},
    ['listing-mapping-stats'],
  );
  // Category-tools helpers: the OZON platform row + its stores.
  const ozonPlatform = (platforms.data?.data ?? []).find((platform) => platform.code === 'OZON');
  const ozonPlatformId = ozonPlatform?.id ?? null;
  const ozonStoreOptions = (stores.data?.data ?? [])
    .filter((store) => store.platformId === ozonPlatformId)
    .map((store) => ({ value: store.id, label: `${store.storeCode} ${store.name}` }));

  const refreshListings = () => {
    void queryClient.invalidateQueries({ queryKey: ['listings'] });
    void queryClient.invalidateQueries({ queryKey: ['listing-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['listing-mapping-stats'] });
  };

  // Sprint 8 T2: export the unmapped set (respects the current platform/store
  // filters) as an import-compatible Excel and download via signed URL.
  const exportMutation = useMutation({
    mutationFn: () =>
      apiPost<{ objectKey: string; downloadUrl: string; rowCount: number }>(
        '/api/v1/listings/exports/unmapped',
        { platformId, storeId },
      ),
    onSuccess: (data) => {
      void message.success(`已导出 ${data.rowCount} 行未映射清单（internal_sku_code 留空待补填）`);
      window.open(data.downloadUrl, '_blank');
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // Sprint 8.5 T3 tools: tree sync + one-click import (dry-run -> confirm).
  const treeSyncMutation = useMutation({
    mutationFn: (triggerStoreId: string) =>
      apiPost('/api/v1/sync/category-tree', { storeId: triggerStoreId }),
    onSuccess: () => {
      void message.success('类目树同步已提交（ZH_HANS + RU 双语合并），完成后即可生成导入预演');
    },
    onError: (error: Error) => void message.error(error.message),
  });
  const enrichmentSyncMutation = useMutation({
    mutationFn: (triggerStoreId: string) =>
      apiPost('/api/v1/sync/product-enrichment', { storeId: triggerStoreId }),
    onSuccess: () => {
      void message.success('商品属性补齐（尺寸/重量）已提交，建档弹窗将逐步出现预填值');
    },
    onError: (error: Error) => void message.error(error.message),
  });
  const importPreviewMutation = useMutation({
    mutationFn: (platformIdInput: string) =>
      apiPost<NonNullable<typeof categoryImportPreview>>(
        '/api/v1/listings/category-import/preview',
        { platformId: platformIdInput },
      ),
    onSuccess: (preview) => {
      setCategoryImportPreview(preview);
      void message.info('导入预演已生成（未落库），确认无误后点击「确认导入」');
    },
    onError: (error: Error) => void message.error(error.message),
  });
  const importExecuteMutation = useMutation({
    mutationFn: (platformIdInput: string) =>
      apiPost<{
        created: { level1: number; level2: number; level3: number };
        mappingCount: number;
      }>('/api/v1/listings/category-import/execute', { platformId: platformIdInput }),
    onSuccess: (result) => {
      void message.success(
        `导入完成：一级 ${result.created.level1} / 二级 ${result.created.level2} / 三级 ${result.created.level3}，映射 ${result.mappingCount} 条`,
      );
      setCategoryImportPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: Error) => void message.error(`导入被拒绝: ${error.message}`),
  });

  /** Opens quick-onboarding for an unmapped listing row (variant chosen inside). */
  const openOnboard = (listingId: string, variantId: string | null = null) => {
    setOnboardVariantId(variantId);
    setOnboardListingId(listingId);
  };

  const createMutation = useMutation({
    mutationFn: (values: {
      platformId: string;
      storeId: string;
      platformProductId: string;
      title?: string;
      url?: string;
      skuVariants: Array<{
        skuId: string;
        platformSkuId?: string;
        sellerSku?: string;
        offerId?: string;
      }>;
    }) => apiPost('/api/v1/listings', values),
    onSuccess: () => {
      void message.success('商品链接已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  const listingStatusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(
        action === 'activate'
          ? '/api/v1/listings/{id}/activate'
          : '/api/v1/listings/{id}/deactivate',
        {},
        { id },
      ),
    onSuccess: () => {
      void message.success('商品链接状态已更新');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const listingDeleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/listings/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('商品链接已删除');
      if (detailId === id) {
        setDetailId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const mappingStatusMutation = useMutation({
    mutationFn: (input: { listingId: string; mappingId: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      apiPatch(
        '/api/v1/listings/{listingId}/skus/{id}',
        { status: input.status },
        { listingId: input.listingId, id: input.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射状态已更新');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const mappingDeleteMutation = useMutation({
    mutationFn: (input: { listingId: string; mappingId: string }) =>
      apiDelete('/api/v1/listings/{listingId}/skus/{id}', {
        listingId: input.listingId,
        id: input.mappingId,
      }),
    onSuccess: () => {
      void message.success('映射已删除');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  /** Edits a mapping's platform identifiers (the SKU binding is changed via 人工映射). */
  const mappingEditMutation = useMutation({
    mutationFn: (input: {
      listingId: string;
      mappingId: string;
      platformSkuId?: string;
      sellerSku?: string;
      offerId?: string;
    }) =>
      apiPatch(
        '/api/v1/listings/{listingId}/skus/{id}',
        {
          platformSkuId: input.platformSkuId?.trim() || null,
          sellerSku: input.sellerSku?.trim() || null,
          offerId: input.offerId?.trim() || null,
        },
        { listingId: input.listingId, id: input.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射已更新');
      setMappingEditTarget(null);
      mappingEditForm.resetFields();
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const storeOptions = (stores.data?.data ?? [])
    .filter((store) => platformId === undefined || store.platformId === platformId)
    .map((store) => ({ value: store.id, label: `${store.storeCode} ${store.name}` }));

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // ---- Context rail: overview stats when idle, selected listing summary ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="映射概览">
            <ContextMetric
              label="未映射总数"
              value={
                mappingStats.data === undefined
                  ? '…'
                  : `${mappingStats.data.data.unmapped} 个商品链接`
              }
            />
            <ContextMetric
              label="已映射"
              value={mappingStats.data === undefined ? '…' : `${mappingStats.data.data.mapped} 个`}
            />
            <ContextMetric
              label="当前筛选结果"
              value={`${list.data?.meta.total ?? 0} 个商品链接`}
            />
            <RailHint>
              未映射行可双击打开详情后在变体表「建档并映射」；被订单撞上的未映射会排在最前。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.platformProductId}
          subtitle={`${selectedRow.storeCode} ${selectedRow.storeName}`}
          badge={listingStatusBadge(selectedRow.status)}
          meta={<PlatformTag code={selectedRow.platformCode} />}
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="标题" value={selectedRow.title ?? '—'} />
            <ContextMetric label="变体（含未映射）" value={`${selectedRow.mappingCount} 个`} />
            <ContextMetric
              label="更新时间"
              value={<RelativeTime value={selectedRow.updatedAt} />}
            />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="商品链接"
              disableHint="停用后该商品链接不再参与同步与订单匹配"
              loading={listingStatusMutation.isPending}
              onChange={(next) =>
                listingStatusMutation.mutate({
                  id: selectedRow.id,
                  action: next ? 'activate' : 'deactivate',
                })
              }
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            <Button
              block
              style={{ marginTop: 8 }}
              disabled={selectedRow.mappingCount === 0}
              title={
                selectedRow.mappingCount === 0 ? '该商品链接没有变体记录，无法映射' : undefined
              }
              onClick={() => setRailMapTarget(selectedRow)}
            >
              SKU映射
            </Button>
            {selectedRow.mappingStatus === 'UNMAPPED' && (
              <Button
                type="primary"
                block
                style={{ marginTop: 8 }}
                onClick={() => openOnboard(selectedRow.id)}
              >
                建档并映射
              </Button>
            )}
            <Button
              block
              danger
              style={{ marginTop: 8 }}
              onClick={() => setDeletingListing(selectedRow)}
            >
              删除
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    list.data,
    mappingStats.data,
    listingStatusMutation.isPending,
    listingStatusMutation.mutate,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="SKU映射"
        description="管理平台商品链接与内部 SKU 的变体映射；人工确认的映射不会被后续同步覆盖"
        secondary={
          <>
            <Button onClick={() => setCategoryToolsOpen(true)}>OZON类目工具</Button>
            <Button loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
              导出未映射清单
            </Button>
          </>
        }
        primary={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建映射
          </Button>
        }
      />

      <FilterBar
        actions={
          <>
            {(keyword !== '' ||
              platformId !== undefined ||
              storeId !== undefined ||
              mappingState !== undefined) && (
              <Button
                onClick={() => {
                  setKeyword('');
                  setPlatformId(undefined);
                  setStoreId(undefined);
                  setMappingState(undefined);
                  setPage(1);
                }}
              >
                清除筛选
              </Button>
            )}
          </>
        }
      >
        <Input.Search
          placeholder="product_id / offer_id / 平台SKU / 内部SKU / 标题"
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索映射"
        />
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 130 }}
          showSearch
          optionFilterProp="label"
          value={platformId}
          onChange={(value) => {
            setPage(1);
            setPlatformId(value);
            setStoreId(undefined);
          }}
          options={(platforms.data?.data ?? []).map((platform) => ({
            value: platform.id,
            label: platform.name,
          }))}
        />
        <Select
          allowClear
          placeholder="店铺"
          showSearch
          optionFilterProp="label"
          style={{ width: 160 }}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
          options={storeOptions}
        />
        <Select
          allowClear
          placeholder="映射状态"
          style={{ width: 120 }}
          value={mappingState}
          onChange={(value) => {
            setPage(1);
            setMappingState(value);
          }}
          options={[
            { value: 'MAPPED', label: '已映射' },
            { value: 'UNMAPPED', label: '待映射' },
          ]}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['listings'] })}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<ListingRow>
            rowKey="id"
            loading={list.isLoading}
            error={list.error}
            onRetry={() => void list.refetch()}
            dataSource={rows}
            emptyTitle="暂无商品链接"
            emptyDescription="调整筛选条件，或点击右上角新建映射"
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个商品链接`,
            }}
            rowClassName={(record) => (record.id === selectedId ? 'wcies-row-selected' : '')}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              onDoubleClick: () => setDetailId(record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            columns={[
              {
                title: '平台',
                dataIndex: 'platformCode',
                width: 100,
                render: (value: string) => <PlatformTag code={value} />,
              },
              { title: '店铺', dataIndex: 'storeCode', width: 100 },
              {
                title: '平台商品 ID',
                dataIndex: 'platformProductId',
                width: 160,
                render: (value: string) => (
                  <span style={{ fontFamily: typography.monoFamily, fontSize: 12.5 }}>{value}</span>
                ),
              },
              {
                title: '标题',
                dataIndex: 'title',
                ellipsis: true,
                render: (value: string | null, record) =>
                  record.url !== null ? (
                    <a href={record.url} target="_blank" rel="noreferrer">
                      {value ?? record.url}
                    </a>
                  ) : (
                    (value ?? '—')
                  ),
              },
              {
                title: '变体',
                dataIndex: 'mappingCount',
                width: 70,
                render: (value: number) => `${value} 个`,
              },
              {
                title: '映射',
                dataIndex: 'mappingStatus',
                width: 150,
                render: (value: string, record: ListingRow) =>
                  value === 'MAPPED' ? (
                    <StatusBadge tone="success" label="已映射" showDot={false} />
                  ) : (
                    <Space size={4}>
                      <StatusBadge tone="warning" label="未映射" showDot={false} />
                      {record.hasOrderException && (
                        <StatusBadge tone="danger" label="订单异常" showDot={false} />
                      )}
                    </Space>
                  ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (value: string) => listingStatusBadge(value, false),
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 110,
                render: (value: string) => <RelativeTime value={value} />,
              },
            ]}
          />
        )}
      </SectionCard>

      <Modal
        title="新建商品链接映射（支持多 SKU 变体）"
        open={createOpen}
        width={720}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            title="平台已同步的商品请勿在此新建"
            description="若平台商品已同步到系统，本表单会因「该店铺 + 平台商品 ID 已存在」而失败。请先搜索该商品，在其详情里把已同步的未映射变体「人工映射」到内部 SKU——这样映射会带上平台标识，订单才匹配得到。"
          />
          <Space wrap>
            <Form.Item
              name="platformId"
              label="平台"
              rules={[{ required: true, message: '请选择平台' }]}
            >
              <Select
                style={{ width: 140 }}
                onChange={() => form.setFieldValue('storeId', undefined)}
                options={(platforms.data?.data ?? []).map((platform) => ({
                  value: platform.id,
                  label: platform.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="storeId"
              label="店铺"
              rules={[{ required: true, message: '请选择店铺' }]}
              dependencies={['platformId']}
            >
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                disabled={createPlatformId === undefined}
                placeholder={createPlatformId === undefined ? '请先选择平台' : '选择该平台下的店铺'}
                options={(storesForPlatform.data?.data ?? []).map((store) => ({
                  value: store.id,
                  label: `${store.storeCode} ${store.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="platformProductId" label="平台商品 ID" rules={[{ required: true }]}>
              <Input style={{ width: 200 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="title" label="标题">
              <Input style={{ width: 300 }} />
            </Form.Item>
            <Form.Item name="url" label="URL">
              <Input style={{ width: 300 }} />
            </Form.Item>
          </Space>
          <Form.List name="skuVariants" initialValue={[{}]}>
            {(fields, { add, remove }) => (
              <>
                <p style={{ fontSize: 12.5, color: colors.textTertiary, marginBottom: 10 }}>
                  {variantFieldConfig?.note ?? VARIANT_NOTE_GENERIC}
                </p>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item
                      name={[field.name, 'skuId']}
                      rules={[{ required: true, message: '选择内部SKU' }]}
                      style={{ minWidth: 240 }}
                    >
                      <Select
                        showSearch
                        filterOption={false}
                        onSearch={setSkuKeyword}
                        notFoundContent={skus.isLoading ? '搜索中...' : '无匹配SKU'}
                        placeholder="内部SKU（可输入编码/名称搜索）"
                        options={(skus.data?.data ?? []).map((sku) => ({
                          value: sku.id,
                          label: `${sku.skuCode} ${sku.nameZh}`,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'platformSkuId']}
                      dependencies={[['skuVariants', field.name, 'sellerSku']]}
                      rules={[
                        ({ getFieldValue }) => ({
                          validator: (_rule, value: unknown) => {
                            const variants = getFieldValue('skuVariants') as Array<{
                              platformSkuId?: string;
                              sellerSku?: string;
                            }>;
                            const row = variants?.[field.name];
                            const text = (input: unknown): string =>
                              typeof input === 'string' ? input.trim() : '';
                            const hasAny =
                              text(value) !== '' ||
                              (sellerSkuVisible && text(row?.sellerSku) !== '');
                            return hasAny
                              ? Promise.resolve()
                              : Promise.reject(
                                  new Error(
                                    sellerSkuVisible
                                      ? '至少填平台 SKU ID 或 Seller SKU（Offer ID 不作为解析依据）'
                                      : '请填写平台 SKU ID（订单按它反查内部 SKU）',
                                  ),
                                );
                          },
                        }),
                      ]}
                    >
                      <Input
                        placeholder={
                          variantFieldConfig === null
                            ? '平台 SKU ID'
                            : `平台 SKU ID（${variantFieldConfig.platformSkuId}）`
                        }
                        style={{ width: 190 }}
                      />
                    </Form.Item>
                    {sellerSkuVisible && (
                      <Form.Item name={[field.name, 'sellerSku']}>
                        <Input
                          placeholder={
                            variantFieldConfig === null || variantFieldConfig.sellerSku === null
                              ? 'Seller SKU'
                              : `Seller SKU（${variantFieldConfig.sellerSku}）`
                          }
                          style={{ width: 170 }}
                        />
                      </Form.Item>
                    )}
                    {(variantFieldConfig === null || variantFieldConfig.offerId !== null) && (
                      <Form.Item name={[field.name, 'offerId']}>
                        <Input placeholder="Offer ID（仅记录）" style={{ width: 150 }} />
                      </Form.Item>
                    )}
                    <Button danger onClick={() => remove(field.name)}>
                      删除
                    </Button>
                  </Space>
                ))}
                <Button onClick={() => add()}>+ 添加变体</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Drawer
        title={
          listingDetail ? (
            <Space size={10}>
              <span style={{ fontSize: 16, fontWeight: 650 }}>
                {listingDetail.storeCode} / {listingDetail.platformProductId}
              </span>
              {listingStatusBadge(listingDetail.status)}
            </Space>
          ) : (
            '商品链接详情'
          )
        }
        size={760}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        extra={
          listingDetail !== undefined ? (
            <Button
              size="small"
              danger
              loading={listingDeleteMutation.isPending}
              onClick={() =>
                setDeletingListing({
                  id: listingDetail.id,
                  platformProductId: listingDetail.platformProductId,
                })
              }
            >
              删除
            </Button>
          ) : undefined
        }
      >
        {detail.isError ? (
          <span style={{ color: colors.danger }}>
            详情加载失败：{(detail.error as Error | null)?.message ?? '请稍后重试'}
          </span>
        ) : listingDetail === undefined ? (
          <span style={{ color: colors.textTertiary }}>加载中…</span>
        ) : (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <section>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  marginBottom: 10,
                }}
              >
                基本信息
              </div>
              <InfoGrid
                columns={2}
                items={[
                  {
                    label: '平台',
                    children: <PlatformTag code={listingDetail.platformCode} />,
                  },
                  {
                    label: '店铺',
                    children: `${listingDetail.storeCode} ${listingDetail.storeName}`,
                  },
                  {
                    label: '状态',
                    children: listingStatusBadge(listingDetail.status),
                  },
                  {
                    label: '最近同步发现',
                    children: <RelativeTime value={listingDetail.lastSeenAt} fallback="未发现" />,
                  },
                  {
                    label: '标题',
                    span: 2,
                    children:
                      listingDetail.url !== null ? (
                        <a href={listingDetail.url} target="_blank" rel="noreferrer">
                          {listingDetail.title ?? listingDetail.url}
                        </a>
                      ) : (
                        (listingDetail.title ?? '—')
                      ),
                  },
                  {
                    label: '平台商品 ID',
                    children: (
                      <span style={{ fontFamily: typography.monoFamily, fontSize: 12.5 }}>
                        {listingDetail.platformProductId}
                      </span>
                    ),
                  },
                  {
                    label: '更新时间',
                    children: <RelativeTime value={listingDetail.updatedAt} />,
                  },
                ]}
              />
            </section>

            <section>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  marginBottom: 10,
                }}
              >
                变体映射（{listingDetail.skus.length}）
              </div>
              <DataTable<ListingSkuRow>
                rowKey="id"
                size="small"
                loading={detail.isLoading}
                error={detail.error}
                onRetry={() => void detail.refetch()}
                dataSource={listingDetail.skus}
                pagination={false}
                emptyTitle="暂无变体"
                emptyDescription="该商品链接尚无变体映射记录"
                columns={[
                  {
                    title: '映射状态',
                    dataIndex: 'mappingStatus',
                    width: 90,
                    render: (value: string) =>
                      value === 'MAPPED' ? (
                        <StatusBadge tone="success" label="已映射" showDot={false} />
                      ) : (
                        <StatusBadge tone="warning" label="未映射" showDot={false} />
                      ),
                  },
                  {
                    title: '内部SKU',
                    dataIndex: 'skuCode',
                    render: (value: string | null) =>
                      value === null ? (
                        <StatusBadge tone="warning" label="未映射" showDot={false} />
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {value}
                        </span>
                      ),
                  },
                  {
                    title: '名称',
                    dataIndex: 'skuName',
                    render: (value: string | null) =>
                      value === null ? (
                        '—'
                      ) : (
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {value}
                          <CopyTextButton value={value} title="SKU 名称" />
                        </span>
                      ),
                  },
                  {
                    title: '平台 SKU',
                    dataIndex: 'platformSkuId',
                    render: (value: string | null) => value ?? '—',
                  },
                  {
                    title: 'Seller SKU',
                    dataIndex: 'sellerSku',
                    render: (value: string | null) => value ?? '—',
                  },
                  {
                    title: 'Offer ID',
                    dataIndex: 'offerId',
                    render: (value: string | null) => value ?? '—',
                  },
                  {
                    title: '操作',
                    key: 'actions',
                    width: 220,
                    render: (_: unknown, row: ListingSkuRow) => (
                      // 子表规范 §4.5：统一 ActionMenu（primary link + 菜单），
                      // UNMAPPED 行主链接为「建档并映射」，其余为「人工映射」。
                      <ActionMenu
                        primary={
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingInline: 4 }}
                            onClick={() => {
                              if (row.mappingStatus === 'UNMAPPED') {
                                openOnboard(listingDetail.id, row.id);
                              } else {
                                setMapTarget(row);
                              }
                            }}
                          >
                            {row.mappingStatus === 'UNMAPPED' ? '建档并映射' : '人工映射'}
                          </Button>
                        }
                        items={[
                          ...(row.mappingStatus === 'UNMAPPED'
                            ? [
                                {
                                  key: 'map',
                                  label: '人工映射',
                                  onClick: () => {
                                    setMapTarget(row);
                                  },
                                },
                              ]
                            : []),
                          {
                            key: 'edit',
                            label: '编辑映射',
                            onClick: () => {
                              setMappingEditTarget(row);
                              mappingEditForm.resetFields();
                            },
                          },
                          row.status === 'ACTIVE'
                            ? {
                                key: 'deactivate',
                                label: '停用',
                                danger: true,
                                onClick: () =>
                                  mappingStatusMutation.mutate({
                                    listingId: row.listingId,
                                    mappingId: row.id,
                                    status: 'INACTIVE',
                                  }),
                              }
                            : {
                                key: 'activate',
                                label: '启用',
                                onClick: () =>
                                  mappingStatusMutation.mutate({
                                    listingId: row.listingId,
                                    mappingId: row.id,
                                    status: 'ACTIVE',
                                  }),
                              },
                          {
                            key: 'delete',
                            label: '删除',
                            danger: true,
                            onClick: () => setMappingDeleteTarget(row),
                          },
                        ]}
                      />
                    ),
                  },
                ]}
              />
            </section>
          </Space>
        )}

        {/* ---- 人工映射（2026-10-14 换共享组件：变体锁定 + 优化版 SKU 选择器） ---- */}
        <ListingVariantMapModal
          open={mapTarget !== null}
          listingId={mapTarget?.listingId ?? null}
          fixedVariant={
            mapTarget === null
              ? null
              : {
                  id: mapTarget.id,
                  label: mapTarget.offerId ?? mapTarget.platformSkuId ?? '',
                }
          }
          onCreateNew={(mappingId) => {
            // 没有对应档案：同一入口转去新建（变体锁定）。
            const listingId = mapTarget?.listingId ?? null;
            setMapTarget(null);
            if (listingId !== null) {
              openOnboard(listingId, mappingId);
            }
          }}
          onClose={() => setMapTarget(null)}
          zIndex={1100}
        />

        {/* ---- Edit mapping: platform identifiers only (SKU binding uses 人工映射) ---- */}
        <Modal
          title={`编辑映射：${mappingEditTarget?.skuCode ?? '变体'}`}
          open={mappingEditTarget !== null}
          zIndex={1100}
          onCancel={() => setMappingEditTarget(null)}
          confirmLoading={mappingEditMutation.isPending}
          onOk={() =>
            void mappingEditForm.validateFields().then((values) => {
              if (mappingEditTarget === null) {
                void message.error('映射上下文丢失，请重新打开后重试');
                return;
              }
              mappingEditMutation.mutate({
                listingId: mappingEditTarget.listingId,
                mappingId: mappingEditTarget.id,
                platformSkuId: values.platformSkuId,
                sellerSku: values.sellerSku,
                offerId: values.offerId,
              });
            })
          }
        >
          <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
            修改平台标识。要更换绑定的内部 SKU，请使用「人工映射」。 Offer ID
            仅记录为平台事实——它可被运营在平台侧修改，不参与订单解析。
          </p>
          <Form form={mappingEditForm} layout="vertical">
            <Form.Item name="platformSkuId" label="平台 SKU ID">
              <Input placeholder="平台 SKU ID" maxLength={255} />
            </Form.Item>
            <Form.Item name="sellerSku" label="Seller SKU">
              <Input placeholder="卖家 SKU" maxLength={255} />
            </Form.Item>
            <Form.Item name="offerId" label="Offer ID">
              <Input placeholder="Offer ID" maxLength={255} />
            </Form.Item>
          </Form>
        </Modal>

        <DeleteConfirmModal
          open={mappingDeleteTarget !== null}
          title="确认删除该映射？"
          description={`将删除「${mappingDeleteTarget?.skuCode ?? ''}」与平台变体「${
            mappingDeleteTarget?.offerId ?? mappingDeleteTarget?.platformSkuId ?? ''
          }」的映射关系。商品链接本身保留。`}
          forceWarning="若该映射已被订单行引用，删除会被拒绝——订单行是履约凭证，无法移除。"
          confirmLoading={mappingDeleteMutation.isPending}
          onConfirm={() => {
            if (mappingDeleteTarget === null) {
              return;
            }
            mappingDeleteMutation.mutate(
              { listingId: mappingDeleteTarget.listingId, mappingId: mappingDeleteTarget.id },
              { onSettled: () => setMappingDeleteTarget(null) },
            );
          }}
          onCancel={() => setMappingDeleteTarget(null)}
        />
      </Drawer>

      {/* ---- Rail「SKU映射」（2026-10-14 换共享组件，与订单页同一行为） ---- */}
      <ListingVariantMapModal
        open={railMapTarget !== null || mapSeed !== null}
        listingId={railMapTarget?.id ?? mapSeed?.listingId ?? null}
        initialSkuId={mapSeed?.skuId ?? null}
        initialVariantId={mapSeed?.variantId ?? null}
        onCreateNew={(mappingId) => {
          const listingId = railMapTarget?.id ?? mapSeed?.listingId ?? null;
          setRailMapTarget(null);
          setMapSeed(null);
          if (listingId !== null) {
            openOnboard(listingId, mappingId);
          }
        }}
        onClose={() => {
          setRailMapTarget(null);
          setMapSeed(null);
        }}
        onCompleted={refreshListings}
        zIndex={1100}
      />

      {/* ---- 快速建档弹窗（Phase 3 提取为共享组件；订单页复用同一弹窗） ---- */}
      <ListingOnboardModal
        open={onboardListingId !== null}
        listingId={onboardListingId}
        preferredVariantId={onboardVariantId}
        chained
        onClose={() => {
          setOnboardListingId(null);
          setOnboardVariantId(null);
        }}
        onCompleted={refreshListings}
        onUseExisting={({ skuId, mappingId }) => {
          const listingId = onboardListingId;
          setOnboardListingId(null);
          setOnboardVariantId(null);
          if (listingId !== null) {
            setMapSeed({ listingId, variantId: mappingId, skuId });
          }
        }}
        zIndex={1100}
      />

      {/* ---- Listing 删除 = L2 统一 DeleteConfirmModal（G4） ---- */}
      <DeleteConfirmModal
        open={deletingListing !== null}
        title={`删除商品链接 ${deletingListing?.platformProductId ?? ''}？`}
        description="存在变体映射的商品链接无法删除；被拒时会返回具体原因。"
        confirmLoading={listingDeleteMutation.isPending}
        onConfirm={() => {
          if (deletingListing !== null) {
            listingDeleteMutation.mutate(deletingListing.id);
          }
        }}
        onCancel={() => setDeletingListing(null)}
      />

      {/* ---- Sprint 8.5 T3: category tools (tree sync + one-click import) ---- */}
      <Modal
        title="OZON 类目工具"
        open={categoryToolsOpen}
        zIndex={1100}
        width={760}
        footer={null}
        onCancel={() => {
          setCategoryToolsOpen(false);
          setCategoryImportPreview(null);
        }}
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              第 1 步：同步类目树（手动，低频）
            </div>
            <Space wrap>
              <Select
                placeholder="选择 OZON 店铺（用其凭证拉取）"
                style={{ width: 260 }}
                value={toolsStoreId}
                onChange={setToolsStoreId}
                options={ozonStoreOptions}
              />
              <Button
                loading={treeSyncMutation.isPending}
                disabled={toolsStoreId === null}
                onClick={() => toolsStoreId !== null && treeSyncMutation.mutate(toolsStoreId)}
              >
                同步类目树（中文+俄语）
              </Button>
              <Button
                loading={enrichmentSyncMutation.isPending}
                disabled={toolsStoreId === null}
                onClick={() => toolsStoreId !== null && enrichmentSyncMutation.mutate(toolsStoreId)}
              >
                补齐商品属性（尺寸/重量）
              </Button>
            </Space>
            <p style={{ fontSize: 12.5, color: colors.textTertiary, marginTop: 8 }}>
              树同步拉取官方简体中文 + 俄语双语树并缓存（约 8k 节点）；属性补齐调用 v4
              接口把尺寸/重量并入 listing 原始数据。两者均按同步任务记录，可到同步中心查看结果。
            </p>
          </section>
          <section>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>第 2 步：一键导入内部三级类目</div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Button
                loading={importPreviewMutation.isPending}
                disabled={ozonPlatformId === null}
                onClick={() =>
                  ozonPlatformId !== null && importPreviewMutation.mutate(ozonPlatformId)
                }
              >
                生成导入预演（不落库）
              </Button>
              <Button
                type="primary"
                loading={importExecuteMutation.isPending}
                disabled={
                  categoryImportPreview === null || categoryImportPreview.conflicts.length > 0
                }
                onClick={() =>
                  ozonPlatformId !== null && importExecuteMutation.mutate(ozonPlatformId)
                }
              >
                确认导入（单事务）
              </Button>
            </Space>
            {categoryImportPreview !== null && (
              <Space orientation="vertical" style={{ width: '100%' }} size="small">
                <Alert
                  type={categoryImportPreview.conflicts.length > 0 ? 'warning' : 'success'}
                  showIcon
                  title={
                    categoryImportPreview.conflicts.length > 0
                      ? `发现 ${categoryImportPreview.conflicts.length} 处命名冲突，需人工处理后才能导入（不做静默跳过）`
                      : '预演通过：无冲突，可确认导入'
                  }
                  description={
                    categoryImportPreview.conflicts.length > 0
                      ? categoryImportPreview.conflicts
                          .slice(0, 5)
                          .map((conflict) => `${conflict.name}：${conflict.reason}`)
                          .join('；')
                      : 'OZON 一级→内部一级、二级→内部二级、类型→内部三级，1:1 直映；编码自动生成，导入后同类目建档自动命中。'
                  }
                />
                <InfoGrid
                  columns={2}
                  items={[
                    { label: '一级', children: `${categoryImportPreview.stats.toCreate.level1}` },
                    { label: '二级', children: `${categoryImportPreview.stats.toCreate.level2}` },
                    {
                      label: '三级(类型)',
                      children: `${categoryImportPreview.stats.toCreate.level3}`,
                    },
                    {
                      label: '跳过(禁用/孤儿)',
                      children: `${categoryImportPreview.stats.skippedDisabled + categoryImportPreview.stats.skippedOrphaned}`,
                    },
                  ]}
                />
                <DataTable<{
                  nameZh: string;
                  nameRu: string | null;
                  level2Count: number;
                  level3Count: number;
                }>
                  rowKey="nameZh"
                  size="small"
                  pagination={false}
                  dataSource={categoryImportPreview.previewTopLevels}
                  columns={[
                    { title: '一级类目（中文）', dataIndex: 'nameZh' },
                    {
                      title: '原名（俄语）',
                      dataIndex: 'nameRu',
                      render: (value: string | null) => value ?? '—',
                    },
                    { title: '二级数', dataIndex: 'level2Count', width: 80 },
                    { title: '三级数', dataIndex: 'level3Count', width: 80 },
                  ]}
                />
              </Space>
            )}
          </section>
        </Space>
      </Modal>
    </div>
  );
}
