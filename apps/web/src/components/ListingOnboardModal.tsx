import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Cascader,
  Checkbox,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { apiPost, useApiQuery } from '../api/hooks';
import { CATEGORY_CASCADER_PROPS } from './CategoryCascader';
import { CategoryPickerOption } from './CategoryCascader';
import { printTasksBrowser } from '../printing/print-browser';
import { colors, InfoGrid, StatusBadge } from '../design-system';
import { BrandQuickCreateModal, CategoryQuickCreateModal } from './QuickCreateModals';
import {
  SkuMatchCandidate,
  SkuMatchCandidatesPanel,
  useSkuMatchCandidates,
} from './SkuMatchCandidates';
import { brandSearchText } from '../utils/brandSearch';

/**
 * 共享的「建档并映射」弹窗（Sprint 8 / 8.5 的快速建档，Phase 3 提取为组件）。
 *
 * 宿主：
 *  - ListingsPage：从商品链接行/右键菜单打开，支持「保存并下一变体」连续建档；
 *  - OrdersPage：映射失败行快速建档（按平台标识反查到商品链接，并预选该变体），
 *    不再需要跳转工作台。
 *
 * 组件自包含：onboard-context 拉取、变体选择、表单预填、类目/品牌/条码/尺寸、
 * 快建入口、提交与结果态、连续建档，全部在内部管理；宿主只传 listingId 与
 * 打开/关闭/完成回调。
 *
 * V1 改造（2026-10-13，决策 D2/D3/D5）：商品层移除——一个事务内直建 ACTIVE
 * SKU（全局编码 SKU%09d）+ 可选内部条码 + 绑定映射；多变体不再挂靠商品
 * （每个变体各建各的 SKU），品牌/分类直接落 SKU。
 */

export interface OnboardResult {
  listingId: string;
  mappingId: string;
  sku: { id: string; skuCode: string; nameZh: string };
  barcode: string | null;
}

interface OnboardContextVariant {
  id: string;
  mappingStatus: string;
  platformSkuId: string | null;
  offerId: string | null;
  sellerSku: string | null;
  skuCode: string | null;
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
  variants: OnboardContextVariant[];
}

interface CategoryNode {
  id: string;
  nameZh: string;
  nameRu: string | null;
  level: number;
  sortOrder: number;
  status: string;
  children: CategoryNode[];
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

/** 订单页带入的平台标识：用于在未映射变体里精确定位订单行对应的变体。 */
export interface OnboardMatchIdentifiers {
  platformSkuId?: string | null;
  offerId?: string | null;
  sellerSku?: string | null;
}

export interface ListingOnboardModalProps {
  open: boolean;
  listingId: string | null;
  /** 直接指定的变体（映射 id，例如从变体行打开）；优先于 matchIdentifiers */
  preferredVariantId?: string | null;
  /** 预选变体（按平台标识精确匹配；null = 第一个未映射变体） */
  matchIdentifiers?: OnboardMatchIdentifiers | null;
  /** 结果态展示「保存并下一变体」（列表页连续建档）；默认关闭 */
  chained?: boolean;
  onClose: () => void;
  /** 建档成功（宿主据此刷新列表/订单） */
  onCompleted?: (result: OnboardResult) => void;
  /**
   * 「已有档案，改用那个」：命中重复时不再新建，转去映射弹窗。
   * 宿主负责关闭本弹窗并打开映射弹窗（带 initialSkuId）。
   */
  onUseExisting?: (input: { skuId: string; mappingId: string }) => void;
  zIndex?: number;
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

export function ListingOnboardModal({
  open,
  listingId,
  preferredVariantId = null,
  matchIdentifiers = null,
  chained = false,
  onClose,
  onCompleted,
  onUseExisting,
  zIndex,
}: ListingOnboardModalProps) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [manualVariantId, setManualVariantId] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardResult | null>(null);
  const [printCopies, setPrintCopies] = useState(1);
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);

  // 每次打开重置（等价于列表页 openOnboard 的重置逻辑）。
  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ generateBarcode: true, rememberCategoryMapping: true });
      setManualVariantId(null);
      setResult(null);
    }
  }, [open, form]);

  const contextQuery = useApiQuery<{ data: OnboardContext }>(
    '/api/v1/listings/{id}/onboard-context',
    {},
    ['listing-onboard-context', listingId],
    { id: listingId ?? '' },
    open && listingId !== null,
  );
  const ctx = contextQuery.data?.data;
  const unmapped = useMemo(
    () => (ctx?.variants ?? []).filter((variant) => variant.mappingStatus === 'UNMAPPED'),
    [ctx],
  );

  /** 按平台标识（platformSkuId / offerId / sellerSku 任一）定位订单行对应的变体。 */
  const matchedVariantId = useMemo(() => {
    if (matchIdentifiers === null) {
      return null;
    }
    const hit = unmapped.find(
      (variant) =>
        (matchIdentifiers.platformSkuId !== null &&
          matchIdentifiers.platformSkuId !== undefined &&
          variant.platformSkuId === matchIdentifiers.platformSkuId) ||
        (matchIdentifiers.offerId !== null &&
          matchIdentifiers.offerId !== undefined &&
          variant.offerId === matchIdentifiers.offerId) ||
        (matchIdentifiers.sellerSku !== null &&
          matchIdentifiers.sellerSku !== undefined &&
          variant.sellerSku === matchIdentifiers.sellerSku),
    );
    return hit?.id ?? null;
  }, [matchIdentifiers, unmapped]);

  const selectedVariantId =
    manualVariantId ??
    preferredVariantId ??
    matchedVariantId ??
    (unmapped.length > 0 ? (unmapped[0]?.id ?? null) : null);
  const selectedVariant = useMemo(
    () => (ctx?.variants ?? []).find((variant) => variant.id === selectedVariantId) ?? null,
    [ctx, selectedVariantId],
  );

  const categories = useApiQuery<{ data: CategoryNode[] }>(
    '/api/v1/categories/tree-lite',
    {},
    ['categories'],
    undefined,
    open,
  );
  const brands = useApiQuery<{ data: BrandItem[] }>(
    '/api/v1/brands',
    { keyword: '' },
    ['brands'],
    undefined,
    open,
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
    // label 只放中文（俄文会撑爆下拉宽度）；俄文由 CategoryCascader 的搜索
    // filter 匹配，仍然搜得到（2026-10-23）。
    const toOptions = (nodes: CategoryNode[]): CategoryPickerOption[] =>
      nodes.map((node) => ({
        value: node.id,
        label: node.nameZh,
        nameZh: node.nameZh,
        nameRu: node.nameRu,
        children: node.children.length > 0 ? toOptions(node.children) : undefined,
      }));
    return toOptions(categories.data?.data ?? []);
  }, [categories.data]);
  // 搜索文本汇总编码 + 四个名称（一般/中文/英文/俄文）：现场建档时运营常只记得
  // 中文名或俄文名，仅按一般名称过滤会"搜不到已有品牌"。
  const brandOptions = (brands.data?.data ?? []).map((brand) => ({
    value: brand.id,
    label: brand.name,
    searchText: brandSearchText(brand),
  }));

  /** T3c hint under the category cascader: exact-match suggestion or miss. */
  const categoryExtraHint = (): string => {
    const variant = selectedVariant;
    if (variant === null || variant.descriptionCategoryId === null) {
      return '该变体无平台类目信息，可人工选择三级分类。';
    }
    if (variant.suggestedCategoryId !== null) {
      return '已按 OZON 类目映射自动选中（可改）：命中 (category, type) 复合键精确匹配。';
    }
    return '该 OZON 类目尚未映射：人工选择后勾选「记住此映射」，同类目后续自动命中（绝不按名称相似度猜）。';
  };

  const mutation = useMutation({
    mutationFn: (input: {
      listingId: string;
      mappingId: string;
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
          skuNameZh: input.skuNameZh,
          generateBarcode: input.generateBarcode,
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
    onSuccess: (onboardResult) => {
      setResult(onboardResult);
      void message.success(
        `建档并映射完成：${onboardResult.sku.skuCode}${onboardResult.barcode !== null ? `（条码 ${onboardResult.barcode}）` : ''}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['listing-onboard-context'] });
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      onCompleted?.(onboardResult);
    },
    onError: (error: Error) => void message.error(`建档失败（已整体回滚）: ${error.message}`),
  });

  const handleClose = () => {
    setManualVariantId(null);
    setResult(null);
    form.resetFields();
    onClose();
  };

  /**
   * Prefills the editable fields for the currently selected variant: names
   * from the variant's Offer ID (listing title as fallback), category from the
   * composite-key suggestion, dims/weight from the v4 enrichment payload.
   */
  useEffect(() => {
    if (!open || result !== null || ctx === undefined) {
      return;
    }
    const suggested = selectedVariant?.suggestedCategoryId ?? null;
    const variantName =
      selectedVariant === null ? (ctx.title ?? '') : buildVariantName(ctx.title, selectedVariant);
    form.setFieldsValue({
      skuNameZh: variantName,
      categoryPath: suggested !== null ? (categoryPathById.get(suggested) ?? undefined) : undefined,
      weightG: selectedVariant?.weightG ?? undefined,
      lengthMm: selectedVariant?.lengthMm ?? undefined,
      widthMm: selectedVariant?.widthMm ?? undefined,
      heightMm: selectedVariant?.heightMm ?? undefined,
    });
  }, [open, result, ctx, selectedVariant, categoryPathById, form]);

  // ---- 重复档案提示（2026-10-24）：名称/品牌填好后实时检查 ----
  const watchedName = Form.useWatch('skuNameZh', form) as string | undefined;
  const watchedBrandId = Form.useWatch('brandId', form) as string | undefined;
  const candidatesQuery = useSkuMatchCandidates({
    listingId,
    mappingId: selectedVariantId,
    name: watchedName ?? '',
    brandId: watchedBrandId ?? null,
    enabled: open && result === null,
  });
  const duplicateCandidate = useMemo(() => {
    const candidates = candidatesQuery.data?.data.candidates ?? [];
    return (
      candidates.find((item) => item.level === 'SAME_VARIANT' || item.level === 'SAME_FACT') ?? null
    );
  }, [candidatesQuery.data]);

  /** 真正提交（确认之后）。 */
  const submitOnboard = (values: Record<string, unknown>): void => {
    if (listingId === null || selectedVariantId === null) {
      return;
    }
    const categoryPath = values.categoryPath as string[] | undefined;
    mutation.mutate({
      listingId,
      mappingId: selectedVariantId,
      skuNameZh: values.skuNameZh as string,
      brandId: values.brandId as string | undefined,
      categoryId:
        categoryPath !== undefined && categoryPath.length === 3 ? categoryPath[2] : undefined,
      rememberCategoryMapping: values.rememberCategoryMapping !== false,
      generateBarcode: values.generateBarcode !== false,
      weightG: values.weightG as number | undefined,
      lengthMm: values.lengthMm as number | undefined,
      widthMm: values.widthMm as number | undefined,
      heightMm: values.heightMm as number | undefined,
      latestPurchasePrice: values.latestPurchasePrice as number | undefined,
    });
  };

  /**
   * 提交前的一次确认（用户指示 2026-10-24：不阻断、但要付一次确认成本）。
   * 命中「该变体已挂到某档案 / 极可能同一实物」时给出两条出路：
   * - 改用那个档案（转去映射弹窗，不新建）；
   * - 仍要新建（运营确认是两件不同的货）。
   */
  const startSubmit = (): void => {
    if (selectedVariantId === null) {
      void message.warning('没有可建档的未映射变体');
      return;
    }
    void form.validateFields().then((values) => {
      if (listingId === null) {
        return;
      }
      const duplicate = duplicateCandidate;
      if (duplicate === null) {
        submitOnboard(values);
        return;
      }
      const instance: { destroy: () => void } = modal.confirm({
        title: '已有档案可能是同一件货',
        width: 520,
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 13 }}>
              {duplicate.skuCode}（{duplicate.nameZh}）—— {duplicate.evidence.join('；')}
            </span>
            <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
              {duplicate.level === 'SAME_VARIANT'
                ? '这个平台变体已经映射到该档案；再新建会让同一变体出现两份库存记录。'
                : '名称/平台标识指向同一件货；新建会产生重复档案，事后只能靠合并修复。'}
            </span>
            {onUseExisting !== undefined && (
              <Button
                onClick={() => {
                  instance?.destroy();
                  onUseExisting({ skuId: duplicate.skuId, mappingId: selectedVariantId });
                }}
              >
                改用 {duplicate.skuCode}
              </Button>
            )}
          </div>
        ),
        okText: '仍要新建',
        cancelText: '取消',
        onOk: () => submitOnboard(values),
      });
    });
  };

  /**
   * Sprint 8.5 T7 保存并下一变体: after a successful submit, jump straight to
   * the next UNMAPPED variant with the just-created product pinned, keeping
   * the category/brand/barcode choices from the previous round.
   */
  const startNextVariant = () => {
    if (result === null || ctx === undefined) {
      return;
    }
    const remaining = ctx.variants.filter(
      (variant) => variant.mappingStatus === 'UNMAPPED' && variant.id !== result.mappingId,
    );
    // The context is cached from before this submit; the just-mapped variant
    // is excluded explicitly. If stale data still shows others, refetch wins.
    const next =
      remaining[0] ?? unmapped.find((variant) => variant.id !== result.mappingId) ?? null;
    if (next === null) {
      void message.info('该商品链接的变体已全部建档完成');
      handleClose();
      return;
    }
    const previous = {
      categoryId: form.getFieldValue('categoryPath') as string[] | undefined,
      brandId: form.getFieldValue('brandId') as string | undefined,
      generateBarcode: form.getFieldValue('generateBarcode') !== false,
      rememberCategoryMapping: form.getFieldValue('rememberCategoryMapping') !== false,
    };
    setResult(null);
    setManualVariantId(next.id);
    form.setFieldsValue({
      generateBarcode: previous.generateBarcode,
      rememberCategoryMapping: previous.rememberCategoryMapping,
      brandId: previous.brandId,
      categoryPath: previous.categoryId,
      weightG: next.weightG ?? undefined,
      lengthMm: next.lengthMm ?? undefined,
      widthMm: next.widthMm ?? undefined,
      heightMm: next.heightMm ?? undefined,
      skuNameZh: buildVariantName(ctx.title, next),
      // The price belongs to the SKU being built: never carried over from the
      // previous variant (unlike brand/category, which are product-level).
      latestPurchasePrice: undefined,
    });
    void queryClient.invalidateQueries({ queryKey: ['listing-onboard-context'] });
  };

  /** Whether another UNMAPPED variant remains after the current result (T7). */
  const hasNextVariant =
    chained &&
    result !== null &&
    ctx !== undefined &&
    ctx.variants.some(
      (variant) => variant.mappingStatus === 'UNMAPPED' && variant.id !== result.mappingId,
    );

  return (
    <>
      <Modal
        title="建档并映射（新建 SKU + 映射）"
        open={open}
        zIndex={zIndex ?? 1100}
        width={680}
        onCancel={handleClose}
        footer={
          result === null
            ? [
                <Button key="cancel" onClick={handleClose}>
                  取消
                </Button>,
                <Button
                  key="submit"
                  type="primary"
                  loading={mutation.isPending}
                  onClick={startSubmit}
                >
                  建档并映射
                </Button>,
              ]
            : [
                ...(result.barcode !== null
                  ? [
                      <Button
                        key="print"
                        onClick={() =>
                          printTasksBrowser([
                            {
                              type: 'SKU_LABEL',
                              payload: {
                                barcode: result.barcode ?? '',
                                skuName: result.sku.nameZh,
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
                      <Button key="next" onClick={startNextVariant}>
                        保存并下一变体
                      </Button>,
                    ]
                  : []),
                <Button key="done" type="primary" onClick={handleClose}>
                  完成
                </Button>,
              ]
        }
      >
        {result !== null ? (
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Alert
              type="success"
              showIcon
              title="建档、条码、映射已在一个事务中完成"
              description="失败会整体回滚，不会留下「建了 SKU 但没映射」的半成品。商品图将从平台 CDN 异步转存到自有桶。"
            />
            <InfoGrid
              columns={2}
              items={[
                { label: '内部SKU', children: result.sku.skuCode },
                {
                  label: '内部条码',
                  children:
                    result.barcode === null ? (
                      <StatusBadge tone="neutral" label="未生成" showDot={false} />
                    ) : (
                      <span style={{ fontFamily: 'monospace' }}>{result.barcode}</span>
                    ),
                },
                { label: '映射状态', children: <StatusBadge tone="success" label="已映射" /> },
              ]}
            />
            {result.barcode !== null && (
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
                title="该商品链接还有未建档的变体"
                description="点「保存并下一变体」继续：商品已锁定挂靠，类目/品牌/条码选择沿用，名称按下一变体预填。"
              />
            )}
          </Space>
        ) : (
          <Form form={form} layout="vertical" preserve={false}>
            {unmapped.length > 1 && (
              <Form.Item label="要建档映射的变体（该商品链接有多个未映射变体）" required>
                <Select
                  value={selectedVariantId}
                  onChange={(value) => {
                    setManualVariantId(value);
                    form.setFieldsValue({
                      weightG: undefined,
                      lengthMm: undefined,
                      widthMm: undefined,
                      heightMm: undefined,
                      categoryPath: undefined,
                      // Per-SKU value: never carried across variants.
                      latestPurchasePrice: undefined,
                    });
                  }}
                  options={unmapped.map((variant) => ({
                    value: variant.id,
                    label: `${variant.platformSkuId ?? '—'} / ${variant.offerId ?? variant.sellerSku ?? '—'}`,
                  }))}
                />
              </Form.Item>
            )}
            {unmapped.length === 0 && !contextQuery.isLoading && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 12 }}
                title="该商品链接没有未映射的变体"
                description="可能刚刚已完成映射，请刷新列表后重试。"
              />
            )}
            {selectedVariant?.primaryImage != null && (
              <Space align="start" style={{ marginBottom: 12 }}>
                <Image
                  src={selectedVariant.primaryImage}
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
            <Form.Item
              name="brandId"
              label={
                <Space size={4}>
                  品牌
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={() => setBrandModalOpen(true)}
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
                placeholder="选择品牌（可按一般/中文/英文/俄文名或编码搜索，可现场快建）"
                options={brandOptions}
              />
            </Form.Item>
            <Form.Item
              name="categoryPath"
              label={
                <Space size={4}>
                  SKU 分类（三级）
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={() => setCategoryCreateOpen(true)}
                  >
                    + 新建分类
                  </Button>
                </Space>
              }
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
              <Cascader<CategoryPickerOption>
                {...CATEGORY_CASCADER_PROPS}
                placeholder="选择三级分类（支持中文/俄文搜索）"
                options={categoryOptions}
              />
            </Form.Item>
            {selectedVariant?.descriptionCategoryId != null && (
              <Form.Item name="rememberCategoryMapping" valuePropName="checked" initialValue={true}>
                <Checkbox>
                  记住此映射（OZON 类目 {selectedVariant.descriptionCategoryId}:
                  {selectedVariant.descriptionTypeId} → 所选内部类目；同类目后续自动命中）
                </Checkbox>
              </Form.Item>
            )}
            <Form.Item
              name="skuNameZh"
              label="SKU 名"
              rules={[{ required: true, message: '请填写 SKU 名' }]}
            >
              <Input maxLength={255} placeholder="默认按变体标识预填" />
            </Form.Item>
            <SkuMatchCandidatesPanel
              listingId={listingId}
              mappingId={selectedVariantId}
              name={watchedName ?? ''}
              brandId={watchedBrandId ?? null}
              enabled={open && result === null}
              onPick={
                onUseExisting === undefined
                  ? undefined
                  : (candidate: SkuMatchCandidate) =>
                      onUseExisting({
                        skuId: candidate.skuId,
                        mappingId: selectedVariantId ?? '',
                      })
              }
              title="已有档案（优先复用；点选即改用）"
            />
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

      {/* 共享快建弹窗（G9）：从建档弹窗内打开，永远叠在其上（zIndex 1200）。 */}
      <BrandQuickCreateModal
        open={brandModalOpen}
        zIndex={(zIndex ?? 1100) + 100}
        onClose={() => setBrandModalOpen(false)}
        onCreated={(brandId) => {
          form.setFieldValue('brandId', brandId);
        }}
      />
      <CategoryQuickCreateModal
        open={categoryCreateOpen}
        zIndex={(zIndex ?? 1100) + 100}
        onClose={() => setCategoryCreateOpen(false)}
        onCreated={(path) => {
          form.setFieldValue('categoryPath', path);
        }}
      />
    </>
  );
}
