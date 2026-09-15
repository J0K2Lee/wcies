import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
import { apiClient } from '../../api/client';
import { fmtDateTime } from '../../utils/format';
import {
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
}

/** One editable receipt line (draft stage). */
interface EditorItem {
  skuId: string;
  label: string;
  serialTracking: boolean;
  quantity: number;
  unitCost?: number;
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

/** Barcode -> SKU through the generated client (never handwritten fetch, §72). */
async function resolveBarcode(barcode: string): Promise<ResolvedBarcode | null> {
  const { data, error } = await apiClient.GET('/api/v1/barcodes/{barcode}/resolve', {
    params: { path: { barcode } },
  });
  if (error !== undefined) {
    return null;
  }
  return data.data as ResolvedBarcode;
}

export function PurchaseReceiptsPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [fromPoOpen, setFromPoOpen] = useState(false);
  const [items, setItems] = useState<EditorItem[]>([]);
  const [editing, setEditing] = useState<ReceiptDetail | null>(null);
  const [form] = Form.useForm<{ warehouseId: string; sourceNote?: string; remark?: string }>();
  const [fromPoForm] = Form.useForm<{ poId: string; warehouseId: string }>();
  const watchedWarehouseId = Form.useWatch('warehouseId', form);

  const list = useApiQuery<Envelope<ReceiptRow[]>>(
    '/api/v1/purchase-receipts',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
    },
    ['purchase-receipts', page, keyword, status],
  );

  const warehouses = useApiQuery<
    Envelope<Array<{ id: string; warehouseCode: string; name: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-for-receipt']);

  const openPos = useApiQuery<Envelope<Array<{ id: string; poNo: string; status: string }>>>(
    '/api/v1/purchase-orders',
    { page: 1, pageSize: 100 },
    ['pos-for-receipt'],
  );

  // One cached detail query shared by the rail (edit entry) and the drawer,
  // keyed on whichever receipt is focused (Phase 2 task §68 pattern).
  const focusId = selectedId ?? detailId;
  const detail = useApiQuery<{ data: ReceiptDetail }>(
    '/api/v1/purchase-receipts/{id}',
    {},
    ['purchase-receipt-detail', focusId],
    { id: focusId ?? '' },
    focusId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  // The drawer renders only the receipt it was opened for, never the merely
  // selected one (focusId also feeds the rail's edit entry).
  const detailRow = detailId !== null ? (detail.data?.data ?? null) : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-receipt-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-for-receipt'] });
  };

  const itemsToPayload = (editorItems: EditorItem[]) =>
    editorItems
      .filter((item) => item.skuId !== '')
      .map((item) => ({
        skuId: item.skuId,
        ...(item.purchaseOrderItemId ? { purchaseOrderItemId: item.purchaseOrderItemId } : {}),
        quantity: String(item.quantity),
        ...(item.unitCost !== undefined && item.unitCost !== null
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

  const confirmMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/purchase-receipts/{id}/confirm', {}, { id }),
    onSuccess: () => {
      void message.success('收货确认完成，库存已入账');
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

  const fromPoMutation = useMutation({
    mutationFn: ({ poId, values }: { poId: string; values: { warehouseId: string } }) =>
      apiPost<{ id: string; receiptNo: string }>(
        '/api/v1/purchase-receipts/from-po/{poId}',
        values,
        { poId },
      ),
    onSuccess: (result) => {
      void message.success(`已从采购单生成收货单 ${result.receiptNo}（草稿）`);
      setFromPoOpen(false);
      invalidate();
      setDetailId(result.id);
    },
    onError: (error: Error) => void message.error(error.message),
  });

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
                  loading={confirmMutation.isPending}
                  onClick={() => {
                    // 确认收货 = L2（UI 规范 §7）：modal.confirm + danger ok。
                    modal.confirm({
                      title: `确认收货 ${selectedRow.receiptNo}？`,
                      content: '确认后库存立即入账且不可撤销。SN 商品的序列号将写入库存序列表。',
                      okText: '确认收货',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        confirmMutation.mutate(selectedRow.id);
                      },
                    });
                  }}
                >
                  确认收货
                </Button>
                <Button
                  block
                  style={{ marginTop: 8 }}
                  loading={detail.isLoading}
                  onClick={() => {
                    const detailData = detail.data?.data;
                    if (detailData === null || detailData === undefined) {
                      return;
                    }
                    setItems(
                      detailData.items.map((item) => ({
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
                    setEditing(detailData);
                  }}
                >
                  编辑明细
                </Button>
                <Button
                  block
                  danger
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    // 取消草稿 = L2：modal.confirm + danger ok。
                    modal.confirm({
                      title: `取消收货单 ${selectedRow.receiptNo}？`,
                      content: '草稿取消不影响库存。',
                      okText: '取消草稿',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        cancelMutation.mutate(selectedRow.id);
                      },
                    });
                  }}
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
    cancelMutation.mutate,
    modal,
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
          placeholder="收货单号 / 货源说明"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索收货单"
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          options={Object.entries(STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<ReceiptRow>
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 单`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
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
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 100,
              render: (value: string) => {
                const meta = STATUS_META[value] ?? { tone: 'neutral' as const, label: value };
                return <StatusBadge tone={meta.tone} label={meta.label} hint={value} />;
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
        onClose={() => setDetailId(null)}
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
          if (itemsToPayload(items).length === 0) {
            void message.warning('请至少添加一行明细');
            return;
          }
          // Inventory rule (frozen): a warehouse WITH bins requires an
          // explicit binId - surface it here instead of failing at confirm.
          if (
            editorWarehouseId !== undefined &&
            (binsForWarehouse.data?.data?.length ?? 0) > 0 &&
            items.some((item) => item.skuId !== '' && item.binId === undefined)
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
          <Form.Item
            name="warehouseId"
            label="收货仓库"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select options={warehouseOptions} placeholder="选择仓库" />
          </Form.Item>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            将按采购明细的未收数量预填草稿；生成后可在草稿中扫码调整、选库位再确认。
          </span>
        </Form>
      </Modal>
    </div>
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
      const resolved = await resolveBarcode(barcodeToResolve);
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
      const resolved = await resolveBarcode(trimmed);
      if (resolved === null) {
        setBindBarcode(trimmed); // Unknown: offer on-the-spot binding (D13).
        return;
      }
      // Same SKU scanned again: bump the quantity like a counting scanner.
      const existing = items.find((item) => item.skuId === resolved.skuId);
      if (existing !== undefined) {
        setItems(
          items.map((item) =>
            item.skuId === resolved.skuId ? { ...item, quantity: item.quantity + 1 } : item,
          ),
        );
      } else {
        setItems([
          ...items,
          {
            skuId: resolved.skuId,
            label: `${resolved.skuCode} · ${resolved.skuName}`,
            serialTracking: resolved.serialTracking,
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
                min={1}
                value={item.quantity}
                onChange={(value) =>
                  setItems(
                    items.map((row, i) => (i === index ? { ...row, quantity: value ?? 1 } : row)),
                  )
                }
                suffix="件"
                style={{ width: 120 }}
              />
              <InputNumber
                min={0}
                value={item.unitCost}
                placeholder="单位成本"
                status={
                  item.unitCost === undefined || item.unitCost === null ? 'warning' : undefined
                }
                onChange={(value) =>
                  setItems(
                    items.map((row, i) =>
                      i === index ? { ...row, unitCost: value ?? undefined } : row,
                    ),
                  )
                }
                style={{ width: 120 }}
              />
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
