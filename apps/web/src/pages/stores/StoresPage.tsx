import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../../api/hooks';

interface StoreRow {
  id: string;
  platformId: string;
  platformCode: string;
  storeCode: string;
  name: string;
  sellerId: string | null;
  defaultCurrency: string | null;
  status: string;
  credentialConfigured: boolean;
  bindingCount: number;
}

interface CredentialRow {
  id: string;
  credentialType: string;
  status: string;
  configured: boolean;
  lastValidatedAt: string | null;
  lastValidationStatus: string | null;
  lastValidationError: string | null;
  updatedAt: string;
}

interface SyncOverview {
  storeId: string;
  platformCode: string;
  credential: {
    credentialId: string | null;
    configured: boolean;
    lastValidatedAt: string | null;
    lastValidationStatus: string | null;
    lastValidationError: string | null;
  } | null;
  lastOrderSync: { status: string; finishedAt: string | null } | null;
  lastListingSync: { status: string; finishedAt: string | null } | null;
  consecutiveFailures: number;
  activeJobId: string | null;
}

interface BindingRow {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  fulfillmentMode: string;
  status: string;
}

export function StoresPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [platformId, setPlatformId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [credentialModalOpen, setCredentialModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [credentialForm] = Form.useForm();

  const list = useApiQuery<{ data: StoreRow[]; meta: { total: number } }>(
    '/api/v1/stores',
    { page, pageSize: 50, platformId, keyword: keyword || undefined },
    ['stores', page, platformId, keyword],
  );
  const platforms = useApiQuery<{ data: Array<{ id: string; code: string }> }>(
    '/api/v1/platforms',
    {},
    ['platforms'],
  );
  const detail = useApiQuery<{ data: StoreRow }>(
    '/api/v1/stores/{id}',
    {},
    ['store-detail', drawerId],
    {
      id: drawerId ?? '',
    },
    drawerId !== null,
  );
  const store = detail.data?.data;
  const credentials = useApiQuery<{ data: CredentialRow[] }>(
    '/api/v1/stores/{storeId}/credentials',
    {},
    ['store-credentials', drawerId],
    { storeId: drawerId ?? '' },
    drawerId !== null,
  );
  const bindings = useApiQuery<{ data: BindingRow[] }>(
    '/api/v1/stores/{storeId}/warehouse-bindings',
    { page: 1, pageSize: 50 },
    ['store-bindings', drawerId],
    { storeId: drawerId ?? '' },
    drawerId !== null,
  );
  const syncOverview = useApiQuery<{ data: SyncOverview }>(
    '/api/v1/sync/stores/{storeId}/overview',
    {},
    ['store-sync-overview', drawerId],
    { storeId: drawerId ?? '' },
    drawerId !== null,
  );
  const overview = syncOverview.data?.data;

  const refreshStore = () => {
    void queryClient.invalidateQueries({ queryKey: ['stores'] });
    void queryClient.invalidateQueries({ queryKey: ['store-detail', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['store-credentials', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['store-bindings', drawerId] });
  };

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiPost('/api/v1/stores', values),
    onSuccess: () => {
      void message.success('店铺已创建');
      setCreateOpen(false);
      form.resetFields();
      refreshStore();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const credentialMutation = useMutation({
    mutationFn: (values: { apiKey: string }) =>
      apiPost(
        '/api/v1/stores/{storeId}/credentials',
        { credentialType: 'MAIN_API', payload: values },
        { storeId: drawerId ?? '' },
      ),
    onSuccess: () => {
      void message.success('凭证已加密保存');
      setCredentialModalOpen(false);
      credentialForm.resetFields();
      refreshStore();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const validateMutation = useMutation({
    mutationFn: (credentialId: string) =>
      apiPost<{ validationStatus: string; error: string | null }>(
        '/api/v1/stores/{storeId}/credentials/{id}/validate',
        {},
        { storeId: drawerId ?? '', id: credentialId },
      ),
    onSuccess: (result) => {
      if (result.validationStatus === 'VALID') {
        void message.success('连接验证通过（已连接）');
      } else if (result.validationStatus === 'INVALID') {
        void message.error(`认证失败：${result.error ?? ''}`);
      } else {
        void message.warning(`验证出错：${result.error ?? ''}`);
      }
      refreshStore();
      void queryClient.invalidateQueries({ queryKey: ['store-sync-overview'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const syncMutation = useMutation({
    mutationFn: (type: 'orders' | 'listings') =>
      apiPost('/api/v1/sync/' + type, { storeId: drawerId ?? '' }),
    onSuccess: () => {
      void message.success('同步任务已创建，可在「平台 / 同步中心」查看进度');
      void queryClient.invalidateQueries({ queryKey: ['store-sync-overview'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/stores/{id}/${action}`, {}, { id }),
    onSuccess: () => {
      void message.success('状态已更新');
      refreshStore();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 120 }}
          onChange={(value) => {
            setPage(1);
            setPlatformId(value);
          }}
          options={(platforms.data?.data ?? []).map((platform) => ({
            value: platform.id,
            label: platform.code,
          }))}
        />
        <Input.Search
          placeholder="搜索店铺编码 / 名称"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建店铺
        </Button>
      </Space>

      <Table<StoreRow>
        rowKey="id"
        loading={list.isLoading}
        dataSource={list.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: list.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        onRow={(record) => ({
          onClick: () => setDrawerId(record.id),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: '平台', dataIndex: 'platformCode', width: 80 },
          { title: '店铺编码', dataIndex: 'storeCode' },
          { title: '店铺名称', dataIndex: 'name' },
          { title: 'Seller ID', dataIndex: 'sellerId' },
          { title: '币种', dataIndex: 'defaultCurrency', width: 70 },
          {
            title: '凭证',
            dataIndex: 'credentialConfigured',
            width: 90,
            render: (value: boolean) =>
              value ? <Tag color="green">已配置</Tag> : <Tag color="orange">未配置</Tag>,
          },
          { title: '绑定仓数', dataIndex: 'bindingCount', width: 90 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 80,
            render: (value: string) => (
              <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>
                {value === 'ACTIVE' ? '启用' : '停用'}
              </Tag>
            ),
          },
        ]}
      />

      <Modal
        title="新建店铺"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="platformId" label="平台" rules={[{ required: true }]}>
            <Select
              options={(platforms.data?.data ?? []).map((platform) => ({
                value: platform.id,
                label: platform.code,
              }))}
            />
          </Form.Item>
          <Form.Item name="storeCode" label="店铺编码" rules={[{ required: true }]}>
            <Input placeholder="如 OZON-A" />
          </Form.Item>
          <Form.Item name="name" label="店铺名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="sellerId" label="Seller ID">
              <Input style={{ width: 180 }} />
            </Form.Item>
            <Form.Item name="defaultCurrency" label="币种" initialValue="RUB">
              <Select
                style={{ width: 100 }}
                options={[
                  { value: 'RUB', label: 'RUB' },
                  { value: 'CNY', label: 'CNY' },
                  { value: 'USD', label: 'USD' },
                ]}
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Drawer
        title={store ? `${store.platformCode} / ${store.storeCode}` : '店铺详情'}
        width={700}
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
      >
        <Tabs
          items={[
            {
              key: 'base',
              label: '基本资料',
              children: store !== undefined && (
                <Space direction="vertical">
                  <Descriptions
                    column={2}
                    size="small"
                    items={[
                      { key: 'code', label: '店铺编码', children: store.storeCode },
                      { key: 'name', label: '名称', children: store.name },
                      { key: 'seller', label: 'Seller ID', children: store.sellerId ?? '-' },
                      {
                        key: 'currency',
                        label: '币种',
                        children: store.defaultCurrency ?? '-',
                      },
                      { key: 'status', label: '状态', children: store.status },
                    ]}
                  />
                  {store.status === 'ACTIVE' ? (
                    <Button
                      danger
                      onClick={() => statusMutation.mutate({ id: store.id, action: 'deactivate' })}
                    >
                      停用店铺
                    </Button>
                  ) : (
                    <Button
                      onClick={() => statusMutation.mutate({ id: store.id, action: 'activate' })}
                    >
                      启用店铺
                    </Button>
                  )}
                </Space>
              ),
            },
            {
              key: 'credentials',
              label: 'API凭证',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => setCredentialModalOpen(true)}
                    disabled={drawerId === null}
                  >
                    配置 MAIN_API 凭证
                  </Button>
                  <Table<CredentialRow>
                    rowKey="id"
                    size="small"
                    dataSource={credentials.data?.data ?? []}
                    pagination={false}
                    columns={[
                      { title: '类型', dataIndex: 'credentialType' },
                      {
                        title: '状态',
                        dataIndex: 'status',
                        render: (value: string) => (
                          <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>{value}</Tag>
                        ),
                      },
                      {
                        title: '已配置',
                        dataIndex: 'configured',
                        render: (v: boolean) => (v ? '是' : '否'),
                      },
                      {
                        title: '验证状态',
                        dataIndex: 'lastValidationStatus',
                        render: (value: string | null) =>
                          value === 'VALID' ? (
                            <Tag color="green">已连接</Tag>
                          ) : value === 'INVALID' ? (
                            <Tag color="red">认证失败</Tag>
                          ) : value === 'ERROR' ? (
                            <Tag color="orange">验证出错</Tag>
                          ) : (
                            <Tag>未验证</Tag>
                          ),
                      },
                      {
                        title: '验证时间',
                        dataIndex: 'lastValidatedAt',
                        render: (value: string | null) =>
                          value === null ? '-' : new Date(value).toLocaleString('zh-CN'),
                      },
                      {
                        title: '操作',
                        render: (_: unknown, row: CredentialRow) => (
                          <Button
                            size="small"
                            loading={validateMutation.isPending}
                            onClick={() => validateMutation.mutate(row.id)}
                          >
                            验证连接
                          </Button>
                        ),
                      },
                      { title: '更新时间', dataIndex: 'updatedAt' },
                    ]}
                  />
                  <p style={{ color: '#888' }}>凭证加密存储，保存后不可查看明文（•••••••）。</p>
                </Space>
              ),
            },
            {
              key: 'sync',
              label: '同步',
              children:
                overview === undefined ? (
                  <Empty description="加载中…" />
                ) : (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Descriptions
                      column={2}
                      size="small"
                      bordered
                      items={[
                        {
                          key: 'cred',
                          label: '凭证状态',
                          children:
                            overview.credential === null
                              ? '未配置'
                              : overview.credential.lastValidationStatus === 'VALID'
                                ? '已连接'
                                : overview.credential.lastValidationStatus === 'INVALID'
                                  ? '认证失败'
                                  : overview.credential.lastValidationStatus === 'ERROR'
                                    ? `验证出错：${overview.credential.lastValidationError ?? ''}`
                                    : '未验证',
                        },
                        {
                          key: 'order',
                          label: '最后订单同步',
                          children: overview.lastOrderSync
                            ? `${overview.lastOrderSync.status} @ ${new Date(
                                overview.lastOrderSync.finishedAt ?? '',
                              ).toLocaleString('zh-CN')}`
                            : '从未同步',
                        },
                        {
                          key: 'listing',
                          label: '最后 Listing 同步',
                          children: overview.lastListingSync
                            ? `${overview.lastListingSync.status} @ ${new Date(
                                overview.lastListingSync.finishedAt ?? '',
                              ).toLocaleString('zh-CN')}`
                            : '从未同步',
                        },
                        {
                          key: 'failures',
                          label: '连续失败次数',
                          children:
                            overview.consecutiveFailures > 0 ? (
                              <Tag color="red">{overview.consecutiveFailures}</Tag>
                            ) : (
                              '0'
                            ),
                        },
                      ]}
                    />
                    <Space>
                      <Button
                        type="primary"
                        loading={syncMutation.isPending}
                        onClick={() => syncMutation.mutate('orders')}
                      >
                        手动同步订单
                      </Button>
                      <Button
                        loading={syncMutation.isPending}
                        onClick={() => syncMutation.mutate('listings')}
                      >
                        手动同步 Listing
                      </Button>
                    </Space>
                    <p style={{ color: '#888' }}>
                      自动调度需在环境变量开启并在店铺 settings.sync
                      中按店铺启用（分阶段上线策略）。
                    </p>
                  </Space>
                ),
            },
            {
              key: 'bindings',
              label: '仓库绑定',
              children: (
                <Table<BindingRow>
                  rowKey="id"
                  size="small"
                  dataSource={bindings.data?.data ?? []}
                  pagination={false}
                  columns={[
                    { title: '仓库', dataIndex: 'warehouseCode' },
                    { title: '名称', dataIndex: 'warehouseName' },
                    { title: '履约模式', dataIndex: 'fulfillmentMode' },
                    { title: '状态', dataIndex: 'status' },
                  ]}
                />
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        title="配置 MAIN_API 凭证（仅管理员）"
        open={credentialModalOpen}
        onCancel={() => setCredentialModalOpen(false)}
        onOk={() =>
          void credentialForm.validateFields().then((values) => credentialMutation.mutate(values))
        }
        confirmLoading={credentialMutation.isPending}
      >
        <Form form={credentialForm} layout="vertical">
          <Form.Item
            name="clientId"
            label="Client ID"
            rules={[{ required: true, message: '请输入 Client ID' }]}
          >
            <Input placeholder="OZON 后台的 Client ID" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={[{ required: true, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="加密存储，不会回显" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
