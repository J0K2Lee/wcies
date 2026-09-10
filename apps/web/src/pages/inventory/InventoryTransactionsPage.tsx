import { Select, Space, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useApiQuery } from '../../api/hooks';

interface TransactionRow {
  id: string;
  transactionNo: string;
  eventNo: string;
  eventType: string;
  transactionType: string;
  skuId: string;
  skuCode: string;
  warehouseCode: string;
  binCode: string;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
  reservedChange: string | null;
  pickedChange: string | null;
  referenceType: string;
  referenceId: string;
  operatorName: string | null;
  remark: string | null;
  createdAt: string;
}

const fmtQty = (value: string): string => (Number(value) % 1 === 0 ? String(Number(value)) : value);
const fmtTime = (value: string): string => value.slice(0, 19).replace('T', ' ');

const TYPE_LABELS: Record<string, string> = {
  INITIAL_STOCK: '初始入库',
  RECEIVE: '收货入库',
  RESERVE: '订单占用',
  RELEASE: '释放占用',
  PICK: '拣货',
  UNPICK: '取消拣货',
  SHIP: '出库',
  MOVE_BIN: '库内移位',
  MANUAL_ADJUSTMENT: '手工调整',
};

/** 库存流水 (task §43/§53): auditable ledger list. */
export function InventoryTransactionsPage() {
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [transactionType, setTransactionType] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);
  const transactions = useApiQuery<{ data: TransactionRow[]; meta: { total: number } }>(
    '/api/v1/inventory/transactions',
    { page, pageSize: 50, warehouseId, transactionType },
    ['inventory-transactions', page, warehouseId, transactionType],
  );

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          placeholder="仓库"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 220 }}
          options={(warehouses.data?.data ?? []).map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.warehouseCode} ${warehouse.name}`,
          }))}
          value={warehouseId}
          onChange={(value) => {
            setPage(1);
            setWarehouseId(value);
          }}
        />
        <Select
          placeholder="流水类型"
          allowClear
          style={{ width: 160 }}
          options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          value={transactionType}
          onChange={(value) => {
            setPage(1);
            setTransactionType(value);
          }}
        />
        <Typography.Text type="secondary">流水为审计数据，系统不提供删除接口</Typography.Text>
      </Space>

      <Table<TransactionRow>
        rowKey="id"
        loading={transactions.isLoading}
        dataSource={transactions.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: transactions.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 150, render: fmtTime },
          {
            title: '类型',
            dataIndex: 'transactionType',
            width: 110,
            render: (value: string) => <Tag>{TYPE_LABELS[value] ?? value}</Tag>,
          },
          { title: 'SKU', dataIndex: 'skuCode', width: 130 },
          { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
          { title: '库位', dataIndex: 'binCode', width: 140 },
          {
            title: '变更前',
            dataIndex: 'quantityBefore',
            width: 80,
            align: 'right',
            render: fmtQty,
          },
          {
            title: '变更量',
            dataIndex: 'quantityChange',
            width: 80,
            align: 'right',
            render: (value: string) => (
              <span style={{ color: Number(value) < 0 ? '#cf1322' : '#3f8600' }}>
                {fmtQty(value)}
              </span>
            ),
          },
          { title: '变更后', dataIndex: 'quantityAfter', width: 80, align: 'right', render: fmtQty },
          {
            title: '占用变化',
            dataIndex: 'reservedChange',
            width: 90,
            align: 'right',
            render: (value: string | null) => (value === null ? '-' : fmtQty(value)),
          },
          {
            title: '已拣变化',
            dataIndex: 'pickedChange',
            width: 90,
            align: 'right',
            render: (value: string | null) => (value === null ? '-' : fmtQty(value)),
          },
          { title: '流水号', dataIndex: 'transactionNo', width: 140 },
          { title: '事件号', dataIndex: 'eventNo', width: 130 },
          {
            title: '来源',
            dataIndex: 'referenceType',
            width: 80,
            render: (value: string, record) => `${value}/${record.referenceId.slice(0, 8)}`,
          },
          { title: '操作人', dataIndex: 'operatorName', width: 90 },
        ]}
      />
    </Space>
  );
}
