import { useMemo, useState } from 'react';
import {
  App as AntdApp,
  Badge,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';

/**
 * Orders (Sprint 3 task §61-§65): list with rollup counts + open-exception
 * badges, detail drawer (items / reservations with multi-bin lines / status
 * history / exceptions / interceptions / picking), cancel + backorder retry
 * and the admin normalized-ingest test entry (task §65).
 */

interface OrderListItem {
  id: string;
  orderNo: string;
  storeId: string;
  storeName: string;
  platformCode: string;
  platformOrderId: string;
  platformStatus: string | null;
  erpStatus: string;
  fulfillmentMode: string | null;
  currency: string | null;
  orderedAt: string;
  createdAt: string;
  itemsCount: number;
  reservedCount: number;
  backorderedCount: number;
  pickedCount: number;
  mappingFailedCount: number;
  openExceptionsCount: number;
}

interface OrderItem {
  id: string;
  lineNo: number;
  skuCode: string;
  skuName: string;
  quantity: string;
  fulfillmentStatus: string;
  mappingStatus: string;
  skuId: string | null;
  reservationId: string | null;
  reservation: {
    reservationNo: string;
    status: string;
    lines: Array<{ binCode: string; quantity: string; pickedQty: string }>;
  } | null;
  exceptions: Array<{
    exceptionNo: string;
    exceptionType: string;
    status: string;
    message: string;
  }>;
}

interface OrderDetail {
  id: string;
  orderNo: string;
  storeName: string;
  platformCode: string;
  platformOrderId: string;
  platformStatus: string | null;
  erpStatus: string;
  fulfillmentMode: string | null;
  currency: string | null;
  orderedAt: string;
  syncSource: string | null;
  rawData: Record<string, unknown> | null;
  items: OrderItem[];
  history: Array<{
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    operatorName: string | null;
    createdAt: string;
  }>;
  interceptions: Array<{
    interceptionNo: string;
    status: string;
    orderItemId: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  pickingTasks: Array<{
    id: string;
    pickingNo: string;
    status: string;
    totalItems: number;
    pickedItems: number;
  }>;
}

const ERP_STATUS_COLORS: Record<string, string> = {
  NEW: 'default',
  ALLOCATING: 'processing',
  READY_TO_PICK: 'blue',
  PARTIALLY_BACKORDERED: 'orange',
  BACKORDERED: 'red',
  PICKING: 'cyan',
  PICKED: 'green',
  CANCELLED: 'default',
  EXCEPTION: 'red',
};
const ERP_STATUSES = Object.keys(ERP_STATUS_COLORS);

const FULFILLMENT_COLORS: Record<string, string> = {
  PENDING: 'default',
  RESERVED: 'blue',
  BACKORDERED: 'red',
  PICKED: 'green',
  RELEASED: 'default',
};

/** 固定 JSON Fixtures（task §66 Case A–F 的单店可复用形态） */
const FIXTURES: Array<{ label: string; json: Record<string, unknown> }> = [
  {
    label: 'Case A: 单SKU正常订单',
    json: {
      platformOrderId: 'MOCK-A-001',
      items: [{ platformSkuId: 'MOCK-SKU-A', quantity: '2' }],
    },
  },
  {
    label: 'Case B: 多SKU正常订单',
    json: {
      platformOrderId: 'MOCK-B-001',
      items: [
        { platformSkuId: 'MOCK-SKU-A', quantity: '1' },
        { platformSkuId: 'MOCK-SKU-B', quantity: '3' },
      ],
    },
  },
  {
    label: 'Case C: 一个SKU缺货',
    json: {
      platformOrderId: 'MOCK-C-001',
      items: [{ platformSkuId: 'MOCK-SKU-A', quantity: '999' }],
    },
  },
  {
    label: 'Case D: 一个Listing无法映射',
    json: {
      platformOrderId: 'MOCK-D-001',
      items: [{ platformSkuId: 'NO-SUCH-MAPPING', quantity: '1' }],
    },
  },
];

export function OrdersPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [erpStatus, setErpStatus] = useState<string | undefined>();
  const [storeId, setStoreId] = useState<string | undefined>();
  const [detailId, setDetailId] = useState<string | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestJson, setIngestJson] = useState(
    JSON.stringify(
      { platformOrderId: 'MOCK-A-001', items: [{ platformSkuId: 'MOCK-SKU-A', quantity: '2' }] },
      null,
      2,
    ),
  );

  const query = useApiQuery<{ data: OrderListItem[]; meta: { total: number } }>(
    '/api/v1/orders',
    {
      page,
      pageSize: 20,
      ...(keyword ? { keyword } : {}),
      ...(erpStatus ? { erpStatus } : {}),
      ...(storeId ? { storeId } : {}),
    },
    ['orders', page, keyword, erpStatus, storeId],
  );

  const storesQuery = useApiQuery<{ data: Array<{ id: string; name: string; storeCode: string }> }>(
    '/api/v1/stores',
    { page: 1, pageSize: 100 },
    ['stores-for-orders'],
  );

  const detailQuery = useApiQuery<{ data: OrderDetail }>(
    '/api/v1/orders/{id}',
    {},
    ['order-detail', detailId],
    detailId === null ? undefined : { id: detailId },
    detailId !== null,
  );

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<{ releasedItems: number; interceptions: number }>(
        '/api/v1/orders/{id}/cancel',
        {},
        { id },
      ),
    onSuccess: (result: { releasedItems: number; interceptions: number }) => {
      message.success(
        `订单已取消（释放 ${result.releasedItems} 行${
          result.interceptions > 0 ? `，创建拦截任务 ${result.interceptions} 条` : ''
        }）`,
      );
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`取消失败：${error.message}`),
  });

  const retryMutation = useMutation({
    mutationFn: (itemId: string) =>
      apiPost<{ reserved: boolean }>(
        '/api/v1/orders/items/{itemId}/retry-allocation',
        {},
        { itemId },
      ),
    onSuccess: (result: { reserved: boolean }) => {
      if (result.reserved) {
        message.success('重新分配成功，订单行已 RESERVED');
      } else {
        message.warning('库存仍然不足，保持 BACKORDERED');
      }
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`重试失败：${error.message}`),
  });

  const createPickingMutation = useMutation({
    mutationFn: (orderId: string) =>
      apiPost<{ tasks: Array<{ pickingNo: string }> }>('/api/v1/picking-tasks', { orderId }),
    onSuccess: (result) => {
      message.success(`已创建拣货任务：${result.tasks.map((task) => task.pickingNo).join('、')}`);
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
  });

  const ingestMutation = useMutation({
    mutationFn: (body: unknown) =>
      apiPost<{ orderNo: string; erpStatus: string; alreadyIngested: boolean }>(
        '/api/v1/orders/ingest',
        body,
      ),
    onSuccess: (result: { orderNo: string; erpStatus: string; alreadyIngested: boolean }) => {
      message.success(
        `${result.alreadyIngested ? '幂等重放' : '摄入成功'}：${result.orderNo} → ${result.erpStatus}`,
      );
      setIngestOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (error: Error) => message.error(`摄入失败：${error.message}`),
  });

  const list = query.data?.data ?? [];
  const detail = detailId !== null ? detailQuery.data?.data : undefined;

  const columns = useMemo(
    () => [
      { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 130 },
      {
        title: '平台 / 店铺',
        key: 'platform',
        width: 150,
        render: (_: unknown, row: OrderListItem) => `${row.platformCode} / ${row.storeName}`,
      },
      { title: '平台订单号', dataIndex: 'platformOrderId', key: 'platformOrderId', width: 150 },
      {
        title: '下单时间',
        dataIndex: 'orderedAt',
        key: 'orderedAt',
        width: 165,
        render: (value: string) => new Date(value).toLocaleString('zh-CN'),
      },
      {
        title: 'ERP 状态',
        dataIndex: 'erpStatus',
        key: 'erpStatus',
        width: 170,
        render: (value: string, row: OrderListItem) => (
          <Space size={4} wrap>
            <Badge color={ERP_STATUS_COLORS[value] ?? 'default'} text={value} />
            {row.openExceptionsCount > 0 && (
              <Badge count={row.openExceptionsCount} title="未处理异常" />
            )}
          </Space>
        ),
      },
      {
        title: '平台状态',
        dataIndex: 'platformStatus',
        key: 'platformStatus',
        width: 130,
        render: (v: string | null) => v ?? '-',
      },
      {
        title: '行数',
        key: 'items',
        width: 190,
        render: (_: unknown, row: OrderListItem) => {
          if (row.mappingFailedCount > 0) {
            return (
              <Space size={4}>
                <span>{row.itemsCount}</span>
                <Tag color="purple">映射失败 {row.mappingFailedCount}</Tag>
              </Space>
            );
          }
          return (
            <Space size={4}>
              <span>{row.itemsCount}</span>
              {row.reservedCount > 0 && <Tag color="blue">RESERVED {row.reservedCount}</Tag>}
              {row.backorderedCount > 0 && <Tag color="red">缺货 {row.backorderedCount}</Tag>}
              {row.pickedCount > 0 && <Tag color="green">PICKED {row.pickedCount}</Tag>}
            </Space>
          );
        },
      },
      {
        title: '操作',
        key: 'actions',
        width: 150,
        render: (_: unknown, row: OrderListItem) => (
          <Space>
            <Button size="small" onClick={() => setDetailId(row.id)}>
              详情
            </Button>
            {row.erpStatus !== 'CANCELLED' && (
              <Button
                size="small"
                danger
                onClick={() => {
                  modal.confirm({
                    title: `取消订单 ${row.orderNo}？`,
                    content: 'Reserved 行将释放库存；Picked 行将创建拦截任务（不自动恢复库存）。',
                    okText: '取消订单',
                    cancelText: '返回',
                    onOk: () => {
                      cancelMutation.mutate(row.id);
                    },
                  });
                }}
              >
                取消
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [modal, cancelMutation],
  );

  const itemColumns = [
    { title: '#', dataIndex: 'lineNo', key: 'lineNo', width: 40 },
    {
      title: 'SKU',
      key: 'sku',
      render: (_: unknown, row: OrderItem) =>
        row.skuId === null ? <Tag color="purple">无法映射</Tag> : `${row.skuCode} ${row.skuName}`,
    },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80 },
    {
      title: '履约状态',
      dataIndex: 'fulfillmentStatus',
      key: 'fulfillmentStatus',
      width: 130,
      render: (value: string) => <Tag color={FULFILLMENT_COLORS[value] ?? 'default'}>{value}</Tag>,
    },
    {
      title: '映射状态',
      dataIndex: 'mappingStatus',
      key: 'mappingStatus',
      width: 100,
      render: (value: string) =>
        value === 'FAILED' ? <Tag color="purple">FAILED</Tag> : <Tag>{value}</Tag>,
    },
    {
      title: '库存分配（Bin × 数量）',
      key: 'bins',
      render: (_: unknown, row: OrderItem) =>
        row.reservation === null ? (
          '-'
        ) : (
          <Space size={4} wrap>
            <Tag>{row.reservation.reservationNo}</Tag>
            {row.reservation.lines.map((line, index) => (
              <Tag key={index} color={line.pickedQty === line.quantity ? 'green' : 'geekblue'}>
                {line.binCode} ×{Number(line.quantity)}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '异常',
      key: 'exceptions',
      render: (_: unknown, row: OrderItem) =>
        row.exceptions.length === 0 ? (
          '-'
        ) : (
          <Space size={4} wrap>
            {row.exceptions.map((exception) => (
              <Tag
                key={exception.exceptionNo}
                color={exception.status === 'OPEN' ? 'red' : 'default'}
              >
                {exception.exceptionType}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      render: (_: unknown, row: OrderItem) => {
        const retryable =
          row.mappingStatus === 'MAPPED' &&
          (row.fulfillmentStatus === 'BACKORDERED' || row.fulfillmentStatus === 'PENDING');
        if (!retryable) {
          return null;
        }
        return (
          <Button
            size="small"
            type="primary"
            ghost
            loading={retryMutation.isPending}
            onClick={() => retryMutation.mutate(row.id)}
          >
            重新尝试分配
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Input.Search
          placeholder="订单号 / 平台订单号"
          allowClear
          style={{ width: 260 }}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
        />
        <Select
          allowClear
          placeholder="ERP 状态"
          style={{ width: 190 }}
          options={ERP_STATUSES.map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setPage(1);
            setErpStatus(value);
          }}
        />
        <Select
          allowClear
          placeholder="店铺"
          style={{ width: 200 }}
          options={(storesQuery.data?.data ?? []).map((store) => ({
            value: store.id,
            label: `${store.storeCode} ${store.name}`,
          }))}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
        />
        <Button type="primary" onClick={() => setIngestOpen(true)}>
          摄入测试订单
        </Button>
      </Space>

      <Table<OrderListItem>
        rowKey="id"
        size="middle"
        loading={query.isLoading}
        columns={columns}
        dataSource={list}
        pagination={{
          current: page,
          pageSize: 20,
          total: query.data?.meta.total ?? 0,
          showTotal: (total) => `共 ${total} 单`,
          onChange: setPage,
        }}
      />

      <Drawer
        title={detail ? `订单 ${detail.orderNo}` : '订单详情'}
        width={960}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        destroyOnHidden
      >
        {detail === undefined ? (
          <Empty description={detailQuery.isLoading ? '加载中…' : '无数据'} />
        ) : (
          <>
            <Descriptions size="small" column={3} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="平台订单号">{detail.platformOrderId}</Descriptions.Item>
              <Descriptions.Item label="平台状态">{detail.platformStatus ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="ERP 状态">
                <Badge
                  color={ERP_STATUS_COLORS[detail.erpStatus] ?? 'default'}
                  text={detail.erpStatus}
                />
              </Descriptions.Item>
              <Descriptions.Item label="店铺">{`${detail.platformCode} / ${detail.storeName}`}</Descriptions.Item>
              <Descriptions.Item label="履约模式">
                {detail.fulfillmentMode ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="下单时间">
                {new Date(detail.orderedAt).toLocaleString('zh-CN')}
              </Descriptions.Item>
              <Descriptions.Item label="同步来源">
                {detail.syncSource === null ? (
                  '-'
                ) : (
                  <Tag>
                    {detail.syncSource === 'POLLING'
                      ? '定时轮询'
                      : detail.syncSource === 'WEBHOOK'
                        ? 'Webhook'
                        : detail.syncSource === 'API'
                          ? 'API 摄入'
                          : detail.syncSource}
                  </Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="操作" span={3}>
                <Button
                  type="primary"
                  ghost
                  loading={createPickingMutation.isPending}
                  disabled={
                    detail.erpStatus === 'CANCELLED' ||
                    !detail.items.some((item) => item.fulfillmentStatus === 'RESERVED')
                  }
                  onClick={() => createPickingMutation.mutate(detail.id)}
                >
                  创建拣货任务
                </Button>
              </Descriptions.Item>
            </Descriptions>
            <Tabs
              items={[
                {
                  key: 'items',
                  label: `订单行 (${detail.items.length})`,
                  children: (
                    <Table<OrderItem>
                      rowKey="id"
                      size="small"
                      columns={itemColumns}
                      dataSource={detail.items}
                      pagination={false}
                    />
                  ),
                },
                {
                  key: 'platform-raw',
                  label: '平台原始数据',
                  children:
                    detail.rawData === null ? (
                      <Empty description="无平台原始数据" />
                    ) : (
                      <pre
                        style={{
                          maxHeight: 420,
                          overflow: 'auto',
                          fontSize: 12,
                          background: '#fafafa',
                          padding: 12,
                          borderRadius: 6,
                        }}
                      >
                        {JSON.stringify(detail.rawData, null, 2)}
                      </pre>
                    ),
                },
                {
                  key: 'history',
                  label: `状态历史 (${detail.history.length})`,
                  children: (
                    <Timeline
                      items={detail.history.map((entry) => ({
                        children: (
                          <div>
                            <Typography.Text strong>
                              {entry.fromStatus ?? '∅'} → {entry.toStatus}
                            </Typography.Text>
                            <div style={{ color: '#888' }}>
                              {new Date(entry.createdAt).toLocaleString('zh-CN')} ·{' '}
                              {entry.operatorName ?? 'system'}
                              {entry.reason ? ` · ${entry.reason}` : ''}
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  ),
                },
                {
                  key: 'picking',
                  label: `拣货 (${detail.pickingTasks.length})`,
                  children:
                    detail.pickingTasks.length === 0 ? (
                      <Empty description="无拣货任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <Table<{
                        id: string;
                        pickingNo: string;
                        status: string;
                        pickedItems: number;
                        totalItems: number;
                      }>
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={detail.pickingTasks}
                        columns={[
                          { title: '拣货单号', dataIndex: 'pickingNo' },
                          { title: '状态', dataIndex: 'status' },
                          {
                            title: '进度',
                            render: (
                              _: unknown,
                              row: { pickedItems: number; totalItems: number },
                            ) => `${row.pickedItems} / ${row.totalItems}`,
                          },
                          {
                            title: '',
                            render: (_: unknown, row: { id: string }) => (
                              <Button size="small" href={`#/picking/${row.id}`} target="_blank">
                                进入作业
                              </Button>
                            ),
                          },
                        ]}
                      />
                    ),
                },
                {
                  key: 'interceptions',
                  label: `拦截 (${detail.interceptions.length})`,
                  children:
                    detail.interceptions.length === 0 ? (
                      <Empty description="无拦截任务" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <Table
                        rowKey="interceptionNo"
                        size="small"
                        pagination={false}
                        dataSource={detail.interceptions}
                        columns={[
                          { title: '拦截单号', dataIndex: 'interceptionNo' },
                          { title: '状态', dataIndex: 'status' },
                          { title: '原因', dataIndex: 'reason' },
                        ]}
                      />
                    ),
                },
                {
                  key: 'raw',
                  label: 'Raw Data',
                  children: (
                    <Typography.Paragraph>
                      <pre
                        style={{
                          maxHeight: 300,
                          overflow: 'auto',
                          background: '#fafafa',
                          padding: 8,
                        }}
                      >
                        {JSON.stringify(detail.rawData ?? {}, null, 2)}
                      </pre>
                    </Typography.Paragraph>
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <Modal
        title="摄入测试订单（NormalizedOrderInput，管理员）"
        open={ingestOpen}
        onCancel={() => setIngestOpen(false)}
        onOk={() => {
          try {
            const body = JSON.parse(ingestJson) as Record<string, unknown>;
            if (body.storeId === undefined) {
              const firstStore = storesQuery.data?.data[0];
              if (firstStore === undefined) {
                message.error('没有可用店铺，请在 JSON 中显式指定 storeId');
                return;
              }
              body.storeId = firstStore.id;
            }
            if (body.orderedAt === undefined) {
              body.orderedAt = new Date().toISOString();
            }
            ingestMutation.mutate(body);
          } catch {
            message.error('JSON 格式错误');
          }
        }}
        okText="摄入"
        cancelText="关闭"
        width={640}
        confirmLoading={ingestMutation.isPending}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Space wrap>
            {FIXTURES.map((fixture) => (
              <Button
                key={fixture.label}
                size="small"
                onClick={() => setIngestJson(JSON.stringify(fixture.json, null, 2))}
              >
                {fixture.label}
              </Button>
            ))}
          </Space>
          <Typography.Text type="secondary">
            storeId 默认取第一个店铺；items 行使用平台 SKU 标识（platformSkuId / sellerSku /
            offerId）。
          </Typography.Text>
          <Input.TextArea
            rows={10}
            value={ingestJson}
            onChange={(event) => setIngestJson(event.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
