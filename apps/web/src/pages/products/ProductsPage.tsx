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
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { SkuCreateModal } from '../../components/SkuCreateModal';
import {
  BrandQuickCreateModal,
  CategoryQuickCreateModal,
} from '../../components/QuickCreateModals';
import {
  ACTIVE_STATUS_LABEL,
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
  RailHint,
  RelativeTime,
  SectionCard,
  SKU_STATUS_META,
  StatusBadge,
  StatusSwitch,
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
  /** Plain text normally; a ReactNode only when a search hit is highlighted. */
  title: ReactNode;
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

const buildManageTreeData = (nodes: CategoryNode[], highlight?: string): ManageTreeNode[] =>
  [...nodes].sort(bySortOrder).map((node) => {
    const children = buildManageTreeData(node.children, highlight);
    return {
      key: node.id,
      title:
        highlight === undefined
          ? categoryOptionLabel(node)
          : highlightKeyword(categoryOptionLabel(node), highlight),
      ...(children.length > 0 ? { children } : {}),
    };
  });

/** Ids of every node that has children - used to auto-expand search results. */
const collectBranchKeys = (nodes: CategoryNode[]): string[] =>
  nodes.flatMap((node) =>
    node.children.length > 0 ? [node.id, ...collectBranchKeys(node.children)] : [],
  );

/** Fuzzy search fields for the manager tree (case-insensitive substring). */
const categoryMatchesKeyword = (node: CategoryNode, needle: string): boolean =>
  [node.nameZh, node.nameRu, node.code].some((value) =>
    (value ?? '').toLowerCase().includes(needle),
  );

/**
 * Prunes the tree to matching nodes plus their ancestors: a hit deep in the
 * 8k-node OZON tree must stay reachable, and an ancestor need not match itself.
 */
function filterCategoryTree(
  nodes: CategoryNode[],
  needle: string,
): { nodes: CategoryNode[]; matches: number } {
  let matches = 0;
  const walk = (list: CategoryNode[]): CategoryNode[] =>
    list.flatMap((node) => {
      const children = walk(node.children);
      const hit = categoryMatchesKeyword(node, needle);
      if (hit) {
        matches += 1;
      }
      return hit || children.length > 0 ? [{ ...node, children }] : [];
    });
  return { nodes: walk(nodes), matches };
}

/** Wraps the matched substring so a hit is visible inside a long name. */
function highlightKeyword(text: string, keyword: string): ReactNode {
  const needle = keyword.trim();
  if (needle === '') {
    return text;
  }
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) {
    return text;
  }
  return (
    <>
      {text.slice(0, index)}
      <span
        style={{
          background: colors.warningBg,
          color: colors.warning,
          borderRadius: 3,
          padding: '0 1px',
        }}
      >
        {text.slice(index, index + needle.length)}
      </span>
      {text.slice(index + needle.length)}
    </>
  );
}

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
  const { message } = App.useApp();
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

  // ---- Brand / category quick-create (shared modals, G9) ----
  const [brandModalOpen, setBrandModalOpen] = useState(false);
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  /** Which product form a quick-created brand/category should fill. */
  const [quickCreateTarget, setQuickCreateTarget] = useState<'create' | 'edit'>('create');

  // ---- Category management modal ----
  const [manageOpen, setManageOpen] = useState(false);
  const [manageSelectedId, setManageSelectedId] = useState<string | null>(null);
  /** Fuzzy filter over the 8k-node tree (nameZh / nameRu / code). */
  const [manageKeyword, setManageKeyword] = useState('');
  /** null = follow the mode's auto-expansion; an array = the operator's own. */
  const [manageExpandedKeys, setManageExpandedKeys] = useState<string[] | null>(null);
  const [categoryInfoForm] = Form.useForm();
  const [categoryStructureForm] = Form.useForm();
  const [deletingCategory, setDeletingCategory] = useState<CategoryNode | null>(null);

  // ---- SKU quick-create (from product drawer) ----
  const [skuModalOpen, setSkuModalOpen] = useState(false);

  // ---- Delete confirmation (one dialog for normal + forced delete) ----
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
    dependentCount: number;
  } | null>(null);

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

  // Sprint 8.5R1: tree-lite - same hierarchy/ordering, no entity bookkeeping
  // columns. The 8k-node OZON tree used to ship megabytes to this page (and
  // to the category manager tree, which then rendered all of them).
  const categories = useApiQuery<{ data: CategoryNode[] }>('/api/v1/categories/tree-lite', {}, [
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
  /**
   * Manager-tree search (2026-09-14): fuzzy filter over the 8k-node tree.
   * While a keyword is active the tree shows matches + their ancestors only.
   */
  const manageSearch = useMemo(() => {
    const needle = manageKeyword.trim().toLowerCase();
    if (needle === '') {
      return { active: false, nodes: categoryTree, matches: 0 };
    }
    const filtered = filterCategoryTree(categoryTree, needle);
    return { active: true, nodes: filtered.nodes, matches: filtered.matches };
  }, [categoryTree, manageKeyword]);

  const manageTreeData = useMemo(
    () =>
      buildManageTreeData(
        manageSearch.nodes,
        manageSearch.active ? manageKeyword.trim() : undefined,
      ),
    [manageSearch, manageKeyword],
  );
  // Sprint 8.5R1: expanding all 8k nodes at mount froze the dialog. Start with
  // the 26 level-1 nodes expanded and let the (virtualised) Tree load the rest
  // as the operator drills in. A search flips that to "everything that has
  // children", so no hit can hide behind a collapsed branch.
  const manageAutoExpandedKeys = useMemo(
    () =>
      manageSearch.active
        ? collectBranchKeys(manageSearch.nodes)
        : categoryTree.filter((node) => node.level === 1).map((node) => node.id),
    [manageSearch, categoryTree],
  );
  const manageVisibleExpandedKeys = manageExpandedKeys ?? manageAutoExpandedKeys;

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
    mutationFn: ({ id, force }: { id: string; force: boolean }) =>
      apiDelete(`/api/v1/products/{id}${force ? '?force=true' : ''}`, { id }),
    onSuccess: (_data, variables) => {
      void message.success('商品已删除');
      const id = variables.id;
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

  const confirmDeleteProduct = (id: string, name: string, skuCount: number) => {
    setDeleteTarget({ id, name, dependentCount: skuCount });
  };

  const openBrandModal = (target: 'create' | 'edit') => {
    setQuickCreateTarget(target);
    setBrandModalOpen(true);
  };

  const openCategoryModal = (target: 'create' | 'edit') => {
    setQuickCreateTarget(target);
    setCategoryModalOpen(true);
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
            <RailHint>点击表格任意行，在此快速预览商品基本信息。</RailHint>
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
            <ContextMetric
              label="创建时间"
              value={<RelativeTime value={selectedRow.createdAt} />}
            />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="商品"
              disableHint="停用后商品及其 SKU 不再参与订单匹配与渠道推送"
              loading={statusMutation.isPending}
              onChange={(next) =>
                statusMutation.mutate({
                  id: selectedRow.id,
                  action: next ? 'activate' : 'deactivate',
                })
              }
            />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDrawerId(selectedRow.id)}>
              查看详情
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => openEdit(selectedRow.id)}>
              编辑
            </Button>
            <Button
              block
              danger
              style={{ marginTop: 8 }}
              onClick={() =>
                confirmDeleteProduct(selectedRow.id, selectedRow.nameZh, selectedRow.skuCount)
              }
            >
              删除
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, rows.length, statusMutation.isPending, statusMutation.mutate]);
  useContextRail(railContent);

  const hasActiveFilters =
    keyword !== '' ||
    status !== undefined ||
    brandFilter !== undefined ||
    (categoryFilterPath !== undefined && categoryFilterPath.length > 0);

  const brandOptions = (brands.data?.data ?? []).map((brand) => ({
    value: brand.id,
    // 停用品牌保留可选但带后缀（与分类筛选一致）。
    label: brand.status === 'ACTIVE' ? brand.name : `${brand.name}（停用）`,
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
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
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
              onDoubleClick: () => setDrawerId(record.id),
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
                render: (value: string) => <RelativeTime value={value} />,
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
              categoryId: path !== undefined && path.length > 0 ? path[path.length - 1] : undefined,
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
                  + 新建品牌
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
                  + 新建分类
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
                  + 新建品牌
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
                  + 新建分类
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
        size={760}
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
              {/* 启停在右栏 StatusSwitch（唯一入口）。 */}
              <Button size="small" onClick={() => setSkuModalOpen(true)}>
                新建SKU
              </Button>
              <Button size="small" onClick={() => openEdit(product.id)}>
                编辑
              </Button>
              <Button
                size="small"
                danger
                onClick={() => confirmDeleteProduct(product.id, product.nameZh, product.skuCount)}
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
                {
                  label: '创建时间',
                  children: <RelativeTime value={product.createdAt} />,
                },
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
                { title: 'SKU 编码', dataIndex: 'skuCode', width: 120 },
                { title: '名称', dataIndex: 'nameZh', ellipsis: true },
                {
                  title: '型号',
                  dataIndex: 'model',
                  width: 100,
                  render: (v: string | null) => v ?? '—',
                },
                {
                  title: '颜色',
                  dataIndex: 'color',
                  width: 90,
                  render: (v: string | null) => v ?? '—',
                },
                {
                  title: '尺寸',
                  dataIndex: 'size',
                  width: 90,
                  render: (v: string | null) => v ?? '—',
                },
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

      {/* ---- Delete confirmation (normal vs forced cascade) ---- */}
      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="确认删除该商品？"
        description={
          deleteTarget === null
            ? ''
            : `将删除「${deleteTarget.name}」及其 ${deleteTarget.dependentCount} 个 SKU。` +
              `若该商品或其 SKU 已有库存流水/订单/拣货记录，删除会被拒绝。`
        }
        forceLabel="强制删除（同时删除关联的 SKU、条码、图片与平台映射）"
        forceWarning="强制删除仅级联主数据。若已有库存流水、订单行、拣货或发货记录，后端仍会拒绝删除——这些记录是货物实际流转的凭证，无法移除。此时请改用「停用」。"
        confirmLoading={deleteProductMutation.isPending}
        onConfirm={(force) => {
          if (deleteTarget === null) {
            return;
          }
          deleteProductMutation.mutate(
            { id: deleteTarget.id, force },
            { onSettled: () => setDeleteTarget(null) },
          );
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ---- Shared quick-create dialogs (G9) ---- */}
      <BrandQuickCreateModal
        open={brandModalOpen}
        zIndex={1100}
        onClose={() => setBrandModalOpen(false)}
        onCreated={(brandId) => {
          if (quickCreateTarget === 'edit') {
            productEditForm.setFieldValue('brandId', brandId);
          } else {
            productForm.setFieldValue('brandId', brandId);
          }
        }}
      />
      <CategoryQuickCreateModal
        open={categoryModalOpen}
        zIndex={1100}
        onClose={() => setCategoryModalOpen(false)}
        onCreated={(path) => {
          if (quickCreateTarget === 'edit') {
            productEditForm.setFieldValue('categoryPath', path);
          } else {
            productForm.setFieldValue('categoryPath', path);
          }
        }}
      />

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
            setManageKeyword('');
            setManageExpandedKeys(null);
            categoryInfoForm.resetFields();
            categoryStructureForm.resetFields();
          }
        }}
        onCancel={() => setManageOpen(false)}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              border: `1px solid ${colors.borderSoft}`,
              borderRadius: 8,
              padding: 8,
            }}
          >
            <Input.Search
              allowClear
              placeholder="搜索分类（中文名 / 俄文名 / 编码）"
              aria-label="搜索分类"
              value={manageKeyword}
              onChange={(event) => {
                setManageKeyword(event.target.value);
                // Searching re-expands the filtered tree; keeping a manual
                // expand state would hide hits behind collapsed branches.
                setManageExpandedKeys(null);
              }}
            />
            {manageSearch.active && (
              <span
                style={{
                  fontSize: 12,
                  color: manageSearch.matches === 0 ? colors.danger : colors.textTertiary,
                }}
              >
                {manageSearch.matches === 0
                  ? '未找到匹配的分类'
                  : `匹配 ${manageSearch.matches} 个分类（自动带出其父级，高亮为命中片段）`}
              </span>
            )}
            {categories.data === undefined ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>加载中…</span>
            ) : manageSearch.active && manageSearch.matches === 0 ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                换个关键词试试：支持中文名、俄文名与编码（如 CN00004）的模糊匹配。
              </span>
            ) : (
              // `height` turns on the Tree's own virtual scrolling: only the
              // visible rows exist in the DOM, so selecting a node no longer
              // re-renders thousands of them.
              <Tree
                blockNode
                height={440}
                expandedKeys={manageVisibleExpandedKeys}
                onExpand={(keys) => setManageExpandedKeys(keys.map(String))}
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
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <StatusBadge
                      tone={manageSelected.status === 'ACTIVE' ? 'success' : 'neutral'}
                      label={labelOf(ACTIVE_STATUS_LABEL, manageSelected.status)}
                      hint={manageSelected.status}
                    />
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      {CATEGORY_LEVEL_LABEL[manageSelected.level] ?? `${manageSelected.level}级`}
                      分类 · 排序 #{manageSelected.sortOrder}
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
                      <Form.Item name="nameRu" label="俄文名称（选填）" style={{ marginBottom: 0 }}>
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
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>排序与层级</div>
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
                    /* 内嵌管理器例外（UI 规范 §5.2）：停用 Popconfirm、启用直发。 */
                    <Popconfirm
                      title={`确认停用「${manageSelected.nameZh}」？`}
                      description="停用后不再出现在新建选项中。"
                      okText="停用"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => toggleCategoryStatus()}
                    >
                      <Button size="small" danger>
                        停用
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" onClick={() => toggleCategoryStatus()}>
                      启用
                    </Button>
                  )}
                  <Button size="small" danger onClick={() => setDeletingCategory(manageSelected)}>
                    删除
                  </Button>
                </section>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* 分类删除 = 主数据删除，统一 DeleteConfirmModal（G4）。 */}
      <DeleteConfirmModal
        open={deletingCategory !== null}
        title={`删除分类「${deletingCategory?.nameZh ?? ''}」？`}
        description="存在子分类或商品时后端将拒绝删除。"
        confirmLoading={deleteCategoryMutation.isPending}
        onConfirm={() => {
          if (deletingCategory !== null) {
            deleteCategoryMutation.mutate(deletingCategory.id);
          }
        }}
        onCancel={() => setDeletingCategory(null)}
      />
    </div>
  );
}
