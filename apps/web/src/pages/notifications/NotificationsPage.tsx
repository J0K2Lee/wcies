import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Select } from 'antd';
import { BellOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime, fmtNumber } from '../../utils/format';
import {
  colors,
  ContextRailContent,
  ContextSection,
  ContextMetric,
  DataTable,
  ErrorState,
  FilterBar,
  MetricCard,
  PageHeader,
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
}

const TYPE_LABEL: Record<string, string> = {
  ORDER_INTERCEPTION_REQUIRED: '需要拦截',
  ORDER_INTERCEPTION_FAILED: '拦截失败',
};

const STATUS_META: Record<
  string,
  { tone: 'info' | 'success' | 'danger' | 'neutral'; label: string }
> = {
  PENDING: { tone: 'info', label: '投递中' },
  SENT: { tone: 'success', label: '已送达' },
  FAILED: { tone: 'danger', label: '投递失败' },
  CANCELLED: { tone: 'neutral', label: '已取消' },
};

type Envelope<T> = { data: T; meta: { total: number } };

export function NotificationsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();

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
          <ContextMetric
            label={<span style={{ color: colors.danger }}>投递失败</span>}
            value={fmtNumber(failedCount.data?.meta.total ?? 0)}
          />
          <span
            style={{
              fontSize: 12.5,
              color: colors.textTertiary,
              display: 'block',
              paddingTop: 8,
            }}
          >
            通知是事件流；需要处理的问题请前往异常中心。
          </span>
        </ContextSection>
      ),
    }),
    [query.data, failedCount.data],
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 16,
          marginBottom: 16,
        }}
      >
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
      </div>

      <FilterBar>
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 200 }}
          value={type}
          onChange={(value) => {
            setPage(1);
            setType(value);
          }}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={Object.entries(STATUS_META).map(([value, meta]) => ({
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
                      {TYPE_LABEL[row.type] ?? row.type}
                      <span style={{ fontSize: 12.5, color: colors.textSecondary, marginLeft: 8 }}>
                        {row.title}
                      </span>
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
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 96,
                render: (value: string) => (
                  <StatusBadge
                    tone={STATUS_META[value]?.tone ?? 'neutral'}
                    label={STATUS_META[value]?.label ?? value}
                    hint={value}
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
                render: (_: unknown, row: NotificationItem) =>
                  row.channel === 'FEISHU' && row.status === 'FAILED' ? (
                    <Button
                      size="small"
                      loading={retryMutation.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        retryMutation.mutate(row.id);
                      }}
                    >
                      重试
                    </Button>
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
