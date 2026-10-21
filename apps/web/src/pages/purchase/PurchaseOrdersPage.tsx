import { Key, useCallback, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
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
import { fmtDateTime } from '../../utils/format';
import {
  ActionIsland,
  colors,
  ContextAction,
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
  remark: string | null;
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
      <strong>本单合计：{total.toFixed(4)}</strong>
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
  }, [selectedRow, list.data, cancelMutation, generateReceiptMutation, requestGenerateReceipt]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="采购单"
        description="登记已下单的采购，消除重复采购与漏采购；到货后在收货单完成入库"
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
            expandedRowKeys: selectedId === null ? [] : [selectedId],
            showExpandColumn: false,
            expandedRowRender: (row: PurchaseOrderRow) => (
              <div onClick={(event) => event.stopPropagation()}>
                <ExpandedPoItems poId={row.id} />
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
              render: (value: string) => {
                const meta = STATUS_META[value] ?? { tone: 'neutral' as const, label: value };
                return (
                  <StatusBadge tone={meta.tone} label={meta.label} hint={value} showDot={false} />
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
                      <SkuThumbnail skuId={row.skuId} />
                    ),
                  },
                  {
                    title: 'SKU',
                    key: 'sku',
                    render: (_: unknown, row: PurchaseOrderItem) => (
                      <div>
                        <div style={{ fontWeight: 550 }}>{row.skuCode}</div>
                        <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
                          {row.skuName}
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
                  },
                  {
                    title: '单位成本',
                    dataIndex: 'unitCost',
                    key: 'unitCost',
                    width: 100,
                    align: 'right' as const,
                    render: (value: string | null) =>
                      value === null ? '—' : Number(value).toFixed(4),
                  },
                  {
                    title: '已收货',
                    dataIndex: 'receivedQuantity',
                    key: 'receivedQuantity',
                    width: 80,
                    align: 'right' as const,
                  },
                  {
                    title: '小计',
                    key: 'subtotal',
                    width: 100,
                    align: 'right' as const,
                    render: (_: unknown, row: PurchaseOrderItem) => {
                      const subtotal = lineSubtotal(row);
                      return subtotal === null ? '—' : subtotal.toFixed(4);
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
                      <div>{lineSubtotal(formItems?.[field.name] ?? {})?.toFixed(4) ?? '—'}</div>
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

/** 展开行明细列（需求 2026-10-09）：紧凑视图，不含图片列（详情抽屉里有）。 */
const EXPANDED_PO_ITEM_COLUMNS: ColumnsType<PurchaseOrderItem> = [
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
      </div>
    ),
  },
  {
    title: '数量',
    dataIndex: 'quantity',
    key: 'quantity',
    width: 70,
    align: 'right' as const,
  },
  {
    title: '单位成本',
    dataIndex: 'unitCost',
    key: 'unitCost',
    width: 90,
    align: 'right' as const,
    render: (value: string | null) => (value === null ? '—' : Number(value).toFixed(4)),
  },
  {
    title: '已收货',
    dataIndex: 'receivedQuantity',
    key: 'receivedQuantity',
    width: 70,
    align: 'right' as const,
  },
  {
    title: '小计',
    key: 'subtotal',
    width: 100,
    align: 'right' as const,
    render: (_: unknown, row: PurchaseOrderItem) => {
      const subtotal = lineSubtotal(row);
      return subtotal === null ? '—' : subtotal.toFixed(4);
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

/**
 * 展开行内容（需求 2026-10-09）：与详情抽屉共用 `['purchase-order-detail',
 * id]` 缓存键（§68 模式），展开选中行不产生额外请求（已查过的单直接命中）。
 */
function ExpandedPoItems({ poId }: { poId: string }) {
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
      columns={EXPANDED_PO_ITEM_COLUMNS}
    />
  );
}

/** Reuse the list URL; only fetch images when a selected SKU is not in that list. */
function SkuThumbnail({ skuId, url }: { skuId?: string; url?: string | null }) {
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
      width={40}
      height={40}
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
