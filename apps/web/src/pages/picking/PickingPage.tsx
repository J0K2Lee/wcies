import { useState } from 'react';
import { Button, Select, Space, Table } from 'antd';
import { Link } from 'react-router';
import { useApiQuery } from '../../api/hooks';

/** Picking task list (Sprint 3 task §46-§47) - the warehouse entry point. */

interface PickingTaskListItem {
  id: string;
  pickingNo: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  status: string;
  ordersCount: number;
  itemsTotal: number;
  itemsPicked: number;
  requiredTotal: string;
  pickedTotal: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'default',
  IN_PROGRESS: 'processing',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

export function PickingPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();

  const query = useApiQuery<{ data: PickingTaskListItem[]; meta: { total: number } }>(
    '/api/v1/picking-tasks',
    { page, pageSize: 20, ...(status ? { status } : {}) },
    ['picking-tasks', page, status],
  );

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="任务状态"
          style={{ width: 160 }}
          options={Object.keys(STATUS_COLORS).map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </Space>
      <Table<PickingTaskListItem>
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
          { title: '拣货单号', dataIndex: 'pickingNo', key: 'pickingNo', width: 140 },
          {
            title: '仓库',
            key: 'warehouse',
            render: (_: unknown, row: PickingTaskListItem) =>
              `${row.warehouseCode} ${row.warehouseName}`,
          },
          { title: '订单数', dataIndex: 'ordersCount', key: 'ordersCount', width: 90 },
          {
            title: '行进度',
            key: 'items',
            width: 120,
            render: (_: unknown, row: PickingTaskListItem) =>
              `${row.itemsPicked} / ${row.itemsTotal}`,
          },
          {
            title: '件数进度',
            key: 'qty',
            width: 130,
            render: (_: unknown, row: PickingTaskListItem) =>
              `${Number(row.pickedTotal)} / ${Number(row.requiredTotal)}`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: (value: string) => (
              <span style={{ color: value === 'COMPLETED' ? '#389e0d' : undefined }}>{value}</span>
            ),
          },
          {
            title: '操作',
            key: 'actions',
            width: 120,
            render: (_: unknown, row: PickingTaskListItem) => (
              <Link to={`/picking/${row.id}`}>
                <Button type="primary" ghost size="small">
                  进入作业
                </Button>
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}
