import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Select } from 'antd';
import { useMemo, useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';
import {
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  RailHint,
  RelativeTime,
  RESERVATION_STATUS_META,
  SectionCard,
  StatusBadge,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

interface ReservationRow {
  id: string;
  reservationNo: string;
  skuId: string;
  skuCode: string;
  warehouseId: string;
  warehouseCode: string;
  referenceType: string;
  referenceId: string;
  requestedQty: string;
  status: string;
  remark: string | null;
  createdAt: string;
  pickedAt: string | null;
  releasedAt: string | null;
  consumedAt: string | null;
}

const fmtQty = (value: string): string => (Number(value) % 1 === 0 ? String(Number(value)) : value);

const LIFECYCLE_PATHS = {
  release: '/api/v1/inventory/reservations/{id}/release',
  pick: '/api/v1/inventory/reservations/{id}/pick',
  unpick: '/api/v1/inventory/reservations/{id}/unpick',
  ship: '/api/v1/inventory/reservations/{id}/ship',
} as const;

type LifecycleOp = keyof typeof LIFECYCLE_PATHS;

const LIFECYCLE_LABELS: Record<LifecycleOp, { text: string; explain: string }> = {
  release: { text: '释放占用', explain: '可售 +N，占用解除' },
  pick: { text: '拣货', explain: '已占用 → 已拣货' },
  unpick: { text: '取消拣货', explain: '已拣货 → 已占用，仅拣错纠正' },
  ship: { text: '出库', explain: '已拣货 -N，在库 -N' },
};

/** 状态机：已占用 → 已拣货 → 已出库；已占用可释放；已拣货可取消拣货回已占用。 */
function actionsFor(status: string): LifecycleOp[] {
  switch (status) {
    case 'ACTIVE':
      return ['pick', 'release'];
    case 'PICKED':
      return ['ship', 'unpick'];
    default:
      return [];
  }
}

/**
 * 库存占用管理 (task §44/§54): 列表 + 生命周期操作
 * (release / pick / unpick / ship)。操作统一在右栏（Phase 3 T4）。
 */
export function ReservationsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | undefined>();
  const [skuId, setSkuId] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const reservations = useApiQuery<{ data: ReservationRow[]; meta: { total: number } }>(
    '/api/v1/inventory/reservations',
    { page, pageSize: 50, status, skuId, warehouseId },
    ['inventory-reservations', page, status, skuId, warehouseId],
  );
  const skus = useApiQuery<{ data: Array<{ id: string; skuCode: string; nameZh: string }> }>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, keyword: keyword || undefined },
    ['skus-search', keyword],
  );
  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: ['inventory-reservations'] });

  const lifecycleMutation = useMutation({
    mutationFn: async ({ id, op }: { id: string; op: LifecycleOp }) =>
      apiPost(LIFECYCLE_PATHS[op], {}, { id }).then(() => undefined),
    onSuccess: () => {
      void message.success('操作成功');
      refresh();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const runLifecycle = (record: ReservationRow, op: LifecycleOp) => {
    modal.confirm({
      title: `确认执行：${LIFECYCLE_LABELS[op].text}（${LIFECYCLE_LABELS[op].explain}）`,
      content: `预约 ${record.reservationNo}（${record.skuCode} × ${fmtQty(record.requestedQty)}）`,
      okText: LIFECYCLE_LABELS[op].text,
      cancelText: '返回',
      onOk: () => lifecycleMutation.mutate({ id: record.id, op }),
    });
  };

  const list = reservations.data?.data ?? [];
  const selectedRow = useMemo(
    () => list.find((row) => row.id === selectedId) ?? null,
    [list, selectedId],
  );

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="库存占用概览">
            <ContextMetric label="当前筛选" value={`${reservations.data?.meta.total ?? 0} 条`} />
            <RailHint>
              点击占用行查看详情；生命周期操作（拣货 / 出库 / 释放 / 取消拣货）在右栏执行。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const meta = RESERVATION_STATUS_META[selectedRow.status];
    const ops = actionsFor(selectedRow.status);
    // 生命周期推进动作不是 danger（UI 规范 §3.1）；首个可用动作为主操作。
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.reservationNo}
          subtitle={selectedRow.skuCode}
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
          <ContextSection title="占用信息">
            <ContextMetric label="数量" value={fmtQty(selectedRow.requestedQty)} strong />
            <ContextMetric label="仓库" value={selectedRow.warehouseCode} />
            <ContextMetric
              label="来源"
              value={`${selectedRow.referenceType}/${selectedRow.referenceId.slice(0, 8)}`}
            />
            <ContextMetric label="备注" value={selectedRow.remark ?? '—'} />
          </ContextSection>
          <ContextAction>
            {ops.map((op, index) => (
              <Button
                key={op}
                block
                style={index > 0 ? { marginTop: 8 } : undefined}
                type={index === 0 ? 'primary' : 'default'}
                loading={lifecycleMutation.isPending}
                onClick={() => runLifecycle(selectedRow, op)}
              >
                {LIFECYCLE_LABELS[op].text}
              </Button>
            ))}
            {ops.length === 0 && <RailHint>该占用已是终态，无可用操作。</RailHint>}
          </ContextAction>
        </>
      ),
    };
    // lifecycleMutation 的依赖以 isPending 布尔承载（UI 规范 §4.4）。
  }, [selectedRow, reservations.data, lifecycleMutation.isPending]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="库存占用"
        description="订单对库存的占用记录：已占用 → 已拣货 → 已出库；已占用可释放，已拣货可取消拣货"
      />

      <FilterBar>
        <Select
          placeholder="SKU"
          showSearch
          allowClear
          style={{ width: 240 }}
          filterOption={false}
          onSearch={setKeyword}
          value={skuId}
          onChange={(value) => {
            setPage(1);
            setSkuId(value);
          }}
          options={(skus.data?.data ?? []).map((sku) => ({
            value: sku.id,
            label: `${sku.skuCode} ${sku.nameZh}`,
          }))}
        />
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 140 }}
          options={Object.entries(RESERVATION_STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
        <Select
          placeholder="仓库"
          showSearch
          allowClear
          optionFilterProp="label"
          style={{ width: 200 }}
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
      </FilterBar>

      <SectionCard flush>
        <DataTable<ReservationRow>
          rowKey="id"
          loading={reservations.isLoading}
          dataSource={list}
          pagination={{
            current: page,
            pageSize: 50,
            total: reservations.data?.meta.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条占用`,
          }}
          emptyTitle="暂无库存占用"
          emptyDescription="当前筛选下没有占用记录。"
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          columns={[
            { title: '预约号', dataIndex: 'reservationNo', width: 130 },
            { title: 'SKU', dataIndex: 'skuCode', width: 130 },
            { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
            {
              title: '来源',
              width: 130,
              render: (_, record) => `${record.referenceType}/${record.referenceId.slice(0, 8)}`,
            },
            { title: '数量', dataIndex: 'requestedQty', width: 80, align: 'right', render: fmtQty },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => (
                <StatusBadge
                  tone={RESERVATION_STATUS_META[value]?.tone ?? 'neutral'}
                  label={RESERVATION_STATUS_META[value]?.label ?? value}
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
            {
              title: '拣货时间',
              dataIndex: 'pickedAt',
              width: 130,
              render: (value: string | null) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
