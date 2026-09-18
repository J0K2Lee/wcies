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
import { fmtDate, fmtDateTime, fmtMoney } from '../../utils/format';
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
import { FINANCE_PAYOUT_STATUS_META } from '../../design-system';

/**
 * Platform payouts (Sprint 10 T5, finance.md §4): DRAFT batches confirmed
 * into a linked SALE_INCOME voucher; the preview reconciles the store's
 * settled revenue against the payout amount before the human confirms.
 */

interface PayoutRow {
  id: string;
  payoutNo: string;
  storeId: string;
  storeName: string | null;
  periodStart: string;
  periodEnd: string;
  amount: string;
  currency: string;
  status: string;
  remark: string | null;
  createdAt: string;
}

interface PayoutFormValues {
  storeId: string;
  period: [start: { toISOString: () => string }, end: { toISOString: () => string }];
  amount: number;
  currency?: string;
  remark?: string;
}

interface PreviewDto {
  payout: PayoutRow;
  settledRevenue: string;
  settledOrderCount: number;
  difference: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

export function FinancePayoutsPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm<PayoutFormValues>();

  const list = useApiQuery<Envelope<PayoutRow[]>>(
    '/api/v1/finance/payouts',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
    },
    ['finance-payouts', page, keyword, status],
  );

  const stores = useApiQuery<Envelope<Array<{ id: string; name: string; code: string }>>>(
    '/api/v1/stores',
    { page: 1, pageSize: 100 },
    ['stores-for-payout'],
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const preview = useApiQuery<{ data: PreviewDto }>(
    '/api/v1/finance/payouts/{id}/preview',
    {},
    ['finance-payout-preview', selectedId],
    { id: selectedId ?? '' },
    previewOpen && selectedId !== null,
  );

  const createMutation = useMutation({
    mutationFn: (values: PayoutFormValues) =>
      apiPost<{ payoutNo: string }>('/api/v1/finance/payouts', {
        storeId: values.storeId,
        periodStart: values.period[0].toISOString(),
        periodEnd: values.period[1].toISOString(),
        amount: String(values.amount),
        ...(values.currency ? { currency: values.currency } : {}),
        ...(values.remark ? { remark: values.remark } : {}),
      }),
    onSuccess: (result) => {
      void message.success(`回款单 ${result.payoutNo} 已登记（草稿）`);
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['finance-payouts'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/finance/payouts/{id}/confirm', {}, { id }),
    onSuccess: () => {
      void message.success('回款已确认，销售收入流水已生成');
      void queryClient.invalidateQueries({ queryKey: ['finance-payouts'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/finance/payouts/{id}/cancel', {}, { id }),
    onSuccess: () => {
      void message.success('回款单已取消（未影响任何流水）');
      void queryClient.invalidateQueries({ queryKey: ['finance-payouts'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="回款概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 单`} />
            <RailHint>
              平台打款先登记草稿，对账预览确认无误后再「确认回款」——确认会自动生成一笔关联的销售收入流水。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    const meta = FINANCE_PAYOUT_STATUS_META[selectedRow.status];
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.payoutNo}
          subtitle={selectedRow.storeName ?? '—'}
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
          <ContextSection title="基本信息">
            <ContextMetric
              label="打款金额"
              value={fmtMoney(selectedRow.amount, selectedRow.currency)}
              strong
            />
            <ContextMetric
              label="对账期间"
              value={`${fmtDate(selectedRow.periodStart)} ~ ${fmtDate(selectedRow.periodEnd)}`}
            />
            <ContextMetric label="店铺" value={selectedRow.storeName ?? '—'} />
            <ContextMetric label="登记时间" value={fmtDateTime(selectedRow.createdAt)} />
            <ContextMetric label="备注" value={selectedRow.remark ?? '—'} />
          </ContextSection>
          <ContextAction>
            {selectedRow.status === 'DRAFT' && (
              <>
                <Button
                  block
                  type="primary"
                  onClick={() => {
                    setPreviewOpen(true);
                  }}
                >
                  对账预览
                </Button>
                <Button
                  block
                  danger
                  style={{ marginTop: 8 }}
                  loading={cancelMutation.isPending}
                  onClick={() => {
                    // 取消单据类 = L2（UI 规范 §7）。
                    modal.confirm({
                      title: `取消回款单 ${selectedRow.payoutNo}？`,
                      content:
                        '仅草稿可取消；取消不产生任何流水。已确认的回款错账请在收支流水中冲正。',
                      okText: '取消回款单',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        cancelMutation.mutate(selectedRow.id);
                      },
                    });
                  }}
                >
                  取消回款单
                </Button>
              </>
            )}
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, modal, cancelMutation.isPending]);

  useContextRail(railContent);

  const previewData = preview.data?.data ?? null;

  return (
    <div>
      <PageHeader
        title="平台回款"
        description="登记平台打款批次，对账预览后确认；确认自动生成关联的销售收入流水（finance.md §4）"
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setCreateOpen(true);
            }}
          >
            登记回款
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="回款单号"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 220 }}
          aria-label="搜索回款单"
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          options={Object.entries(FINANCE_PAYOUT_STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<PayoutRow>
          rowKey="id"
          loading={list.isLoading}
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
          emptyTitle="暂无回款"
          emptyDescription="平台打款到账后在这里登记批次，确认后自动计入收入。"
          columns={[
            { title: '回款单号', dataIndex: 'payoutNo', key: 'payoutNo', width: 110 },
            {
              title: '店铺',
              key: 'store',
              render: (_: unknown, row: PayoutRow) => row.storeName ?? '—',
            },
            {
              title: '对账期间',
              key: 'period',
              width: 200,
              render: (_: unknown, row: PayoutRow) =>
                `${fmtDate(row.periodStart)} ~ ${fmtDate(row.periodEnd)}`,
            },
            {
              title: '打款金额',
              dataIndex: 'amount',
              key: 'amount',
              width: 130,
              align: 'right' as const,
              render: (value: string, row: PayoutRow) => (
                <span style={{ color: colors.success, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(value, row.currency)}
                </span>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 100,
              render: (value: string) => {
                const meta = FINANCE_PAYOUT_STATUS_META[value];
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
              title: '登记时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={previewOpen && selectedRow !== null}
        onClose={() => setPreviewOpen(false)}
        size={640}
        title={selectedRow !== null ? `对账预览 · ${selectedRow.payoutNo}` : '对账预览'}
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {previewData !== null && (
          <>
            <ContextSection title="对账结果">
              <ContextMetric
                label="平台打款金额"
                value={fmtMoney(previewData.payout.amount, previewData.payout.currency)}
                strong
              />
              <ContextMetric
                label="期间已结算收入"
                value={fmtMoney(previewData.settledRevenue, previewData.payout.currency)}
              />
              <ContextMetric label="已结算订单数" value={`${previewData.settledOrderCount} 单`} />
              <ContextMetric
                label="差异（打款 − 应计）"
                value={fmtMoney(previewData.difference, previewData.payout.currency)}
              />
            </ContextSection>
            <div style={{ fontSize: 12.5, color: colors.textSecondary, margin: '12px 0 16px' }}>
              差异来自平台佣金、物流补贴或未结算订单，属正常现象；由人工判断后确认，系统不做自动阻断。
            </div>
            <Button
              type="primary"
              block
              loading={confirmMutation.isPending}
              onClick={() => {
                modal.confirm({
                  title: `确认回款 ${previewData.payout.payoutNo}？`,
                  content: '确认后将生成一笔不可修改的销售收入流水；错账只能冲正。',
                  okText: '确认回款',
                  cancelText: '返回',
                  onOk: () => {
                    confirmMutation.mutate(previewData.payout.id);
                    setPreviewOpen(false);
                  },
                });
              }}
            >
              确认回款
            </Button>
          </>
        )}
      </Drawer>

      <Modal
        title="登记平台回款"
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
          <Form.Item
            name="storeId"
            label="店铺"
            rules={[{ required: true, message: '请选择店铺' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择打款店铺"
              options={(stores.data?.data ?? []).map((store) => ({
                value: store.id,
                label: `${store.code} · ${store.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="period"
            label="对账期间"
            rules={[{ required: true, message: '请选择对账期间' }]}
          >
            <DatePicker.RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item
              name="amount"
              label="打款金额"
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
                ]}
              />
            </Form.Item>
          </div>
          <Form.Item name="remark" label="备注">
            <Input.TextArea maxLength={2000} rows={2} placeholder="如：OZON 结算单 #12345" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
