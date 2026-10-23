import { useMemo, useState } from 'react';
import { Button, Select } from 'antd';
import { useNavigate } from 'react-router';
import { useApiQuery } from '../../api/hooks';
import {
  ContextAction,
  ContextMetric,
  ContextSection,
  CopyTextButton,
  DataTable,
  EntitySummary,
  FilterBar,
  INTERCEPTION_STATUS_META,
  PageHeader,
  RelativeTime,
  SectionCard,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

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

export function InterceptionsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useApiQuery<{ data: InterceptionListItem[]; meta: { total: number } }>(
    '/api/v1/interceptions',
    { page, pageSize: 20, ...(status ? { status } : {}) },
    ['interceptions', page, status],
  );

  const rows = query.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="拦截概览">
            <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 个任务`} />
            <ContextMetric
              label={<span style={{ color: colors.danger }}>待处理</span>}
              value={
                rows.filter((row) => !['RETURNED_TO_STOCK', 'CLOSED'].includes(row.status)).length
              }
            />
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.interceptionNo}
          subtitle={`${selectedRow.skuCode} ${selectedRow.skuName}`}
          badge={
            <StatusBadge
              tone={INTERCEPTION_STATUS_META[selectedRow.status]?.tone ?? 'neutral'}
              label={INTERCEPTION_STATUS_META[selectedRow.status]?.label ?? selectedRow.status}
              hint={selectedRow.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="任务概况">
            <ContextMetric label="订单" value={selectedRow.orderNo} />
            <ContextMetric label="仓库" value={selectedRow.warehouseCode} />
            <ContextMetric label="指派给" value={selectedRow.assignedToName ?? '—'} />
            <ContextMetric
              label="创建时间"
              value={<RelativeTime value={selectedRow.createdAt} />}
            />
          </ContextSection>
          <ContextAction>
            <Button
              type="primary"
              block
              onClick={() => void navigate(`/interceptions/${selectedRow.id}`)}
            >
              处理拦截
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, query.data, rows, navigate]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="拦截作业"
        description="已拣货订单被取消后找回实物并扫码回库；双击任务行进入处理"
      />
      <FilterBar>
        <Select
          allowClear
          placeholder="拦截状态"
          style={{ width: 160 }}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={Object.entries(INTERCEPTION_STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
        />
      </FilterBar>
      <SectionCard flush>
        <DataTable<InterceptionListItem>
          rowKey="id"
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 20,
            total: query.data?.meta.total ?? 0,
            onChange: setPage,
            showTotal: (total) => `共 ${total} 个任务`,
          }}
          emptyTitle="暂无拦截任务"
          emptyDescription="已拣货订单被取消后会自动创建拦截任务。"
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            onDoubleClick: () => void navigate(`/interceptions/${record.id}`),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          columns={[
            { title: '拦截单号', dataIndex: 'interceptionNo', key: 'interceptionNo', width: 140 },
            { title: '订单', dataIndex: 'orderNo', key: 'orderNo', width: 130 },
            { title: '仓库', dataIndex: 'warehouseCode', key: 'warehouseCode', width: 100 },
            {
              title: 'SKU',
              key: 'sku',
              render: (_: unknown, row: InterceptionListItem) => (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  <span>
                    {row.skuCode} {row.skuName}
                  </span>
                  <CopyTextButton value={row.skuName} title="SKU 名称" />
                </span>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 120,
              render: (value: string) => (
                <StatusBadge
                  tone={INTERCEPTION_STATUS_META[value]?.tone ?? 'neutral'}
                  label={INTERCEPTION_STATUS_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
              ),
            },
            {
              title: '指派给',
              dataIndex: 'assignedToName',
              key: 'assignedToName',
              width: 120,
              render: (value: string | null) => value ?? '—',
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
