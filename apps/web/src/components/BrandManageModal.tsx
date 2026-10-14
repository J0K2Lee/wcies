import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, Modal, Popconfirm, Table, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { apiDelete, apiPatch, useApiQuery, useDebouncedValue } from '../api/hooks';
import {
  ACTIVE_STATUS_LABEL,
  DeleteConfirmModal,
  StatusBadge,
  colors,
  labelOf,
} from '../design-system';

/**
 * 品牌管理弹窗（V1 改造 2026-10-13，决策 D4）：与「分类管理」同级、同交互
 * 模式——列表（可搜索）/ 改名 / 停用启用 / 删除（零引用真删，被 SKU 引用时
 * 后端 BRAND_IN_USE 拒绝）。入口在 SKU 管理页。
 */

interface BrandItem {
  id: string;
  code: string;
  name: string;
  nameZh: string | null;
  nameEn: string | null;
  nameRu: string | null;
  status: string;
}

interface BrandUpdateInput {
  name?: string;
  nameZh?: string | null;
  nameEn?: string | null;
  nameRu?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface BrandManageModalProps {
  open: boolean;
  onClose: () => void;
}

export function BrandManageModal({ open, onClose }: BrandManageModalProps) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const [keyword, setKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [deleting, setDeleting] = useState<BrandItem | null>(null);

  // 搜索：关键字进 queryKey，否则 react-query 视为同一查询、输入后不会重新请求
  // （2026-10-14 修复"品牌管理里搜索不生效"）；输入做 300ms 防抖，避免逐字打请求。
  const debouncedKeyword = useDebouncedValue(keyword);
  const brands = useApiQuery<{ data: BrandItem[] }>(
    '/api/v1/brands',
    { keyword: debouncedKeyword || undefined },
    // 无关键字时沿用页面级 ['brands'] 缓存（共享同一份全量数据），
    // 有关键字才分键；失效仍按前缀命中（invalidateQueries(['brands'])）。
    debouncedKeyword === '' ? ['brands'] : ['brands', { keyword: debouncedKeyword }],
  );
  const rows = brands.data?.data ?? [];

  const selected = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: BrandUpdateInput }) =>
      apiPatch('/api/v1/brands/{id}', values, { id }),
    onSuccess: () => {
      void message.success('品牌已更新');
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/brands/{id}', { id }),
    onSuccess: () => {
      void message.success('品牌已删除');
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['brands'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // Keep the edit form in sync with the selection / list refreshes.
  useEffect(() => {
    if (!open) {
      return;
    }
    if (selected === null) {
      form.resetFields();
      return;
    }
    form.setFieldsValue({
      name: selected.name,
      nameZh: selected.nameZh ?? undefined,
      nameEn: selected.nameEn ?? undefined,
      nameRu: selected.nameRu ?? undefined,
    });
  }, [open, selected, form]);

  const submitRename = () => {
    if (selected === null) {
      return;
    }
    void form.validateFields().then((values) => {
      updateMutation.mutate({
        id: selected.id,
        values: {
          name: (values.name as string).trim(),
          nameZh: (values.nameZh as string | undefined)?.trim() || null,
          nameEn: (values.nameEn as string | undefined)?.trim() || null,
          nameRu: (values.nameRu as string | undefined)?.trim() || null,
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
        title="品牌管理"
        open={open}
        zIndex={1100}
        width={760}
        footer={null}
        afterOpenChange={(opened) => {
          if (!opened) {
            setKeyword('');
            setSelectedId(null);
            form.resetFields();
          }
        }}
        onCancel={onClose}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input.Search
            allowClear
            placeholder="搜索品牌（编码 / 一般名称 / 中文名 / 英文名 / 俄文名）"
            aria-label="搜索品牌"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Table<BrandItem>
            rowKey="id"
            size="small"
            loading={brands.isLoading}
            dataSource={rows}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            rowClassName={(record) => (record.id === selectedId ? 'wcies-row-selected' : '')}
            onRow={(record) => ({
              onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            columns={[
              { title: '编码', dataIndex: 'code', width: 110 },
              {
                title: '名称（一般 / 中文 / 英文 / 俄文）',
                dataIndex: 'name',
                render: (value: string, record) => {
                  const others = [record.nameZh, record.nameEn, record.nameRu].filter(
                    (part): part is string => part !== null && part !== '',
                  );
                  return (
                    <span>
                      {value}
                      {others.length > 0 && (
                        <span style={{ color: colors.textTertiary }}>（{others.join(' / ')}）</span>
                      )}
                    </span>
                  );
                },
              },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value: string) => (
                  <StatusBadge
                    tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                    label={labelOf(ACTIVE_STATUS_LABEL, value)}
                    hint={value}
                    showDot={false}
                  />
                ),
              },
            ]}
          />

          {selected === null ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 120,
                fontSize: 13,
                color: colors.textTertiary,
                border: `1px solid ${colors.borderSoft}`,
                borderRadius: 8,
              }}
            >
              在上方选择一个品牌进行管理。
            </div>
          ) : (
            <section
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                border: `1px solid ${colors.borderSoft}`,
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 650, color: colors.textPrimary }}>
                  {selected.name}
                </span>
                <Tag>{selected.code}</Tag>
                <StatusBadge
                  tone={selected.status === 'ACTIVE' ? 'success' : 'neutral'}
                  label={labelOf(ACTIVE_STATUS_LABEL, selected.status)}
                  hint={selected.status}
                />
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>编辑名称</div>
                <Form form={form} layout="vertical">
                  <Form.Item
                    name="name"
                    label="一般名称"
                    style={{ marginBottom: 0 }}
                    rules={[{ required: true, message: '请输入一般名称' }]}
                  >
                    <Input maxLength={200} style={{ width: 240 }} />
                  </Form.Item>
                  <Form.Item name="nameZh" label="中文名称（选填）" style={{ marginBottom: 0 }}>
                    <Input maxLength={200} style={{ width: 240 }} />
                  </Form.Item>
                  <Form.Item name="nameEn" label="英文名称（选填）" style={{ marginBottom: 0 }}>
                    <Input maxLength={200} style={{ width: 240 }} />
                  </Form.Item>
                  <Form.Item name="nameRu" label="俄文名称（选填）" style={{ marginBottom: 0 }}>
                    <Input maxLength={200} style={{ width: 240 }} />
                  </Form.Item>
                  <Button
                    type="primary"
                    size="small"
                    style={{ marginTop: 12 }}
                    loading={updateMutation.isPending}
                    onClick={() => submitRename()}
                  >
                    保存名称
                  </Button>
                </Form>
              </div>

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
                    title={`确认停用「${selected.name}」？`}
                    description="停用后不再出现在新建选项中（已引用它的 SKU 不受影响）。"
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
            </section>
          )}
        </div>
      </Modal>

      {/* 品牌删除 = 主数据删除，统一 DeleteConfirmModal（G4）。 */}
      <DeleteConfirmModal
        open={deleting !== null}
        title={`删除品牌「${deleting?.name ?? ''}」？`}
        description="已被 SKU 引用时后端将拒绝删除（BRAND_IN_USE），只能停用。"
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
