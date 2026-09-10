import { useState } from 'react';
import { App as AntdApp, Button, Form, Modal, Select, Space, Table, Tag } from 'antd';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';

/** Shipment list (Sprint 4 task §57) + creation from a PICKED order. */

interface ShipmentListItem {
  id: string;
  shipmentNo: string;
  orderId: string;
  orderNo: string;
  warehouseCode: string;
  warehouseName: string;
  status: string;
  trackingNumber: string | null;
  packagesCount: number;
  sealedPackagesCount: number;
  itemsTotal: number;
  createdAt: string;
  shippedAt: string | null;
}

import { SHIPMENT_STATUS_LABEL } from '../../design-system';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'default',
  READY_TO_PACK: 'blue',
  PACKING: 'processing',
  READY_TO_SHIP: 'cyan',
  SHIPPED: 'success',
  CANCELLED: 'default',
  EXCEPTION: 'error',
};

export function ShipmentsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<{ orderId: string }>();

  const query = useApiQuery<{ data: ShipmentListItem[]; meta: { total: number } }>(
    '/api/v1/shipments',
    { page, pageSize: 20, ...(status ? { status } : {}) },
    ['shipments', page, status],
  );

  const pickedOrders = useApiQuery<{
    data: Array<{ id: string; orderNo: string; pickedCount: number }>;
  }>(
    '/api/v1/orders',
    { page: 1, pageSize: 50, erpStatus: 'PICKED' },
    ['orders', 'picked-for-shipment'],
    undefined,
    createOpen,
  );

  const createMutation = useMutation({
    mutationFn: (orderId: string) =>
      apiPost<{ shipments: Array<{ id: string }> }>('/api/v1/shipments', { orderId }),
    onSuccess: (result) => {
      message.success(`已创建 ${result.shipments.length} 张发货单`);
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
  });

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="发货单状态"
          style={{ width: 180 }}
          options={Object.keys(STATUS_COLORS).map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          从订单创建发货单
        </Button>
      </Space>
      <Table<ShipmentListItem>
        rowKey="id"
        size="middle"
        loading={query.isLoading}
        dataSource={query.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 20,
          total: query.data?.meta.total ?? 0,
          onChange: setPage,
        }}
        columns={[
          { title: '发货单号', dataIndex: 'shipmentNo', key: 'shipmentNo', width: 140 },
          {
            title: '订单',
            key: 'order',
            render: (_: unknown, row: ShipmentListItem) => (
              <Link to={`/orders`}>{row.orderNo}</Link>
            ),
          },
          {
            title: '仓库',
            key: 'warehouse',
            render: (_: unknown, row: ShipmentListItem) =>
              `${row.warehouseCode} ${row.warehouseName}`,
          },
          {
            title: '包裹',
            key: 'packages',
            width: 100,
            render: (_: unknown, row: ShipmentListItem) =>
              `${row.sealedPackagesCount} 封 / ${row.packagesCount} 个`,
          },
          {
            title: '物流单号',
            dataIndex: 'trackingNumber',
            key: 'trackingNumber',
            render: (value: string | null) => value ?? '-',
          },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 140,
            render: (value: string) => (
            <Tag color={STATUS_COLORS[value] ?? 'default'}>{SHIPMENT_STATUS_LABEL[value] ?? value}</Tag>
          ),
          },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: '出库时间',
            dataIndex: 'shippedAt',
            key: 'shippedAt',
            width: 170,
            render: (value: string | null) => (value ? new Date(value).toLocaleString() : '-'),
          },
          {
            title: '操作',
            key: 'actions',
            width: 110,
            render: (_: unknown, row: ShipmentListItem) => (
              <Link to={`/shipments/${row.id}`}>
                <Button type="primary" ghost size="small">
                  发货工作台
                </Button>
              </Link>
            ),
          },
        ]}
      />

      <Modal
        title="从订单创建发货单（仅 PICKED 行，按仓拆分）"
        open={createOpen}
        confirmLoading={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values.orderId));
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="orderId"
            label="选择 PICKED 状态订单"
            rules={[{ required: true, message: '请选择订单' }]}
          >
            <Select
              placeholder="选择订单"
              loading={pickedOrders.isLoading}
              options={(pickedOrders.data?.data ?? []).map((order) => ({
                value: order.id,
                label: `${order.orderNo}（${order.pickedCount} 行已拣）`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
