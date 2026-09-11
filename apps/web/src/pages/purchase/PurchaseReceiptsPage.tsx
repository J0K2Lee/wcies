import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime } from '../../utils/format';
import {
  ActionMenu,
  colors,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Purchase receipts (Sprint 7 T4): the REAL receiving action. Confirming a
 * receipt books stock through the inventory core in one transaction - the
 * preview drawer shows exactly what will land in which bin before the
 * irreversible step.
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

interface ItemFormValues {
  skuId: string;
  quantity: number;
  unitCost?: number;
  binId?: string;
}

interface ReceiptFormValues {
  warehouseId: string;
  sourceNote?: string;
  remark?: string;
  items: ItemFormValues[];
}

const STATUS_META: Record<string, { tone: 'info' | 'success' | 'neutral'; label: string }> = {
  DRAFT: { tone: 'info', label: '草稿' },
  RECEIVED: { tone: 'success', label: '已收货' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

type Envelope<T> = { data: T; meta: { total: number } };

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
  const [form] = Form.useForm<ReceiptFormValues>();
  const [fromPoForm] = Form.useForm<{ poId: string; warehouseId: string }>();

  const list = useApiQuery<Envelope<ReceiptRow[]>>(
    '/api/v1/purchase-receipts',
    {
      page,
      pageSize: 20,
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

  const detail = useApiQuery<{ data: ReceiptDetail }>(
    '/api/v1/purchase-receipts/{id}',
    {},
    ['purchase-receipt-detail', detailId],
    { id: detailId ?? '' },
    detailId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = detail.data?.data ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
    void queryClient.invalidateQueries({ queryKey: ['purchase-receipt-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['pos-for-receipt'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: ReceiptFormValues) =>
      apiPost<{ id: string; receiptNo: string }>('/api/v1/purchase-receipts', {
        warehouseId: values.warehouseId,
        sourceNote: values.sourceNote,
        remark: values.remark,
        items: values.items.map((item) => ({
          skuId: item.skuId,
          quantity: String(item.quantity),
          ...(item.unitCost !== undefined && item.unitCost !== null
            ? { unitCost: String(item.unitCost) }
            : {}),
          ...(item.binId ? { binId: item.binId } : {}),
        })),
      }),
    onSuccess: (result) => {
      void message.success(`收货单 ${result.receiptNo} 已创建（草稿，确认后才入账）`);
      setCreateOpen(false);
      form.resetFields();
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
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              收货单确认后才写库存；已确认的收货不可改数量，修正走库存调整。
            </span>
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
            value={selectedRow.receivedAt === null ? '未确认' : fmtDateTime(selectedRow.receivedAt)}
          />
        </ContextSection>
      ),
    };
  }, [selectedRow, list.data]);
  useContextRail(railContent);

  const warehouseOptions = (warehouses.data?.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.warehouseCode} · ${warehouse.name}`,
  }));

  return (
    <div>
      <PageHeader
        title="收货单"
        description="真实收货动作：确认后经库存核心入账并留 PURCHASE_RECEIPT 流水"
        primary={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ items: [{ quantity: 1 }] });
                setCreateOpen(true);
              }}
            >
              新建收货单
            </Button>
            <Button
              onClick={() => {
                fromPoForm.resetFields();
                setFromPoOpen(true);
              }}
            >
              从采购单生成
            </Button>
          </span>
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
            pageSize: 20,
            total: list.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 单`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
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
            {
              title: '操作',
              key: 'actions',
              width: 150,
              fixed: 'right',
              render: (_: unknown, row: ReceiptRow) => (
                <ActionMenu
                  primary={
                    row.status === 'DRAFT' ? (
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingInline: 4 }}
                        onClick={() => setDetailId(row.id)}
                      >
                        预览确认
                      </Button>
                    ) : (
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingInline: 4 }}
                        onClick={() => setDetailId(row.id)}
                      >
                        查看
                      </Button>
                    )
                  }
                  items={[
                    ...(row.status === 'DRAFT'
                      ? [
                          {
                            key: 'cancel',
                            label: '取消草稿',
                            danger: true,
                            onClick: () =>
                              modal.confirm({
                                title: `取消收货单 ${row.receiptNo}？`,
                                content: '草稿取消不影响库存。',
                                onOk: () => cancelMutation.mutate(row.id),
                              }),
                          },
                        ]
                      : []),
                  ]}
                />
              ),
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={820}
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
            {detailRow.status === 'DRAFT' && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <Button
                  type="primary"
                  loading={confirmMutation.isPending}
                  onClick={() => {
                    modal.confirm({
                      title: `确认收货 ${detailRow.receiptNo}？`,
                      content:
                        '确认后库存立即入账且不可撤销；共 ' +
                        detailRow.items.length +
                        ' 行明细。SN 商品的序列号将写入库存序列表。',
                      okText: '确认收货',
                      cancelText: '返回',
                      onOk: () => {
                        confirmMutation.mutate(detailRow.id);
                      },
                    });
                  }}
                >
                  确认收货
                </Button>
                <Button danger onClick={() => cancelMutation.mutate(detailRow.id)}>
                  取消草稿
                </Button>
              </div>
            )}
          </>
        )}
      </Drawer>

      <Modal
        title="新建收货单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="创建草稿"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="warehouseId"
            label="收货仓库"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select options={warehouseOptions} placeholder="选择仓库" />
          </Form.Item>
          <Form.Item name="sourceNote" label="货源说明（一次性网购）">
            <Input maxLength={500} placeholder="如：淘宝 订单号 12345678" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={2000} />
          </Form.Item>
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
                      <SkuSelect />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'quantity']}
                      rules={[{ required: true, message: '数量' }]}
                      style={{ width: 90, marginBottom: 0 }}
                    >
                      <InputNumber min={1} placeholder="数量" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'unitCost']}
                      style={{ width: 110, marginBottom: 0 }}
                    >
                      <InputNumber min={0} placeholder="单位成本" style={{ width: '100%' }} />
                    </Form.Item>
                    <span
                      style={{
                        width: 130,
                        fontSize: 12,
                        color: colors.textTertiary,
                        lineHeight: '22px',
                      }}
                    >
                      库位在确认前可补选
                    </span>
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
        </Form>
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
            生成后可在草稿明细中为每行指定库位（含暂存位）；留空时无库位仓库自动落 DEFAULT。
          </span>
        </Form>
      </Modal>
    </div>
  );
}

/** SKU picker with server-side keyword search over the master data. */
function SkuSelect(props: { value?: string; onChange?: (value: string) => void }) {
  const [keyword, setKeyword] = useState('');
  const skus = useApiQuery<Envelope<Array<{ id: string; skuCode: string; nameZh: string }>>>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, ...(keyword ? { keyword } : {}) },
    ['skus-for-receipt', keyword],
  );
  return (
    <Select
      {...props}
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
  );
}
