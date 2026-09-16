import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  PayCircleOutlined,
  AccountBookOutlined,
  MoneyCollectOutlined,
  TransactionOutlined,
} from '@ant-design/icons';
import { Skeleton } from 'antd';
import { useApiQuery } from '../../api/hooks';
import { fmtMoney } from '../../utils/format';
import {
  FINANCE_CATEGORY_META,
  KpiRow,
  MetricCard,
  PageHeader,
  RelativeTime,
  SectionCard,
  StatusBadge,
  DataTable,
  colors,
} from '../../design-system';

/**
 * Finance overview (Sprint 10 T5): the period KPIs of /finance/summary plus
 * the latest vouchers - every number is a backend-derived fact, nothing is
 * fabricated client-side (Dashboard convention).
 */

interface SummaryDto {
  incomeTotal: string;
  expenseTotal: string;
  netTotal: string;
  settledRevenue: string;
  settledCost: string;
  settledProfit: string;
  unpaidPurchaseTotal: string;
  confirmedPayoutTotal: string;
}

interface TransactionRow {
  id: string;
  voucherNo: string;
  direction: string;
  category: string;
  amount: string;
  currency: string;
  occurredAt: string;
  orderNo: string | null;
  storeName: string | null;
  reversedByVoucherNo: string | null;
}

export function FinanceOverviewPage() {
  const navigate = useNavigate();
  const summary = useApiQuery<{ data: SummaryDto }>('/api/v1/finance/summary', {}, [
    'finance-summary',
  ]);
  const recent = useApiQuery<{ data: TransactionRow[]; meta: { total: number } }>(
    '/api/v1/finance/transactions',
    { page: 1, pageSize: 10 },
    ['finance-transactions-overview'],
  );

  const value = summary.data?.data;
  const rows = recent.data?.data ?? [];

  const cards = useMemo(
    () => [
      {
        icon: <AccountBookOutlined />,
        title: '期间收入',
        value: fmtMoney(value?.incomeTotal, 'CNY'),
        aux: '冲正对不计入净额',
        onClick: () => void navigate('/finance/transactions'),
      },
      {
        icon: <TransactionOutlined />,
        title: '期间支出',
        value: fmtMoney(value?.expenseTotal, 'CNY'),
        aux: `净额 ${fmtMoney(value?.netTotal, 'CNY')}`,
        onClick: () => void navigate('/finance/transactions'),
      },
      {
        icon: <PayCircleOutlined />,
        title: '已结算毛利',
        value: fmtMoney(value?.settledProfit, 'CNY'),
        aux: `收入 ${fmtMoney(value?.settledRevenue, 'CNY')} · 成本 ${fmtMoney(value?.settledCost, 'CNY')}`,
        onClick: () => void navigate('/finance/settlements'),
      },
      {
        icon: <MoneyCollectOutlined />,
        title: '待付采购款',
        value: fmtMoney(value?.unpaidPurchaseTotal, 'CNY'),
        aux: `已确认回款 ${fmtMoney(value?.confirmedPayoutTotal, 'CNY')}`,
        onClick: () => void navigate('/finance/payables'),
      },
    ],
    [value, navigate],
  );

  return (
    <div>
      <PageHeader
        title="财务总览"
        description="收支净额、订单毛利与应付回款的全局视图；所有数字来自后端派生汇总（finance.md §7）"
      />
      <KpiRow>
        {cards.map((card) => (
          <MetricCard
            key={card.title}
            icon={card.icon}
            title={card.title}
            value={summary.isLoading ? <Skeleton active paragraph={false} /> : card.value}
            aux={card.aux}
            onClick={card.onClick}
          />
        ))}
      </KpiRow>
      <SectionCard
        title="最近收支流水"
        flush
        extra={<a onClick={() => void navigate('/finance/transactions')}>查看全部</a>}
      >
        <DataTable<TransactionRow>
          rowKey="id"
          loading={recent.isLoading}
          dataSource={rows}
          pagination={false}
          onRow={() => ({
            onClick: () => void navigate('/finance/transactions'),
            style: { cursor: 'pointer' },
          })}
          emptyTitle="暂无流水"
          emptyDescription="登记收支、确认回款或生成订单结算后，这里会出现资金动态。"
          columns={[
            { title: '凭证号', dataIndex: 'voucherNo', key: 'voucherNo', width: 110 },
            {
              title: '类别',
              dataIndex: 'category',
              key: 'category',
              width: 110,
              render: (value: string) => {
                const meta = FINANCE_CATEGORY_META[value];
                return (
                  <StatusBadge
                    tone={meta?.tone ?? 'neutral'}
                    label={meta?.label ?? value}
                    showDot={false}
                  />
                );
              },
            },
            {
              title: '金额',
              dataIndex: 'amount',
              key: 'amount',
              width: 120,
              align: 'right' as const,
              render: (value: string, row: TransactionRow) => (
                <span
                  style={{
                    color: row.direction === 'INCOME' ? colors.success : undefined,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {row.direction === 'INCOME' ? '+' : '-'}
                  {fmtMoney(value, row.currency)}
                </span>
              ),
            },
            {
              title: '关联',
              key: 'ref',
              render: (_: unknown, row: TransactionRow) => row.orderNo ?? row.storeName ?? '—',
            },
            {
              title: '发生时间',
              dataIndex: 'occurredAt',
              key: 'occurredAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
