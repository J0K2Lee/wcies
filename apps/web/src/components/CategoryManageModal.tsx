import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Tree,
  TreeSelect,
} from 'antd';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { apiDelete, apiPatch, useApiQuery } from '../api/hooks';
import {
  ACTIVE_STATUS_LABEL,
  DeleteConfirmModal,
  StatusBadge,
  colors,
  labelOf,
} from '../design-system';

/**
 * 分类管理弹窗（V1 改造 2026-10-13 从已删除的 ProductsPage 原样迁入 SKU
 * 管理页）：左侧树（模糊搜索 + 自动展开 + 命中高亮 + 虚拟滚动），右侧对选中
 * 节点做 改名 / 排序 / 改父 / 停用启用 / 删除。交互与迁入前完全一致。
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

interface CategoryUpdateInput {
  nameZh?: string;
  nameRu?: string;
  sortOrder?: number;
  parentId?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

const CATEGORY_LEVEL_LABEL: Record<number, string> = { 1: '一级', 2: '二级', 3: '三级' };

const categoryOptionLabel = (node: CategoryNode): string =>
  node.status === 'ACTIVE' ? node.nameZh : `${node.nameZh}（停用）`;

const bySortOrder = (a: CategoryNode, b: CategoryNode): number =>
  a.sortOrder - b.sortOrder || a.nameZh.localeCompare(b.nameZh);

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

export interface CategoryManageModalProps {
  open: boolean;
  onClose: () => void;
}

export function CategoryManageModal({ open, onClose }: CategoryManageModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Fuzzy filter over the 8k-node tree (nameZh / nameRu / code). */
  const [keyword, setKeyword] = useState('');
  /** null = follow the mode's auto-expansion; an array = the operator's own. */
  const [expandedKeys, setExpandedKeys] = useState<string[] | null>(null);
  const [infoForm] = Form.useForm();
  const [structureForm] = Form.useForm();
  const [deleting, setDeleting] = useState<CategoryNode | null>(null);

  // Sprint 8.5R1: tree-lite - same hierarchy/ordering, no entity bookkeeping
  // columns (the 8k-node OZON tree used to ship megabytes per page load).
  const categories = useApiQuery<{ data: CategoryNode[] }>('/api/v1/categories/tree-lite', {}, [
    'categories',
  ]);
  const categoryTree = categories.data?.data ?? [];

  const { byId, pathById } = useMemo(() => {
    const idMap = new Map<string, CategoryNode>();
    const trailMap = new Map<string, string[]>();
    const walk = (nodes: CategoryNode[], trail: string[]): void => {
      for (const node of [...nodes].sort(bySortOrder)) {
        const path = [...trail, node.id];
        idMap.set(node.id, node);
        trailMap.set(node.id, path);
        walk(node.children, path);
      }
    };
    walk(categoryTree, []);
    return { byId: idMap, pathById: trailMap };
  }, [categoryTree]);

  /**
   * Manager-tree search (2026-09-14): fuzzy filter over the 8k-node tree.
   * While a keyword is active the tree shows matches + their ancestors only.
   */
  const search = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (needle === '') {
      return { active: false, nodes: categoryTree, matches: 0 };
    }
    const filtered = filterCategoryTree(categoryTree, needle);
    return { active: true, nodes: filtered.nodes, matches: filtered.matches };
  }, [categoryTree, keyword]);

  const treeData = useMemo(
    () => buildManageTreeData(search.nodes, search.active ? keyword.trim() : undefined),
    [search, keyword],
  );
  // Sprint 8.5R1: expanding all 8k nodes at mount froze the dialog. Start with
  // the level-1 nodes expanded and let the (virtualised) Tree load the rest as
  // the operator drills in. A search flips that to "everything that has
  // children", so no hit can hide behind a collapsed branch.
  const autoExpandedKeys = useMemo(
    () =>
      search.active
        ? collectBranchKeys(search.nodes)
        : categoryTree.filter((node) => node.level === 1).map((node) => node.id),
    [search, categoryTree],
  );
  const visibleExpandedKeys = expandedKeys ?? autoExpandedKeys;

  const selected = selectedId !== null ? (byId.get(selectedId) ?? null) : null;

  const parentTreeData = useMemo(() => {
    if (selected === null) {
      return [];
    }
    return buildParentTreeData(categoryTree, new Set(collectSubtreeIds(selected)));
  }, [selected, categoryTree]);

  const selectedPath = useMemo(() => {
    if (selectedId === null) {
      return [];
    }
    return (pathById.get(selectedId) ?? []).map((id) => byId.get(id)?.nameZh ?? id);
  }, [selectedId, pathById, byId]);

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: CategoryUpdateInput }) =>
      apiPatch('/api/v1/categories/{id}', values, { id }),
    onSuccess: () => {
      void message.success('分类已更新');
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/categories/{id}', { id }),
    onSuccess: () => {
      void message.success('分类已删除');
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // Keep the forms in sync with the selected node / tree refreshes.
  useEffect(() => {
    if (!open) {
      return;
    }
    if (selected === null) {
      infoForm.resetFields();
      structureForm.resetFields();
      return;
    }
    infoForm.setFieldsValue({
      nameZh: selected.nameZh,
      nameRu: selected.nameRu ?? undefined,
    });
    structureForm.setFieldsValue({
      sortOrder: selected.sortOrder,
      parentId: selected.parentId ?? undefined,
    });
  }, [open, selected, infoForm, structureForm]);

  const submitInfo = () => {
    if (selectedId === null) {
      return;
    }
    void infoForm.validateFields().then((values) => {
      updateMutation.mutate({
        id: selectedId,
        values: {
          nameZh: values.nameZh as string,
          nameRu: (values.nameRu as string | undefined)?.trim() || undefined,
        },
      });
    });
  };

  const submitStructure = () => {
    if (selectedId === null) {
      return;
    }
    const node = byId.get(selectedId);
    if (node === undefined) {
      return;
    }
    void structureForm.validateFields().then((values) => {
      updateMutation.mutate({
        id: selectedId,
        values: {
          sortOrder: (values.sortOrder as number | undefined) ?? node.sortOrder,
          // Level-1 nodes have no parent; clearing the picker moves to root.
          ...(node.level > 1 ? { parentId: (values.parentId as string | undefined) ?? null } : {}),
        },
      });
    });
  };

  const toggleStatus = () => {
    if (selected === null) {
      return;
    }
    updateMutation.mutate({
      id: selected.id,
      values: { status: selected.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' },
    });
  };

  return (
    <>
      <Modal
        title="分类管理"
        open={open}
        zIndex={1100}
        width={880}
        footer={null}
        afterOpenChange={(opened) => {
          if (!opened) {
            setSelectedId(null);
            setKeyword('');
            setExpandedKeys(null);
            infoForm.resetFields();
            structureForm.resetFields();
          }
        }}
        onCancel={onClose}
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
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value);
                // Searching re-expands the filtered tree; keeping a manual
                // expand state would hide hits behind collapsed branches.
                setExpandedKeys(null);
              }}
            />
            {search.active && (
              <span
                style={{
                  fontSize: 12,
                  color: search.matches === 0 ? colors.danger : colors.textTertiary,
                }}
              >
                {search.matches === 0
                  ? '未找到匹配的分类'
                  : `匹配 ${search.matches} 个分类（自动带出其父级，高亮为命中片段）`}
              </span>
            )}
            {categories.data === undefined ? (
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>加载中…</span>
            ) : search.active && search.matches === 0 ? (
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
                expandedKeys={visibleExpandedKeys}
                onExpand={(keys) => setExpandedKeys(keys.map(String))}
                selectedKeys={selectedId !== null ? [selectedId] : []}
                onSelect={(keys) => {
                  const first = keys[0];
                  setSelectedId(first === undefined ? null : (first as string));
                }}
                treeData={treeData}
              />
            )}
          </div>
          <div>
            {selected === null ? (
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
                    {selected.nameZh}
                    <span style={{ fontSize: 12, fontWeight: 400, color: colors.textTertiary }}>
                      {' '}
                      {selected.code}
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
                      tone={selected.status === 'ACTIVE' ? 'success' : 'neutral'}
                      label={labelOf(ACTIVE_STATUS_LABEL, selected.status)}
                      hint={selected.status}
                    />
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      {CATEGORY_LEVEL_LABEL[selected.level] ?? `${selected.level}级`} 分类 · 排序 #
                      {selected.sortOrder}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: colors.textTertiary, marginTop: 6 }}>
                    路径：{selectedPath.join(' / ') || '—'}
                  </div>
                </div>

                <section>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>编辑名称</div>
                  <Form form={infoForm} layout="vertical">
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
                      loading={updateMutation.isPending}
                      onClick={() => submitInfo()}
                    >
                      保存名称
                    </Button>
                  </Form>
                </section>

                <section>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>排序与层级</div>
                  <Form form={structureForm} layout="vertical">
                    <Space orientation="horizontal" wrap size={12} align="start">
                      <Form.Item
                        name="sortOrder"
                        label="同级排序值（小者在前）"
                        style={{ marginBottom: 0 }}
                        rules={[{ required: true, message: '请输入排序值' }]}
                      >
                        <InputNumber min={0} precision={0} style={{ width: 140 }} />
                      </Form.Item>
                      {selected.level > 1 && (
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
                            treeData={parentTreeData}
                          />
                        </Form.Item>
                      )}
                    </Space>
                    <Button
                      type="primary"
                      size="small"
                      style={{ marginTop: 12 }}
                      loading={updateMutation.isPending}
                      onClick={() => submitStructure()}
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
                  {selected.status === 'ACTIVE' ? (
                    /* 内嵌管理器例外（UI 规范 §5.2）：停用 Popconfirm、启用直发。 */
                    <Popconfirm
                      title={`确认停用「${selected.nameZh}」？`}
                      description="停用后不再出现在新建选项中。"
                      okText="停用"
                      okButtonProps={{ danger: true }}
                      cancelText="取消"
                      onConfirm={() => toggleStatus()}
                    >
                      <Button size="small" danger>
                        停用
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button size="small" onClick={() => toggleStatus()}>
                      启用
                    </Button>
                  )}
                  <Button size="small" danger onClick={() => setDeleting(selected)}>
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
        open={deleting !== null}
        title={`删除分类「${deleting?.nameZh ?? ''}」？`}
        description="存在子分类或 SKU 时后端将拒绝删除。"
        confirmLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            deleteMutation.mutate(deleting.id);
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
