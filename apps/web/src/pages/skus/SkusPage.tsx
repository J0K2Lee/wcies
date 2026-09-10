import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Cascader,
  Drawer,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Select,
  Tabs,
  Upload,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { SkuCreateModal } from '../../components/SkuCreateModal';
import {
  ActionMenu,
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  InfoGrid,
  PageHeader,
  SectionCard,
  SKU_STATUS_META,
  BARCODE_TYPE_LABEL,
  PlatformTag,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

/**
 * SKU management (redesign task §26-§30): header + unified filter bar +
 * dense table, with a context-rail quick view (row click) and a full detail
 * drawer (查看 action). Business mutations are unchanged from Sprint 1/5.
 */

interface SkuRow {
  id: string;
  skuCode: string;
  nameZh: string;
  productId: string;
  productCode: string;
  productName: string;
  nameRu: string | null;
  model: string | null;
  color: string | null;
  size: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  latestPurchasePrice: number | null;
  purchaseUrl: string | null;
  serialTracking: boolean;
  status: string;
  primaryBarcode: string | null;
  primaryImageUrl: string | null;
  listingCount: number;
  brandName: string | null;
  updatedAt: string;
}

interface BarcodeRow {
  id: string;
  barcode: string;
  barcodeType: string;
  isPrimary: boolean;
  status: string;
}

interface ImageRow {
  id: string;
  url: string;
  isPrimary: boolean;
  mimeType: string;
  fileSize: number;
}

interface MappingRow {
  id: string;
  platformCode: string;
  storeCode: string;
  platformProductId: string;
  offerId: string | null;
  sellerSku: string | null;
  title: string | null;
  url: string | null;
  status: string;
}

interface SkuInventorySummary {
  totals: {
    onHandQty: string;
    reservedQty: string;
    pickedQty: string;
    safetyQty: string;
    sellableAvailableQty: string;
  };
}

interface BrandItem {
  id: string;
  name: string;
  status: string;
}

interface CategoryNode {
  id: string;
  nameZh: string;
  status: string;
  level: number;
  children?: CategoryNode[];
}

type Envelope<T> = { data: T; meta: { total: number } };

interface CategoryOption {
  value: string;
  label: string;
  children?: CategoryOption[];
}

function toCategoryOption(node: CategoryNode): CategoryOption {
  const children = (node.children ?? [])
    .filter((child) => child.status === 'ACTIVE')
    .map((child) => toCategoryOption(child));
  return {
    value: node.id,
    label: node.nameZh,
    ...(children.length > 0 ? { children } : {}),
  };
}

/** Path of [value, ...] from the option tree down to the given id. */
function categoryPathOf(options: CategoryOption[], id: string): string[] | undefined {
  for (const option of options) {
    if (option.value === id) {
      return [option.value];
    }
    if (option.children !== undefined) {
      const nested = categoryPathOf(option.children, id);
      if (nested !== undefined) {
        return [option.value, ...nested];
      }
    }
  }
  return undefined;
}

const fmtQty = (value: string): string => (Number(value) % 1 === 0 ? String(Number(value)) : value);

export function SkusPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  const [brandId, setBrandId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [hasListing, setHasListing] = useState<string | undefined>();
  // Three-level interaction (task §19): row click → rail preview, 查看 → drawer.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('create') === '1');
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [listingCreateOpen, setListingCreateOpen] = useState(false);
  const [mapExistingOpen, setMapExistingOpen] = useState(false);
  const [barcodeForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [listingForm] = Form.useForm();
  const [mapExistingForm] = Form.useForm();

  // Deep link from the global palette: focus=<skuId> selects the row and opens
  // its drawer (Phase 2 task §33 — jump straight to the entity).
  useEffect(() => {
    const focus = searchParams.get('focus');
    if (focus !== null) {
      setSelectedId(focus);
      setDrawerId(focus);
    }
  }, [searchParams]);

  const list = useApiQuery<Envelope<SkuRow[]>>(
    '/api/v1/skus',
    {
      page,
      pageSize: 50,
      keyword: keyword || undefined,
      brandId,
      categoryId,
      status,
      hasListing,
    },
    ['skus', page, keyword, brandId, categoryId, status, hasListing],
  );
  const brands = useApiQuery<Envelope<BrandItem[]>>('/api/v1/brands', { keyword: '' }, [
    'brands',
  ]);
  const categories = useApiQuery<Envelope<CategoryNode[]>>('/api/v1/categories', {}, [
    'categories',
  ]);
  /** Filter cascader options: any level selectable (backend matches subtree). */
  const categoryOptions = useMemo(
    () =>
      (categories.data?.data ?? [])
        .filter((node) => node.status === 'ACTIVE')
        .map((node) => toCategoryOption(node)),
    [categories.data],
  );

  const selectedRow = useMemo(
    () => (list.data?.data ?? []).find((row) => row.id === selectedId) ?? null,
    [list.data, selectedId],
  );

  // Quick-view stock: one detail request while a row stays selected (task §68).
  const selectedInventory = useApiQuery<{ data: SkuInventorySummary }>(
    '/api/v1/inventory/skus/{skuId}',
    {},
    ['sku-inventory-summary', selectedId],
    selectedId === null ? undefined : { skuId: selectedId },
    selectedId !== null,
  );

  const detail = useApiQuery<Envelope<SkuRow> & { data: SkuRow }>(
    '/api/v1/skus/{id}',
    {},
    ['sku-detail', drawerId],
    { id: drawerId ?? '' },
    drawerId !== null,
  );
  const barcodes = useApiQuery<Envelope<BarcodeRow[]>>(
    '/api/v1/skus/{skuId}/barcodes',
    {},
    ['sku-barcodes', drawerId],
    { skuId: drawerId ?? '' },
    drawerId !== null,
  );
  const images = useApiQuery<Envelope<ImageRow[]>>(
    '/api/v1/skus/{skuId}/images',
    {},
    ['sku-images', drawerId],
    { skuId: drawerId ?? '' },
    drawerId !== null,
  );
  const mappings = useApiQuery<Envelope<MappingRow[]>>(
    '/api/v1/listings/skus/{skuId}/mappings',
    {},
    ['sku-mappings', drawerId],
    { skuId: drawerId ?? '' },
    drawerId !== null,
  );

  const refreshSku = () => {
    void queryClient.invalidateQueries({ queryKey: ['skus'] });
    void queryClient.invalidateQueries({ queryKey: ['sku-detail', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-barcodes', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-images', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-mappings', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-inventory-summary'] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/skus/{id}/${action}`, {}, { id }),
    onSuccess: (_data, variables) => {
      void message.success(variables.action === 'activate' ? 'SKU已启用' : 'SKU已停用');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/skus/{id}', { id }),
    onSuccess: () => {
      void message.success('SKU已删除');
      setDrawerId(null);
      setSelectedId(null);
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      apiPatch('/api/v1/skus/{id}', values, { id: drawerId ?? '' }),
    onSuccess: () => {
      void message.success('SKU已更新');
      setEditOpen(false);
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const addBarcodeMutation = useMutation({
    mutationFn: (values: { barcode: string; barcodeType: string }) =>
      apiPost('/api/v1/skus/{skuId}/barcodes', values, { skuId: drawerId ?? '' }),
    onSuccess: () => {
      void message.success('条码已添加');
      setBarcodeModalOpen(false);
      barcodeForm.resetFields();
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const generateInternalMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/v1/skus/{skuId}/barcodes/generate-internal', {}, { skuId: drawerId ?? '' }),
    onSuccess: () => {
      void message.success('内部条码已生成');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const setPrimaryBarcodeMutation = useMutation({
    mutationFn: (barcodeId: string) =>
      apiPatch(
        '/api/v1/skus/{skuId}/barcodes/{barcodeId}',
        { isPrimary: true },
        { skuId: drawerId ?? '', barcodeId },
      ),
    onSuccess: () => {
      void message.success('主条码已切换');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteBarcodeMutation = useMutation({
    mutationFn: (barcodeId: string) =>
      apiDelete('/api/v1/skus/{skuId}/barcodes/{barcodeId}', {
        skuId: drawerId ?? '',
        barcodeId,
      }),
    onSuccess: () => {
      void message.success('条码已删除');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const setPrimaryImageMutation = useMutation({
    mutationFn: (imageId: string) =>
      apiPatch(
        '/api/v1/skus/{skuId}/images/{imageId}',
        { isPrimary: true },
        { skuId: drawerId ?? '', imageId },
      ),
    onSuccess: () => {
      void message.success('主图已切换');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/v1/skus/${drawerId}/images`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      // Non-JSON bodies (proxy HTML error pages) must not become parse errors.
      const text = await response.text();
      let body: { success?: boolean; error?: { message?: string; code?: string } } = {};
      try {
        body = JSON.parse(text) as typeof body;
      } catch {
        throw new Error(`上传失败（HTTP ${response.status}）`);
      }
      if (!response.ok || body.success !== true) {
        throw new Error(body.error?.message ?? `上传失败（HTTP ${response.status}）`);
      }
    },
    onSuccess: () => {
      void message.success('图片已上传');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteImageMutation = useMutation({
    mutationFn: (imageId: string) =>
      apiDelete('/api/v1/skus/{skuId}/images/{imageId}', {
        skuId: drawerId ?? '',
        imageId,
      }),
    onSuccess: () => {
      void message.success('图片已删除');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ---- Platform mapping entries (§11.6): map existing UNMAPPED variant or
  // create a brand-new listing with this SKU as its first variant. ----
  const platforms = useApiQuery<Envelope<Array<{ id: string; name: string; code: string }>>>(
    '/api/v1/platforms',
    {},
    ['platforms'],
    undefined,
    listingCreateOpen,
  );
  const listingPlatformId = Form.useWatch('platformId', listingForm);
  const storesForListing = useApiQuery<
    Envelope<Array<{ id: string; storeCode: string; name: string; platformId: string }>>
  >(
    '/api/v1/stores',
    { page: 1, pageSize: 100, platformId: listingPlatformId },
    ['stores', 'for-listing-create', listingPlatformId ?? 'none'],
    undefined,
    listingCreateOpen,
  );

  const createListingMutation = useMutation({
    mutationFn: (values: {
      platformId: string;
      storeId: string;
      platformProductId: string;
      title?: string;
      offerId?: string;
    }) =>
      apiPost('/api/v1/listings', {
        platformId: values.platformId,
        storeId: values.storeId,
        platformProductId: values.platformProductId,
        title: values.title || undefined,
        skuVariants: [
          { offerId: values.offerId || undefined, skuId: drawerId ?? '' },
        ],
      }),
    onSuccess: () => {
      void message.success('Listing已创建并映射到该SKU');
      setListingCreateOpen(false);
      listingForm.resetFields();
      refreshSku();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  const unmappedListings = useApiQuery<
    Envelope<Array<{ id: string; storeCode: string; platformProductId: string; title: string | null }>>
  >(
    '/api/v1/listings',
    { page: 1, pageSize: 100, mappingState: 'UNMAPPED' },
    ['listings', 'unmapped'],
    undefined,
    mapExistingOpen,
  );
  const mapExistingListingId = Form.useWatch('listingId', mapExistingForm);
  const unmappedDetail = useApiQuery<{
    data: { skus: Array<{ id: string; platformSkuId: string | null; offerId: string | null; mappingStatus: string }> };
  }>(
    '/api/v1/listings/{id}',
    {},
    ['listing-detail', mapExistingListingId],
    { id: mapExistingListingId ?? '' },
    mapExistingListingId !== undefined && mapExistingOpen,
  );

  const mapExistingMutation = useMutation({
    mutationFn: (values: { listingId: string; mappingId: string }) =>
      apiPost(
        '/api/v1/listings/{listingId}/skus/{id}/map',
        { skuId: drawerId ?? '' },
        { listingId: values.listingId, id: values.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射完成（后续同步不会覆盖）');
      setMapExistingOpen(false);
      mapExistingForm.resetFields();
      refreshSku();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const sku = detail.data?.data;
  const rows = list.data?.data ?? [];

  // ---- Context rail: quick view of the selected SKU (task §29) ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="SKU 概览">
            <ContextMetric label="当前筛选结果" value={`${list.data?.meta.total ?? 0} 个 SKU`} />
            <ContextMetric label="本页" value={`${rows.length} 条`} />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击表格任意行，在此快速预览 SKU 库存与映射概况。
            </span>
          </ContextSection>
        ),
      };
    }
    const totals = selectedInventory.data?.data.totals;
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          image={
            selectedRow.primaryImageUrl !== null ? (
              <Image
                src={selectedRow.primaryImageUrl}
                width={56}
                height={56}
                preview={false}
                style={{ objectFit: 'cover', borderRadius: 8 }}
              />
            ) : (
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 8,
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
            )
          }
          title={selectedRow.skuCode}
          subtitle={selectedRow.nameZh}
          badge={
            <StatusBadge
              tone={SKU_STATUS_META[selectedRow.status]?.tone ?? 'neutral'}
              label={SKU_STATUS_META[selectedRow.status]?.label ?? selectedRow.status}
              hint={selectedRow.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="库存">
            {selectedInventory.isLoading ? (
              <ContextMetric label="加载中…" value="—" />
            ) : totals === undefined ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无库存记录</span>
            ) : (
              <>
                <ContextMetric label="On Hand" value={fmtQty(totals.onHandQty)} strong />
                <ContextMetric label="Reserved" value={fmtQty(totals.reservedQty)} />
                <ContextMetric label="可售" value={fmtQty(totals.sellableAvailableQty)} strong />
              </>
            )}
          </ContextSection>
          <ContextSection title="映射与标识">
            <ContextMetric
              label="平台映射"
              value={
                selectedRow.listingCount > 0 ? `${selectedRow.listingCount} 个 Listing` : '未映射'
              }
            />
            <ContextMetric label="主条码" value={selectedRow.primaryBarcode ?? '—'} />
            <ContextMetric
              label="成本"
              value={
                selectedRow.latestPurchasePrice !== null
                  ? `¥${selectedRow.latestPurchasePrice}`
                  : '—'
              }
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDrawerId(selectedRow.id)}>
              打开完整详情
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, selectedInventory.data, selectedInventory.isLoading, list.data, rows.length]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="SKU管理"
        description="管理内部 SKU、条码、成本、库存及平台映射"
        primary={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新增SKU
          </Button>
        }
      />

      <FilterBar
        actions={
          <>
            {(keyword !== '' ||
              brandId !== undefined ||
              categoryId !== undefined ||
              status !== undefined ||
              hasListing !== undefined) && (
              <Button
                onClick={() => {
                  setKeyword('');
                  setBrandId(undefined);
                  setCategoryId(undefined);
                  setStatus(undefined);
                  setHasListing(undefined);
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
          placeholder="搜索 SKU / 名称 / 型号"
          allowClear
          defaultValue={keyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索 SKU"
        />
        <Select
          allowClear
          placeholder="品牌"
          style={{ width: 140 }}
          showSearch
          optionFilterProp="label"
          value={brandId}
          onChange={(value) => {
            setPage(1);
            setBrandId(value);
          }}
          options={(brands.data?.data ?? [])
            .filter((brand) => brand.status === 'ACTIVE')
            .map((brand) => ({ value: brand.id, label: brand.name }))}
        />
        <Cascader
          allowClear
          placeholder="类目（含子类）"
          style={{ width: 180 }}
          changeOnSelect
          options={categoryOptions}
          value={categoryId === undefined ? undefined : categoryPathOf(categoryOptions, categoryId)}
          onChange={(path) => {
            setPage(1);
            setCategoryId(path === null || path.length === 0 ? undefined : String(path[path.length - 1]));
          }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 110 }}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={[
            { value: 'ACTIVE', label: '启用' },
            { value: 'INACTIVE', label: '停用' },
            { value: 'DRAFT', label: '草稿' },
          ]}
        />
        <Select
          allowClear
          placeholder="平台映射"
          style={{ width: 130 }}
          value={hasListing}
          onChange={(value) => {
            setPage(1);
            setHasListing(value);
          }}
          options={[
            { value: 'true', label: '已映射平台' },
            { value: 'false', label: '未映射' },
          ]}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<SkuRow>
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 个 SKU`,
          }}
          rowClassName={(record) => (record.id === selectedId ? 'wcies-row-selected' : '')}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          scroll={{ x: 1080 }}
          emptyTitle="没有匹配的 SKU"
          emptyDescription="调整筛选条件或新增 SKU。"
          columns={[
            {
              title: '商品',
              key: 'product',
              width: 300,
              render: (_: unknown, record: SkuRow) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {record.primaryImageUrl !== null ? (
                    <Image
                      src={record.primaryImageUrl}
                      width={44}
                      height={44}
                      preview={false}
                      style={{ objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 8,
                        background: colors.neutralBg,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 550,
                        color: colors.textPrimary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {record.nameZh}
                    </div>
                    <div style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>
                      {record.skuCode}
                      {record.brandName !== null && ` · ${record.brandName}`}
                    </div>
                  </div>
                </div>
              ),
            },
            {
              title: '型号 / 规格',
              key: 'spec',
              width: 150,
              render: (_: unknown, record: SkuRow) => {
                const spec = [record.model, record.color, record.size].filter(
                  (part) => part !== null && part !== '',
                );
                return spec.length > 0 ? spec.join(' / ') : '—';
              },
            },
            {
              title: '条码',
              dataIndex: 'primaryBarcode',
              width: 150,
              render: (value: string | null) => value ?? '—',
            },
            {
              title: '成本',
              dataIndex: 'latestPurchasePrice',
              width: 100,
              align: 'right',
              render: (value: number | null) => (value !== null ? `¥${value}` : '—'),
            },
            {
              title: '平台映射',
              dataIndex: 'listingCount',
              width: 110,
              align: 'right',
              render: (value: number) =>
                value > 0 ? (
                  <span style={{ color: colors.primary, fontWeight: 550 }}>{value} 个</span>
                ) : (
                  <span style={{ color: colors.textTertiary }}>未映射</span>
                ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <StatusBadge
                  tone={SKU_STATUS_META[value]?.tone ?? 'neutral'}
                  label={SKU_STATUS_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
              ),
            },
            {
              title: '更新时间',
              dataIndex: 'updatedAt',
              width: 110,
              render: (value: string) => value.slice(5, 10),
            },
            {
              title: '操作',
              key: 'actions',
              width: 110,
              fixed: 'right',
              render: (_: unknown, record: SkuRow) => (
                <ActionMenu
                  primary={
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4 }}
                      onClick={() => setDrawerId(record.id)}
                    >
                      查看
                    </Button>
                  }
                  items={[
                    {
                      key: 'view',
                      label: '查看详情',
                      onClick: () => setDrawerId(record.id),
                    },
                    record.status === 'ACTIVE'
                      ? {
                          key: 'deactivate',
                          label: '停用',
                          danger: true,
                          onClick: () =>
                            statusMutation.mutate({ id: record.id, action: 'deactivate' }),
                        }
                      : {
                          key: 'activate',
                          label: '启用',
                          onClick: () =>
                            statusMutation.mutate({ id: record.id, action: 'activate' }),
                        },
                  ]}
                />
              ),
            },
          ]}
        />
      </SectionCard>

      <SkuCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Drawer
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
        size={800}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 650 }}>{sku ? sku.skuCode : 'SKU详情'}</span>
            {sku !== undefined && (
              <StatusBadge
                tone={SKU_STATUS_META[sku.status]?.tone ?? 'neutral'}
                label={SKU_STATUS_META[sku.status]?.label ?? sku.status}
                hint={sku.status}
              />
            )}
          </div>
        }
        extra={
          sku !== undefined && (
            <>
              <Button
                onClick={() => {
                  if (drawerId === null) {
                    return;
                  }
                  editForm.resetFields();
                  editForm.setFieldsValue({
                    nameZh: sku.nameZh,
                    nameRu: sku.nameRu ?? undefined,
                    model: sku.model ?? undefined,
                    color: sku.color ?? undefined,
                    size: sku.size ?? undefined,
                    weightG: sku.weightG ?? undefined,
                    lengthMm: sku.lengthMm ?? undefined,
                    widthMm: sku.widthMm ?? undefined,
                    heightMm: sku.heightMm ?? undefined,
                    purchaseUrl: sku.purchaseUrl ?? undefined,
                    latestPurchasePrice: sku.latestPurchasePrice ?? undefined,
                  });
                  setEditOpen(true);
                }}
              >
                编辑
              </Button>
              {sku.status !== 'ACTIVE' && (
                <Button
                  type="primary"
                  onClick={() => statusMutation.mutate({ id: sku.id, action: 'activate' })}
                >
                  启用
                </Button>
              )}
              {sku.status === 'ACTIVE' && (
                <Popconfirm
                  title="确认停用该SKU？"
                  onConfirm={() => statusMutation.mutate({ id: sku.id, action: 'deactivate' })}
                >
                  <Button danger>停用</Button>
                </Popconfirm>
              )}
              <Button
                danger
                onClick={() => {
                  modal.confirm({
                    title: '确认删除该SKU？',
                    content: '仅零引用（无条码/库存/订单/映射）的SKU可以删除；被引用时会返回具体原因。',
                    okText: '删除',
                    okButtonProps: { danger: true },
                    onOk: () => {
                      deleteMutation.mutate(sku.id);
                    },
                  });
                }}
              >
                删除
              </Button>
            </>
          )
        }
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        <Tabs
          style={{ paddingInline: 20 }}
          items={[
            {
              key: 'base',
              label: '概览',
              children: sku !== undefined && (
                <InfoGrid
                  items={[
                    { label: 'SKU Code', children: sku.skuCode },
                    { label: '中文名称', children: sku.nameZh },
                    {
                      label: '商品',
                      children: `${sku.productCode} ${sku.productName}`,
                    },
                    { label: '品牌', children: sku.brandName ?? '—' },
                    { label: '型号', children: sku.model ?? '—' },
                    {
                      label: '颜色 / 尺寸',
                      children: [sku.color, sku.size].filter((v) => v !== null).join(' / ') || '—',
                    },
                    { label: '重量(g)', children: sku.weightG ?? '—' },
                    {
                      label: '最新采购价(CNY)',
                      children:
                        sku.latestPurchasePrice !== null ? `¥${sku.latestPurchasePrice}` : '—',
                    },
                    {
                      label: '采购链接',
                      span: 2,
                      children:
                        sku.purchaseUrl !== null && sku.purchaseUrl !== '' ? (
                          <a href={sku.purchaseUrl} target="_blank" rel="noreferrer">
                            {sku.purchaseUrl}
                          </a>
                        ) : (
                          '—'
                        ),
                    },
                    { label: 'SN管理', children: sku.serialTracking ? '是' : '否' },
                    {
                      label: '平台映射',
                      children: `${mappings.data?.data.length ?? 0} 个 Listing`,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'barcodes',
              label: `条码 (${barcodes.data?.data.length ?? 0})`,
              children: (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 20 }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button
                      type="primary"
                      onClick={() => setBarcodeModalOpen(true)}
                      disabled={drawerId === null}
                    >
                      添加条码
                    </Button>
                    <Button
                      onClick={() => generateInternalMutation.mutate()}
                      disabled={drawerId === null}
                    >
                      生成内部条码
                    </Button>
                  </div>
                  <DataTable<BarcodeRow>
                    rowKey="id"
                    dataSource={barcodes.data?.data ?? []}
                    pagination={false}
                    loading={barcodes.isLoading}
                    emptyTitle="暂无条码"
                    columns={[
                      { title: '条码', dataIndex: 'barcode' },
                      {
                        title: '类型',
                        dataIndex: 'barcodeType',
                        width: 120,
                        render: (value: string) => BARCODE_TYPE_LABEL[value] ?? value,
                      },
                      {
                        title: '主条码',
                        dataIndex: 'isPrimary',
                        width: 120,
                        render: (v: boolean, record) =>
                          v ? (
                            <StatusBadge tone="info" label="主条码" showDot={false} />
                          ) : (
                            <Button
                              size="small"
                              onClick={() => setPrimaryBarcodeMutation.mutate(record.id)}
                            >
                              设为主条码
                            </Button>
                          ),
                      },
                      {
                        title: '操作',
                        width: 80,
                        render: (_, record) => (
                          <Popconfirm
                            title="确认删除该条码？"
                            onConfirm={() => deleteBarcodeMutation.mutate(record.id)}
                          >
                            <Button size="small" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                </div>
              ),
            },
            {
              key: 'images',
              label: `图片 (${images.data?.data.length ?? 0})`,
              children: (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 20 }}
                >
                  <Upload
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    showUploadList={false}
                    disabled={uploadMutation.isPending || drawerId === null}
                    customRequest={({ file }) => uploadMutation.mutate(file as File)}
                  >
                    <Button type="primary" loading={uploadMutation.isPending}>
                      上传图片
                    </Button>
                  </Upload>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {(images.data?.data ?? []).map((image) => (
                      <div key={image.id} style={{ textAlign: 'center' }}>
                        <Image
                          src={image.url}
                          width={110}
                          height={110}
                          style={{ objectFit: 'cover', borderRadius: 8 }}
                        />
                        <div style={{ paddingTop: 4 }}>
                          {image.isPrimary ? (
                            <StatusBadge tone="info" label="主图" showDot={false} />
                          ) : (
                            <Button
                              size="small"
                              type="link"
                              onClick={() => setPrimaryImageMutation.mutate(image.id)}
                            >
                              设为主图
                            </Button>
                          )}
                          <Popconfirm
                            title="确认删除该图片？"
                            onConfirm={() => deleteImageMutation.mutate(image.id)}
                          >
                            <Button size="small" type="link" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            },
            {
              key: 'mappings',
              label: `平台映射 (${mappings.data?.data.length ?? 0})`,
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, paddingBottom: 4 }}>
                    <Button
                      type="primary"
                      disabled={drawerId === null}
                      onClick={() => {
                        listingForm.resetFields();
                        setListingCreateOpen(true);
                      }}
                    >
                      新建 Listing 并映射
                    </Button>
                    <Button
                      disabled={drawerId === null}
                      onClick={() => {
                        mapExistingForm.resetFields();
                        setMapExistingOpen(true);
                      }}
                    >
                      映射未映射变体
                    </Button>
                  </div>
                  <DataTable<MappingRow>
                  rowKey="id"
                  size="small"
                  dataSource={mappings.data?.data ?? []}
                  pagination={false}
                  loading={mappings.isLoading}
                  emptyTitle="暂无平台映射"
                  emptyDescription="该 SKU 尚未映射到任何平台 Listing。"
                  columns={[
                    {
                      title: '平台',
                      dataIndex: 'platformCode',
                      width: 110,
                      render: (value: string) => <PlatformTag code={value} />,
                    },
                    { title: '店铺', dataIndex: 'storeCode', width: 110 },
                    { title: 'Platform Product ID', dataIndex: 'platformProductId' },
                    { title: 'Offer ID', dataIndex: 'offerId' },
                    { title: 'Seller SKU', dataIndex: 'sellerSku' },
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
                  ]}
                />
                </div>
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        title="添加条码"
        open={barcodeModalOpen}
        onCancel={() => setBarcodeModalOpen(false)}
        onOk={() =>
          void barcodeForm.validateFields().then((values) => addBarcodeMutation.mutate(values))
        }
        confirmLoading={addBarcodeMutation.isPending}
      >
        <Form form={barcodeForm} layout="vertical">
          <Form.Item
            name="barcode"
            label="条码"
            rules={[{ required: true, message: '请输入条码' }]}
          >
            <Input placeholder="69码 / EAN / GTIN" />
          </Form.Item>
          <Form.Item
            name="barcodeType"
            label="类型"
            initialValue="EAN"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'EAN', label: 'EAN（69码）' },
                { value: 'GTIN', label: 'GTIN' },
                { value: 'MANUFACTURER', label: '厂商条码' },
                { value: 'INTERNAL', label: '内部条码' },
                { value: 'OTHER', label: '其他' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- SKU edit modal (code read-only, decision #8) ---- */}
      <Modal
        title="编辑SKU"
        open={editOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            editForm.resetFields();
          }
        }}
        onCancel={() => setEditOpen(false)}
        onOk={() => void editForm.validateFields().then((values) => updateMutation.mutate(values))}
        confirmLoading={updateMutation.isPending}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="SKU 编码（生成后冻结）">
            <Input value={sku?.skuCode ?? ''} disabled />
          </Form.Item>
          <Form.Item name="nameZh" label="中文名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nameRu" label="俄文名称">
            <Input />
          </Form.Item>
          <Form.Item name="model" label="型号">
            <Input />
          </Form.Item>
          <Form.Item name="color" label="颜色">
            <Input />
          </Form.Item>
          <Form.Item name="size" label="尺寸">
            <Input />
          </Form.Item>
          <Form.Item name="weightG" label="重量(g)">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="purchaseUrl" label="采购链接">
            <Input maxLength={1000} />
          </Form.Item>
          <Form.Item name="latestPurchasePrice" label="最新采购价（CNY）">
            <Input type="number" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Create a new listing mapped to this SKU (§11.6) ---- */}
      <Modal
        title="新建 Listing 并映射"
        open={listingCreateOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            listingForm.resetFields();
          }
        }}
        onCancel={() => setListingCreateOpen(false)}
        onOk={() =>
          void listingForm.validateFields().then((values) => createListingMutation.mutate(values))
        }
        confirmLoading={createListingMutation.isPending}
      >
        <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
          将创建一个新的平台商品链接，并把当前 SKU 作为其第一个变体映射。
        </p>
        <Form form={listingForm} layout="vertical">
          <Form.Item name="platformId" label="平台" rules={[{ required: true, message: '请选择平台' }]}>
            <Select
              options={(platforms.data?.data ?? []).map((platform) => ({
                value: platform.id,
                label: platform.name,
              }))}
            />
          </Form.Item>
          <Form.Item name="storeId" label="店铺" rules={[{ required: true, message: '请选择店铺' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(storesForListing.data?.data ?? []).map((store) => ({
                value: store.id,
                label: `${store.storeCode} · ${store.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="platformProductId"
            label="Platform Product ID"
            rules={[{ required: true, message: '请输入平台商品 ID' }]}
          >
            <Input placeholder="如 152987456001" />
          </Form.Item>
          <Form.Item name="title" label="标题">
            <Input />
          </Form.Item>
          <Form.Item name="offerId" label="Offer ID（可选）">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Map an existing UNMAPPED platform variant to this SKU (§11.6) ---- */}
      <Modal
        title="映射未映射变体"
        open={mapExistingOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            mapExistingForm.resetFields();
          }
        }}
        onCancel={() => setMapExistingOpen(false)}
        onOk={() =>
          void mapExistingForm.validateFields().then((values) => {
            if (drawerId === null) {
              void message.error('SKU 上下文丢失，请重新打开后重试');
              return;
            }
            mapExistingMutation.mutate({
              listingId: values.listingId,
              mappingId: values.mappingId,
            });
          })
        }
        confirmLoading={mapExistingMutation.isPending}
      >
        <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
          选择一个同步而来的未映射变体，将其绑定到当前 SKU；后续平台同步不会覆盖该映射。
        </p>
        <Form form={mapExistingForm} layout="vertical">
          <Form.Item name="listingId" label="Listing" rules={[{ required: true, message: '请选择 Listing' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(unmappedListings.data?.data ?? []).map((listing) => ({
                value: listing.id,
                label: `${listing.storeCode} / ${listing.platformProductId}${listing.title !== null ? ` · ${listing.title}` : ''}`,
              }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.listingId !== next.listingId}>
            {() => (
              <Form.Item
                name="mappingId"
                label="未映射变体"
                rules={[{ required: true, message: '请选择要映射的变体' }]}
              >
                <Select
                  options={(unmappedDetail.data?.data.skus ?? [])
                    .filter((variant) => variant.mappingStatus === 'UNMAPPED')
                    .map((variant) => ({
                      value: variant.id,
                      label:
                        variant.platformSkuId ?? variant.offerId ?? variant.id.slice(0, 8),
                    }))}
                />
              </Form.Item>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
