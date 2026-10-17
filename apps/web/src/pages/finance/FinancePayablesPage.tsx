import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, InputNumber, Modal, Select } from 'antd';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtMoney } from '../../utils/format';
import {
  colors,
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
import { PURCHASE_PAYMENT_STATE_META } from '../../design-system';

/**
 * Purchase payables (Sprint 10 T5, finance.md §6): payable/paid/unpaid are
 * DERIVED at read time; registering a payment books a PURCHASE_PAYMENT
 * voucher through the finance API with its overpayment guard.
 */

interface PayableRow {
  id: string;
  poNo: string;
  supplierId: string | null;
  supplierName: string | null;
  status: string;
  orderedAt: string;
  payableAmount: string;
  paidAmount: string;
  unpaidAmount: string;
  paymentState: string;
  hasUnpricedLines: boolean;
}

interface PaymentFormValues {
  amount: number;
  remark?: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

export function FinancePayablesPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [paymentState, setPaymentState] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm] = Form.useForm<PaymentFormValues>();

  const list = useApiQuery<Envelope<PayableRow[]>>(
    '/api/v1/finance/payables',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(paymentState ? { paymentState } : {}),
    },
    ['finance-payables', page, keyword, paymentState],
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const totals = useMemo(() => {
    let payable = 0;
    let unpaid = 0;
    for (const row of rows) {
      payable += Number(row.payableAmount);
      unpaid += Number(row.unpaidAmount);
    }
    return { payable, unpaid };
  }, [rows]);

  const payMutation = useMutation({
    mutationFn: (input: { row: PayableRow; values: PaymentFormValues }) =>
      apiPost<{ voucherNo: string }>('/api/v1/finance/transactions', {
        direction: 'EXPENSE',
        category: 'PURCHASE_PAYMENT',
        amount: String(input.values.amount),
        supplierId: input.row.supplierId ?? undefined,
        purchaseOrderId: input.row.id,
        ...(input.values.remark ? { remark: input.values.remark } : {}),
      }),
    onSuccess: (result) => {
      void message.success(`付款流水 ${result.voucherNo} 已登记`);
      setPayOpen(false);
      payForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['finance-payables'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="应付概览">
            <ContextMetric label="本页应付" value={fmtMoney(String(totals.payable), 'CNY')} />
            <ContextMetric label="本页未付" value={fmtMoney(String(totals.unpaid), 'CNY')} strong />
            <RailHint>
              应付 = Σ（行数量 × 单位成本）；已付来自付款流水；付款状态是派生值，随时与流水对齐。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const meta = PURCHASE_PAYMENT_STATE_META[selectedRow.paymentState];
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.poNo}
          subtitle={selectedRow.supplierName ?? '无固定供应商'}
          badge={
            <StatusBadge
              tone={meta?.tone ?? 'neutral'}
              label={meta?.label ?? selectedRow.paymentState}
              hint={selectedRow.paymentState}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="付款进度">
            <ContextMetric label="应付金额" value={fmtMoney(selectedRow.payableAmount, 'CNY')} />
            <ContextMetric label="已付金额" value={fmtMoney(selectedRow.paidAmount, 'CNY')} />
            <ContextMetric
              label="未付余额"
              value={fmtMoney(selectedRow.unpaidAmount, 'CNY')}
              strong
            />
            <ContextMetric
              label="下单时间"
              value={<RelativeTime value={selectedRow.orderedAt} />}
            />
            {selectedRow.hasUnpricedLines && (
              <ContextMetric label="成本完整度" value="采购单存在未登记成本的行，应付不含这些行" />
            )}
          </ContextSection>
          <ContextSection title="操作区">
            <Button
              block
              type="primary"
              disabled={
                selectedRow.paymentState === 'PAID' || selectedRow.paymentState === 'NOTHING_TO_PAY'
              }
              onClick={() => {
                payForm.setFieldsValue({ amount: Number(selectedRow.unpaidAmount) });
                setPayOpen(true);
              }}
            >
              登记付款
            </Button>
          </ContextSection>
        </>
      ),
    };
  }, [selectedRow, totals, payForm]);

  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="采购应付"
        description="按采购单跟踪应付 / 已付 / 未付；登记付款直接生成采购付款流水（超付会被拒绝）"
      />

      <FilterBar>
        <Input.Search
          placeholder="采购单号 / 供应商"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索应付"
        />
        <Select
          allowClear
          placeholder="付款状态"
          style={{ width: 130 }}
          options={Object.entries(PURCHASE_PAYMENT_STATE_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          value={paymentState}
          onChange={(value) => {
            setPage(1);
            setPaymentState(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<PayableRow>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 单`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无应付"
          emptyDescription="登记带单位成本的采购单后，这里会跟踪付款进度。"
          columns={[
            { title: '采购单号', dataIndex: 'poNo', key: 'poNo', width: 120 },
            {
              title: '供应商',
              key: 'supplier',
              render: (_: unknown, row: PayableRow) => row.supplierName ?? '—',
            },
            {
              title: '应付',
              dataIndex: 'payableAmount',
              key: 'payableAmount',
              width: 110,
              align: 'right' as const,
              render: (value: string) => (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(value, 'CNY')}</span>
              ),
            },
            {
              title: '已付',
              dataIndex: 'paidAmount',
              key: 'paidAmount',
              width: 110,
              align: 'right' as const,
              render: (value: string) => (
                <span style={{ color: colors.success, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(value, 'CNY')}
                </span>
              ),
            },
            {
              title: '未付',
              dataIndex: 'unpaidAmount',
              key: 'unpaidAmount',
              width: 110,
              align: 'right' as const,
              render: (value: string) => (
                <span
                  style={{
                    color: Number(value) > 0 ? colors.warning : undefined,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtMoney(value, 'CNY')}
                </span>
              ),
            },
            {
              title: '付款状态',
              dataIndex: 'paymentState',
              key: 'paymentState',
              width: 110,
              render: (value: string) => {
                const meta = PURCHASE_PAYMENT_STATE_META[value];
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
              title: '下单时间',
              dataIndex: 'orderedAt',
              key: 'orderedAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Modal
        title={selectedRow !== null ? `登记付款 · ${selectedRow.poNo}` : '登记付款'}
        open={payOpen}
        onCancel={() => setPayOpen(false)}
        onOk={() => {
          if (selectedRow === null) {
            return;
          }
          void payForm
            .validateFields()
            .then((values) => payMutation.mutate({ row: selectedRow, values }));
        }}
        okText="付款"
        cancelText="取消"
        confirmLoading={payMutation.isPending}
        width={480}
        destroyOnHidden
      >
        <Form form={payForm} layout="vertical" preserve={false}>
          <Form.Item
            name="amount"
            label="付款金额（CNY）"
            extra={
              selectedRow !== null
                ? `未付余额 ${fmtMoney(selectedRow.unpaidAmount, 'CNY')}；累计付款不能超过应付`
                : undefined
            }
            rules={[{ required: true, message: '请输入金额' }]}
          >
            <InputNumber min={0.0001} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input maxLength={2000} placeholder="如：微信转账 9-17" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
