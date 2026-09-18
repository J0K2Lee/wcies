import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Drawer, Input, Modal, Select, Space, Tabs, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  ExportOutlined,
  FileDoneOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useSearchParams } from 'react-router';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtNumber } from '../../utils/format';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntityLink,
  EntitySummary,
  ErrorState,
  FilterBar,
  InfoGrid,
  KpiRow,
  MetricCard,
  PageHeader,
  PlatformTag,
  RailHint,
  RawDataBlock,
  RelativeTime,
  riskAccentColor,
  RiskIndicator,
  SectionCard,
  StatusBadge,
  typography,
  useContextRail,
} from '../../design-system';

/**
 * Exception Center (Phase 2 task §20-§25): one workbench for every open
 * business exception. Data comes exclusively from GET /exceptions; resolve /
 * ignore mutations are the real ExceptionController endpoints. Risk is shown
 * via calm badges + a 2px row accent — never a red table (task §25).
 */

interface ExceptionRow {
  id: string;
  exceptionNo: string;
  exceptionType: string;
  severity: string;
  status: string;
  referenceType: string;
  referenceId: string;
  storeId: string | null;
  message: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
}

type Envelope<T> = { data: T; meta: { total: number } };

/** Type → Chinese label + category (task §21, real backend enum only). */
const EXCEPTION_TYPE_META: Record<string, { label: string; category: string }> = {
  ORDER_SKU_MAPPING_FAILED: { label: 'SKU 映射失败', category: 'SKU 映射' },
  ORDER_OUT_OF_STOCK: { label: '订单缺货', category: '库存' },
  ORDER_INVALID_STATE: { label: '订单状态异常', category: '订单' },
  ORDER_INTERCEPTION_FAILED: { label: '拦截失败', category: '拦截' },
  ORDER_SHIPMENT_DEADLINE_NEAR: { label: '发货时限临近', category: '订单' },
  SYNC_FAILED: { label: '同步失败', category: '同步' },
  ORDER_TRACKING_STALLED: { label: '物流停滞', category: '物流' },
  ORDER_CANCELLED_AFTER_SHIP: { label: '已发货被平台取消', category: '退货/退款' },
  RETURN_ORDER_NOT_FOUND: { label: '退货订单未找到', category: '退货/退款' },
  RETURN_DIFFERENCE: { label: '退货差异', category: '退货/退款' },
};

const EXCEPTION_STATUS_META: Record<
  string,
  { tone: 'danger' | 'success' | 'neutral'; label: string }
> = {
  OPEN: { tone: 'danger', label: '待处理' },
  RESOLVED: { tone: 'success', label: '已解决' },
  IGNORED: { tone: 'neutral', label: '已忽略' },
};

const STATUS_TABS = [
  { key: 'OPEN', label: '待处理' },
  { key: 'RESOLVED', label: '已解决' },
  { key: 'IGNORED', label: '已忽略' },
  { key: 'ALL', label: '全部' },
];

/** Data-driven jump targets from details JSON (task §24: actions per type). */
function buildEntityActions(row: ExceptionRow): Array<{ key: string; to: string; label: string }> {
  const actions: Array<{ key: string; to: string; label: string }> = [];
  const details = row.details ?? {};
  const orderNo = typeof details.orderNo === 'string' ? details.orderNo : null;
  if (orderNo !== null) {
    actions.push({
      key: 'order',
      to: `/orders?keyword=${encodeURIComponent(orderNo)}`,
      label: `查看订单 ${orderNo}`,
    });
  }
  if (row.exceptionType === 'ORDER_SKU_MAPPING_FAILED') {
    const identifiers = (details.identifiers ?? {}) as Record<string, unknown>;
    const identifier =
      typeof identifiers.offerId === 'string' && identifiers.offerId !== ''
        ? identifiers.offerId
        : typeof identifiers.platformSkuId === 'string'
          ? identifiers.platformSkuId
          : typeof details.platformSkuId === 'string'
            ? details.platformSkuId
            : null;
    if (identifier !== null) {
      actions.push({
        key: 'mapping',
        to: `/listings?keyword=${encodeURIComponent(identifier)}`,
        label: '前往 SKU 映射',
      });
    }
  }
  return actions;
}

export function ExceptionsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [statusTab, setStatusTab] = useState('OPEN');
  const [typeFilter, setTypeFilter] = useState<string | undefined>(
    () => searchParams.get('exceptionType') ?? undefined,
  );
  const [storeId, setStoreId] = useState<string | undefined>(
    () => searchParams.get('storeId') ?? undefined,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [closeTarget, setCloseTarget] = useState<{
    id: string;
    action: 'resolve' | 'ignore';
  } | null>(null);
  const [remark, setRemark] = useState('');

  const statusParam = statusTab === 'ALL' ? undefined : statusTab;
  const list = useApiQuery<Envelope<ExceptionRow[]>>(
    '/api/v1/exceptions',
    {
      page,
      pageSize: 20,
      ...(statusParam ? { status: statusParam } : {}),
      ...(typeFilter ? { exceptionType: typeFilter } : {}),
      ...(storeId ? { storeId } : {}),
    },
    ['exceptions', page, statusTab, typeFilter, storeId],
  );

  // KPI (task §22): totals per status + severity breakdown of recent open rows.
  const openCount = useApiQuery<Envelope<ExceptionRow[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 1, status: 'OPEN' },
    ['exceptions', 'count', 'OPEN'],
  );
  const resolvedCount = useApiQuery<Envelope<ExceptionRow[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 1, status: 'RESOLVED' },
    ['exceptions', 'count', 'RESOLVED'],
  );
  const ignoredCount = useApiQuery<Envelope<ExceptionRow[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 1, status: 'IGNORED' },
    ['exceptions', 'count', 'IGNORED'],
  );
  const openSample = useApiQuery<Envelope<ExceptionRow[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 100, status: 'OPEN' },
    ['exceptions', 'open-sample'],
  );

  const stores = useApiQuery<
    Envelope<Array<{ id: string; storeCode: string; name: string; platformCode: string }>>
  >('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores', 'for-exceptions']);
  const storeMap = useMemo(
    () => new Map((stores.data?.data ?? []).map((store) => [store.id, store])),
    [stores.data],
  );

  const rows = list.data?.data ?? [];
  const highRiskCount = useMemo(
    () => (openSample.data?.data ?? []).filter((row) => row.severity === 'HIGH').length,
    [openSample.data],
  );

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = useMemo(
    () => rows.find((row) => row.id === detailId) ?? null,
    [rows, detailId],
  );

  const closeMutation = useMutation({
    mutationFn: ({
      id,
      action,
      remark: text,
    }: {
      id: string;
      action: 'resolve' | 'ignore';
      remark: string;
    }) => apiPost(`/api/v1/exceptions/{id}/${action}`, text === '' ? {} : { remark: text }, { id }),
    onSuccess: (_result, variables) => {
      void message.success(variables.action === 'resolve' ? '异常已标记解决' : '异常已忽略');
      setCloseTarget(null);
      setRemark('');
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const typeLabel = (type: string) => EXCEPTION_TYPE_META[type]?.label ?? type;

  const renderStore = (row: ExceptionRow) => {
    if (row.storeId === null) {
      return <span style={{ color: colors.textTertiary }}>—</span>;
    }
    const store = storeMap.get(row.storeId);
    if (store === undefined) {
      return <span style={{ color: colors.textTertiary }}>未知店铺</span>;
    }
    return <PlatformTag code={store.platformCode} suffix={store.storeCode} />;
  };

  // ---- Context rail (task §24) ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="异常概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 条`} />
            <RailHint>异常分布见上方指标卡；点击异常行可在右栏解决、忽略或跳转关联对象。</RailHint>
          </ContextSection>
        ),
      };
    }
    const actions = buildEntityActions(selectedRow);
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.exceptionNo}
          subtitle={typeLabel(selectedRow.exceptionType)}
          badge={
            <StatusBadge
              tone={EXCEPTION_STATUS_META[selectedRow.status]?.tone ?? 'neutral'}
              label={EXCEPTION_STATUS_META[selectedRow.status]?.label ?? selectedRow.status}
              hint={selectedRow.status}
            />
          }
          meta={renderStore(selectedRow)}
        />
      ),
      children: (
        <>
          <ContextSection title="风险">
            <RiskIndicator severity={selectedRow.severity} />
          </ContextSection>
          <ContextSection title="错误说明">
            <span style={{ fontSize: 13, color: colors.textSecondary, wordBreak: 'break-word' }}>
              {selectedRow.message}
            </span>
          </ContextSection>
          <ContextSection title="详情">
            <ContextMetric
              label="发生时间"
              value={<RelativeTime value={selectedRow.createdAt} />}
            />
            <ContextMetric
              label="关联对象"
              value={
                <span style={{ fontSize: 12, fontFamily: typography.monoFamily }}>
                  {selectedRow.referenceType} · {selectedRow.referenceId.slice(0, 8)}…
                </span>
              }
            />
            {selectedRow.resolvedAt !== null && (
              <ContextMetric
                label="处理时间"
                value={<RelativeTime value={selectedRow.resolvedAt} />}
              />
            )}
          </ContextSection>
          {actions.length > 0 && (
            <ContextSection title="关联操作">
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  alignItems: 'flex-start',
                }}
              >
                {actions.map((action) => (
                  <EntityLink
                    key={action.key}
                    to={action.to}
                    icon={<ExportOutlined />}
                    primary={action.label}
                  />
                ))}
              </div>
            </ContextSection>
          )}
          <ContextAction>
            <Space orientation="vertical" style={{ width: '100%' }} size={8}>
              <Button block onClick={() => setDetailId(selectedRow.id)}>
                查看详情
              </Button>
              {selectedRow.status === 'OPEN' && (
                <Space style={{ width: '100%' }}>
                  <Button
                    block
                    type="primary"
                    icon={<CheckCircleOutlined />}
                    onClick={() => setCloseTarget({ id: selectedRow.id, action: 'resolve' })}
                  >
                    标记解决
                  </Button>
                  <Button
                    block
                    icon={<MinusCircleOutlined />}
                    onClick={() => setCloseTarget({ id: selectedRow.id, action: 'ignore' })}
                  >
                    忽略
                  </Button>
                </Space>
              )}
            </Space>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, storeMap]);
  useContextRail(railContent);

  const columns = [
    {
      title: '异常',
      key: 'exception',
      render: (_: unknown, row: ExceptionRow) => (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 550 }}>{typeLabel(row.exceptionType)}</div>
          <Tooltip title={row.message}>
            <div
              style={{
                fontSize: 12.5,
                color: colors.textSecondary,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 320,
              }}
            >
              {row.message}
            </div>
          </Tooltip>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'exceptionType',
      key: 'type',
      width: 110,
      render: (value: string) => (
        <Tooltip title={value}>
          <span style={{ fontSize: 13, color: colors.textSecondary }}>
            {EXCEPTION_TYPE_META[value]?.category ?? value}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '店铺',
      key: 'store',
      width: 150,
      render: (_: unknown, row: ExceptionRow) => renderStore(row),
    },
    {
      title: '风险',
      dataIndex: 'severity',
      key: 'severity',
      width: 96,
      render: (value: string) => <RiskIndicator severity={value} />,
    },
    {
      title: '发生时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (value: string) => <RelativeTime value={value} />,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (value: string) => (
        <StatusBadge
          tone={EXCEPTION_STATUS_META[value]?.tone ?? 'neutral'}
          label={EXCEPTION_STATUS_META[value]?.label ?? value}
          hint={value}
          showDot={false}
        />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="异常中心"
        description="统一处理订单、映射、库存等业务异常，无需在各业务页面间寻找问题"
        secondary={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['exceptions'] })}
          >
            刷新
          </Button>
        }
        extra={
          <Tabs
            activeKey={statusTab}
            onChange={(key) => {
              setPage(1);
              setStatusTab(key);
            }}
            items={STATUS_TABS.map((tab) => ({
              key: tab.key,
              label:
                tab.key === 'OPEN'
                  ? `${tab.label} (${openCount.data?.meta.total ?? 0})`
                  : tab.label,
            }))}
          />
        }
      />

      <KpiRow>
        <MetricCard
          icon={<WarningOutlined />}
          title="待处理"
          value={fmtNumber(openCount.data?.meta.total ?? 0)}
          aux="未解决"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="高风险"
          value={fmtNumber(highRiskCount)}
          aux="基于最近 100 条待处理"
        />
        <MetricCard
          icon={<CheckCircleOutlined />}
          title="已解决"
          value={fmtNumber(resolvedCount.data?.meta.total ?? 0)}
          aux="已处理"
        />
        <MetricCard
          icon={<FileDoneOutlined />}
          title="已忽略"
          value={fmtNumber(ignoredCount.data?.meta.total ?? 0)}
          aux="人工忽略"
        />
      </KpiRow>

      <FilterBar>
        <Select
          allowClear
          placeholder="异常类型"
          style={{ width: 180 }}
          showSearch
          optionFilterProp="label"
          value={typeFilter}
          onChange={(value) => {
            setPage(1);
            setTypeFilter(value);
            // 与店铺筛选一致，类型也写入 URL（深链可分享，Phase 3 T3.6）。
            const next = new URLSearchParams(searchParams);
            if (value === undefined) {
              next.delete('exceptionType');
            } else {
              next.set('exceptionType', value);
            }
            setSearchParams(next, { replace: true });
          }}
          options={Object.entries(EXCEPTION_TYPE_META).map(([value, meta]) => ({
            value,
            label: `${meta.category} · ${meta.label}`,
          }))}
        />
        <Select
          allowClear
          placeholder="店铺"
          style={{ width: 220 }}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
            const next = new URLSearchParams(searchParams);
            if (value === undefined) {
              next.delete('storeId');
            } else {
              next.set('storeId', value);
            }
            setSearchParams(next, { replace: true });
          }}
          showSearch
          optionFilterProp="label"
          options={(stores.data?.data ?? []).map((store) => ({
            value: store.id,
            label: `${store.storeCode} · ${store.name}`,
          }))}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['exceptions'] })}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<ExceptionRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            columns={columns}
            emptyTitle="暂无异常"
            emptyDescription="当前没有需要处理的异常"
            pagination={{
              current: page,
              pageSize: 20,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              onDoubleClick: () => setDetailId(record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
                borderLeft: `2px solid ${riskAccentColor(record.severity, record.status) ?? 'transparent'}`,
              },
            })}
          />
        )}
      </SectionCard>

      {/* ---- Detail drawer: read-only (actions live in the rail, Phase 3 T3) ---- */}
      <Drawer
        title={detailRow !== null ? `异常详情 · ${detailRow.exceptionNo}` : '异常详情'}
        size={640}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        destroyOnHidden
      >
        {detailRow !== null ? (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <section>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  marginBottom: 10,
                }}
              >
                基础信息
              </div>
              <InfoGrid
                columns={2}
                items={[
                  {
                    label: '状态',
                    children: (
                      <StatusBadge
                        tone={EXCEPTION_STATUS_META[detailRow.status]?.tone ?? 'neutral'}
                        label={EXCEPTION_STATUS_META[detailRow.status]?.label ?? detailRow.status}
                        hint={detailRow.status}
                        showDot={false}
                      />
                    ),
                  },
                  {
                    label: '风险等级',
                    children: <RiskIndicator severity={detailRow.severity} />,
                  },
                  {
                    label: '异常类型',
                    children: `${typeLabel(detailRow.exceptionType)}（${detailRow.exceptionType}）`,
                  },
                  { label: '异常编号', children: detailRow.exceptionNo },
                  { label: '发生时间', children: fmtDateTime(detailRow.createdAt) },
                  {
                    label: '处理时间',
                    children:
                      detailRow.resolvedAt === null ? '—' : fmtDateTime(detailRow.resolvedAt),
                  },
                  {
                    label: '关联对象',
                    span: 2,
                    children: (
                      <span
                        style={{
                          fontSize: 12,
                          fontFamily: typography.monoFamily,
                          wordBreak: 'break-all',
                        }}
                      >
                        {detailRow.referenceType} · {detailRow.referenceId}
                      </span>
                    ),
                  },
                  {
                    label: '店铺',
                    children:
                      detailRow.storeId === null
                        ? '—'
                        : (storeMap.get(detailRow.storeId)?.storeCode ?? detailRow.storeId),
                  },
                ]}
              />
            </section>

            <section>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  marginBottom: 10,
                }}
              >
                错误说明
              </div>
              <div
                style={{
                  border: `1px solid ${detailRow.status === 'OPEN' ? colors.dangerBorder : colors.border}`,
                  background: detailRow.status === 'OPEN' ? colors.dangerBg : colors.neutralBg,
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontSize: 13,
                  color: colors.textSecondary,
                  wordBreak: 'break-word',
                }}
              >
                {detailRow.message}
              </div>
            </section>

            {detailRow.details !== null && Object.keys(detailRow.details).length > 0 && (
              <section>
                <div
                  style={{
                    fontSize: 14.5,
                    fontWeight: 600,
                    color: colors.textPrimary,
                    marginBottom: 10,
                  }}
                >
                  上下文数据
                </div>
                <RawDataBlock data={detailRow.details} maxHeight={320} />
              </section>
            )}
          </Space>
        ) : (
          <div style={{ padding: '40px 0', textAlign: 'center', color: colors.textTertiary }}>
            加载中…
          </div>
        )}
      </Drawer>

      {/* ---- Resolve / ignore with remark ---- */}
      <Modal
        title={closeTarget?.action === 'resolve' ? '标记解决' : '忽略异常'}
        open={closeTarget !== null}
        onCancel={() => {
          setCloseTarget(null);
          setRemark('');
        }}
        confirmLoading={closeMutation.isPending}
        okText={closeTarget?.action === 'resolve' ? '确认解决' : '确认忽略'}
        onOk={() => {
          if (closeTarget !== null) {
            closeMutation.mutate({ ...closeTarget, remark });
          }
        }}
      >
        <p style={{ color: colors.textSecondary, fontSize: 13 }}>
          {closeTarget?.action === 'resolve'
            ? '确认该异常已被处理？处理备注将记录在异常详情中。'
            : '忽略后该异常不再出现在待处理列表，可随时在「已忽略」中查看。'}
        </p>
        <Input.TextArea
          value={remark}
          onChange={(event) => setRemark(event.target.value)}
          placeholder="处理备注（可选）"
          rows={3}
          maxLength={200}
        />
      </Modal>
    </div>
  );
}
