import { useEffect, useMemo, useState } from 'react';
import { App as AntdApp, Alert, Form, Image, Modal, Select } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery, useDebouncedValue } from '../api/hooks';
import { colors, SKU_STATUS_META, StatusBadge } from '../design-system';
import { OnboardMatchIdentifiers } from './ListingOnboardModal';

/**
 * Shared「SKU映射」modal (2026-10-14): bind an UNMAPPED platform variant to an
 * existing internal SKU. Used by the SKU映射 page (rail + drawer) and the
 * orders page SKU-row rail — one implementation, one behavior (人工确认后绑定，
 * 后续平台同步不覆盖).
 *
 * Two entry shapes:
 * - rail / orders: no fixedVariant → variant picker listing the listing's
 *   UNMAPPED variants, preselected via matchIdentifiers (order-line strong
 *   match order: platform_sku_id > seller_sku > offer_id) or the first row;
 * - drawer: fixedVariant locks the target, no picker.
 */

interface VariantRow {
  id: string;
  mappingStatus: string;
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
}

interface ListingDetailForMap {
  id: string;
  platformProductId: string;
  storeCode: string;
  storeName: string;
  title: string | null;
  skus: VariantRow[];
}

interface SkuOption {
  id: string;
  skuCode: string;
  nameZh: string;
  status: string;
  primaryImageUrl: string | null;
}

const IMAGE_FALLBACK = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="#f5f6f8"/></svg>',
)}`;

/**
 * 人可读的变体标识 = 货号（用户指示 2026-10-14）：offer_id 是卖家自己维护的
 * 商品编号，优先展示；平台数字 ID（platform_sku_id）只作兜底。
 */
const variantLabel = (variant: VariantRow): string =>
  variant.offerId ?? variant.sellerSku ?? variant.platformSkuId ?? variant.id.slice(0, 8);

/** Order-line strong match order (decision 0016): platform_sku_id first. */
function matchVariant(
  variants: VariantRow[],
  match: OnboardMatchIdentifiers | null | undefined,
): VariantRow | null {
  if (match === null || match === undefined) {
    return null;
  }
  const tries: Array<keyof OnboardMatchIdentifiers> = ['platformSkuId', 'sellerSku', 'offerId'];
  for (const key of tries) {
    const value = match[key];
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const hit = variants.find((variant) => variant[key] === value);
    if (hit !== undefined) {
      return hit;
    }
  }
  return null;
}

/**
 * Internal-SKU picker (2026-10-14 搜索/筛选优化): server-side debounced
 * keyword search (code / names / model / barcode — barcode matters because
 * USB scanners type the barcode) + status & brand filters, thumbnails and a
 * result-cap hint. Server caps at pageSize; the hint nudges narrowing.
 */
function InternalSkuPicker({
  value,
  onChange,
}: {
  value?: string;
  onChange?: (id: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebouncedValue(keyword);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [brandId, setBrandId] = useState<string | undefined>();

  const skus = useApiQuery<{ data: SkuOption[]; meta: { total: number } }>(
    '/api/v1/skus',
    {
      page: 1,
      pageSize: 50,
      ...(debouncedKeyword !== '' ? { keyword: debouncedKeyword } : {}),
      ...(statusFilter !== undefined ? { status: statusFilter } : {}),
      ...(brandId !== undefined ? { brandId } : {}),
    },
    ['skus-for-variant-map', debouncedKeyword, statusFilter ?? 'ALL', brandId ?? 'NONE'],
  );

  const brands = useApiQuery<{ data: Array<{ id: string; code: string; name: string }> }>(
    '/api/v1/brands',
    { page: 1, pageSize: 100 },
    ['brands-for-variant-map'],
  );

  const PAGE_SIZE = 50;
  const total = skus.data?.meta.total ?? 0;
  const rows = skus.data?.data ?? [];
  const capped = total > rows.length;

  return (
    <div>
      <Select
        showSearch
        filterOption={false}
        value={value}
        onChange={onChange}
        onSearch={setKeyword}
        loading={skus.isFetching}
        notFoundContent={skus.isLoading ? '搜索中…' : '无匹配SKU'}
        placeholder="内部SKU：输入编码 / 名称 / 型号 / 条码搜索"
        style={{ width: '100%' }}
        optionLabelProp="label"
        options={rows.map((sku) => ({
          value: sku.id,
          label: `${sku.skuCode} ${sku.nameZh}`,
          // ReactNode option: thumbnail + code + name (+ 停用 badge).
          children: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Image
                src={sku.primaryImageUrl || IMAGE_FALLBACK}
                fallback={IMAGE_FALLBACK}
                width={28}
                height={28}
                preview={false}
                style={{ objectFit: 'contain', borderRadius: 4, background: colors.neutralBg }}
              />
              <span style={{ fontWeight: 550 }}>{sku.skuCode}</span>
              <span style={{ fontSize: 12.5, color: colors.textSecondary }}>{sku.nameZh}</span>
              {sku.status !== 'ACTIVE' && (
                <StatusBadge
                  tone={SKU_STATUS_META[sku.status]?.tone ?? 'neutral'}
                  label={SKU_STATUS_META[sku.status]?.label ?? sku.status}
                  showDot={false}
                />
              )}
            </div>
          ),
        }))}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
          flexWrap: 'wrap',
          fontSize: 12,
          color: colors.textTertiary,
        }}
      >
        <Select
          allowClear
          size="small"
          placeholder="状态"
          style={{ width: 92 }}
          value={statusFilter}
          onChange={(next) => setStatusFilter(next)}
          options={[
            { value: 'ACTIVE', label: '仅启用' },
            { value: 'INACTIVE', label: '仅停用' },
            { value: 'DRAFT', label: '仅草稿' },
          ]}
        />
        <Select
          allowClear
          size="small"
          placeholder="品牌"
          style={{ width: 150 }}
          showSearch
          optionFilterProp="label"
          value={brandId}
          onChange={(next) => setBrandId(next)}
          loading={brands.isLoading}
          options={(brands.data?.data ?? []).map((brand) => ({
            value: brand.id,
            label: `${brand.code} ${brand.name}`,
          }))}
        />
        {capped && (
          <span>
            共 {total} 个结果，仅显示前 {PAGE_SIZE}，输入关键词或筛选缩小范围
          </span>
        )}
      </div>
    </div>
  );
}

export interface ListingVariantMapModalProps {
  open: boolean;
  listingId: string | null;
  /** Drawer entry: lock the variant (no picker). */
  fixedVariant?: { id: string; label: string } | null;
  /** Orders entry: preselect the matching UNMAPPED variant. */
  matchIdentifiers?: OnboardMatchIdentifiers | null;
  onClose: () => void;
  /** Called after a mapping is committed (pages invalidate their own caches). */
  onCompleted?: () => void;
  zIndex?: number;
}

export function ListingVariantMapModal({
  open,
  listingId,
  fixedVariant = null,
  matchIdentifiers = null,
  onClose,
  onCompleted,
  zIndex,
}: ListingVariantMapModalProps) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ mappingId?: string; skuId: string }>();

  const detail = useApiQuery<{ data: ListingDetailForMap }>(
    '/api/v1/listings/{id}',
    {},
    ['listing-detail', listingId],
    { id: listingId ?? '' },
    listingId !== null && open,
  );
  const listing = detail.data?.data;

  const variants = useMemo(
    () => (listing?.skus ?? []).filter((row) => row.mappingStatus === 'UNMAPPED'),
    [listing],
  );

  // Preselect: strong match first, otherwise the first unmapped variant —
  // same default the SKU映射 page rail modal had.
  useEffect(() => {
    if (!open || fixedVariant !== null || listingId === null || variants.length === 0) {
      return;
    }
    const current = form.getFieldValue('mappingId') as string | undefined;
    const matched = matchVariant(variants, matchIdentifiers) ?? variants[0]!;
    if (current !== matched.id && variants.some((variant) => variant.id === current) === false) {
      form.setFieldValue('mappingId', matched.id);
    }
  }, [open, fixedVariant, listingId, variants, matchIdentifiers, form]);

  const mapMutation = useMutation({
    mutationFn: (input: { mappingId: string; skuId: string }) =>
      apiPost(
        '/api/v1/listings/{listingId}/skus/{id}/map',
        { skuId: input.skuId },
        { listingId: listingId as string, id: input.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射完成（后续同步不会覆盖）');
      onClose();
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
      void queryClient.invalidateQueries({ queryKey: ['listing-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['listing-mapping-stats'] });
      onCompleted?.();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // 标题跟随当前映射目标（用户指示 2026-10-14）：货号优先，不显示平台数字 ID。
  const selectedMappingId = Form.useWatch('mappingId', form);
  const titleSubject = useMemo(() => {
    if (fixedVariant !== null) {
      return fixedVariant.label !== '' ? fixedVariant.label : undefined;
    }
    const pool = variants.length > 0 ? variants : (listing?.skus ?? []);
    const selected = pool.find((variant) => variant.id === selectedMappingId) ?? null;
    const target = selected ?? matchVariant(pool, matchIdentifiers) ?? pool[0];
    return target === undefined ? listing?.platformProductId : variantLabel(target);
  }, [fixedVariant, variants, listing, selectedMappingId, matchIdentifiers]);

  return (
    <Modal
      title={`SKU映射${titleSubject === undefined ? '' : `：${titleSubject}`}`}
      open={open && listingId !== null}
      zIndex={zIndex}
      afterOpenChange={(isOpen) => {
        if (!isOpen) {
          form.resetFields();
        }
      }}
      onCancel={onClose}
      onOk={() =>
        void form.validateFields().then((values) => {
          const mappingId = fixedVariant !== null ? fixedVariant.id : values.mappingId;
          if (listingId === null || mappingId === undefined) {
            void message.error('映射上下文丢失，请重新打开后重试');
            return;
          }
          mapMutation.mutate({ mappingId, skuId: values.skuId });
        })
      }
      confirmLoading={mapMutation.isPending}
    >
      <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
        {listing === undefined
          ? ''
          : `${listing.storeCode} ${listing.title ?? ''} — 选择未映射变体与已有内部 SKU，确认后建立映射；后续平台同步不会覆盖。`}
      </p>
      <Form form={form} layout="vertical">
        {fixedVariant === null && (
          <Form.Item
            name="mappingId"
            label="未映射变体"
            rules={[{ required: true, message: '请选择要映射的变体' }]}
          >
            <Select
              loading={detail.isLoading}
              placeholder="选择变体"
              options={variants.map((variant) => ({
                value: variant.id,
                label: variantLabel(variant),
              }))}
            />
          </Form.Item>
        )}
        {fixedVariant === null && !detail.isLoading && variants.length === 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="该商品链接没有未映射变体"
            description="变体均已映射或不存在变体记录；无变体记录的链接请走「新建映射」补充。"
          />
        )}
        <Form.Item
          name="skuId"
          label="内部SKU"
          rules={[{ required: true, message: '请选择内部SKU' }]}
        >
          <InternalSkuPicker />
        </Form.Item>
      </Form>
    </Modal>
  );
}
