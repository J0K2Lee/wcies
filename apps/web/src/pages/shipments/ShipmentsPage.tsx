import { useState } from 'react';
import { App as AntdApp, Button, Form, Modal, Select, Progress } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';
import {
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  RelativeTime,
  SectionCard,
  SHIPMENT_STATUS_META,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

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

export function ShipmentsPage() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const list = query.data?.data ?? [];
  const selectedRow = list.find((row) => row.id === selectedId) ?? null;

  const railContent: ContextRailContent =
    selectedRow === null
      ? {
          defaultCollapsed: true,
          children: (
            <ContextSection title="发货概览">
              <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 张发货单`} />
            </ContextSection>
          ),
        }
      : {
          defaultCollapsed: true,
          header: (
            <EntitySummary
              title={selectedRow.shipmentNo}
              subtitle={`${selectedRow.warehouseCode} ${selectedRow.warehouseName}`}
              badge={
                <StatusBadge
                  tone={SHIPMENT_STATUS_META[selectedRow.status]?.tone ?? 'neutral'}
                  label={SHIPMENT_STATUS_META[selectedRow.status]?.label ?? selectedRow.status}
                  hint={selectedRow.status}
                />
              }
            />
          ),
          children: (
            <>
              <ContextSection title="发货概况">
                <ContextMetric label="订单" value={selectedRow.orderNo} />
                <ContextMetric
                  label="包裹"
                  value={`${selectedRow.sealedPackagesCount} 封 / ${selectedRow.packagesCount} 个`}
                />
                <ContextMetric label="物流单号" value={selectedRow.trackingNumber ?? '—'} />
              </ContextSection>
              <ContextSection title="打包进度">
                <Progress
                  percent={
                    selectedRow.packagesCount === 0
                      ? 0
                      : Math.round(
                          (selectedRow.sealedPackagesCount / selectedRow.packagesCount) * 100,
                        )
                  }
                  size={{ height: 6 }}
                  strokeColor={colors.primary}
                />
                <ContextMetric
                  label="已封箱"
                  value={`${selectedRow.sealedPackagesCount} / ${selectedRow.packagesCount}`}
                />
              </ContextSection>
              <ContextAction>
                <Button block onClick={() => void navigate(`/shipments/${selectedRow.id}`)}>
                  查看详情
                </Button>
                <Button
                  type="primary"
                  block
                  style={{ marginTop: 8 }}
                  onClick={() => void navigate(`/shipments/${selectedRow.id}`)}
                >
                  进入工作台
                </Button>
              </ContextAction>
            </>
          ),
        };
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="发货管理"
        description="从已拣货订单创建发货单，按仓拆分；双击行进入发货单详情"
        primary={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            从订单创建发货单
          </Button>
        }
      />
      <FilterBar>
        <Select
          allowClear
          placeholder="发货单状态"
          style={{ width: 160 }}
          options={Object.entries(SHIPMENT_STATUS_META).map(([value, meta]) => ({
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
        <DataTable<ShipmentListItem>
          rowKey="id"
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          dataSource={list}
          pagination={{
            current: page,
            pageSize: 20,
            total: query.data?.meta.total ?? 0,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 张发货单`,
          }}
          emptyTitle="暂无发货单"
          emptyDescription="订单拣货完成后可从订单创建发货单。"
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            onDoubleClick: () => void navigate(`/shipments/${record.id}`),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          columns={[
            { title: '发货单号', dataIndex: 'shipmentNo', key: 'shipmentNo', width: 140 },
            {
              title: '订单',
              key: 'order',
              render: (_: unknown, row: ShipmentListItem) => (
                <Link
                  to={`/orders?keyword=${encodeURIComponent(row.orderNo)}&focus=${row.orderId}`}
                >
                  {row.orderNo}
                </Link>
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
              width: 110,
              render: (_: unknown, row: ShipmentListItem) =>
                `${row.sealedPackagesCount} 封 / ${row.packagesCount} 个`,
            },
            {
              title: '物流单号',
              dataIndex: 'trackingNumber',
              key: 'trackingNumber',
              render: (value: string | null) => value ?? '—',
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 110,
              render: (value: string) => (
                <StatusBadge
                  tone={SHIPMENT_STATUS_META[value]?.tone ?? 'neutral'}
                  label={SHIPMENT_STATUS_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
            {
              title: '出库时间',
              dataIndex: 'shippedAt',
              key: 'shippedAt',
              width: 130,
              render: (value: string | null) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Modal
        title="从订单创建发货单（仅已拣货行，按仓拆分）"
        open={createOpen}
        confirmLoading={createMutation.isPending}
        okText="创建发货单"
        cancelText="取消"
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values.orderId));
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="orderId"
            label="选择已拣货状态订单"
            rules={[{ required: true, message: '请选择订单' }]}
          >
            <Select
              placeholder="选择订单"
              showSearch
              optionFilterProp="label"
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
