import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';

interface BindingRow {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  fulfillmentMode: string;
  platformWarehouseId: string | null;
  isInventorySource: boolean;
  isInventoryPushEnabled: boolean;
  priority: number;
  status: string;
}

const FULFILLMENT_MODES = [
  'OZON_RFBS',
  'OZON_FBS',
  'OZON_FBO',
  'OZON_FBP',
  'WB_FBS',
  'WB_FBW',
  'YANDEX_FBS',
  'YANDEX_FBY',
];

/** 店仓绑定页 (task §63/§82): store + fulfillment mode + warehouse. */
export function StoreBindingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [storeId, setStoreId] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const list = useApiQuery<{ data: BindingRow[]; meta: { total: number } }>(
    '/api/v1/warehouse-bindings',
    { page, pageSize: 50, storeId },
    ['bindings', page, storeId],
  );
  const stores = useApiQuery<{
    data: Array<{ id: string; platformCode: string; storeCode: string; name: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-lite']);
  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);

  const createMutation = useMutation({
    mutationFn: (values: {
      storeId: string;
      warehouseId: string;
      fulfillmentMode: string;
      platformWarehouseId?: string;
      isInventoryPushEnabled?: boolean;
      priority?: number;
    }) =>
      apiPost(
        '/api/v1/stores/{storeId}/warehouse-bindings',
        {
          warehouseId: values.warehouseId,
          fulfillmentMode: values.fulfillmentMode,
          platformWarehouseId: values.platformWarehouseId || undefined,
          isInventoryPushEnabled: values.isInventoryPushEnabled,
          priority: values.priority,
        },
        { storeId: values.storeId },
      ),
    onSuccess: () => {
      void message.success('绑定已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['bindings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          allowClear
          placeholder="筛选店铺"
          showSearch
          optionFilterProp="label"
          style={{ width: 220 }}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
          options={(stores.data?.data ?? []).map((store) => ({
            value: store.id,
            label: `${store.platformCode} / ${store.storeCode}`,
          }))}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建绑定
        </Button>
      </Space>

      <Table<BindingRow>
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
        scroll={{ x: 1100 }}
        columns={[
          { title: '平台', dataIndex: 'platformCode', width: 80 },
          { title: '店铺', dataIndex: 'storeCode' },
          { title: '仓库', dataIndex: 'warehouseCode' },
          { title: '仓库名称', dataIndex: 'warehouseName' },
          { title: '履约模式', dataIndex: 'fulfillmentMode' },
          { title: '平台仓ID', dataIndex: 'platformWarehouseId' },
          {
            title: '库存来源',
            dataIndex: 'isInventorySource',
            render: (v: boolean) => (v ? '是' : '否'),
            width: 90,
          },
          {
            title: '库存推送',
            dataIndex: 'isInventoryPushEnabled',
            render: (v: boolean) => (v ? <Tag color="blue">开</Tag> : '关'),
            width: 90,
          },
          { title: '优先级', dataIndex: 'priority', width: 80 },
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
        title="新建店仓绑定"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="storeId" label="店铺" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(stores.data?.data ?? []).map((store) => ({
                value: store.id,
                label: `${store.platformCode} / ${store.storeCode} ${store.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="warehouseId" label="仓库" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(warehouses.data?.data ?? []).map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.warehouseCode} ${warehouse.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="fulfillmentMode" label="履约模式" rules={[{ required: true }]}>
            <Select options={FULFILLMENT_MODES.map((mode) => ({ value: mode, label: mode }))} />
          </Form.Item>
          <Form.Item name="platformWarehouseId" label="平台仓ID（平台履约时填写）">
            <Input placeholder="如 123456" />
          </Form.Item>
          <Space wrap>
            <Form.Item
              name="isInventoryPushEnabled"
              label="启用库存推送"
              valuePropName="checked"
              initialValue={false}
            >
              <Switch />
            </Form.Item>
            <Form.Item name="priority" label="优先级" initialValue={100}>
              <InputNumber min={0} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <p style={{ color: '#888' }}>
            履约模式必须与店铺平台一致；FBO/FBY/FBW 绑定平台仓，FBS/RFBS 绑定自管/第三方仓。
          </p>
        </Form>
      </Modal>
    </Space>
  );
}
