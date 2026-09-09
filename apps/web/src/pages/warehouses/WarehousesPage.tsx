import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';

interface WarehouseRow {
  id: string;
  warehouseCode: string;
  name: string;
  warehouseType: string;
  countryCode: string | null;
  city: string | null;
  status: string;
  binCount: number;
  boundStoreCount: number;
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

const TYPE_LABEL: Record<string, string> = {
  SELF: '自管仓',
  PLATFORM: '平台仓',
  THIRD_PARTY: '第三方仓',
  RETURN_TEMP: '退货暂存仓',
};

export function WarehousesPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [warehouseType, setWarehouseType] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();

  const list = useApiQuery<{ data: WarehouseRow[]; meta: { total: number } }>(
    '/api/v1/warehouses',
    { page, pageSize: 50, keyword: keyword || undefined, warehouseType },
    ['warehouses', page, keyword, warehouseType],
  );

  const detail = useApiQuery<{ data: WarehouseRow }>(
    '/api/v1/warehouses/{id}',
    {},
    ['warehouse-detail', detailId],
    {
      id: detailId ?? '',
    },
    detailId !== null,
  );
  const warehouse = detail.data?.data;
  const bins = useApiQuery<{ data: BinRow[]; meta: { total: number } }>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 50 },
    ['warehouse-bins', detailId],
    { warehouseId: detailId ?? '' },
    detailId !== null,
  );
  const bindings = useApiQuery<{
    data: Array<{ storeCode: string; fulfillmentMode: string; status: string }>;
  }>('/api/v1/warehouse-bindings', { warehouseId: detailId ?? undefined, page: 1, pageSize: 50 }, [
    'warehouse-bindings',
    detailId,
  ]);

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

  const batchMutation = useMutation({
    mutationFn: (values: Record<string, string>) =>
      apiPost<{ createdCount: number }>('/api/v1/warehouses/{warehouseId}/bins/batch', values, {
        warehouseId: detailId ?? '',
      }),
    onSuccess: (data: { createdCount: number }) => {
      void message.success(`已批量创建 ${data.createdCount} 个库位`);
      setBatchOpen(false);
      batchForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['warehouse-bins', detailId] });
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Input.Search
          placeholder="搜索仓库编码 / 名称 / 城市"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 130 }}
          onChange={(value) => {
            setPage(1);
            setWarehouseType(value);
          }}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建仓库
        </Button>
      </Space>

      <Table<WarehouseRow>
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: list.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        onRow={(record) => ({
          onClick: () => setDetailId(record.id),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: '仓库编码', dataIndex: 'warehouseCode' },
          { title: '名称', dataIndex: 'name' },
          { title: '类型', dataIndex: 'warehouseType', render: (v: string) => TYPE_LABEL[v] ?? v },
          { title: '国家', dataIndex: 'countryCode', width: 70 },
          { title: '城市', dataIndex: 'city' },
          { title: '库位数', dataIndex: 'binCount', width: 80 },
          { title: '绑定店铺数', dataIndex: 'boundStoreCount', width: 100 },
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
        ]}
      />

      <Modal
        title="新建仓库"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="warehouseCode" label="仓库编码" rules={[{ required: true }]}>
            <Input placeholder="如 SZ01" />
          </Form.Item>
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
        </Form>
      </Modal>

      <Drawer
        title={warehouse ? `${warehouse.warehouseCode} ${warehouse.name}` : '仓库详情'}
        width={760}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Descriptions
            column={2}
            size="small"
            items={[
              { key: 'code', label: '编码', children: warehouse?.warehouseCode },
              {
                key: 'type',
                label: '类型',
                children: warehouse ? (TYPE_LABEL[warehouse.warehouseType] ?? '') : '',
              },
              { key: 'city', label: '城市', children: warehouse?.city ?? '-' },
              { key: 'bins', label: '库位数', children: warehouse?.binCount ?? 0 },
            ]}
          />
          <Space>
            <Button size="small" type="primary" onClick={() => setBatchOpen(true)}>
              批量创建库位
            </Button>
          </Space>
          <Table<BinRow>
            rowKey="id"
            size="small"
            dataSource={bins.data?.data ?? []}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              { title: '库位编码', dataIndex: 'binCode' },
              { title: '区', dataIndex: 'zone', width: 60 },
              { title: '架', dataIndex: 'rack', width: 70 },
              { title: '层', dataIndex: 'level', width: 60 },
              { title: '条码', dataIndex: 'barcode' },
              { title: '状态', dataIndex: 'status', width: 70 },
            ]}
          />
          <Table
            rowKey="storeCode"
            size="small"
            dataSource={bindings.data?.data ?? []}
            pagination={false}
            columns={[
              { title: '绑定店铺', dataIndex: 'storeCode' },
              { title: '履约模式', dataIndex: 'fulfillmentMode' },
              { title: '状态', dataIndex: 'status' },
            ]}
          />
        </Space>
      </Drawer>

      <Modal
        title={`批量创建库位 — ${warehouse?.warehouseCode ?? ''}`}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={() => void batchForm.validateFields().then((values) => batchMutation.mutate(values))}
        confirmLoading={batchMutation.isPending}
      >
        <Form form={batchForm} layout="vertical">
          <Space wrap>
            <Form.Item name="rackFrom" label="货架从" rules={[{ required: true }]}>
              <Input placeholder="A01" style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="rackTo" label="货架到" rules={[{ required: true }]}>
              <Input placeholder="A05" style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="levelFrom" label="层从" rules={[{ required: true }]}>
              <Input placeholder="01" style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="levelTo" label="层到" rules={[{ required: true }]}>
              <Input placeholder="04" style={{ width: 100 }} />
            </Form.Item>
          </Space>
          <p style={{ color: '#888' }}>
            将生成 {`{仓库编码}-{货架}-{层}`} 格式库位，条码自动生成 BIN- 前缀。重复编码会被拒绝。
          </p>
        </Form>
      </Modal>
    </Space>
  );
}
