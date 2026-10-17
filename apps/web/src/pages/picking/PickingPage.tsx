import { Button, Progress, Select } from 'antd';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApiQuery } from '../../api/hooks';
import {
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  PICKING_STATUS_META,
  RelativeTime,
  SectionCard,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
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
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useApiQuery<{ data: PickingTaskListItem[]; meta: { total: number } }>(
    '/api/v1/picking-tasks',
    { page, pageSize: 20, ...(status ? { status } : {}) },
    ['picking-tasks', page, status],
  );

  const list = query.data?.data ?? [];
  const selectedRow = useMemo(
    () => list.find((row) => row.id === selectedId) ?? null,
    [list, selectedId],
  );

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="拣货概览">
            <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 个任务`} />
            <ContextMetric
              label="进行中"
              value={list.filter((row) => row.status === 'IN_PROGRESS').length}
            />
          </ContextSection>
        ),
      };
    }
    const meta = PICKING_STATUS_META[selectedRow.status];
    const required = Number(selectedRow.requiredTotal);
    const picked = Number(selectedRow.pickedTotal);
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.pickingNo}
          subtitle={`${selectedRow.warehouseCode} ${selectedRow.warehouseName}`}
          badge={
            <StatusBadge
              tone={meta?.tone ?? 'neutral'}
              label={meta?.label ?? selectedRow.status}
              hint={selectedRow.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="任务概况">
            <ContextMetric label="订单数" value={selectedRow.ordersCount} />
            <ContextMetric
              label="商品行"
              value={`${selectedRow.itemsPicked} / ${selectedRow.itemsTotal}`}
            />
            <ContextMetric label="总件数" value={`${picked} / ${required}`} strong />
          </ContextSection>
          <ContextAction>
            <Button
              type="primary"
              block
              onClick={() => void navigate(`/picking/${selectedRow.id}`)}
            >
              进入作业
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, query.data, list, navigate]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="拣货作业"
        description="按拣货单组织仓库拣货，支持扫码作业与 SN 序列号校验；双击任务行进入作业"
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
          error={query.error}
          onRetry={() => void query.refetch()}
          dataSource={list}
          pagination={{
            current: page,
            pageSize: 20,
            total: query.data?.meta.total ?? 0,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 个任务`,
          }}
          emptyTitle="暂无拣货任务"
          emptyDescription="从订单详情创建拣货任务后在此作业。"
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            onDoubleClick: () => void navigate(`/picking/${record.id}`),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
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
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
