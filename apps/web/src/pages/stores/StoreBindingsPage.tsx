import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { apiDelete, apiPost, useApiQuery } from '../../api/hooks';
import {
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  DeleteConfirmModal,
  EntitySummary,
  FilterBar,
  FULFILLMENT_CATEGORY_LABEL,
  FULFILLMENT_MODE_META,
  PageHeader,
  PlatformTag,
  RailHint,
  SectionCard,
  StatusBadge,
  StatusSwitch,
  colors,
  useContextRail,
} from '../../design-system';

interface BindingRow {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformCode: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  fulfillmentMode: string;
  platformWarehouseId: string | null;
  isInventorySource: boolean;
  isInventoryPushEnabled: boolean;
  priority: number;
  status: string;
}

/** Category display order: seller-side stock first, platform-managed last. */
const FULFILLMENT_CATEGORY_ORDER = ['SELF_MANAGED', 'SEMI_MANAGED', 'MANAGED'];

/**
 * Modes offered for a store: only the ones belonging to its platform (the
 * backend rejects cross-platform combinations), grouped by business category
 * so the seller picks "自管仓 / 半托管 / 托管仓" first and the platform's own
 * mode code second.
 */
function modeOptionsForPlatform(platformCode: string | undefined) {
  return FULFILLMENT_CATEGORY_ORDER.map((category) => ({
    label: FULFILLMENT_CATEGORY_LABEL[category] ?? category,
    options: Object.entries(FULFILLMENT_MODE_META)
      .filter(([, meta]) => meta.platform === platformCode && meta.category === category)
      .map(([mode, meta]) => ({
        value: mode,
        label: `${meta.label} — ${meta.hint}`,
      })),
  })).filter((group) => group.options.length > 0);
}

/** 店仓绑定页 (task §63/§82): store + fulfillment mode + warehouse. */
export function StoreBindingsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [storeId, setStoreId] = useState<string | undefined>(
    () => searchParams.get('storeId') ?? undefined,
  );
  const [warehouseId, setWarehouseId] = useState<string | undefined>(
    () => searchParams.get('warehouseId') ?? undefined,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<BindingRow | null>(null);
  const [form] = Form.useForm();

  const list = useApiQuery<{ data: BindingRow[]; meta: { total: number } }>(
    '/api/v1/warehouse-bindings',
    { page, pageSize: 50, storeId, warehouseId },
    ['bindings', page, storeId, warehouseId],
  );
  const stores = useApiQuery<{
    data: Array<{ id: string; platformCode: string; storeCode: string; name: string }>;
  }>('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-lite']);
  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);

  // Fulfillment modes are platform-specific, so the create form narrows the
  // options to the chosen store's platform (and clears a stale selection).
  const createStoreId = Form.useWatch<string | undefined>('storeId', form);
  const createPlatformCode = (stores.data?.data ?? []).find(
    (store) => store.id === createStoreId,
  )?.platformCode;

  const statusMutation = useMutation({
    mutationFn: ({
      storeId: sid,
      id,
      action,
    }: {
      storeId: string;
      id: string;
      action: 'enable' | 'disable';
    }) =>
      apiPost(
        `/api/v1/stores/{storeId}/warehouse-bindings/{id}/${action}`,
        {},
        { storeId: sid, id },
      ),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['bindings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ storeId: sid, id }: { storeId: string; id: string }) =>
      apiDelete('/api/v1/stores/{storeId}/warehouse-bindings/{id}', { storeId: sid, id }),
    onSuccess: () => {
      void message.success('绑定已删除');
      setDeleting(null);
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['bindings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const createMutation = useMutation({
    mutationFn: (values: {
      storeId: string;
      warehouseId: string;
      fulfillmentMode: string;
      platformWarehouseId?: string;
      isInventoryPushEnabled?: boolean;
      priority?: number;
    }) =>
      apiPost(
        '/api/v1/stores/{storeId}/warehouse-bindings',
        {
          warehouseId: values.warehouseId,
          fulfillmentMode: values.fulfillmentMode,
          platformWarehouseId: values.platformWarehouseId || undefined,
          isInventoryPushEnabled: values.isInventoryPushEnabled,
          priority: values.priority,
        },
        { storeId: values.storeId },
      ),
    onSuccess: () => {
      void message.success('绑定已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['bindings'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

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
          <ContextSection title="绑定概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 条绑定`} />
            <RailHint>点击绑定行查看详情；启停与删除在右栏操作。</RailHint>
          </ContextSection>
        ),
      };
    }
    const modeMeta = FULFILLMENT_MODE_META[selectedRow.fulfillmentMode];
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={`${selectedRow.storeCode} · ${selectedRow.warehouseCode}`}
          subtitle={`${selectedRow.storeName} → ${selectedRow.warehouseName}`}
          badge={
            <StatusBadge
              tone={selectedRow.status === 'ACTIVE' ? 'success' : 'neutral'}
              label={selectedRow.status === 'ACTIVE' ? '启用' : '停用'}
              hint={selectedRow.status}
            />
          }
          meta={<PlatformTag code={selectedRow.platformCode} />}
        />
      ),
      children: (
        <>
          <ContextSection title="绑定信息">
            <ContextMetric
              label="履约模式"
              value={
                modeMeta === undefined
                  ? selectedRow.fulfillmentMode
                  : `${FULFILLMENT_CATEGORY_LABEL[modeMeta.category] ?? modeMeta.category} · ${modeMeta.label}`
              }
            />
            <ContextMetric label="平台仓ID" value={selectedRow.platformWarehouseId ?? '—'} />
            <ContextMetric label="库存来源" value={selectedRow.isInventorySource ? '是' : '否'} />
            <ContextMetric
              label="库存推送"
              value={selectedRow.isInventoryPushEnabled ? '开' : '关'}
            />
            <ContextMetric label="优先级" value={selectedRow.priority} />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="店仓绑定"
              disableHint="停用后该店铺不再从此仓库履约/推送库存"
              loading={statusMutation.isPending}
              onChange={(next) =>
                statusMutation.mutate({
                  storeId: selectedRow.storeId,
                  id: selectedRow.id,
                  action: next ? 'enable' : 'disable',
                })
              }
            />
          </ContextSection>
          <ContextAction>
            <Button block danger onClick={() => setDeleting(selectedRow)}>
              删除
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [selectedRow, list.data, statusMutation.isPending, statusMutation.mutate]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="店仓绑定"
        description="把店铺与履约仓库按平台履约模式绑定；同一仓库可被多个店铺共享"
        primary={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建绑定
          </Button>
        }
      />

      <FilterBar>
        <Select
          allowClear
          placeholder="筛选店铺"
          showSearch
          optionFilterProp="label"
          style={{ width: 220 }}
          value={storeId}
          onChange={(value) => {
            setPage(1);
            setStoreId(value);
          }}
          options={(stores.data?.data ?? []).map((store) => ({
            value: store.id,
            label: `${store.storeCode} · ${store.name}`,
          }))}
        />
        <Select
          allowClear
          placeholder="仓库"
          style={{ width: 220 }}
          showSearch
          optionFilterProp="label"
          value={warehouseId}
          onChange={(value) => {
            setPage(1);
            setWarehouseId(value);
          }}
          options={(warehouses.data?.data ?? []).map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.warehouseCode} ${warehouse.name}`,
          }))}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<BindingRow>
          rowKey="id"
          loading={list.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: list.data?.meta.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条绑定`,
          }}
          scroll={{ x: 1100 }}
          emptyTitle="暂无店仓绑定"
          emptyDescription="新建绑定后，店铺订单同步将按绑定仓库履约。"
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          columns={[
            {
              title: '平台',
              dataIndex: 'platformCode',
              width: 110,
              render: (value: string) => <PlatformTag code={value} />,
            },
            { title: '店铺', dataIndex: 'storeCode' },
            { title: '仓库', dataIndex: 'warehouseCode' },
            { title: '仓库名称', dataIndex: 'warehouseName' },
            {
              title: '履约模式',
              dataIndex: 'fulfillmentMode',
              render: (value: string) => {
                const meta = FULFILLMENT_MODE_META[value];
                if (meta === undefined) {
                  return value;
                }
                return (
                  <Tooltip title={`${meta.label} — ${meta.hint}`}>
                    <span>
                      {FULFILLMENT_CATEGORY_LABEL[meta.category] ?? meta.category}
                      <span style={{ color: colors.textTertiary, marginLeft: 6, fontSize: 12 }}>
                        {meta.label}
                      </span>
                    </span>
                  </Tooltip>
                );
              },
            },
            {
              title: '平台仓ID',
              dataIndex: 'platformWarehouseId',
              render: (v: string | null) => v ?? '—',
            },
            {
              title: '库存来源',
              dataIndex: 'isInventorySource',
              render: (v: boolean) => (v ? '是' : '否'),
              width: 90,
            },
            {
              title: '库存推送',
              dataIndex: 'isInventoryPushEnabled',
              width: 90,
              render: (v: boolean) => (
                <StatusBadge
                  tone={v ? 'info' : 'neutral'}
                  label={v ? '推送' : '不推送'}
                  showDot={false}
                />
              ),
            },
            { title: '优先级', dataIndex: 'priority', width: 80 },
            {
              title: '状态',
              dataIndex: 'status',
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
          ]}
        />
      </SectionCard>

      <Modal
        title="新建店仓绑定"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="storeId" label="店铺" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              onChange={() => form.setFieldValue('fulfillmentMode', undefined)}
              options={(stores.data?.data ?? []).map((store) => ({
                value: store.id,
                label: `${store.storeCode} · ${store.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="warehouseId" label="仓库" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={(warehouses.data?.data ?? []).map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.warehouseCode} ${warehouse.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="fulfillmentMode"
            label="履约模式"
            rules={[{ required: true, message: '请选择履约模式' }]}
            extra="先选店铺：可选模式按该店铺平台的业务类别分组。自管仓＝卖家持货发货，半托管＝备货平台合作仓，托管仓＝平台仓持货发货。"
          >
            <Select
              disabled={createPlatformCode === undefined}
              placeholder={createPlatformCode === undefined ? '请先选择店铺' : '选择履约模式'}
              options={modeOptionsForPlatform(createPlatformCode)}
            />
          </Form.Item>
          <Form.Item name="platformWarehouseId" label="平台仓ID（平台履约时填写）">
            <Input placeholder="如 123456" />
          </Form.Item>
          <Space wrap>
            <Form.Item
              name="isInventoryPushEnabled"
              label="启用库存推送"
              valuePropName="checked"
              initialValue={false}
            >
              <Switch />
            </Form.Item>
            <Form.Item name="priority" label="优先级" initialValue={100}>
              <InputNumber min={0} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <p style={{ color: colors.textTertiary, fontSize: 12.5 }}>
            托管仓（FBO/FBW/FBY）必须绑定平台仓；自管仓与半托管（RFBS/FBS/FBP）绑定自管仓或第三方仓。
          </p>
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={deleting !== null}
        title={`删除绑定 ${deleting?.storeCode ?? ''} · ${deleting?.warehouseCode ?? ''}？`}
        description="删除后该店铺将不能从此仓库履约；已被订单引用的历史不受影响。"
        confirmLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            deleteMutation.mutate({ storeId: deleting.storeId, id: deleting.id });
          }
        }}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
