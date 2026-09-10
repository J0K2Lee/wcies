import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Image,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd';
import { useState } from 'react';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { SkuCreateModal } from '../../components/SkuCreateModal';

interface SkuRow {
  id: string;
  skuCode: string;
  nameZh: string;
  productId: string;
  productCode: string;
  productName: string;
  model: string | null;
  color: string | null;
  size: string | null;
  weightG: number | null;
  latestPurchasePrice: number | null;
  purchaseUrl: string | null;
  serialTracking: boolean;
  status: string;
  primaryBarcode: string | null;
  primaryImageUrl: string | null;
  listingCount: number;
}

interface BarcodeRow {
  id: string;
  barcode: string;
  barcodeType: string;
  isPrimary: boolean;
  status: string;
}

interface ImageRow {
  id: string;
  url: string;
  isPrimary: boolean;
  mimeType: string;
  fileSize: number;
}

interface MappingRow {
  id: string;
  platformCode: string;
  storeCode: string;
  platformProductId: string;
  offerId: string | null;
  sellerSku: string | null;
  title: string | null;
  url: string | null;
  status: string;
}

export function SkusPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [hasListing, setHasListing] = useState<string | undefined>();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  const [barcodeForm] = Form.useForm();

  const list = useApiQuery<{ data: SkuRow[]; meta: { total: number } }>(
    '/api/v1/skus',
    { page, pageSize: 50, keyword: keyword || undefined, hasListing },
    ['skus', page, keyword, hasListing],
  );

  const detail = useApiQuery<{ data: SkuRow }>(
    '/api/v1/skus/{id}',
    {},
    ['sku-detail', drawerId],
    {
      id: drawerId ?? '',
    },
    drawerId !== null,
  );
  const barcodes = useApiQuery<{ data: BarcodeRow[] }>(
    '/api/v1/skus/{skuId}/barcodes',
    {},
    ['sku-barcodes', drawerId],
    { skuId: drawerId ?? '' },
    drawerId !== null,
  );
  const images = useApiQuery<{ data: ImageRow[] }>(
    '/api/v1/skus/{skuId}/images',
    {},
    ['sku-images', drawerId],
    { skuId: drawerId ?? '' },
    drawerId !== null,
  );
  const mappings = useApiQuery<{ data: MappingRow[] }>(
    '/api/v1/listings/skus/{skuId}/mappings',
    {},
    ['sku-mappings', drawerId],
    { skuId: drawerId ?? '' },
    drawerId !== null,
  );

  const refreshSku = () => {
    void queryClient.invalidateQueries({ queryKey: ['skus'] });
    void queryClient.invalidateQueries({ queryKey: ['sku-detail', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-barcodes', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-images', drawerId] });
    void queryClient.invalidateQueries({ queryKey: ['sku-mappings', drawerId] });
  };

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/skus/{id}/${action}`, {}, { id }),
    onSuccess: (_data, variables) => {
      void message.success(variables.action === 'activate' ? 'SKU已启用' : 'SKU已停用');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const addBarcodeMutation = useMutation({
    mutationFn: (values: { barcode: string; barcodeType: string }) =>
      apiPost('/api/v1/skus/{skuId}/barcodes', values, { skuId: drawerId ?? '' }),
    onSuccess: () => {
      void message.success('条码已添加');
      setBarcodeModalOpen(false);
      barcodeForm.resetFields();
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const generateInternalMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/v1/skus/{skuId}/barcodes/generate-internal', {}, { skuId: drawerId ?? '' }),
    onSuccess: () => {
      void message.success('内部条码已生成');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const setPrimaryBarcodeMutation = useMutation({
    mutationFn: (barcodeId: string) =>
      apiPatch(
        '/api/v1/skus/{skuId}/barcodes/{barcodeId}',
        { isPrimary: true },
        { skuId: drawerId ?? '', barcodeId },
      ),
    onSuccess: () => {
      void message.success('主条码已切换');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteBarcodeMutation = useMutation({
    mutationFn: (barcodeId: string) =>
      apiDelete('/api/v1/skus/{skuId}/barcodes/{barcodeId}', { skuId: drawerId ?? '', barcodeId }),
    onSuccess: () => {
      void message.success('条码已删除');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const setPrimaryImageMutation = useMutation({
    mutationFn: (imageId: string) =>
      apiPatch(
        '/api/v1/skus/{skuId}/images/{imageId}',
        { isPrimary: true },
        { skuId: drawerId ?? '', imageId },
      ),
    onSuccess: () => {
      void message.success('主图已切换');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`/api/v1/skus/${drawerId}/images`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const body = (await response.json()) as { success: boolean; error?: { message: string } };
      if (!body.success) {
        throw new Error(body.error?.message ?? '上传失败');
      }
    },
    onSuccess: () => {
      void message.success('图片已上传');
      refreshSku();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const sku = detail.data?.data;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Input.Search
          placeholder="搜索 SKU / 名称 / 型号"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="平台映射"
          style={{ width: 140 }}
          onChange={(value) => {
            setPage(1);
            setHasListing(value);
          }}
          options={[
            { value: 'true', label: '已映射平台' },
            { value: 'false', label: '未映射' },
          ]}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建SKU
        </Button>
      </Space>

      <Table<SkuRow>
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
        scroll={{ x: 1200 }}
        columns={[
          {
            title: '图片',
            width: 70,
            render: (_, record) =>
              record.primaryImageUrl !== null ? (
                <Image
                  src={record.primaryImageUrl}
                  width={44}
                  height={44}
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                '-'
              ),
          },
          { title: 'SKU Code', dataIndex: 'skuCode' },
          { title: '中文名称', dataIndex: 'nameZh', ellipsis: true },
          { title: 'Product', dataIndex: 'productName', ellipsis: true },
          { title: '型号', dataIndex: 'model', width: 100 },
          { title: '颜色', dataIndex: 'color', width: 80 },
          { title: '尺寸', dataIndex: 'size', width: 80 },
          { title: '主条码', dataIndex: 'primaryBarcode', width: 140 },
          { title: '重量(g)', dataIndex: 'weightG', width: 90 },
          { title: '最新采购价(CNY)', dataIndex: 'latestPurchasePrice', width: 130 },
          {
            title: 'SN',
            dataIndex: 'serialTracking',
            width: 60,
            render: (v: boolean) => (v ? '是' : '否'),
          },
          { title: 'Listing数', dataIndex: 'listingCount', width: 90 },
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
        ]}
      />

      <SkuCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Drawer
        title={sku ? `${sku.skuCode} ${sku.nameZh}` : 'SKU详情'}
        width={860}
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
        extra={
          sku !== undefined && (
            <Space>
              {sku.status !== 'ACTIVE' && (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => statusMutation.mutate({ id: sku.id, action: 'activate' })}
                >
                  启用
                </Button>
              )}
              {sku.status === 'ACTIVE' && (
                <Popconfirm
                  title="确认停用该SKU？"
                  onConfirm={() => statusMutation.mutate({ id: sku.id, action: 'deactivate' })}
                >
                  <Button size="small" danger>
                    停用
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )
        }
      >
        <Tabs
          items={[
            {
              key: 'base',
              label: '基本信息',
              children: sku !== undefined && (
                <Descriptions
                  column={2}
                  size="small"
                  items={[
                    { key: 'code', label: 'SKU Code', children: sku.skuCode },
                    { key: 'name', label: '中文名称', children: sku.nameZh },
                    {
                      key: 'product',
                      label: '商品',
                      children: `${sku.productCode} ${sku.productName}`,
                    },
                    { key: 'model', label: '型号', children: sku.model ?? '-' },
                    { key: 'color', label: '颜色', children: sku.color ?? '-' },
                    { key: 'size', label: '尺寸', children: sku.size ?? '-' },
                    { key: 'weight', label: '重量(g)', children: sku.weightG ?? '-' },
                    {
                      key: 'price',
                      label: '最新采购价(CNY)',
                      children:
                        sku.latestPurchasePrice !== null ? `¥${sku.latestPurchasePrice}` : '-',
                    },
                    {
                      key: 'purchaseUrl',
                      label: '采购链接',
                      children:
                        sku.purchaseUrl !== null && sku.purchaseUrl !== '' ? (
                          <a href={sku.purchaseUrl} target="_blank" rel="noreferrer">
                            {sku.purchaseUrl}
                          </a>
                        ) : (
                          '-'
                        ),
                    },
                    { key: 'sn', label: 'SN管理', children: sku.serialTracking ? '是' : '否' },
                    {
                      key: 'status',
                      label: '状态',
                      children:
                        sku.status === 'ACTIVE'
                          ? '启用'
                          : sku.status === 'INACTIVE'
                            ? '停用'
                            : sku.status,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'barcodes',
              label: '条码',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Space>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => setBarcodeModalOpen(true)}
                      disabled={drawerId === null}
                    >
                      添加条码
                    </Button>
                    <Button
                      size="small"
                      onClick={() => generateInternalMutation.mutate()}
                      disabled={drawerId === null}
                    >
                      生成内部条码
                    </Button>
                  </Space>
                  <Table<BarcodeRow>
                    rowKey="id"
                    size="small"
                    dataSource={barcodes.data?.data ?? []}
                    pagination={false}
                    columns={[
                      { title: '条码', dataIndex: 'barcode' },
                      { title: '类型', dataIndex: 'barcodeType' },
                      {
                        title: '主条码',
                        dataIndex: 'isPrimary',
                        render: (v: boolean, record) =>
                          v ? (
                            <Tag color="blue">主</Tag>
                          ) : (
                            <Button
                              size="small"
                              onClick={() => setPrimaryBarcodeMutation.mutate(record.id)}
                            >
                              设为主条码
                            </Button>
                          ),
                      },
                      {
                        title: '操作',
                        render: (_, record) => (
                          <Popconfirm
                            title="确认删除该条码？"
                            onConfirm={() => deleteBarcodeMutation.mutate(record.id)}
                          >
                            <Button size="small" danger>
                              删除
                            </Button>
                          </Popconfirm>
                        ),
                      },
                    ]}
                  />
                </Space>
              ),
            },
            {
              key: 'images',
              label: '图片',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Upload
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    showUploadList={false}
                    customRequest={({ file }) => uploadMutation.mutate(file as File)}
                  >
                    <Button size="small" type="primary">
                      上传图片
                    </Button>
                  </Upload>
                  <Space wrap>
                    {(images.data?.data ?? []).map((image) => (
                      <div key={image.id} style={{ textAlign: 'center' }}>
                        <Image
                          src={image.url}
                          width={120}
                          height={120}
                          style={{ objectFit: 'cover' }}
                        />
                        <div>
                          {image.isPrimary ? (
                            <Tag color="blue">主图</Tag>
                          ) : (
                            <Button
                              size="small"
                              type="link"
                              onClick={() => setPrimaryImageMutation.mutate(image.id)}
                            >
                              设为主图
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </Space>
                </Space>
              ),
            },
            {
              key: 'mappings',
              label: `平台映射 (${mappings.data?.data.length ?? 0})`,
              children: (
                <Table<MappingRow>
                  rowKey="id"
                  size="small"
                  dataSource={mappings.data?.data ?? []}
                  pagination={false}
                  columns={[
                    { title: '平台', dataIndex: 'platformCode', width: 80 },
                    { title: '店铺', dataIndex: 'storeCode', width: 110 },
                    { title: 'Platform Product ID', dataIndex: 'platformProductId' },
                    { title: 'Offer ID', dataIndex: 'offerId' },
                    { title: 'Seller SKU', dataIndex: 'sellerSku' },
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
                  ]}
                />
              ),
            },
          ]}
        />
      </Drawer>

      <Modal
        title="添加条码"
        open={barcodeModalOpen}
        onCancel={() => setBarcodeModalOpen(false)}
        onOk={() =>
          void barcodeForm.validateFields().then((values) => addBarcodeMutation.mutate(values))
        }
        confirmLoading={addBarcodeMutation.isPending}
      >
        <Form form={barcodeForm} layout="vertical">
          <Form.Item
            name="barcode"
            label="条码"
            rules={[{ required: true, message: '请输入条码' }]}
          >
            <Input placeholder="69码 / EAN / GTIN" />
          </Form.Item>
          <Form.Item
            name="barcodeType"
            label="类型"
            initialValue="EAN"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'EAN', label: 'EAN（69码）' },
                { value: 'GTIN', label: 'GTIN' },
                { value: 'MANUFACTURER', label: '厂商条码' },
                { value: 'INTERNAL', label: '内部条码' },
                { value: 'OTHER', label: '其他' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
