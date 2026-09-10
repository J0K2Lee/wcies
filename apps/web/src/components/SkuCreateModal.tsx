import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Form, Input, InputNumber, Modal, Select, Space, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { apiPost, useApiQuery, useDebouncedValue } from '../api/hooks';

export interface FixedProduct {
  id: string;
  productCode: string;
  nameZh: string;
}

interface SkuCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided the product is fixed (quick-create from a product detail). */
  fixedProduct?: FixedProduct;
  onCreated?: () => void;
}

/**
 * Shared SKU creation form (SKU管理 page + quick-create from product detail).
 * Units (2026-09-09): weight g, dimensions integer mm; purchase price CNY.
 */
export function SkuCreateModal({ open, onClose, fixedProduct, onCreated }: SkuCreateModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [productKeyword, setProductKeyword] = useState('');
  const debouncedKeyword = useDebouncedValue(productKeyword);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setProductKeyword('');
    }
  }, [open, form]);

  // Server-side keyword search: the SKU picker must reach beyond the first
  // page of a large catalog (dev DB has tens of thousands of products).
  const products = useApiQuery<{
    data: Array<{ id: string; productCode: string; nameZh: string }>;
  }>(
    '/api/v1/products',
    fixedProduct === undefined
      ? { page: 1, pageSize: 50, keyword: debouncedKeyword || undefined }
      : { page: 1, pageSize: 1 },
    ['products-for-sku-create', fixedProduct === undefined ? debouncedKeyword : fixedProduct.id],
    undefined,
    open && fixedProduct === undefined,
  );

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      apiPost('/api/v1/skus', {
        ...values,
        productId: fixedProduct?.id ?? values.productId,
      }),
    onSuccess: () => {
      void message.success('SKU已创建');
      onClose();
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['skus'] });
      void queryClient.invalidateQueries({ queryKey: ['product-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onCreated?.();
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  return (
    <Modal
      title="新建SKU"
      open={open}
      onCancel={onClose}
      onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
      confirmLoading={createMutation.isPending}
    >
      <Form form={form} layout="vertical">
        {fixedProduct === undefined ? (
          <Form.Item
            name="productId"
            label="所属商品"
            rules={[{ required: true, message: '请选择商品' }]}
          >
            <Select
              showSearch
              filterOption={false}
              onSearch={setProductKeyword}
              notFoundContent={products.isLoading ? '搜索中...' : '无匹配商品'}
              options={(products.data?.data ?? []).map((product) => ({
                value: product.id,
                label: `${product.productCode} ${product.nameZh}`,
              }))}
            />
          </Form.Item>
        ) : (
          <Form.Item label="所属商品">
            <Input value={`${fixedProduct.productCode} ${fixedProduct.nameZh}`} disabled />
          </Form.Item>
        )}
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
          <Form.Item name="weightG" label="重量(g)">
            <InputNumber min={0} step={1} style={{ width: 130 }} />
          </Form.Item>
          <Form.Item name="lengthMm" label="长(mm)">
            <InputNumber min={0} step={1} precision={0} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="widthMm" label="宽(mm)">
            <InputNumber min={0} step={1} precision={0} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="heightMm" label="高(mm)">
            <InputNumber min={0} step={1} precision={0} style={{ width: 110 }} />
          </Form.Item>
        </Space>
        <Space wrap>
          <Form.Item name="latestPurchasePrice" label="最新采购价（CNY）">
            <InputNumber min={0} prefix="¥" style={{ width: 160 }} />
          </Form.Item>
        </Space>
        <Form.Item name="purchaseUrl" label="采购链接">
          <Input placeholder="1688 / 淘宝等采购页面链接" maxLength={1000} />
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
  );
}
