import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App as AntdApp,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtMoney } from '../../utils/format';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  RailHint,
  RelativeTime,
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';
import { FINANCE_CATEGORY_META } from '../../design-system';

/**
 * Finance voucher ledger (Sprint 10 T5, finance.md §3): append-only list with
 * manual registration and reversal pairs. There is deliberately NO edit and
 * NO delete - mistakes are corrected by a reversal twin.
 */

interface TransactionRow {
  id: string;
  voucherNo: string;
  direction: string;
  category: string;
  amount: string;
  currency: string;
  occurredAt: string;
  storeId: string | null;
  supplierId: string | null;
  orderId: string | null;
  purchaseOrderId: string | null;
  payoutId: string | null;
  reversedByVoucherNo: string | null;
  remark: string | null;
  storeName: string | null;
  supplierName: string | null;
  orderNo: string | null;
  purchaseOrderNo: string | null;
}

interface VoucherFormValues {
  direction: string;
  category: string;
  amount: number;
  currency?: string;
  occurredAt?: { toISOString: () => string };
  remark?: string;
}

const DIRECTION_OPTIONS = [
  { value: 'INCOME', label: '收入' },
  { value: 'EXPENSE', label: '支出' },
];

/** Categories whose registration requires backend relations (finance.md §3.3). */
const RELATION_CATEGORIES = new Set(['SALE_INCOME', 'SALE_REFUND', 'PURCHASE_PAYMENT']);

type Envelope<T> = { data: T; meta: { total: number } };

export function FinanceTransactionsPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [direction, setDirection] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<VoucherFormValues>();

  const list = useApiQuery<Envelope<TransactionRow[]>>(
    '/api/v1/finance/transactions',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(direction ? { direction } : {}),
      ...(category ? { category } : {}),
    },
    ['finance-transactions', page, keyword, direction, category],
  );

  const detail = useApiQuery<{ data: TransactionRow }>(
    '/api/v1/finance/transactions/{id}',
    {},
    ['finance-transaction-detail', detailId],
    { id: detailId ?? '' },
    detailId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = detail.data?.data ?? null;

  const createMutation = useMutation({
    mutationFn: (values: VoucherFormValues) =>
      apiPost<{ voucherNo: string }>('/api/v1/finance/transactions', {
        direction: values.direction,
        category: values.category,
        amount: String(values.amount),
        ...(values.currency ? { currency: values.currency } : {}),
        ...(values.occurredAt ? { occurredAt: values.occurredAt.toISOString() } : {}),
        ...(values.remark ? { remark: values.remark } : {}),
      }),
    onSuccess: (result) => {
      void message.success(`流水 ${result.voucherNo} 已登记`);
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const reverseMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ voucherNo: string }>('/api/v1/finance/transactions/{id}/reverse', {}, { id }),
    onSuccess: (result) => {
      void message.success(`已冲正，生成对冲凭证 ${result.voucherNo}`);
      void queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-transaction-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="流水概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 笔`} />
            <RailHint>
              流水一经登记不可修改；错账在右栏「冲正流水」生成方向相反的成对凭证，两笔在汇总中相互抵消。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const categoryMeta = FINANCE_CATEGORY_META[selectedRow.category];
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.voucherNo}
          subtitle={`${selectedRow.direction === 'INCOME' ? '收入' : '支出'} · ${categoryMeta?.label ?? selectedRow.category}`}
          badge={
            <StatusBadge
              tone={categoryMeta?.tone ?? 'neutral'}
              label={categoryMeta?.label ?? selectedRow.category}
              hint={selectedRow.category}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric
              label="金额"
              value={fmtMoney(selectedRow.amount, selectedRow.currency)}
              strong
            />
            <ContextMetric label="关联订单" value={selectedRow.orderNo ?? '—'} />
            <ContextMetric label="关联采购单" value={selectedRow.purchaseOrderNo ?? '—'} />
            <ContextMetric label="关联店铺" value={selectedRow.storeName ?? '—'} />
            <ContextMetric label="发生时间" value={fmtDateTime(selectedRow.occurredAt)} />
            <ContextMetric label="冲正状态" value={selectedRow.reversedByVoucherNo ?? '未冲正'} />
            <ContextMetric label="备注" value={selectedRow.remark ?? '—'} />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            {selectedRow.reversedByVoucherNo === null && (
              <Button
                block
                danger
                style={{ marginTop: 8 }}
                loading={reverseMutation.isPending}
                onClick={() => {
                  // 冲正 = 作废类操作（UI 规范 §7 L2）：强确认 + danger。
                  modal.confirm({
                    title: `冲正流水 ${selectedRow.voucherNo}？`,
                    content:
                      '将生成一笔方向相反、类别与金额相同的对冲凭证，两笔在全部汇总中按净额 0 处理。原凭证不会被删除。',
                    okText: '冲正流水',
                    okButtonProps: { danger: true },
                    cancelText: '返回',
                    onOk: () => {
                      reverseMutation.mutate(selectedRow.id);
                    },
                  });
                }}
              >
                冲正流水
              </Button>
            )}
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, modal, reverseMutation.isPending]);

  useContextRail(railContent);

  const watchedCategory = Form.useWatch('category', form);

  return (
    <div>
      <PageHeader
        title="收支流水"
        description="资金进出的唯一事实（追加型账本）：销售收入、退款、采购付款、平台与物流费用等"
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setCreateOpen(true);
            }}
          >
            登记流水
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="凭证号 / 订单号 / 采购单号"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索流水"
        />
        <Select
          allowClear
          placeholder="收支方向"
          style={{ width: 120 }}
          options={DIRECTION_OPTIONS}
          value={direction}
          onChange={(value) => {
            setPage(1);
            setDirection(value);
          }}
        />
        <Select
          allowClear
          placeholder="类别"
          style={{ width: 150 }}
          showSearch
          optionFilterProp="label"
          options={Object.entries(FINANCE_CATEGORY_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          value={category}
          onChange={(value) => {
            setPage(1);
            setCategory(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<TransactionRow>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 笔`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            onDoubleClick: () => setDetailId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无流水"
          emptyDescription="登记收支、确认平台回款后，资金动态会出现在这里。"
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
                    hint={value}
                    showDot={false}
                  />
                );
              },
            },
            {
              title: '金额',
              dataIndex: 'amount',
              key: 'amount',
              width: 130,
              align: 'right' as const,
              render: (value: string, row: TransactionRow) => (
                <span
                  style={{
                    color: row.direction === 'INCOME' ? colors.success : colors.danger,
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
              render: (_: unknown, row: TransactionRow) =>
                row.orderNo ?? row.purchaseOrderNo ?? row.storeName ?? '—',
            },
            {
              title: '冲正',
              dataIndex: 'reversedByVoucherNo',
              key: 'reversed',
              width: 100,
              render: (value: string | null) =>
                value === null ? (
                  '—'
                ) : (
                  <StatusBadge tone="warning" label="已冲正" hint={value} showDot={false} />
                ),
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

      <Drawer
        open={detailId !== null && detailRow !== null}
        onClose={() => setDetailId(null)}
        size={640}
        title={
          detailRow !== null && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>{detailRow.voucherNo}</span>
          )
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== null && (
          <ContextSection title="流水信息">
            <ContextMetric label="凭证号" value={detailRow.voucherNo} />
            <ContextMetric
              label="金额"
              value={`${detailRow.direction === 'INCOME' ? '+' : '-'}${fmtMoney(detailRow.amount, detailRow.currency)}`}
              strong
            />
            <ContextMetric
              label="类别"
              value={FINANCE_CATEGORY_META[detailRow.category]?.label ?? detailRow.category}
            />
            <ContextMetric label="关联订单" value={detailRow.orderNo ?? '—'} />
            <ContextMetric label="关联采购单" value={detailRow.purchaseOrderNo ?? '—'} />
            <ContextMetric label="关联店铺" value={detailRow.storeName ?? '—'} />
            <ContextMetric label="关联供应商" value={detailRow.supplierName ?? '—'} />
            <ContextMetric label="回款单流水" value={detailRow.payoutId ?? '—'} />
            <ContextMetric label="冲正对方" value={detailRow.reversedByVoucherNo ?? '—'} />
            <ContextMetric label="发生时间" value={fmtDateTime(detailRow.occurredAt)} />
            <ContextMetric label="备注" value={detailRow.remark ?? '—'} />
          </ContextSection>
        )}
      </Drawer>

      <Modal
        title="登记收支流水"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="登记"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item name="direction" label="收支方向" style={{ flex: 1 }} initialValue="EXPENSE">
              <Select options={DIRECTION_OPTIONS} />
            </Form.Item>
            <Form.Item
              name="category"
              label="类别"
              style={{ flex: 1 }}
              initialValue="LOGISTICS_FEE"
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={Object.entries(FINANCE_CATEGORY_META).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                }))}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item
              name="amount"
              label="金额"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请输入金额' }]}
            >
              <InputNumber
                min={0.0001}
                precision={4}
                style={{ width: '100%' }}
                placeholder="0.0000"
              />
            </Form.Item>
            <Form.Item name="currency" label="币种" style={{ flex: 1 }} initialValue="CNY">
              <Select
                options={[
                  { value: 'CNY', label: 'CNY 人民币' },
                  { value: 'RUB', label: 'RUB 卢布' },
                  { value: 'USD', label: 'USD 美元' },
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="occurredAt" label="业务发生时间（可选，默认现在）">
            <DatePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea maxLength={2000} rows={2} />
          </Form.Item>
          {RELATION_CATEGORIES.has(String(watchedCategory)) && (
            <div style={{ color: colors.warning, fontSize: 12.5 }}>
              该类别的流水必须在后端关联订单或采购单（finance.md §3.3）：请在订单结算页生成收入、
              在采购应付页登记付款、在订单详情登记退款。
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}
