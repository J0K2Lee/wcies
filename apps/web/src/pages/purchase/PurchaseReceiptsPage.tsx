import { Key, useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Select,
  Tabs,
  Tooltip,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ColumnsType } from 'antd/es/table';
import { apiPost, useApiQuery } from '../../api/hooks';
import { apiClient } from '../../api/client';
import { fmtDateTime } from '../../utils/format';
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
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Purchase receipts (Sprint 7 T4/T5): the REAL receiving action. The editor
 * supports scanning (barcode -> SKU via the global resolve endpoint),
 * binding unknown barcodes on the spot (decision D13), per-line bin choice
 * with a live occupancy hint (no automatic capacity check, D9), and a
 * one-click STAGING bin (Q4 option A) for receive-now-shelve-later.
 */

interface ReceiptRow {
  id: string;
  receiptNo: string;
  purchaseOrderId: string | null;
  purchaseOrderNo: string | null;
  supplierName: string | null;
  sourceNote: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  status: string;
  receivedAt: string | null;
  itemCount: number;
  totalQuantity: string;
  /** 明细第一行的 SKU 编码 / 名称 / 数量（列表「采购商品」列）。 */
  firstItemSkuCode: string | null;
  firstItemName: string | null;
  firstItemQuantity: string | null;
}

interface ReceiptItem {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  purchaseOrderItemId: string | null;
  quantity: string;
  unitCost: string | null;
  binId: string | null;
  binCode: string | null;
  serialNumbers: string[] | null;
}

interface ReceiptDetail extends ReceiptRow {
  remark: string | null;
  items: ReceiptItem[];
}

interface ResolvedBarcode {
  skuId: string;
  skuCode: string;
  skuName: string;
  matchedBarcode: string;
  barcodeType: string;
  serialTracking: boolean;
  suggestedUnitCost: string | null;
  suggestedUnitCostSource: 'MOVING_AVERAGE' | null;
}

/** One editable receipt line (draft stage). */
interface EditorItem {
  skuId: string;
  label: string;
  serialTracking: boolean;
  quantity: number | null;
  unitCost?: number;
  suggestedUnitCostSource?: ResolvedBarcode['suggestedUnitCostSource'];
  binId?: string;
  serialNumbersText?: string;
  purchaseOrderItemId?: string;
}

const STATUS_META: Record<string, { tone: 'info' | 'success' | 'neutral'; label: string }> = {
  DRAFT: { tone: 'info', label: '草稿' },
  RECEIVED: { tone: 'success', label: '已收货' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

type Envelope<T> = { data: T; meta: { total: number } };

/**
 * 状态标签页（用户需求 2026-10-09）：默认聚焦「待收货」（草稿——尚未确认
 * 入库的收货单）；已收货/已取消各一档，全部 = 不筛选。
 */
type ReceiptStatusTab = 'pending' | 'received' | 'cancelled' | 'all';

const RECEIPT_STATUS_TAB_FILTERS: Record<ReceiptStatusTab, { status?: string }> = {
  pending: { status: 'DRAFT' },
  received: { status: 'RECEIVED' },
  cancelled: { status: 'CANCELLED' },
  all: {},
};

function finiteNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function lineSubtotal(item: {
  quantity: string | number | null;
  unitCost?: string | number | null;
}): number | undefined {
  const quantity = finiteNumber(item.quantity);
  const cost = finiteNumber(item.unitCost);
  if (quantity === undefined || quantity <= 0 || cost === undefined || cost < 0) return undefined;
  return finiteNumber(quantity * cost);
}

function ReceiptTotal({
  title,
  items,
}: {
  title: string;
  items: Array<{ quantity: string | number | null; unitCost?: string | number | null }>;
}) {
  const subtotals = items.map(lineSubtotal).filter((value) => value !== undefined);
  const missing = items.filter((item) => finiteNumber(item.unitCost) === undefined).length;
  return (
    <div style={{ padding: '12px 0', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <strong>
        {title}：
        {subtotals.length === 0 ? '—' : subtotals.reduce((sum, value) => sum + value, 0).toFixed(4)}
      </strong>
      {missing > 0 && (
        <span style={{ fontSize: 12.5, color: colors.warning }}>
          {missing} 行未填单位成本，合计仅含已填成本行
        </span>
      )}
    </div>
  );
}

function needsBin(items: Array<{ binId?: string | null }>, binCount: number): boolean {
  return binCount > 0 && items.some((item) => !item.binId);
}

/** Barcode -> SKU through the generated client (never handwritten fetch, §72). */
async function resolveBarcode(
  barcode: string,
  reportError: (text: string) => void,
): Promise<ResolvedBarcode | null> {
  try {
    const { data, error } = await apiClient.GET('/api/v1/barcodes/{barcode}/resolve', {
      params: { path: { barcode } },
    });
    if (error !== undefined) {
      const envelope = error as { error?: { message?: string } };
      reportError(envelope.error?.message ?? '条码解析失败，请稍后重试');
      return null;
    }
    return data.data as ResolvedBarcode;
  } catch (error) {
    reportError(error instanceof Error ? error.message : '条码解析失败，请检查网络后重试');
    return null;
  }
}

export function PurchaseReceiptsPage() {
  const { message, modal, notification } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  // 批量勾选（用户指示 2026-10-17）：跨分页保留，浮岛驱动批量删除。
  const [selectedReceiptIds, setSelectedReceiptIds] = useState<string[]>([]);
  const [selectedReceiptsById, setSelectedReceiptsById] = useState<Map<string, ReceiptRow>>(
    () => new Map(),
  );
  const [keyword, setKeyword] = useState('');
  const [statusTab, setStatusTab] = useState<ReceiptStatusTab>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const [fromPoOpen, setFromPoOpen] = useState(false);
  const [items, setItems] = useState<EditorItem[]>([]);
  const [editing, setEditing] = useState<ReceiptDetail | null>(null);
  const [form] = Form.useForm<{ warehouseId: string; sourceNote?: string; remark?: string }>();
  const [fromPoForm] = Form.useForm<{ poId: string }>();
  const watchedWarehouseId = Form.useWatch('warehouseId', form);

  const tabFilter = RECEIPT_STATUS_TAB_FILTERS[statusTab];
  const list = useApiQuery<Envelope<ReceiptRow[]>>(
    '/api/v1/purchase-receipts',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(tabFilter.status !== undefined ? { status: tabFilter.status } : {}),
    },
    ['purchase-receipts', page, keyword, statusTab],
  );

  const warehouses = useApiQuery<
    Envelope<Array<{ id: string; warehouseCode: string; name: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-for-receipt']);

  const openPos = useApiQuery<
    Envelope<Array<{ id: string; poNo: string; status: string; receivingWarehouseId: string }>>
  >('/api/v1/purchase-orders', { page: 1, pageSize: 100 }, ['pos-for-receipt']);

  // One cached detail query shared by the rail (edit entry) and the drawer,
  // keyed on whichever receipt is focused (Phase 2 task §68 pattern).
  const focusId = detailId ?? selectedId;
  const detail = useApiQuery<{ data: ReceiptDetail }>(
    '/api/v1/purchase-receipts/{id}',
    {},
    ['purchase-receipt-detail', focusId],
    { id: focusId ?? '' },
    focusId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () =>
      (detail.data?.data.id === selectedId ? detail.data.data : null) ??
      rows.find((row) => row.id === selectedId) ??
      null,
    [rows, selectedId, detail.data],
  );
  // The drawer renders only the receipt it was opened for, never the merely
  // selected one (focusId also feeds the rail's edit entry).
  const detailRow =
    detailId !== null && detail.data?.data.id === detailId ? detail.data.data : null;

  // 深链打开（2026-10-16）：「去收货」在订单页生成草稿后跳转 ?receipt=<id>，
  // 直接选中并打开该草稿抽屉，省去操作者再找一遍。
  useEffect(() => {
    const target = searchParams.get('receipt');
    if (target === null || target === '') {
      return;
    }
    setSelectedId(target);
    setDetailId(target);
    // 一次性消费：清掉 query，避免刷新/返回重复打开已处理的草稿。
    const next = new URLSearchParams(searchParams);
    next.delete('receipt');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-receipt-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-for-receipt'] });
    // 收货确认会改来源采购单的状态/已收数量、以及订单行的派生采购状态
    // （已采购→已到货）和自动分配后的履约状态（2026-10-19 用户反馈：
    // 确认收货后返回列表，数据没变——此前只失效了收货单自己的缓存）。
    void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-order-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
  };

  const itemsToPayload = (editorItems: EditorItem[]) =>
    editorItems
      .filter(
        (item) =>
          item.skuId !== '' &&
          finiteNumber(item.quantity) !== undefined &&
          Number(item.quantity) > 0,
      )
      .map((item) => ({
        skuId: item.skuId,
        ...(item.purchaseOrderItemId ? { purchaseOrderItemId: item.purchaseOrderItemId } : {}),
        quantity: String(item.quantity),
        ...(finiteNumber(item.unitCost) !== undefined && Number(item.unitCost) >= 0
          ? { unitCost: String(item.unitCost) }
          : {}),
        ...(item.binId ? { binId: item.binId } : {}),
        ...(item.serialNumbersText && item.serialNumbersText.trim() !== ''
          ? {
              serialNumbers: item.serialNumbersText
                .split(/[\n,，;；\s]+/)
                .map((sn) => sn.trim())
                .filter((sn) => sn !== ''),
            }
          : {}),
      }));

  const createMutation = useMutation({
    mutationFn: (values: { warehouseId: string; sourceNote?: string; remark?: string }) =>
      apiPost<{ id: string; receiptNo: string }>('/api/v1/purchase-receipts', {
        warehouseId: values.warehouseId,
        sourceNote: values.sourceNote,
        remark: values.remark,
        items: itemsToPayload(items),
      }),
    onSuccess: (result) => {
      void message.success(`收货单 ${result.receiptNo} 已创建（草稿，确认后才入账）`);
      setCreateOpen(false);
      setItems([]);
      invalidate();
      setSelectedId(result.id);
      setDetailId(result.id);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      sourceNote,
      remark,
    }: {
      id: string;
      sourceNote?: string;
      remark?: string;
    }) => {
      const body: Record<string, unknown> = { items: itemsToPayload(items) };
      if (sourceNote !== undefined) {
        body.sourceNote = sourceNote;
      }
      if (remark !== undefined) {
        body.remark = remark;
      }
      return apiClient.PATCH('/api/v1/purchase-receipts/{id}', {
        params: { path: { id } },
        body: body as never,
      });
    },
    onSuccess: (result) => {
      if (result.error !== undefined) {
        void message.error(result.error.error.message);
        return;
      }
      void message.success('草稿已保存');
      setEditing(null);
      setItems([]);
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  /**
   * 确认收货后**立即**改写所有收货单列表缓存（2026-10-19 用户反馈：
   * 确认后返回列表这笔单仍是待收货，必须手动刷新）。
   *
   * 不能只依赖 invalidate 的异步重取：操作者关闭抽屉回到列表的一瞬间，
   * 列表可能还没拿到新响应。这里直接按 id 更新本地缓存——
   * 「待收货」视图移除该行，其余视图把状态改为已收货；随后 invalidate()
   * 再与服务端对账。
   *
   * 列表 key 形状：['purchase-receipts', page, keyword, statusTab]（下标 3 是 Tab）。
   */
  const applyConfirmedToCaches = (id: string) => {
    for (const query of queryClient.getQueryCache().findAll({ queryKey: ['purchase-receipts'] })) {
      const tab = query.queryKey[3];
      queryClient.setQueryData<Envelope<ReceiptRow[]>>(query.queryKey, (old) => {
        if (old === undefined) {
          return old;
        }
        if (tab === 'pending') {
          const data = old.data.filter((row) => row.id !== id);
          if (data.length === old.data.length) {
            return old;
          }
          return { data, meta: { ...old.meta, total: Math.max(0, old.meta.total - 1) } };
        }
        return {
          ...old,
          data: old.data.map((row) =>
            row.id === id
              ? { ...row, status: 'RECEIVED', receivedAt: new Date().toISOString() }
              : row,
          ),
        };
      });
    }
    // 抽屉里的状态徽标也立即反映（详情缓存按 ['purchase-receipt-detail', id]）。
    for (const query of queryClient
      .getQueryCache()
      .findAll({ queryKey: ['purchase-receipt-detail'] })) {
      if (query.queryKey[1] !== id) {
        continue;
      }
      queryClient.setQueryData<{ data: ReceiptDetail }>(query.queryKey, (old) =>
        old === undefined ? old : { ...old, data: { ...old.data, status: 'RECEIVED' } },
      );
    }
  };

  const confirmMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/purchase-receipts/{id}/confirm', {}, { id }),
    onSuccess: (_result, id) => {
      void message.success('收货确认完成，库存已入账');
      applyConfirmedToCaches(id);
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/purchase-receipts/{id}/cancel', {}, { id }),
    onSuccess: () => {
      void message.success('收货单已取消（未影响库存）');
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ---- 批量删除（用户指示 2026-10-17）：仅删除从未入库的单据 ----
  const selectedReceiptRows = useMemo(
    () =>
      selectedReceiptIds
        .map((id) => selectedReceiptsById.get(id))
        .filter((row): row is ReceiptRow => row !== undefined),
    [selectedReceiptIds, selectedReceiptsById],
  );
  const handleReceiptSelectionChange = useCallback((keys: Key[], rows: ReceiptRow[]) => {
    const ids = keys.map(String);
    setSelectedReceiptIds(ids);
    setSelectedReceiptsById((current) => {
      const next = new Map<string, ReceiptRow>();
      for (const id of ids) {
        const kept = current.get(id);
        if (kept !== undefined) next.set(id, kept);
      }
      for (const row of rows) next.set(row.id, row);
      return next;
    });
  }, []);
  const clearReceiptSelection = useCallback(() => {
    setSelectedReceiptIds([]);
    setSelectedReceiptsById(new Map());
  }, []);

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
      }>('/api/v1/purchase-receipts/batch-delete', { ids }),
    onSuccess: (result) => {
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量删除收货单：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description:
          result.failed === 0 ? undefined : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {result.results
                .filter((item) => !item.ok)
                .map((item) => (
                  <div key={item.id}>
                    {item.code ?? selectedReceiptsById.get(item.id)?.receiptNo ?? item.id}：
                    {item.message ?? item.errorCode ?? '未知错误'}
                  </div>
                ))}
            </div>
          ),
        duration: result.failed > 0 ? 0 : 6,
      });
      const deleted = new Set(result.results.filter((item) => item.ok).map((item) => item.id));
      if (deleted.size > 0) {
        handleReceiptSelectionChange(
          selectedReceiptIds.filter((id) => !deleted.has(id)),
          selectedReceiptRows.filter((row) => !deleted.has(row.id)),
        );
        if (selectedId !== null && deleted.has(selectedId)) {
          setSelectedId(null);
        }
      }
      invalidate();
    },
    onError: (error: Error) => void message.error(`批量删除失败：${error.message}`),
  });

  const requestBatchDelete = useCallback(() => {
    if (selectedReceiptIds.length === 0) {
      return;
    }
    modal.confirm({
      title: `删除勾选的 ${selectedReceiptIds.length} 张收货单？`,
      content:
        '仅草稿/已取消（从未入库）的收货单会被删除；已确认收货的单会保留并提示失败。删除不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '返回',
      onOk: () => {
        batchDeleteMutation.mutate(selectedReceiptIds);
      },
    });
  }, [modal, selectedReceiptIds, batchDeleteMutation]);

  // ---- 批量收货（用户需求 2026-10-20）：逐笔复用单笔确认，失败隔离 ----
  // 每张单仍是独立事务：库存入账 / 超收校验 / 采购单已收累加 / 成本更新全部
  // 走单笔规则；已被他人确认的单幂等重放，不重复入账。
  const confirmableReceiptRows = useMemo(
    () => selectedReceiptRows.filter((row) => row.status === 'DRAFT'),
    [selectedReceiptRows],
  );

  const batchConfirmMutation = useMutation({
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
          idempotentReplay: boolean;
        }>;
      }>('/api/v1/purchase-receipts/batch-confirm', { ids }),
    onSuccess: (result) => {
      const succeeded = result.results.filter((item) => item.ok);
      for (const item of succeeded) {
        applyConfirmedToCaches(item.id);
      }
      const replayed = succeeded.filter((item) => item.idempotentReplay).length;
      const failures = result.results.filter((item) => !item.ok);
      notification.open({
        type: result.failed > 0 ? 'warning' : 'success',
        title: `批量收货：成功 ${result.succeeded} / 失败 ${result.failed}（共 ${result.total}）`,
        description:
          replayed === 0 && failures.length === 0 ? undefined : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              {replayed > 0 ? (
                <div>{replayed} 张此前已确认，本次为幂等重放（未重复入账）。</div>
              ) : null}
              {failures.map((item) => (
                <div key={item.id}>
                  {item.code ?? selectedReceiptsById.get(item.id)?.receiptNo ?? item.id}：
                  {item.message ?? item.errorCode ?? '未知错误'}
                </div>
              ))}
            </div>
          ),
        duration: result.failed > 0 ? 0 : 6,
      });
      const done = new Set(succeeded.map((item) => item.id));
      if (done.size > 0) {
        handleReceiptSelectionChange(
          selectedReceiptIds.filter((id) => !done.has(id)),
          selectedReceiptRows.filter((row) => !done.has(row.id)),
        );
      }
      invalidate();
    },
    onError: (error: Error) => void message.error(`批量收货失败：${error.message}`),
  });

  const requestBatchConfirm = useCallback(() => {
    const ids = confirmableReceiptRows.map((row) => row.id);
    if (ids.length === 0) {
      void message.warning('勾选的收货单中没有待收货（草稿）单据');
      return;
    }
    if (ids.length > 200) {
      void message.error('单次最多确认 200 张收货单，请分批操作');
      return;
    }
    const skipped = selectedReceiptIds.length - ids.length;
    modal.confirm({
      title: `确认收货勾选的 ${ids.length} 张草稿？`,
      content:
        '每张单整单入账（库存 / 采购单已收数量 / 成本），单笔失败会保留并提示原因。' +
        (skipped > 0 ? `另有 ${skipped} 张已收货或已取消的勾选单会被跳过。` : ''),
      okText: '确认收货',
      cancelText: '返回',
      onOk: () => {
        batchConfirmMutation.mutate(ids);
      },
    });
  }, [confirmableReceiptRows, selectedReceiptIds.length, modal, message, batchConfirmMutation]);

  const fromPoMutation = useMutation({
    // 表单字段整体作为 values 传入时含 poId，但 poId 只属于路径参数——
    // 请求体里多带会被后端白名单校验拒绝（property poId should not exist，
    // 2026-09-18 修复）。这里剥掉表单标识字段，只提交 DTO 接受的字段。
    // 收货仓恒为采购单目标仓（2026-10-21 决策 0023）：请求体不再带 warehouseId，
    // 前端也不再询问，避免货落到别的仓、缺口却留在原仓。
    mutationFn: ({ poId }: { poId: string; values: { poId: string } }) =>
      apiPost<{ id: string; receiptNo: string }>(
        '/api/v1/purchase-receipts/from-po/{poId}',
        {},
        {
          poId,
        },
      ),
    onSuccess: (result) => {
      void message.success(`已从采购单生成收货单 ${result.receiptNo}（草稿）`);
      setFromPoOpen(false);
      invalidate();
      setSelectedId(result.id);
      setDetailId(result.id);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const openEditor = useCallback(
    (receipt: ReceiptDetail) => {
      setItems(
        receipt.items.map((item) => ({
          skuId: item.skuId,
          label: `${item.skuCode} · ${item.skuName}`,
          serialTracking: item.serialNumbers !== null,
          quantity: Number(item.quantity),
          unitCost: item.unitCost === null ? undefined : Number(item.unitCost),
          binId: item.binId ?? undefined,
          serialNumbersText: item.serialNumbers?.join('\n') ?? '',
          purchaseOrderItemId: item.purchaseOrderItemId ?? undefined,
        })),
      );
      // 草稿上已有的事实必须回显（用户反馈 2026-09-28）：仓库不可改（Select
      // disabled），但绝不能显示成空；货源说明/备注一并回填。
      form.setFieldsValue({
        warehouseId: receipt.warehouseId,
        sourceNote: receipt.sourceNote ?? undefined,
        remark: receipt.remark ?? undefined,
      });
      setEditing(receipt);
    },
    [form],
  );

  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const requestConfirm = useCallback(
    async (receipt: ReceiptRow) => {
      setCheckingReceipt(true);
      try {
        // Read the exact receipt and current bins before any irreversible request.
        const result = await apiClient.GET('/api/v1/purchase-receipts/{id}', {
          params: { path: { id: receipt.id } },
        });
        if (result.error !== undefined) {
          const error = result.error as { error: { message: string } };
          void message.error(error.error.message);
          return;
        }
        const current = result.data.data as ReceiptDetail;
        if (current.status !== 'DRAFT') {
          void message.warning('该收货单已不是草稿，请刷新后查看');
          return;
        }
        const bins = await apiClient.GET('/api/v1/warehouses/{warehouseId}/bins', {
          params: { path: { warehouseId: current.warehouseId }, query: { page: 1, pageSize: 100 } },
        });
        if (bins.error !== undefined) {
          const error = bins.error as { error: { message: string } };
          void message.error(error.error.message);
          return;
        }
        if (needsBin(current.items, bins.data.data.length)) {
          void message.warning(
            '该仓库已有库位，且有明细未选库位，请先在明细中为这些行选择库位（可一键建暂存位）',
          );
          openEditor(current);
          return;
        }
        modal.confirm({
          title: `确认收货 ${current.receiptNo}？`,
          content: '确认后库存立即入账且不可撤销。SN 商品的序列号将写入库存序列表。',
          okText: '确认收货',
          okButtonProps: { danger: true },
          cancelText: '返回',
          onOk: () => {
            confirmMutation.mutate(current.id);
          },
        });
      } catch (error) {
        void message.error(error instanceof Error ? error.message : '读取收货单或库位失败，请重试');
      } finally {
        setCheckingReceipt(false);
      }
    },
    [message, modal, openEditor, confirmMutation.mutate],
  );

  const requestCancel = useCallback(
    (receipt: ReceiptRow) => {
      modal.confirm({
        title: `取消收货单 ${receipt.receiptNo}？`,
        content: '草稿取消不影响库存。',
        okText: '取消草稿',
        okButtonProps: { danger: true },
        cancelText: '返回',
        onOk: () => {
          cancelMutation.mutate(receipt.id);
        },
      });
    },
    [modal, cancelMutation.mutate],
  );

  // ---- Context rail ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="收货概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 单`} />
            <RailHint>收货单确认后才写库存；已确认的收货不可改数量，修正走库存调整。</RailHint>
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
          title={selectedRow.receiptNo}
          subtitle={selectedRow.purchaseOrderNo ?? selectedRow.sourceNote ?? '直接收货'}
          badge={<StatusBadge tone={meta.tone} label={meta.label} hint={selectedRow.status} />}
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="来源采购单" value={selectedRow.purchaseOrderNo ?? '—'} />
            <ContextMetric
              label="供应商/货源"
              value={selectedRow.supplierName ?? selectedRow.sourceNote ?? '—'}
            />
            <ContextMetric
              label="仓库"
              value={selectedRow.warehouseCode ?? selectedRow.warehouseId}
            />
            <ContextMetric
              label="明细"
              value={`${selectedRow.itemCount} 行 / 共 ${Number(selectedRow.totalQuantity)} 件`}
            />
            <ContextMetric
              label="收货时间"
              value={
                selectedRow.receivedAt === null ? '未确认' : fmtDateTime(selectedRow.receivedAt)
              }
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            {selectedRow.status === 'DRAFT' && (
              <>
                <Button
                  type="primary"
                  block
                  style={{ marginTop: 8 }}
                  loading={confirmMutation.isPending || checkingReceipt}
                  onClick={() => {
                    void requestConfirm(selectedRow);
                  }}
                >
                  确认收货
                </Button>
                <Button
                  block
                  style={{ marginTop: 8 }}
                  loading={detail.isLoading}
                  disabled={detail.data?.data.id !== selectedRow.id}
                  onClick={() => {
                    if (detail.data?.data.id === selectedRow.id) openEditor(detail.data.data);
                  }}
                >
                  编辑明细
                </Button>
                <Button
                  block
                  danger
                  style={{ marginTop: 8 }}
                  loading={cancelMutation.isPending}
                  onClick={() => requestCancel(selectedRow)}
                >
                  取消草稿
                </Button>
              </>
            )}
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    list.data,
    detail.data,
    confirmMutation.isPending,
    cancelMutation.isPending,
    detail.isLoading,
    checkingReceipt,
    openEditor,
    requestConfirm,
    requestCancel,
  ]);
  useContextRail(railContent);

  const warehouseOptions = (warehouses.data?.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.warehouseCode} · ${warehouse.name}`,
  }));

  const editorWarehouseId = editing !== null ? editing.warehouseId : watchedWarehouseId;
  // Same key/params as the editor's bins query - shared react-query cache,
  // no extra request; used by the submit guard (warehouse WITH bins needs
  // an explicit binId per line, frozen inventory rule).
  const binsForWarehouse = useApiQuery<Envelope<Array<{ id: string; binCode: string }>>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 100 },
    ['receipt-bins', editorWarehouseId],
    { warehouseId: editorWarehouseId ?? '' },
    editorWarehouseId !== undefined,
  );

  return (
    <div>
      <PageHeader
        title="收货单"
        description="真实收货动作：扫码加明细、选库位（可建暂存位），确认后经库存核心入账"
        secondary={
          <Button
            onClick={() => {
              fromPoForm.resetFields();
              setFromPoOpen(true);
            }}
          >
            从采购单生成
          </Button>
        }
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setItems([]);
              setCreateOpen(true);
            }}
          >
            新建收货单
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="收货单号 / 货源说明 / SKU"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索收货单"
        />
      </FilterBar>

      {/* 状态标签页（需求 2026-10-09）：默认聚焦待收货（草稿），替代原状态下拉。 */}
      <Tabs
        activeKey={statusTab}
        onChange={(key) => {
          setPage(1);
          setStatusTab(key as ReceiptStatusTab);
          setSelectedId(null);
        }}
        items={[
          { key: 'pending', label: '待收货' },
          { key: 'received', label: '已收货' },
          { key: 'cancelled', label: '已取消' },
          { key: 'all', label: '全部' },
        ]}
      />

      <SectionCard flush>
        <DataTable<ReceiptRow>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={rows}
          rowSelection={{
            selectedRowKeys: selectedReceiptIds,
            preserveSelectedRowKeys: true,
            onChange: handleReceiptSelectionChange,
          }}
          // 分页迁到页面底部浮岛（用户指示 2026-10-17，与订单页同款）。
          pagination={false}
          expandable={{
            // 选中即展开（与订单/采购单页一致）：行点击选择驱动展开，
            // 直接显示该单的收货商品明细（需求 2026-10-09）。
            expandedRowKeys: selectedId === null ? [] : [selectedId],
            showExpandColumn: false,
            expandedRowRender: (row: ReceiptRow) => (
              <div onClick={(event) => event.stopPropagation()}>
                <ExpandedReceiptItems receiptId={row.id} />
              </div>
            ),
          }}
          onRow={(record) => ({
            onClick: (event) => {
              // 勾选复选框不触发行选中/展开（多选与单击选中互不干扰）。
              if ((event.target as HTMLElement).closest('.ant-table-selection-column') !== null) {
                return;
              }
              setSelectedId(record.id === selectedId ? null : record.id);
            },
            onDoubleClick: () => setDetailId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无收货单"
          emptyDescription="从采购单一键生成，或直接新建；确认收货后库存才会增加。"
          columns={[
            { title: '收货单号', dataIndex: 'receiptNo', key: 'receiptNo', width: 120 },
            {
              title: '来源',
              key: 'source',
              render: (_: unknown, row: ReceiptRow) =>
                row.purchaseOrderNo ?? row.supplierName ?? row.sourceNote ?? '直接收货',
            },
            {
              title: '仓库',
              dataIndex: 'warehouseCode',
              key: 'warehouseCode',
              width: 90,
              render: (value: string | null, row: ReceiptRow) =>
                value ?? row.warehouseId.slice(0, 8),
            },
            // 「采购商品」列（用户指示 2026-10-17）：明细第一行的 SKU 名称 + 数量。
            {
              title: '采购商品',
              key: 'firstItem',
              width: 260,
              render: (_: unknown, row: ReceiptRow) => {
                if (row.firstItemName === null && row.firstItemSkuCode === null) {
                  return <span style={{ color: colors.textTertiary }}>—</span>;
                }
                return (
                  <Tooltip title={row.firstItemSkuCode ?? undefined}>
                    <span style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
                      {row.firstItemName ?? row.firstItemSkuCode}
                      {row.firstItemQuantity !== null && (
                        <span style={{ color: colors.textSecondary }}>
                          x{Number(row.firstItemQuantity)}
                        </span>
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
              width: 100,
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
              render: (_: unknown, row: ReceiptRow) =>
                `${row.itemCount} 行 / ${Number(row.totalQuantity)} 件`,
            },
            {
              title: '收货时间',
              dataIndex: 'receivedAt',
              key: 'receivedAt',
              width: 160,
              render: (value: string | null) => (value === null ? '—' : fmtDateTime(value)),
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailId !== null}
        onClose={() => {
          setDetailId(null);
          // 「返回收货列表」时主动拉一次最新列表（2026-10-19 用户反馈：确认收货
          // 后回到列表数据没变）。抽屉里的确认已经 invalidate，但这里再兜一层，
          // 保证关闭抽屉这一刻看到的一定是服务端最新数据。
          void list.refetch();
        }}
        size={880}
        title={
          detailRow !== null && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>
              {detailRow.receiptNo}
              {detailRow.status === 'DRAFT' ? ' — 确认前预览' : ''}
            </span>
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
        footer={
          detailRow?.status === 'DRAFT' ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => openEditor(detailRow)}>编辑明细</Button>
              <Button
                type="primary"
                loading={checkingReceipt || confirmMutation.isPending}
                onClick={() => {
                  void requestConfirm(detailRow);
                }}
              >
                确认收货
              </Button>
              <Button
                danger
                loading={cancelMutation.isPending}
                onClick={() => requestCancel(detailRow)}
              >
                取消草稿
              </Button>
            </div>
          ) : null
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== null && (
          <>
            <ContextSection title="收货单信息">
              <ContextMetric label="来源采购单" value={detailRow.purchaseOrderNo ?? '直接收货'} />
              <ContextMetric
                label="供应商/货源"
                value={detailRow.supplierName ?? detailRow.sourceNote ?? '—'}
              />
              <ContextMetric label="备注" value={detailRow.remark ?? '—'} />
              <ContextMetric
                label="收货时间"
                value={detailRow.receivedAt === null ? '未确认' : fmtDateTime(detailRow.receivedAt)}
              />
            </ContextSection>
            <SectionCard title={detailRow.status === 'DRAFT' ? '本次将入库' : '入库明细'} flush>
              <DataTable<ReceiptItem>
                rowKey="id"
                dataSource={detailRow.items}
                pagination={false}
                emptyTitle="无明细"
                columns={[
                  {
                    title: 'SKU',
                    key: 'sku',
                    render: (_: unknown, row: ReceiptItem) => (
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
                    width: 70,
                    align: 'right' as const,
                  },
                  {
                    title: '单位成本',
                    dataIndex: 'unitCost',
                    key: 'unitCost',
                    width: 90,
                    align: 'right' as const,
                    render: (value: string | null) =>
                      value === null ? '—' : Number(value).toFixed(4),
                  },
                  {
                    title: '小计',
                    key: 'subtotal',
                    width: 110,
                    align: 'right' as const,
                    render: (_: unknown, row: ReceiptItem) => lineSubtotal(row)?.toFixed(4) ?? '—',
                  },
                  {
                    title: '入库库位',
                    key: 'bin',
                    width: 130,
                    render: (_: unknown, row: ReceiptItem) =>
                      row.binCode ?? (
                        <span style={{ color: colors.textTertiary }}>自动（DEFAULT）</span>
                      ),
                  },
                  {
                    title: 'SN',
                    key: 'sn',
                    width: 90,
                    render: (_: unknown, row: ReceiptItem) =>
                      row.serialNumbers === null ? '—' : `${row.serialNumbers.length} 件`,
                  },
                ]}
              />
            </SectionCard>
            <ReceiptTotal title="本单合计" items={detailRow.items} />
          </>
        )}
      </Drawer>

      <Modal
        title={editing === null ? '新建收货单' : `编辑收货单草稿 ${editing.receiptNo}`}
        open={createOpen || editing !== null}
        onCancel={() => {
          setCreateOpen(false);
          setEditing(null);
          setItems([]);
        }}
        onOk={() => {
          if (
            items.some(
              (item) =>
                item.skuId !== '' &&
                (finiteNumber(item.quantity) === undefined || Number(item.quantity) <= 0),
            )
          ) {
            void message.warning('请为每行明细填写有效的正数数量');
            return;
          }
          if (
            items.some(
              (item) =>
                item.unitCost !== undefined &&
                (finiteNumber(item.unitCost) === undefined || item.unitCost < 0),
            )
          ) {
            void message.warning('单位成本须为有效的非负数，或留空');
            return;
          }
          if (itemsToPayload(items).length === 0) {
            void message.warning('请至少添加一行明细');
            return;
          }
          // Inventory rule (frozen): a warehouse WITH bins requires an
          // explicit binId - surface it here instead of failing at confirm.
          if (
            editorWarehouseId !== undefined &&
            needsBin(
              items.filter((item) => item.skuId !== ''),
              binsForWarehouse.data?.data.length ?? 0,
            )
          ) {
            void message.warning('该仓库已有库位，请为每行明细选择库位（可建暂存位）');
            return;
          }
          if (editing !== null) {
            updateMutation.mutate({
              id: editing.id,
              sourceNote: form.getFieldValue('sourceNote') as string | undefined,
              remark: form.getFieldValue('remark') as string | undefined,
            });
          } else {
            void form.validateFields().then((values) => createMutation.mutate(values));
          }
        }}
        okText={editing === null ? '创建草稿' : '保存草稿'}
        cancelText="取消"
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={960}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item
              name="warehouseId"
              label="收货仓库"
              rules={[{ required: true, message: '请选择仓库' }]}
              style={{ flex: 1 }}
            >
              <Select
                options={warehouseOptions}
                placeholder="选择仓库"
                disabled={editing !== null}
              />
            </Form.Item>
            <Form.Item name="sourceNote" label="货源说明（一次性网购）" style={{ flex: 1 }}>
              <Input maxLength={500} placeholder="如：淘宝 订单号 12345678" />
            </Form.Item>
          </div>
        </Form>
        <ReceiptItemsEditor warehouseId={editorWarehouseId} items={items} setItems={setItems} />
      </Modal>

      <Modal
        title="从采购单生成收货单"
        open={fromPoOpen}
        onCancel={() => setFromPoOpen(false)}
        onOk={() => {
          void fromPoForm
            .validateFields()
            .then((values) => fromPoMutation.mutate({ poId: values.poId, values }));
        }}
        okText="生成草稿"
        cancelText="取消"
        confirmLoading={fromPoMutation.isPending}
        destroyOnHidden
      >
        <Form form={fromPoForm} layout="vertical" preserve={false}>
          <Form.Item
            name="poId"
            label="采购单"
            rules={[{ required: true, message: '请选择采购单' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择未完成收货的采购单"
              options={(openPos.data?.data ?? [])
                .filter((po) => po.status === 'ORDERED' || po.status === 'PARTIALLY_RECEIVED')
                .map((po) => ({ value: po.id, label: `${po.poNo}（${po.status}）` }))}
            />
          </Form.Item>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            将按该采购单的目标仓与未收数量预填草稿；生成后可在草稿中扫码调整、选库位再确认。
          </span>
        </Form>
      </Modal>

      {/* ---- 底部动作浮岛（用户指示 2026-10-17：与订单页同款）----
          分页与批量动作固定在主滚动区底部；必须是页面根节点的流内末尾。 */}
      <ActionIsland
        summary={
          selectedReceiptIds.length > 0 ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 550 }}>
                已选 {selectedReceiptIds.length} 单
              </span>
              <span style={{ fontSize: 12, color: colors.textTertiary }}>（跨分页保留）</span>
            </>
          ) : undefined
        }
        actions={
          selectedReceiptIds.length > 0 ? (
            <>
              <Tooltip
                title={
                  confirmableReceiptRows.length === 0 ? '勾选的单据里没有待收货（草稿）' : undefined
                }
              >
                <span>
                  <Button
                    type="primary"
                    loading={batchConfirmMutation.isPending}
                    disabled={confirmableReceiptRows.length === 0}
                    onClick={requestBatchConfirm}
                  >
                    批量收货
                    {confirmableReceiptRows.length > 0
                      ? `（${confirmableReceiptRows.length}）`
                      : ''}
                  </Button>
                </span>
              </Tooltip>
              <Button danger loading={batchDeleteMutation.isPending} onClick={requestBatchDelete}>
                批量删除
              </Button>
              <Button type="text" onClick={clearReceiptSelection}>
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

/**
 * 展开行明细列（需求 2026-10-09）：紧凑视图——SKU/数量/成本/小计/库位/S。
 */
const EXPANDED_RECEIPT_ITEM_COLUMNS: ColumnsType<ReceiptItem> = [
  {
    title: 'SKU',
    key: 'sku',
    render: (_: unknown, row: ReceiptItem) => (
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
    title: '小计',
    key: 'subtotal',
    width: 110,
    align: 'right' as const,
    render: (_: unknown, row: ReceiptItem) => lineSubtotal(row)?.toFixed(4) ?? '—',
  },
  {
    title: '入库库位',
    key: 'bin',
    width: 130,
    render: (_: unknown, row: ReceiptItem) =>
      row.binCode ?? <span style={{ color: colors.textTertiary }}>自动（DEFAULT）</span>,
  },
  {
    title: 'SN',
    key: 'sn',
    width: 70,
    render: (_: unknown, row: ReceiptItem) =>
      row.serialNumbers === null ? '—' : `${row.serialNumbers.length} 件`,
  },
];

/**
 * 展开行内容（需求 2026-10-09）：与详情抽屉/右栏共用
 * `['purchase-receipt-detail', id]` 缓存键，展开选中行不产生额外请求。
 */
function ExpandedReceiptItems({ receiptId }: { receiptId: string }) {
  const detailQuery = useApiQuery<{ data: ReceiptDetail }>(
    '/api/v1/purchase-receipts/{id}',
    {},
    ['purchase-receipt-detail', receiptId],
    { id: receiptId },
  );
  if (detailQuery.isLoading) {
    return <span style={{ fontSize: 12.5, color: colors.textTertiary }}>收货明细加载中…</span>;
  }
  const row = detailQuery.data?.data;
  if (row === undefined || row.id !== receiptId) {
    return <span style={{ fontSize: 12.5, color: colors.textTertiary }}>暂无收货明细</span>;
  }
  return (
    <DataTable<ReceiptItem>
      size="small"
      rowKey="id"
      dataSource={row.items}
      pagination={false}
      emptyTitle="无明细"
      columns={EXPANDED_RECEIPT_ITEM_COLUMNS}
    />
  );
}

/**
 * Staging-bin display hint (Sprint 8 T4b / decision 3A): ST-zone bins
 * ({warehouse}-{STnn}-{level}) are the convention for 暂存位. Derived display
 * only - no schema, no status, the goods still need MOVE_BIN to reach a
 * sellable rack.
 */
function isStagingBin(binCode: string): boolean {
  const rack = binCode.split('-')[2] ?? '';
  return /^ST\d+$/.test(rack);
}

/**
 * Receiving editor (Sprint 7 T5.2-T5.5): scan-to-add lines, bind unknown
 * barcodes on the spot (D13), per-line bin choice with live occupancy hints
 * (D9: the human decides capacity), and a one-click STAGING bin (Q4 A).
 */
function ReceiptItemsEditor({
  warehouseId,
  items,
  setItems,
}: {
  warehouseId: string | undefined;
  items: EditorItem[];
  setItems: (next: EditorItem[]) => void;
}) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [scanning, setScanning] = useState(false);
  const [bindBarcode, setBindBarcode] = useState<string | null>(null);
  const [bindSku, setBindSku] = useState<string | undefined>();

  const bins = useApiQuery<Envelope<Array<{ id: string; binCode: string }>>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 100 }, // backend caps pageSize at 100
    ['receipt-bins', warehouseId],
    { warehouseId: warehouseId ?? '' },
    warehouseId !== undefined,
  );

  // Occupancy hint for the first line that chose a bin (D9: no auto check).
  const occupancyBinId = items.find((item) => item.binId !== undefined)?.binId;
  const occupancy = useApiQuery<
    Envelope<Array<{ skuCode: string; onHandQty: string; binCode: string }>>
  >(
    '/api/v1/inventory',
    { binId: occupancyBinId, pageSize: 50 },
    ['bin-occupancy', occupancyBinId],
    undefined,
    occupancyBinId !== undefined,
  );

  const bindMutation = useMutation({
    mutationFn: async ({ skuId, mode }: { skuId: string; mode: 'bind' | 'generate' }) => {
      // Returns the barcode that should be re-resolved to land the line.
      if (mode === 'bind') {
        await apiPost(
          '/api/v1/skus/{skuId}/barcodes',
          {
            barcode: bindBarcode,
            barcodeType: 'OTHER',
          },
          { skuId },
        );
        return bindBarcode as string;
      }
      const generated = await apiPost<{ barcode: string }>(
        '/api/v1/skus/{skuId}/barcodes/generate-internal',
        {},
        { skuId },
      );
      return generated.barcode;
    },
    onSuccess: async (barcodeToResolve, variables) => {
      const resolved = await resolveBarcode(barcodeToResolve, (text) => {
        void message.warning(text);
      });
      setBindBarcode(null);
      setBindSku(undefined);
      if (resolved === null) {
        void message.error('条码已保存但解析失败，请手工添加明细');
        return;
      }
      setItems([
        ...items,
        {
          skuId: resolved.skuId,
          label: `${resolved.skuCode} · ${resolved.skuName}`,
          serialTracking: resolved.serialTracking,
          unitCost: finiteNumber(resolved.suggestedUnitCost),
          suggestedUnitCostSource: resolved.suggestedUnitCostSource,
          quantity: 1,
          serialNumbersText: '',
        },
      ]);
      void message.success(
        variables.mode === 'bind'
          ? `条码已绑定并加入：${resolved.skuCode}`
          : `内部条码 ${barcodeToResolve} 已生成并加入（打印标签见 SKU 管理）`,
      );
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const stageBinMutation = useMutation({
    mutationFn: () =>
      apiPost<{ id: string; binCode: string }>(
        '/api/v1/warehouses/{warehouseId}/bins',
        { zone: 'ST', rackNumber: 1, level: '1' },
        { warehouseId: warehouseId as string },
      ),
    onSuccess: (bin) => {
      void message.success(`暂存库位已创建：${bin.binCode}（收货后可用 MOVE_BIN 上架）`);
      void queryClient.invalidateQueries({ queryKey: ['receipt-bins', warehouseId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  async function handleScan(barcode: string): Promise<void> {
    const trimmed = barcode.trim();
    if (trimmed === '') {
      return;
    }
    setScanning(true);
    try {
      const resolved = await resolveBarcode(trimmed, (text) => {
        void message.warning(text);
      });
      if (resolved === null) {
        setBindBarcode(trimmed); // Unknown: offer on-the-spot binding (D13).
        return;
      }
      // Same SKU scanned again: bump the quantity like a counting scanner.
      const existing = items.find((item) => item.skuId === resolved.skuId);
      if (existing !== undefined) {
        setItems(
          items.map((item) =>
            item.skuId === resolved.skuId
              ? { ...item, quantity: (finiteNumber(item.quantity) ?? 0) + 1 }
              : item,
          ),
        );
      } else {
        setItems([
          ...items,
          {
            skuId: resolved.skuId,
            label: `${resolved.skuCode} · ${resolved.skuName}`,
            serialTracking: resolved.serialTracking,
            unitCost: finiteNumber(resolved.suggestedUnitCost),
            suggestedUnitCostSource: resolved.suggestedUnitCostSource,
            quantity: 1,
            serialNumbersText: '',
          },
        ]);
      }
      void message.success(`已加入/累加：${resolved.skuCode}`);
    } finally {
      setScanning(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Input.Search
        placeholder="扫码 / 输入条码后回车，自动加入明细（未知条码可当场绑定）"
        enterButton="扫码"
        onSearch={(value) => {
          void handleScan(value);
        }}
        loading={scanning}
        disabled={warehouseId === undefined}
        aria-label="扫码加入明细"
      />
      {items.length === 0 ? (
        <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
          尚无明细：扫码添加，或点击下方按钮手工添加。
          {warehouseId === undefined ? '（请先选择仓库）' : ''}
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((item, index) => (
            <div
              key={`${item.skuId}-${index}`}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '8px 10px',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
              }}
            >
              {item.skuId === '' ? (
                <SkuPicker
                  onPicked={(sku) =>
                    setItems(
                      items.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              skuId: sku.id,
                              label: `${sku.skuCode} · ${sku.nameZh}`,
                              serialTracking: sku.serialTracking ?? false,
                            }
                          : row,
                      ),
                    )
                  }
                />
              ) : (
                <span style={{ minWidth: 220, fontSize: 13 }}>{item.label}</span>
              )}
              <InputNumber
                min={0.001}
                precision={3}
                aria-label="收货数量"
                status={item.quantity === null || item.quantity <= 0 ? 'error' : undefined}
                value={item.quantity}
                onChange={(value) =>
                  setItems(
                    items.map((row, i) =>
                      i === index ? { ...row, quantity: finiteNumber(value) ?? null } : row,
                    ),
                  )
                }
                suffix="件"
                style={{ width: 120 }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <InputNumber
                  min={0}
                  precision={4}
                  aria-label="单位成本"
                  value={item.unitCost}
                  placeholder="单位成本"
                  status={
                    item.unitCost === undefined || item.unitCost === null ? 'warning' : undefined
                  }
                  onChange={(value) =>
                    setItems(
                      items.map((row, i) =>
                        i === index
                          ? { ...row, unitCost: finiteNumber(value), suggestedUnitCostSource: null }
                          : row,
                      ),
                    )
                  }
                  style={{ width: 120 }}
                />
                {item.suggestedUnitCostSource === 'MOVING_AVERAGE' && (
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>建议：移动加权</span>
                )}
              </div>
              <span style={{ minWidth: 110, fontSize: 13 }}>
                小计：{lineSubtotal(item)?.toFixed(4) ?? '—'}
              </span>
              <Select
                allowClear
                placeholder="库位（可空）"
                value={item.binId}
                style={{ width: 190 }}
                showSearch
                optionFilterProp="label"
                options={(bins.data?.data ?? []).map((bin) => ({
                  value: bin.id,
                  label: isStagingBin(bin.binCode) ? `${bin.binCode}（暂存）` : bin.binCode,
                }))}
                onChange={(value) =>
                  setItems(items.map((row, i) => (i === index ? { ...row, binId: value } : row)))
                }
              />
              <Button
                type="text"
                danger
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                移除
              </Button>
              {item.serialTracking && (
                <Input.TextArea
                  rows={2}
                  placeholder="SN 列表（每行一个或逗号分隔，数量必须与件数一致）"
                  value={item.serialNumbersText}
                  onChange={(event) =>
                    setItems(
                      items.map((row, i) =>
                        i === index ? { ...row, serialNumbersText: event.target.value } : row,
                      ),
                    )
                  }
                  style={{ width: '100%' }}
                />
              )}
            </div>
          ))}
        </div>
      )}
      <ReceiptTotal title="本次入库合计" items={items.filter((item) => item.skuId !== '')} />
      {items.length > 0 &&
        items.some((item) => item.unitCost === undefined || item.unitCost === null) && (
          <span style={{ fontSize: 12.5, color: colors.warning }}>
            ⚠ 有{' '}
            {items.filter((item) => item.unitCost === undefined || item.unitCost === null).length}{' '}
            行未填单位成本：留空合法（赠品/样品），但该行不会计入移动加权成本，且确认后无法补填。
          </span>
        )}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={() =>
            setItems([
              ...items,
              {
                skuId: '',
                label: '',
                serialTracking: false,
                quantity: 1,
                serialNumbersText: '',
              },
            ])
          }
        >
          手工添加明细
        </Button>
        <Button
          disabled={warehouseId === undefined}
          loading={stageBinMutation.isPending}
          onClick={() => stageBinMutation.mutate()}
        >
          创建暂存库位（ST 区）
        </Button>
      </div>
      {occupancyBinId !== undefined && (
        <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
          库位现状（人工判断容量，不做自动校验）：
          {occupancy.isLoading
            ? ' 加载中…'
            : (occupancy.data?.data ?? []).length === 0
              ? ' 该库位当前为空'
              : ' ' +
                (occupancy.data?.data ?? [])
                  .map((row) => `${row.skuCode} ×${Number(row.onHandQty)}`)
                  .join('，')}
        </span>
      )}

      <Modal
        title={`条码 ${bindBarcode} 未绑定任何 SKU`}
        open={bindBarcode !== null}
        onCancel={() => {
          setBindBarcode(null);
          setBindSku(undefined);
        }}
        footer={[
          <Button
            key="generate"
            disabled={bindSku === undefined}
            loading={bindMutation.isPending}
            onClick={() => {
              if (bindSku !== undefined) {
                bindMutation.mutate({ skuId: bindSku, mode: 'generate' });
              }
            }}
          >
            生成内部条码并加入
          </Button>,
          <Button
            key="bind"
            type="primary"
            disabled={bindSku === undefined}
            loading={bindMutation.isPending}
            onClick={() => {
              if (bindSku !== undefined) {
                bindMutation.mutate({ skuId: bindSku, mode: 'bind' });
              }
            }}
          >
            绑定该条码并加入
          </Button>,
        ]}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            新到货没有系统条码是正常情况：选择它是哪个
            SKU，把实物上的条码绑定给它；实物没有条码则生成内部条码（W…）打印后贴上。一个 SKU
            可有多个条码，不会覆盖已有条码。
          </span>
          <SkuPicker value={bindSku} onChange={setBindSku} />
        </div>
      </Modal>
    </div>
  );
}

interface SkuOption {
  id: string;
  skuCode: string;
  nameZh: string;
  serialTracking?: boolean;
}

/** SKU picker with server-side keyword search over the master data. */
function SkuPicker({
  value,
  onChange,
  onPicked,
}: {
  value?: string;
  onChange?: (value: string | undefined) => void;
  onPicked?: (sku: SkuOption) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const skus = useApiQuery<Envelope<SkuOption[]>>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, ...(keyword ? { keyword } : {}) },
    ['skus-for-receipt-editor', keyword],
  );
  return (
    <Select
      showSearch
      filterOption={false}
      placeholder="搜索 SKU 编码 / 名称"
      onSearch={setKeyword}
      value={value}
      style={{ width: '100%', minWidth: 260 }}
      allowClear
      loading={skus.isLoading}
      options={(skus.data?.data ?? []).map((sku) => ({
        value: sku.id,
        label: `${sku.skuCode} · ${sku.nameZh}`,
        sku,
      }))}
      onChange={(_value, option) => {
        const picked = (option as { sku?: SkuOption } | undefined)?.sku;
        onChange?.(picked?.id);
        if (picked !== undefined) {
          onPicked?.(picked);
        }
      }}
    />
  );
}
