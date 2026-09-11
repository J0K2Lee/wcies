import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space } from 'antd';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiDelete, apiPatch, apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';
import {
  ACTIVE_STATUS_LABEL,
  ActionMenu,
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  DeleteConfirmModal,
  EntitySummary,
  ErrorState,
  FilterBar,
  InfoGrid,
  PageHeader,
  PlatformTag,
  RelativeTime,
  SectionCard,
  StatusBadge,
  labelOf,
  useContextRail,
} from '../../design-system';

interface ListingRow {
  id: string;
  platformId: string;
  platformCode: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformProductId: string;
  title: string | null;
  url: string | null;
  status: string;
  updatedAt: string;
  mappingCount: number;
}

interface ListingSkuRow {
  id: string;
  listingId: string;
  skuId: string | null;
  skuCode: string | null;
  skuName: string | null;
  mappingStatus: string;
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
  status: string;
}

interface ListingDetail {
  id: string;
  platformCode: string;
  storeCode: string;
  storeName: string;
  platformProductId: string;
  title: string | null;
  url: string | null;
  status: string;
  updatedAt: string;
  lastSeenAt: string | null;
  skus: ListingSkuRow[];
}

const listingStatusBadge = (value: string) => (
  <StatusBadge
    tone={value === 'ACTIVE' ? 'success' : 'neutral'}
    label={labelOf(ACTIVE_STATUS_LABEL, value)}
    hint={value}
  />
);

export function ListingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [platformId, setPlatformId] = useState<string | undefined>();
  const [storeId, setStoreId] = useState<string | undefined>();
  const [mappingState, setMappingState] = useState<string | undefined>();
  // ?keyword= deep link from the exception center / mapping overview.
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Modal-chain fix: snapshot the variant row (incl. listingId) the map modal
  // was opened for; the drawer's onClose may null detailId while the modal is
  // still open.
  const [mapTarget, setMapTarget] = useState<ListingSkuRow | null>(null);
  const [form] = Form.useForm();
  const [mapForm] = Form.useForm();
  // Row actions act on a snapshotted row, so a closing drawer cannot blank the
  // id out from under an open modal (the same modal-chain fix as above).
  const [mappingEditTarget, setMappingEditTarget] = useState<ListingSkuRow | null>(null);
  const [mappingDeleteTarget, setMappingDeleteTarget] = useState<ListingSkuRow | null>(null);
  const [mappingEditForm] = Form.useForm();
  const [skuKeyword, setSkuKeyword] = useState('');
  const debouncedSkuKeyword = useDebouncedValue(skuKeyword);

  const list = useApiQuery<{ data: ListingRow[]; meta: { total: number } }>(
    '/api/v1/listings',
    {
      page,
      pageSize: 50,
      platformId,
      storeId,
      mappingState,
      keyword: keyword || undefined,
    },
    ['listings', page, platformId, storeId, mappingState, keyword],
  );
  const platforms = useApiQuery<{ data: Array<{ id: string; code: string; name: string }> }>(
    '/api/v1/platforms',
    {},
    ['platforms'],
  );
  const stores = useApiQuery<{
    data: Array<{ id: string; platformId: string; storeCode: string; name: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-lite']);
  // Reactive platform -> store cascading for the create-mapping modal:
  // server-side filtered so large store lists are never truncated.
  const createPlatformId = Form.useWatch('platformId', form);
  const storesForPlatform = useApiQuery<{
    data: Array<{ id: string; platformId: string; storeCode: string; name: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100, platformId: createPlatformId }, [
    'stores-for-platform',
    createPlatformId ?? 'none',
  ]);
  const skus = useApiQuery<{ data: Array<{ id: string; skuCode: string; nameZh: string }> }>(
    '/api/v1/skus',
    { page: 1, pageSize: 50, keyword: debouncedSkuKeyword || undefined },
    ['skus-for-mapping', debouncedSkuKeyword],
  );
  const detail = useApiQuery<{ data: ListingDetail }>(
    '/api/v1/listings/{id}',
    {},
    ['listing-detail', detailId],
    {
      id: detailId ?? '',
    },
    detailId !== null,
  );
  const listingDetail = detail.data?.data;

  const refreshListings = () => {
    void queryClient.invalidateQueries({ queryKey: ['listings'] });
    void queryClient.invalidateQueries({ queryKey: ['listing-detail'] });
  };

  const mapMutation = useMutation({
    mutationFn: (input: { listingId: string; mappingId: string; skuId: string }) =>
      apiPost(
        '/api/v1/listings/{listingId}/skus/{id}/map',
        { skuId: input.skuId },
        {
          listingId: input.listingId,
          id: input.mappingId,
        },
      ),
    onSuccess: () => {
      void message.success('映射完成（后续同步不会覆盖）');
      setMapTarget(null);
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: (values: {
      platformId: string;
      storeId: string;
      platformProductId: string;
      title?: string;
      url?: string;
      skuVariants: Array<{
        skuId: string;
        platformSkuId?: string;
        sellerSku?: string;
        offerId?: string;
      }>;
    }) => apiPost('/api/v1/listings', values),
    onSuccess: () => {
      void message.success('Listing已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  const listingStatusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(
        action === 'activate'
          ? '/api/v1/listings/{id}/activate'
          : '/api/v1/listings/{id}/deactivate',
        {},
        { id },
      ),
    onSuccess: () => {
      void message.success('Listing状态已更新');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const listingDeleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/listings/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('Listing已删除');
      if (detailId === id) {
        setDetailId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const mappingStatusMutation = useMutation({
    mutationFn: (input: { listingId: string; mappingId: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      apiPatch(
        '/api/v1/listings/{listingId}/skus/{id}',
        { status: input.status },
        { listingId: input.listingId, id: input.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射状态已更新');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const mappingDeleteMutation = useMutation({
    mutationFn: (input: { listingId: string; mappingId: string }) =>
      apiDelete('/api/v1/listings/{listingId}/skus/{id}', {
        listingId: input.listingId,
        id: input.mappingId,
      }),
    onSuccess: () => {
      void message.success('映射已删除');
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  /** Edits a mapping's platform identifiers (the SKU binding is changed via 人工映射). */
  const mappingEditMutation = useMutation({
    mutationFn: (input: {
      listingId: string;
      mappingId: string;
      platformSkuId?: string;
      sellerSku?: string;
      offerId?: string;
    }) =>
      apiPatch(
        '/api/v1/listings/{listingId}/skus/{id}',
        {
          platformSkuId: input.platformSkuId?.trim() || null,
          sellerSku: input.sellerSku?.trim() || null,
          offerId: input.offerId?.trim() || null,
        },
        { listingId: input.listingId, id: input.mappingId },
      ),
    onSuccess: () => {
      void message.success('映射已更新');
      setMappingEditTarget(null);
      mappingEditForm.resetFields();
      refreshListings();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const storeOptions = (stores.data?.data ?? [])
    .filter((store) => platformId === undefined || store.platformId === platformId)
    .map((store) => ({ value: store.id, label: `${store.storeCode} ${store.name}` }));

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // ---- Context rail: overview stats when idle, selected listing summary ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="映射概览">
            <ContextMetric
              label="当前筛选结果"
              value={`${list.data?.meta.total ?? 0} 个 Listing`}
            />
            <ContextMetric label="本页" value={`${list.data?.data.length ?? 0} 条`} />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击表格任意行，在此预览 Listing 与变体映射概况。
            </span>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.platformProductId}
          subtitle={`${selectedRow.storeCode} ${selectedRow.storeName}`}
          badge={listingStatusBadge(selectedRow.status)}
          meta={<PlatformTag code={selectedRow.platformCode} />}
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="标题" value={selectedRow.title ?? '—'} />
            <ContextMetric label="变体映射" value={`${selectedRow.mappingCount} 个`} />
            <ContextMetric
              label="更新时间"
              value={<RelativeTime value={selectedRow.updatedAt} />}
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="SKU映射"
        description="管理平台商品（Listing）与内部SKU的变体映射；人工确认的映射不会被后续同步覆盖"
        primary={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建映射
          </Button>
        }
      />

      <FilterBar>
        <Select
          allowClear
          placeholder="平台"
          style={{ width: 120 }}
          onChange={(value) => {
            setPage(1);
            setPlatformId(value);
            setStoreId(undefined);
          }}
          options={(platforms.data?.data ?? []).map((platform) => ({
            value: platform.id,
            label: platform.name,
          }))}
        />
        <Select
          allowClear
          placeholder="店铺"
          showSearch
          optionFilterProp="label"
          style={{ width: 160 }}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
          options={storeOptions}
        />
        <Select
          allowClear
          placeholder="映射状态"
          style={{ width: 120 }}
          onChange={(value) => {
            setPage(1);
            setMappingState(value);
          }}
          options={[
            { value: 'MAPPED', label: '已映射' },
            { value: 'UNMAPPED', label: '待映射' },
          ]}
        />
        <Input.Search
          placeholder="Platform Product ID / 标题"
          allowClear
          defaultValue={keyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['listings'] })}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<ListingRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            emptyTitle="暂无Listing"
            emptyDescription="调整筛选条件，或点击右上角新建映射"
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            columns={[
              {
                title: '平台',
                dataIndex: 'platformCode',
                width: 100,
                render: (value: string) => <PlatformTag code={value} />,
              },
              { title: '店铺', dataIndex: 'storeCode', width: 100 },
              {
                title: 'Platform Product ID',
                dataIndex: 'platformProductId',
                width: 160,
                render: (value: string) => (
                  <span style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{value}</span>
                ),
              },
              {
                title: '标题',
                dataIndex: 'title',
                ellipsis: true,
                render: (value: string | null, record) =>
                  record.url !== null ? (
                    <a href={record.url} target="_blank" rel="noreferrer">
                      {value ?? record.url}
                    </a>
                  ) : (
                    (value ?? '-')
                  ),
              },
              {
                title: '变体',
                dataIndex: 'mappingCount',
                width: 70,
                render: (value: number) => `${value} 个`,
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 90,
                render: (value: string) => listingStatusBadge(value),
              },
              {
                title: '更新时间',
                dataIndex: 'updatedAt',
                width: 110,
                render: (value: string) => <RelativeTime value={value} />,
              },
              {
                title: '操作',
                key: 'actions',
                width: 76,
                render: (_: unknown, record: ListingRow) => (
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0 }}
                    onClick={() => setDetailId(record.id)}
                  >
                    详情
                  </Button>
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      <Modal
        title="新建Listing映射（支持多SKU变体）"
        open={createOpen}
        width={720}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item
              name="platformId"
              label="平台"
              rules={[{ required: true, message: '请选择平台' }]}
            >
              <Select
                style={{ width: 140 }}
                onChange={() => form.setFieldValue('storeId', undefined)}
                options={(platforms.data?.data ?? []).map((platform) => ({
                  value: platform.id,
                  label: platform.name,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="storeId"
              label="店铺"
              rules={[{ required: true, message: '请选择店铺' }]}
              dependencies={['platformId']}
            >
              <Select
                style={{ width: 220 }}
                showSearch
                optionFilterProp="label"
                disabled={createPlatformId === undefined}
                placeholder={createPlatformId === undefined ? '请先选择平台' : '选择该平台下的店铺'}
                options={(storesForPlatform.data?.data ?? []).map((store) => ({
                  value: store.id,
                  label: `${store.storeCode} ${store.name}`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="platformProductId"
              label="Platform Product ID"
              rules={[{ required: true }]}
            >
              <Input style={{ width: 200 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="title" label="标题">
              <Input style={{ width: 300 }} />
            </Form.Item>
            <Form.Item name="url" label="URL">
              <Input style={{ width: 300 }} />
            </Form.Item>
          </Space>
          <Form.List name="skuVariants" initialValue={[{}]}>
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" wrap>
                    <Form.Item
                      name={[field.name, 'skuId']}
                      rules={[{ required: true, message: '选择内部SKU' }]}
                      style={{ minWidth: 240 }}
                    >
                      <Select
                        showSearch
                        filterOption={false}
                        onSearch={setSkuKeyword}
                        notFoundContent={skus.isLoading ? '搜索中...' : '无匹配SKU'}
                        placeholder="内部SKU（可输入编码/名称搜索）"
                        options={(skus.data?.data ?? []).map((sku) => ({
                          value: sku.id,
                          label: `${sku.skuCode} ${sku.nameZh}`,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'platformSkuId']}>
                      <Input placeholder="Platform SKU ID" style={{ width: 150 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'sellerSku']}>
                      <Input placeholder="Seller SKU" style={{ width: 130 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'offerId']}>
                      <Input placeholder="Offer ID" style={{ width: 120 }} />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>
                      删除
                    </Button>
                  </Space>
                ))}
                <Button onClick={() => add()}>+ 添加变体</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Drawer
        title={
          listingDetail
            ? `${listingDetail.storeCode} / ${listingDetail.platformProductId}`
            : 'Listing详情'
        }
        size={720}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        extra={
          listingDetail !== undefined ? (
            <Space>
              {listingDetail.status === 'ACTIVE' ? (
                <Popconfirm
                  title="确认停用该Listing？"
                  description="停用后可随时重新启用。"
                  onConfirm={() =>
                    listingStatusMutation.mutate({
                      id: listingDetail.id,
                      action: 'deactivate',
                    })
                  }
                >
                  <Button size="small" danger loading={listingStatusMutation.isPending}>
                    停用
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  loading={listingStatusMutation.isPending}
                  onClick={() =>
                    listingStatusMutation.mutate({ id: listingDetail.id, action: 'activate' })
                  }
                >
                  启用
                </Button>
              )}
              <Popconfirm
                title="确认删除该Listing？"
                description="存在变体映射的Listing无法删除；被拒时会返回具体原因。"
                onConfirm={() => listingDeleteMutation.mutate(listingDetail.id)}
              >
                <Button size="small" danger loading={listingDeleteMutation.isPending}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ) : undefined
        }
      >
        {detail.isError ? (
          <span style={{ color: colors.danger }}>
            详情加载失败：{(detail.error as Error | null)?.message ?? '请稍后重试'}
          </span>
        ) : listingDetail === undefined ? (
          <span style={{ color: colors.textTertiary }}>加载中…</span>
        ) : (
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
                基本信息
              </div>
              <InfoGrid
                columns={2}
                items={[
                  {
                    label: '平台',
                    children: <PlatformTag code={listingDetail.platformCode} />,
                  },
                  {
                    label: '店铺',
                    children: `${listingDetail.storeCode} ${listingDetail.storeName}`,
                  },
                  {
                    label: '状态',
                    children: listingStatusBadge(listingDetail.status),
                  },
                  {
                    label: '最近同步发现',
                    children: <RelativeTime value={listingDetail.lastSeenAt} fallback="未发现" />,
                  },
                  {
                    label: '标题',
                    span: 2,
                    children:
                      listingDetail.url !== null ? (
                        <a href={listingDetail.url} target="_blank" rel="noreferrer">
                          {listingDetail.title ?? listingDetail.url}
                        </a>
                      ) : (
                        (listingDetail.title ?? '—')
                      ),
                  },
                  {
                    label: 'Platform Product ID',
                    children: (
                      <span style={{ fontFamily: 'monospace', fontSize: 12.5 }}>
                        {listingDetail.platformProductId}
                      </span>
                    ),
                  },
                  {
                    label: '更新时间',
                    children: <RelativeTime value={listingDetail.updatedAt} />,
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
                变体映射（{listingDetail.skus.length}）
              </div>
              <DataTable<ListingSkuRow>
                rowKey="id"
                size="small"
                loading={detail.isLoading}
                dataSource={listingDetail.skus}
                pagination={false}
                emptyTitle="暂无变体"
                emptyDescription="该Listing尚无变体映射记录"
                columns={[
                  {
                    title: '映射状态',
                    dataIndex: 'mappingStatus',
                    width: 90,
                    render: (value: string) =>
                      value === 'MAPPED' ? (
                        <StatusBadge tone="success" label="已映射" />
                      ) : (
                        <StatusBadge tone="warning" label="未映射" />
                      ),
                  },
                  {
                    title: '内部SKU',
                    dataIndex: 'skuCode',
                    render: (value: string | null) =>
                      value ?? <StatusBadge tone="warning" label="未映射" showDot={false} />,
                  },
                  {
                    title: '名称',
                    dataIndex: 'skuName',
                    render: (value: string | null) => value ?? '-',
                  },
                  {
                    title: 'Platform SKU',
                    dataIndex: 'platformSkuId',
                    render: (value: string | null) => value ?? '—',
                  },
                  {
                    title: 'Seller SKU',
                    dataIndex: 'sellerSku',
                    render: (value: string | null) => value ?? '—',
                  },
                  {
                    title: 'Offer ID',
                    dataIndex: 'offerId',
                    render: (value: string | null) => value ?? '—',
                  },
                  {
                    title: '操作',
                    key: 'actions',
                    width: 180,
                    render: (_: unknown, row: ListingSkuRow) =>
                      row.mappingStatus === 'UNMAPPED' ? (
                        <Button
                          size="small"
                          type="primary"
                          ghost
                          onClick={() => {
                            setMapTarget(row);
                            mapForm.resetFields();
                          }}
                        >
                          人工映射
                        </Button>
                      ) : (
                        <ActionMenu
                          primary={
                            <Button
                              type="link"
                              size="small"
                              style={{ paddingInline: 4 }}
                              onClick={() => {
                                setMapTarget(row);
                                mapForm.resetFields();
                              }}
                            >
                              人工映射
                            </Button>
                          }
                          items={[
                            {
                              key: 'edit',
                              label: '编辑映射',
                              onClick: () => {
                                setMappingEditTarget(row);
                                mappingEditForm.resetFields();
                              },
                            },
                            row.status === 'ACTIVE'
                              ? {
                                  key: 'deactivate',
                                  label: '停用',
                                  danger: true,
                                  onClick: () =>
                                    mappingStatusMutation.mutate({
                                      listingId: row.listingId,
                                      mappingId: row.id,
                                      status: 'INACTIVE',
                                    }),
                                }
                              : {
                                  key: 'activate',
                                  label: '启用',
                                  onClick: () =>
                                    mappingStatusMutation.mutate({
                                      listingId: row.listingId,
                                      mappingId: row.id,
                                      status: 'ACTIVE',
                                    }),
                                },
                            {
                              key: 'delete',
                              label: '删除',
                              danger: true,
                              onClick: () => setMappingDeleteTarget(row),
                            },
                          ]}
                        />
                      ),
                  },
                ]}
              />
            </section>
          </Space>
        )}

        <Modal
          title={`人工映射：${mapTarget?.offerId ?? mapTarget?.platformSkuId ?? ''} → Internal SKU`}
          open={mapTarget !== null}
          zIndex={1100}
          onCancel={() => setMapTarget(null)}
          onOk={() =>
            void mapForm.validateFields().then((values) => {
              if (mapTarget === null || mapTarget.listingId === '' || mapTarget.id === '') {
                void message.error('映射上下文丢失，请重新打开后重试');
                return;
              }
              mapMutation.mutate({
                listingId: mapTarget.listingId,
                mappingId: mapTarget.id,
                skuId: values.skuId,
              });
            })
          }
          confirmLoading={mapMutation.isPending}
        >
          <p style={{ color: '#888' }}>
            同步而来的平台SKU事实，人工确认后绑定内部SKU；后续平台同步不会覆盖该映射。
          </p>
          <Form form={mapForm} layout="vertical">
            <Form.Item
              name="skuId"
              label="内部SKU"
              rules={[{ required: true, message: '请选择内部SKU' }]}
            >
              <Select
                showSearch
                filterOption={false}
                onSearch={setSkuKeyword}
                notFoundContent={skus.isLoading ? '搜索中...' : '无匹配SKU'}
                placeholder="内部SKU（可输入编码/名称搜索）"
                options={(skus.data?.data ?? []).map((sku) => ({
                  value: sku.id,
                  label: `${sku.skuCode} ${sku.nameZh}`,
                }))}
              />
            </Form.Item>
          </Form>
        </Modal>

        {/* ---- Edit mapping: platform identifiers only (SKU binding uses 人工映射) ---- */}
        <Modal
          title={`编辑映射：${mappingEditTarget?.skuCode ?? '变体'}`}
          open={mappingEditTarget !== null}
          zIndex={1100}
          onCancel={() => setMappingEditTarget(null)}
          confirmLoading={mappingEditMutation.isPending}
          onOk={() =>
            void mappingEditForm.validateFields().then((values) => {
              if (mappingEditTarget === null) {
                void message.error('映射上下文丢失，请重新打开后重试');
                return;
              }
              mappingEditMutation.mutate({
                listingId: mappingEditTarget.listingId,
                mappingId: mappingEditTarget.id,
                platformSkuId: values.platformSkuId,
                sellerSku: values.sellerSku,
                offerId: values.offerId,
              });
            })
          }
        >
          <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
            修改平台标识。要更换绑定的内部 SKU，请使用「人工映射」。
          </p>
          <Form form={mappingEditForm} layout="vertical">
            <Form.Item name="platformSkuId" label="Platform SKU ID">
              <Input placeholder="平台 SKU ID" maxLength={255} />
            </Form.Item>
            <Form.Item name="sellerSku" label="Seller SKU">
              <Input placeholder="卖家 SKU" maxLength={255} />
            </Form.Item>
            <Form.Item name="offerId" label="Offer ID">
              <Input placeholder="Offer ID" maxLength={255} />
            </Form.Item>
          </Form>
        </Modal>

        <DeleteConfirmModal
          open={mappingDeleteTarget !== null}
          title="确认删除该映射？"
          description={`将删除「${mappingDeleteTarget?.skuCode ?? ''}」与平台变体「${
            mappingDeleteTarget?.offerId ?? mappingDeleteTarget?.platformSkuId ?? ''
          }」的映射关系。Listing 本身保留。`}
          forceWarning="若该映射已被订单行引用，删除会被拒绝——订单行是履约凭证，无法移除。"
          confirmLoading={mappingDeleteMutation.isPending}
          onConfirm={() => {
            if (mappingDeleteTarget === null) {
              return;
            }
            mappingDeleteMutation.mutate(
              { listingId: mappingDeleteTarget.listingId, mappingId: mappingDeleteTarget.id },
              { onSettled: () => setMappingDeleteTarget(null) },
            );
          }}
          onCancel={() => setMappingDeleteTarget(null)}
        />
      </Drawer>
    </div>
  );
}
