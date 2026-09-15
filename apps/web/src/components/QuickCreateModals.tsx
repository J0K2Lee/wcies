import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Form, Input, Modal, Select } from 'antd';
import { useState } from 'react';
import { apiPost, useApiQuery } from '../api/hooks';
import { colors } from '../design-system';

/**
 * Shared quick-create dialogs for brand & category (Phase 3 G9): one
 * implementation for the Products page forms and the Listings onboarding
 * dialog. Both follow the same contract — a created brand is reported via
 * onCreated(brandId); a created level-3 category reports its full path so the
 * host form can fill a cascader value.
 */

interface CategoryNode {
  id: string;
  nameZh: string;
  nameRu: string | null;
  level: number;
  sortOrder: number;
  status: string;
  children: CategoryNode[];
}

const categoryOptionLabel = (node: CategoryNode): string =>
  node.status === 'ACTIVE' ? node.nameZh : `${node.nameZh}（停用）`;

const bySortOrder = (a: CategoryNode, b: CategoryNode): number =>
  a.sortOrder - b.sortOrder || a.nameZh.localeCompare(b.nameZh);

// ---- Brand ----

export interface BrandQuickCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Receives the created brand id (host fills its own form field). */
  onCreated: (brandId: string) => void;
  /** UI spec §8.3: 1100 from a page modal, 1200 from a modal-in-modal. */
  zIndex?: number;
}

export function BrandQuickCreateModal({
  open,
  onClose,
  onCreated,
  zIndex,
}: BrandQuickCreateModalProps) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [brandForm] = Form.useForm();

  const createBrandMutation = useMutation({
    mutationFn: (values: { name: string; nameZh?: string; nameEn?: string; nameRu?: string }) =>
      apiPost<{ id: string }>('/api/v1/brands', values),
    onSuccess: (brand) => {
      void message.success('品牌已创建');
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      onCreated(brand.id);
      onClose();
    },
    onError: (error: Error) => void message.error(`创建品牌失败: ${error.message}`),
  });

  return (
    <Modal
      title="新建品牌"
      open={open}
      zIndex={zIndex}
      afterOpenChange={(isOpen) => {
        if (!isOpen) {
          brandForm.resetFields();
        }
      }}
      onCancel={onClose}
      onOk={() =>
        void brandForm.validateFields().then((values) => {
          createBrandMutation.mutate({
            name: (values.name as string).trim(),
            nameZh: (values.nameZh as string | undefined)?.trim() || undefined,
            nameEn: (values.nameEn as string | undefined)?.trim() || undefined,
            nameRu: (values.nameRu as string | undefined)?.trim() || undefined,
          });
        })
      }
      okText="创建"
      cancelText="取消"
      confirmLoading={createBrandMutation.isPending}
      destroyOnHidden
    >
      <p style={{ marginTop: 0, fontSize: 12.5, color: colors.textTertiary }}>
        品牌编码无需填写，创建后自动生成。
      </p>
      <Form form={brandForm} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="一般名称"
          rules={[{ required: true, message: '请输入一般名称' }]}
        >
          <Input maxLength={200} placeholder="主显示名，如 Valkyrie" />
        </Form.Item>
        <Form.Item name="nameZh" label="中文名称（选填）">
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
  );
}

// ---- Category (level-3 with inline parent creation) ----

export interface CategoryQuickCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** Receives the full [level1, level2, level3] id path of the created leaf. */
  onCreated: (categoryPath: string[]) => void;
  zIndex?: number;
}

export function CategoryQuickCreateModal({
  open,
  onClose,
  onCreated,
  zIndex,
}: CategoryQuickCreateModalProps) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [categoryForm] = Form.useForm<{
    parent1Id?: string;
    parent2Id?: string;
    nameZh?: string;
    nameRu?: string;
  }>();
  const [inlineMode, setInlineMode] = useState<'level1' | 'level2' | null>(null);
  const [inlineNameZh, setInlineNameZh] = useState('');
  const [inlineNameRu, setInlineNameRu] = useState('');

  const categories = useApiQuery<{ data: CategoryNode[] }>('/api/v1/categories/tree-lite', {}, [
    'categories',
  ]);
  const categoryTree = categories.data?.data ?? [];

  const createCategoryMutation = useMutation({
    mutationFn: (input: {
      kind: 'level1' | 'level2' | 'leaf';
      parentId?: string;
      path?: string[];
      nameZh: string;
      nameRu?: string;
    }) =>
      apiPost<{ id: string }>('/api/v1/categories', {
        parentId: input.parentId,
        nameZh: input.nameZh,
        nameRu: input.nameRu,
      }),
    onSuccess: (created, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
      if (variables.kind === 'level1') {
        void message.success('一级分类已创建');
        categoryForm.setFieldValue('parent1Id', created.id);
        categoryForm.setFieldValue('parent2Id', undefined);
        setInlineMode(null);
        setInlineNameZh('');
        setInlineNameRu('');
      } else if (variables.kind === 'level2') {
        void message.success('二级分类已创建');
        categoryForm.setFieldValue('parent2Id', created.id);
        setInlineMode(null);
        setInlineNameZh('');
        setInlineNameRu('');
      } else {
        void message.success('分类已创建');
        onCreated([...(variables.path ?? []), created.id]);
        onClose();
      }
    },
    onError: (error: Error) => void message.error(`创建分类失败: ${error.message}`),
  });

  const categoryParent1Id = Form.useWatch('parent1Id', categoryForm);
  const parent1 =
    categoryParent1Id !== undefined
      ? (categoryTree.find((node) => node.id === categoryParent1Id) ?? null)
      : null;
  const level2Options = parent1 === null ? [] : [...parent1.children].sort(bySortOrder);

  const submitInlineCategory = (kind: 'level1' | 'level2') => {
    const nameZh = inlineNameZh.trim();
    if (nameZh === '') {
      void message.warning('请输入中文名称');
      return;
    }
    if (kind === 'level2') {
      const parent1Id = categoryForm.getFieldValue('parent1Id') as string | undefined;
      if (parent1Id === undefined || parent1Id === '') {
        void message.warning('请先选择一级分类');
        return;
      }
      createCategoryMutation.mutate({
        kind: 'level2',
        parentId: parent1Id,
        nameZh,
        nameRu: inlineNameRu.trim() || undefined,
      });
      return;
    }
    createCategoryMutation.mutate({
      kind: 'level1',
      nameZh,
      nameRu: inlineNameRu.trim() || undefined,
    });
  };

  const resetInline = () => {
    setInlineMode(null);
    setInlineNameZh('');
    setInlineNameRu('');
  };

  const inlineBlock = (kind: 'level1' | 'level2', title: string) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        marginBottom: 16,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 550 }}>{title}</span>
      <Input
        placeholder="中文名称（必填）"
        maxLength={200}
        value={inlineNameZh}
        onChange={(event) => setInlineNameZh(event.target.value)}
      />
      <Input
        placeholder="俄文名称（选填）"
        maxLength={200}
        value={inlineNameRu}
        onChange={(event) => setInlineNameRu(event.target.value)}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="small"
          type="primary"
          loading={createCategoryMutation.isPending}
          onClick={() => submitInlineCategory(kind)}
        >
          创建并选中
        </Button>
        <Button size="small" onClick={resetInline}>
          取消
        </Button>
      </div>
    </div>
  );

  const inlineTrigger = (kind: 'level1' | 'level2', label: string, disabled = false) => (
    <Button
      size="small"
      type="link"
      style={{ padding: 0, marginTop: -12, marginBottom: 16 }}
      disabled={disabled}
      onClick={() => {
        setInlineNameZh('');
        setInlineNameRu('');
        setInlineMode(kind);
      }}
    >
      ＋ {label}
    </Button>
  );

  return (
    <Modal
      title="新建分类"
      open={open}
      zIndex={zIndex}
      afterOpenChange={(isOpen) => {
        if (!isOpen) {
          categoryForm.resetFields();
          resetInline();
        }
      }}
      onCancel={onClose}
      onOk={() =>
        void categoryForm.validateFields().then((values) => {
          const parent1Id = values.parent1Id;
          const parent2Id = values.parent2Id;
          if (parent1Id === undefined || parent2Id === undefined) {
            return;
          }
          createCategoryMutation.mutate({
            kind: 'leaf',
            parentId: parent2Id,
            path: [parent1Id, parent2Id],
            nameZh: (values.nameZh as string).trim(),
            nameRu: values.nameRu?.trim() || undefined,
          });
        })
      }
      okText="创建"
      cancelText="取消"
      confirmLoading={createCategoryMutation.isPending}
      destroyOnHidden
    >
      <p style={{ marginTop: 0, fontSize: 12.5, color: colors.textTertiary }}>
        分类编码无需填写，创建后自动生成。商品只能挂载三级分类。
      </p>
      <Form form={categoryForm} layout="vertical" preserve={false}>
        <Form.Item
          name="parent1Id"
          label="一级分类"
          rules={[{ required: true, message: '请选择一级分类' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="搜索或选择一级分类"
            onChange={() => categoryForm.setFieldValue('parent2Id', undefined)}
            options={[...categoryTree]
              .sort(bySortOrder)
              .map((node) => ({ value: node.id, label: categoryOptionLabel(node) }))}
          />
        </Form.Item>
        {inlineMode === 'level1'
          ? inlineBlock('level1', '新建一级分类')
          : inlineTrigger('level1', '新建一级分类')}

        <Form.Item
          name="parent2Id"
          label="二级分类"
          dependencies={['parent1Id']}
          rules={[{ required: true, message: '请选择二级分类' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="先选择一级分类"
            disabled={categoryParent1Id === undefined || categoryParent1Id === ''}
            options={level2Options.map((node) => ({
              value: node.id,
              label: categoryOptionLabel(node),
            }))}
          />
        </Form.Item>
        {inlineMode === 'level2'
          ? inlineBlock('level2', '新建二级分类')
          : inlineTrigger(
              'level2',
              '新建二级分类',
              categoryParent1Id === undefined || categoryParent1Id === '',
            )}

        <Form.Item
          name="nameZh"
          label="三级分类名称"
          rules={[{ required: true, message: '请输入三级分类名称' }]}
        >
          <Input maxLength={200} placeholder="如 键盘" />
        </Form.Item>
        <Form.Item name="nameRu" label="俄文名称（选填）">
          <Input maxLength={200} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
