import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Drawer, Form, Input, Modal, Select } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime } from '../../utils/format';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  DeleteConfirmModal,
  EntitySummary,
  FilterBar,
  InfoGrid,
  PageHeader,
  RailHint,
  RelativeTime,
  SectionCard,
  StatusBadge,
  StatusSwitch,
  useContextRail,
} from '../../design-system';

/**
 * Supplier master data (Sprint 7 T2). Only REUSABLE vendors live here -
 * one-off online purchases are recorded as source_note on the purchase
 * documents instead (decision 0013 §3), which this page states explicitly
 * so operators do not pollute the master data with throwaway sellers.
 */

interface SupplierRow {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  status: string;
  remark: string | null;
  referenceCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface SupplierFormValues {
  name: string;
  code?: string;
  contactName?: string;
  contactPhone?: string;
  remark?: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

export function SuppliersPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<SupplierRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<SupplierRow | null>(null);
  const [form] = Form.useForm<SupplierFormValues>();
  const [editForm] = Form.useForm<SupplierFormValues>();

  const list = useApiQuery<Envelope<SupplierRow[]>>(
    '/api/v1/suppliers',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(status ? { status } : {}),
    },
    ['suppliers', page, keyword, status],
  );

  const detail = useApiQuery<{ data: SupplierRow }>(
    '/api/v1/suppliers/{id}',
    {},
    ['supplier-detail', detailId],
    { id: detailId ?? '' },
    detailId !== null,
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = detail.data?.data ?? null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    void queryClient.invalidateQueries({ queryKey: ['supplier-detail'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: SupplierFormValues) => apiPost('/api/v1/suppliers', values),
    onSuccess: () => {
      void message.success('供应商已创建');
      setCreateOpen(false);
      form.resetFields();
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<SupplierFormValues> }) =>
      apiPatch('/api/v1/suppliers/{id}', values, { id }),
    onSuccess: () => {
      void message.success('供应商已更新');
      setEditing(null);
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost('/api/v1/suppliers/{id}/{action}', {}, { id, action }),
    onSuccess: () => {
      void message.success('状态已更新');
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/suppliers/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('供应商已删除');
      setDeleting(null);
      if (detailId === id) {
        setDetailId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  // ---- Context rail ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="供应商概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 家`} />
            <RailHint>
              只把可复用的固定供应商建档；一次性网购在采购单上用「货源说明」记录，不进主数据。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.name}
          subtitle={selectedRow.code}
          badge={
            <StatusBadge
              tone={selectedRow.status === 'ACTIVE' ? 'success' : 'neutral'}
              label={selectedRow.status === 'ACTIVE' ? '启用' : '停用'}
              hint={selectedRow.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="联系人" value={selectedRow.contactName ?? '—'} />
            <ContextMetric label="联系电话" value={selectedRow.contactPhone ?? '—'} />
            <ContextMetric label="备注" value={selectedRow.remark ?? '—'} />
            <ContextMetric label="创建时间" value={fmtDateTime(selectedRow.createdAt)} />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="供应商"
              disableHint="停用后不可在采购单/收货单中选用"
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
            <Button block onClick={() => setDetailId(selectedRow.id)}>
              查看详情
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => setEditing(selectedRow)}>
              编辑
            </Button>
            <Button block danger style={{ marginTop: 8 }} onClick={() => setDeleting(selectedRow)}>
              删除
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, statusMutation.isPending, statusMutation.mutate]);
  useContextRail(railContent);

  // Shared fields; each dialog wraps them in its OWN form instance so the
  // edit dialog can carry initialValues (destroyOnHidden remounts per open,
  // which re-evaluates them - setFieldsValue before mount gets lost).
  const supplierFields = (
    <>
      <Form.Item
        name="name"
        label="供应商名称"
        rules={[{ required: true, message: '请输入供应商名称' }]}
      >
        <Input placeholder="如：深圳华强北电子供应商" maxLength={200} />
      </Form.Item>
      <Form.Item name="contactName" label="联系人">
        <Input maxLength={100} />
      </Form.Item>
      <Form.Item name="contactPhone" label="联系电话">
        <Input maxLength={100} />
      </Form.Item>
      <Form.Item name="remark" label="备注">
        <Input.TextArea rows={3} maxLength={2000} />
      </Form.Item>
    </>
  );
  const supplierForm = (
    <Form form={form} layout="vertical" preserve={false}>
      <Form.Item name="code" label="编码（留空自动生成 SUP%04d）">
        <Input placeholder="自动生成" maxLength={50} />
      </Form.Item>
      {supplierFields}
    </Form>
  );

  return (
    <div>
      <PageHeader
        title="供应商管理"
        description="维护可复用的固定供应商；一次性网购货源写在采购单的「货源说明」里"
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              form.resetFields();
              setCreateOpen(true);
            }}
          >
            新建供应商
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="编码 / 名称"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索供应商"
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          options={[
            { value: 'ACTIVE', label: '启用' },
            { value: 'INACTIVE', label: '停用' },
          ]}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<SupplierRow>
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            showTotal: (total) => `共 ${total} 家`,
            onChange: setPage,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            onDoubleClick: () => setDetailId(record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          emptyTitle="暂无供应商"
          emptyDescription="可复用的固定供应商在这里建档，供采购单与收货单引用。"
          columns={[
            { title: '编码', dataIndex: 'code', key: 'code', width: 110 },
            { title: '名称', dataIndex: 'name', key: 'name' },
            { title: '联系人', dataIndex: 'contactName', key: 'contactName', width: 120 },
            { title: '联系电话', dataIndex: 'contactPhone', key: 'contactPhone', width: 140 },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 90,
              render: (value: string) => (
                <StatusBadge
                  tone={value === 'ACTIVE' ? 'success' : 'neutral'}
                  label={value === 'ACTIVE' ? '启用' : '停用'}
                  hint={value}
                  showDot={false}
                />
              ),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              key: 'createdAt',
              width: 130,
              render: (value: string) => <RelativeTime value={value} />,
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={640}
        title={
          detailRow !== null && (
            <span style={{ fontSize: 16, fontWeight: 650 }}>
              {detailRow.code} · {detailRow.name}
            </span>
          )
        }
        extra={
          detailRow !== null && (
            <StatusBadge
              tone={detailRow.status === 'ACTIVE' ? 'success' : 'neutral'}
              label={detailRow.status === 'ACTIVE' ? '启用' : '停用'}
              hint={detailRow.status}
            />
          )
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== null && (
          <InfoGrid
            columns={2}
            items={[
              { label: '编码', children: detailRow.code },
              { label: '名称', children: detailRow.name },
              { label: '联系人', children: detailRow.contactName ?? '—' },
              { label: '联系电话', children: detailRow.contactPhone ?? '—' },
              { label: '备注', children: detailRow.remark ?? '—', span: 2 },
              { label: '创建时间', children: fmtDateTime(detailRow.createdAt) },
              { label: '更新时间', children: fmtDateTime(detailRow.updatedAt) },
            ]}
          />
        )}
      </Drawer>

      <Modal
        title="新建供应商"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void form.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        {supplierForm}
      </Modal>

      <Modal
        title={`编辑供应商 ${editing?.code ?? ''}`}
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => {
          void editForm.validateFields().then((values) => {
            if (editing !== null) {
              updateMutation.mutate({ id: editing.id, values });
            }
          });
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={editForm}
          layout="vertical"
          preserve={false}
          initialValues={{
            name: editing?.name,
            contactName: editing?.contactName ?? undefined,
            contactPhone: editing?.contactPhone ?? undefined,
            remark: editing?.remark ?? undefined,
          }}
        >
          {supplierFields}
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={deleting !== null}
        title={`删除供应商 ${deleting?.code ?? ''}？`}
        description="仅零引用的供应商可物理删除；被采购单或收货单引用的供应商只能停用。"
        confirmLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            deleteMutation.mutate(deleting.id);
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
