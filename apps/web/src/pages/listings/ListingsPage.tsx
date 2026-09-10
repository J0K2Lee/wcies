import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Modal, Select, Space, Table, Tag } from 'antd';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiPost, useApiQuery, useDebouncedValue } from '../../api/hooks';

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
  mappingCount: number;
}

interface ListingSkuRow {
  id: string;
  skuId: string | null;
  skuCode: string | null;
  skuName: string | null;
  mappingStatus: string;
  platformSkuId: string | null;
  sellerSku: string | null;
  offerId: string | null;
  status: string;
}

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
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [mapTarget, setMapTarget] = useState<ListingSkuRow | null>(null);
  const [form] = Form.useForm();
  const [mapForm] = Form.useForm();
  const [skuKeyword, setSkuKeyword] = useState('');
  const debouncedSkuKeyword = useDebouncedValue(skuKeyword);
  const mapMutation = useMutation({
    mutationFn: (skuId: string) =>
      apiPost(
        '/api/v1/listings/{listingId}/skus/{id}/map',
        { skuId },
        { listingId: detailId ?? '', id: mapTarget?.id ?? '' },
      ),
    onSuccess: () => {
      void message.success('映射完成（后续同步不会覆盖）');
      setMapTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['listing-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['listings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

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
  const detail = useApiQuery<{
    data: {
      platformCode: string;
      storeCode: string;
      platformProductId: string;
      skus: ListingSkuRow[];
    };
  }>(
    '/api/v1/listings/{id}',
    {},
    ['listing-detail', detailId],
    {
      id: detailId ?? '',
    },
    detailId !== null,
  );
  const listingDetail = detail.data?.data;

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

  const storeOptions = (stores.data?.data ?? [])
    .filter((store) => platformId === undefined || store.platformId === platformId)
    .map((store) => ({ value: store.id, label: `${store.storeCode} ${store.name}` }));

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
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
            label: platform.code,
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
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建Listing映射
        </Button>
      </Space>

      <Table<ListingRow>
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
        columns={[
          { title: '平台', dataIndex: 'platformCode', width: 80 },
          { title: '店铺', dataIndex: 'storeCode', width: 110 },
          { title: 'Platform Product ID', dataIndex: 'platformProductId' },
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
          { title: '映射数', dataIndex: 'mappingCount', width: 80 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 80,
            render: (value: string) => (
              <Tag color={value === 'ACTIVE' ? 'green' : 'default'}>
                {value === 'ACTIVE' ? '启用' : value}
              </Tag>
            ),
          },
          {
            title: '操作',
            width: 90,
            render: (_, record) => (
              <Button size="small" onClick={() => setDetailId(record.id)}>
                详情
              </Button>
            ),
          },
        ]}
      />

      <Modal
        title="新建Listing映射（支持多SKU变体）"
        open={createOpen}
        width={720}
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
                  label: platform.code,
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
            ? `${listingDetail.platformCode} / ${listingDetail.storeCode} / ${listingDetail.platformProductId}`
            : 'Listing详情'
        }
        size={720}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      >
        <Table<ListingSkuRow>
          rowKey="id"
          size="small"
          dataSource={listingDetail?.skus ?? []}
          pagination={false}
          columns={[
            {
              title: '映射状态',
              dataIndex: 'mappingStatus',
              width: 90,
              render: (value: string) =>
                value === 'MAPPED' ? (
                  <Tag color="green">MAPPED</Tag>
                ) : (
                  <Tag color="orange">UNMAPPED</Tag>
                ),
            },
            {
              title: '内部SKU',
              dataIndex: 'skuCode',
              render: (value: string | null) => value ?? <Tag color="orange">未映射</Tag>,
            },
            { title: '名称', dataIndex: 'skuName', render: (value: string | null) => value ?? '-' },
            { title: 'Platform SKU', dataIndex: 'platformSkuId' },
            { title: 'Seller SKU', dataIndex: 'sellerSku' },
            { title: 'Offer ID', dataIndex: 'offerId' },
            {
              title: '操作',
              width: 110,
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
                ) : null,
            },
          ]}
        />

        <Modal
          title={`人工映射：${mapTarget?.offerId ?? mapTarget?.platformSkuId ?? ''} → Internal SKU`}
          open={mapTarget !== null}
          onCancel={() => setMapTarget(null)}
          onOk={() =>
            void mapForm.validateFields().then((values) => mapMutation.mutate(values.skuId))
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
      </Drawer>
    </Space>
  );
}
