import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiDelete, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime } from '../../utils/format';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  ErrorState,
  FilterBar,
  PageHeader,
  SectionCard,
  FULFILLMENT_MODE_LABEL,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Warehouses workbench (Phase 2 task §27): list + context rail + detail
 * drawer. Existing Sprint CRUD (create warehouse, batch-create bins) is
 * preserved unchanged.
 */

interface WarehouseRow {
  id: string;
  warehouseCode: string;
  name: string;
  warehouseType: string;
  countryCode: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  remark: string | null;
  status: string;
  binCount: number;
  boundStoreCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BinRow {
  id: string;
  binCode: string;
  zone: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
  barcode: string | null;
  status: string;
}

interface BindingRow {
  storeCode: string;
  fulfillmentMode: string;
  status: string;
}

const TYPE_LABEL: Record<string, string> = {
  SELF: '自管仓',
  PLATFORM: '平台仓',
  THIRD_PARTY: '第三方仓',
  RETURN_TEMP: '退货暂存仓',
};

/** Layout intent the server turns into bin codes (server owns the format). */
interface BatchFormValues {
  zone?: string;
  rackStart: number;
  rackCount: number;
  levelsPerRack: number;
}

/**
 * Mirrors the server's code rule so the dialog can preview exactly what will
 * be created: rack numbers pad to at least two digits, levels stay plain.
 */
function previewBinCodes(
  warehouseCode: string,
  values: Partial<BatchFormValues>,
): { first: string; last: string; total: number } | null {
  const { rackStart, rackCount, levelsPerRack } = values;
  if (
    rackStart === undefined ||
    rackCount === undefined ||
    levelsPerRack === undefined ||
    rackCount < 1 ||
    levelsPerRack < 1
  ) {
    return null;
  }
  const zone = values.zone?.trim() ?? '';
  const lastRack = rackStart + rackCount - 1;
  const width = Math.max(2, String(lastRack).length);
  const pad = (value: number): string => String(value).padStart(width, '0');
  return {
    first: `${warehouseCode}-${zone}${pad(rackStart)}-1`,
    last: `${warehouseCode}-${zone}${pad(lastRack)}-${levelsPerRack}`,
    total: rackCount * levelsPerRack,
  };
}

type Envelope<T> = { data: T; meta: { total: number } };

export function WarehousesPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [warehouseType, setWarehouseType] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  // Id snapshot taken when the batch modal opens: the drawer's onClose may
  // null out detailId while the modal is still open (decision: modal chain
  // fix) - submissions must never send an empty path parameter.
  const [batchWarehouseId, setBatchWarehouseId] = useState<string | null>(null);
  const [binZone, setBinZone] = useState<string | undefined>();
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  // Live values drive the modal's "what will be created" preview.
  const batchValues = Form.useWatch([], batchForm) as Partial<BatchFormValues> | undefined;

  const list = useApiQuery<Envelope<WarehouseRow[]>>(
    '/api/v1/warehouses',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(warehouseType ? { warehouseType } : {}),
    },
    ['warehouses', page, keyword, warehouseType],
  );

  const focusId = selectedId ?? detailId;
  const detail = useApiQuery<{ data: WarehouseRow }>(
    '/api/v1/warehouses/{id}',
    {},
    ['warehouse-detail', focusId],
    { id: focusId ?? '' },
    focusId !== null,
  );
  const warehouse = detail.data?.data;
  const bins = useApiQuery<Envelope<BinRow[]>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 50, ...(binZone ? { zone: binZone } : {}) },
    ['warehouse-bins', detailId, binZone],
    { warehouseId: detailId ?? '' },
    detailId !== null,
  );
  const binZones = useApiQuery<{ data: string[] }>(
    '/api/v1/warehouses/{warehouseId}/bins/zones',
    {},
    ['bin-zones', detailId],
    { warehouseId: detailId ?? '' },
    detailId !== null,
  );
  const batchPreview = useMemo(
    () =>
      warehouse === undefined || batchValues === undefined
        ? null
        : previewBinCodes(warehouse.warehouseCode, batchValues),
    [warehouse, batchValues],
  );
  const bindings = useApiQuery<Envelope<BindingRow[]>>(
    '/api/v1/warehouse-bindings',
    { warehouseId: detailId ?? undefined, page: 1, pageSize: 50 },
    ['warehouse-bindings', detailId],
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = useMemo(
    () => rows.find((row) => row.id === detailId) ?? null,
    [rows, detailId],
  );

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiPost('/api/v1/warehouses', values),
    onSuccess: () => {
      void message.success('仓库已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/warehouses/{id}/${action}`, {}, { id }),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/warehouses/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('仓库已删除');
      if (detailId === id) {
        setDetailId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const batchMutation = useMutation({
    // warehouseId travels in the path only: the DTO has no such property and
    // forbidNonWhitelisted rejects the request body outright when it appears.
    mutationFn: ({ warehouseId, ...body }: BatchFormValues & { warehouseId: string }) =>
      apiPost<{ createdCount: number; bins: BinRow[] }>(
        '/api/v1/warehouses/{warehouseId}/bins/batch',
        body,
        { warehouseId },
      ),
    onSuccess: (data: { createdCount: number }) => {
      void message.success(`已批量创建 ${data.createdCount} 个库位`);
      setBatchOpen(false);
      batchForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['warehouse-bins', batchWarehouseId] });
      void queryClient.invalidateQueries({ queryKey: ['bin-zones', batchWarehouseId] });
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const openBatchModal = (warehouseId: string) => {
    setBatchWarehouseId(warehouseId);
    batchForm.resetFields();
    setBatchOpen(true);
  };

  const submitBatch = () => {
    if (batchWarehouseId === null) {
      void message.error('仓库上下文丢失，请重新打开后重试');
      return;
    }
    void batchForm
      .validateFields()
      .then((values) => batchMutation.mutate({ ...values, warehouseId: batchWarehouseId }));
  };

  // ---- Context rail (task §27): 基本信息 + 库存摘要 ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="仓库概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 个仓库`} />
            <ContextMetric
              label="库位总数（本页）"
              value={rows.reduce((sum, row) => sum + row.binCount, 0)}
            />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击仓库行查看库位、绑定店铺等信息。
            </span>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.name}
          subtitle={selectedRow.warehouseCode}
          badge={
            <StatusBadge
              tone={selectedRow.status === 'ACTIVE' ? 'success' : 'neutral'}
              label={selectedRow.status === 'ACTIVE' ? '启用' : '停用'}
              hint={selectedRow.status}
            />
          }
          meta={
            <span style={{ fontSize: 13, color: colors.textSecondary }}>
              {TYPE_LABEL[selectedRow.warehouseType] ?? selectedRow.warehouseType}
              {selectedRow.city !== null ? ` · ${selectedRow.city}` : ''}
            </span>
          }
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="仓库编码" value={selectedRow.warehouseCode} />
            <ContextMetric
              label="类型"
              value={TYPE_LABEL[selectedRow.warehouseType] ?? selectedRow.warehouseType}
            />
            <ContextMetric label="国家" value={selectedRow.countryCode ?? '—'} />
            <ContextMetric label="城市" value={selectedRow.city ?? '—'} />
          </ContextSection>
          <ContextSection title="库存摘要">
            <ContextMetric label="库位数量" value={selectedRow.binCount} strong />
            <ContextMetric label="绑定店铺" value={`${selectedRow.boundStoreCount} 家`} />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情与库位
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, rows]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="仓库管理"
        description="管理自管仓、平台仓等仓库档案、库位与店铺绑定"
        secondary={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['warehouses'] })}
          >
            刷新
          </Button>
        }
        primary={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建仓库
          </Button>
        }
      />

      <FilterBar>
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 140 }}
          value={warehouseType}
          onChange={(value) => {
            setPage(1);
            setWarehouseType(value);
          }}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Input.Search
          placeholder="搜索仓库编码 / 名称 / 城市"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['warehouses'] })}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<WarehouseRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            emptyTitle="暂无仓库"
            emptyDescription="点击右上角新建仓库"
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            columns={[
              {
                title: '仓库',
                key: 'warehouse',
                render: (_: unknown, row: WarehouseRow) => (
                  <div>
                    <div style={{ fontWeight: 550 }}>{row.name}</div>
                    <div style={{ fontSize: 12.5, color: colors.textTertiary }}>
                      {row.warehouseCode}
                    </div>
                  </div>
                ),
              },
              {
                title: '类型',
                dataIndex: 'warehouseType',
                key: 'type',
                width: 120,
                render: (value: string) => TYPE_LABEL[value] ?? value,
              },
              {
                title: '国家',
                dataIndex: 'countryCode',
                key: 'country',
                width: 76,
                render: (v: string | null) => v ?? '—',
              },
              {
                title: '城市',
                dataIndex: 'city',
                key: 'city',
                width: 110,
                render: (v: string | null) => v ?? '—',
              },
              {
                title: '库位',
                dataIndex: 'binCount',
                key: 'bins',
                width: 80,
                align: 'right' as const,
              },
              {
                title: '绑定店铺',
                dataIndex: 'boundStoreCount',
                key: 'stores',
                width: 96,
                align: 'right' as const,
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 90,
                render: (value: string) => (
                  <StatusBadge
                    tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                    label={value === 'ACTIVE' ? '启用' : '停用'}
                    hint={value}
                  />
                ),
              },
              {
                title: '操作',
                key: 'actions',
                width: 76,
                render: (_: unknown, row: WarehouseRow) => (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailId(row.id);
                    }}
                  >
                    详情
                  </Button>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      {/* ---- Create warehouse modal (existing flow) ---- */}
      <Modal
        title="新建仓库"
        open={createOpen}
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
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
            仓库编码创建后自动生成（按类型递增：ZG/PT/SF/TH-序号），类型创建后不可修改。
          </p>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 深圳自管仓" />
          </Form.Item>
          <Form.Item
            name="warehouseType"
            label="类型"
            rules={[{ required: true }]}
            initialValue="SELF"
          >
            <Select
              options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Space wrap>
            <Form.Item name="countryCode" label="国家">
              <Input style={{ width: 100 }} placeholder="CN" />
            </Form.Item>
            <Form.Item name="province" label="省份">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="联系人">
            <Input style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="contactPhone" label="联系电话">
            <Input style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Warehouse detail drawer (task §27) ---- */}
      <Drawer
        title={detailRow !== null ? `${detailRow.name}（${detailRow.warehouseCode}）` : '仓库详情'}
        size={720}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        destroyOnHidden
        extra={
          detailRow !== null && (
            <Space>
              {detailRow.status !== 'ACTIVE' ? (
                <Button
                  type="primary"
                  onClick={() => statusMutation.mutate({ id: detailRow.id, action: 'activate' })}
                >
                  启用
                </Button>
              ) : (
                <Popconfirm
                  title="确认停用该仓库？"
                  onConfirm={() =>
                    statusMutation.mutate({ id: detailRow.id, action: 'deactivate' })
                  }
                >
                  <Button danger>停用</Button>
                </Popconfirm>
              )}
              <Popconfirm
                title="确认删除该仓库？"
                description="仅零引用（无库位/绑定/库存）的仓库可删除；被引用时会返回具体原因。"
                onConfirm={() => deleteMutation.mutate(detailRow.id)}
              >
                <Button danger>删除</Button>
              </Popconfirm>
            </Space>
          )
        }
      >
        {detailRow !== null && (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <section>
              <SectionTitle>基本信息</SectionTitle>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                <Field label="仓库编码" value={detailRow.warehouseCode} />
                <Field label="名称" value={detailRow.name} />
                <Field
                  label="类型"
                  value={TYPE_LABEL[detailRow.warehouseType] ?? detailRow.warehouseType}
                />
                <Field
                  label="状态"
                  value={
                    <StatusBadge
                      tone={detailRow.status === 'ACTIVE' ? 'success' : 'neutral'}
                      label={detailRow.status === 'ACTIVE' ? '启用' : '停用'}
                      hint={detailRow.status}
                    />
                  }
                />
                <Field
                  label="国家 / 城市"
                  value={`${detailRow.countryCode ?? '—'} / ${detailRow.city ?? '—'}`}
                />
                <Field label="联系人" value={detailRow.contactName ?? '—'} />
                <Field label="联系电话" value={detailRow.contactPhone ?? '—'} />
                <Field label="创建时间" value={fmtDateTime(detailRow.createdAt)} />
                <Field label="库位数量" value={`${detailRow.binCount}`} />
                <Field label="绑定店铺" value={`${detailRow.boundStoreCount} 家`} />
              </div>
            </section>

            <section>
              <SectionTitle
                action={
                  <Space>
                    <Select
                      size="small"
                      allowClear
                      placeholder="全部库区"
                      style={{ width: 120 }}
                      value={binZone}
                      onChange={(value: string | undefined) => setBinZone(value)}
                      options={(binZones.data?.data ?? []).map((zone) => ({
                        value: zone,
                        label: zone,
                      }))}
                    />
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => detailRow !== null && openBatchModal(detailRow.id)}
                    >
                      批量创建库位
                    </Button>
                  </Space>
                }
              >
                库位（{warehouse?.binCount ?? bins.data?.meta.total ?? 0}）
              </SectionTitle>
              <DataTable<BinRow>
                rowKey="id"
                size="small"
                loading={bins.isLoading}
                dataSource={bins.data?.data ?? []}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                emptyTitle="暂无库位"
                columns={[
                  { title: '库位编码', dataIndex: 'binCode' },
                  {
                    title: '区',
                    dataIndex: 'zone',
                    width: 70,
                    render: (v: string | null) => v ?? '—',
                  },
                  {
                    title: '架',
                    dataIndex: 'rack',
                    width: 80,
                    render: (v: string | null) => v ?? '—',
                  },
                  {
                    title: '层',
                    dataIndex: 'level',
                    width: 70,
                    render: (v: string | null) => v ?? '—',
                  },
                  { title: '条码', dataIndex: 'barcode', render: (v: string | null) => v ?? '—' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 80,
                    render: (value: string) => (
                      <StatusBadge
                        tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                        label={value === 'ACTIVE' ? '启用' : value}
                        hint={value}
                      />
                    ),
                  },
                ]}
              />
            </section>

            <section>
              <SectionTitle
                action={
                  <Button
                    size="small"
                    onClick={() => {
                      void navigate(`/store-bindings?warehouseId=${detailRow.id}`);
                    }}
                  >
                    管理绑定
                  </Button>
                }
              >
                绑定店铺
              </SectionTitle>
              <DataTable<BindingRow>
                rowKey="storeCode"
                size="small"
                loading={bindings.isLoading}
                dataSource={bindings.data?.data ?? []}
                pagination={false}
                emptyTitle="暂无店铺绑定"
                columns={[
                  { title: '店铺编码', dataIndex: 'storeCode' },
                  {
                    title: '履约模式',
                    dataIndex: 'fulfillmentMode',
                    render: (value: string) => FULFILLMENT_MODE_LABEL[value] ?? value,
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 90,
                    render: (value: string) => (
                      <StatusBadge
                        tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                        label={value === 'ACTIVE' ? '启用' : value}
                        hint={value}
                      />
                    ),
                  },
                ]}
              />
            </section>
          </Space>
        )}
      </Drawer>

      {/* ---- Batch create bins modal: layout intent in, codes out ---- */}
      <Modal
        title={`批量创建库位 — ${detailRow?.warehouseCode ?? ''}`}
        open={batchOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            batchForm.resetFields();
          }
        }}
        onCancel={() => setBatchOpen(false)}
        onOk={submitBatch}
        confirmLoading={batchMutation.isPending}
      >
        <Form form={batchForm} layout="vertical">
          <Space wrap>
            <Form.Item
              name="zone"
              label="库区"
              rules={[{ max: 20, message: '库区最多 20 个字符' }]}
            >
              <Input placeholder="如 A（留空则不分区）" style={{ width: 170 }} />
            </Form.Item>
            <Form.Item
              name="rackStart"
              label="起始货架号"
              rules={[{ required: true, message: '请输入起始货架号' }]}
              initialValue={1}
            >
              <InputNumber min={1} max={9999} precision={0} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item
              name="rackCount"
              label="货架数量"
              rules={[{ required: true, message: '请输入货架数量' }]}
              initialValue={5}
            >
              <InputNumber min={1} max={2000} precision={0} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item
              name="levelsPerRack"
              label="每架层数"
              rules={[{ required: true, message: '请输入每架层数' }]}
              initialValue={4}
            >
              <InputNumber min={1} max={999} precision={0} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          {batchPreview === null ? (
            <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 0 }}>
              库位编码由系统生成，格式为 仓库-货架-层（如
              ZG-01-A05-1）。同一仓库内重复编码会被拒绝。
            </p>
          ) : (
            <div
              style={{
                background: colors.canvas,
                border: `1px solid ${colors.borderSoft}`,
                borderRadius: 6,
                padding: '10px 12px',
              }}
            >
              <div style={{ fontSize: 13, color: colors.textPrimary }}>
                将创建 <strong>{batchPreview.total}</strong> 个库位：
                <span style={{ marginLeft: 6, fontFamily: 'monospace' }}>{batchPreview.first}</span>
                {batchPreview.total > 1 && (
                  <>
                    <span style={{ margin: '0 6px', color: colors.textTertiary }}>…</span>
                    <span style={{ fontFamily: 'monospace' }}>{batchPreview.last}</span>
                  </>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: colors.textTertiary, marginTop: 6 }}>
                货架从第 {batchForm.getFieldValue('rackStart') as number} 号开始
                {batchForm.getFieldValue('zone')
                  ? `（区 ${String(batchForm.getFieldValue('zone'))}）`
                  : ''}
                ；每架 {batchForm.getFieldValue('levelsPerRack') as number} 层。条码与编码相同。
              </div>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
      }}
    >
      <span style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary }}>{children}</span>
      {action}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '9px 16px 9px 0',
        borderBottom: `1px solid ${colors.borderSoft}`,
      }}
    >
      <span style={{ fontSize: 12.5, color: colors.textTertiary }}>{label}</span>
      <span style={{ fontSize: 13.5, color: colors.textPrimary, wordBreak: 'break-word' }}>
        {value}
      </span>
    </div>
  );
}
