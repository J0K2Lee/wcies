import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';

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

/** 库位管理 (task §63/§77): pick a warehouse, browse/search bins. */
export function BinsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();

  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);
  const bins = useApiQuery<{ data: BinRow[]; meta: { total: number } }>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page, pageSize: 50, keyword: keyword || undefined },
    ['bins', warehouseId, page, keyword],
  );

  const createMutation = useMutation({
    mutationFn: (values: Record<string, string>) =>
      apiPost('/api/v1/warehouses/{warehouseId}/bins', values, { warehouseId: warehouseId ?? '' }),
    onSuccess: () => {
      void message.success('库位已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          placeholder="选择仓库"
          style={{ width: 220 }}
          showSearch
          optionFilterProp="label"
          value={warehouseId}
          onChange={(value) => {
            setPage(1);
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
        ]}
      />

      <Modal
        title="新建库位"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="binCode" label="库位编码" rules={[{ required: true }]}>
            <Input placeholder="如 SZ01-A01-01" />
          </Form.Item>
          <Space wrap>
            <Form.Item name="zone" label="区">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="rack" label="货架">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="level" label="层">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="position" label="位">
              <Input style={{ width: 100 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  );
}
