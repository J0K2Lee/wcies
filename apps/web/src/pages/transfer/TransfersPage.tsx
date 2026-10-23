import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Drawer, Form, Input, InputNumber, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime } from '../../utils/format';
import {
  CopyTextButton,
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
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';
import { TRANSFER_STATUS_META } from '../../design-system';

/**
 * Warehouse transfers (Sprint 10 T6, transfer.md): DRAFT registration with
 * per-line bins, then a single-transaction confirmation that moves stock
 * through both inventory legs. Any failure rolls the whole order back.
 */

interface TransferRow {
  id: string;
  transferNo: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  status: string;
  remark: string | null;
  createdAt: string;
  linesCount: number;
}

interface TransferLine {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  quantity: string;
  fromBinCode: string | null;
  toBinCode: string | null;
  outEventNo: string | null;
  inEventNo: string | null;
}

interface TransferDetail extends TransferRow {
  lines: TransferLine[];
}

interface LineFormValues {
  skuId: string;
  quantity: number;
  fromBinId?: string;
  toBinId?: string;
}

interface TransferFormValues {
  fromWarehouseId: string;
  toWarehouseId: string;
  remark?: string;
  lines: LineFormValues[];
}

type Envelope<T> = { data: T; meta: { total: number } };

export function TransfersPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<TransferFormValues>();

  const list = useApiQuery<Envelope<TransferRow[]>>(
    '/api/v1/transfers',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
    },
    ['transfers', page, keyword, status],
  );

  const warehouses = useApiQuery<
    Envelope<Array<{ id: string; name: string; warehouseCode: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-for-transfer']);

  const detail = useApiQuery<{ data: TransferDetail }>(
    '/api/v1/transfers/{id}',
    {},
    ['transfer-detail', detailId],
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
    mutationFn: (values: TransferFormValues) =>
      apiPost<{ transferNo: string }>('/api/v1/transfers', {
        fromWarehouseId: values.fromWarehouseId,
        toWarehouseId: values.toWarehouseId,
        ...(values.remark ? { remark: values.remark } : {}),
        lines: values.lines.map((line) => ({
          skuId: line.skuId,
          quantity: String(line.quantity),
          ...(line.fromBinId ? { fromBinId: line.fromBinId } : {}),
          ...(line.toBinId ? { toBinId: line.toBinId } : {}),
        })),
      }),
    onSuccess: (result) => {
      void message.success(`调拨单 ${result.transferNo} 已登记（草稿）`);
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/transfers/{id}/confirm', {}, { id }),
    onSuccess: () => {
      void message.success('调拨已确认，库存已双段移动');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
      void queryClient.invalidateQueries({ queryKey: ['transfer-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/transfers/{id}/cancel', {}, { id }),
    onSuccess: () => {
      void message.success('调拨单已取消（未影响库存）');
      void queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="调拨概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 单`} />
            <RailHint>
              确认调拨会在一个数据库事务里完成「源库位出库 +
              目标库位入库」；被订单占用的库存不可调拨。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const meta = TRANSFER_STATUS_META[selectedRow.status];
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.transferNo}
          subtitle={`${selectedRow.fromWarehouseName ?? '—'} → ${selectedRow.toWarehouseName ?? '—'}`}
          badge={
            <StatusBadge
              tone={meta?.tone ?? 'neutral'}
              label={meta?.label ?? selectedRow.status}
              hint={selectedRow.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="源仓库" value={selectedRow.fromWarehouseName ?? '—'} />
            <ContextMetric label="目标仓库" value={selectedRow.toWarehouseName ?? '—'} />
            <ContextMetric label="明细行数" value={`${selectedRow.linesCount} 行`} />
            <ContextMetric label="登记时间" value={fmtDateTime(selectedRow.createdAt)} />
            <ContextMetric label="备注" value={selectedRow.remark ?? '—'} />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            {selectedRow.status === 'DRAFT' && (
              <>
                <Button
                  block
                  type="primary"
                  style={{ marginTop: 8 }}
                  loading={confirmMutation.isPending}
                  onClick={() => {
                    // 正式移库 = L2 强确认（UI 规范 §7：确认收货/正式出库同级）。
                    modal.confirm({
                      title: `确认调拨 ${selectedRow.transferNo}？`,
                      content:
                        '全部行将在一个事务内完成「源库位出库 + 目标库位入库」；任一行可售库存不足则整单失败回滚。确认后不可撤销。',
                      okText: '确认调拨',
                      cancelText: '返回',
                      onOk: () => {
                        confirmMutation.mutate(selectedRow.id);
                      },
                    });
                  }}
                >
                  确认调拨
                </Button>
                <Button
                  block
                  danger
                  style={{ marginTop: 8 }}
                  loading={cancelMutation.isPending}
                  onClick={() => {
                    modal.confirm({
                      title: `取消调拨单 ${selectedRow.transferNo}？`,
                      content: '草稿取消不影响任何库存。',
                      okText: '取消调拨单',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        cancelMutation.mutate(selectedRow.id);
                      },
                    });
                  }}
                >
                  取消调拨单
                </Button>
              </>
            )}
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, modal, confirmMutation.isPending, cancelMutation.isPending]);

  useContextRail(railContent);

  const watchedFrom = Form.useWatch('fromWarehouseId', form);
  const watchedTo = Form.useWatch('toWarehouseId', form);

  return (
    <div>
      <PageHeader
        title="调拨单"
        description="仓库之间的库存调拨：草稿登记明细，确认时单事务完成双段移库（transfer.md）"
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ lines: [{ quantity: 1 }] });
              setCreateOpen(true);
            }}
          >
            登记调拨
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="调拨单号"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 220 }}
          aria-label="搜索调拨单"
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          options={Object.entries(TRANSFER_STATUS_META).map(([value, meta]) => ({
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
        <DataTable<TransferRow>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
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
          emptyTitle="暂无调拨"
          emptyDescription="登记一张调拨单，把库存从源仓库移到目标仓库。"
          columns={[
            { title: '调拨单号', dataIndex: 'transferNo', key: 'transferNo', width: 120 },
            {
              title: '路径',
              key: 'route',
              render: (_: unknown, row: TransferRow) =>
                `${row.fromWarehouseName ?? '—'} → ${row.toWarehouseName ?? '—'}`,
            },
            {
              title: '明细',
              dataIndex: 'linesCount',
              key: 'linesCount',
              width: 80,
              align: 'right' as const,
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 100,
              render: (value: string) => {
                const meta = TRANSFER_STATUS_META[value];
                return (
                  <StatusBadge
                    tone={meta?.tone ?? 'neutral'}
                    label={meta?.label ?? value}
                    hint={value}
                    showDot={false}
                  />
                );
              },
            },
            {
              title: '登记时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailId !== null && detailRow !== null}
        onClose={() => setDetailId(null)}
        size={760}
        title={
          detailRow !== null && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>{detailRow.transferNo}</span>
          )
        }
        extra={
          detailRow !== null && (
            <StatusBadge
              tone={TRANSFER_STATUS_META[detailRow.status]?.tone ?? 'neutral'}
              label={TRANSFER_STATUS_META[detailRow.status]?.label ?? detailRow.status}
              hint={detailRow.status}
            />
          )
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== null && (
          <>
            <ContextSection title="调拨信息">
              <ContextMetric
                label="路径"
                value={`${detailRow.fromWarehouseName ?? '—'} → ${detailRow.toWarehouseName ?? '—'}`}
              />
              <ContextMetric
                label="状态"
                value={TRANSFER_STATUS_META[detailRow.status]?.label ?? detailRow.status}
              />
              <ContextMetric label="登记时间" value={fmtDateTime(detailRow.createdAt)} />
              <ContextMetric label="备注" value={detailRow.remark ?? '—'} />
            </ContextSection>
            <SectionCard title="明细" flush>
              <DataTable<TransferLine>
                rowKey="id"
                dataSource={detailRow.lines}
                pagination={false}
                emptyTitle="无明细"
                columns={[
                  {
                    title: 'SKU',
                    key: 'sku',
                    render: (_: unknown, row: TransferLine) => (
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
                  },
                  {
                    title: '源库位',
                    dataIndex: 'fromBinCode',
                    key: 'fromBinCode',
                    width: 100,
                    render: (value: string | null) => value ?? '默认',
                  },
                  {
                    title: '目标库位',
                    dataIndex: 'toBinCode',
                    key: 'toBinCode',
                    width: 100,
                    render: (value: string | null) => value ?? '默认',
                  },
                  {
                    title: '库存事件',
                    key: 'events',
                    render: (_: unknown, row: TransferLine) =>
                      row.outEventNo === null ? '—' : `${row.outEventNo} / ${row.inEventNo ?? '—'}`,
                  },
                ]}
              />
            </SectionCard>
          </>
        )}
      </Drawer>

      <Modal
        title="登记调拨单"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="登记"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item
              name="fromWarehouseId"
              label="源仓库"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请选择源仓库' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="库存从哪里调出"
                options={(warehouses.data?.data ?? []).map((warehouse) => ({
                  value: warehouse.id,
                  label: `${warehouse.warehouseCode} · ${warehouse.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="toWarehouseId"
              label="目标仓库"
              style={{ flex: 1 }}
              rules={[
                { required: true, message: '请选择目标仓库' },
                ({ getFieldValue }) => ({
                  validator: (_rule, value: string | undefined) =>
                    value !== undefined && value === getFieldValue('fromWarehouseId')
                      ? Promise.reject(new Error('目标仓库不能与源仓库相同'))
                      : Promise.resolve(),
                }),
              ]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="库存调到哪里"
                options={(warehouses.data?.data ?? []).map((warehouse) => ({
                  value: warehouse.id,
                  label: `${warehouse.warehouseCode} · ${warehouse.name}`,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="remark" label="备注">
            <Input maxLength={2000} placeholder="如：补货深圳仓" />
          </Form.Item>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <div
                    key={field.key}
                    style={{
                      display: 'flex',
                      gap: 8,
                      marginBottom: 8,
                      alignItems: 'center',
                    }}
                  >
                    <Form.Item
                      name={[field.name, 'skuId']}
                      rules={[{ required: true, message: '请选择 SKU' }]}
                      style={{ flex: 1.4, marginBottom: 0 }}
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
                      name={[field.name, 'fromBinId']}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <BinSelect warehouseId={watchedFrom} placeholder="源库位（默认）" />
                    </Form.Item>
                    <Form.Item name={[field.name, 'toBinId']} style={{ flex: 1, marginBottom: 0 }}>
                      <BinSelect warehouseId={watchedTo} placeholder="目标库位（默认）" />
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
    </div>
  );
}

/** SKU picker with server-side keyword search (same pattern as PO page). */
function SkuSelect(props: { value?: string; onChange?: (value: string) => void }) {
  const [keyword, setKeyword] = useState('');
  const skus = useApiQuery<Envelope<Array<{ id: string; skuCode: string; nameZh: string }>>>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, ...(keyword ? { keyword } : {}) },
    ['skus-for-transfer', keyword],
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

/** Bin picker scoped to one warehouse (empty = that warehouse's default bin). */
function BinSelect(props: {
  value?: string;
  onChange?: (value: string) => void;
  warehouseId?: string;
  placeholder?: string;
}) {
  const { warehouseId, ...selectProps } = props;
  const bins = useApiQuery<Envelope<Array<{ id: string; binCode: string }>>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 100 },
    ['bins-for-transfer', warehouseId ?? ''],
    { warehouseId: warehouseId ?? '' },
    warehouseId !== undefined && warehouseId !== '',
  );
  return (
    <Select
      {...selectProps}
      allowClear
      showSearch
      optionFilterProp="label"
      placeholder={props.placeholder ?? '库位'}
      options={(bins.data?.data ?? []).map((bin) => ({ value: bin.id, label: bin.binCode }))}
      loading={bins.isLoading}
      disabled={warehouseId === undefined || warehouseId === ''}
    />
  );
}
