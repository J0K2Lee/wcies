import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Cascader,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { apiPost, useApiQuery } from '../api/hooks';
import { CATEGORY_CASCADER_PROPS } from './CategoryCascader';
import { CategoryPickerOption } from './CategoryCascader';
import { BrandQuickCreateModal, CategoryQuickCreateModal } from './QuickCreateModals';
import { brandSearchText } from '../utils/brandSearch';

/**
 * Shared SKU creation form (SKU管理 page).
 *
 * V1 改造（2026-10-13，决策 D5）：商品层移除——SKU 直建，不再选择所属商品；
 * 品牌/分类成为 SKU 自身字段（均可选，分类必须三级），支持现场快建。
 *
 * Units (2026-09-09): weight g, dimensions integer mm; purchase price CNY.
 */
interface SkuCreateModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

interface CategoryNode {
  id: string;
  nameZh: string;
  /** 俄文名（只参与搜索匹配，不显示）。 */
  nameRu: string | null;
  status: string;
  level: number;
  children?: CategoryNode[];
}

type CategoryOption = CategoryPickerOption;

/** Cascader options: only level-3 leaves are pickable (decision 0005). */
function toCategoryOption(node: CategoryNode): CategoryOption {
  const children = (node.children ?? [])
    .filter((child) => child.status === 'ACTIVE')
    .map((child) => toCategoryOption(child));
  return {
    value: node.id,
    // label 只放中文（俄文会撑爆下拉宽度）；俄文由共享搜索 filter 匹配。
    label: node.nameZh,
    nameZh: node.nameZh,
    nameRu: node.nameRu,
    // Childless level-1/2 nodes would be selectable leaves — block them.
    disabled: node.level < 3 && (node.children ?? []).length === 0,
    ...(children.length > 0 ? { children } : {}),
  };
}

export function SkuCreateModal({ open, onClose, onCreated }: SkuCreateModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
    }
  }, [open, form]);

  const brands = useApiQuery<{
    data: Array<{
      id: string;
      code: string;
      name: string;
      nameZh: string | null;
      nameEn: string | null;
      nameRu: string | null;
      status: string;
    }>;
  }>('/api/v1/brands', { keyword: '' }, ['brands']);
  // Sprint 8.5R1: tree-lite (column-pruned) - the cascader only reads these
  // fields, and the full 8k-node tree cost megabytes per page load.
  const categories = useApiQuery<{ data: CategoryNode[] }>('/api/v1/categories/tree-lite', {}, [
    'categories',
  ]);
  const categoryOptions = useMemo(
    () => (categories.data?.data ?? []).map((node) => toCategoryOption(node)),
    [categories.data],
  );

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => {
      const categoryPath = values.categoryPath as string[] | undefined;
      return apiPost('/api/v1/skus', {
        ...values,
        categoryPath: undefined,
        categoryId:
          categoryPath !== undefined && categoryPath.length === 3 ? categoryPath[2] : undefined,
      });
    },
    onSuccess: () => {
      void message.success('SKU 已创建');
      onClose();
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['skus'] });
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
        <Form.Item
          name="nameZh"
          label="中文名称"
          rules={[{ required: true, message: '请输入名称' }]}
        >
          <Input />
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
                + 新建品牌
              </Button>
            </Space>
          }
        >
          <Select
            allowClear
            showSearch
            optionFilterProp="searchText"
            placeholder="选择品牌（可按一般/中文/英文/俄文名或编码搜索）"
            options={(brands.data?.data ?? []).map((brand) => ({
              value: brand.id,
              // 停用品牌保留可选但带后缀（与分类筛选一致）。
              label: brand.status === 'ACTIVE' ? brand.name : `${brand.name}（停用）`,
              searchText: brandSearchText(brand),
            }))}
          />
        </Form.Item>
        <Form.Item
          name="categoryPath"
          label={
            <Space size={4}>
              分类（三级）
              <Button
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto' }}
                onClick={() => setCategoryCreateOpen(true)}
              >
                + 新建分类
              </Button>
            </Space>
          }
          rules={[
            {
              validator: (_rule, value: string[] | undefined) =>
                value === undefined || value.length === 0
                  ? Promise.resolve()
                  : value.length === 3
                    ? Promise.resolve()
                    : Promise.reject(new Error('必须选择到三级分类')),
            },
          ]}
        >
          <Cascader<CategoryPickerOption>
            {...CATEGORY_CASCADER_PROPS}
            placeholder="选择三级分类（支持中文/俄文搜索）"
            options={categoryOptions}
          />
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
            <InputNumber min={0} step={0.01} style={{ width: 160 }} />
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

      {/* 共享快建弹窗（G9）：从建档弹窗内打开，永远叠在其上（zIndex 1200）。 */}
      <BrandQuickCreateModal
        open={brandModalOpen}
        zIndex={1200}
        onClose={() => setBrandModalOpen(false)}
        onCreated={(brandId) => {
          form.setFieldValue('brandId', brandId);
        }}
      />
      <CategoryQuickCreateModal
        open={categoryCreateOpen}
        zIndex={1200}
        onClose={() => setCategoryCreateOpen(false)}
        onCreated={(path) => {
          form.setFieldValue('categoryPath', path);
        }}
      />
    </Modal>
  );
}
