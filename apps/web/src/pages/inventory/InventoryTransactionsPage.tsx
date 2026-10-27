import { Input, Select } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useApiQuery, useDebouncedValue } from '../../api/hooks';
import { fmtQty } from '../../utils/format';
import {
  ContextMetric,
  ContextSection,
  DataTable,
  FilterBar,
  PageHeader,
  RailHint,
  RelativeTime,
  SectionCard,
  StatusBadge,
  TRANSACTION_TYPE_META,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

interface TransactionRow {
  id: string;
  transactionNo: string;
  eventNo: string;
  eventType: string;
  transactionType: string;
  skuId: string;
  skuCode: string;
  /** SKU 名称（中文名）：运营按名称识别商品。 */
  skuName: string;
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

/**
 * 库存流水 (task §43/§53): auditable ledger list.
 *
 * 双入口说明：本页是全量审计视图（跨 SKU）；「库存管理」Drawer 的流水 Tab
 * 是单 SKU 过滤视图——两者语义不同，均保留（Phase 3 T4）。
 *
 * 展示取舍（用户指示 2026-10-27）：流水号 / 事件号 / 来源（`ORDER/<id>` 这种
 * 技术引用）对运营排查没有帮助，隐藏；改为显示 SKU 名称，并支持按 SKU 编码
 * 或名称搜索（后端 `keyword` 参数，与库存余额列表同一口径）。
 */
export function InventoryTransactionsPage() {
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [transactionType, setTransactionType] = useState<string | undefined>();
  const [keywordInput, setKeywordInput] = useState('');
  // 890+ 条流水，逐键请求太重；输入停顿 300ms 再用。
  const keyword = useDebouncedValue(keywordInput.trim(), 300);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [keyword]);

  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);
  const transactions = useApiQuery<{ data: TransactionRow[]; meta: { total: number } }>(
    '/api/v1/inventory/transactions',
    {
      page,
      pageSize: 50,
      warehouseId,
      transactionType,
      ...(keyword === '' ? {} : { keyword }),
    },
    ['inventory-transactions', page, warehouseId, transactionType, keyword],
  );

  const railContent = useMemo<ContextRailContent>(
    () => ({
      defaultCollapsed: true,
      children: (
        <ContextSection title="流水概况">
          <ContextMetric label="当前筛选" value={`${transactions.data?.meta.total ?? 0} 条`} />
          <RailHint>流水为审计数据：每笔库存变动都有不可删除的流水记录。</RailHint>
        </ContextSection>
      ),
    }),
    [transactions.data],
  );
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="库存流水"
        description="全部库存变动的审计台账（系统不提供删除接口）；查看单个 SKU 的流水请到「库存管理」选中后打开详情"
      />

      <FilterBar>
        <Input.Search
          placeholder="搜索 SKU 编码 / 名称"
          allowClear
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          style={{ width: 240 }}
          aria-label="搜索 SKU"
        />
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
          options={Object.entries(TRANSACTION_TYPE_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          value={transactionType}
          onChange={(value) => {
            setPage(1);
            setTransactionType(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<TransactionRow>
          rowKey="id"
          loading={transactions.isLoading}
          error={transactions.error}
          onRetry={() => void transactions.refetch()}
          dataSource={transactions.data?.data ?? []}
          pagination={{
            current: page,
            pageSize: 50,
            total: transactions.data?.meta.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条流水`,
          }}
          emptyTitle="暂无库存流水"
          emptyDescription="当前筛选下没有流水记录。"
          columns={[
            {
              title: '时间',
              dataIndex: 'createdAt',
              width: 150,
              render: (value: string) => <RelativeTime value={value} />,
            },
            {
              title: '类型',
              dataIndex: 'transactionType',
              width: 120,
              render: (value: string) => (
                <StatusBadge
                  tone={TRANSACTION_TYPE_META[value]?.tone ?? 'neutral'}
                  label={TRANSACTION_TYPE_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
              ),
            },
            { title: 'SKU', dataIndex: 'skuCode', width: 130 },
            {
              title: 'SKU 名称',
              dataIndex: 'skuName',
              width: 200,
              ellipsis: true,
            },
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
                <span
                  style={{
                    color: Number(value) < 0 ? colors.danger : colors.success,
                    fontWeight: 600,
                  }}
                >
                  {fmtQty(value)}
                </span>
              ),
            },
            {
              title: '变更后',
              dataIndex: 'quantityAfter',
              width: 80,
              align: 'right',
              render: fmtQty,
            },
            {
              title: '占用变化',
              dataIndex: 'reservedChange',
              width: 90,
              align: 'right',
              render: (value: string | null) => (value === null ? '—' : fmtQty(value)),
            },
            {
              title: '已拣变化',
              dataIndex: 'pickedChange',
              width: 90,
              align: 'right',
              render: (value: string | null) => (value === null ? '—' : fmtQty(value)),
            },
            {
              title: '操作人',
              dataIndex: 'operatorName',
              width: 90,
              render: (value: string | null) => value ?? '—',
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
