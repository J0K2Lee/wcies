import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import { apiDelete, apiPost, useApiQuery } from '../../api/hooks';
import { colors } from '../../design-system';

interface BinRow {
  id: string;
  warehouseId: string;
  binCode: string;
  zone: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
  barcode: string | null;
  status: string;
}

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

/** 库位管理 (task §63/§77): pick a warehouse, browse/search/batch-create bins. */
export function BinsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [zone, setZone] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  const batchValues = Form.useWatch([], batchForm) as Partial<BatchFormValues> | undefined;

  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);
  const bins = useApiQuery<{ data: BinRow[]; meta: { total: number } }>(
    '/api/v1/warehouses/{warehouseId}/bins',
    {
      page,
      pageSize: 50,
      keyword: keyword || undefined,
      ...(zone ? { zone } : {}),
    },
    ['bins', warehouseId, page, keyword, zone],
    { warehouseId: warehouseId ?? '' },
    warehouseId !== undefined,
  );
  const zones = useApiQuery<{ data: string[] }>(
    '/api/v1/warehouses/{warehouseId}/bins/zones',
    {},
    ['bin-zones', warehouseId],
    { warehouseId: warehouseId ?? '' },
    warehouseId !== undefined,
  );
  const selectedWarehouse = (warehouses.data?.data ?? []).find((item) => item.id === warehouseId);
  const batchPreview =
    selectedWarehouse === undefined || batchValues === undefined
      ? null
      : previewBinCodes(selectedWarehouse.warehouseCode, batchValues);

  const invalidateBins = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    void queryClient.invalidateQueries({ queryKey: ['bin-zones', warehouseId] });
  };

  const createMutation = useMutation({
    // warehouseId is a path parameter; sending it in the body fails validation
    // because the DTO does not declare it (forbidNonWhitelisted).
    mutationFn: ({ warehouseId: wid, ...body }: Record<string, string> & { warehouseId: string }) =>
      apiPost('/api/v1/warehouses/{warehouseId}/bins', body, { warehouseId: wid }),
    onSuccess: () => {
      void message.success('库位已创建');
      setCreateOpen(false);
      form.resetFields();
      invalidateBins();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const batchMutation = useMutation({
    mutationFn: (values: BatchFormValues) =>
      apiPost<{ createdCount: number }>('/api/v1/warehouses/{warehouseId}/bins/batch', values, {
        warehouseId: warehouseId ?? '',
      }),
    onSuccess: (data: { createdCount: number }) => {
      void message.success(`已批量创建 ${data.createdCount} 个库位`);
      setBatchOpen(false);
      batchForm.resetFields();
      invalidateBins();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const binStatusMutation = useMutation({
    mutationFn: ({
      warehouseId: wid,
      binId,
      action,
    }: {
      warehouseId: string;
      binId: string;
      action: 'enable' | 'disable';
    }) =>
      apiPost(
        `/api/v1/warehouses/{warehouseId}/bins/{binId}/${action}`,
        {},
        {
          warehouseId: wid,
          binId,
        },
      ),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const binDeleteMutation = useMutation({
    mutationFn: ({ warehouseId: wid, binId }: { warehouseId: string; binId: string }) =>
      apiDelete('/api/v1/warehouses/{warehouseId}/bins/{binId}', { warehouseId: wid, binId }),
    onSuccess: () => {
      void message.success('库位已删除');
      void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const submitCreate = () => {
    if (warehouseId === undefined) {
      void message.error('请先选择仓库');
      return;
    }
    void form.validateFields().then((values) => createMutation.mutate({ ...values, warehouseId }));
  };

  const submitBatch = () => {
    if (warehouseId === undefined) {
      void message.error('请先选择仓库');
      return;
    }
    void batchForm.validateFields().then((values: BatchFormValues) => batchMutation.mutate(values));
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          placeholder="选择仓库"
          style={{ width: 220 }}
          showSearch
          optionFilterProp="label"
          value={warehouseId}
          onChange={(value) => {
            setPage(1);
            setZone(undefined);
            setWarehouseId(value);
          }}
          options={(warehouses.data?.data ?? []).map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.warehouseCode} ${warehouse.name}`,
          }))}
        />
        <Input.Search
          placeholder="搜索库位编码 / 条码"
          allowClear
          disabled={warehouseId === undefined}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder="全部库区"
          style={{ width: 130 }}
          disabled={warehouseId === undefined}
          value={zone}
          onChange={(value: string | undefined) => {
            setPage(1);
            setZone(value);
          }}
          options={(zones.data?.data ?? []).map((item) => ({ value: item, label: item }))}
        />
        <Button
          disabled={warehouseId === undefined}
          onClick={() => {
            batchForm.resetFields();
            setBatchOpen(true);
          }}
        >
          批量创建库位
        </Button>
        <Button
          type="primary"
          disabled={warehouseId === undefined}
          onClick={() => setCreateOpen(true)}
        >
          新建库位
        </Button>
      </Space>

      <Table<BinRow>
        rowKey="id"
        loading={bins.isLoading}
        dataSource={bins.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: bins.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          { title: '库位编码', dataIndex: 'binCode' },
          { title: '区', dataIndex: 'zone', width: 70 },
          { title: '货架', dataIndex: 'rack', width: 80 },
          { title: '层', dataIndex: 'level', width: 70 },
          { title: '位', dataIndex: 'position', width: 70 },
          { title: '条码', dataIndex: 'barcode' },
          {
            title: '状态',
            dataIndex: 'status',
            width: 80,
            render: (value: string) => (
              <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>
                {value === 'ACTIVE' ? '启用' : '停用'}
              </Tag>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 170,
            render: (_: unknown, row: BinRow) => (
              <Space>
                {row.status === 'ACTIVE' ? (
                  <Popconfirm
                    title="确认停用该库位？"
                    onConfirm={() =>
                      binStatusMutation.mutate({
                        warehouseId: row.warehouseId,
                        binId: row.id,
                        action: 'disable',
                      })
                    }
                  >
                    <Button size="small">停用</Button>
                  </Popconfirm>
                ) : (
                  <Button
                    size="small"
                    onClick={() =>
                      binStatusMutation.mutate({
                        warehouseId: row.warehouseId,
                        binId: row.id,
                        action: 'enable',
                      })
                    }
                  >
                    启用
                  </Button>
                )}
                <Popconfirm
                  title="确认删除该库位？"
                  description="仅零引用（无库存/流水）的库位可删除；被引用时会返回具体原因。"
                  onConfirm={() =>
                    binDeleteMutation.mutate({ warehouseId: row.warehouseId, binId: row.id })
                  }
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建库位"
        open={createOpen}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="zone" label="库区">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="rack" label="货架">
              <Input style={{ width: 100 }} placeholder="A01" />
            </Form.Item>
            <Form.Item name="level" label="层">
              <Input style={{ width: 80 }} placeholder="1" />
            </Form.Item>
            <Form.Item name="position" label="位（选填）">
              <Input style={{ width: 100 }} placeholder="01" />
            </Form.Item>
          </Space>
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 0 }}>
            库位编码由系统生成：仓库-货架-层（如 ZG-01-A01-1）。条码与编码相同，扫码可直接识别。
          </p>
        </Form>
      </Modal>

      <Modal
        title={`批量创建库位${selectedWarehouse ? ` — ${selectedWarehouse.warehouseCode}` : ''}`}
        open={batchOpen}
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
              <Input placeholder="如 A（留空则不分区）" style={{ width: 160 }} />
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
                条码与编码相同。
              </div>
            </div>
          )}
        </Form>
      </Modal>
    </Space>
  );
}
