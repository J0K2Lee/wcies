import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';

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
const fmtTime = (value: string | null): string =>
  value === null ? '-' : value.slice(0, 19).replace('T', ' ');

const LIFECYCLE_PATHS = {
  release: '/api/v1/inventory/reservations/{id}/release',
  pick: '/api/v1/inventory/reservations/{id}/pick',
  unpick: '/api/v1/inventory/reservations/{id}/unpick',
  ship: '/api/v1/inventory/reservations/{id}/ship',
} as const;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  ACTIVE: { color: 'blue', label: '已占用' },
  PICKED: { color: 'orange', label: '已拣货' },
  RELEASED: { color: 'default', label: '已释放' },
  CONSUMED: { color: 'green', label: '已出库' },
  CANCELLED: { color: 'red', label: '已取消' },
};

/**
 * 库存占用管理 (task §44/§54): 列表 + 生命周期操作
 * (reserve 调试入口 / release / pick / unpick / ship)。
 */
export function ReservationsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<string | undefined>();
  const [skuId, setSkuId] = useState<string | undefined>();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

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
    mutationFn: async ({ id, op }: { id: string; op: 'release' | 'pick' | 'unpick' | 'ship' }) =>
      apiPost(LIFECYCLE_PATHS[op], {}, { id }).then(() => undefined),
    onSuccess: () => {
      void message.success('操作成功');
      refresh();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const runLifecycle = (record: ReservationRow, op: 'release' | 'pick' | 'unpick' | 'ship') => {
    const labels = {
      release: '释放占用（可售 +N）',
      pick: '拣货（已占用 → 已拣货）',
      unpick: '取消拣货（已拣货 → 已占用，仅拣错纠正）',
      ship: '出库（Picked -N，On Hand -N）',
    } as const;
    modal.confirm({
      title: `确认执行：${labels[op]}`,
      content: `预约 ${record.reservationNo}（${record.skuCode} × ${fmtQty(record.requestedQty)}）`,
      onOk: () => lifecycleMutation.mutate({ id: record.id, op }),
    });
  };

  const actionsFor = (record: ReservationRow): string[] => {
    switch (record.status) {
      case 'ACTIVE':
        return ['release', 'pick'];
      case 'PICKED':
        return ['ship', 'unpick'];
      default:
        return [];
    }
  };

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          placeholder="状态"
          allowClear
          style={{ width: 140 }}
          options={Object.entries(STATUS_TAG).map(([value, meta]) => ({
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
        <Typography.Text type="secondary">
          状态机：已占用 → 已拣货 → 已出库；已占用可释放；已拣货可取消拣货回已占用
        </Typography.Text>
      </Space>

      <Table<ReservationRow>
        rowKey="id"
        loading={reservations.isLoading}
        dataSource={reservations.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: reservations.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          { title: '预约号', dataIndex: 'reservationNo', width: 120 },
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
            render: (value: string) => {
              const meta = STATUS_TAG[value];
              return <Tag color={meta?.color}>{meta?.label ?? value}</Tag>;
            },
          },
          { title: '创建时间', dataIndex: 'createdAt', width: 150, render: fmtTime },
          { title: '拣货时间', dataIndex: 'pickedAt', width: 150, render: fmtTime },
          {
            title: '操作',
            width: 220,
            render: (_, record) => (
              <Space size="small">
                {actionsFor(record).map((op) => (
                  <Button
                    key={op}
                    size="small"
                    danger={op === 'release' || op === 'unpick'}
                    onClick={() =>
                      runLifecycle(record, op as 'release' | 'pick' | 'unpick' | 'ship')
                    }
                  >
                    {op === 'release'
                      ? '释放'
                      : op === 'pick'
                        ? '拣货'
                        : op === 'unpick'
                          ? '取消拣货'
                          : '出库'}
                  </Button>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}
