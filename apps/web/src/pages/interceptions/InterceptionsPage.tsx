import { useState } from 'react';
import { Button, Select, Space, Table, Tag } from 'antd';
import { Link } from 'react-router';
import { useApiQuery } from '../../api/hooks';

/** Interception list (Sprint 4 task §31). */

interface InterceptionListItem {
  id: string;
  interceptionNo: string;
  orderNo: string;
  warehouseCode: string;
  skuCode: string;
  skuName: string;
  status: string;
  assignedToName: string | null;
  createdAt: string;
}

import { INTERCEPTION_STATUS_LABEL } from '../../design-system';

const STATUS_COLORS: Record<string, string> = {
  CREATED: 'blue',
  ASSIGNED: 'geekblue',
  LOCATING: 'processing',
  INTERCEPTED: 'cyan',
  FAILED: 'error',
  RETURNED_TO_STOCK: 'success',
  CLOSED: 'default',
};

export function InterceptionsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();

  const query = useApiQuery<{ data: InterceptionListItem[]; meta: { total: number } }>(
    '/api/v1/interceptions',
    { page, pageSize: 20, ...(status ? { status } : {}) },
    ['interceptions', page, status],
  );

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="拦截状态"
          style={{ width: 200 }}
          options={Object.keys(STATUS_COLORS).map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </Space>
      <Table<InterceptionListItem>
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
          { title: '拦截单号', dataIndex: 'interceptionNo', key: 'interceptionNo', width: 140 },
          { title: '订单', dataIndex: 'orderNo', key: 'orderNo', width: 130 },
          { title: '仓库', dataIndex: 'warehouseCode', key: 'warehouseCode', width: 100 },
          {
            title: 'SKU',
            key: 'sku',
            render: (_: unknown, row: InterceptionListItem) => `${row.skuCode} ${row.skuName}`,
          },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 170,
            render: (value: string) => (
            <Tag color={STATUS_COLORS[value] ?? 'default'}>{INTERCEPTION_STATUS_LABEL[value] ?? value}</Tag>
          ),
          },
          {
            title: '指派给',
            dataIndex: 'assignedToName',
            key: 'assignedToName',
            width: 120,
            render: (value: string | null) => value ?? '-',
          },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: '操作',
            key: 'actions',
            width: 110,
            render: (_: unknown, row: InterceptionListItem) => (
              <Link to={`/interceptions/${row.id}`}>
                <Button type="primary" ghost size="small">
                  处理拦截
                </Button>
              </Link>
            ),
          },
        ]}
      />
    </div>
  );
}
