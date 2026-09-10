import { useState } from 'react';
import { Button, Progress, Select } from 'antd';
import { Link } from 'react-router';
import { useApiQuery } from '../../api/hooks';
import {
  DataTable,
  FilterBar,
  PICKING_STATUS_META,
  PageHeader,
  SectionCard,
  StatusBadge,
  colors,
} from '../../design-system';

/** Picking task list (task §45) — stays inside the standard AppShell. */

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
      <PageHeader
        title="拣货作业"
        description="按拣货单组织仓库拣货，支持扫码作业与 SN 序列号校验"
      />
      <FilterBar>
        <Select
          allowClear
          placeholder="任务状态"
          style={{ width: 150 }}
          value={status}
          options={Object.keys(PICKING_STATUS_META).map((value) => ({
            value,
            label: PICKING_STATUS_META[value]?.label ?? value,
          }))}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<PickingTaskListItem>
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data?.data ?? []}
          pagination={{
            current: page,
            pageSize: 20,
            total: query.data?.meta.total ?? 0,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 个任务`,
          }}
          emptyTitle="暂无拣货任务"
          emptyDescription="从订单详情创建拣货任务后在此作业。"
          columns={[
            {
              title: '拣货单号',
              dataIndex: 'pickingNo',
              width: 140,
              render: (value: string) => (
                <span style={{ fontWeight: 600, color: colors.textPrimary }}>{value}</span>
              ),
            },
            {
              title: '仓库',
              key: 'warehouse',
              render: (_: unknown, row: PickingTaskListItem) =>
                `${row.warehouseCode} ${row.warehouseName}`,
            },
            { title: '订单数', dataIndex: 'ordersCount', width: 90, align: 'right' },
            {
              title: '商品行',
              dataIndex: 'itemsTotal',
              width: 90,
              align: 'right',
              render: (value: number, row: PickingTaskListItem) => `${row.itemsPicked} / ${value}`,
            },
            {
              title: '进度',
              key: 'progress',
              width: 200,
              render: (_: unknown, row: PickingTaskListItem) => {
                const required = Number(row.requiredTotal);
                const picked = Number(row.pickedTotal);
                const percent = required === 0 ? 0 : Math.round((picked / required) * 100);
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Progress
                      percent={percent}
                      showInfo={false}
                      size={{ width: 110, height: 6 }}
                      strokeColor={percent === 100 ? colors.success : colors.primary}
                    />
                    <span style={{ fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>
                      {picked}/{required}
                    </span>
                  </div>
                );
              },
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <StatusBadge
                  tone={PICKING_STATUS_META[value]?.tone ?? 'neutral'}
                  label={PICKING_STATUS_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 150,
              render: (value: string) => value.slice(5, 16).replace('T', ' '),
            },
            {
              title: '操作',
              key: 'actions',
              width: 110,
              render: (_: unknown, row: PickingTaskListItem) => (
                <Link to={`/picking/${row.id}`}>
                  <Button type={row.status === 'IN_PROGRESS' ? 'primary' : 'default'} size="small">
                    进入作业
                  </Button>
                </Link>
              ),
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
