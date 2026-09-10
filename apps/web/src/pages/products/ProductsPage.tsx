import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
} from 'antd';
import { useState, useEffect } from 'react';
import { apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { SkuCreateModal } from '../../components/SkuCreateModal';

interface ProductRow {
  id: string;
  productCode: string;
  nameZh: string;
  nameRu: string | null;
  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  status: string;
  skuCount: number;
  createdAt: string;
}

interface ProductDetail {
  product: ProductRow & { remark: string | null };
  skus: Array<{
    id: string;
    skuCode: string;
    nameZh: string;
    model: string | null;
    color: string | null;
    size: string | null;
    serialTracking: boolean;
    status: string;
  }>;
}

const brandCategorySelect = {
  showSearch: true,
  optionFilterProp: 'label',
} as const;

const STATUS_TAG: Record<string, { color: string; label: string }> = {
  DRAFT: { color: 'default', label: '草稿' },
  ACTIVE: { color: 'green', label: '启用' },
  INACTIVE: { color: 'red', label: '停用' },
};

export function ProductsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [skuModalOpen, setSkuModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [brandForm] = Form.useForm();
  const [categoryForm] = Form.useForm();
  const [editForm] = Form.useForm();

  const list = useApiQuery<{ data: ProductRow[]; meta: { total: number } }>(
    '/api/v1/products',
    { page, pageSize: 50, keyword: keyword || undefined, status },
    ['products', page, keyword, status],
  );

  const brands = useApiQuery<{ data: Array<{ id: string; nameZh: string }> }>(
    '/api/v1/brands',
    {},
    ['brands'],
  );
  const categories = useApiQuery<{
    data: Array<{ id: string; nameZh: string; children?: Array<{ id: string; nameZh: string }> }>;
  }>('/api/v1/categories', {}, ['categories']);
  const detail = useApiQuery<{ data: ProductDetail }>(
    '/api/v1/products/{id}',
    {},
    ['product-detail', detailId],
    {
      id: detailId ?? '',
    },
    detailId !== null,
  );
  const productDetail = detail.data?.data;
  const editDetail = useApiQuery<{ data: ProductDetail }>(
    '/api/v1/products/{id}',
    {},
    ['product-edit', editId],
    { id: editId ?? '' },
    editId !== null,
  );
  const editSource = editDetail.data?.data?.product;

  useEffect(() => {
    if (editSource !== undefined && editOpen) {
      editForm.setFieldsValue({
        productCode: editSource.productCode,
        nameZh: editSource.nameZh,
        nameRu: editSource.nameRu ?? undefined,
        brandId: editSource.brandId ?? undefined,
        categoryId: editSource.categoryId ?? undefined,
        remark: editSource.remark ?? undefined,
      });
    }
  }, [editSource, editOpen, editForm]);

  const createMutation = useMutation({
    mutationFn: (values: { nameZh: string; brandId?: string; categoryId?: string }) =>
      apiPost('/api/v1/products', values),
    onSuccess: () => {
      void message.success('商品已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/products/{id}/${action}`, {}, { id }),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const createBrandMutation = useMutation({
    mutationFn: (values: { code: string; nameZh: string; nameEn?: string; nameRu?: string }) =>
      apiPost<{ id: string }>('/api/v1/brands', values),
    onSuccess: (brand) => {
      void message.success('品牌已创建');
      setBrandModalOpen(false);
      brandForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      form.setFieldValue('brandId', brand.id);
      editForm.setFieldValue('brandId', brand.id);
    },
    onError: (error: Error) => void message.error(`创建品牌失败: ${error.message}`),
  });

  const createCategoryMutation = useMutation({
    mutationFn: (values: { code: string; nameZh: string; nameRu?: string; parentId?: string }) =>
      apiPost<{ id: string }>('/api/v1/categories', values),
    onSuccess: (category) => {
      void message.success('分类已创建');
      setCategoryModalOpen(false);
      categoryForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      form.setFieldValue('categoryId', category.id);
      editForm.setFieldValue('categoryId', category.id);
    },
    onError: (error: Error) => void message.error(`创建分类失败: ${error.message}`),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      values,
    }: {
      id: string;
      values: {
        nameZh: string;
        nameRu?: string;
        brandId?: string;
        categoryId?: string;
        remark?: string;
      };
    }) => apiPatch('/api/v1/products/{id}', values, { id }),
    onSuccess: () => {
      void message.success('商品已更新');
      setEditOpen(false);
      setEditId(null);
      editForm.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['product-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['product-edit'] });
    },
    onError: (error: Error) => void message.error(`更新失败: ${error.message}`),
  });

  const flatCategories = (categories.data?.data ?? []).flatMap((node) => [
    { id: node.id, nameZh: node.nameZh },
    ...(node.children ?? []).map((child) => ({ id: child.id, nameZh: `— ${child.nameZh}` })),
  ]);

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Input.Search
          placeholder="搜索商品编号 / 名称"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 120 }}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
          options={[
            { value: 'DRAFT', label: '草稿' },
            { value: 'ACTIVE', label: '启用' },
            { value: 'INACTIVE', label: '停用' },
          ]}
        />
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          新建商品
        </Button>
      </Space>

      <Table<ProductRow>
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
          onClick: () => setDetailId(record.id),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: '商品编号', dataIndex: 'productCode' },
          { title: '商品名称', dataIndex: 'nameZh', ellipsis: true },
          { title: '品牌', dataIndex: 'brandName' },
          { title: '分类', dataIndex: 'categoryName' },
          { title: 'SKU数量', dataIndex: 'skuCount', width: 90 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (value: string) => (
              <Tag color={STATUS_TAG[value]?.color}>{STATUS_TAG[value]?.label ?? value}</Tag>
            ),
          },
          {
            title: '操作',
            width: 190,
            render: (_, record) => (
              <Space onClick={(event) => event.stopPropagation()}>
                <Button
                  size="small"
                  onClick={() => {
                    setEditId(record.id);
                    setEditOpen(true);
                  }}
                >
                  编辑
                </Button>
                {record.status !== 'ACTIVE' && (
                  <Button
                    size="small"
                    onClick={() => statusMutation.mutate({ id: record.id, action: 'activate' })}
                  >
                    启用
                  </Button>
                )}
                {record.status === 'ACTIVE' && (
                  <Button
                    size="small"
                    danger
                    onClick={() => statusMutation.mutate({ id: record.id, action: 'deactivate' })}
                  >
                    停用
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title="新建商品"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="留空编号则自动生成 PRD000001" />
          </Form.Item>
          <Form.Item
            name="brandId"
            label={
              <Space size={4}>
                品牌
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => setBrandModalOpen(true)}
                >
                  + 新增品牌
                </Button>
              </Space>
            }
          >
            <Select
              allowClear
              {...brandCategorySelect}
              options={(brands.data?.data ?? []).map((brand) => ({
                value: brand.id,
                label: brand.nameZh,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="categoryId"
            label={
              <Space size={4}>
                分类
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => setCategoryModalOpen(true)}
                >
                  + 新增分类
                </Button>
              </Space>
            }
          >
            <Select
              allowClear
              {...brandCategorySelect}
              options={flatCategories.map((category) => ({
                value: category.id,
                label: category.nameZh,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑商品${editSource !== undefined ? ` ${editSource.productCode}` : ''}`}
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          setEditId(null);
        }}
        onOk={() =>
          void editForm.validateFields().then((values) => {
            if (editId === null) return;
            updateMutation.mutate({ id: editId, values });
          })
        }
        confirmLoading={updateMutation.isPending}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="productCode" label="商品编号">
            <Input disabled />
          </Form.Item>
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input maxLength={500} />
          </Form.Item>
          <Form.Item name="nameRu" label="俄文名称（选填）">
            <Input maxLength={500} />
          </Form.Item>
          <Form.Item
            name="brandId"
            label={
              <Space size={4}>
                品牌
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => setBrandModalOpen(true)}
                >
                  + 新增品牌
                </Button>
              </Space>
            }
          >
            <Select
              allowClear
              {...brandCategorySelect}
              options={(brands.data?.data ?? []).map((brand) => ({
                value: brand.id,
                label: brand.nameZh,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="categoryId"
            label={
              <Space size={4}>
                分类
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => setCategoryModalOpen(true)}
                >
                  + 新增分类
                </Button>
              </Space>
            }
          >
            <Select
              allowClear
              {...brandCategorySelect}
              options={flatCategories.map((category) => ({
                value: category.id,
                label: category.nameZh,
              }))}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      <SkuCreateModal
        open={skuModalOpen}
        onClose={() => setSkuModalOpen(false)}
        fixedProduct={
          productDetail === undefined
            ? undefined
            : {
                id: productDetail.product.id,
                productCode: productDetail.product.productCode,
                nameZh: productDetail.product.nameZh,
              }
        }
      />

      <Modal
        title="新增品牌"
        open={brandModalOpen}
        onCancel={() => setBrandModalOpen(false)}
        onOk={() =>
          void brandForm.validateFields().then((values) => createBrandMutation.mutate(values))
        }
        confirmLoading={createBrandMutation.isPending}
      >
        <Form form={brandForm} layout="vertical">
          <Form.Item
            name="code"
            label="品牌编码"
            rules={[{ required: true, message: '请输入品牌编码' }]}
          >
            <Input placeholder="唯一编码，如 VALKYRIE" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入中文名称' }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="nameEn" label="英文名称（选填）">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="nameRu" label="俄文名称（选填）">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新增分类"
        open={categoryModalOpen}
        onCancel={() => setCategoryModalOpen(false)}
        onOk={() =>
          void categoryForm.validateFields().then((values) => createCategoryMutation.mutate(values))
        }
        confirmLoading={createCategoryMutation.isPending}
      >
        <Form form={categoryForm} layout="vertical">
          <Form.Item
            name="code"
            label="分类编码"
            rules={[{ required: true, message: '请输入分类编码' }]}
          >
            <Input placeholder="唯一编码，如 KEYBOARD" maxLength={100} />
          </Form.Item>
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入中文名称' }]}
          >
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="parentId" label="父分类（选填，不选则为顶级分类）">
            <Select
              allowClear
              options={flatCategories.map((category) => ({
                value: category.id,
                label: category.nameZh,
              }))}
            />
          </Form.Item>
          <Form.Item name="nameRu" label="俄文名称（选填）">
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={productDetail?.product.productCode ?? '商品详情'}
        size={720}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        extra={
          productDetail !== undefined && (
            <Space>
              <Button
                size="small"
                onClick={() => {
                  setEditId(productDetail.product.id);
                  setEditOpen(true);
                }}
              >
                编辑
              </Button>
              <Button type="primary" size="small" onClick={() => setSkuModalOpen(true)}>
                新建SKU
              </Button>
            </Space>
          )
        }
      >
        {productDetail !== undefined && (
          <Space orientation="vertical" style={{ width: '100%' }} size="large">
            <Descriptions
              column={2}
              size="small"
              items={[
                { key: 'code', label: '商品编号', children: productDetail.product.productCode },
                { key: 'name', label: '中文名称', children: productDetail.product.nameZh },
                { key: 'nameRu', label: '俄文名称', children: productDetail.product.nameRu ?? '-' },
                { key: 'brand', label: '品牌', children: productDetail.product.brandName ?? '-' },
                {
                  key: 'category',
                  label: '分类',
                  children: productDetail.product.categoryName ?? '-',
                },
                {
                  key: 'status',
                  label: '状态',
                  children:
                    STATUS_TAG[productDetail.product.status]?.label ?? productDetail.product.status,
                },
              ]}
            />
            <Table
              rowKey="id"
              size="small"
              dataSource={productDetail.skus}
              pagination={false}
              columns={[
                { title: 'SKU Code', dataIndex: 'skuCode' },
                { title: '名称', dataIndex: 'nameZh' },
                { title: '型号', dataIndex: 'model' },
                { title: '颜色', dataIndex: 'color' },
                { title: '尺寸', dataIndex: 'size' },
                {
                  title: 'SN管理',
                  dataIndex: 'serialTracking',
                  render: (value: boolean) => (value ? '是' : '否'),
                  width: 80,
                },
              ]}
            />
          </Space>
        )}
      </Drawer>
    </Space>
  );
}
