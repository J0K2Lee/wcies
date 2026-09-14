import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Alert,
  Button,
  Checkbox,
  Cascader,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiDelete, apiPatch, apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';
import { printTasksBrowser } from '../../printing/print-browser';
import {
  ACTIVE_STATUS_LABEL,
  ActionMenu,
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
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
  labelOf,
  useContextRail,
} from '../../design-system';

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

/** Sprint 8 T1 onboarding result - enough to print the label on the spot. */
interface OnboardResult {
  listingId: string;
  mappingId: string;
  product: { id: string; productCode: string; nameZh: string };
  sku: { id: string; skuCode: string; nameZh: string };
  barcode: string | null;
  productCreated: boolean;
}

/** Sprint 8.5: one feed powering the enhanced onboarding dialog. */
interface OnboardContextVariant {
  id: string;
  mappingStatus: string;
  platformSkuId: string | null;
  offerId: string | null;
  sellerSku: string | null;
  skuCode: string | null;
  productId: string | null;
  productCode: string | null;
  primaryImage: string | null;
  colorImage: string | null;
  descriptionCategoryId: string | null;
  descriptionTypeId: string | null;
  suggestedCategoryId: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

interface OnboardContext {
  listingId: string;
  title: string | null;
  defaultAttachProductId: string | null;
  defaultAttachProductCode: string | null;
  defaultAttachProductName: string | null;
  variants: OnboardContextVariant[];
}

interface CategoryNode {
  id: string;
  nameZh: string;
  nameRu: string | null;
  level: number;
  children: CategoryNode[];
}

interface CategoryOption {
  value: string;
  label: string;
  children?: CategoryOption[];
}

interface BrandItem {
  id: string;
  name: string;
  nameZh: string | null;
  status: string;
}

/**
 * Variant-aware name prefill (Sprint 8.5 T7, revised in 8.5R1): the variant's
 * Offer ID LEADS - it is the string operators see on the platform and use to
 * tell variants apart. The listing title (usually Russian) is only the
 * fallback; platform SKU id / seller SKU are the last resort so variants can
 * never collapse into indistinguishable duplicates.
 */
function buildVariantName(title: string | null, variant: OnboardContextVariant): string {
  const offer = variant.offerId?.trim() ?? '';
  if (offer !== '') {
    return offer;
  }
  const base = title?.trim() ?? '';
  const discriminator = variant.sellerSku ?? variant.platformSkuId;
  if (discriminator !== null && discriminator !== '') {
    return base === '' ? discriminator : `${base} / ${discriminator}`;
  }
  return base;
}

const listingStatusBadge = (value: string) => (
  <StatusBadge
    tone={value === 'ACTIVE' ? 'success' : 'neutral'}
    label={labelOf(ACTIVE_STATUS_LABEL, value)}
    hint={value}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Modal-chain fix: snapshot the variant row (incl. listingId) the map modal
  // was opened for; the drawer's onClose may null detailId while the modal is
  // still open.
  const [mapTarget, setMapTarget] = useState<ListingSkuRow | null>(null);
  const [form] = Form.useForm();
  const [mapForm] = Form.useForm();
  // Row actions act on a snapshotted row, so a closing drawer cannot blank the
  // id out from under an open modal (the same modal-chain fix as above).
  const [mappingEditTarget, setMappingEditTarget] = useState<ListingSkuRow | null>(null);
  const [mappingDeleteTarget, setMappingDeleteTarget] = useState<ListingSkuRow | null>(null);
  const [mappingEditForm] = Form.useForm();
  const [skuKeyword, setSkuKeyword] = useState('');
  const debouncedSkuKeyword = useDebouncedValue(skuKeyword);
  // Sprint 8 T1: quick onboarding (Product + SKU + optional barcode + mapping
  // in one transaction) from an unmapped listing / variant row.
  const [onboardListingId, setOnboardListingId] = useState<string | null>(null);
  const [onboardVariantId, setOnboardVariantId] = useState<string | null>(null);
  const [onboardResult, setOnboardResult] = useState<OnboardResult | null>(null);
  /** Sprint 8.5 T2: 'attach' pins the listing's onboarded product; 'new' forces a fresh one. */
  const [onboardMode, setOnboardMode] = useState<'attach' | 'new'>('new');
  /** After 保存并下一变体: the product just created is pinned for the next variant. */
  const [onboardPinnedProductId, setOnboardPinnedProductId] = useState<string | null>(null);
  const [onboardForm] = Form.useForm();
  const [printCopies, setPrintCopies] = useState(1);
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
  // Brand quick-create (Sprint 8.5 T4, mirrors ProductsPage's pattern).
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandForm] = Form.useForm();

  const list = useApiQuery<{ data: ListingRow[]; meta: { total: number } }>(
    '/api/v1/listings',
    {
      page,
      pageSize: 50,
      platformId,
      storeId,
      mappingState,
      keyword: keyword || undefined,
    },
    ['listings', page, platformId, storeId, mappingState, keyword],
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
  // Context feed for the onboarding dialog (Sprint 8.5): images, platform
  // category keys + suggestions, v4-prefilled dims, attach target.
  const onboardContextQuery = useApiQuery<{ data: OnboardContext }>(
    '/api/v1/listings/{id}/onboard-context',
    {},
    ['listing-onboard-context', onboardListingId],
    { id: onboardListingId ?? '' },
    onboardListingId !== null,
  );
  const onboardCtx = onboardContextQuery.data?.data;
  const onboardUnmapped = useMemo(
    () => (onboardCtx?.variants ?? []).filter((variant) => variant.mappingStatus === 'UNMAPPED'),
    [onboardCtx],
  );
  const onboardSelectedVariantId =
    onboardVariantId ?? (onboardUnmapped.length > 0 ? (onboardUnmapped[0]?.id ?? null) : null);
  const onboardSelectedVariant = useMemo(
    () =>
      (onboardCtx?.variants ?? []).find((variant) => variant.id === onboardSelectedVariantId) ??
      null,
    [onboardCtx, onboardSelectedVariantId],
  );
  // Category tree + brands for the enhanced fields (Sprint 8.5 T3c/T4).
  // Sprint 8.5R1: the lite endpoint (8k nodes) - the picker never reads the
  // pruned columns, and the full tree cost megabytes per page open.
  const categories = useApiQuery<{ data: CategoryNode[] }>(
    '/api/v1/categories/tree-lite',
    {},
    ['categories'],
    undefined,
    onboardListingId !== null,
  );
  const brands = useApiQuery<{ data: BrandItem[] }>(
    '/api/v1/brands',
    { keyword: '' },
    ['brands'],
    undefined,
    onboardListingId !== null,
  );
  const categoryPathById = useMemo(() => {
    const pathById = new Map<string, string[]>();
    const walk = (nodes: CategoryNode[], trail: string[]): void => {
      for (const node of nodes) {
        const path = [...trail, node.id];
        pathById.set(node.id, path);
        walk(node.children, path);
      }
    };
    walk(categories.data?.data ?? [], []);
    return pathById;
  }, [categories.data]);
  const categoryOptions = useMemo(() => {
    const toOptions = (nodes: CategoryNode[]): CategoryOption[] =>
      nodes.map((node) => ({
        value: node.id,
        label: node.nameRu !== null ? `${node.nameZh} (${node.nameRu})` : node.nameZh,
        children: node.children.length > 0 ? toOptions(node.children) : undefined,
      }));
    return toOptions(categories.data?.data ?? []);
  }, [categories.data]);
  const brandOptions = (brands.data?.data ?? []).map((brand) => ({
    value: brand.id,
    label: brand.name,
  }));

  /**
   * T2 attach resolution, mirrored from the backend default: a pinned
   * product (save-and-next-variant) wins, else the attach radio's target
   * when the listing already has an onboarded product. null = create new.
   */
  const onboardAttachTargetId =
    onboardPinnedProductId !== null
      ? onboardPinnedProductId
      : onboardMode === 'attach'
        ? (onboardCtx?.defaultAttachProductId ?? null)
        : null;
  /** T3c hint under the category cascader: exact-match suggestion or miss. */
  const categoryExtraHint = (): string => {
    const variant = onboardSelectedVariant;
    if (variant === null || variant.descriptionCategoryId === null) {
      return '该变体无平台类目信息，可人工选择三级分类。';
    }
    if (variant.suggestedCategoryId !== null) {
      return '已按 OZON 类目映射自动选中（可改）：命中 (category, type) 复合键精确匹配。';
    }
    return '该 OZON 类目尚未映射：人工选择后勾选「记住此映射」，同类目后续自动命中（绝不按名称相似度猜）。';
  };
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

  // Sprint 8 T1 + 8.5: one transaction on the backend - Product (or attach)
  // + SKU + optional internal barcode + mapping (+ remember-category row).
  // Any failure rolls back whole.
  const onboardMutation = useMutation({
    mutationFn: (input: {
      listingId: string;
      mappingId: string;
      createNewProduct: boolean;
      existingProductId?: string;
      productNameZh?: string;
      skuNameZh: string;
      brandId?: string;
      categoryId?: string;
      rememberCategoryMapping: boolean;
      generateBarcode: boolean;
      weightG?: number;
      lengthMm?: number;
      widthMm?: number;
      heightMm?: number;
      latestPurchasePrice?: number;
    }) =>
      apiPost<OnboardResult>(
        '/api/v1/listings/{listingId}/skus/{id}/onboard',
        {
          productNameZh: input.productNameZh,
          skuNameZh: input.skuNameZh,
          generateBarcode: input.generateBarcode,
          createNewProduct: input.createNewProduct,
          existingProductId: input.existingProductId,
          brandId: input.brandId,
          categoryId: input.categoryId,
          rememberCategoryMapping: input.rememberCategoryMapping,
          weightG: input.weightG,
          lengthMm: input.lengthMm,
          widthMm: input.widthMm,
          heightMm: input.heightMm,
          latestPurchasePrice: input.latestPurchasePrice,
        },
        { listingId: input.listingId, id: input.mappingId },
      ),
    onSuccess: (result) => {
      setOnboardResult(result);
      void message.success(
        `建档并映射完成：${result.sku.skuCode}${result.barcode !== null ? `（条码 ${result.barcode}）` : ''}`,
      );
      refreshListings();
      void queryClient.invalidateQueries({ queryKey: ['listing-onboard-context'] });
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: Error) => void message.error(`建档失败（已整体回滚）: ${error.message}`),
  });

  const brandCreateMutation = useMutation({
    mutationFn: (values: { name: string }) => apiPost<BrandItem>('/api/v1/brands', values),
    onSuccess: (brand) => {
      void message.success(`品牌已创建：${brand.name}`);
      setBrandModalOpen(false);
      brandForm.resetFields();
      onboardForm.setFieldValue('brandId', brand.id);
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

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
  const openOnboard = (listingId: string) => {
    setOnboardResult(null);
    setOnboardVariantId(null);
    setOnboardPinnedProductId(null);
    setOnboardMode('new');
    onboardForm.resetFields();
    onboardForm.setFieldsValue({ generateBarcode: true, rememberCategoryMapping: true });
    setOnboardListingId(listingId);
  };

  const closeOnboard = () => {
    setOnboardListingId(null);
    setOnboardVariantId(null);
    setOnboardResult(null);
    setOnboardPinnedProductId(null);
    onboardForm.resetFields();
  };

  /**
   * Prefills the editable fields for the currently selected variant: names
   * from the variant's Offer ID (listing title as fallback), category from the
   * composite-key suggestion, dims/weight from the v4 enrichment payload.
   */
  useEffect(() => {
    if (onboardListingId === null || onboardResult !== null || onboardCtx === undefined) {
      return;
    }
    const suggested = onboardSelectedVariant?.suggestedCategoryId ?? null;
    const variantName =
      onboardSelectedVariant === null
        ? (onboardCtx.title ?? '')
        : buildVariantName(onboardCtx.title, onboardSelectedVariant);
    onboardForm.setFieldsValue({
      productNameZh: onboardForm.getFieldValue('productNameZh') || variantName,
      skuNameZh: variantName,
      categoryPath: suggested !== null ? (categoryPathById.get(suggested) ?? undefined) : undefined,
      weightG: onboardSelectedVariant?.weightG ?? undefined,
      lengthMm: onboardSelectedVariant?.lengthMm ?? undefined,
      widthMm: onboardSelectedVariant?.widthMm ?? undefined,
      heightMm: onboardSelectedVariant?.heightMm ?? undefined,
    });
  }, [
    onboardListingId,
    onboardResult,
    onboardCtx,
    onboardSelectedVariant,
    categoryPathById,
    onboardForm,
  ]);

  /**
   * Sprint 8.5 T7 保存并下一变体: after a successful submit, jump straight to
   * the next UNMAPPED variant with the just-created product pinned, keeping
   * the category/brand/barcode choices from the previous round.
   */
  const startNextVariant = () => {
    if (onboardResult === null || onboardCtx === undefined) {
      return;
    }
    const remaining = onboardCtx.variants.filter(
      (variant) => variant.mappingStatus === 'UNMAPPED' && variant.id !== onboardResult.mappingId,
    );
    // The context is cached from before this submit; the just-mapped variant
    // is excluded explicitly. If stale data still shows others, refetch wins.
    const next =
      remaining[0] ??
      onboardUnmapped.find((variant) => variant.id !== onboardResult.mappingId) ??
      null;
    if (next === null) {
      void message.info('该 Listing 的变体已全部建档完成');
      closeOnboard();
      return;
    }
    const previous = {
      categoryId: onboardForm.getFieldValue('categoryPath') as string[] | undefined,
      brandId: onboardForm.getFieldValue('brandId') as string | undefined,
      generateBarcode: onboardForm.getFieldValue('generateBarcode') !== false,
      rememberCategoryMapping: onboardForm.getFieldValue('rememberCategoryMapping') !== false,
    };
    setOnboardResult(null);
    setOnboardPinnedProductId(onboardResult.product.id);
    setOnboardMode('attach');
    setOnboardVariantId(next.id);
    onboardForm.setFieldsValue({
      productNameZh: onboardResult.product.nameZh,
      generateBarcode: previous.generateBarcode,
      rememberCategoryMapping: previous.rememberCategoryMapping,
      brandId: previous.brandId,
      categoryPath: previous.categoryId,
      weightG: next.weightG ?? undefined,
      lengthMm: next.lengthMm ?? undefined,
      widthMm: next.widthMm ?? undefined,
      heightMm: next.heightMm ?? undefined,
      skuNameZh: buildVariantName(onboardCtx.title, next),
      // The price belongs to the SKU being built: never carried over from the
      // previous variant (unlike brand/category, which are product-level).
      latestPurchasePrice: undefined,
    });
    void queryClient.invalidateQueries({ queryKey: ['listing-onboard-context'] });
  };
  /** Whether another UNMAPPED variant remains after the current result (T7). */
  const hasNextVariant =
    onboardResult !== null &&
    onboardCtx !== undefined &&
    onboardCtx.variants.some(
      (variant) => variant.mappingStatus === 'UNMAPPED' && variant.id !== onboardResult.mappingId,
    );

  const mapMutation = useMutation({
    mutationFn: (input: { listingId: string; mappingId: string; skuId: string }) =>
      apiPost(
        '/api/v1/listings/{listingId}/skus/{id}/map',
        { skuId: input.skuId },
        {
          listingId: input.listingId,
          id: input.mappingId,
        },
      ),
    onSuccess: () => {
      void message.success('映射完成（后续同步不会覆盖）');
      setMapTarget(null);
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

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
      void message.success('Listing已创建');
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
      void message.success('Listing状态已更新');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const listingDeleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/listings/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('Listing已删除');
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
                  : `${mappingStats.data.data.unmapped} 个 Listing`
              }
            />
            <ContextMetric
              label="已映射"
              value={mappingStats.data === undefined ? '…' : `${mappingStats.data.data.mapped} 个`}
            />
            <ContextMetric
              label="当前筛选结果"
              value={`${list.data?.meta.total ?? 0} 个 Listing`}
            />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              未映射行可用「建档并映射」一步完成建档；被订单撞上的未映射会排在最前。
            </span>
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
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, mappingStats.data]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="SKU映射"
        description="管理平台商品（Listing）与内部SKU的变体映射；人工确认的映射不会被后续同步覆盖"
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

      <FilterBar>
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 120 }}
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
          onChange={(value) => {
            setPage(1);
            setMappingState(value);
          }}
          options={[
            { value: 'MAPPED', label: '已映射' },
            { value: 'UNMAPPED', label: '待映射' },
          ]}
        />
        <Input.Search
          placeholder="product_id / offer_id / 平台SKU / 内部SKU / 标题"
          allowClear
          defaultValue={keyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
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
            dataSource={rows}
            emptyTitle="暂无Listing"
            emptyDescription="调整筛选条件，或点击右上角新建映射"
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
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
                title: 'Platform Product ID',
                dataIndex: 'platformProductId',
                width: 160,
                render: (value: string) => (
                  <span style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{value}</span>
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
                    (value ?? '-')
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
                    <StatusBadge tone="success" label="已映射" />
                  ) : (
                    <Space size={4}>
                      <StatusBadge tone="warning" label="未映射" />
                      {record.hasOrderException && (
                        <StatusBadge tone="danger" label="订单异常" showDot />
                      )}
                    </Space>
                  ),
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (value: string) => listingStatusBadge(value),
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 110,
                render: (value: string) => <RelativeTime value={value} />,
              },
              {
                title: '操作',
                key: 'actions',
                width: 150,
                render: (_: unknown, record: ListingRow) => (
                  <Space size={0}>
                    {record.mappingStatus === 'UNMAPPED' && (
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingInline: 4 }}
                        onClick={() => openOnboard(record.id)}
                      >
                        建档并映射
                      </Button>
                    )}
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0 }}
                      onClick={() => setDetailId(record.id)}
                    >
                      详情
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      <Modal
        title="新建Listing映射（支持多SKU变体）"
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
            description="若平台商品已同步到系统，本表单会因「该店铺+Platform Product ID 已存在」而失败。请先搜索该商品，在其详情里把已同步的未映射变体「人工映射」到内部 SKU——这样映射会带上平台标识，订单才匹配得到。"
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
            <Form.Item
              name="platformProductId"
              label="Platform Product ID"
              rules={[{ required: true }]}
            >
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
                  每个变体至少要填 Platform SKU ID 或 Seller SKU： 订单只按这两个标识反查内部
                  SKU（Offer ID 可被运营在平台侧修改，不作为解析依据； 仍会作为平台事实记录）。OZON
                  的 Platform SKU ID 填平台返回的 sku。
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
                            const hasAny = text(value) !== '' || text(row?.sellerSku) !== '';
                            return hasAny
                              ? Promise.resolve()
                              : Promise.reject(
                                  new Error(
                                    '至少填 Platform SKU ID 或 Seller SKU（Offer ID 不作为解析依据）',
                                  ),
                                );
                          },
                        }),
                      ]}
                    >
                      <Input placeholder="Platform SKU ID" style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'sellerSku']}>
                      <Input placeholder="Seller SKU" style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'offerId']}>
                      <Input placeholder="Offer ID（仅记录）" style={{ width: 140 }} />
                    </Form.Item>
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
          listingDetail
            ? `${listingDetail.storeCode} / ${listingDetail.platformProductId}`
            : 'Listing详情'
        }
        size={720}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        extra={
          listingDetail !== undefined ? (
            <Space>
              {listingDetail.status === 'ACTIVE' ? (
                <Popconfirm
                  title="确认停用该Listing？"
                  description="停用后可随时重新启用。"
                  onConfirm={() =>
                    listingStatusMutation.mutate({
                      id: listingDetail.id,
                      action: 'deactivate',
                    })
                  }
                >
                  <Button size="small" danger loading={listingStatusMutation.isPending}>
                    停用
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  loading={listingStatusMutation.isPending}
                  onClick={() =>
                    listingStatusMutation.mutate({ id: listingDetail.id, action: 'activate' })
                  }
                >
                  启用
                </Button>
              )}
              <Popconfirm
                title="确认删除该Listing？"
                description="存在变体映射的Listing无法删除；被拒时会返回具体原因。"
                onConfirm={() => listingDeleteMutation.mutate(listingDetail.id)}
              >
                <Button size="small" danger loading={listingDeleteMutation.isPending}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
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
                    label: 'Platform Product ID',
                    children: (
                      <span style={{ fontFamily: 'monospace', fontSize: 12.5 }}>
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
                dataSource={listingDetail.skus}
                pagination={false}
                emptyTitle="暂无变体"
                emptyDescription="该Listing尚无变体映射记录"
                columns={[
                  {
                    title: '映射状态',
                    dataIndex: 'mappingStatus',
                    width: 90,
                    render: (value: string) =>
                      value === 'MAPPED' ? (
                        <StatusBadge tone="success" label="已映射" />
                      ) : (
                        <StatusBadge tone="warning" label="未映射" />
                      ),
                  },
                  {
                    title: '内部SKU',
                    dataIndex: 'skuCode',
                    render: (value: string | null) =>
                      value ?? <StatusBadge tone="warning" label="未映射" showDot={false} />,
                  },
                  {
                    title: '名称',
                    dataIndex: 'skuName',
                    render: (value: string | null) => value ?? '-',
                  },
                  {
                    title: 'Platform SKU',
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
                    render: (_: unknown, row: ListingSkuRow) =>
                      row.mappingStatus === 'UNMAPPED' ? (
                        <Space size={0}>
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            onClick={() => {
                              setMapTarget(row);
                              mapForm.resetFields();
                            }}
                          >
                            人工映射
                          </Button>
                          <Button
                            type="link"
                            size="small"
                            style={{ paddingInline: 4 }}
                            onClick={() => {
                              setOnboardResult(null);
                              setOnboardVariantId(row.id);
                              setOnboardPinnedProductId(null);
                              setOnboardMode('new');
                              onboardForm.resetFields();
                              onboardForm.setFieldsValue({
                                generateBarcode: true,
                                rememberCategoryMapping: true,
                              });
                              setOnboardListingId(listingDetail.id);
                            }}
                          >
                            建档并映射
                          </Button>
                        </Space>
                      ) : (
                        <ActionMenu
                          primary={
                            <Button
                              type="link"
                              size="small"
                              style={{ paddingInline: 4 }}
                              onClick={() => {
                                setMapTarget(row);
                                mapForm.resetFields();
                              }}
                            >
                              人工映射
                            </Button>
                          }
                          items={[
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

        <Modal
          title={`人工映射：${mapTarget?.offerId ?? mapTarget?.platformSkuId ?? ''} → Internal SKU`}
          open={mapTarget !== null}
          zIndex={1100}
          onCancel={() => setMapTarget(null)}
          onOk={() =>
            void mapForm.validateFields().then((values) => {
              if (mapTarget === null || mapTarget.listingId === '' || mapTarget.id === '') {
                void message.error('映射上下文丢失，请重新打开后重试');
                return;
              }
              mapMutation.mutate({
                listingId: mapTarget.listingId,
                mappingId: mapTarget.id,
                skuId: values.skuId,
              });
            })
          }
          confirmLoading={mapMutation.isPending}
        >
          <p style={{ color: '#888' }}>
            同步而来的平台SKU事实，人工确认后绑定内部SKU；后续平台同步不会覆盖该映射。
          </p>
          <Form form={mapForm} layout="vertical">
            <Form.Item
              name="skuId"
              label="内部SKU"
              rules={[{ required: true, message: '请选择内部SKU' }]}
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
          </Form>
        </Modal>

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
            <Form.Item name="platformSkuId" label="Platform SKU ID">
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
          }」的映射关系。Listing 本身保留。`}
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

      {/* ---- Sprint 8 / 8.5: quick onboarding (one dialog, one transaction) ---- */}
      <Modal
        title={
          onboardAttachTargetId !== null
            ? '建档并映射（挂靠已有商品 + 新建SKU + 映射）'
            : '建档并映射（新建商品 + SKU + 映射）'
        }
        open={onboardListingId !== null}
        zIndex={1100}
        width={680}
        onCancel={closeOnboard}
        footer={
          onboardResult === null
            ? [
                <Button key="cancel" onClick={closeOnboard}>
                  取消
                </Button>,
                <Button
                  key="submit"
                  type="primary"
                  loading={onboardMutation.isPending}
                  onClick={() => {
                    if (onboardSelectedVariantId === null) {
                      void message.warning('没有可建档的未映射变体');
                      return;
                    }
                    void onboardForm.validateFields().then((values) => {
                      if (onboardListingId === null) {
                        return;
                      }
                      const categoryPath = values.categoryPath as string[] | undefined;
                      onboardMutation.mutate({
                        listingId: onboardListingId,
                        mappingId: onboardSelectedVariantId,
                        createNewProduct: onboardAttachTargetId === null,
                        existingProductId:
                          onboardAttachTargetId === null ? undefined : onboardAttachTargetId,
                        productNameZh:
                          onboardAttachTargetId === null
                            ? (values.productNameZh as string)
                            : undefined,
                        skuNameZh: values.skuNameZh as string,
                        brandId:
                          onboardAttachTargetId === null
                            ? (values.brandId as string | undefined)
                            : undefined,
                        categoryId:
                          onboardAttachTargetId === null &&
                          categoryPath !== undefined &&
                          categoryPath.length === 3
                            ? categoryPath[2]
                            : undefined,
                        rememberCategoryMapping: values.rememberCategoryMapping !== false,
                        generateBarcode: values.generateBarcode !== false,
                        weightG: values.weightG as number | undefined,
                        lengthMm: values.lengthMm as number | undefined,
                        widthMm: values.widthMm as number | undefined,
                        heightMm: values.heightMm as number | undefined,
                        latestPurchasePrice: values.latestPurchasePrice as number | undefined,
                      });
                    });
                  }}
                >
                  建档并映射
                </Button>,
              ]
            : [
                ...(onboardResult?.barcode !== null && onboardResult !== null
                  ? [
                      <Button
                        key="print"
                        onClick={() =>
                          printTasksBrowser([
                            {
                              type: 'SKU_LABEL',
                              payload: {
                                barcode: onboardResult.barcode ?? '',
                                skuCode: onboardResult.sku.skuCode,
                                skuName: onboardResult.sku.nameZh,
                                copies: printCopies,
                              },
                            },
                          ])
                        }
                      >
                        打印标签
                      </Button>,
                    ]
                  : []),
                ...(hasNextVariant
                  ? [
                      <Button key="next" type="primary" ghost onClick={startNextVariant}>
                        保存并下一变体
                      </Button>,
                    ]
                  : []),
                <Button key="done" type="primary" onClick={closeOnboard}>
                  完成
                </Button>,
              ]
        }
      >
        {onboardResult !== null ? (
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="success"
              showIcon
              title="建档、条码、映射已在一个事务中完成"
              description={
                onboardResult.productCreated
                  ? '失败会整体回滚，不会留下「建了 SKU 但没映射」的半成品。商品图将从平台 CDN 异步转存到自有桶。'
                  : '本次 SKU 挂靠到已有商品（同 Listing 变体不裂变）。商品图将从平台 CDN 异步转存到自有桶。'
              }
            />
            <InfoGrid
              columns={2}
              items={[
                {
                  label: '商品',
                  children: `${onboardResult.product.productCode} ${onboardResult.product.nameZh}`,
                },
                { label: '内部SKU', children: onboardResult.sku.skuCode },
                {
                  label: '内部条码',
                  children:
                    onboardResult.barcode === null ? (
                      <StatusBadge tone="neutral" label="未生成" showDot={false} />
                    ) : (
                      <span style={{ fontFamily: 'monospace' }}>{onboardResult.barcode}</span>
                    ),
                },
                { label: '映射状态', children: <StatusBadge tone="success" label="已映射" /> },
              ]}
            />
            {onboardResult.barcode !== null && (
              <Space>
                <span style={{ fontSize: 12.5, color: colors.textTertiary }}>打印份数</span>
                <InputNumber
                  min={1}
                  max={99}
                  value={printCopies}
                  onChange={(value) => setPrintCopies(value ?? 1)}
                  style={{ width: 80 }}
                />
              </Space>
            )}
            {hasNextVariant && (
              <Alert
                type="info"
                showIcon
                title="该 Listing 还有未建档的变体"
                description="点「保存并下一变体」继续：商品已锁定挂靠，类目/品牌/条码选择沿用，名称按下一变体预填。"
              />
            )}
          </Space>
        ) : (
          <Form form={onboardForm} layout="vertical" preserve={false}>
            {onboardUnmapped.length > 1 && (
              <Form.Item label="要建档映射的变体（该 Listing 有多个未映射变体）" required>
                <Select
                  value={onboardSelectedVariantId}
                  onChange={(value) => {
                    setOnboardVariantId(value);
                    onboardForm.setFieldsValue({
                      weightG: undefined,
                      lengthMm: undefined,
                      widthMm: undefined,
                      heightMm: undefined,
                      categoryPath: undefined,
                      // Per-SKU value: never carried across variants.
                      latestPurchasePrice: undefined,
                    });
                  }}
                  options={onboardUnmapped.map((variant) => ({
                    value: variant.id,
                    label: `${variant.platformSkuId ?? '—'} / ${variant.offerId ?? variant.sellerSku ?? '—'}`,
                  }))}
                />
              </Form.Item>
            )}
            {onboardUnmapped.length === 0 && !onboardContextQuery.isLoading && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                title="该 Listing 没有未映射的变体"
                description="可能刚刚已完成映射，请刷新列表后重试。"
              />
            )}
            {onboardSelectedVariant?.primaryImage != null && (
              <Space align="start" style={{ marginBottom: 12 }}>
                <Image
                  src={onboardSelectedVariant.primaryImage}
                  alt="平台商品图"
                  width={120}
                  height={120}
                  style={{
                    objectFit: 'contain',
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                  }}
                />
                <span style={{ fontSize: 12.5, color: colors.textTertiary, maxWidth: 320 }}>
                  平台商品图预览（CDN
                  直链，点击可放大）。建档成功后系统会把颜色图/首图异步转存到自有存储并设为商品主图。
                </span>
              </Space>
            )}
            {(onboardCtx?.defaultAttachProductId !== null &&
              onboardCtx?.defaultAttachProductId !== undefined) ||
            onboardPinnedProductId !== null ? (
              <Form.Item label="多变体挂靠（同 Listing 变体默认共用一个商品）" required>
                <Radio.Group
                  value={onboardMode}
                  onChange={(event) => setOnboardMode(event.target.value as 'attach' | 'new')}
                  disabled={onboardPinnedProductId !== null}
                >
                  <Radio value="attach">
                    挂靠已有商品
                    {onboardCtx?.defaultAttachProductCode != null &&
                      `（${onboardCtx.defaultAttachProductCode} ${onboardCtx.defaultAttachProductName ?? ''}）`}
                  </Radio>
                  <Radio value="new">另建新商品（变体实为不同商品时使用）</Radio>
                </Radio.Group>
                {onboardPinnedProductId !== null && (
                  <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                    连续建档模式：已锁定挂靠本次新建的商品。
                  </span>
                )}
              </Form.Item>
            ) : null}
            {onboardAttachTargetId === null ? (
              <>
                <Form.Item
                  name="productNameZh"
                  label="商品名（Product）"
                  rules={[{ required: true, message: '请填写商品名' }]}
                >
                  <Input maxLength={255} placeholder="默认取 Listing 标题" />
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
                        onClick={() => {
                          brandForm.resetFields();
                          setBrandModalOpen(true);
                        }}
                      >
                        + 新增品牌
                      </Button>
                    </Space>
                  }
                >
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择品牌（可搜可现场快建）"
                    options={brandOptions}
                  />
                </Form.Item>
                <Form.Item
                  name="categoryPath"
                  label="商品分类（三级）"
                  extra={categoryExtraHint()}
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
                    placeholder="选择三级分类（支持搜索中文名）"
                    options={categoryOptions}
                  />
                </Form.Item>
                {onboardSelectedVariant?.descriptionCategoryId != null && (
                  <Form.Item
                    name="rememberCategoryMapping"
                    valuePropName="checked"
                    initialValue={true}
                  >
                    <Checkbox>
                      记住此映射（OZON 类目 {onboardSelectedVariant.descriptionCategoryId}:
                      {onboardSelectedVariant.descriptionTypeId} →
                      所选内部类目；同类目后续自动命中）
                    </Checkbox>
                  </Form.Item>
                )}
              </>
            ) : (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                title={`挂靠已有商品：${onboardCtx?.defaultAttachProductCode ?? ''} ${
                  onboardCtx?.defaultAttachProductName ?? ''
                }`}
                description="品牌/分类沿用该商品已有档案；本次只新建 SKU 并映射变体。"
              />
            )}
            <Form.Item
              name="skuNameZh"
              label="SKU 名"
              rules={[{ required: true, message: '请填写 SKU 名' }]}
            >
              <Input maxLength={255} placeholder="默认按变体标识预填" />
            </Form.Item>
            <Space wrap size="middle">
              <Form.Item name="weightG" label="重量（g）" style={{ marginBottom: 0 }}>
                <InputNumber min={0} placeholder="重量" style={{ width: 120 }} />
              </Form.Item>
              <Form.Item name="lengthMm" label="长（mm）" style={{ marginBottom: 0 }}>
                <InputNumber min={0} placeholder="长" style={{ width: 110 }} />
              </Form.Item>
              <Form.Item name="widthMm" label="宽（mm）" style={{ marginBottom: 0 }}>
                <InputNumber min={0} placeholder="宽" style={{ width: 110 }} />
              </Form.Item>
              <Form.Item name="heightMm" label="高（mm）" style={{ marginBottom: 0 }}>
                <InputNumber min={0} placeholder="高" style={{ width: 110 }} />
              </Form.Item>
              <Form.Item
                name="latestPurchasePrice"
                label="最新采购价（CNY）"
                style={{ marginBottom: 0 }}
              >
                <InputNumber
                  min={0}
                  step={0.01}
                  placeholder="人工录入，可留空"
                  style={{ width: 150 }}
                />
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
              尺寸/重量按平台 v4 属性预填（可改）；体积由后端按长×宽×高计算，不可直接填写。
              采购价为本 SKU 的人工维护值，不影响由收货确认维护的移动加权平均成本。
            </span>
            <Form.Item
              name="generateBarcode"
              valuePropName="checked"
              initialValue={true}
              style={{ marginTop: 12 }}
            >
              <Checkbox>生成内部条码（W…，建档后可直接打印标签贴到实物上）</Checkbox>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* ---- Sprint 8.5 T4: brand quick-create (same pattern as ProductsPage) ---- */}
      <Modal
        title="新增品牌"
        open={brandModalOpen}
        zIndex={1200}
        onCancel={() => setBrandModalOpen(false)}
        confirmLoading={brandCreateMutation.isPending}
        onOk={() =>
          void brandForm.validateFields().then((values) => {
            brandCreateMutation.mutate({ name: values.name as string });
          })
        }
      >
        <Form form={brandForm} layout="vertical">
          <Form.Item
            name="name"
            label="品牌名称"
            rules={[{ required: true, message: '请输入品牌名称' }]}
          >
            <Input maxLength={200} placeholder="如 MOULD KING" />
          </Form.Item>
        </Form>
      </Modal>

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
