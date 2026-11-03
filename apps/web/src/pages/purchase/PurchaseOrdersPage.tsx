import { Key, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  Checkbox,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Switch,
  Tabs,
  Tooltip,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ColumnsType } from 'antd/es/table';
import { apiGet, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtMoney, fmtQty } from '../../utils/format';
import {
  loadPurchaseViewSettings,
  savePurchaseViewSettings,
  PurchaseOrdersViewSettings,
} from './view-settings';
import {
  ActionIsland,
  colors,
  ContextAction,
  CopyTextButton,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  RailHint,
  RelativeTime,
  rowInteractionProps,
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Purchase order registration (Sprint 7 T3). The PO answers "already
 * bought?" - duplicate registration for an order line is refused by the
 * backend, so this page is safe to use as the daily procurement list.
 */

interface PurchaseOrderRow {
  id: string;
  poNo: string;
  supplierId: string | null;
  supplierName: string | null;
  sourceNote: string | null;
  status: string;
  orderedAt: string;
  expectedAt: string | null;
  remark: string | null;
  receivingWarehouseId: string | null;
  itemCount: number;
  totalQuantity: string;
  /** 明细第一行的 SKU 编码 / 名称 / 数量（列表「采购商品」列）。 */
  firstItemSkuCode: string | null;
  firstItemName: string | null;
  firstItemQuantity: string | null;
  /** 短装结案数量合计（2026-11-03）：RECEIVED 且 > 0 时列表显示「短装结案」。 */
  closedQuantity: string;
}

interface PurchaseOrderItem {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  orderItemId: string | null;
  orderNo: string | null;
  quantity: string;
  unitCost: string | null;
  receivedQuantity: string;
  /** 短装结案数量（供应商不再发货、操作员显式关闭；不是收货）。 */
  closedQuantity: string;
  remark: string | null;
  /** SKU 主图签名 URL（详情接口返回；未上传为 null）。 */
  imageUrl?: string | null;
}

interface PurchaseOrderDetail extends PurchaseOrderRow {
  receivingWarehouseName: string | null;
  items: PurchaseOrderItem[];
}

interface ItemFormValues {
  skuId: string;
  quantity: number;
  unitCost?: string | null;
  remark?: string;
}

interface PoFormValues {
  supplierId?: string;
  sourceNote?: string;
  orderedAt?: string;
  remark?: string;
  /** 采购单目标仓（必填，决策 0023）：收货/库位/缺口覆盖都以它为准。 */
  receivingWarehouseId: string;
  /** 登记采购的同时生成收货草稿（可选）。 */
  createReceiptDraft?: boolean;
  items: ItemFormValues[];
}

interface SkuImageEnvelope {
  data: Array<{ id: string; url: string; isPrimary: boolean; sortOrder: number }>;
}

interface SupplierFormValues {
  name: string;
  contactName?: string;
  contactPhone?: string;
}

interface SupplierOption {
  id: string;
  code: string;
  name: string;
}

interface CostLine {
  quantity?: string | number | null;
  unitCost?: string | number | null;
}

function lineSubtotal(item: CostLine): number | null {
  if (item.unitCost === undefined || item.unitCost === null || item.unitCost === '') return null;
  return Number(item.quantity ?? 0) * Number(item.unitCost);
}

function OrderTotal({ items }: { items: CostLine[] }) {
  const missingCount = items.filter((item) => lineSubtotal(item) === null).length;
  const total = items.reduce((sum, item) => sum + (lineSubtotal(item) ?? 0), 0);
  return (
    <div style={{ marginTop: 16, textAlign: 'right' }}>
      <strong>本单合计：{fmtMoney(total.toFixed(2), 'CNY')}</strong>
      {missingCount > 0 && (
        <small style={{ marginLeft: 12, color: colors.textSecondary }}>
          {missingCount} 行未填成本未计入
        </small>
      )}
    </div>
  );
}

function localNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const STATUS_META: Record<
  string,
  { tone: 'info' | 'success' | 'neutral' | 'warning'; label: string }
> = {
  ORDERED: { tone: 'info', label: '已下单' },
  PARTIALLY_RECEIVED: { tone: 'warning', label: '部分到货' },
  RECEIVED: { tone: 'success', label: '已到货' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

type Envelope<T> = { data: T; meta: { total: number } };

/**
 * 状态标签页（用户需求 2026-10-09）：默认聚焦「未到货」（已下单 + 部分
 * 到货），到货/取消收进各自的 tab；全部 = 不筛选。未到货是两状态过滤，
 * 走后端 statuses 数组参数（repeated query key）。
 */
type PoStatusTab = 'pending' | 'received' | 'cancelled' | 'all';

const PO_STATUS_TAB_FILTERS: Record<PoStatusTab, { status?: string; statuses?: string[] }> = {
  pending: { statuses: ['ORDERED', 'PARTIALLY_RECEIVED'] },
  received: { status: 'RECEIVED' },
  cancelled: { status: 'CANCELLED' },
  all: {},
};

export function PurchaseOrdersPage() {
  const { message, modal, notification } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [statusTab, setStatusTab] = useState<PoStatusTab>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // 视图设置（2026-10-24 用户需求）：默认展开明细 / 明细图片列，localStorage 持久化。
  const [viewSettings, setViewSettings] =
    useState<PurchaseOrdersViewSettings>(loadPurchaseViewSettings);
  const [viewOpen, setViewOpen] = useState(false);
  const updateViewSettings = useCallback((patch: Partial<PurchaseOrdersViewSettings>) => {
    setViewSettings((current) => {
      const next = { ...current, ...patch };
      savePurchaseViewSettings(next);
      return next;
    });
  }, []);
  const [form] = Form.useForm<PoFormValues>();
  const [showImages, setShowImages] = useState(false);
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false);
  const [createdSupplier, setCreatedSupplier] = useState<SupplierOption | null>(null);
  const formItems = Form.useWatch('items', form) as ItemFormValues[] | undefined;
  // ---- 多选批量生成收货单（用户指示 2026-10-13）：跨分页保留勾选 ----
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [selectedPosById, setSelectedPosById] = useState<Map<string, PurchaseOrderRow>>(
    () => new Map(),
  );
  const handlePoSelectionChange = useCallback((keys: Key[], rows: PurchaseOrderRow[]) => {
    const ids = keys.map(String);
    setSelectedPoIds(ids);
    setSelectedPosById((current) => {
      const next = new Map<string, PurchaseOrderRow>();
      for (const id of ids) {
        const kept = current.get(id);
        if (kept !== undefined) {
          next.set(id, kept);
        }
      }
      for (const row of rows) {
        next.set(row.id, row);
      }
      return next;
    });
  }, []);
  const clearPoSelection = useCallback(() => {
    setSelectedPoIds([]);
    setSelectedPosById(new Map());
  }, []);
  const selectedPoRows = useMemo(
    () =>
      selectedPoIds
        .map((id) => selectedPosById.get(id))
        .filter((row): row is PurchaseOrderRow => row !== undefined),
    [selectedPoIds, selectedPosById],
  );
  // 只有「已下单 / 部分到货」还有未收数量可生成；到货/取消的单自动排除。
  const eligibleBatchPos = useMemo(
    () =>
      selectedPoRows.filter(
        (row) => row.status === 'ORDERED' || row.status === 'PARTIALLY_RECEIVED',
      ),
    [selectedPoRows],
  );

  const tabFilter = PO_STATUS_TAB_FILTERS[statusTab];
  const list = useApiQuery<Envelope<PurchaseOrderRow[]>>(
    '/api/v1/purchase-orders',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(tabFilter.status !== undefined ? { status: tabFilter.status } : {}),
      ...(tabFilter.statuses !== undefined ? { statuses: tabFilter.statuses } : {}),
    },
    ['purchase-orders', page, keyword, statusTab],
  );

  const suppliers = useApiQuery<Envelope<SupplierOption[]>>(
    '/api/v1/suppliers',
    { page: 1, pageSize: 100, status: 'ACTIVE' },
    ['suppliers-for-po'],
  );

  const warehouses = useApiQuery<
    Envelope<Array<{ id: string; warehouseCode: string; name: string }>>
  >('/api/v1/warehouses', {}, ['warehouses-for-po']);

  const detail = useApiQuery<{ data: PurchaseOrderDetail }>(
    '/api/v1/purchase-orders/{id}',
    {},
    ['purchase-order-detail', detailId],
    { id: detailId ?? '' },
    detailId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = detail.data?.data ?? null;
  const supplierOptions = [
    ...(createdSupplier !== null &&
    !(suppliers.data?.data ?? []).some((supplier) => supplier.id === createdSupplier.id)
      ? [createdSupplier]
      : []),
    ...(suppliers.data?.data ?? []),
  ];

  const createMutation = useMutation({
    mutationFn: async (values: PoFormValues) => {
      const po = await apiPost<{ id: string; poNo: string }>('/api/v1/purchase-orders', {
        supplierId: values.supplierId,
        sourceNote: values.sourceNote,
        // datetime-local has no zone: interpret in the operator's local zone.
        orderedAt:
          values.orderedAt !== undefined && values.orderedAt !== ''
            ? new Date(values.orderedAt).toISOString()
            : undefined,
        remark: values.remark,
        receivingWarehouseId: values.receivingWarehouseId,
        purpose: 'STOCK',
        ...(values.createReceiptDraft === true ? { receipt: {} } : {}),
        items: values.items.map((item) => ({
          skuId: item.skuId,
          quantity: String(item.quantity),
          ...(item.unitCost !== undefined && item.unitCost !== null
            ? { unitCost: String(item.unitCost) }
            : {}),
          ...(item.remark !== undefined && item.remark !== '' ? { remark: item.remark } : {}),
        })),
      });
      if (values.createReceiptDraft !== true) {
        return { po, draftReceiptNo: null, receiptLookupFailed: false };
      }
      // §10: the draft receipt is generated in the same transaction as the
      // PO, so if the lookup here fails do NOT tell the operator to register
      // the order again — surface the uncertainty instead.
      try {
        const found = await apiGet<Array<{ id: string; receiptNo: string }>>(
          '/api/v1/purchase-receipts',
          { purchaseOrderId: po.id, page: 1, pageSize: 1 },
        );
        return {
          po,
          draftReceiptNo: found.data[0]?.receiptNo ?? null,
          receiptLookupFailed: found.data[0] === undefined,
        };
      } catch {
        return { po, draftReceiptNo: null, receiptLookupFailed: true };
      }
    },
    onSuccess: ({ po, draftReceiptNo, receiptLookupFailed }) => {
      if (draftReceiptNo !== null) {
        void message.success(
          `采购单 ${po.poNo} 已创建，收货草稿 ${draftReceiptNo} 已同步生成（确认收货后才入库）`,
        );
      } else if (receiptLookupFailed) {
        void message.warning(
          `采购单 ${po.poNo} 已创建；收货草稿应已同步生成，但查询草稿号失败，请到收货单页确认`,
        );
      } else {
        void message.success(`采购单 ${po.poNo} 已登记`);
      }
      setCreateOpen(false);
      form.resetFields();
      setCreatedSupplier(null);
      setShowImages(false);
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost('/api/v1/purchase-orders/{id}/cancel', { reason: '人工取消' }, { id }),
    onSuccess: () => {
      void message.success('采购单已取消（未影响库存）');
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-order-detail'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const createSupplierMutation = useMutation({
    mutationFn: (values: SupplierFormValues) =>
      apiPost<{ id: string; code: string; name: string }>('/api/v1/suppliers', {
        name: values.name.trim(),
        ...(values.contactName !== undefined && values.contactName.trim() !== ''
          ? { contactName: values.contactName.trim() }
          : {}),
        ...(values.contactPhone !== undefined && values.contactPhone.trim() !== ''
          ? { contactPhone: values.contactPhone.trim() }
          : {}),
      }),
    onSuccess: (supplier) => {
      void message.success(`供应商 ${supplier.code} 已创建`);
      void queryClient.invalidateQueries({ queryKey: ['suppliers-for-po'] });
      form.setFieldValue('supplierId', supplier.id);
      setCreatedSupplier({ id: supplier.id, code: supplier.code, name: supplier.name });
      setSupplierCreateOpen(false);
    },
    onError: (error: Error) => void message.error(`创建供应商失败: ${error.message}`),
  });

  // ---- 生成收货单（用户需求 2026-10-09）：从选中的采购单一键生成草稿 ----
  const generateReceiptMutation = useMutation({
    mutationFn: ({ poId }: { poId: string }) =>
      apiPost<{ id: string; receiptNo: string }>(
        '/api/v1/purchase-receipts/from-po/{poId}',
        {},
        { poId },
      ),
    onSuccess: (result) => {
      void message.success(
        `已生成收货单 ${result.receiptNo}（草稿，已预填默认库位）：到收货单页核对后确认入库`,
      );
      void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (error: Error) => void message.error(`生成收货单失败: ${error.message}`),
  });

  /**
   * 生成收货单入口（2026-10-21 决策 0023）：收货仓恒为采购单目标仓，
   * 前端不再询问仓库，只做一次确认。
   */
  const requestGenerateReceipt = useCallback(
    (row: PurchaseOrderRow) => {
      const warehouseLabel =
        warehouses.data?.data.find((w) => w.id === row.receivingWarehouseId)?.name ??
        row.receivingWarehouseId;
      modal.confirm({
        title: `为采购单 ${row.poNo} 生成收货单草稿？`,
        content: `收货仓库：${warehouseLabel}（采购单目标仓）。按采购明细的未收数量预填草稿；生成后到收货单页确认收货才入库。`,
        okText: '生成草稿',
        cancelText: '返回',
        onOk: () => {
          generateReceiptMutation.mutate({ poId: row.id });
        },
      });
    },
    [modal, warehouses.data, generateReceiptMutation],
  );

  // ---- 批量生成收货单（用户指示 2026-10-13）：勾选多个 PO 一次出草稿 ----
  // 后端逐单执行（单笔失败不拖垮整批）；这里只聚合展示每单的草稿号/失败原因。
  const batchGenerateReceiptMutation = useMutation({
    mutationFn: (items: Array<{ poId: string }>) =>
      apiPost<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
          poId: string;
          poNo: string | null;
          ok: boolean;
          receiptNo?: string | null;
          code?: string | null;
          message?: string | null;
        }>;
      }>('/api/v1/purchase-receipts/from-po/batch', { items }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量生成收货单：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description: (
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {result.results.map((item) => (
              <div key={item.poId}>
                {item.poNo ?? selectedPosById.get(item.poId)?.poNo ?? item.poId}：
                {item.ok
                  ? `已生成收货单 ${item.receiptNo}（草稿），到收货单页核对后入库`
                  : `失败（${item.message ?? item.code ?? '未知错误'}）`}
              </div>
            ))}
          </div>
        ),
        duration: result.failed > 0 ? 0 : 8,
      });
      void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (error: Error) => void message.error(`批量生成收货单失败：${error.message}`),
  });

  const runBatchGenerateReceipt = useCallback(() => {
    batchGenerateReceiptMutation.mutate(eligibleBatchPos.map((row) => ({ poId: row.id })));
  }, [batchGenerateReceiptMutation, eligibleBatchPos]);

  /** 批量入口：收货仓恒为各采购单自己的目标仓，前端只做一次确认。 */
  const requestBatchGenerateReceipt = useCallback(() => {
    if (selectedPoRows.length === 0) {
      return;
    }
    if (eligibleBatchPos.length === 0) {
      void message.warning('勾选的采购单都不是「已下单 / 部分到货」，没有可生成收货单的单');
      return;
    }
    modal.confirm({
      title: `为勾选的 ${eligibleBatchPos.length} 个采购单生成收货单草稿？`,
      content:
        '按各采购单的目标仓与未收数量预填草稿；生成后到收货单页选库位、确认收货才入库。单笔失败不影响其余。',
      okText: '批量生成草稿',
      cancelText: '返回',
      onOk: () => {
        runBatchGenerateReceipt();
      },
    });
  }, [modal, message, selectedPoRows.length, eligibleBatchPos, runBatchGenerateReceipt]);

  // ---- 批量删除（用户指示 2026-10-17）：仅删除从未产生库存事实的采购单 ----
  const batchDeleteMutation = useMutation({
    mutationFn: (ids: string[]) =>
      apiPost<{
        total: number;
        succeeded: number;
        failed: number;
        results: Array<{
          id: string;
          code: string | null;
          ok: boolean;
          errorCode: string | null;
          message: string | null;
        }>;
      }>('/api/v1/purchase-orders/batch-delete', { ids }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量删除采购单：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description:
          result.failed === 0 ? undefined : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {result.results
                .filter((item) => !item.ok)
                .map((item) => (
                  <div key={item.id}>
                    {item.code ?? selectedPosById.get(item.id)?.poNo ?? item.id}：
                    {item.message ?? item.errorCode ?? '未知错误'}
                  </div>
                ))}
            </div>
          ),
        duration: result.failed > 0 ? 0 : 6,
      });
      // 删除成功的行从勾选集合移除，避免浮岛仍显示"已选 N 单"。
      const deleted = new Set(result.results.filter((item) => item.ok).map((item) => item.id));
      if (deleted.size > 0) {
        handlePoSelectionChange(
          selectedPoIds.filter((id) => !deleted.has(id)),
          selectedPoRows.filter((row) => !deleted.has(row.id)),
        );
      }
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
    },
    onError: (error: Error) => void message.error(`批量删除失败：${error.message}`),
  });

  const requestBatchDelete = useCallback(() => {
    if (selectedPoIds.length === 0) {
      return;
    }
    modal.confirm({
      title: `删除勾选的 ${selectedPoIds.length} 个采购单？`,
      content:
        '仅「从未发生收货」的采购单会被删除（其未入库的收货草稿一并删除）；' +
        '已确认收货的单会保留并提示失败。删除不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '返回',
      onOk: () => {
        batchDeleteMutation.mutate(selectedPoIds);
      },
    });
  }, [modal, selectedPoIds, batchDeleteMutation]);

  // ---- 短装结案（2026-11-03）---------------------------------------------
  // 供应商少发且不再补时，把「不会再发货」的剩余数量显式关掉：不写收货、
  // 不碰库存/成本，只让采购单能收口、在途回落（否则缺口被虚覆盖，补货被拒）。
  const [closeDetail, setCloseDetail] = useState<PurchaseOrderDetail | null>(null);
  const [closeLines, setCloseLines] = useState<
    Record<string, { checked: boolean; quantity: number | null }>
  >({});
  const [closeReason, setCloseReason] = useState('');

  const closeRemainingMutation = useMutation({
    mutationFn: (input: {
      poId: string;
      reason: string;
      items: Array<{ itemId: string; quantity?: string }>;
    }) =>
      apiPost(
        `/api/v1/purchase-orders/{id}/close-remaining`,
        {
          reason: input.reason,
          items: input.items,
        },
        { id: input.poId },
      ),
    onSuccess: (_result, input) => {
      void message.success('已结案未收数量（不是收货，不产生库存流水）');
      setCloseDetail(null);
      setCloseLines({});
      setCloseReason('');
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-order-detail', input.poId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const openCloseRemaining = useCallback(
    async (po: PurchaseOrderRow) => {
      try {
        const detail = await apiGet<PurchaseOrderDetail>(
          '/api/v1/purchase-orders/{id}',
          {},
          { id: po.id },
        );
        const lines: Record<string, { checked: boolean; quantity: number | null }> = {};
        for (const item of detail.data.items) {
          const outstanding = Math.max(
            Number(item.quantity) -
              Number(item.receivedQuantity) -
              Number(item.closedQuantity ?? 0),
            0,
          );
          if (outstanding > 0) {
            lines[item.id] = { checked: true, quantity: outstanding };
          }
        }
        setCloseDetail(detail.data);
        setCloseLines(lines);
        setCloseReason('');
      } catch (error) {
        void message.error(
          error instanceof Error ? `读取采购单明细失败：${error.message}` : '读取采购单明细失败',
        );
      }
    },
    [message],
  );

  // ---- Context rail ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="采购概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 单`} />
            <RailHint>
              采购单登记「已下单」的意图，不碰库存；到货后在收货单页「从采购单生成」完成入库。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const meta = STATUS_META[selectedRow.status] ?? {
      tone: 'neutral' as const,
      label: selectedRow.status,
    };
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.poNo}
          subtitle={selectedRow.supplierName ?? selectedRow.sourceNote ?? '无货源信息'}
          badge={<StatusBadge tone={meta.tone} label={meta.label} hint={selectedRow.status} />}
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="供应商" value={selectedRow.supplierName ?? '—'} />
            <ContextMetric label="货源说明" value={selectedRow.sourceNote ?? '—'} />
            <ContextMetric
              label="明细"
              value={`${selectedRow.itemCount} 行 / 共 ${Number(selectedRow.totalQuantity)} 件`}
            />
            <ContextMetric label="采购时间" value={fmtDateTime(selectedRow.orderedAt)} />
            <ContextMetric
              label="预计到货"
              value={selectedRow.expectedAt === null ? '—' : fmtDateTime(selectedRow.expectedAt)}
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            {(selectedRow.status === 'ORDERED' || selectedRow.status === 'PARTIALLY_RECEIVED') && (
              <Button
                type="primary"
                block
                style={{ marginTop: 8 }}
                loading={generateReceiptMutation.isPending}
                onClick={() => requestGenerateReceipt(selectedRow)}
              >
                生成收货单
              </Button>
            )}
            {(selectedRow.status === 'ORDERED' || selectedRow.status === 'PARTIALLY_RECEIVED') && (
              <Button
                block
                style={{ marginTop: 8 }}
                onClick={() => void openCloseRemaining(selectedRow)}
              >
                关闭未收数量（短装结案）
              </Button>
            )}
            {selectedRow.status === 'ORDERED' && (
              <Button
                block
                danger
                style={{ marginTop: 8 }}
                onClick={() => {
                  // 取消单据类 = L2（UI 规范 §7）：modal.confirm + danger ok。
                  modal.confirm({
                    title: `取消采购单 ${selectedRow.poNo}？`,
                    content:
                      '取消的是采购意图，不影响任何库存；该订单行随后可重新登记采购。已发生收货的采购单不能取消。',
                    okText: '取消采购单',
                    okButtonProps: { danger: true },
                    cancelText: '返回',
                    onOk: () => {
                      cancelMutation.mutate(selectedRow.id);
                    },
                  });
                }}
              >
                取消采购单
              </Button>
            )}
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    list.data,
    cancelMutation,
    generateReceiptMutation,
    requestGenerateReceipt,
    openCloseRemaining,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="采购单"
        description="登记已下单的采购，消除重复采购与漏采购；到货后在收货单完成入库"
        secondary={<Button onClick={() => setViewOpen(true)}>视图设置</Button>}
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ orderedAt: localNow(), items: [{ quantity: 1 }] });
              setShowImages(false);
              setCreateOpen(true);
            }}
          >
            登记采购
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="PO号 / 货源说明 / 供应商 / SKU"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索采购单"
        />
      </FilterBar>

      {/* 状态标签页（需求 2026-10-09）：默认聚焦未到货，替代原状态下拉。 */}
      <Tabs
        activeKey={statusTab}
        onChange={(key) => {
          setPage(1);
          setStatusTab(key as PoStatusTab);
          setSelectedId(null);
        }}
        items={[
          { key: 'pending', label: '未到货' },
          { key: 'received', label: '已到货' },
          { key: 'cancelled', label: '已取消' },
          { key: 'all', label: '全部' },
        ]}
      />

      <SectionCard flush>
        <DataTable<PurchaseOrderRow>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selectedPoIds,
            // 跨分页选择（用户指示 2026-10-13）：翻页/切标签后勾选不丢。
            preserveSelectedRowKeys: true,
            onChange: handlePoSelectionChange,
          }}
          // 分页迁到页面底部浮岛（用户指示 2026-10-17，与订单页同款）。
          pagination={false}
          expandable={{
            // 选中即展开（与订单页一致的用户指示 2026-09-17）：行点击选择
            // 驱动展开，直接显示该单的采购商品明细（需求 2026-10-09）。
            // 视图设置「默认展开明细」时整页展开，点击仅选中（2026-10-24）。
            expandedRowKeys: viewSettings.defaultExpandAll
              ? selectedId === null
                ? rows.map((row) => row.id)
                : [...new Set([...rows.map((row) => row.id), selectedId])]
              : selectedId === null
                ? []
                : [selectedId],
            showExpandColumn: false,
            expandedRowRender: (row: PurchaseOrderRow) => (
              <div onClick={(event) => event.stopPropagation()}>
                <ExpandedPoItems
                  poId={row.id}
                  showImages={viewSettings.showImages}
                  imageSize={viewSettings.imageSize}
                />
              </div>
            ),
          }}
          onRow={(record) => {
            const activate = (): void => {
              setSelectedId(record.id === selectedId ? null : record.id);
            };
            return {
              onClick: (event) => {
                // 勾选复选框不触发行选中/展开（多选与单击选中互不干扰）。
                if ((event.target as HTMLElement).closest('.ant-table-selection-column') !== null) {
                  return;
                }
                activate();
              },
              onDoubleClick: () => setDetailId(record.id),
              // 键盘可达（2026-10-17 体检 P2-9）：Enter / 空格 = 行点击。
              ...rowInteractionProps({
                selected: record.id === selectedId,
                onActivate: activate,
                label: `采购单 ${record.poNo}`,
              }),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            };
          }}
          emptyTitle="暂无采购单"
          emptyDescription="在缺货订单的详情里点「登记采购」，或在这里登记备货采购。"
          columns={[
            { title: 'PO号', dataIndex: 'poNo', key: 'poNo', width: 120 },
            // 「采购商品」列（用户指示 2026-10-17，2026-10-19 调整格式）：明细第一行的
            // SKU 名称 + 数量，显示为「名称 × 1」；数量 = 1 绿色、> 1 红色，
            // 不用点开明细就能看出这单是单品单件还是多件。
            {
              title: '采购商品',
              key: 'firstItem',
              width: 260,
              render: (_: unknown, row: PurchaseOrderRow) => {
                if (row.firstItemName === null && row.firstItemSkuCode === null) {
                  return <span style={{ color: colors.textTertiary }}>—</span>;
                }
                const quantity =
                  row.firstItemQuantity === null ? null : Number(row.firstItemQuantity);
                return (
                  <Tooltip title={row.firstItemSkuCode ?? undefined}>
                    <span style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                      {row.firstItemName ?? row.firstItemSkuCode}
                      {quantity !== null && (
                        <>
                          <span style={{ color: colors.textTertiary }}> × </span>
                          <span
                            style={{
                              color: quantity > 1 ? colors.danger : colors.success,
                              fontWeight: quantity > 1 ? 550 : undefined,
                            }}
                          >
                            {quantity}
                          </span>
                        </>
                      )}
                    </span>
                  </Tooltip>
                );
              },
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 110,
              render: (value: string, record: PurchaseOrderRow) => {
                const meta = STATUS_META[value] ?? { tone: 'neutral' as const, label: value };
                const shortClosed =
                  value === 'RECEIVED' && Number(record.closedQuantity ?? '0') > 0;
                return (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <StatusBadge tone={meta.tone} label={meta.label} hint={value} showDot={false} />
                    {shortClosed && (
                      <StatusBadge
                        tone="warning"
                        label="短装结案"
                        hint={`已结案 ${Number(record.closedQuantity)} 件未收`}
                        showDot={false}
                      />
                    )}
                  </span>
                );
              },
            },
            {
              title: '明细',
              key: 'items',
              width: 110,
              // 多行 / 多件用红字标出来（2026-10-19 用户指示）：与「采购商品」列的
              // 数量红字同一套语义 —— 一眼区分单品单件与拼单。
              render: (_: unknown, row: PurchaseOrderRow) => {
                const lines = row.itemCount;
                const pieces = Number(row.totalQuantity);
                const tone = (value: number) => (value > 1 ? colors.danger : colors.textPrimary);
                return (
                  <span style={{ fontSize: 12.5 }}>
                    <span style={{ color: tone(lines) }}>{lines}</span> 行 /{' '}
                    <span style={{ color: tone(pieces) }}>{pieces}</span> 件
                  </span>
                );
              },
            },
            {
              title: '采购时间',
              dataIndex: 'orderedAt',
              key: 'orderedAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
            // 供应商 / 货源移到最后一列（2026-10-19 用户指示）：它信息量低、长度不固定，
            // 放中间会把「采购商品」挤到视线中段；放末尾顺带吸收剩余宽度。
            {
              title: '供应商 / 货源',
              key: 'source',
              width: 180,
              render: (_: unknown, row: PurchaseOrderRow) =>
                row.supplierName ?? row.sourceNote ?? '—',
            },
          ]}
        />
      </SectionCard>

      {/* 短装结案（2026-11-03）：只关「不会再发货」的剩余数量，不写收货。 */}
      <Modal
        open={closeDetail !== null}
        title={`关闭未收数量：${closeDetail?.poNo ?? ''}`}
        okText="确认结案"
        cancelText="取消"
        okButtonProps={{
          danger: true,
          loading: closeRemainingMutation.isPending,
          disabled:
            closeReason.trim() === '' ||
            Object.values(closeLines).every((line) => !line.checked || line.quantity === null),
        }}
        onCancel={() => setCloseDetail(null)}
        onOk={() => {
          if (closeDetail === null) {
            return;
          }
          const items = Object.entries(closeLines)
            .filter(([, line]) => line.checked && line.quantity !== null && line.quantity > 0)
            .map(([itemId, line]) => ({ itemId, quantity: String(line.quantity) }));
          if (items.length === 0) {
            void message.warning('请至少选择一行要结案的数量');
            return;
          }
          closeRemainingMutation.mutate({
            poId: closeDetail.id,
            reason: closeReason.trim(),
            items,
          });
        }}
        width={640}
      >
        <p style={{ fontSize: 13, color: colors.textSecondary, marginTop: 0 }}>
          结案的是「供应商不会再发货」的数量：<strong>不是收货</strong>，不写库存流水、不改成本；
          采购单随后可收口，在途回落，需要补货时可以重新登记采购。
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {(closeDetail?.items ?? []).map((item) => {
            const line = closeLines[item.id];
            const outstanding = Math.max(
              Number(item.quantity) -
                Number(item.receivedQuantity) -
                Number(item.closedQuantity ?? 0),
              0,
            );
            if (outstanding <= 0) {
              return null;
            }
            return (
              <div
                key={item.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
              >
                <Checkbox
                  checked={line?.checked ?? false}
                  onChange={(event) =>
                    setCloseLines((current) => ({
                      ...current,
                      [item.id]: {
                        checked: event.target.checked,
                        quantity: current[item.id]?.quantity ?? outstanding,
                      },
                    }))
                  }
                />
                <span style={{ minWidth: 240, fontSize: 13 }}>
                  {item.skuCode} · {item.skuName}
                </span>
                <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                  订购 {Number(item.quantity)} · 已收 {Number(item.receivedQuantity)}
                  {Number(item.closedQuantity ?? 0) > 0
                    ? ` · 已结案 ${Number(item.closedQuantity)}`
                    : ''}{' '}
                  · 未收 {outstanding}
                </span>
                <InputNumber
                  min={0.001}
                  max={outstanding}
                  precision={3}
                  value={line?.quantity ?? outstanding}
                  disabled={line?.checked !== true}
                  onChange={(value) =>
                    setCloseLines((current) => ({
                      ...current,
                      [item.id]: {
                        checked: current[item.id]?.checked ?? false,
                        quantity: typeof value === 'number' ? value : null,
                      },
                    }))
                  }
                  style={{ width: 110 }}
                  aria-label="本次结案数量"
                />
              </div>
            );
          })}
        </div>
        <Input.TextArea
          rows={3}
          maxLength={500}
          value={closeReason}
          onChange={(event) => setCloseReason(event.target.value)}
          placeholder="结案原因（必填）：例如「供应商确认缺货，不再补发」"
        />
      </Modal>

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={760}
        title={
          detailRow !== null && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>{detailRow.poNo}</span>
          )
        }
        extra={
          detailRow !== null && (
            <StatusBadge
              tone={STATUS_META[detailRow.status]?.tone ?? 'neutral'}
              label={STATUS_META[detailRow.status]?.label ?? detailRow.status}
              hint={detailRow.status}
            />
          )
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== null && (
          <>
            <ContextSection title="采购单信息">
              <ContextMetric label="供应商" value={detailRow.supplierName ?? '—'} />
              <ContextMetric label="货源说明" value={detailRow.sourceNote ?? '—'} />
              <ContextMetric
                label="收货仓库"
                value={
                  detailRow.receivingWarehouseId === null
                    ? '—'
                    : (detailRow.receivingWarehouseName ?? detailRow.receivingWarehouseId)
                }
              />
              <ContextMetric label="采购时间" value={fmtDateTime(detailRow.orderedAt)} />
              <ContextMetric
                label="预计到货"
                value={detailRow.expectedAt === null ? '—' : fmtDateTime(detailRow.expectedAt)}
              />
              <ContextMetric label="备注" value={detailRow.remark ?? '—'} />
            </ContextSection>
            <SectionCard title="明细" flush>
              <DataTable<PurchaseOrderItem>
                rowKey="id"
                dataSource={detailRow.items}
                pagination={false}
                emptyTitle="无明细"
                scroll={{ x: 860 }}
                columns={[
                  {
                    title: '图片',
                    key: 'image',
                    width: 64,
                    render: (_: unknown, row: PurchaseOrderItem) => (
                      <SkuThumbnail skuId={row.skuId} url={row.imageUrl} />
                    ),
                  },
                  {
                    title: 'SKU',
                    key: 'sku',
                    render: (_: unknown, row: PurchaseOrderItem) => (
                      <div>
                        <div style={{ fontWeight: 550, display: 'flex', alignItems: 'center' }}>
                          {row.skuCode}
                        </div>
                        <div
                          style={{
                            fontSize: 12.5,
                            color: colors.textSecondary,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          {row.skuName}
                          <CopyTextButton value={row.skuName} title="SKU 名称" />
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: '数量',
                    dataIndex: 'quantity',
                    key: 'quantity',
                    width: 80,
                    align: 'right' as const,
                    // 数量恒为整数，金额两位小数（用户规则 2026-10-26）
                    render: (value: string) => fmtQty(value),
                  },
                  {
                    title: '单位成本',
                    dataIndex: 'unitCost',
                    key: 'unitCost',
                    width: 100,
                    align: 'right' as const,
                    render: (value: string | null) =>
                      value === null ? '—' : fmtMoney(value, 'CNY'),
                  },
                  {
                    title: '已收货',
                    dataIndex: 'receivedQuantity',
                    key: 'receivedQuantity',
                    width: 80,
                    align: 'right' as const,
                    render: (value: string) => fmtQty(value),
                  },
                  {
                    title: '小计',
                    key: 'subtotal',
                    width: 100,
                    align: 'right' as const,
                    render: (_: unknown, row: PurchaseOrderItem) => {
                      const subtotal = lineSubtotal(row);
                      return subtotal === null ? '—' : fmtMoney(subtotal.toFixed(2), 'CNY');
                    },
                  },
                  {
                    title: '关联订单',
                    dataIndex: 'orderNo',
                    key: 'orderNo',
                    width: 120,
                    render: (value: string | null) => value ?? '备货采购',
                  },
                ]}
              />
              <OrderTotal items={detailRow.items} />
            </SectionCard>
          </>
        )}
      </Drawer>

      {/* ---- 视图设置（2026-10-24 用户需求：默认展开明细 + 明细图片列） ---- */}
      <Modal
        title="视图设置"
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={
          <Button type="primary" onClick={() => setViewOpen(false)}>
            完成
          </Button>
        }
        width={520}
        destroyOnHidden
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch
              checked={viewSettings.defaultExpandAll}
              onChange={(checked) => updateViewSettings({ defaultExpandAll: checked })}
            />
            默认展开所有采购单明细
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Switch
              checked={viewSettings.showImages}
              onChange={(checked) => updateViewSettings({ showImages: checked })}
            />
            明细显示 SKU 图片列
          </label>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            图片尺寸：
            <Select
              size="small"
              style={{ width: 100 }}
              value={viewSettings.imageSize}
              disabled={!viewSettings.showImages}
              options={[32, 40, 56, 72].map((size) => ({ value: size, label: `${size}px` }))}
              onChange={(value) => updateViewSettings({ imageSize: value })}
            />
          </span>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            偏好保存在本机浏览器，不影响其他人；「默认展开明细」打开后整页明细直接展开，
            点击行只做选中（右栏/详情抽屉）。图片取该 SKU 的主图，未上传时显示占位图。
          </span>
        </div>
      </Modal>

      <Modal
        title="登记采购单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="登记"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        width={980}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 24 }}>
            <Form.Item
              name="supplierId"
              label="固定供应商（可选）"
              style={{ flex: 1, marginBottom: 0 }}
            >
              <Select
                allowClear
                placeholder="选择可复用供应商"
                showSearch
                optionFilterProp="label"
                options={supplierOptions.map((supplier) => ({
                  value: supplier.id,
                  label: `${supplier.code} · ${supplier.name}`,
                }))}
              />
            </Form.Item>
            <Button
              icon={<PlusOutlined />}
              onClick={() => setSupplierCreateOpen(true)}
              style={{ alignSelf: 'flex-end' }}
            >
              新建供应商
            </Button>
          </div>
          <Form.Item
            name="orderedAt"
            label="采购时间"
            rules={[{ required: true, message: '请选择采购时间' }]}
            tooltip="默认当前时间，可改为实际下单时间（支持补录过去日期）"
          >
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="sourceNote"
            label="货源说明（一次性网购填这里，不建供应商）"
            extra="如：淘宝 订单号 12345678"
          >
            <Input maxLength={500} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={2000} />
          </Form.Item>
          <Form.Item
            name="receivingWarehouseId"
            label="收货仓库"
            rules={[{ required: true, message: '请选择收货仓库' }]}
            extra="货最终送到哪个仓。收货单只能在这个仓收货，缺口覆盖也按这个仓计算。"
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择收货仓库"
              loading={warehouses.isLoading}
              options={(warehouses.data?.data ?? []).map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.warehouseCode} · ${warehouse.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="createReceiptDraft"
            label="同时生成收货单草稿"
            valuePropName="checked"
            extra="开启后按本次采购数量同步生成草稿（预填默认库位）；确认收货才入库。"
          >
            <Switch />
          </Form.Item>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <strong>采购明细</strong>
            <Switch
              size="small"
              checked={showImages}
              onChange={setShowImages}
              aria-label="显示图片"
            />
            <span>显示图片</span>
          </div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}
                  >
                    <Form.Item
                      name={[field.name, 'skuId']}
                      rules={[{ required: true, message: '请选择 SKU' }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <SkuSelect showImages={showImages} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'quantity']}
                      rules={[{ required: true, message: '数量' }]}
                      style={{ width: 100, marginBottom: 0 }}
                    >
                      <InputNumber min={1} placeholder="数量" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'unitCost']}
                      style={{ width: 120, marginBottom: 0 }}
                    >
                      <InputNumber<string>
                        stringMode
                        min="0"
                        precision={4}
                        placeholder="单位成本"
                        style={{ width: '100%' }}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'remark']}
                      style={{ width: 160, marginBottom: 0 }}
                    >
                      <Input
                        placeholder="备注"
                        maxLength={2000}
                        aria-label={`第 ${field.name + 1} 行备注`}
                      />
                    </Form.Item>
                    <div style={{ width: 110, textAlign: 'right' }}>
                      <small style={{ color: colors.textSecondary }}>小计</small>
                      <div>
                        {(() => {
                          const subtotal = lineSubtotal(formItems?.[field.name] ?? {});
                          return subtotal === null ? '—' : fmtMoney(subtotal.toFixed(2), 'CNY');
                        })()}
                      </div>
                    </div>
                    <Button
                      type="text"
                      danger
                      disabled={fields.length <= 1}
                      onClick={() => remove(field.name)}
                    >
                      删除
                    </Button>
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => add({ quantity: 1 })}
                >
                  添加明细
                </Button>
              </>
            )}
          </Form.List>
          <OrderTotal items={formItems ?? []} />
        </Form>
      </Modal>
      <SupplierQuickCreateModal
        open={supplierCreateOpen}
        pending={createSupplierMutation.isPending}
        onClose={() => setSupplierCreateOpen(false)}
        onCreate={(values) => createSupplierMutation.mutate(values)}
      />

      {/* ---- 底部动作浮岛（用户指示 2026-10-17：与订单页同款）----
          分页与批量动作固定在主滚动区底部，必须在页面根节点的流内末尾；
          sticky 才能吸附在 <main> 内。未勾选时只渲染分页行。 */}
      <ActionIsland
        summary={
          selectedPoIds.length > 0 ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 550 }}>已选 {selectedPoIds.length} 单</span>
              <span style={{ fontSize: 12, color: colors.textTertiary }}>
                （可生成 {eligibleBatchPos.length}，跨分页保留）
              </span>
            </>
          ) : undefined
        }
        actions={
          selectedPoIds.length > 0 ? (
            <>
              <Button
                loading={batchGenerateReceiptMutation.isPending}
                disabled={batchDeleteMutation.isPending}
                onClick={requestBatchGenerateReceipt}
              >
                批量生成收货单
              </Button>
              <Button
                danger
                loading={batchDeleteMutation.isPending}
                disabled={batchGenerateReceiptMutation.isPending}
                onClick={requestBatchDelete}
              >
                批量删除
              </Button>
              <Button type="text" onClick={clearPoSelection}>
                清空选择
              </Button>
            </>
          ) : undefined
        }
        leading={
          <span style={{ fontSize: 13, color: colors.textSecondary }}>
            共 {list.data?.meta.total ?? 0} 单
          </span>
        }
        trailing={
          <Pagination
            current={page}
            pageSize={50}
            total={list.data?.meta.total ?? 0}
            onChange={(next) => setPage(next)}
          />
        }
        hidden={(list.data?.meta.total ?? 0) === 0}
      />
    </div>
  );
}

const IMAGE_FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#f0f0f0"/><text x="20" y="24" text-anchor="middle" fill="#888" font-size="10">无图</text></svg>')}`;

/**
 * 展开行明细列（需求 2026-10-09；2026-10-24 增加图片列）。
 *
 * 图片来自详情接口随行返回的 `imageUrl`（后端批量签名，一次查询），
 * 不在前端逐行请求；`showImages` / 尺寸由视图设置控制。
 */
function expandedPoItemColumns(options: {
  showImages: boolean;
  imageSize: number;
}): ColumnsType<PurchaseOrderItem> {
  const imageColumn: ColumnsType<PurchaseOrderItem> = options.showImages
    ? [
        {
          title: '图片',
          key: 'image',
          width: options.imageSize + 24,
          render: (_: unknown, row: PurchaseOrderItem) => (
            <SkuThumbnail skuId={row.skuId} url={row.imageUrl} size={options.imageSize} />
          ),
        },
      ]
    : [];
  return [
    ...imageColumn,
    {
      title: 'SKU',
      key: 'sku',
      // 定宽（2026-10-17，与订单页同因）：此前是这一列唯一没有 width，定宽表会把
      // 剩余空间全分给它，右侧（数量/成本/小计）被挤到最右，中间留一大片空白。
      width: 320,
      render: (_: unknown, row: PurchaseOrderItem) => (
        <div>
          <span style={{ fontWeight: 550 }}>{row.skuCode}</span>
          <span style={{ fontSize: 12.5, color: colors.textSecondary, marginLeft: 8 }}>
            {row.skuName}
          </span>
          <CopyTextButton value={row.skuName} title="SKU 名称" />
        </div>
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 70,
      align: 'right' as const,
      render: (value: string) => fmtQty(value),
    },
    {
      title: '单位成本',
      dataIndex: 'unitCost',
      key: 'unitCost',
      width: 90,
      align: 'right' as const,
      render: (value: string | null) => (value === null ? '—' : fmtMoney(value, 'CNY')),
    },
    {
      title: '已收货',
      dataIndex: 'receivedQuantity',
      key: 'receivedQuantity',
      width: 70,
      align: 'right' as const,
      render: (value: string) => fmtQty(value),
    },
    {
      title: '小计',
      key: 'subtotal',
      width: 100,
      align: 'right' as const,
      render: (_: unknown, row: PurchaseOrderItem) => {
        const subtotal = lineSubtotal(row);
        return subtotal === null ? '—' : fmtMoney(subtotal.toFixed(2), 'CNY');
      },
    },
    {
      title: '关联订单',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 120,
      render: (value: string | null) => value ?? '备货采购',
    },
  ];
}

/**
 * 展开行内容（需求 2026-10-09）：与详情抽屉共用 `['purchase-order-detail',
 * id]` 缓存键（§68 模式），展开选中行不产生额外请求（已查过的单直接命中）。
 * 2026-10-24：图片列与尺寸由视图设置控制（图片随详情接口返回）。
 */
function ExpandedPoItems({
  poId,
  showImages,
  imageSize,
}: {
  poId: string;
  showImages: boolean;
  imageSize: number;
}) {
  const detailQuery = useApiQuery<{ data: PurchaseOrderDetail }>(
    '/api/v1/purchase-orders/{id}',
    {},
    ['purchase-order-detail', poId],
    { id: poId },
  );
  if (detailQuery.isLoading) {
    return <span style={{ fontSize: 12.5, color: colors.textTertiary }}>采购明细加载中…</span>;
  }
  const row = detailQuery.data?.data;
  if (row === undefined || row.id !== poId) {
    return <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无采购明细</span>;
  }
  return (
    <DataTable<PurchaseOrderItem>
      size="small"
      rowKey="id"
      dataSource={row.items}
      pagination={false}
      emptyTitle="无明细"
      columns={expandedPoItemColumns({ showImages, imageSize })}
    />
  );
}

/** Reuse the list URL; only fetch images when a selected SKU is not in that list. */
function SkuThumbnail({
  skuId,
  url,
  size = 40,
}: {
  skuId?: string;
  url?: string | null;
  size?: number;
}) {
  const images = useApiQuery<SkuImageEnvelope>(
    '/api/v1/skus/{skuId}/images',
    {},
    ['po-sku-images', skuId],
    { skuId: skuId ?? '' },
    Boolean(skuId) && url === undefined,
  );
  const sorted = [...(images.data?.data ?? [])].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder,
  );
  const src = url === undefined ? sorted[0]?.url : url;
  return (
    <Image
      width={size}
      height={size}
      src={src || IMAGE_FALLBACK}
      fallback={IMAGE_FALLBACK}
      alt="SKU 图片"
      preview={Boolean(src)}
      style={{ objectFit: 'contain', background: colors.primarySoft }}
    />
  );
}

function SupplierQuickCreateModal({
  open,
  pending,
  onClose,
  onCreate,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onCreate: (values: SupplierFormValues) => void;
}) {
  const [supplierForm] = Form.useForm<SupplierFormValues>();
  return (
    <Modal
      title="新建供应商"
      open={open}
      zIndex={1100}
      onCancel={onClose}
      onOk={() => supplierForm.submit()}
      okText="创建并选中"
      cancelText="取消"
      confirmLoading={pending}
      afterOpenChange={(isOpen) => {
        if (!isOpen) supplierForm.resetFields();
      }}
      destroyOnHidden
    >
      <p style={{ color: colors.textSecondary }}>供应商编码无需填写，创建后自动生成。</p>
      <Form form={supplierForm} layout="vertical" preserve={false} onFinish={onCreate}>
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, whitespace: true, message: '请输入供应商名称' }]}
        >
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="contactName" label="联系人（可选）">
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="contactPhone" label="电话（可选）">
          <Input maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** SKU picker with server-side keyword search over the master data. */
function SkuSelect({
  showImages,
  ...props
}: {
  showImages: boolean;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const skus = useApiQuery<
    Envelope<Array<{ id: string; skuCode: string; nameZh: string; primaryImageUrl: string | null }>>
  >('/api/v1/skus', { page: 1, pageSize: 20, ...(keyword ? { keyword } : {}) }, [
    'skus-for-po',
    keyword,
  ]);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {showImages && (
        <SkuThumbnail
          skuId={props.value}
          url={skus.data?.data.find((sku) => sku.id === props.value)?.primaryImageUrl}
        />
      )}
      <Select
        {...props}
        style={{ flex: 1, minWidth: 0 }}
        showSearch
        filterOption={false}
        placeholder="搜索 SKU 编码 / 名称"
        onSearch={setKeyword}
        options={(skus.data?.data ?? []).map((sku) => ({
          value: sku.id,
          label: `${sku.skuCode} · ${sku.nameZh}`,
        }))}
        loading={skus.isLoading}
      />
    </div>
  );
}
