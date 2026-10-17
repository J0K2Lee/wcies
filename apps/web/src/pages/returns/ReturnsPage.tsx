import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Tabs,
  Tooltip,
} from 'antd';
import { CloudSyncOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  RETURN_BATCH_STATUS_META,
  RETURN_CONDITION_META,
  SectionCard,
  StatusBadge,
  colors,
  RelativeTime,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

/**
 * Returns workbench (dual-axis T5, docs/business-rules/returns.md):
 *
 * - Tab 1 platform return records: pull-only facts from the platform
 *   (manual sync). Unlinked rows (no batch line yet) are the reconciliation
 *   to-do list; unknown order references surface as RETURN_ORDER_NOT_FOUND
 *   in the exception center.
 * - Tab 2 return batches: the physical work documents. Create (optionally
 *   from pending platform records) -> receive -> per-line inspection
 *   (SELLABLE/DEFECTIVE/LOST - inspection is the only stock write-back).
 */

type Envelope<T> = { data: T; meta: { total: number } };

interface PlatformReturnRow {
  id: string;
  storeId: string;
  platformReturnId: string;
  platformOrderId: string | null;
  orderId: string | null;
  state: string | null;
  refundState: string | null;
  platformSkuId: string | null;
  quantity: string;
  platformCreatedAt: string | null;
  createdAt: string;
}

interface ReturnBatchItemRow {
  id: string;
  batchId: string;
  platformReturnId: string | null;
  platformReturnNo: string | null;
  skuId: string;
  quantity: string;
  condition: string;
  binId: string | null;
  remark: string | null;
}

interface ReturnBatchRow {
  id: string;
  batchNo: string;
  warehouseId: string;
  status: string;
  sourceNote: string | null;
  itemCount: number;
  createdAt: string;
}

interface ReturnBatchDetail extends ReturnBatchRow {
  items: ReturnBatchItemRow[];
}

const BATCH_STATUS_META = RETURN_BATCH_STATUS_META;
const CONDITION_META = RETURN_CONDITION_META;

export function ReturnsPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('platform');
  const [storeId, setStoreId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [platformPage, setPlatformPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<{
    warehouseId: string;
    sourceNote?: string;
    items: Array<{ platformReturnId?: string; skuId?: string; quantity: string }>;
  }>();

  const storesQuery = useApiQuery<
    Envelope<Array<{ id: string; name: string; storeCode: string; platformCode: string }>>
  >('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-for-returns']);

  const warehousesQuery = useApiQuery<
    Envelope<Array<{ id: string; name: string; warehouseCode: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-for-returns']);

  const platformReturns = useApiQuery<Envelope<PlatformReturnRow[]>>(
    '/api/v1/returns/platform',
    { page: platformPage, pageSize: 50, ...(storeId ? { storeId } : {}) },
    ['platform-returns', platformPage, storeId],
  );

  /** Pending reconciliation: records no batch line consumed yet. */
  const pendingReturns = useApiQuery<Envelope<PlatformReturnRow[]>>(
    '/api/v1/returns/platform',
    { page: 1, pageSize: 100, linked: 'false', ...(storeId ? { storeId } : {}) },
    ['platform-returns-pending', storeId],
  );

  const batches = useApiQuery<Envelope<ReturnBatchRow[]>>(
    '/api/v1/returns/batches',
    { page, pageSize: 20 },
    ['return-batches', page],
  );

  /** SKU master feed: resolves batch-line skuId (UUID) to seller-facing codes. */
  const skusLite = useApiQuery<Envelope<Array<{ id: string; skuCode: string; nameZh: string }>>>(
    '/api/v1/skus',
    { page: 1, pageSize: 100 },
    ['skus-for-returns'],
  );
  const skuCodeOf = (skuId: string): string =>
    (skusLite.data?.data ?? []).find((sku) => sku.id === skuId)?.skuCode ?? '—';

  const detailQuery = useApiQuery<Envelope<ReturnBatchDetail>>(
    '/api/v1/returns/batches/{id}',
    {},
    ['return-batch-detail', detailId],
    detailId === null ? undefined : { id: detailId },
    detailId !== null,
  );
  const detail = detailId !== null ? detailQuery.data?.data : undefined;

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform-returns'] });
    void queryClient.invalidateQueries({ queryKey: ['return-batches'] });
    void queryClient.invalidateQueries({ queryKey: ['return-batch-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
  };

  const syncMutation = useMutation({
    mutationFn: () =>
      apiPost<{ created: number; unlinkable: number }>('/api/v1/returns/platform/sync', {
        storeId,
      }),
    onSuccess: (result) => {
      message.success(
        `同步完成：新增 ${result.created} 条${result.unlinkable > 0 ? `，${result.unlinkable} 条无法关联订单（已建异常）` : ''}`,
      );
      invalidateAll();
    },
    onError: (error: Error) => message.error(`同步失败：${error.message}`),
  });

  const createMutation = useMutation({
    mutationFn: (values: {
      warehouseId: string;
      sourceNote?: string;
      items: Array<{ platformReturnId?: string; skuId?: string; quantity: string }>;
    }) => apiPost<ReturnBatchDetail>('/api/v1/returns/batches', values),
    onSuccess: (result) => {
      message.success(`退货批次已创建：${result.batchNo}`);
      setCreateOpen(false);
      createForm.resetFields();
      invalidateAll();
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
  });

  const receiveMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<ReturnBatchRow>(`/api/v1/returns/batches/{id}/receive`, {}, { id }),
    onSuccess: (result) => {
      message.success(`批次 ${result.batchNo} 已确认收货，可开始检验`);
      invalidateAll();
    },
    onError: (error: Error) => message.error(`收货失败：${error.message}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<ReturnBatchRow>(`/api/v1/returns/batches/{id}/cancel`, {}, { id }),
    onSuccess: () => {
      message.success('批次已取消（未产生任何库存动作）');
      invalidateAll();
    },
    onError: (error: Error) => message.error(`取消失败：${error.message}`),
  });

  const inspectMutation = useMutation({
    mutationFn: (input: { itemId: string; condition: 'SELLABLE' | 'DEFECTIVE' | 'LOST' }) =>
      apiPost<ReturnBatchItemRow>(
        `/api/v1/returns/items/{itemId}/inspect`,
        { condition: input.condition },
        { itemId: input.itemId },
      ),
    onSuccess: (result) => {
      message.success(`检验完成：${CONDITION_META[result.condition]?.label ?? result.condition}`);
      invalidateAll();
    },
    onError: (error: Error) => message.error(`检验失败：${error.message}`),
  });

  const pendingList = pendingReturns.data?.data ?? [];
  const batchList = batches.data?.data ?? [];
  const selectedBatch =
    selectedBatchId !== null ? (batchList.find((row) => row.id === selectedBatchId) ?? null) : null;

  // ---- Context rail: batch workbench (entity type when a row is selected) ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedBatch === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="退货概览">
            <ContextMetric label="待收货平台记录" value={`${pendingList.length} 条`} />
            <ContextMetric
              label="退货批次（当前筛选）"
              value={`${batches.data?.meta.total ?? 0} 个`}
            />
            <RailHint>
              「退货批次」页签下点击批次行查看详情；确认收货 / 取消批次在右栏操作。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedBatch.batchNo}
          subtitle={
            warehousesQuery.data?.data.find((wh) => wh.id === selectedBatch.warehouseId)
              ?.warehouseCode ?? selectedBatch.warehouseId
          }
          badge={
            <StatusBadge
              tone={BATCH_STATUS_META[selectedBatch.status]?.tone ?? 'neutral'}
              label={BATCH_STATUS_META[selectedBatch.status]?.label ?? selectedBatch.status}
              hint={selectedBatch.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="批次概况">
            <ContextMetric label="明细行" value={selectedBatch.itemCount} />
            <ContextMetric label="来源说明" value={selectedBatch.sourceNote ?? '—'} />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedBatch.id)}>
              查看详情
            </Button>
            {selectedBatch.status === 'DRAFT' && (
              <>
                <Button
                  type="primary"
                  block
                  style={{ marginTop: 8 }}
                  loading={receiveMutation.isPending}
                  onClick={() => {
                    // 确认收货 = L2：modal.confirm + danger ok。
                    modal.confirm({
                      title: `确认收货 ${selectedBatch.batchNo}？`,
                      content: '实物已到退货仓并清点完毕；确认后行不可增删，可开始检验。',
                      okText: '确认收货',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        receiveMutation.mutate(selectedBatch.id);
                      },
                    });
                  }}
                >
                  确认收货
                </Button>
                <Button
                  danger
                  block
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    // 取消批次 = L2：modal.confirm + danger ok。
                    modal.confirm({
                      title: `取消批次 ${selectedBatch.batchNo}？`,
                      content: '仅草稿可取消；未产生任何库存动作。',
                      okText: '取消批次',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        cancelMutation.mutate(selectedBatch.id);
                      },
                    });
                  }}
                >
                  取消批次
                </Button>
              </>
            )}
          </ContextAction>
        </>
      ),
    };
    // mutation 对象以 isPending / mutate（稳定引用）承载依赖（规范 §4.4）。
  }, [
    selectedBatch,
    pendingList.length,
    batches.data,
    warehousesQuery.data,
    receiveMutation.isPending,
    receiveMutation.mutate,
    cancelMutation.isPending,
    cancelMutation.mutate,
    modal,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="退货管理"
        description="平台退货记录（只读事实）与退货批次（实物回流：检验后回库）"
        extra={
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setPage(1);
              setPlatformPage(1);
              setActiveTab(key);
            }}
            items={[
              { key: 'platform', label: `平台退货记录 (${platformReturns.data?.meta.total ?? 0})` },
              { key: 'batches', label: `退货批次 (${batches.data?.meta.total ?? 0})` },
            ]}
          />
        }
        primary={
          activeTab === 'platform' ? (
            <Tooltip title="从平台拉取 rFBS 退货记录（OZON /v2/returns/rfbs/list，只读；不写库存）">
              <Button
                type="primary"
                icon={<CloudSyncOutlined />}
                disabled={storeId === undefined}
                loading={syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
              >
                同步退货记录
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                createForm.setFieldsValue({
                  warehouseId: warehousesQuery.data?.data[0]?.id,
                  items: [{ quantity: '1' }],
                });
                setCreateOpen(true);
              }}
            >
              新建退货批次
            </Button>
          )
        }
      />

      {activeTab === 'platform' && (
        <FilterBar>
          <Select
            allowClear
            placeholder="店铺"
            style={{ width: 220 }}
            showSearch
            optionFilterProp="label"
            options={(storesQuery.data?.data ?? []).map((store) => ({
              value: store.id,
              label: `${store.storeCode} · ${store.name}`,
            }))}
            value={storeId}
            onChange={(value) => {
              setPlatformPage(1);
              setStoreId(value);
            }}
          />
        </FilterBar>
      )}

      {activeTab === 'platform' && (
        <SectionCard flush>
          <DataTable<PlatformReturnRow>
            rowKey="id"
            loading={platformReturns.isLoading}
            error={platformReturns.error}
            onRetry={() => void platformReturns.refetch()}
            dataSource={platformReturns.data?.data ?? []}
            pagination={{
              current: platformPage,
              pageSize: 50,
              total: platformReturns.data?.meta.total ?? 0,
              onChange: setPlatformPage,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
            }}
            emptyTitle="暂无平台退货记录"
            emptyDescription="选择店铺后点「同步退货记录」拉取平台 rFBS 退货。"
            columns={[
              {
                title: '退货单号',
                dataIndex: 'platformReturnId',
                key: 'platformReturnId',
                width: 160,
              },
              {
                title: '平台订单',
                dataIndex: 'platformOrderId',
                key: 'platformOrderId',
                width: 180,
                render: (value: string | null, row: PlatformReturnRow) =>
                  value === null ? (
                    '—'
                  ) : row.orderId === null ? (
                    <Tooltip title="该订单在系统内不存在（RETURN_ORDER_NOT_FOUND，去异常中心处理）">
                      <span style={{ color: colors.danger }}>{value} ⚠</span>
                    </Tooltip>
                  ) : (
                    value
                  ),
              },
              {
                title: '平台状态',
                dataIndex: 'state',
                key: 'state',
                width: 190,
                // OZON 退货状态是平台原文事实（俄语自由文本，无稳定枚举）：
                // 徽标化但保持 neutral + 原文展示（Phase 3 T3）。
                render: (value: string | null) =>
                  value === null ? (
                    '—'
                  ) : (
                    <StatusBadge tone="neutral" label={value} hint="平台原文状态" showDot={false} />
                  ),
              },
              {
                title: '退款状态',
                dataIndex: 'refundState',
                key: 'refundState',
                width: 160,
                render: (value: string | null) =>
                  value === null ? (
                    '—'
                  ) : (
                    <StatusBadge
                      tone="neutral"
                      label={value}
                      hint="平台原文退款状态（仅展示）"
                      showDot={false}
                    />
                  ),
              },
              {
                title: '平台SKU',
                dataIndex: 'platformSkuId',
                key: 'platformSkuId',
                width: 140,
                render: (value: string | null) => value ?? '—',
              },
              {
                title: '退货时间',
                dataIndex: 'platformCreatedAt',
                key: 'platformCreatedAt',
                width: 160,
                render: (value: string | null) => <RelativeTime value={value} fallback="—" />,
              },
            ]}
          />
        </SectionCard>
      )}

      {activeTab === 'batches' && (
        <>
          <FilterBar>
            <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
              待收货平台记录 {pendingList.length} 条可在建批时直接带入（对账锚点单次消费）
            </span>
          </FilterBar>
          <SectionCard flush>
            <DataTable<ReturnBatchRow>
              rowKey="id"
              loading={batches.isLoading}
              error={batches.error}
              onRetry={() => void batches.refetch()}
              dataSource={batchList}
              pagination={{
                current: page,
                pageSize: 20,
                total: batches.data?.meta.total ?? 0,
                onChange: setPage,
                showTotal: (total) => `共 ${total} 个批次`,
              }}
              emptyTitle="暂无退货批次"
              emptyDescription="新建批次登记一批退回实物，收货后逐行检验回库。"
              onRow={(record) => ({
                onClick: () => setSelectedBatchId(record.id === selectedBatchId ? null : record.id),
                onDoubleClick: () => setDetailId(record.id),
                style: {
                  cursor: 'pointer',
                  background: record.id === selectedBatchId ? colors.primarySoft : undefined,
                },
              })}
              columns={[
                { title: '批次号', dataIndex: 'batchNo', key: 'batchNo', width: 130 },
                {
                  title: '仓库',
                  dataIndex: 'warehouseId',
                  key: 'warehouseId',
                  width: 140,
                  render: (value: string) =>
                    warehousesQuery.data?.data.find((wh) => wh.id === value)?.warehouseCode ??
                    warehousesQuery.data?.data.find((wh) => wh.id === value)?.name ??
                    value,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 110,
                  render: (value: string) => (
                    <StatusBadge
                      tone={BATCH_STATUS_META[value]?.tone ?? 'neutral'}
                      label={BATCH_STATUS_META[value]?.label ?? value}
                      hint={value}
                      showDot={false}
                    />
                  ),
                },
                {
                  title: '行数',
                  dataIndex: 'itemCount',
                  key: 'itemCount',
                  width: 70,
                  align: 'right' as const,
                },
                {
                  title: '来源说明',
                  dataIndex: 'sourceNote',
                  key: 'sourceNote',
                  render: (value: string | null) => value ?? '—',
                },
                {
                  title: '创建时间',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  width: 160,
                  render: (value: string) => <RelativeTime value={value} />,
                },
              ]}
            />
          </SectionCard>
        </>
      )}

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={880}
        title={detail !== undefined ? `退货批次 ${detail.batchNo}` : '退货批次'}
        destroyOnHidden
      >
        {detail === undefined ? (
          <span style={{ color: colors.textTertiary }}>加载中…</span>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
              <StatusBadge
                tone={BATCH_STATUS_META[detail.status]?.tone ?? 'neutral'}
                label={BATCH_STATUS_META[detail.status]?.label ?? detail.status}
                hint={detail.status}
                showDot={false}
              />
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                {detail.sourceNote ?? ''}
              </span>
            </div>
            <DataTable<ReturnBatchItemRow>
              rowKey="id"
              dataSource={detail.items}
              pagination={false}
              emptyTitle="无明细"
              columns={[
                {
                  title: '#',
                  key: 'index',
                  width: 40,
                  render: (_: unknown, __: ReturnBatchItemRow, index: number) => index + 1,
                },
                {
                  title: '来源',
                  key: 'source',
                  width: 150,
                  render: (_: unknown, row: ReturnBatchItemRow) =>
                    row.platformReturnNo === null ? (
                      <StatusBadge tone="neutral" label="人工登记" showDot={false} />
                    ) : (
                      row.platformReturnNo
                    ),
                },
                {
                  title: 'SKU',
                  dataIndex: 'skuId',
                  key: 'skuId',
                  width: 140,
                  render: (value: string) => skuCodeOf(value),
                },
                {
                  title: '数量',
                  dataIndex: 'quantity',
                  key: 'quantity',
                  width: 80,
                  align: 'right' as const,
                  render: (value: string) => Number(value),
                },
                {
                  title: '检验结论',
                  dataIndex: 'condition',
                  key: 'condition',
                  width: 150,
                  render: (value: string) => (
                    <StatusBadge
                      tone={CONDITION_META[value]?.tone ?? 'neutral'}
                      label={CONDITION_META[value]?.label ?? value}
                      hint={value}
                      showDot={false}
                    />
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 300,
                  render: (_: unknown, row: ReturnBatchItemRow) => {
                    if (detail.status !== 'RECEIVED' || row.condition !== 'PENDING') {
                      return null;
                    }
                    // 子表规范 §4.5：检验推进不是 danger（§3.1）；合格回库为主操作，
                    // 各带 L1 轻确认（Popconfirm）。
                    return (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <Popconfirm
                          title="按合格回库？"
                          description="合格回库（未指定库位时自动落暂存位）。"
                          okText="合格回库"
                          cancelText="取消"
                          onConfirm={() =>
                            inspectMutation.mutate({ itemId: row.id, condition: 'SELLABLE' })
                          }
                        >
                          <Button size="small" type="primary">
                            合格回库
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title="标记不合格？"
                          description="不合格入隔离库存；关联平台记录时创建退货差异异常。"
                          okText="不合格"
                          cancelText="取消"
                          onConfirm={() =>
                            inspectMutation.mutate({ itemId: row.id, condition: 'DEFECTIVE' })
                          }
                        >
                          <Button size="small">不合格</Button>
                        </Popconfirm>
                        <Popconfirm
                          title="标记缺失？"
                          description="实物缺失：不做任何库存动作；关联平台记录时创建退货差异异常。"
                          okText="缺失"
                          cancelText="取消"
                          onConfirm={() =>
                            inspectMutation.mutate({ itemId: row.id, condition: 'LOST' })
                          }
                        >
                          <Button size="small">缺失</Button>
                        </Popconfirm>
                      </span>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <Modal
        title="新建退货批次"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void createForm.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="创建"
        cancelText="取消"
        width={720}
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item
            name="warehouseId"
            label="收货仓库（建议专用退货仓/临时仓）"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select
              options={(warehousesQuery.data?.data ?? []).map((wh) => ({
                value: wh.id,
                label: `${wh.warehouseCode} · ${wh.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="sourceNote" label="货源说明（如 Amol 仓 9-15 批次）">
            <Input maxLength={500} />
          </Form.Item>
          <Form.Item label="待收货平台退货记录（勾选带入）">
            {pendingList.length === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                没有待收货的平台退货记录；可在下方添加人工行，或先到「平台退货记录」同步。
              </span>
            ) : (
              <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                {pendingList
                  .slice(0, 8)
                  .map((row) => row.platformReturnId)
                  .join('、')}
                {pendingList.length > 8 ? ` 等 ${pendingList.length} 条` : ''}
                （勾选带入功能见下表，勾选后每条生成一行）
              </span>
            )}
          </Form.Item>
          {pendingList.length > 0 && (
            <DataTable<PlatformReturnRow>
              rowKey="id"
              dataSource={pendingList}
              pagination={false}
              size="small"
              columns={[
                { title: '退货单号', dataIndex: 'platformReturnId', key: 'platformReturnId' },
                {
                  title: '平台订单',
                  dataIndex: 'platformOrderId',
                  key: 'platformOrderId',
                  render: (v: string | null) => v ?? '—',
                },
                {
                  title: '',
                  key: 'add',
                  width: 90,
                  render: (_: unknown, row: PlatformReturnRow) => (
                    <Button
                      size="small"
                      onClick={() => {
                        const items =
                          (createForm.getFieldValue('items') as
                            Array<{ platformReturnId?: string; quantity: string }> | undefined) ??
                          [];
                        if (items.some((item) => item.platformReturnId === row.id)) {
                          message.info('该记录已在明细中');
                          return;
                        }
                        createForm.setFieldsValue({
                          items: [...items, { platformReturnId: row.id, quantity: '1' }],
                        });
                        message.success(`已加入明细：${row.platformReturnId}`);
                      }}
                    >
                      加入明细
                    </Button>
                  ),
                },
              ]}
            />
          )}
          <Form.Item noStyle shouldUpdate={(prev, next) => prev.items !== next.items}>
            {() => {
              const items =
                (createForm.getFieldValue('items') as
                  | Array<{ platformReturnId?: string; skuId?: string; quantity: string }>
                  | undefined) ?? [];
              return (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                    批次明细 {items.length} 行；人工行需填内部 SKU
                    ID（从平台记录带入的行自动解析平台 SKU）
                  </span>
                  {items.map((item, index) => (
                    <span key={index} style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      第 {index + 1} 行：
                      {item.platformReturnId !== undefined
                        ? `平台记录 ${item.platformReturnId.slice(0, 8)}…`
                        : `人工行 SKU ${item.skuId ?? '未填'}`}
                      ×{item.quantity}
                    </span>
                  ))}
                  <Button
                    size="small"
                    style={{ width: 120 }}
                    onClick={() => {
                      const current =
                        (createForm.getFieldValue('items') as
                          | Array<{ platformReturnId?: string; skuId?: string; quantity: string }>
                          | undefined) ?? [];
                      createForm.setFieldsValue({ items: [...current, { quantity: '1' }] });
                    }}
                  >
                    添加人工行
                  </Button>
                </div>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
