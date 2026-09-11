import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
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
  DeleteConfirmModal,
  EntitySummary,
  FilterBar,
  PageHeader,
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
  itemCount: number;
  totalQuantity: string;
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
}

interface PurchaseOrderDetail extends PurchaseOrderRow {
  items: PurchaseOrderItem[];
}

interface ItemFormValues {
  skuId: string;
  quantity: number;
  unitCost?: number;
}

interface PoFormValues {
  supplierId?: string;
  sourceNote?: string;
  expectedAt?: string;
  remark?: string;
  items: ItemFormValues[];
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

export function PurchaseOrdersPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [cancelling, setCancelling] = useState<PurchaseOrderRow | null>(null);
  const [generateFor, setGenerateFor] = useState<PurchaseOrderRow | null>(null);
  const [generateForm] = Form.useForm<{ warehouseId: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm<PoFormValues>();

  const list = useApiQuery<Envelope<PurchaseOrderRow[]>>(
    '/api/v1/purchase-orders',
    {
      page,
      pageSize: 20,
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
    },
    ['purchase-orders', page, keyword, status],
  );

  const suppliers = useApiQuery<Envelope<Array<{ id: string; code: string; name: string }>>>(
    '/api/v1/suppliers',
    { page: 1, pageSize: 100, status: 'ACTIVE' },
    ['suppliers-for-po'],
  );

  const warehouses = useApiQuery<
    Envelope<Array<{ id: string; warehouseCode: string; name: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-for-po-generate']);

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

  const createMutation = useMutation({
    mutationFn: (values: PoFormValues) =>
      apiPost<{ poNo: string }>('/api/v1/purchase-orders', {
        supplierId: values.supplierId,
        sourceNote: values.sourceNote,
        // datetime-local has no zone: interpret in the operator's local zone.
        expectedAt:
          values.expectedAt !== undefined && values.expectedAt !== ''
            ? new Date(values.expectedAt).toISOString()
            : undefined,
        remark: values.remark,
        items: values.items.map((item) => ({
          skuId: item.skuId,
          quantity: String(item.quantity),
          ...(item.unitCost !== undefined && item.unitCost !== null
            ? { unitCost: String(item.unitCost) }
            : {}),
        })),
      }),
    onSuccess: (result: { poNo: string }) => {
      void message.success(`采购单 ${result.poNo} 已登记`);
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost('/api/v1/purchase-orders/{id}/cancel', { reason: '人工取消' }, { id }),
    onSuccess: () => {
      void message.success('采购单已取消（未影响库存）');
      setCancelling(null);
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-order-detail'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const generateMutation = useMutation({
    mutationFn: ({ poId, warehouseId }: { poId: string; warehouseId: string }) =>
      apiPost<{ id: string; receiptNo: string }>(
        '/api/v1/purchase-receipts/from-po/{poId}',
        { warehouseId },
        { poId },
      ),
    onSuccess: (result) => {
      void message.success(`已生成收货单 ${result.receiptNo}（草稿），前往确认`);
      setGenerateFor(null);
      void queryClient.invalidateQueries({ queryKey: ['purchase-receipts'] });
      void navigate(`/purchase-receipts?focus=${result.id}`);
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ---- Context rail ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="采购概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 单`} />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              采购单登记「已下单」的意图，不碰库存；到货后从采购单生成收货单完成入库。
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
          title={selectedRow.poNo}
          subtitle={selectedRow.supplierName ?? selectedRow.sourceNote ?? '无货源信息'}
          badge={<StatusBadge tone={meta.tone} label={meta.label} hint={selectedRow.status} />}
        />
      ),
      children: (
        <ContextSection title="基本信息">
          <ContextMetric label="供应商" value={selectedRow.supplierName ?? '—'} />
          <ContextMetric label="货源说明" value={selectedRow.sourceNote ?? '—'} />
          <ContextMetric
            label="明细"
            value={`${selectedRow.itemCount} 行 / 共 ${Number(selectedRow.totalQuantity)} 件`}
          />
          <ContextMetric label="下单时间" value={fmtDateTime(selectedRow.orderedAt)} />
          <ContextMetric
            label="预计到货"
            value={selectedRow.expectedAt === null ? '—' : fmtDateTime(selectedRow.expectedAt)}
          />
        </ContextSection>
      ),
    };
  }, [selectedRow, list.data]);
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
              form.setFieldsValue({ items: [{ quantity: 1 }] });
              setCreateOpen(true);
            }}
          >
            登记采购
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="PO号 / 货源说明 / 供应商"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索采购单"
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
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
        <DataTable<PurchaseOrderRow>
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
          emptyTitle="暂无采购单"
          emptyDescription="在缺货订单的详情里点「登记采购」，或在这里登记备货采购。"
          columns={[
            { title: 'PO号', dataIndex: 'poNo', key: 'poNo', width: 120 },
            {
              title: '供应商 / 货源',
              key: 'source',
              render: (_: unknown, row: PurchaseOrderRow) =>
                row.supplierName ?? row.sourceNote ?? '—',
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 110,
              render: (value: string) => {
                const meta = STATUS_META[value] ?? { tone: 'neutral' as const, label: value };
                return <StatusBadge tone={meta.tone} label={meta.label} hint={value} />;
              },
            },
            {
              title: '明细',
              key: 'items',
              width: 110,
              render: (_: unknown, row: PurchaseOrderRow) =>
                `${row.itemCount} 行 / ${Number(row.totalQuantity)} 件`,
            },
            {
              title: '下单时间',
              dataIndex: 'orderedAt',
              key: 'orderedAt',
              width: 160,
              render: (value: string) => fmtDateTime(value),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              fixed: 'right',
              render: (_: unknown, row: PurchaseOrderRow) => (
                <ActionMenu
                  primary={
                    <Button
                      type="link"
                      size="small"
                      style={{ paddingInline: 4 }}
                      onClick={() => setDetailId(row.id)}
                    >
                      查看
                    </Button>
                  }
                  items={[
                    ...(row.status === 'ORDERED'
                      ? [
                          {
                            key: 'cancel',
                            label: '取消采购单',
                            danger: true,
                            onClick: () => setCancelling(row),
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
            {(detailRow.status === 'ORDERED' || detailRow.status === 'PARTIALLY_RECEIVED') && (
              <div style={{ marginBottom: 16 }}>
                <Button type="primary" onClick={() => setGenerateFor(detailRow)}>
                  生成收货单
                </Button>
              </div>
            )}
            <ContextSection title="采购单信息">
              <ContextMetric label="供应商" value={detailRow.supplierName ?? '—'} />
              <ContextMetric label="货源说明" value={detailRow.sourceNote ?? '—'} />
              <ContextMetric label="下单时间" value={fmtDateTime(detailRow.orderedAt)} />
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
                columns={[
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
                    title: '关联订单',
                    dataIndex: 'orderNo',
                    key: 'orderNo',
                    width: 120,
                    render: (value: string | null) => value ?? '备货采购',
                  },
                ]}
              />
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
        width={680}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="supplierId" label="固定供应商（可选）" style={{ flex: 1 }}>
              <Select
                allowClear
                placeholder="选择可复用供应商"
                showSearch
                optionFilterProp="label"
                options={(suppliers.data?.data ?? []).map((supplier) => ({
                  value: supplier.id,
                  label: `${supplier.code} · ${supplier.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="expectedAt" label="预计到货（可选）" style={{ flex: 1 }}>
              <Input type="datetime-local" />
            </Form.Item>
          </div>
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
                      style={{ width: 100, marginBottom: 0 }}
                    >
                      <InputNumber min={1} placeholder="数量" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'unitCost']}
                      style={{ width: 120, marginBottom: 0 }}
                    >
                      <InputNumber min={0} placeholder="单位成本" style={{ width: '100%' }} />
                    </Form.Item>
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
        title={`从 ${generateFor?.poNo ?? ''} 生成收货单`}
        open={generateFor !== null}
        onCancel={() => setGenerateFor(null)}
        onOk={() => {
          void generateForm.validateFields().then((values) => {
            if (generateFor !== null) {
              generateMutation.mutate({ poId: generateFor.id, warehouseId: values.warehouseId });
            }
          });
        }}
        okText="生成草稿"
        cancelText="取消"
        confirmLoading={generateMutation.isPending}
        destroyOnHidden
      >
        <Form form={generateForm} layout="vertical" preserve={false}>
          <Form.Item
            name="warehouseId"
            label="收货仓库"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select
              placeholder="选择仓库"
              options={(warehouses.data?.data ?? []).map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.warehouseCode} · ${warehouse.name}`,
              }))}
            />
          </Form.Item>
          <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
            将按采购明细的未收数量预填草稿；生成后可调整库位与数量再确认。
          </span>
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={cancelling !== null}
        title={`取消采购单 ${cancelling?.poNo ?? ''}？`}
        description="取消的是采购意图，不影响任何库存；该订单行随后可重新登记采购。已发生收货的采购单不能取消。"
        confirmLoading={cancelMutation.isPending}
        onConfirm={() => {
          if (cancelling !== null) {
            cancelMutation.mutate(cancelling.id);
          }
        }}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}

/** SKU picker with server-side keyword search over the master data. */
function SkuSelect(props: { value?: string; onChange?: (value: string) => void }) {
  const [keyword, setKeyword] = useState('');
  const skus = useApiQuery<Envelope<Array<{ id: string; skuCode: string; nameZh: string }>>>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, ...(keyword ? { keyword } : {}) },
    ['skus-for-po', keyword],
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
