import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Drawer, Input, InputNumber, Modal, Form } from 'antd';
import { CloudSyncOutlined } from '@ant-design/icons';
import { apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtMoney } from '../../utils/format';
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

/**
 * Order settlements (Sprint 10 T5, finance.md §5): per-order revenue/cost/
 * profit snapshots for shipped orders. Generation is manual/bulk (never
 * automatic), idempotent per order; only the fee columns stay editable.
 */

interface SettlementRow {
  id: string;
  orderId: string;
  orderNo: string;
  platformOrderId: string;
  storeId: string;
  storeName: string | null;
  orderedAt: string;
  currency: string | null;
  revenueTotal: string;
  productCostTotal: string;
  shippingFee: string;
  otherFee: string;
  profit: string | null;
  hasMissingPrice: boolean;
  hasMissingCost: boolean;
  generatedAt: string;
}

interface SettlementItem {
  id: string;
  skuId: string | null;
  quantity: string;
  unitPrice: string | null;
  revenue: string;
  unitCost: string | null;
  cost: string;
}

interface FeesFormValues {
  shippingFee?: number;
  otherFee?: number;
}

type Envelope<T> = { data: T; meta: { total: number } };

export function FinanceSettlementsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [feesOpen, setFeesOpen] = useState(false);
  const [feesForm] = Form.useForm<FeesFormValues>();

  const list = useApiQuery<Envelope<SettlementRow[]>>(
    '/api/v1/finance/settlements',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
    },
    ['finance-settlements', page, keyword],
  );

  const detail = useApiQuery<{
    data: Omit<
      SettlementRow,
      'orderNo' | 'platformOrderId' | 'storeId' | 'storeName' | 'orderedAt'
    > & {
      items: SettlementItem[];
    };
  }>(
    '/api/v1/finance/settlements/{id}',
    {},
    ['finance-settlement-detail', detailId],
    { id: detailId ?? '' },
    detailId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = detail.data?.data ?? null;

  const generateMissingMutation = useMutation({
    mutationFn: () =>
      apiPost<{ generated: number; skipped: number }>(
        '/api/v1/finance/settlements/generate-missing',
        {},
      ),
    onSuccess: (result) => {
      void message.success(`已生成 ${result.generated} 笔结算（跳过 ${result.skipped} 笔）`);
      void queryClient.invalidateQueries({ queryKey: ['finance-settlements'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const feesMutation = useMutation({
    mutationFn: (input: { id: string; values: FeesFormValues }) =>
      apiPatch<{ profit: string | null }>(
        '/api/v1/finance/settlements/{id}/fees',
        {
          ...(input.values.shippingFee !== undefined && input.values.shippingFee !== null
            ? { shippingFee: String(input.values.shippingFee) }
            : {}),
          ...(input.values.otherFee !== undefined && input.values.otherFee !== null
            ? { otherFee: String(input.values.otherFee) }
            : {}),
        },
        { id: input.id },
      ),
    onSuccess: (result) => {
      void message.success(`费用已更新，毛利 ${result.profit ?? '—（跨币种不计算）'}`);
      setFeesOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['finance-settlements'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-settlement-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['finance-summary'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="结算概览">
            <ContextMetric label="已结算订单" value={`${list.data?.meta.total ?? 0} 单`} />
            <RailHint>
              只有已发货的订单能生成结算；成本在生成时点冻结（移动加权平均），此后调价不影响历史毛利。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.orderNo}
          subtitle={selectedRow.storeName ?? '—'}
          badge={
            <StatusBadge
              tone={selectedRow.profit === null ? 'warning' : 'success'}
              label={selectedRow.profit === null ? '跨币种' : '已结算'}
              hint={selectedRow.currency ?? undefined}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="结算金额">
            <ContextMetric
              label="收入"
              value={fmtMoney(selectedRow.revenueTotal, selectedRow.currency)}
            />
            <ContextMetric label="商品成本" value={fmtMoney(selectedRow.productCostTotal, 'CNY')} />
            <ContextMetric label="物流费" value={fmtMoney(selectedRow.shippingFee, 'CNY')} />
            <ContextMetric label="其他费用" value={fmtMoney(selectedRow.otherFee, 'CNY')} />
            <ContextMetric
              label="毛利"
              value={
                selectedRow.profit === null
                  ? '—（币种不同不计算）'
                  : fmtMoney(selectedRow.profit, selectedRow.currency)
              }
              strong
            />
            <ContextMetric label="下单时间" value={fmtDateTime(selectedRow.orderedAt)} />
            <ContextMetric label="生成时间" value={fmtDateTime(selectedRow.generatedAt)} />
          </ContextSection>
          <ContextSection title="数据完整度">
            <ContextMetric
              label="价格事实"
              value={selectedRow.hasMissingPrice ? '存在缺价行' : '完整'}
            />
            <ContextMetric
              label="成本事实"
              value={selectedRow.hasMissingCost ? '存在无成本行' : '完整'}
            />
          </ContextSection>
          <ContextSection title="操作区">
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            <Button
              block
              style={{ marginTop: 8 }}
              onClick={() => {
                feesForm.setFieldsValue({
                  shippingFee: Number(selectedRow.shippingFee),
                  otherFee: Number(selectedRow.otherFee),
                });
                setFeesOpen(true);
              }}
            >
              修改费用
            </Button>
          </ContextSection>
        </>
      ),
    };
  }, [selectedRow, list.data, feesForm]);

  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="订单结算"
        description="已发货订单的收入 / 成本 / 毛利快照；成本按生成时点的移动加权平均冻结（finance.md §5）"
        primary={
          <Button
            type="primary"
            icon={<CloudSyncOutlined />}
            loading={generateMissingMutation.isPending}
            onClick={() => generateMissingMutation.mutate()}
          >
            生成缺失结算
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="订单号 / 平台订单号"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索结算"
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<SettlementRow>
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
            onDoubleClick: () => setDetailId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无结算"
          emptyDescription="点击「生成缺失结算」为全部已发货订单生成毛利快照。"
          columns={[
            { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 120 },
            {
              title: '店铺',
              key: 'store',
              render: (_: unknown, row: SettlementRow) => row.storeName ?? '—',
            },
            {
              title: '收入',
              dataIndex: 'revenueTotal',
              key: 'revenueTotal',
              width: 110,
              align: 'right' as const,
              render: (value: string, row: SettlementRow) => (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(value, row.currency)}
                </span>
              ),
            },
            {
              title: '商品成本',
              dataIndex: 'productCostTotal',
              key: 'productCostTotal',
              width: 110,
              align: 'right' as const,
              render: (value: string) => (
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(value, 'CNY')}</span>
              ),
            },
            {
              title: '费用',
              key: 'fees',
              width: 110,
              align: 'right' as const,
              render: (_: unknown, row: SettlementRow) =>
                fmtMoney(
                  String(Number(row.shippingFee) + Number(row.otherFee)).padStart(1, '0'),
                  'CNY',
                ),
            },
            {
              title: '毛利',
              dataIndex: 'profit',
              key: 'profit',
              width: 110,
              align: 'right' as const,
              render: (value: string | null, row: SettlementRow) =>
                value === null ? (
                  '—'
                ) : (
                  <span
                    style={{
                      color: Number(value) >= 0 ? colors.success : colors.danger,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtMoney(value, row.currency)}
                  </span>
                ),
            },
            {
              title: '完整度',
              key: 'completeness',
              width: 130,
              render: (_: unknown, row: SettlementRow) => (
                <>
                  {row.hasMissingPrice && (
                    <StatusBadge
                      tone="warning"
                      label="缺价"
                      hint="订单行无平台价格"
                      showDot={false}
                    />
                  )}
                  {row.hasMissingCost && (
                    <StatusBadge
                      tone="warning"
                      label="无成本"
                      hint="SKU 无移动加权成本"
                      showDot={false}
                    />
                  )}
                  {!row.hasMissingPrice && !row.hasMissingCost && '—'}
                </>
              ),
            },
            {
              title: '生成时间',
              dataIndex: 'generatedAt',
              key: 'generatedAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailId !== null && detailRow !== null}
        onClose={() => setDetailId(null)}
        size={760}
        title={
          selectedRow !== null && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>结算 · {selectedRow.orderNo}</span>
          )
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== null && (
          <>
            <ContextSection title="结算信息">
              <ContextMetric
                label="收入合计"
                value={fmtMoney(detailRow.revenueTotal, detailRow.currency)}
              />
              <ContextMetric label="成本合计" value={fmtMoney(detailRow.productCostTotal, 'CNY')} />
              <ContextMetric label="物流费" value={fmtMoney(detailRow.shippingFee, 'CNY')} />
              <ContextMetric label="其他费用" value={fmtMoney(detailRow.otherFee, 'CNY')} />
              <ContextMetric
                label="毛利"
                value={
                  detailRow.profit === null
                    ? '—（币种不同不计算）'
                    : fmtMoney(detailRow.profit, detailRow.currency)
                }
                strong
              />
            </ContextSection>
            <SectionCard title="行快照（生成时点冻结）" flush>
              <DataTable<SettlementItem>
                rowKey="id"
                dataSource={detailRow.items}
                pagination={false}
                emptyTitle="无明细"
                columns={[
                  {
                    title: '数量',
                    dataIndex: 'quantity',
                    key: 'quantity',
                    width: 80,
                    align: 'right' as const,
                  },
                  {
                    title: '单价',
                    dataIndex: 'unitPrice',
                    key: 'unitPrice',
                    width: 100,
                    align: 'right' as const,
                    render: (value: string | null) =>
                      value === null ? (
                        <StatusBadge tone="warning" label="缺价" showDot={false} />
                      ) : (
                        fmtMoney(value, detailRow.currency ?? 'CNY')
                      ),
                  },
                  {
                    title: '收入',
                    dataIndex: 'revenue',
                    key: 'revenue',
                    width: 110,
                    align: 'right' as const,
                    render: (value: string) => fmtMoney(value, detailRow.currency ?? 'CNY'),
                  },
                  {
                    title: '单位成本',
                    dataIndex: 'unitCost',
                    key: 'unitCost',
                    width: 100,
                    align: 'right' as const,
                    render: (value: string | null) =>
                      value === null ? (
                        <StatusBadge tone="warning" label="无成本" showDot={false} />
                      ) : (
                        fmtMoney(value, 'CNY')
                      ),
                  },
                  {
                    title: '成本',
                    dataIndex: 'cost',
                    key: 'cost',
                    width: 110,
                    align: 'right' as const,
                    render: (value: string) => fmtMoney(value, 'CNY'),
                  },
                ]}
              />
            </SectionCard>
          </>
        )}
      </Drawer>

      <Modal
        title="修改结算费用"
        open={feesOpen}
        onCancel={() => setFeesOpen(false)}
        onOk={() => {
          if (selectedRow === null) {
            return;
          }
          void feesForm
            .validateFields()
            .then((values) => feesMutation.mutate({ id: selectedRow.id, values }));
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={feesMutation.isPending}
        width={480}
        destroyOnHidden
      >
        <Form form={feesForm} layout="vertical" preserve={false}>
          <Form.Item name="shippingFee" label="物流费（CNY）">
            <InputNumber min={0} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="otherFee" label="其他费用（CNY，佣金/包装等）">
            <InputNumber min={0} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
            保存后自动重算毛利；行快照（价格与成本）不可修改。
          </div>
        </Form>
      </Modal>
    </div>
  );
}
