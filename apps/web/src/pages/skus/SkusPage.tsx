import { useMutation, useQueryClient } from '@tanstack/react-query';
import { validate69Barcode } from '@wcies/shared';
import {
  Alert,
  App,
  Button,
  Cascader,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tabs,
  Upload,
} from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiDelete, apiPatch, apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';
import { fmtMoney } from '../../utils/format';
import { SkuCreateModal } from '../../components/SkuCreateModal';
import { CategoryManageModal } from '../../components/CategoryManageModal';
import { BrandManageModal } from '../../components/BrandManageModal';
import {
  BrandQuickCreateModal,
  CategoryQuickCreateModal,
} from '../../components/QuickCreateModals';
import { printTasksBrowser } from '../../printing/print-browser';
import { brandSearchText } from '../../utils/brandSearch';
import {
  DeleteConfirmModal,
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  InfoGrid,
  PageHeader,
  RailHint,
  RelativeTime,
  SectionCard,
  SKU_STATUS_META,
  BARCODE_TYPE_LABEL,
  PlatformTag,
  StatusBadge,
  StatusSwitch,
  CopyTextButton,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

/**
 * SKU management (redesign task §26-§30): header + unified filter bar +
 * dense table, with a context-rail quick view (row click) and a full detail
 * drawer (查看 action). Business mutations are unchanged from Sprint 1/5.
 *
 * V1 改造（2026-10-13）：商品层移除——SKU 是唯一商品主数据，分类/品牌是
 * SKU 字段（D5）；分类管理与品牌管理入口从已删除的商品页迁入本页（D4）。
 */

interface SkuMergePreview {
  source: { id: string; skuCode: string; nameZh: string; status: string };
  target: { id: string; skuCode: string; nameZh: string; status: string };
  references: Record<string, number>;
  product: {
    platformMappings: number;
    barcodes: number;
    duplicateBarcodes: number;
    images: number;
    bundleAsBundle: number;
    bundleAsComponent: number;
    bundleConflicts: number;
  };
  inventory: {
    balances: number;
    onHandQty: string;
    reservedQty: string;
    pickedQty: string;
    reservations: number;
    serials: number;
    safetyStacks?: number;
    safetyStocks: number;
    transactions: number;
  };
}

interface SkuRow {
  id: string;
  skuCode: string;
  nameZh: string;
  nameRu: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
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
  code: string;
  name: string;
  nameZh: string | null;
  nameEn: string | null;
  nameRu: string | null;
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
  disabled?: boolean;
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

/** Cascader options for create/edit forms: only level-3 leaves are pickable. */
function toLeafCategoryOption(node: CategoryNode): CategoryOption {
  const children = (node.children ?? [])
    .filter((child) => child.status === 'ACTIVE')
    .map((child) => toLeafCategoryOption(child));
  return {
    value: node.id,
    label: node.nameZh,
    // Childless level-1/2 nodes would be selectable leaves — block them.
    disabled: node.level < 3 && (node.children ?? []).length === 0,
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

/**
 * Every value the edit form shows (Sprint 8.5R1): the form previously omitted
 * 长/宽/高/SN管理, so opening 编辑 asked for fields the operator could not even
 * see. `undefined` (not null) keeps the PATCH body a partial update.
 *
 * V1（D5）：品牌/分类是 SKU 字段，随表单编辑（分类以路径回填级联）。
 */
function editFormValues(
  sku: SkuRow,
  leafCategoryOptions: CategoryOption[],
): Record<string, unknown> {
  return {
    nameZh: sku.nameZh,
    nameRu: sku.nameRu ?? undefined,
    brandId: sku.brandId ?? undefined,
    categoryPath:
      sku.categoryId !== null
        ? (categoryPathOf(leafCategoryOptions, sku.categoryId) ?? undefined)
        : undefined,
    model: sku.model ?? undefined,
    color: sku.color ?? undefined,
    size: sku.size ?? undefined,
    weightG: sku.weightG ?? undefined,
    lengthMm: sku.lengthMm ?? undefined,
    widthMm: sku.widthMm ?? undefined,
    heightMm: sku.heightMm ?? undefined,
    purchaseUrl: sku.purchaseUrl ?? undefined,
    latestPurchasePrice: sku.latestPurchasePrice ?? undefined,
    serialTracking: sku.serialTracking,
  };
}

/**
 * All-or-none dimension rule, mirrored from the backend
 * (SKU_DIMENSIONS_INVALID): the API rejects 1 or 2 of 长/宽/高.
 */
function dimensionGroupRule(form: { getFieldValue: (name: string) => unknown }): {
  validator: () => Promise<void>;
} {
  return {
    validator: () => {
      const filled = (['lengthMm', 'widthMm', 'heightMm'] as const).filter((name) => {
        const value = form.getFieldValue(name);
        return value !== undefined && value !== null;
      });
      return filled.length === 0 || filled.length === 3
        ? Promise.resolve()
        : Promise.reject(new Error('长/宽/高需三项都填，或三项都留空'));
    },
  };
}

const fmtQty = (value: string): string => (Number(value) % 1 === 0 ? String(Number(value)) : value);

export function SkusPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  // 搜索防抖（2026-10-17 体检 P0-3）：输入态即时回显，查询态防抖 300ms。
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);
  // 关键词（防抖后）变化时回到第 1 页，避免停在末页看到空结果。
  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);
  const [brandId, setBrandId] = useState<string | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [hasListing, setHasListing] = useState<string | undefined>();
  // Three-level interaction (task §19): row click → rail preview, 查看 → drawer.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [printFor, setPrintFor] = useState<SkuRow | null>(null);
  const [printBarcode, setPrintBarcode] = useState<string>('');
  const [printCopies, setPrintCopies] = useState(1);
  const [createOpen, setCreateOpen] = useState(() => searchParams.get('create') === '1');

  // ---- Delete confirmation (normal vs forced cascade) ----
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    skuCode: string;
    listingCount: number;
  } | null>(null);
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  // 弹窗打开时锁定目标 SKU：提交时不能读实时 drawerId——抽屉一旦被关掉
  // （Esc/遮罩/其它选中动作）drawerId 变 null，会 POST /skus//barcodes 得到
  // 404「Cannot POST」（2026-10-17 用户录入 69 码报错的实际原因）。
  const [barcodeTargetSkuId, setBarcodeTargetSkuId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  // 编辑弹窗打开时锁定目标 SKU（同 barcodeTargetSkuId 的理由）：右栏入口
  // 没有打开抽屉，提交时不能读 drawerId。
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [listingCreateOpen, setListingCreateOpen] = useState(false);
  // 映射平台商品 (rail quick action): snapshot the SKU to bind — the rail
  // selection may change while the modal is open.
  const [mapPlatformOpen, setMapPlatformOpen] = useState(false);
  const [mapPlatformTarget, setMapPlatformTarget] = useState<{
    id: string;
    skuCode: string;
  } | null>(null);
  /**
   * 合并到其他 SKU（2026-10-24 用户需求）：把「其实是同一件实物」的重复档案
   * 并到一个 SKU 上。源 SKU 会消失，目标 SKU 保留基础信息。
   */
  const [mergeSource, setMergeSource] = useState<{ id: string; skuCode: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeKeyword, setMergeKeyword] = useState('');
  const [mergeConfirmCode, setMergeConfirmCode] = useState('');
  const [mergeForm] = Form.useForm();
  const [barcodeForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [listingForm] = Form.useForm();
  const [mapPlatformForm] = Form.useForm();
  const [listingKeyword, setListingKeyword] = useState('');
  const debouncedListingKeyword = useDebouncedValue(listingKeyword);
  // V1（D4）：分类/品牌管理入口（弹窗从已删除的商品页迁入 + 新建）。
  const [categoryManageOpen, setCategoryManageOpen] = useState(false);
  const [brandManageOpen, setBrandManageOpen] = useState(false);
  // 编辑表单内的品牌/分类现场快建（G9）。
  const [brandQuickOpen, setBrandQuickOpen] = useState(false);
  const [categoryQuickOpen, setCategoryQuickOpen] = useState(false);

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
      keyword: debouncedKeyword || undefined,
      brandId,
      categoryId,
      status,
      hasListing,
    },
    ['skus', page, debouncedKeyword, brandId, categoryId, status, hasListing],
  );
  const brands = useApiQuery<Envelope<BrandItem[]>>('/api/v1/brands', { keyword: '' }, ['brands']);
  // Sprint 8.5R1: tree-lite (column-pruned) - the cascader only reads these
  // fields, and the full 8k-node tree cost megabytes per page load.
  const categories = useApiQuery<Envelope<CategoryNode[]>>('/api/v1/categories/tree-lite', {}, [
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
  /** Create/edit cascader options: only level-3 leaves are pickable (D5). */
  const leafCategoryOptions = useMemo(
    () =>
      (categories.data?.data ?? [])
        .filter((node) => node.status === 'ACTIVE')
        .map((node) => toLeafCategoryOption(node)),
    [categories.data],
  );
  // 品牌选项：可见 label 保持简洁；searchText 汇总编码 + 四个名称（一般/中文/
  // 英文/俄文），配合 optionFilterProp="searchText" 让"只知道中文名也能搜到"。
  const brandOptions = (brands.data?.data ?? []).map((brand) => ({
    value: brand.id,
    // 停用品牌保留可选但带后缀（与分类筛选一致，不过滤无标注）。
    label: brand.status === 'ACTIVE' ? brand.name : `${brand.name}（停用）`,
    searchText: brandSearchText(brand),
  }));

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
      void message.success(variables.action === 'activate' ? 'SKU 已启用' : 'SKU 已停用');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      apiDelete(`/api/v1/skus/{id}${force ? '?force=true' : ''}`, { id }),
    onSuccess: () => {
      void message.success('SKU 已删除');
      setDrawerId(null);
      setSelectedId(null);
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const confirmDeleteSku = (id: string, skuCode: string, listingCount: number) => {
    setDeleteTarget({ id, skuCode, listingCount });
  };

  const updateMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      // 编辑入口已从详情抽屉迁到右栏（2026-10-19）：不能再读 drawerId——
      // 右栏打开编辑时抽屉是关着的，drawerId 为 null 会 PATCH /skus/ 得到
      // 404（2026-10-21 用户报错的实际原因）。目标 id 在开窗时锁定。
      if (editTargetId === null) {
        throw new Error('未选择 SKU，请重新打开编辑弹窗');
      }
      const { categoryPath, brandId, ...rest } = values;
      const path = categoryPath as string[] | undefined;
      return apiPatch(
        '/api/v1/skus/{id}',
        {
          ...rest,
          // V1（D5）：品牌/分类随 SKU 编辑；清空选择 = 解除挂载（null），
          // 与商品页编辑表单的旧约定一致。
          brandId: (brandId as string | undefined) ?? null,
          categoryId:
            path !== undefined && path.length > 0 ? (path[path.length - 1] ?? null) : null,
        },
        { id: editTargetId },
      );
    },
    onSuccess: () => {
      void message.success('SKU 已更新');
      setEditOpen(false);
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const addBarcodeMutation = useMutation({
    mutationFn: (values: { barcode: string; barcodeType: string }) => {
      if (barcodeTargetSkuId === null) {
        throw new Error('未选择商品，请重新打开商品详情后再添加条码');
      }
      return apiPost('/api/v1/skus/{skuId}/barcodes', values, { skuId: barcodeTargetSkuId });
    },
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

  // ---- Platform mapping entries: map an existing UNMAPPED variant via the
  // searchable「映射平台商品」picker, or create a brand-new listing with this
  // SKU as its first variant. ----
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
          { offerId: values.offerId || undefined, skuId: selectedRow?.id ?? drawerId ?? '' },
        ],
      }),
    onSuccess: () => {
      void message.success('商品链接已创建并映射到该 SKU');
      setListingCreateOpen(false);
      listingForm.resetFields();
      refreshSku();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  // 映射平台商品 picker: server-side keyword search across ALL platforms
  // (partial-mapped listings are listed too — only their UNMAPPED variants
  // are offered below).
  const listingOptions = useApiQuery<
    Envelope<
      Array<{
        id: string;
        platformCode: string;
        storeCode: string;
        platformProductId: string;
        title: string | null;
      }>
    >
  >(
    '/api/v1/listings',
    { page: 1, pageSize: 50, keyword: debouncedListingKeyword || undefined },
    ['listings', 'for-sku-map', debouncedListingKeyword],
    undefined,
    mapPlatformOpen,
  );
  const mapPlatformListingId = Form.useWatch('listingId', mapPlatformForm);
  const mapPlatformDetail = useApiQuery<{
    data: {
      skus: Array<{
        id: string;
        platformSkuId: string | null;
        offerId: string | null;
        sellerSku: string | null;
        mappingStatus: string;
      }>;
    };
  }>(
    '/api/v1/listings/{id}',
    {},
    ['listing-detail', mapPlatformListingId],
    { id: mapPlatformListingId ?? '' },
    mapPlatformListingId !== undefined && mapPlatformOpen,
  );
  const mapPlatformVariants = useMemo(
    () =>
      (mapPlatformDetail.data?.data.skus ?? []).filter((row) => row.mappingStatus === 'UNMAPPED'),
    [mapPlatformDetail.data],
  );
  // Preselect the first unmapped variant once the detail arrives (or when the
  // current selection is no longer among the options).
  useEffect(() => {
    if (!mapPlatformOpen || mapPlatformVariants.length === 0) {
      return;
    }
    const current = mapPlatformForm.getFieldValue('mappingId') as string | undefined;
    if (!mapPlatformVariants.some((row) => row.id === current)) {
      mapPlatformForm.setFieldValue('mappingId', mapPlatformVariants[0]!.id);
    }
  }, [mapPlatformOpen, mapPlatformVariants, mapPlatformForm]);

  const mapPlatformMutation = useMutation({
    mutationFn: (values: { listingId: string; mappingId: string }) =>
      apiPost(
        '/api/v1/listings/{listingId}/skus/{id}/map',
        { skuId: mapPlatformTarget?.id ?? '' },
        { listingId: values.listingId, id: values.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射完成（后续同步不会覆盖）');
      setMapPlatformOpen(false);
      mapPlatformForm.resetFields();
      refreshSku();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const sku = detail.data?.data;
  // Prefill (Sprint 8.5R1): re-apply as soon as a fresh detail is available
  // while the modal is open. 操作 → 编辑 opens the modal BEFORE the detail
  // query resolves, so a one-shot prefill at click time left the form blank -
  // and the PATCH then had to be typed out from scratch.
  const editPrefilledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!editOpen || editTargetId === null) {
      editPrefilledFor.current = null;
      return;
    }
    // 只接受「属于当前编辑目标」的详情，防止用上一个 SKU 的抽屉缓存覆盖表单。
    if (sku === undefined || sku.id !== editTargetId || editPrefilledFor.current === sku.id) {
      return;
    }
    editPrefilledFor.current = sku.id;
    editForm.setFieldsValue(editFormValues(sku, leafCategoryOptions));
  }, [editOpen, editTargetId, sku, editForm, leafCategoryOptions]);
  const printBarcodes = useApiQuery<{
    data: Array<{ barcode: string; isPrimary: boolean; barcodeType: string }>;
  }>(
    '/api/v1/skus/{skuId}/barcodes',
    {},
    ['sku-print-barcodes', printFor?.id],
    { skuId: printFor?.id ?? '' },
    printFor !== null,
  );
  // 打印弹窗打开时条码列表是异步到达的：若此时仍未选中（主条码为空的
  // SKU，或行菜单入口在数据到达前打开），自动补选主条码或首个条码，
  // 不让用户面对空下拉。
  useEffect(() => {
    if (printFor === null || printBarcode !== '') {
      return;
    }
    const barcodes = printBarcodes.data?.data ?? [];
    if (barcodes.length === 0) {
      return;
    }
    const primary = barcodes.find((b) => b.isPrimary) ?? barcodes[0]!;
    setPrintBarcode(primary.barcode);
  }, [printFor, printBarcode, printBarcodes.data]);

  const rows = list.data?.data ?? [];

  // 编辑弹窗展示用的 SKU：优先用抽屉详情（仅当它就是编辑目标），否则回落到
  // 列表行——右栏入口不打开抽屉，详情数据可能还是上一个 SKU 的残留
  // （2026-10-21）。
  const editSku = useMemo(() => {
    if (editTargetId === null) {
      return null;
    }
    if (sku !== undefined && sku.id === editTargetId) {
      return sku;
    }
    return rows.find((row) => row.id === editTargetId) ?? null;
  }, [editTargetId, sku, rows]);

  // ---- Context rail: quick view of the selected SKU (task §29) ----
  // ---- 合并到其他 SKU（2026-10-24）----
  const mergeTargets = useApiQuery<{ data: SkuRow[] }>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, ...(mergeKeyword ? { keyword: mergeKeyword } : {}) },
    ['skus-merge-targets', mergeKeyword],
    undefined,
    mergeSource !== null,
  );
  const mergePreview = useApiQuery<{ data: SkuMergePreview }>(
    '/api/v1/skus/{id}/merge-preview',
    { targetSkuId: mergeTargetId ?? '' },
    ['sku-merge-preview', mergeSource?.id ?? '', mergeTargetId ?? ''],
    { id: mergeSource?.id ?? '' },
    mergeSource !== null && mergeTargetId !== null,
  );
  const mergeMutation = useMutation({
    mutationFn: ({
      sourceId,
      targetSkuId,
      confirmSkuCode,
    }: {
      sourceId: string;
      targetSkuId: string;
      confirmSkuCode: string;
    }) =>
      apiPost<{ mergedSourceSkuCode: string; targetSkuCode: string }>(
        '/api/v1/skus/{id}/merge-into',
        { targetSkuId, confirmSkuCode },
        { id: sourceId },
      ),
    onSuccess: (result) => {
      void message.success(
        `已把 ${result.mergedSourceSkuCode} 合并到 ${result.targetSkuCode}（源档案已删除）`,
      );
      setMergeSource(null);
      setMergeTargetId(null);
      setMergeConfirmCode('');
      void queryClient.invalidateQueries({ queryKey: ['skus'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error: Error) => void message.error(`合并失败：${error.message}`),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="SKU 概览">
            <ContextMetric label="当前筛选结果" value={`${list.data?.meta.total ?? 0} 个 SKU`} />
            <ContextMetric label="本页" value={`${rows.length} 条`} />
            <RailHint>点击表格任意行，在此快速预览 SKU 库存与映射概况。</RailHint>
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
                <ContextMetric label="在库" value={fmtQty(totals.onHandQty)} strong />
                <ContextMetric label="已占用" value={fmtQty(totals.reservedQty)} />
                <ContextMetric label="可售" value={fmtQty(totals.sellableAvailableQty)} strong />
              </>
            )}
          </ContextSection>
          <ContextSection title="规格">
            <ContextMetric
              label="重量"
              value={selectedRow.weightG !== null ? `${selectedRow.weightG} g` : '—'}
            />
          </ContextSection>
          <ContextSection title="映射与标识">
            <ContextMetric
              label="平台映射"
              value={
                selectedRow.listingCount > 0 ? `${selectedRow.listingCount} 个商品链接` : '未映射'
              }
            />
            <ContextMetric label="主条码" value={selectedRow.primaryBarcode ?? '—'} />
            <ContextMetric label="成本" value={fmtMoney(selectedRow.latestPurchasePrice, 'CNY')} />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="SKU"
              disableHint="停用后不可被订单分配库存，也不再推送渠道库存"
              loading={statusMutation.isPending}
              onChange={(next) =>
                statusMutation.mutate({
                  id: selectedRow.id,
                  action: next ? 'activate' : 'deactivate',
                })
              }
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDrawerId(selectedRow.id)}>
              查看详情
            </Button>
            {/* 编辑 / 新建商品链接并映射 由 SKU 详情抽屉迁入右栏（用户指示
                2026-10-19：详情里的按钮统一收敛到这里；删除已在下方，不重复）。 */}
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                setEditTargetId(selectedRow.id);
                editForm.resetFields();
                editForm.setFieldsValue(editFormValues(selectedRow, leafCategoryOptions));
                setEditOpen(true);
              }}
            >
              编辑
            </Button>
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                listingForm.resetFields();
                setListingCreateOpen(true);
              }}
            >
              新建商品链接并映射
            </Button>
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                mapPlatformForm.resetFields();
                setListingKeyword('');
                setMapPlatformTarget({ id: selectedRow.id, skuCode: selectedRow.skuCode });
                setMapPlatformOpen(true);
              }}
            >
              映射平台商品
            </Button>
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                setMergeSource({ id: selectedRow.id, skuCode: selectedRow.skuCode });
                setMergeTargetId(null);
                setMergeKeyword('');
                setMergeConfirmCode('');
                mergeForm.resetFields();
              }}
            >
              合并到其他 SKU…
            </Button>
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                setPrintBarcode(selectedRow.primaryBarcode ?? '');
                setPrintCopies(1);
                setPrintFor(selectedRow);
              }}
            >
              打印条码标签
            </Button>
            {/* 添加条码（用户指示 2026-10-21）：右栏可直接给当前 SKU 录入条码，
                不必先打开详情抽屉；抽屉里的原按钮保留。 */}
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                barcodeForm.resetFields();
                setBarcodeTargetSkuId(selectedRow.id);
                setBarcodeModalOpen(true);
              }}
            >
              添加条码
            </Button>
            <Button
              block
              danger
              style={{ marginTop: 8 }}
              onClick={() =>
                confirmDeleteSku(selectedRow.id, selectedRow.skuCode, selectedRow.listingCount)
              }
            >
              删除
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    selectedInventory.data,
    selectedInventory.isLoading,
    list.data,
    rows.length,
    statusMutation.isPending,
    statusMutation.mutate,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="SKU管理"
        description="管理内部 SKU、条码、成本、库存及平台映射；分类与品牌现为 SKU 自身字段"
        primary={
          <Space>
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新建SKU
            </Button>
            {/* V1（D4）：分类/品牌管理入口（原商品页能力迁入 + 品牌管理补齐）。 */}
            <Button onClick={() => setCategoryManageOpen(true)}>分类管理</Button>
            <Button onClick={() => setBrandManageOpen(true)}>品牌管理</Button>
          </Space>
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
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
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
          style={{ width: 160 }}
          showSearch
          optionFilterProp="searchText"
          value={brandId}
          onChange={(value) => {
            setPage(1);
            setBrandId(value);
          }}
          options={brandOptions}
        />
        <Cascader
          allowClear
          placeholder="分类（含子类）"
          style={{ width: 200 }}
          changeOnSelect
          showSearch
          options={categoryOptions}
          value={categoryId === undefined ? undefined : categoryPathOf(categoryOptions, categoryId)}
          onChange={(path) => {
            setPage(1);
            // 清空（点 X）时 rc-cascader 传的是 undefined（不是 []/null）；
            // 旧写法 path.length 会抛错，导致筛选条件永远清不掉（2026-10-21）。
            const last = Array.isArray(path) && path.length > 0 ? path[path.length - 1] : undefined;
            setCategoryId(last === undefined ? undefined : String(last));
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
            { value: 'DRAFT', label: '草稿' },
            { value: 'ACTIVE', label: '启用' },
            { value: 'INACTIVE', label: '停用' },
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
          error={list.error}
          onRetry={() => void list.refetch()}
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
            onDoubleClick: () => setDrawerId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          scroll={{ x: 1080 }}
          emptyTitle="没有匹配的 SKU"
          emptyDescription="调整筛选条件或新建 SKU。"
          columns={[
            {
              title: '品牌/分类',
              key: 'brandCategory',
              width: 300,
              render: (_: unknown, record: SkuRow) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {record.primaryImageUrl !== null ? (
                    <Image
                      src={record.primaryImageUrl}
                      width={56}
                      height={56}
                      style={{ objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 8,
                        background: colors.neutralBg,
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                      <span
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
                      </span>
                      <CopyTextButton value={record.nameZh} title="SKU 名称" />
                    </div>
                    <div style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>
                      {record.skuCode}
                      {record.brandName !== null && ` · ${record.brandName}`}
                      {record.categoryName !== null && ` · ${record.categoryName}`}
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
              // 货币两位小数（用户规则 2026-10-26）
              render: (value: number | null) => fmtMoney(value, 'CNY'),
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
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Modal
        title={`打印条码标签：${printFor?.skuCode ?? ''}`}
        open={printFor !== null}
        onCancel={() => setPrintFor(null)}
        onOk={() => {
          if (printBarcode === '') {
            message.warning('请选择要打印的条码');
            return;
          }
          printTasksBrowser([
            {
              type: 'SKU_LABEL',
              payload: {
                barcode: printBarcode,
                skuName: printFor?.nameZh,
                copies: printCopies,
              },
            },
          ]);
        }}
        okText="打印"
        cancelText="取消"
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Select
            placeholder="选择要打印的条码"
            value={printBarcode === '' ? undefined : printBarcode}
            onChange={setPrintBarcode}
            options={(printBarcodes.data?.data ?? []).map((b) => ({
              value: b.barcode,
              label: `${b.barcode}（${b.isPrimary ? '主条码 · ' : ''}${b.barcodeType}）`,
            }))}
            loading={printBarcodes.isLoading}
          />
          <InputNumber
            min={1}
            max={200}
            value={printCopies}
            onChange={(value) => setPrintCopies(value ?? 1)}
            suffix="份"
            style={{ width: 140 }}
          />
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            Code128 条码，新窗口打印；无条码可先在下方条码区生成内部条码 W…。
          </span>
        </div>
      </Modal>

      <SkuCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* V1（D4）：分类/品牌管理（弹窗能力自商品页迁入 + 新建）。 */}
      <CategoryManageModal open={categoryManageOpen} onClose={() => setCategoryManageOpen(false)} />
      <BrandManageModal open={brandManageOpen} onClose={() => setBrandManageOpen(false)} />

      {/* 编辑表单内的品牌/分类现场快建（G9）。 */}
      <BrandQuickCreateModal
        open={brandQuickOpen}
        zIndex={1200}
        onClose={() => setBrandQuickOpen(false)}
        onCreated={(brandId) => {
          editForm.setFieldValue('brandId', brandId);
        }}
      />
      <CategoryQuickCreateModal
        open={categoryQuickOpen}
        zIndex={1200}
        onClose={() => setCategoryQuickOpen(false)}
        onCreated={(path) => {
          editForm.setFieldValue('categoryPath', path);
        }}
      />

      {/* ---- Delete confirmation (normal vs forced cascade) ---- */}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="确认删除该 SKU？"
        description={
          deleteTarget === null
            ? ''
            : `将删除「${deleteTarget.skuCode}」` +
              (deleteTarget.listingCount > 0
                ? `及其 ${deleteTarget.listingCount} 个平台映射。`
                : '。') +
              '若已有库存流水/订单/拣货记录，删除会被拒绝。'
        }
        forceLabel="强制删除（同时删除关联的条码、图片与平台映射）"
        forceWarning="强制删除仅级联主数据。若已有库存流水、订单行、拣货或发货记录，后端仍会拒绝删除——这些记录是货物实际流转的凭证，无法移除。此时请改用「停用」。"
        confirmLoading={deleteMutation.isPending}
        onConfirm={(force) => {
          if (deleteTarget === null) {
            return;
          }
          deleteMutation.mutate(
            { id: deleteTarget.id, force },
            { onSettled: () => setDeleteTarget(null) },
          );
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <Drawer
        open={drawerId !== null}
        onClose={() => {
          // 抽屉关闭时一并收起条码弹窗，避免弹窗悬空、目标 SKU 丢失。
          setDrawerId(null);
          setBarcodeModalOpen(false);
        }}
        size={760}
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
                    {
                      label: 'SKU 编码',
                      children: (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          {sku.skuCode}
                          <CopyTextButton value={sku.skuCode} title="SKU 编码" />
                        </span>
                      ),
                    },
                    {
                      label: '中文名称',
                      children: (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          {sku.nameZh}
                          <CopyTextButton value={sku.nameZh} title="SKU 名称" />
                        </span>
                      ),
                    },
                    { label: '品牌', children: sku.brandName ?? '—' },
                    { label: '分类', children: sku.categoryName ?? '—' },
                    { label: '型号', children: sku.model ?? '—' },
                    {
                      label: '颜色 / 尺寸',
                      children: [sku.color, sku.size].filter((v) => v !== null).join(' / ') || '—',
                    },
                    { label: '重量(g)', children: sku.weightG ?? '—' },
                    {
                      label: '最新采购价(CNY)',
                      children: fmtMoney(sku.latestPurchasePrice, 'CNY'),
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
                      children: `${mappings.data?.data.length ?? 0} 个商品链接`,
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
                      onClick={() => {
                        setBarcodeTargetSkuId(drawerId);
                        setBarcodeModalOpen(true);
                      }}
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
                    error={barcodes.error}
                    onRetry={() => void barcodes.refetch()}
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
                            <Button size="small" danger>
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
                  {/* 操作入口已上移至抽屉操作区（新建商品链接并映射）与右栏（映射平台商品）。 */}
                  <DataTable<MappingRow>
                    rowKey="id"
                    size="small"
                    dataSource={mappings.data?.data ?? []}
                    pagination={false}
                    loading={mappings.isLoading}
                    error={mappings.error}
                    onRetry={() => void mappings.refetch()}
                    emptyTitle="暂无平台映射"
                    emptyDescription="该 SKU 尚未映射到任何平台商品链接。"
                    columns={[
                      {
                        title: '平台',
                        dataIndex: 'platformCode',
                        width: 110,
                        render: (value: string) => <PlatformTag code={value} />,
                      },
                      { title: '店铺', dataIndex: 'storeCode', width: 110 },
                      { title: '平台商品 ID', dataIndex: 'platformProductId' },
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

      {/* ---- 合并到其他 SKU（2026-10-24）：预览影响面 + 输入目标编码确认 ---- */}
      <Modal
        title={`合并到其他 SKU：${mergeSource?.skuCode ?? ''}`}
        open={mergeSource !== null}
        onCancel={() => setMergeSource(null)}
        width={680}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setMergeSource(null)}>
            取消
          </Button>,
          <Button
            key="ok"
            danger
            disabled={mergeTargetId === null || mergePreview.data === undefined}
            loading={mergeMutation.isPending}
            onClick={() => {
              if (mergeSource === null || mergeTargetId === null) {
                return;
              }
              mergeMutation.mutate({
                sourceId: mergeSource.id,
                targetSkuId: mergeTargetId,
                confirmSkuCode: mergeConfirmCode,
              });
            }}
          >
            确认合并
          </Button>,
        ]}
      >
        {(() => {
          const preview = mergePreview.data?.data ?? null;
          const blocked = mergePreview.error !== null && mergePreview.error !== undefined;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                把源 SKU 的全部平台映射、条码、图片、业务引用与库存账面并入目标 SKU， 源 SKU
                将被删除；**目标 SKU 的基础信息（名称/品牌/分类/型号/规格）保持不变**。
                合并不可撤销。
              </span>
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <span style={{ fontSize: 12.5, color: colors.textTertiary }}>目标 SKU</span>
                <Select
                  showSearch
                  filterOption={false}
                  value={mergeTargetId ?? undefined}
                  placeholder="搜索 SKU 编码 / 名称"
                  style={{ width: '100%' }}
                  onSearch={setMergeKeyword}
                  loading={mergeTargets.isLoading}
                  options={(mergeTargets.data?.data ?? [])
                    .filter((sku) => sku.id !== mergeSource?.id)
                    .map((sku) => ({
                      value: sku.id,
                      label: `${sku.skuCode} · ${sku.nameZh}`,
                    }))}
                  onChange={(value: string) => setMergeTargetId(value)}
                />
              </Space>
              {mergeTargetId !== null && mergePreview.isLoading && (
                <span style={{ fontSize: 12.5, color: colors.textTertiary }}>预览加载中…</span>
              )}
              {preview !== null && (
                <div style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                  <div>
                    平台映射 {preview.product.platformMappings} 条 · 条码 {preview.product.barcodes}{' '}
                    个（其中与目标重复 {preview.product.duplicateBarcodes} 个会被丢弃） · 图片{' '}
                    {preview.product.images} 张
                  </div>
                  <div>
                    库存余额 {preview.inventory.balances} 行（实物 {preview.inventory.onHandQty}
                    、占用 {preview.inventory.reservedQty}、已拣 {preview.inventory.pickedQty}） ·
                    预留 {preview.inventory.reservations} · 流水 {preview.inventory.transactions}{' '}
                    条将重算
                  </div>
                  <div>
                    业务引用：
                    {Object.entries(preview.references)
                      .filter(([, count]) => count > 0)
                      .map(([name, count]) => `${name} ${count}`)
                      .join(' · ') || '无'}
                  </div>
                  <div style={{ color: colors.danger, marginTop: 4 }}>
                    确认请输入目标编码：{preview.target.skuCode}
                  </div>
                </div>
              )}
              {blocked && (
                <div style={{ fontSize: 12.5, color: colors.danger }}>
                  无法合并：{String(mergePreview.error?.message ?? '')}
                </div>
              )}
              <Input
                placeholder="输入目标 SKU 编码以确认"
                value={mergeConfirmCode}
                onChange={(event) => setMergeConfirmCode(event.target.value)}
                disabled={mergeTargetId === null}
              />
            </div>
          );
        })()}
      </Modal>

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
            extra="69 码按 EAN-13 校验位校验；末位不符会拒绝录入。"
            rules={[
              { required: true, message: '请输入条码' },
              {
                validator: async (_rule, value: string | undefined) => {
                  if (value === undefined || value === '') {
                    return;
                  }
                  const result = validate69Barcode(value);
                  if (!result.ok) {
                    throw new Error(result.message ?? '条码校验失败');
                  }
                },
              },
            ]}
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
            // 关闭即释放目标：下一次打开（可能来自另一行）重新锁定。
            setEditTargetId(null);
          }
        }}
        onCancel={() => setEditOpen(false)}
        onOk={() => void editForm.validateFields().then((values) => updateMutation.mutate(values))}
        confirmLoading={updateMutation.isPending}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="SKU 编码（生成后冻结）">
            <Input value={editSku?.skuCode ?? ''} disabled />
          </Form.Item>
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="nameRu" label="俄文名称">
            <Input />
          </Form.Item>
          <Form.Item
            name="brandId"
            label={
              <Space size={4}>
                品牌
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => setBrandQuickOpen(true)}
                >
                  + 新建品牌
                </Button>
              </Space>
            }
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="searchText"
              placeholder="选择品牌（可按一般/中文/英文/俄文名或编码搜索，可清空解除挂载）"
              options={brandOptions}
            />
          </Form.Item>
          <Form.Item
            name="categoryPath"
            label={
              <Space size={4}>
                分类（三级）
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => setCategoryQuickOpen(true)}
                >
                  + 新建分类
                </Button>
              </Space>
            }
            rules={[
              {
                validator: (_rule, value: string[] | undefined) =>
                  value === undefined || value.length === 0
                    ? Promise.resolve()
                    : value.length === 3
                      ? Promise.resolve()
                      : Promise.reject(new Error('必须选择到三级分类')),
              },
            ]}
          >
            <Cascader<CategoryOption>
              allowClear
              showSearch
              placeholder="选择三级分类（可清空解除挂载）"
              options={leafCategoryOptions}
            />
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
          <Space wrap size="middle">
            <Form.Item name="weightG" label="重量(g)" style={{ marginBottom: 0 }}>
              <InputNumber min={0} step={1} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item
              name="lengthMm"
              label="长(mm)"
              dependencies={['widthMm', 'heightMm']}
              rules={[dimensionGroupRule(editForm)]}
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={0} step={1} precision={0} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="widthMm" label="宽(mm)" style={{ marginBottom: 0 }}>
              <InputNumber min={0} step={1} precision={0} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="heightMm" label="高(mm)" style={{ marginBottom: 0 }}>
              <InputNumber min={0} step={1} precision={0} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <span
            style={{
              fontSize: 12.5,
              color: colors.textTertiary,
              display: 'block',
              marginTop: 4,
            }}
          >
            长/宽/高为「全有或全无」；体积由后端按长×宽×高计算，不可直接填写。
          </span>
          <Space wrap size="middle" style={{ marginTop: 16 }}>
            <Form.Item name="purchaseUrl" label="采购链接" style={{ marginBottom: 0 }}>
              <Input maxLength={1000} style={{ width: 320 }} />
            </Form.Item>
            <Form.Item
              name="latestPurchasePrice"
              label="最新采购价（CNY）"
              style={{ marginBottom: 0 }}
            >
              <InputNumber min={0} step={0.01} prefix="¥" style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item
            name="serialTracking"
            label="SN序列号管理"
            valuePropName="checked"
            style={{ marginTop: 16, marginBottom: 0 }}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Create a new listing mapped to this SKU (§11.6) ---- */}
      <Modal
        title="新建商品链接并映射"
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
          <Form.Item
            name="platformId"
            label="平台"
            rules={[{ required: true, message: '请选择平台' }]}
          >
            <Select
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
          >
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
            label="平台商品 ID"
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

      {/* ---- 映射平台商品：搜索任意平台的商品链接，把当前 SKU 绑定到其未映射变体 ---- */}
      <Modal
        title={`映射平台商品：${mapPlatformTarget?.skuCode ?? ''}`}
        open={mapPlatformOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            mapPlatformForm.resetFields();
          }
        }}
        onCancel={() => setMapPlatformOpen(false)}
        onOk={() =>
          void mapPlatformForm.validateFields().then((values) => {
            if (mapPlatformTarget === null) {
              void message.error('SKU 上下文丢失，请重新打开后重试');
              return;
            }
            mapPlatformMutation.mutate({
              listingId: values.listingId,
              mappingId: values.mappingId,
            });
          })
        }
        confirmLoading={mapPlatformMutation.isPending}
      >
        <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
          选择平台商品链接及其未映射变体，绑定到当前 SKU；后续平台同步不会覆盖该映射。
        </p>
        <Form form={mapPlatformForm} layout="vertical">
          <Form.Item
            name="listingId"
            label="平台商品（商品链接）"
            rules={[{ required: true, message: '请选择商品链接' }]}
          >
            <Select
              showSearch
              filterOption={false}
              onSearch={setListingKeyword}
              placeholder="搜索平台商品（ID / 标题 / 平台SKU / 内部SKU）"
              notFoundContent={listingOptions.isLoading ? '搜索中...' : '无匹配商品链接'}
              options={(listingOptions.data?.data ?? []).map((listing) => ({
                value: listing.id,
                label: `${listing.platformCode} / ${listing.storeCode} / ${listing.platformProductId}${
                  listing.title !== null ? ` · ${listing.title}` : ''
                }`,
              }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.listingId !== next.listingId}>
            {() => (
              <>
                {mapPlatformListingId !== undefined &&
                  !mapPlatformDetail.isLoading &&
                  mapPlatformVariants.length === 0 && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="所选商品链接没有未映射变体"
                      description="变体均已映射或不存在变体记录；请选择其他商品。"
                    />
                  )}
                <Form.Item
                  name="mappingId"
                  label="未映射变体"
                  rules={[{ required: true, message: '请选择要映射的变体' }]}
                >
                  <Select
                    loading={mapPlatformDetail.isLoading}
                    placeholder="选择变体"
                    options={mapPlatformVariants.map((variant) => ({
                      value: variant.id,
                      label:
                        variant.platformSkuId ??
                        variant.sellerSku ??
                        variant.offerId ??
                        variant.id.slice(0, 8),
                    }))}
                  />
                </Form.Item>
              </>
            )}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
