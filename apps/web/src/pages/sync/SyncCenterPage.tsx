import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Drawer,
  Descriptions,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';

interface SyncJobRow {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformCode: string;
  syncType: string;
  status: string;
  triggerType: string;
  startedAt: string | null;
  finishedAt: string | null;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  retryCount: number;
  cursorBefore: Record<string, unknown> | null;
  cursorAfter: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  durationMs: number | null;
}

interface RawEventRow {
  id: string;
  platform: string;
  storeId: string;
  eventType: string;
  externalEventId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  status: string;
  receivedAt: string;
  processedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: 'default',
  RUNNING: 'processing',
  SUCCESS: 'green',
  PARTIAL: 'orange',
  FAILED: 'red',
};

export function SyncCenterPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [storeId, setStoreId] = useState<string | undefined>();
  const [syncType, setSyncType] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [eventPage, setEventPage] = useState(1);
  const [eventDetail, setEventDetail] = useState<RawEventRow | null>(null);
  const [autoRefresh] = useState(true);

  const jobs = useApiQuery<{ data: SyncJobRow[]; meta: { total: number } }>(
    '/api/v1/sync/jobs',
    { page, pageSize: 20, storeId, syncType, status },
    ['sync-jobs', page, storeId, syncType, status],
  );
  const events = useApiQuery<{ data: RawEventRow[]; meta: { total: number } }>(
    '/api/v1/sync/events',
    { page: eventPage, pageSize: 20, storeId },
    ['sync-events', eventPage, storeId],
  );
  const stores = useApiQuery<{
    data: Array<{ id: string; storeCode: string; name: string; platformCode: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores']);

  // Poll while any job is in flight so the dashboard feels live (§34).
  const hasActive = (jobs.data?.data ?? []).some(
    (job) => job.status === 'PENDING' || job.status === 'RUNNING',
  );
  if (hasActive && autoRefresh) {
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
    }, 2000);
  }

  const triggerMutation = useMutation({
    mutationFn: (type: 'orders' | 'listings') =>
      apiPost<SyncJobRow>(`/api/v1/sync/${type}`, { storeId: storeId ?? '' }),
    onSuccess: (job) => {
      void message.success(`同步任务已创建（${job.id.slice(0, 8)}…），状态可实时刷新`);
      void queryClient.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          allowClear
          placeholder="选择店铺（手动同步）"
          style={{ width: 220 }}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
          options={(stores.data?.data ?? []).map((store) => ({
            value: store.id,
            label: `${store.platformCode} / ${store.storeCode}`,
          }))}
        />
        <Button
          type="primary"
          disabled={storeId === undefined}
          loading={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate('orders')}
        >
          同步订单
        </Button>
        <Button
          disabled={storeId === undefined}
          loading={triggerMutation.isPending}
          onClick={() => triggerMutation.mutate('listings')}
        >
          同步 Listing
        </Button>
      </Space>

      <Tabs
        items={[
          {
            key: 'jobs',
            label: '同步任务',
            children: (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Select
                    allowClear
                    placeholder="类型"
                    style={{ width: 140 }}
                    onChange={(value) => {
                      setPage(1);
                      setSyncType(value);
                    }}
                    options={[
                      { value: 'ORDER_SYNC', label: '订单同步' },
                      { value: 'LISTING_SYNC', label: 'Listing 同步' },
                    ]}
                  />
                  <Select
                    allowClear
                    placeholder="状态"
                    style={{ width: 120 }}
                    onChange={(value) => {
                      setPage(1);
                      setStatus(value);
                    }}
                    options={Object.keys(JOB_STATUS_COLOR).map((value) => ({ value }))}
                  />
                </Space>
                <Table<SyncJobRow>
                  rowKey="id"
                  size="small"
                  loading={jobs.isLoading}
                  dataSource={jobs.data?.data ?? []}
                  pagination={{
                    current: page,
                    pageSize: 20,
                    total: jobs.data?.meta.total ?? 0,
                    onChange: setPage,
                    showSizeChanger: false,
                  }}
                  columns={[
                    { title: '平台', dataIndex: 'platformCode', width: 70 },
                    { title: '店铺', dataIndex: 'storeCode', width: 110 },
                    {
                      title: '类型',
                      dataIndex: 'syncType',
                      width: 120,
                      render: (value: string) =>
                        value === 'ORDER_SYNC' ? '订单同步' : 'Listing 同步',
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 90,
                      render: (value: string) => (
                        <Tag color={JOB_STATUS_COLOR[value] ?? 'default'}>{value}</Tag>
                      ),
                    },
                    { title: '触发', dataIndex: 'triggerType', width: 90 },
                    {
                      title: '成功/跳过/失败',
                      width: 130,
                      render: (_: unknown, row: SyncJobRow) =>
                        `${row.successCount} / ${row.skippedCount} / ${row.failedCount}`,
                    },
                    {
                      title: '耗时',
                      dataIndex: 'durationMs',
                      width: 80,
                      render: (value: number | null) => (value === null ? '-' : `${value}ms`),
                    },
                    {
                      title: '开始时间',
                      dataIndex: 'startedAt',
                      width: 170,
                      render: (value: string | null) => value ?? '-',
                    },
                    {
                      title: '错误',
                      dataIndex: 'errorCode',
                      ellipsis: true,
                      render: (value: string | null, row: SyncJobRow) =>
                        value === null ? '-' : `${value}: ${row.errorMessage ?? ''}`,
                    },
                  ]}
                  expandable={{
                    expandedRowRender: (row: SyncJobRow) => (
                      <Descriptions
                        column={1}
                        size="small"
                        items={[
                          {
                            key: 'cursorBefore',
                            label: 'Cursor Before',
                            children: (
                              <Typography.Text code copyable>
                                {JSON.stringify(row.cursorBefore)}
                              </Typography.Text>
                            ),
                          },
                          {
                            key: 'cursorAfter',
                            label: 'Cursor After',
                            children: (
                              <Typography.Text code copyable>
                                {JSON.stringify(row.cursorAfter)}
                              </Typography.Text>
                            ),
                          },
                          {
                            key: 'error',
                            label: '错误信息',
                            children: row.errorMessage ?? '-',
                          },
                        ]}
                      />
                    ),
                  }}
                />
              </>
            ),
          },
          {
            key: 'events',
            label: 'Webhook 事件',
            children: (
              <Table<RawEventRow>
                rowKey="id"
                size="small"
                loading={events.isLoading}
                dataSource={events.data?.data ?? []}
                pagination={{
                  current: eventPage,
                  pageSize: 20,
                  total: events.data?.meta.total ?? 0,
                  onChange: setEventPage,
                  showSizeChanger: false,
                }}
                onRow={(record) => ({
                  onClick: () => setEventDetail(record),
                  style: { cursor: 'pointer' },
                })}
                columns={[
                  { title: '平台', dataIndex: 'platform', width: 70 },
                  { title: '事件类型', dataIndex: 'eventType' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 100,
                    render: (value: string) => (
                      <Tag
                        color={
                          value === 'PROCESSED'
                            ? 'green'
                            : value === 'FAILED'
                              ? 'red'
                              : value === 'REJECTED'
                                ? 'volcano'
                                : 'default'
                        }
                      >
                        {value}
                      </Tag>
                    ),
                  },
                  { title: '接收时间', dataIndex: 'receivedAt', width: 180 },
                  {
                    title: '处理时间',
                    dataIndex: 'processedAt',
                    width: 180,
                    render: (value: string | null) => value ?? '-',
                  },
                  {
                    title: '错误',
                    dataIndex: 'errorCode',
                    ellipsis: true,
                    render: (value: string | null, row: RawEventRow) =>
                      value === null ? '-' : `${value}: ${row.errorMessage ?? ''}`,
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Drawer
        title={eventDetail ? `${eventDetail.platform} / ${eventDetail.eventType}` : '事件详情'}
        width={640}
        open={eventDetail !== null}
        onClose={() => setEventDetail(null)}
      >
        {eventDetail !== null && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Descriptions
              column={1}
              size="small"
              items={[
                { key: 'id', label: '事件 ID', children: eventDetail.id },
                {
                  key: 'ext',
                  label: '平台事件 ID',
                  children: eventDetail.externalEventId ?? '(无，按 payload hash 去重)',
                },
                { key: 'hash', label: 'Payload Hash', children: eventDetail.payloadHash },
                { key: 'received', label: '接收时间', children: eventDetail.receivedAt },
              ]}
            />
            <Typography.Title level={5}>原始报文</Typography.Title>
            <Typography.Paragraph>
              <pre style={{ maxHeight: 420, overflow: 'auto', fontSize: 12 }}>
                {JSON.stringify(eventDetail.payload, null, 2)}
              </pre>
            </Typography.Paragraph>
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
