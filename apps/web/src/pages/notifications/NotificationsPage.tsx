import { useState } from 'react';
import { App as AntdApp, Button, Select, Space, Table, Tag, Typography } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';

/** Notification center (Sprint 4 task §55/§87-14): list + FEISHU retry. */

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
  lastError: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'processing',
  SENT: 'success',
  FAILED: 'error',
  CANCELLED: 'default',
};

export function NotificationsPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();

  const query = useApiQuery<{ data: NotificationItem[]; meta: { total: number } }>(
    '/api/v1/notifications',
    {
      page,
      pageSize: 20,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    ['notifications', page, status, type],
  );

  const retryMutation = useMutation({
    mutationFn: (id: string) => apiPost('/api/v1/notifications/{id}/retry', {}, { id }),
    onSuccess: () => {
      message.success('已重新入队投递');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error: Error) => message.error(`重试失败：${error.message}`),
  });

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 260 }}
          options={[
            { value: 'ORDER_INTERCEPTION_REQUIRED', label: 'ORDER_INTERCEPTION_REQUIRED' },
            { value: 'ORDER_INTERCEPTION_FAILED', label: 'ORDER_INTERCEPTION_FAILED' },
          ]}
          onChange={(value) => {
            setPage(1);
            setType(value);
          }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          options={Object.keys(STATUS_COLORS).map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </Space>
      <Table<NotificationItem>
        rowKey="id"
        size="middle"
        loading={query.isLoading}
        dataSource={query.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 20,
          total: query.data?.meta.total ?? 0,
          onChange: setPage,
        }}
        expandable={{
          expandedRowRender: (row) => (
            <Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>
              {row.content}
              {row.lastError !== null ? `\n[失败原因] ${row.lastError}` : ''}
            </Typography.Paragraph>
          ),
        }}
        columns={[
          { title: '类型', dataIndex: 'type', key: 'type', width: 250 },
          {
            title: '通道',
            dataIndex: 'channel',
            key: 'channel',
            width: 90,
            render: (value: string) => <Tag>{value}</Tag>,
          },
          { title: '标题', dataIndex: 'title', key: 'title' },
          {
            title: '状态',
            dataIndex: 'status',
            key: 'status',
            width: 100,
            render: (value: string) => <Tag color={STATUS_COLORS[value] ?? 'default'}>{value}</Tag>,
          },
          { title: '尝试', dataIndex: 'attemptCount', key: 'attemptCount', width: 70 },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 170,
            render: (value: string) => new Date(value).toLocaleString(),
          },
          {
            title: '操作',
            key: 'actions',
            width: 90,
            render: (_: unknown, row: NotificationItem) =>
              row.channel === 'FEISHU' && row.status === 'FAILED' ? (
                <Button size="small" onClick={() => retryMutation.mutate(row.id)}>
                  重试
                </Button>
              ) : null,
          },
        ]}
      />
    </div>
  );
}
