import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Upload,
} from 'antd';
import { useState } from 'react';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';

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
  weightKg: number | null;
  latestPurchasePrice: number | null;
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
  const [form] = Form.useForm();
  const [barcodeForm] = Form.useForm();

  const list = useApiQuery<{ data: SkuRow[]; meta: { total: number } }>(
    '/api/v1/skus',
    { page, pageSize: 50, keyword: keyword || undefined, hasListing },
    ['skus', page, keyword, hasListing],
  );
  const products = useApiQuery<{
    data: Array<{ id: string; productCode: string; nameZh: string }>;
  }>('/api/v1/products', { page: 1, pageSize: 100 }, ['products-lite']);

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

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiPost('/api/v1/skus', values),
    onSuccess: () => {
      void message.success('SKU已创建');
      setCreateOpen(false);
      form.resetFields();
      refreshSku();
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
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
          { title: '重量(kg)', dataIndex: 'weightKg', width: 90 },
          { title: '最新采购价', dataIndex: 'latestPurchasePrice', width: 100 },
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

      <Modal
        title="新建SKU"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="productId"
            label="所属商品"
            rules={[{ required: true, message: '请选择商品' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={(products.data?.data ?? []).map((product) => ({
                value: product.id,
                label: `${product.productCode} ${product.nameZh}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="model" label="型号">
              <Input style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="color" label="颜色">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="size" label="尺寸">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Space wrap>
            <Form.Item name="weightKg" label="重量(kg)">
              <InputNumber min={0} step={0.01} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item name="lengthCm" label="长(cm)">
              <InputNumber min={0} step={0.1} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="widthCm" label="宽(cm)">
              <InputNumber min={0} step={0.1} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="heightCm" label="高(cm)">
              <InputNumber min={0} step={0.1} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <Form.Item name="latestPurchasePrice" label="最新采购价">
            <InputNumber min={0} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item
            name="serialTracking"
            label="SN序列号管理"
            valuePropName="checked"
            initialValue={false}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={sku ? `${sku.skuCode} ${sku.nameZh}` : 'SKU详情'}
        width={860}
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
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
                    { key: 'weight', label: '重量(kg)', children: sku.weightKg ?? '-' },
                    {
                      key: 'price',
                      label: '最新采购价',
                      children:
                        sku.latestPurchasePrice !== null ? `${sku.latestPurchasePrice} ${''}` : '-',
                    },
                    { key: 'sn', label: 'SN管理', children: sku.serialTracking ? '是' : '否' },
                    { key: 'status', label: '状态', children: sku.status },
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
