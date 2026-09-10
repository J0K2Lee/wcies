import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Cascader,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tree,
  TreeSelect,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { SkuCreateModal } from '../../components/SkuCreateModal';
import {
  ActionMenu,
  ACTIVE_STATUS_LABEL,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  EntitySummary,
  ErrorState,
  FilterBar,
  InfoGrid,
  PageHeader,
  SectionCard,
  SKU_STATUS_META,
  StatusBadge,
  colors,
  labelOf,
  useContextRail,
} from '../../design-system';

/**
 * 商品管理 (Product/SPU master data): design-system layout — header + filter
 * bar + dense table + context rail + detail drawer (mirrors SkusPage).
 *
 * Catalog contracts (2026-09 backend):
 * - Category tree is 3 levels deep; products may only reference level-3 nodes.
 *   Category/brand/product codes are server-generated and never edited here.
 * - `GET /api/v1/products?categoryId=` includes the whole subtree, so the
 *   filter cascader may select any level.
 */

interface CategoryNode {
  id: string;
  parentId: string | null;
  code: string;
  nameZh: string;
  nameRu: string | null;
  level: number;
  sortOrder: number;
  status: string;
  children: CategoryNode[];
}

interface CategoryOption {
  value: string;
  label: string;
  disabled?: boolean;
  children?: CategoryOption[];
}

interface ManageTreeNode {
  key: string;
  title: string;
  children?: ManageTreeNode[];
}

interface ParentTreeNode {
  value: string;
  title: string;
  children?: ParentTreeNode[];
}

interface BrandItem {
  id: string;
  name: string;
  nameZh: string | null;
  nameEn: string | null;
  nameRu: string | null;
  status: string;
}

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
  remark: string | null;
  skuCount: number;
  createdAt: string;
}

interface ProductSkuItem {
  id: string;
  skuCode: string;
  nameZh: string;
  model: string | null;
  color: string | null;
  size: string | null;
  serialTracking: boolean;
  status: string;
}

interface ProductDetail {
  product: ProductRow;
  skus: ProductSkuItem[];
}

interface ProductCreateInput {
  nameZh: string;
  nameRu?: string;
  brandId?: string;
  categoryId?: string;
  remark?: string;
}

interface ProductUpdateInput {
  nameZh: string;
  nameRu?: string;
  brandId?: string | null;
  categoryId?: string | null;
  remark?: string;
}

interface CategoryUpdateInput {
  nameZh?: string;
  nameRu?: string;
  sortOrder?: number;
  parentId?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

const CATEGORY_LEVEL_LABEL: Record<number, string> = { 1: '一级', 2: '二级', 3: '三级' };

/** Products share the DRAFT/ACTIVE/INACTIVE lifecycle with SKUs. */
const renderProductStatus = (status: string) => (
  <StatusBadge
    tone={SKU_STATUS_META[status]?.tone ?? 'neutral'}
    label={SKU_STATUS_META[status]?.label ?? status}
    hint={status}
  />
);

const categoryOptionLabel = (node: CategoryNode): string =>
  node.status === 'ACTIVE' ? node.nameZh : `${node.nameZh}（停用）`;

const bySortOrder = (a: CategoryNode, b: CategoryNode): number =>
  a.sortOrder - b.sortOrder || a.nameZh.localeCompare(b.nameZh);

/** Options for the product form cascader: only level-3 leaves are pickable. */
const buildProductCategoryOptions = (nodes: CategoryNode[]): CategoryOption[] =>
  [...nodes].sort(bySortOrder).map((node) => {
    const children = buildProductCategoryOptions(node.children);
    return {
      value: node.id,
      label: categoryOptionLabel(node),
      // Childless level-1/2 nodes would be selectable leaves — block them.
      disabled: node.level < 3 && node.children.length === 0,
      ...(children.length > 0 ? { children } : {}),
    };
  });

/** Filter cascader: every level selectable (backend expands to the subtree). */
const buildFilterCategoryOptions = (nodes: CategoryNode[]): CategoryOption[] =>
  [...nodes].sort(bySortOrder).map((node) => {
    const children = buildFilterCategoryOptions(node.children);
    return {
      value: node.id,
      label: categoryOptionLabel(node),
      ...(children.length > 0 ? { children } : {}),
    };
  });

const buildManageTreeData = (nodes: CategoryNode[]): ManageTreeNode[] =>
  [...nodes].sort(bySortOrder).map((node) => {
    const children = buildManageTreeData(node.children);
    return {
      key: node.id,
      title: categoryOptionLabel(node),
      ...(children.length > 0 ? { children } : {}),
    };
  });

const collectSubtreeIds = (node: CategoryNode): string[] => [
  node.id,
  ...node.children.flatMap((child) => collectSubtreeIds(child)),
];

/** Parent candidates for "改父": level 1/2 nodes outside the moved subtree. */
const buildParentTreeData = (nodes: CategoryNode[], blocked: Set<string>): ParentTreeNode[] =>
  [...nodes]
    .sort(bySortOrder)
    .filter((node) => !blocked.has(node.id) && node.level <= 2)
    .map((node) => {
      if (node.level === 2) {
        return { value: node.id, title: categoryOptionLabel(node) };
      }
      const children = buildParentTreeData(node.children, blocked);
      return {
        value: node.id,
        title: categoryOptionLabel(node),
        ...(children.length > 0 ? { children } : {}),
      };
    });

export function ProductsPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  // ---- List filters ----
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [brandFilter, setBrandFilter] = useState<string | undefined>();
  const [categoryFilterPath, setCategoryFilterPath] = useState<string[] | undefined>();
  const categoryFilterId = useMemo(
    () =>
      categoryFilterPath !== undefined && categoryFilterPath.length > 0
        ? categoryFilterPath[categoryFilterPath.length - 1]
        : undefined,
    [categoryFilterPath],
  );

  // ---- Row selection: rail preview + detail drawer ----
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);

  // ---- Create / edit product modals ----
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [productForm] = Form.useForm();
  const [productEditForm] = Form.useForm();

  // ---- Brand quick-create modal ----
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [brandTarget, setBrandTarget] = useState<'create' | 'edit'>('create');
  const [brandForm] = Form.useForm();

  // ---- Category quick-create modal (level-3 with inline parents) ----
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [categoryTarget, setCategoryTarget] = useState<'create' | 'edit'>('create');
  const [categoryForm] = Form.useForm();
  const [inlineMode, setInlineMode] = useState<'level1' | 'level2' | null>(null);
  const [inlineNameZh, setInlineNameZh] = useState('');
  const [inlineNameRu, setInlineNameRu] = useState('');

  // ---- Category management modal ----
  const [manageOpen, setManageOpen] = useState(false);
  const [manageSelectedId, setManageSelectedId] = useState<string | null>(null);
  const [categoryInfoForm] = Form.useForm();
  const [categoryStructureForm] = Form.useForm();

  // ---- SKU quick-create (from product drawer) ----
  const [skuModalOpen, setSkuModalOpen] = useState(false);

  // ===================== Queries =====================

  const list = useApiQuery<{ data: ProductRow[]; meta: { total: number } }>(
    '/api/v1/products',
    {
      page,
      pageSize: 50,
      keyword: keyword || undefined,
      status,
      brandId: brandFilter,
      categoryId: categoryFilterId,
    },
    ['products', 'list', page, keyword, status, brandFilter, categoryFilterId],
  );

  const categories = useApiQuery<{ data: CategoryNode[] }>('/api/v1/categories', {}, [
    'categories',
  ]);
  const brands = useApiQuery<{ data: BrandItem[] }>('/api/v1/brands', { keyword: '' }, ['brands']);

  const drawerDetail = useApiQuery<{ data: ProductDetail }>(
    '/api/v1/products/{id}',
    {},
    ['products', 'detail', drawerId],
    { id: drawerId ?? '' },
    drawerId !== null,
  );
  const product = drawerDetail.data?.data.product;

  const editDetail = useApiQuery<{ data: ProductDetail }>(
    '/api/v1/products/{id}',
    {},
    ['products', 'detail', editId],
    { id: editId ?? '' },
    editId !== null,
  );
  const editSource = editDetail.data?.data.product;

  // ===================== Category indexes =====================

  const categoryTree = categories.data?.data ?? [];

  const { categoryById, categoryPathById } = useMemo(() => {
    const byId = new Map<string, CategoryNode>();
    const pathById = new Map<string, string[]>();
    const walk = (nodes: CategoryNode[], trail: string[]): void => {
      for (const node of [...nodes].sort(bySortOrder)) {
        const path = [...trail, node.id];
        byId.set(node.id, node);
        pathById.set(node.id, path);
        walk(node.children, path);
      }
    };
    walk(categoryTree, []);
    return { categoryById: byId, categoryPathById: pathById };
  }, [categoryTree]);

  const productCategoryOptions = useMemo(
    () => buildProductCategoryOptions(categoryTree),
    [categoryTree],
  );
  const filterCategoryOptions = useMemo(
    () => buildFilterCategoryOptions(categoryTree),
    [categoryTree],
  );
  const manageTreeData = useMemo(() => buildManageTreeData(categoryTree), [categoryTree]);

  const manageSelected =
    manageSelectedId !== null ? (categoryById.get(manageSelectedId) ?? null) : null;

  const manageParentTreeData = useMemo(() => {
    const node = manageSelected;
    if (node === null) {
      return [];
    }
    return buildParentTreeData(categoryTree, new Set(collectSubtreeIds(node)));
  }, [manageSelected, categoryTree]);

  const manageSelectedPath = useMemo(() => {
    if (manageSelectedId === null) {
      return [];
    }
    return (categoryPathById.get(manageSelectedId) ?? []).map(
      (id) => categoryById.get(id)?.nameZh ?? id,
    );
  }, [manageSelectedId, categoryPathById, categoryById]);

  const categoryParent1Id = Form.useWatch('parent1Id', categoryForm);
  const level2Options = useMemo(() => {
    const parent1 =
      categoryParent1Id !== undefined ? (categoryById.get(categoryParent1Id) ?? null) : null;
    return parent1 === null ? [] : [...parent1.children].sort(bySortOrder);
  }, [categoryParent1Id, categoryById]);

  // ===================== Mutations =====================

  const refreshProducts = () => {
    void queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const createProductMutation = useMutation({
    mutationFn: (values: ProductCreateInput) => apiPost('/api/v1/products', values),
    onSuccess: () => {
      void message.success('商品已创建');
      setCreateOpen(false);
      refreshProducts();
    },
    onError: (error: Error) => void message.error(`创建失败: ${error.message}`),
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: ProductUpdateInput }) =>
      apiPatch('/api/v1/products/{id}', values, { id }),
    onSuccess: () => {
      void message.success('商品已更新');
      setEditOpen(false);
      setEditId(null);
      refreshProducts();
    },
    onError: (error: Error) => void message.error(`更新失败: ${error.message}`),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/products/{id}/${action}`, {}, { id }),
    onSuccess: (_data, variables) => {
      void message.success(variables.action === 'activate' ? '商品已启用' : '商品已停用');
      refreshProducts();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/products/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('商品已删除');
      if (drawerId === id) {
        setDrawerId(null);
      }
      if (editId === id) {
        setEditOpen(false);
        setEditId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      refreshProducts();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const createBrandMutation = useMutation({
    mutationFn: (values: { name: string; nameZh?: string; nameEn?: string; nameRu?: string }) =>
      apiPost<{ id: string }>('/api/v1/brands', values),
    onSuccess: (brand) => {
      void message.success('品牌已创建');
      setBrandModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
      if (brandTarget === 'edit') {
        productEditForm.setFieldValue('brandId', brand.id);
      } else {
        productForm.setFieldValue('brandId', brand.id);
      }
    },
    onError: (error: Error) => void message.error(`创建品牌失败: ${error.message}`),
  });

  const createCategoryMutation = useMutation({
    mutationFn: ({
      parentId,
      nameZh,
      nameRu,
    }: {
      kind: 'level1' | 'level2' | 'leaf';
      parentId?: string;
      path?: string[];
      nameZh: string;
      nameRu?: string;
    }) => apiPost<{ id: string }>('/api/v1/categories', { parentId, nameZh, nameRu }),
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
        const path = [...(variables.path ?? []), created.id];
        if (categoryTarget === 'edit') {
          productEditForm.setFieldValue('categoryPath', path);
        } else {
          productForm.setFieldValue('categoryPath', path);
        }
        setCategoryModalOpen(false);
      }
    },
    onError: (error: Error) => void message.error(`创建分类失败: ${error.message}`),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: CategoryUpdateInput }) =>
      apiPatch('/api/v1/categories/{id}', values, { id }),
    onSuccess: () => {
      void message.success('分类已更新');
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/categories/{id}', { id }),
    onSuccess: () => {
      void message.success('分类已删除');
      setManageSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ===================== Effects =====================

  // Prefill the edit form once its detail query resolves (code stays read-only).
  useEffect(() => {
    if (!editOpen || editSource === undefined) {
      return;
    }
    productEditForm.setFieldsValue({
      nameZh: editSource.nameZh,
      nameRu: editSource.nameRu ?? undefined,
      brandId: editSource.brandId ?? undefined,
      categoryPath:
        editSource.categoryId !== null
          ? (categoryPathById.get(editSource.categoryId) ?? undefined)
          : undefined,
      remark: editSource.remark ?? undefined,
    });
  }, [editOpen, editSource, productEditForm, categoryPathById]);

  // Keep the manage-modal forms in sync with the selected node / tree refreshes.
  useEffect(() => {
    if (!manageOpen) {
      return;
    }
    if (manageSelected === null) {
      categoryInfoForm.resetFields();
      categoryStructureForm.resetFields();
      return;
    }
    categoryInfoForm.setFieldsValue({
      nameZh: manageSelected.nameZh,
      nameRu: manageSelected.nameRu ?? undefined,
    });
    categoryStructureForm.setFieldsValue({
      sortOrder: manageSelected.sortOrder,
      parentId: manageSelected.parentId ?? undefined,
    });
  }, [manageOpen, manageSelected, categoryInfoForm, categoryStructureForm]);

  // ===================== Action handlers =====================

  const openEdit = (id: string) => {
    setEditId(id);
    setEditOpen(true);
  };

  const confirmDeleteProduct = (id: string, name: string) => {
    modal.confirm({
      title: '确认删除该商品？',
      content: `将删除「${name}」。存在 SKU 时后端将拒绝删除。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => deleteProductMutation.mutateAsync(id).catch(() => undefined),
    });
  };

  const openBrandModal = (target: 'create' | 'edit') => {
    setBrandTarget(target);
    setBrandModalOpen(true);
  };

  const openCategoryModal = (target: 'create' | 'edit') => {
    setCategoryTarget(target);
    setCategoryModalOpen(true);
  };

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

  const submitCategoryInfo = () => {
    if (manageSelectedId === null) {
      return;
    }
    void categoryInfoForm.validateFields().then((values) => {
      updateCategoryMutation.mutate({
        id: manageSelectedId,
        values: {
          nameZh: values.nameZh as string,
          nameRu: (values.nameRu as string | undefined)?.trim() || undefined,
        },
      });
    });
  };

  const submitCategoryStructure = () => {
    if (manageSelectedId === null) {
      return;
    }
    const node = categoryById.get(manageSelectedId);
    if (node === undefined) {
      return;
    }
    void categoryStructureForm.validateFields().then((values) => {
      updateCategoryMutation.mutate({
        id: manageSelectedId,
        values: {
          sortOrder: (values.sortOrder as number | undefined) ?? node.sortOrder,
          // Level-1 nodes have no parent; clearing the picker moves to root.
          ...(node.level > 1 ? { parentId: (values.parentId as string | undefined) ?? null } : {}),
        },
      });
    });
  };

  const toggleCategoryStatus = () => {
    if (manageSelected === null) {
      return;
    }
    updateCategoryMutation.mutate({
      id: manageSelected.id,
      values: { status: manageSelected.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
    });
  };

  const confirmDisableCategory = () => {
    if (manageSelected === null) {
      return;
    }
    modal.confirm({
      title: '确认停用该分类？',
      content: `「${manageSelected.nameZh}」停用后不再出现在新建选项中。`,
      okText: '停用',
      okButtonProps: { danger: true },
      onOk: () =>
        updateCategoryMutation
          .mutateAsync({ id: manageSelected.id, values: { status: 'INACTIVE' } })
          .catch(() => undefined),
    });
  };

  const confirmDeleteCategory = () => {
    if (manageSelected === null) {
      return;
    }
    modal.confirm({
      title: '确认删除该分类？',
      content: `将删除「${manageSelected.nameZh}」。存在子分类或商品时后端将拒绝删除。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: () => deleteCategoryMutation.mutateAsync(manageSelected.id).catch(() => undefined),
    });
  };

  // ===================== Context rail =====================

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="商品概览">
            <ContextMetric label="当前筛选结果" value={`${list.data?.meta.total ?? 0} 个商品`} />
            <ContextMetric label="本页" value={`${rows.length} 条`} />
            <span
              style={{
                fontSize: 12.5,
                color: colors.textTertiary,
                display: 'block',
                paddingTop: 8,
              }}
            >
              点击表格任意行，在此快速预览商品基本信息。
            </span>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.productCode}
          subtitle={selectedRow.nameZh}
          badge={
            <StatusBadge
              tone={SKU_STATUS_META[selectedRow.status]?.tone ?? 'neutral'}
              label={SKU_STATUS_META[selectedRow.status]?.label ?? selectedRow.status}
              hint={selectedRow.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="品牌" value={selectedRow.brandName ?? '—'} />
            <ContextMetric label="分类" value={selectedRow.categoryName ?? '—'} />
            <ContextMetric label="俄文名称" value={selectedRow.nameRu ?? '—'} />
            <ContextMetric label="SKU 数量" value={`${selectedRow.skuCount}`} strong />
            <ContextMetric label="创建时间" value={selectedRow.createdAt.slice(0, 10)} />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDrawerId(selectedRow.id)}>
              打开完整详情
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, rows.length]);
  useContextRail(railContent);

  const hasActiveFilters =
    keyword !== '' ||
    status !== undefined ||
    brandFilter !== undefined ||
    (categoryFilterPath !== undefined && categoryFilterPath.length > 0);

  const brandOptions = (brands.data?.data ?? []).map((brand) => ({
    value: brand.id,
    label: brand.name,
  }));

  // ===================== Render =====================

  return (
    <div>
      <PageHeader
        title="商品管理"
        description="商品（SPU）主数据：名称、品牌与三级分类；商品编码创建后自动生成"
        secondary={<Button onClick={() => setManageOpen(true)}>分类管理</Button>}
        primary={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建商品
          </Button>
        }
      />

      <FilterBar
        actions={
          <>
            {hasActiveFilters && (
              <Button
                onClick={() => {
                  setKeyword('');
                  setStatus(undefined);
                  setBrandFilter(undefined);
                  setCategoryFilterPath(undefined);
                  setPage(1);
                }}
              >
                清除筛选
              </Button>
            )}
          </>
        }
      >
        <Input.Search
          placeholder="搜索商品编号 / 名称"
          allowClear
          defaultValue={keyword}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索商品"
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 110 }}
          value={status}
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
        <Select
          allowClear
          placeholder="品牌"
          style={{ width: 140 }}
          showSearch
          optionFilterProp="label"
          value={brandFilter}
          onChange={(value) => {
            setPage(1);
            setBrandFilter(value);
          }}
          options={brandOptions}
        />
        <Cascader<CategoryOption>
          allowClear
          showSearch
          changeOnSelect
          placeholder="分类（任意层级，含子树）"
          style={{ width: 240 }}
          value={categoryFilterPath}
          onChange={(value) => {
            setPage(1);
            setCategoryFilterPath(value.length > 0 ? value : undefined);
          }}
          options={filterCategoryOptions}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description="商品列表加载失败，请稍后重试"
            onRetry={() => void list.refetch()}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<ProductRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 个商品`,
            }}
            rowClassName={(record) => (record.id === selectedId ? 'wcies-row-selected' : '')}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            scroll={{ x: 920 }}
            emptyTitle="没有匹配的商品"
            emptyDescription="调整筛选条件或新建商品。"
            columns={[
              {
                title: '商品',
                key: 'product',
                width: 320,
                render: (_: unknown, record: ProductRow) => (
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 550,
                        color: colors.textPrimary,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {record.nameZh}
                    </div>
                    <div style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>
                      {record.productCode}
                      {record.brandName !== null && ` · ${record.brandName}`}
                    </div>
                  </div>
                ),
              },
              {
                title: '分类',
                dataIndex: 'categoryName',
                width: 170,
                ellipsis: true,
                render: (value: string | null) => value ?? '—',
              },
              {
                title: 'SKU 数',
                dataIndex: 'skuCount',
                width: 90,
                align: 'right',
                render: (value: number) => value,
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value: string) => renderProductStatus(value),
              },
              {
                title: '创建时间',
                dataIndex: 'createdAt',
                width: 110,
                render: (value: string) => value.slice(0, 10),
              },
              {
                title: '操作',
                key: 'actions',
                width: 110,
                fixed: 'right',
                render: (_: unknown, record: ProductRow) => (
                  <ActionMenu
                    primary={
                      <Button
                        type="link"
                        size="small"
                        style={{ paddingInline: 4 }}
                        onClick={() => setDrawerId(record.id)}
                      >
                        查看
                      </Button>
                    }
                    items={[
                      {
                        key: 'edit',
                        label: '编辑',
                        onClick: () => openEdit(record.id),
                      },
                      record.status === 'ACTIVE'
                        ? {
                            key: 'deactivate',
                            label: '停用',
                            danger: true,
                            onClick: () =>
                              statusMutation.mutate({ id: record.id, action: 'deactivate' }),
                          }
                        : {
                            key: 'activate',
                            label: '启用',
                            onClick: () =>
                              statusMutation.mutate({ id: record.id, action: 'activate' }),
                          },
                      {
                        key: 'delete',
                        label: '删除',
                        danger: true,
                        onClick: () => confirmDeleteProduct(record.id, record.nameZh),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        )}
      </SectionCard>

      {/* ---- Create product modal: no code input (auto-generated) ---- */}
      <Modal
        title="新建商品"
        open={createOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            productForm.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          void productForm.validateFields().then((values) => {
            const path = values.categoryPath as string[] | undefined;
            createProductMutation.mutate({
              nameZh: (values.nameZh as string).trim(),
              nameRu: (values.nameRu as string | undefined)?.trim() || undefined,
              brandId: (values.brandId as string | undefined) || undefined,
              categoryId:
                path !== undefined && path.length > 0 ? path[path.length - 1] : undefined,
              remark: (values.remark as string | undefined)?.trim() || undefined,
            });
          })
        }
        confirmLoading={createProductMutation.isPending}
      >
        <p style={{ marginTop: 0, fontSize: 12.5, color: colors.textTertiary }}>
          商品编码无需填写，创建后自动生成。
        </p>
        <Form form={productForm} layout="vertical">
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入中文名称' }]}
          >
            <Input maxLength={500} placeholder="如 VALKYRIE VK87 MAX V2 机械键盘" />
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
                  onClick={() => openBrandModal('create')}
                >
                  + 新增品牌
                </Button>
              </Space>
            }
          >
            <Select allowClear showSearch optionFilterProp="label" options={brandOptions} />
          </Form.Item>
          <Form.Item
            name="categoryPath"
            label={
              <Space size={4}>
                分类
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => openCategoryModal('create')}
                >
                  + 新增分类
                </Button>
              </Space>
            }
            rules={[
              {
                validator: (_rule, value: string[] | undefined) => {
                  if (value === undefined || value.length === 0) {
                    return Promise.resolve();
                  }
                  const leafId = value[value.length - 1];
                  const leaf = leafId === undefined ? undefined : categoryById.get(leafId);
                  if (leaf === undefined || leaf.level !== 3) {
                    return Promise.reject(new Error('商品分类必须选择三级分类'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Cascader<CategoryOption>
              allowClear
              showSearch
              placeholder="一级 / 二级 / 三级（仅三级可选）"
              options={productCategoryOptions}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注（选填）">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Edit product modal: code read-only, prefilled from detail ---- */}
      <Modal
        title={`编辑商品${editSource !== undefined ? ` ${editSource.productCode}` : ''}`}
        open={editOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            productEditForm.resetFields();
            setEditId(null);
          }
        }}
        onCancel={() => {
          setEditOpen(false);
          setEditId(null);
        }}
        onOk={() =>
          void productEditForm.validateFields().then((values) => {
            if (editId === null) {
              return;
            }
            const path = values.categoryPath as string[] | undefined;
            updateProductMutation.mutate({
              id: editId,
              values: {
                nameZh: (values.nameZh as string).trim(),
                nameRu: (values.nameRu as string | undefined)?.trim() || undefined,
                brandId: (values.brandId as string | undefined) ?? null,
                categoryId:
                  path !== undefined && path.length > 0 ? (path[path.length - 1] ?? null) : null,
                remark: (values.remark as string | undefined)?.trim() || undefined,
              },
            });
          })
        }
        confirmLoading={updateProductMutation.isPending}
      >
        <Form form={productEditForm} layout="vertical">
          <Form.Item label="商品编码">
            <Input value={editSource?.productCode ?? ''} disabled />
          </Form.Item>
          <Form.Item
            name="nameZh"
            label="中文名称"
            rules={[{ required: true, message: '请输入中文名称' }]}
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
                  onClick={() => openBrandModal('edit')}
                >
                  + 新增品牌
                </Button>
              </Space>
            }
          >
            <Select allowClear showSearch optionFilterProp="label" options={brandOptions} />
          </Form.Item>
          <Form.Item
            name="categoryPath"
            label={
              <Space size={4}>
                分类
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => openCategoryModal('edit')}
                >
                  + 新增分类
                </Button>
              </Space>
            }
            rules={[
              {
                validator: (_rule, value: string[] | undefined) => {
                  if (value === undefined || value.length === 0) {
                    return Promise.resolve();
                  }
                  const leafId = value[value.length - 1];
                  const leaf = leafId === undefined ? undefined : categoryById.get(leafId);
                  if (leaf === undefined || leaf.level !== 3) {
                    return Promise.reject(new Error('商品分类必须选择三级分类'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <Cascader<CategoryOption>
              allowClear
              showSearch
              placeholder="一级 / 二级 / 三级（仅三级可选）"
              options={productCategoryOptions}
            />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Product detail drawer ---- */}
      <Drawer
        open={drawerId !== null}
        onClose={() => setDrawerId(null)}
        size={800}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 650 }}>
              {product !== undefined ? product.productCode : '商品详情'}
            </span>
            {product !== undefined && renderProductStatus(product.status)}
          </div>
        }
        extra={
          product !== undefined && (
            <>
              <Button size="small" onClick={() => setSkuModalOpen(true)}>
                新建SKU
              </Button>
              <Button size="small" onClick={() => openEdit(product.id)}>
                编辑
              </Button>
              {product.status === 'ACTIVE' ? (
                <Popconfirm
                  title="确认停用该商品？"
                  onConfirm={() => {
                    if (drawerId !== null) {
                      statusMutation.mutate({ id: drawerId, action: 'deactivate' });
                    }
                  }}
                >
                  <Button size="small" danger>
                    停用
                  </Button>
                </Popconfirm>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    if (drawerId !== null) {
                      statusMutation.mutate({ id: drawerId, action: 'activate' });
                    }
                  }}
                >
                  启用
                </Button>
              )}
              <Button
                size="small"
                danger
                onClick={() => confirmDeleteProduct(product.id, product.nameZh)}
              >
                删除
              </Button>
            </>
          )
        }
        styles={{ body: { padding: 0 } }}
        destroyOnHidden
      >
        {product !== undefined && (
          <div style={{ paddingInline: 20, paddingBottom: 24 }}>
            <InfoGrid
              columns={2}
              items={[
                { label: '商品编号', children: product.productCode },
                { label: '中文名称', children: product.nameZh },
                { label: '俄文名称', children: product.nameRu ?? '—' },
                { label: '品牌', children: product.brandName ?? '—' },
                { label: '分类', children: product.categoryName ?? '—' },
                {
                  label: '状态',
                  children: renderProductStatus(product.status),
                },
                { label: 'SKU 数量', children: `${product.skuCount}` },
                { label: '创建时间', children: product.createdAt.slice(0, 10) },
                {
                  label: '备注',
                  span: 2,
                  children: product.remark !== null && product.remark !== '' ? product.remark : '—',
                },
              ]}
            />
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: colors.textPrimary,
                margin: '20px 0 8px',
              }}
            >
              SKU 列表
            </div>
            <DataTable<ProductSkuItem>
              rowKey="id"
              size="small"
              dataSource={drawerDetail.data?.data.skus ?? []}
              pagination={false}
              loading={drawerDetail.isLoading}
              emptyTitle="暂无 SKU"
              emptyDescription="该商品还没有创建内部 SKU。"
              columns={[
                { title: 'SKU Code', dataIndex: 'skuCode', width: 120 },
                { title: '名称', dataIndex: 'nameZh', ellipsis: true },
                { title: '型号', dataIndex: 'model', width: 100, render: (v: string | null) => v ?? '—' },
                { title: '颜色', dataIndex: 'color', width: 90, render: (v: string | null) => v ?? '—' },
                { title: '尺寸', dataIndex: 'size', width: 90, render: (v: string | null) => v ?? '—' },
                {
                  title: 'SN管理',
                  dataIndex: 'serialTracking',
                  width: 80,
                  render: (value: boolean) => (value ? '是' : '否'),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 90,
                  render: (value: string) => renderProductStatus(value),
                },
              ]}
            />
          </div>
        )}
      </Drawer>

      <SkuCreateModal
        open={skuModalOpen}
        onClose={() => setSkuModalOpen(false)}
        fixedProduct={
          product === undefined
            ? undefined
            : {
                id: product.id,
                productCode: product.productCode,
                nameZh: product.nameZh,
              }
        }
        onCreated={() => refreshProducts()}
      />

      {/* ---- Brand quick-create: general name required, no code field ---- */}
      <Modal
        title="新增品牌"
        open={brandModalOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            brandForm.resetFields();
          }
        }}
        onCancel={() => setBrandModalOpen(false)}
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
        confirmLoading={createBrandMutation.isPending}
      >
        <p style={{ marginTop: 0, fontSize: 12.5, color: colors.textTertiary }}>
          品牌编码无需填写，创建后自动生成。
        </p>
        <Form form={brandForm} layout="vertical">
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

      {/* ---- Category quick-create: pick/inline-create parents, then level-3 name ---- */}
      <Modal
        title="新增分类"
        open={categoryModalOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            categoryForm.resetFields();
            setInlineMode(null);
            setInlineNameZh('');
            setInlineNameRu('');
          }
        }}
        onCancel={() => setCategoryModalOpen(false)}
        onOk={() =>
          void categoryForm.validateFields().then((values) => {
            const parent1Id = values.parent1Id as string | undefined;
            const parent2Id = values.parent2Id as string | undefined;
            if (parent1Id === undefined || parent2Id === undefined) {
              return;
            }
            createCategoryMutation.mutate({
              kind: 'leaf',
              parentId: parent2Id,
              path: [parent1Id, parent2Id],
              nameZh: (values.nameZh as string).trim(),
              nameRu: (values.nameRu as string | undefined)?.trim() || undefined,
            });
          })
        }
        confirmLoading={createCategoryMutation.isPending}
      >
        <p style={{ marginTop: 0, fontSize: 12.5, color: colors.textTertiary }}>
          分类编码无需填写，创建后自动生成。商品只能挂载三级分类。
        </p>
        <Form form={categoryForm} layout="vertical">
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
          {inlineMode === 'level1' ? (
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
              <span style={{ fontSize: 13, fontWeight: 550 }}>新增一级分类</span>
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
                  onClick={() => submitInlineCategory('level1')}
                >
                  创建并选中
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setInlineMode(null);
                    setInlineNameZh('');
                    setInlineNameRu('');
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="small"
              type="link"
              style={{ padding: 0, marginTop: -12, marginBottom: 16 }}
              onClick={() => {
                setInlineNameZh('');
                setInlineNameRu('');
                setInlineMode('level1');
              }}
            >
              ＋ 新增一级分类
            </Button>
          )}

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
          {inlineMode === 'level2' ? (
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
              <span style={{ fontSize: 13, fontWeight: 550 }}>新增二级分类</span>
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
                  onClick={() => submitInlineCategory('level2')}
                >
                  创建并选中
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setInlineMode(null);
                    setInlineNameZh('');
                    setInlineNameRu('');
                  }}
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="small"
              type="link"
              style={{ padding: 0, marginTop: -12, marginBottom: 16 }}
              disabled={categoryParent1Id === undefined || categoryParent1Id === ''}
              onClick={() => {
                setInlineNameZh('');
                setInlineNameRu('');
                setInlineMode('level2');
              }}
            >
              ＋ 新增二级分类
            </Button>
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

      {/* ---- Category management: tree + rename / status / sort / parent / delete ---- */}
      <Modal
        title="分类管理"
        open={manageOpen}
        zIndex={1100}
        width={880}
        footer={null}
        afterOpenChange={(open) => {
          if (!open) {
            setManageSelectedId(null);
            categoryInfoForm.resetFields();
            categoryStructureForm.resetFields();
          }
        }}
        onCancel={() => setManageOpen(false)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
          <div
            style={{
              maxHeight: 480,
              overflow: 'auto',
              border: `1px solid ${colors.borderSoft}`,
              borderRadius: 8,
              padding: 8,
            }}
          >
            {categories.data === undefined ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>加载中…</span>
            ) : (
              <Tree
                blockNode
                defaultExpandAll
                selectedKeys={manageSelectedId !== null ? [manageSelectedId] : []}
                onSelect={(keys) => {
                  const first = keys[0];
                  setManageSelectedId(first === undefined ? null : (first as string));
                }}
                treeData={manageTreeData}
              />
            )}
          </div>
          <div>
            {manageSelected === null ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 240,
                  fontSize: 13,
                  color: colors.textTertiary,
                }}
              >
                在左侧选择一个分类节点进行管理。
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 650, color: colors.textPrimary }}>
                    {manageSelected.nameZh}
                    <span style={{ fontSize: 12, fontWeight: 400, color: colors.textTertiary }}>
                      {' '}
                      {manageSelected.code}
                    </span>
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}
                  >
                    <StatusBadge
                      tone={manageSelected.status === 'ACTIVE' ? 'success' : 'neutral'}
                      label={labelOf(ACTIVE_STATUS_LABEL, manageSelected.status)}
                      hint={manageSelected.status}
                    />
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      {CATEGORY_LEVEL_LABEL[manageSelected.level] ?? `${manageSelected.level}级`}分类
                      · 排序 #{manageSelected.sortOrder}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: colors.textTertiary, marginTop: 6 }}>
                    路径：{manageSelectedPath.join(' / ') || '—'}
                  </div>
                </div>

                <section>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>编辑名称</div>
                  <Form form={categoryInfoForm} layout="vertical">
                    <Space orientation="horizontal" wrap size={12}>
                      <Form.Item
                        name="nameZh"
                        label="中文名称"
                        style={{ marginBottom: 0 }}
                        rules={[{ required: true, message: '请输入中文名称' }]}
                      >
                        <Input maxLength={200} style={{ width: 200 }} />
                      </Form.Item>
                      <Form.Item
                        name="nameRu"
                        label="俄文名称（选填）"
                        style={{ marginBottom: 0 }}
                      >
                        <Input maxLength={200} style={{ width: 200 }} />
                      </Form.Item>
                    </Space>
                    <Button
                      type="primary"
                      size="small"
                      style={{ marginTop: 12 }}
                      loading={updateCategoryMutation.isPending}
                      onClick={() => submitCategoryInfo()}
                    >
                      保存名称
                    </Button>
                  </Form>
                </section>

                <section>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
                    排序与层级
                  </div>
                  <Form form={categoryStructureForm} layout="vertical">
                    <Space orientation="horizontal" wrap size={12} align="start">
                      <Form.Item
                        name="sortOrder"
                        label="同级排序值（小者在前）"
                        style={{ marginBottom: 0 }}
                        rules={[{ required: true, message: '请输入排序值' }]}
                      >
                        <InputNumber min={0} precision={0} style={{ width: 140 }} />
                      </Form.Item>
                      {manageSelected.level > 1 && (
                        <Form.Item
                          name="parentId"
                          label="父分类（清空则移至顶级）"
                          style={{ marginBottom: 0 }}
                        >
                          <TreeSelect
                            allowClear
                            showSearch
                            treeNodeFilterProp="title"
                            treeDefaultExpandAll
                            placeholder="选择新的父分类"
                            style={{ width: 260 }}
                            treeData={manageParentTreeData}
                          />
                        </Form.Item>
                      )}
                    </Space>
                    <Button
                      type="primary"
                      size="small"
                      style={{ marginTop: 12 }}
                      loading={updateCategoryMutation.isPending}
                      onClick={() => submitCategoryStructure()}
                    >
                      保存排序 / 层级
                    </Button>
                  </Form>
                </section>

                <section
                  style={{
                    borderTop: `1px solid ${colors.borderSoft}`,
                    paddingTop: 14,
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  {manageSelected.status === 'ACTIVE' ? (
                    <Button size="small" danger onClick={() => confirmDisableCategory()}>
                      停用
                    </Button>
                  ) : (
                    <Button size="small" onClick={() => toggleCategoryStatus()}>
                      启用
                    </Button>
                  )}
                  <Button size="small" danger onClick={() => confirmDeleteCategory()}>
                    删除
                  </Button>
                </section>
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
