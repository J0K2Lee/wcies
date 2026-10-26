import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Popconfirm, Select } from 'antd';
import { BellOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtNumber } from '../../utils/format';
import {
  colors,
  ContextRailContent,
  ContextSection,
  ContextMetric,
  DataTable,
  ERP_STATUS_META,
  ErrorState,
  INTERCEPTION_STATUS_META,
  FilterBar,
  KpiRow,
  MetricCard,
  NOTIFICATION_STATUS_META,
  NOTIFICATION_TYPE_META,
  PageHeader,
  RailHint,
  RelativeTime,
  SectionCard,
  StatusBadge,
  useContextRail,
} from '../../design-system';

/**
 * Notification Center (Phase 2 task §35-§37): the event stream — what the
 * system has notified, when, and whether delivery succeeded. This is an
 * activity feed, deliberately different from the Exception Center (problems
 * to handle). FEISHU retry is the real POST /notifications/{id}/retry.
 */

interface NotificationItem {
  id: string;
  type: string;
  channel: string;
  referenceType: string;
  referenceId: string;
  title: string;
  content: string;
  status: string;
  attemptCount: number;
  lastError: Record<string, unknown> | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
  /** 关联订单的当前 ERP 状态（派生）；非订单类通知为 null。 */
  orderStatus: string | null;
  /** 拦截类通知的「实物现在在哪」（派生）；其它类型为 null。 */
  goods: {
    interceptionStatus: string;
    pickBinCodes: string[];
    targetBinCode: string | null;
    packageNos: string[];
  } | null;
}

/**
 * 「货物在哪」一句话（2026-10-26 用户要求）：仓库/运营看通知时想知道的是实物
 * 现在在哪，而不是通知投递成功没有。已拣货未出库的货物只有三种可能位置：
 * 拣货区/拣货车（未回库）、拦截后回到目标库位、或已装进包裹。
 */
function goodsLine(goods: NonNullable<NotificationItem['goods']>): string {
  const from =
    goods.pickBinCodes.length === 0 ? '原库位未知' : `原库位 ${goods.pickBinCodes.join('、')}`;
  if (goods.packageNos.length > 0) {
    return `已装包 ${goods.packageNos.join('、')}`;
  }
  switch (goods.interceptionStatus) {
    case 'RETURNED_TO_STOCK':
    case 'CLOSED':
      return goods.targetBinCode === null ? '已回库' : `已回库 → ${goods.targetBinCode}`;
    case 'INTERCEPTED':
      return `已找到，待回库（${from}）`;
    case 'LOCATING':
      return `正在库内查找（${from}）`;
    case 'FAILED':
      return `未找到实物（${from}，库存仍为已拣货）`;
    default:
      return `待拦截（${from}）`;
  }
}

type Envelope<T> = { data: T; meta: { total: number } };

export function NotificationsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  // 深链：通知铃铛条目跳转 /notifications?type=…（Phase 3 T6）。
  const [type, setType] = useState<string | undefined>(() => searchParams.get('type') ?? undefined);

  const query = useApiQuery<Envelope<NotificationItem[]>>(
    '/api/v1/notifications',
    {
      page,
      pageSize: 20,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    ['notifications', page, status, type],
  );

  const failedCount = useApiQuery<Envelope<NotificationItem[]>>(
    '/api/v1/notifications',
    { page: 1, pageSize: 1, status: 'FAILED' },
    ['notifications-count', 'FAILED'],
  );

  const rows = query.data?.data ?? [];

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/notifications/{id}/retry', {}, { id }),
    onSuccess: () => {
      void message.success('已重新入队投递');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error: Error) => void message.error(`重试失败：${error.message}`),
  });

  const railContent = useMemo<ContextRailContent>(
    () => ({
      defaultCollapsed: true,
      children: (
        <ContextSection title="通知概况">
          <ContextMetric label="当前筛选" value={`${query.data?.meta.total ?? 0} 条`} />
          <RailHint>
            通知是事件流；「通知状态」是投递结果，与你关心的订单业务状态是两件事——
            后者在「订单状态」列（取关联订单的当前 ERP 状态）。需要处理的问题请前往异常中心。
          </RailHint>
        </ContextSection>
      ),
    }),
    [query.data],
  );
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="通知中心"
        description="系统事件与消息投递记录（事件流）；需要处理的问题请前往异常中心"
        secondary={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['notifications'] })}
          >
            刷新
          </Button>
        }
      />

      <KpiRow>
        <MetricCard
          icon={<BellOutlined />}
          title="通知总数（当前筛选）"
          value={fmtNumber(query.data?.meta.total ?? 0)}
        />
        <MetricCard
          icon={<CloseCircleOutlined />}
          title="投递失败"
          value={fmtNumber(failedCount.data?.meta.total ?? 0)}
          aux="可重试（飞书渠道）"
        />
      </KpiRow>

      <FilterBar>
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 120 }}
          value={type}
          onChange={(value) => {
            setPage(1);
            setType(value);
          }}
          options={Object.entries(NOTIFICATION_TYPE_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
        />
        <Select
          allowClear
          placeholder="通知状态"
          style={{ width: 130 }}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={Object.entries(NOTIFICATION_STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
        />
      </FilterBar>

      <SectionCard flush>
        {query.isError ? (
          <ErrorState
            description={(query.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['notifications'] })}
            retrying={query.isFetching}
          />
        ) : (
          <DataTable<NotificationItem>
            rowKey="id"
            loading={query.isLoading}
            error={query.error}
            onRetry={() => void query.refetch()}
            dataSource={rows}
            emptyTitle="暂无通知"
            emptyDescription="系统事件产生后将在这里显示"
            pagination={{
              current: page,
              pageSize: 20,
              total: query.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            columns={[
              {
                title: '通知',
                key: 'notification',
                render: (_: unknown, row: NotificationItem) => (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 550 }}>
                      {NOTIFICATION_TYPE_META[row.type]?.label ?? row.type}
                      <span style={{ fontSize: 12.5, color: colors.textSecondary, marginLeft: 8 }}>
                        {row.title}
                      </span>
                      {/* 投递状态不再单独占一列（能看到即已送达）；只在异常时提示。 */}
                      {row.status !== 'SENT' && (
                        <StatusBadge
                          tone={NOTIFICATION_STATUS_META[row.status]?.tone ?? 'neutral'}
                          label={`投递${NOTIFICATION_STATUS_META[row.status]?.label ?? row.status}`}
                          hint={`通知投递状态：${row.status}`}
                          showDot={false}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 12.5,
                        color: colors.textTertiary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 420,
                      }}
                    >
                      {row.content}
                    </div>
                  </div>
                ),
              },
              {
                title: '渠道',
                dataIndex: 'channel',
                key: 'channel',
                width: 80,
                render: (value: string) => (
                  <StatusBadge
                    tone={value === 'FEISHU' ? 'purple' : 'neutral'}
                    label={value === 'FEISHU' ? '飞书' : '系统'}
                    hint={value}
                    showDot={false}
                  />
                ),
              },
              {
                title: '货物状态',
                key: 'goods',
                width: 210,
                // 仓库/运营关心「实物现在在哪」：拦截进度 + 库位/包裹（用户 2026-10-26）。
                render: (_: unknown, row: NotificationItem) =>
                  row.goods === null ? (
                    <span style={{ color: colors.textTertiary }}>—</span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <StatusBadge
                        tone={
                          INTERCEPTION_STATUS_META[row.goods.interceptionStatus]?.tone ?? 'neutral'
                        }
                        label={
                          INTERCEPTION_STATUS_META[row.goods.interceptionStatus]?.label ??
                          row.goods.interceptionStatus
                        }
                        hint={INTERCEPTION_STATUS_META[row.goods.interceptionStatus]?.hint}
                        showDot={false}
                      />
                      <span style={{ fontSize: 12, color: colors.textTertiary }}>
                        {goodsLine(row.goods)}
                      </span>
                    </div>
                  ),
              },
              {
                title: '订单状态',
                dataIndex: 'orderStatus',
                key: 'orderStatus',
                width: 96,
                render: (value: string | null) =>
                  value === null ? (
                    <span style={{ color: colors.textTertiary }}>—</span>
                  ) : (
                    <StatusBadge
                      tone={ERP_STATUS_META[value]?.tone ?? 'neutral'}
                      label={ERP_STATUS_META[value]?.label ?? value}
                      hint={`订单当前状态：${ERP_STATUS_META[value]?.label ?? value}`}
                      showDot={false}
                    />
                  ),
              },
              {
                title: '时间',
                dataIndex: 'createdAt',
                key: 'createdAt',
                width: 110,
                render: (value: string) => <RelativeTime value={value} />,
              },
              {
                title: '操作',
                key: 'actions',
                width: 76,
                // 该页唯一行内按钮（概览型右栏例外）；L1 轻确认。
                render: (_: unknown, row: NotificationItem) =>
                  row.channel === 'FEISHU' && row.status === 'FAILED' ? (
                    <Popconfirm
                      title="重新投递该通知？"
                      description="将重新入队飞书投递。"
                      okText="重试"
                      cancelText="取消"
                      onConfirm={() => retryMutation.mutate(row.id)}
                    >
                      <Button size="small" loading={retryMutation.isPending}>
                        重试
                      </Button>
                    </Popconfirm>
                  ) : null,
              },
            ]}
            expandable={{
              expandedRowRender: (row: NotificationItem) => (
                <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
                  <div style={{ whiteSpace: 'pre-wrap' }}>{row.content}</div>
                  <div style={{ marginTop: 6, color: colors.textTertiary }}>
                    创建于 {fmtDateTime(row.createdAt)}
                    {row.sentAt !== null ? ` · 送达于 ${fmtDateTime(row.sentAt)}` : ''}
                    {row.failedAt !== null ? ` · 失败于 ${fmtDateTime(row.failedAt)}` : ''}
                    {row.attemptCount > 0 ? ` · 尝试 ${row.attemptCount} 次` : ''}
                  </div>
                </div>
              ),
            }}
          />
        )}
      </SectionCard>
    </div>
  );
}
