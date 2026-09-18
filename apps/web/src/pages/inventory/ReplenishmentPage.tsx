import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Input, InputNumber, Select, Space } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
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
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Replenishment suggestions (Sprint 10 T4): advisory derivation over shipped
 * velocity / sellable stock / safety stock / open POs. One click registers a
 * covering purchase order for a SKU - the decision stays human.
 */

interface SuggestionRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
  availableQty: string;
  safetyQty: string;
  shippedInWindowQty: string;
  dailyVelocityQty: string;
  openPoQty: string;
  suggestedQty: string;
  needsReplenishment: boolean;
}

type Envelope<T> = { data: T; meta: { total: number } };

export function ReplenishmentPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [windowDays, setWindowDays] = useState(30);
  const [coverDays, setCoverDays] = useState(14);
  const [onlyAlert, setOnlyAlert] = useState(true);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);

  const list = useApiQuery<Envelope<SuggestionRow[]>>(
    '/api/v1/inventory/replenishment-suggestions',
    {
      page,
      pageSize: 50,
      windowDays,
      coverDays,
      onlyAlert: String(onlyAlert),
      ...(keyword ? { keyword } : {}),
    },
    ['replenishment', page, keyword, windowDays, coverDays, onlyAlert],
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.skuId === selectedSkuId) ?? null,
    [rows, selectedSkuId],
  );

  const createPoMutation = useMutation({
    mutationFn: (row: SuggestionRow) =>
      apiPost<{ poNo: string }>('/api/v1/purchase-orders', {
        sourceNote: `补货建议（销速窗口 ${windowDays} 天 / 覆盖 ${coverDays} 天）`,
        items: [{ skuId: row.skuId, quantity: row.suggestedQty }],
      }),
    onSuccess: (result) => {
      void message.success(`采购单 ${result.poNo} 已登记，可在采购模块确认与收货`);
      void queryClient.invalidateQueries({ queryKey: ['replenishment'] });
      void queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="补货概览">
            <ContextMetric label="建议补货 SKU" value={`${list.data?.meta.total ?? 0} 个`} />
            <RailHint>
              建议 = 窗口内日均销速 × 覆盖天数 + 安全库存 − 可售库存 −
              在途采购；它只是建议，最终采购由人决定。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.skuCode}
          subtitle={selectedRow.skuName}
          badge={
            <StatusBadge
              tone={selectedRow.needsReplenishment ? 'warning' : 'success'}
              label={selectedRow.needsReplenishment ? '建议补货' : '库存健康'}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="库存与销速">
            <ContextMetric
              label="现存 / 可售"
              value={`${Number(selectedRow.onHandQty)} / ${Number(selectedRow.availableQty)}`}
            />
            <ContextMetric
              label="占用（预留+已拣）"
              value={String(Number(selectedRow.reservedQty) + Number(selectedRow.pickedQty))}
            />
            <ContextMetric label="安全库存" value={Number(selectedRow.safetyQty)} />
            <ContextMetric
              label={`窗口销速（日均）`}
              value={Number(selectedRow.dailyVelocityQty)}
              strong
            />
            <ContextMetric label="在途采购" value={Number(selectedRow.openPoQty)} />
            <ContextMetric label="建议采购量" value={Number(selectedRow.suggestedQty)} strong />
          </ContextSection>
          <ContextSection title="操作区">
            <Button
              block
              type="primary"
              icon={<ShoppingCartOutlined />}
              disabled={!selectedRow.needsReplenishment}
              loading={createPoMutation.isPending}
              onClick={() => createPoMutation.mutate(selectedRow)}
            >
              按建议登记采购
            </Button>
          </ContextSection>
        </>
      ),
    };
  }, [selectedRow, list.data, windowDays, coverDays, createPoMutation.isPending]);

  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="补货建议"
        description="按近期销速、可售库存、安全库存与在途采购推导的补货清单；一键登记采购单"
      />

      <FilterBar>
        <Input.Search
          placeholder="SKU 编码 / 名称"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 220 }}
          aria-label="搜索补货建议"
        />
        <Space>
          <span style={{ fontSize: 12.5, color: colors.textSecondary }}>销速窗口</span>
          <InputNumber
            min={1}
            max={365}
            value={windowDays}
            onChange={(value) => {
              setPage(1);
              setWindowDays(value ?? 30);
            }}
            addonAfter="天"
            style={{ width: 120 }}
          />
          <span style={{ fontSize: 12.5, color: colors.textSecondary }}>覆盖</span>
          <InputNumber
            min={0}
            max={365}
            value={coverDays}
            onChange={(value) => {
              setPage(1);
              setCoverDays(value ?? 14);
            }}
            addonAfter="天"
            style={{ width: 120 }}
          />
        </Space>
        <Select
          style={{ width: 140 }}
          value={onlyAlert ? 'alert' : 'all'}
          onChange={(value) => {
            setPage(1);
            setOnlyAlert(value === 'alert');
          }}
          options={[
            { value: 'alert', label: '仅显示需补货' },
            { value: 'all', label: '显示全部 SKU' },
          ]}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<SuggestionRow>
          rowKey="skuId"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 个 SKU`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedSkuId(record.skuId === selectedSkuId ? null : record.skuId),
            style: {
              cursor: 'pointer',
              background: record.skuId === selectedSkuId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无补货建议"
          emptyDescription="当前口径下所有 SKU 的库存覆盖充足；可切换为「显示全部 SKU」查看明细。"
          columns={[
            {
              title: 'SKU',
              key: 'sku',
              render: (_: unknown, row: SuggestionRow) => (
                <div>
                  <div style={{ fontWeight: 550 }}>{row.skuCode}</div>
                  <div style={{ fontSize: 12.5, color: colors.textSecondary }}>{row.skuName}</div>
                </div>
              ),
            },
            {
              title: '可售',
              dataIndex: 'availableQty',
              key: 'availableQty',
              width: 90,
              align: 'right' as const,
              render: (value: string) => Number(value),
            },
            {
              title: '安全库存',
              dataIndex: 'safetyQty',
              key: 'safetyQty',
              width: 90,
              align: 'right' as const,
              render: (value: string) => Number(value),
            },
            {
              title: '日均销速',
              dataIndex: 'dailyVelocityQty',
              key: 'dailyVelocityQty',
              width: 90,
              align: 'right' as const,
              render: (value: string) => Number(value),
            },
            {
              title: '在途采购',
              dataIndex: 'openPoQty',
              key: 'openPoQty',
              width: 90,
              align: 'right' as const,
              render: (value: string) => Number(value),
            },
            {
              title: '建议采购',
              dataIndex: 'suggestedQty',
              key: 'suggestedQty',
              width: 100,
              align: 'right' as const,
              render: (value: string, row: SuggestionRow) =>
                row.needsReplenishment ? (
                  <span style={{ color: colors.warning, fontWeight: 600 }}>{Number(value)}</span>
                ) : (
                  '—'
                ),
            },
            {
              title: '状态',
              dataIndex: 'needsReplenishment',
              key: 'needs',
              width: 100,
              render: (value: boolean) =>
                value ? (
                  <StatusBadge tone="warning" label="建议补货" showDot={false} />
                ) : (
                  <StatusBadge tone="success" label="库存健康" showDot={false} />
                ),
            },
          ]}
        />
      </SectionCard>
    </div>
  );
}
