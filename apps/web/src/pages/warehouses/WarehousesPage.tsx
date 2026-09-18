import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Button, Checkbox, Drawer, Form, Input, Modal, Select, Space } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import { fmtDateTime } from '../../utils/format';
import { BinBatchCreateModal } from '../../components/BinBatchCreateModal';
import {
  colors,
  ContextAction,
  ContextMetric,
  ContextRailContent,
  ContextSection,
  DataTable,
  DeleteConfirmModal,
  EntitySummary,
  ErrorState,
  FilterBar,
  FULFILLMENT_MODE_META,
  InfoGrid,
  PageHeader,
  PlatformTag,
  RailHint,
  SectionCard,
  StatusBadge,
  StatusSwitch,
  useContextRail,
} from '../../design-system';

/**
 * 仓库管理（用户指示 2026-09-17 改造）：仓库绑定平台仓库（不再是店仓绑定）。
 * - 单击仓库行：展开已绑定的平台仓库 + 右侧边栏显示仓库详情；
 * - 侧边栏操作区：编辑（编码/类型不可改）、绑定平台仓库（备注名）；
 * - 单击展开的平台仓库行：侧边栏显示平台仓库信息 + 删除绑定；
 * - 托管仓（PLATFORM）只允许绑定一个平台仓库（后端强校验）。
 */

interface WarehouseRow {
  id: string;
  warehouseCode: string;
  name: string;
  warehouseType: string;
  countryCode: string | null;
  province: string | null;
  city: string | null;
  address: string | null;
  contactName: string | null;
  contactPhone: string | null;
  remark: string | null;
  status: string;
  binCount: number;
  boundPlatformWarehouseCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BinRow {
  id: string;
  binCode: string;
  zone: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
  barcode: string | null;
  status: string;
}

interface PlatformBindingRow {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  platformWarehouseId: string;
  platformWarehouseName: string | null;
  remarkName: string | null;
  fulfillmentMode: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  platformCode: string;
  priority: number;
  status: string;
  createdAt: string;
}

interface PlatformWarehouseOption {
  platformWarehouseId: string;
  name: string;
  fulfillmentMode: string;
  category: string;
  status: string | null;
  address: string | null;
  partnerName: string | null;
  isActive: boolean | null;
}

const TYPE_LABEL: Record<string, string> = {
  SELF: '自管仓',
  SEMI_MANAGED: '半托管',
  PLATFORM: '托管仓',
  THIRD_PARTY: '第三方仓',
  RETURN_TEMP: '退货暂存仓',
};

/** 与后端 MODE_ALLOWED_WAREHOUSE_TYPES 同源的类型↔履约模式兼容表。 */
const MODE_ALLOWED_WAREHOUSE_TYPES: Record<string, string[]> = {
  OZON_RFBS: ['SELF', 'THIRD_PARTY'],
  OZON_FBS: ['SELF', 'THIRD_PARTY'],
  WB_FBS: ['SELF', 'THIRD_PARTY'],
  YANDEX_FBS: ['SELF', 'THIRD_PARTY'],
  OZON_FBP: ['SEMI_MANAGED'],
  OZON_FBO: ['PLATFORM'],
  WB_FBW: ['PLATFORM'],
  YANDEX_FBY: ['PLATFORM'],
};

type Envelope<T> = { data: T; meta: { total: number } };

export function WarehousesPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [warehouseType, setWarehouseType] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 展开区被点中的平台仓库绑定行（侧边栏切换到平台仓库视图）。 */
  const [selectedBindingId, setSelectedBindingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [bindOpen, setBindOpen] = useState(false);
  const [bindStoreId, setBindStoreId] = useState<string | undefined>();
  // 手动录入兜底（2026-09-18）：WB 目录接口被平台禁用、Yandex FBY 平台仓
  // 不在目录数据源中——目录为空/不可用时允许直接录入平台仓库 ID。
  const [manualBind, setManualBind] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  // Snapshot taken when the batch modal opens so a closing drawer can't blank
  // the path parameter (modal chain fix); the shared modal keeps it too.
  const [batchWarehouse, setBatchWarehouse] = useState<{ id: string; code: string } | null>(null);
  const [deleting, setDeleting] = useState<WarehouseRow | null>(null);
  const [binZone, setBinZone] = useState<string | undefined>();
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [bindForm] = Form.useForm<{
    storeId: string;
    platformWarehouseId: string;
    fulfillmentMode?: string;
    remarkName?: string;
  }>();

  const list = useApiQuery<Envelope<WarehouseRow[]>>(
    '/api/v1/warehouses',
    {
      page,
      pageSize: 50,
      ...(keyword ? { keyword } : {}),
      ...(warehouseType ? { warehouseType } : {}),
    },
    ['warehouses', page, keyword, warehouseType],
  );

  const focusId = selectedId ?? detailId;
  const detail = useApiQuery<{ data: WarehouseRow }>(
    '/api/v1/warehouses/{id}',
    {},
    ['warehouse-detail', focusId],
    { id: focusId ?? '' },
    focusId !== null,
  );
  const warehouse = detail.data?.data;
  const bins = useApiQuery<Envelope<BinRow[]>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 50, ...(binZone ? { zone: binZone } : {}) },
    ['warehouse-bins', detailId, binZone],
    { warehouseId: detailId ?? '' },
    detailId !== null,
  );
  const binZones = useApiQuery<{ data: string[] }>(
    '/api/v1/warehouses/{warehouseId}/bins/zones',
    {},
    ['bin-zones', detailId],
    { warehouseId: detailId ?? '' },
    detailId !== null,
  );
  // 展开区与详情抽屉分别取各自仓库的绑定，避免选中行与抽屉互相干扰。
  const expandedBindings = useApiQuery<Envelope<PlatformBindingRow[]>>(
    '/api/v1/warehouses/{warehouseId}/platform-bindings',
    { page: 1, pageSize: 50 },
    ['warehouse-platform-bindings', selectedId],
    { warehouseId: selectedId ?? '' },
    selectedId !== null,
  );
  const drawerBindings = useApiQuery<Envelope<PlatformBindingRow[]>>(
    '/api/v1/warehouses/{warehouseId}/platform-bindings',
    { page: 1, pageSize: 50 },
    ['warehouse-platform-bindings', detailId],
    { warehouseId: detailId ?? '' },
    detailId !== null,
  );

  // 绑定弹窗：店铺列表 + 选中店铺的平台仓库目录（实时调用平台 API）。
  const storesForBind = useApiQuery<
    Envelope<Array<{ id: string; name: string; storeCode: string; platformCode: string }>>
  >('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-for-bind'], undefined, bindOpen);
  const platformWarehouses = useApiQuery<Envelope<PlatformWarehouseOption[]>>(
    '/api/v1/stores/{storeId}/platform-warehouses',
    {},
    ['platform-warehouses', bindStoreId],
    { storeId: bindStoreId ?? '' },
    bindOpen && bindStoreId !== undefined && bindStoreId !== '',
  );

  const rows = list.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );
  const detailRow = useMemo(
    () => rows.find((row) => row.id === detailId) ?? null,
    [rows, detailId],
  );
  const selectedBinding = useMemo(
    () =>
      (expandedBindings.data?.data ?? []).find((binding) => binding.id === selectedBindingId) ??
      null,
    [expandedBindings.data, selectedBindingId],
  );

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    void queryClient.invalidateQueries({ queryKey: ['warehouse-platform-bindings'] });
    void queryClient.invalidateQueries({ queryKey: ['warehouse-detail'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => apiPost('/api/v1/warehouses', values),
    onSuccess: () => {
      void message.success('仓库已创建');
      setCreateOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, unknown> }) =>
      apiPatch('/api/v1/warehouses/{id}', values, { id }),
    onSuccess: () => {
      void message.success('仓库信息已更新');
      setEditOpen(false);
      refreshAll();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const bindMutation = useMutation({
    mutationFn: ({
      warehouseId,
      values,
    }: {
      warehouseId: string;
      values: Record<string, unknown>;
    }) => apiPost('/api/v1/warehouses/{warehouseId}/platform-bindings', values, { warehouseId }),
    onSuccess: () => {
      void message.success('平台仓库已绑定');
      setBindOpen(false);
      bindForm.resetFields();
      setBindStoreId(undefined);
      setManualBind(false);
      setManualBind(false);
      refreshAll();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const unbindMutation = useMutation({
    mutationFn: (binding: PlatformBindingRow) =>
      apiDelete('/api/v1/warehouses/{warehouseId}/platform-bindings/{bindingId}', {
        warehouseId: binding.warehouseId,
        bindingId: binding.id,
      }),
    onSuccess: (_data, binding) => {
      void message.success(`已解除绑定：${binding.platformWarehouseId}`);
      if (selectedBindingId === binding.id) {
        setSelectedBindingId(null);
      }
      refreshAll();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'deactivate' }) =>
      apiPost(`/api/v1/warehouses/{id}/${action}`, {}, { id }),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/warehouses/{id}', { id }),
    onSuccess: (_data, id) => {
      void message.success('仓库已删除');
      setDeleting(null);
      if (detailId === id) {
        setDetailId(null);
      }
      if (selectedId === id) {
        setSelectedId(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const openEditModal = (row: WarehouseRow) => {
    editForm.setFieldsValue({
      name: row.name,
      warehouseCode: row.warehouseCode,
      warehouseType: TYPE_LABEL[row.warehouseType] ?? row.warehouseType,
      countryCode: row.countryCode,
      province: row.province,
      city: row.city,
      address: row.address,
      contactName: row.contactName,
      contactPhone: row.contactPhone,
      remark: row.remark,
    });
    setEditOpen(true);
  };

  const openBindModal = (row: WarehouseRow) => {
    setBindStoreId(undefined);
    setManualBind(false);
    bindForm.resetFields();
    setBindOpen(true);
    void row;
  };

  const openBatchModal = (warehouseId: string, warehouseCode: string) => {
    setBatchWarehouse({ id: warehouseId, code: warehouseCode });
    setBatchOpen(true);
  };

  const allowedModesOfSelected = selectedRow
    ? new Set(
        Object.entries(MODE_ALLOWED_WAREHOUSE_TYPES)
          .filter(([, types]) => types.includes(selectedRow.warehouseType))
          .map(([mode]) => mode),
      )
    : new Set<string>();

  // ---- Context rail：仓库详情（编辑/绑定）或平台仓库详情（解绑） ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedBinding !== null) {
      const modeMeta = FULFILLMENT_MODE_META[selectedBinding.fulfillmentMode];
      return {
        defaultCollapsed: true,
        header: (
          <EntitySummary
            title={
              selectedBinding.remarkName ??
              selectedBinding.platformWarehouseName ??
              selectedBinding.platformWarehouseId
            }
            subtitle={`平台仓库 ID ${selectedBinding.platformWarehouseId}`}
            badge={
              <StatusBadge
                tone={selectedBinding.status === 'ACTIVE' ? 'success' : 'neutral'}
                label={selectedBinding.status === 'ACTIVE' ? '启用' : '停用'}
                hint={selectedBinding.status}
              />
            }
            meta={
              <PlatformTag code={selectedBinding.platformCode} suffix={selectedBinding.storeName} />
            }
          />
        ),
        children: (
          <>
            <ContextSection title="平台仓库信息">
              <ContextMetric label="平台仓库 ID" value={selectedBinding.platformWarehouseId} />
              {selectedBinding.platformWarehouseName !== null && (
                <ContextMetric label="平台仓库名称" value={selectedBinding.platformWarehouseName} />
              )}
              {selectedBinding.remarkName !== null && (
                <ContextMetric label="备注名" value={selectedBinding.remarkName} />
              )}
              <ContextMetric
                label="履约模式"
                value={
                  modeMeta !== undefined
                    ? `${modeMeta.label} · ${modeMeta.hint}`
                    : selectedBinding.fulfillmentMode
                }
              />
              <ContextMetric
                label="所属店铺"
                value={`${selectedBinding.storeCode} · ${selectedBinding.storeName}`}
              />
              <ContextMetric label="绑定时间" value={fmtDateTime(selectedBinding.createdAt)} />
            </ContextSection>
            <ContextAction>
              <Button
                block
                danger
                loading={unbindMutation.isPending}
                onClick={() => {
                  modal.confirm({
                    title: '解除平台仓库绑定？',
                    content: `将解除 ${selectedBinding.platformWarehouseId}（${selectedBinding.storeName}）与本仓库的绑定。`,
                    okText: '解除绑定',
                    okButtonProps: { danger: true },
                    cancelText: '返回',
                    onOk: () => {
                      unbindMutation.mutate(selectedBinding);
                    },
                  });
                }}
              >
                删除绑定
              </Button>
            </ContextAction>
          </>
        ),
      };
    }
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="仓库概览">
            <ContextMetric label="当前筛选" value={`${list.data?.meta.total ?? 0} 个仓库`} />
            <ContextMetric
              label="库位总数（本页）"
              value={rows.reduce((sum, row) => sum + row.binCount, 0)}
            />
            <RailHint>点击仓库行查看详情、展开平台仓库绑定；双击打开完整档案与库位。</RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.name}
          subtitle={selectedRow.warehouseCode}
          badge={
            <StatusBadge
              tone={selectedRow.status === 'ACTIVE' ? 'success' : 'neutral'}
              label={selectedRow.status === 'ACTIVE' ? '启用' : '停用'}
              hint={selectedRow.status}
            />
          }
          meta={
            <span style={{ fontSize: 13, color: colors.textSecondary }}>
              {TYPE_LABEL[selectedRow.warehouseType] ?? selectedRow.warehouseType}
              {selectedRow.city !== null ? ` · ${selectedRow.city}` : ''}
            </span>
          }
        />
      ),
      children: (
        <>
          <ContextSection title="基本信息">
            <ContextMetric label="仓库编码" value={selectedRow.warehouseCode} />
            <ContextMetric
              label="类型"
              value={TYPE_LABEL[selectedRow.warehouseType] ?? selectedRow.warehouseType}
            />
            <ContextMetric label="国家" value={selectedRow.countryCode ?? '—'} />
            <ContextMetric label="城市" value={selectedRow.city ?? '—'} />
            <ContextMetric label="地址" value={selectedRow.address ?? '—'} />
            <ContextMetric
              label="联系人"
              value={
                selectedRow.contactName === null && selectedRow.contactPhone === null
                  ? '—'
                  : [selectedRow.contactName, selectedRow.contactPhone]
                      .filter((part) => part !== null)
                      .join(' · ')
              }
            />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="仓库"
              disableHint="停用后不可被订单分配与收货选用"
              loading={statusMutation.isPending}
              onChange={(next) =>
                statusMutation.mutate({
                  id: selectedRow.id,
                  action: next ? 'activate' : 'deactivate',
                })
              }
            />
          </ContextSection>
          <ContextSection title="绑定与库存">
            <ContextMetric
              label="平台仓库"
              value={`${selectedRow.boundPlatformWarehouseCount} 个`}
              strong
            />
            <ContextMetric label="库位数量" value={selectedRow.binCount} />
            {selectedRow.warehouseType === 'PLATFORM' &&
              selectedRow.boundPlatformWarehouseCount >= 1 && (
                <RailHint>托管仓只能绑定一个平台仓库（已绑定）。</RailHint>
              )}
          </ContextSection>
          <ContextAction>
            <Button block type="primary" onClick={() => openEditModal(selectedRow)}>
              编辑
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => openBindModal(selectedRow)}>
              绑定平台仓库
            </Button>
            <Button block style={{ marginTop: 8 }} onClick={() => setDetailId(selectedRow.id)}>
              查看详情与库位
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    selectedBinding,
    list.data,
    rows,
    statusMutation.isPending,
    statusMutation.mutate,
    unbindMutation.isPending,
    unbindMutation.mutate,
    modal,
  ]);
  useContextRail(railContent);

  const bindingColumns = [
    {
      title: '平台仓库 ID',
      dataIndex: 'platformWarehouseId',
      width: 190,
      render: (value: string, row: PlatformBindingRow) => (
        <div>
          <div style={{ fontWeight: 550, wordBreak: 'break-all' as const }}>{value}</div>
          <div style={{ fontSize: 12, color: colors.textTertiary }}>
            {row.remarkName ?? row.platformWarehouseName ?? ''}
          </div>
        </div>
      ),
    },
    {
      title: '店铺',
      key: 'store',
      render: (_: unknown, row: PlatformBindingRow) => (
        <PlatformTag code={row.platformCode} suffix={row.storeName} />
      ),
    },
    {
      title: '履约模式',
      dataIndex: 'fulfillmentMode',
      width: 110,
      render: (value: string) => FULFILLMENT_MODE_META[value]?.label ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (value: string) => (
        <StatusBadge
          tone={value === 'ACTIVE' ? 'success' : 'neutral'}
          label={value === 'ACTIVE' ? '启用' : '停用'}
          hint={value}
          showDot={false}
        />
      ),
    },
  ];

  const warehouseTableColumns = [
    {
      title: '仓库',
      key: 'warehouse',
      render: (_: unknown, row: WarehouseRow) => (
        <div>
          <div style={{ fontWeight: 550 }}>{row.name}</div>
          <div style={{ fontSize: 12.5, color: colors.textTertiary }}>{row.warehouseCode}</div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'warehouseType',
      key: 'type',
      width: 110,
      render: (value: string) => TYPE_LABEL[value] ?? value,
    },
    {
      title: '国家',
      dataIndex: 'countryCode',
      key: 'country',
      width: 76,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '城市',
      dataIndex: 'city',
      key: 'city',
      width: 110,
      render: (v: string | null) => v ?? '—',
    },
    {
      title: '库位',
      dataIndex: 'binCount',
      key: 'bins',
      width: 80,
      align: 'right' as const,
    },
    {
      title: '平台仓库',
      dataIndex: 'boundPlatformWarehouseCount',
      key: 'platformWarehouses',
      width: 96,
      align: 'right' as const,
    },
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
  ];

  return (
    <div>
      <PageHeader
        title="仓库管理"
        description="仓库档案、库位与平台仓库绑定（自管 / 半托管 / 托管）"
        secondary={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['warehouses'] })}
          >
            刷新
          </Button>
        }
        primary={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建仓库
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="搜索仓库编码 / 名称 / 城市"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 260 }}
          aria-label="搜索仓库"
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 140 }}
          value={warehouseType}
          onChange={(value) => {
            setPage(1);
            setWarehouseType(value);
          }}
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </FilterBar>

      <SectionCard flush>
        {list.isError ? (
          <ErrorState
            description={(list.error as Error | null)?.message}
            onRetry={() => void queryClient.invalidateQueries({ queryKey: ['warehouses'] })}
            retrying={list.isFetching}
          />
        ) : (
          <DataTable<WarehouseRow>
            rowKey="id"
            loading={list.isLoading}
            dataSource={rows}
            emptyTitle="暂无仓库"
            emptyDescription="点击右上角新建仓库"
            pagination={{
              current: page,
              pageSize: 50,
              total: list.data?.meta.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            expandable={{
              // 单击行即展开平台仓库绑定（用户指示 2026-09-17）。
              expandedRowKeys: selectedId === null ? [] : [selectedId],
              showExpandColumn: false,
              expandedRowRender: (_record: WarehouseRow) => {
                if (expandedBindings.isLoading) {
                  return (
                    <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                      平台仓库绑定加载中…
                    </span>
                  );
                }
                return (
                  <div onClick={(event) => event.stopPropagation()}>
                    <DataTable<PlatformBindingRow>
                      size="small"
                      rowKey="id"
                      dataSource={expandedBindings.data?.data ?? []}
                      pagination={false}
                      emptyTitle="暂无平台仓库绑定"
                      emptyDescription="点击右侧边栏「绑定平台仓库」"
                      columns={bindingColumns}
                      onRow={(binding) => ({
                        onClick: () => {
                          setSelectedBindingId(
                            binding.id === selectedBindingId ? null : binding.id,
                          );
                        },
                        style: {
                          cursor: 'pointer',
                          background:
                            binding.id === selectedBindingId ? colors.primarySoft : undefined,
                        },
                      })}
                    />
                  </div>
                );
              },
            }}
            onRow={(record) => ({
              onClick: () => {
                setSelectedBindingId(null);
                setSelectedId(record.id === selectedId ? null : record.id);
              },
              onDoubleClick: () => setDetailId(record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedId ? colors.primarySoft : undefined,
              },
            })}
            columns={warehouseTableColumns}
          />
        )}
      </SectionCard>

      {/* ---- Create warehouse modal (existing flow) ---- */}
      <Modal
        title="新建仓库"
        open={createOpen}
        zIndex={1100}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void form.validateFields().then((values) => createMutation.mutate(values))}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
            仓库编码创建后自动生成（按类型递增：ZG/BT/PT/SF/TH-序号），类型创建后不可修改。
          </p>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input placeholder="如 深圳自管仓" />
          </Form.Item>
          <Form.Item
            name="warehouseType"
            label="类型"
            rules={[{ required: true }]}
            initialValue="SELF"
            extra="自管仓绑定 rFBS/FBS 平台仓库；半托管绑定 FBP；托管仓绑定 FBO（仅一个）"
          >
            <Select
              options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Space wrap>
            <Form.Item name="countryCode" label="国家">
              <Input style={{ width: 100 }} placeholder="CN" />
            </Form.Item>
            <Form.Item name="province" label="省份">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="联系人">
            <Input style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="contactPhone" label="联系电话">
            <Input style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Edit warehouse modal：编码/类型只读（用户指示 2026-09-17） ---- */}
      <Modal
        title="编辑仓库"
        open={editOpen}
        zIndex={1100}
        onCancel={() => setEditOpen(false)}
        onOk={() => {
          void editForm
            .validateFields()
            .then(
              ({ name, countryCode, province, city, address, contactName, contactPhone, remark }) =>
                editMutation.mutate({
                  id: selectedRow?.id ?? detailRow?.id ?? '',
                  values: {
                    name,
                    countryCode,
                    province,
                    city,
                    address,
                    contactName,
                    contactPhone,
                    remark,
                  },
                }),
            );
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={editMutation.isPending}
      >
        <Form form={editForm} layout="vertical">
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
            仓库编码与类型不可修改；名称、地址、联系人、联系电话可随时修改。
          </p>
          <Space wrap>
            <Form.Item name="warehouseCode" label="仓库编码（不可修改）">
              <Input disabled style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="warehouseType" label="类型（不可修改）">
              <Input disabled style={{ width: 140 }} />
            </Form.Item>
          </Space>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Space wrap>
            <Form.Item name="countryCode" label="国家">
              <Input style={{ width: 100 }} />
            </Form.Item>
            <Form.Item name="province" label="省份">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="city" label="城市">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Space>
          <Form.Item name="address" label="地址">
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label="联系人">
            <Input style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="contactPhone" label="联系电话">
            <Input style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- 绑定平台仓库弹窗（用户指示 2026-09-17） ---- */}
      <Modal
        title={`绑定平台仓库：${selectedRow?.name ?? selectedRow?.warehouseCode ?? ''}`}
        open={bindOpen}
        zIndex={1100}
        onCancel={() => {
          setBindOpen(false);
          setBindStoreId(undefined);
          setManualBind(false);
          setManualBind(false);
          setManualBind(false);
          bindForm.resetFields();
        }}
        onOk={() => {
          void bindForm.validateFields().then((values) => {
            if (manualBind) {
              // 手动录入：平台仓库 ID 由操作者提供（目录缺失兜底）。
              bindMutation.mutate({
                warehouseId: selectedRow?.id ?? detailRow?.id ?? '',
                values: {
                  storeId: values.storeId,
                  platformWarehouseId: String(values.platformWarehouseId).trim(),
                  fulfillmentMode: values.fulfillmentMode,
                  remarkName: values.remarkName,
                },
              });
              return;
            }
            const option = (platformWarehouses.data?.data ?? []).find(
              (candidate) => candidate.platformWarehouseId === values.platformWarehouseId,
            );
            if (option === undefined) {
              void message.error('请选择平台仓库');
              return;
            }
            bindMutation.mutate({
              warehouseId: selectedRow?.id ?? detailRow?.id ?? '',
              values: {
                storeId: values.storeId,
                platformWarehouseId: option.platformWarehouseId,
                platformWarehouseName: option.name,
                fulfillmentMode: option.fulfillmentMode,
                remarkName: values.remarkName,
              },
            });
          });
        }}
        okText="绑定"
        cancelText="取消"
        confirmLoading={bindMutation.isPending}
      >
        <Form form={bindForm} layout="vertical">
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 12 }}>
            平台仓库目录实时取自平台 API。仓库类型只能绑定对应的履约模式： 自管仓 → rFBS /
            FBS；半托管 → FBP；托管仓 → FBO（仅一个）。
          </p>
          <Form.Item
            name="storeId"
            label="店铺"
            rules={[{ required: true, message: '请选择店铺' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="平台仓库归属的店铺"
              options={(storesForBind.data?.data ?? []).map((store) => ({
                value: store.id,
                label: `${store.storeCode} · ${store.name}（${store.platformCode}）`,
              }))}
              onChange={(value: string) => {
                setBindStoreId(value);
                setManualBind(false);
              }}
            />
          </Form.Item>
          <Form.Item>
            <Checkbox
              checked={manualBind}
              disabled={bindStoreId === undefined || bindStoreId === ''}
              onChange={(e) => setManualBind(e.target.checked)}
            >
              平台仓库不在目录中（如 WB 目录接口未开放、Yandex FBY 平台仓）——手动录入
            </Checkbox>
          </Form.Item>
          {manualBind ? (
            <>
              <Form.Item
                name="platformWarehouseId"
                label="平台仓库 ID"
                rules={[
                  { required: true, message: '请输入平台仓库 ID' },
                  { min: 1, max: 64, message: '长度 1-64 字符' },
                ]}
                extra="从平台卖家后台复制的仓库 ID；绑定后可用备注名标记用途。"
              >
                <Input placeholder="如 2327243" maxLength={64} />
              </Form.Item>
              <Form.Item
                name="fulfillmentMode"
                label="履约模式"
                rules={[{ required: true, message: '请选择履约模式' }]}
              >
                <Select
                  options={Object.entries(FULFILLMENT_MODE_META)
                    .filter(([mode]) => {
                      const platformCode = (storesForBind.data?.data ?? []).find(
                        (store) => store.id === bindStoreId,
                      )?.platformCode;
                      if (platformCode !== undefined && !mode.startsWith(`${platformCode}_`)) {
                        return false;
                      }
                      return allowedModesOfSelected.size === 0 || allowedModesOfSelected.has(mode);
                    })
                    .map(([mode, meta]) => ({ value: mode, label: meta.label }))}
                  placeholder="选择该平台仓库的履约模式"
                />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="platformWarehouseId"
              label="平台仓库"
              rules={[{ required: true, message: '请选择平台仓库' }]}
              extra={
                selectedRow !== null && allowedModesOfSelected.size === 0
                  ? '当前仓库类型（退货暂存仓）不支持绑定平台仓库'
                  : undefined
              }
            >
              <Select
                showSearch
                optionFilterProp="label"
                loading={platformWarehouses.isLoading}
                disabled={bindStoreId === undefined || bindStoreId === ''}
                placeholder={
                  bindStoreId === undefined || bindStoreId === ''
                    ? '请先选择店铺'
                    : platformWarehouses.isLoading
                      ? '平台仓库加载中…'
                      : (platformWarehouses.data?.data ?? []).length === 0
                        ? '目录为空——可勾选上方手动录入'
                        : '选择平台仓库'
                }
                options={(platformWarehouses.data?.data ?? []).map((option) => {
                  const allowed = allowedModesOfSelected.has(option.fulfillmentMode);
                  const meta = FULFILLMENT_MODE_META[option.fulfillmentMode];
                  return {
                    value: option.platformWarehouseId,
                    label: `${option.name} · ${meta?.label ?? option.fulfillmentMode}（${
                      TYPE_LABEL[selectedRow?.warehouseType ?? ''] ?? selectedRow?.warehouseType
                    }${allowed ? '' : '·类型不符'}）`,
                    disabled: !allowed,
                  };
                })}
              />
            </Form.Item>
          )}
          <Form.Item name="remarkName" label="备注名（选填）">
            <Input maxLength={255} placeholder="如 俄东主仓" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ---- Warehouse detail drawer ---- */}
      <Drawer
        title={detailRow !== null ? `${detailRow.name}（${detailRow.warehouseCode}）` : '仓库详情'}
        size={760}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        destroyOnHidden
        extra={
          detailRow !== null && (
            <Space>
              <Button size="small" onClick={() => openEditModal(detailRow)}>
                编辑
              </Button>
              <Button size="small" onClick={() => openBindModal(detailRow)}>
                绑定平台仓库
              </Button>
              <Button size="small" danger onClick={() => setDeleting(detailRow)}>
                删除
              </Button>
            </Space>
          )
        }
      >
        {detailRow !== null && (
          <Space orientation="vertical" size="large" style={{ width: '100%' }}>
            <section>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  marginBottom: 10,
                }}
              >
                基本信息
              </div>
              <InfoGrid
                columns={2}
                items={[
                  { label: '仓库编码', children: detailRow.warehouseCode },
                  { label: '名称', children: detailRow.name },
                  {
                    label: '类型',
                    children: TYPE_LABEL[detailRow.warehouseType] ?? detailRow.warehouseType,
                  },
                  {
                    label: '状态',
                    children: (
                      <StatusBadge
                        tone={detailRow.status === 'ACTIVE' ? 'success' : 'neutral'}
                        label={detailRow.status === 'ACTIVE' ? '启用' : '停用'}
                        hint={detailRow.status}
                        showDot={false}
                      />
                    ),
                  },
                  {
                    label: '国家 / 城市',
                    children: `${detailRow.countryCode ?? '—'} / ${detailRow.city ?? '—'}`,
                  },
                  { label: '地址', children: detailRow.address ?? '—' },
                  { label: '联系人', children: detailRow.contactName ?? '—' },
                  { label: '联系电话', children: detailRow.contactPhone ?? '—' },
                  { label: '创建时间', children: fmtDateTime(detailRow.createdAt) },
                  { label: '库位数量', children: `${detailRow.binCount}` },
                ]}
              />
            </section>

            <section>
              <div
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: colors.textPrimary,
                  marginBottom: 10,
                }}
              >
                平台仓库绑定
              </div>
              <DataTable<PlatformBindingRow>
                rowKey="id"
                size="small"
                loading={drawerBindings.isLoading}
                dataSource={drawerBindings.data?.data ?? []}
                pagination={false}
                emptyTitle="暂无平台仓库绑定"
                columns={bindingColumns}
              />
            </section>

            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary }}>
                  库位（{warehouse?.binCount ?? bins.data?.meta.total ?? 0}）
                </span>
                {
                  <Space>
                    <Select
                      size="small"
                      allowClear
                      placeholder="全部库区"
                      style={{ width: 120 }}
                      value={binZone}
                      onChange={(value: string | undefined) => setBinZone(value)}
                      options={(binZones.data?.data ?? []).map((zone) => ({
                        value: zone,
                        label: zone,
                      }))}
                    />
                    <Button
                      size="small"
                      type="primary"
                      onClick={() =>
                        detailRow !== null && openBatchModal(detailRow.id, detailRow.warehouseCode)
                      }
                    >
                      批量创建库位
                    </Button>
                  </Space>
                }
              </div>
              <DataTable<BinRow>
                rowKey="id"
                size="small"
                loading={bins.isLoading}
                dataSource={bins.data?.data ?? []}
                pagination={{ pageSize: 20, showSizeChanger: false }}
                emptyTitle="暂无库位"
                columns={[
                  { title: '库位编码', dataIndex: 'binCode' },
                  {
                    title: '区',
                    dataIndex: 'zone',
                    width: 70,
                    render: (v: string | null) => v ?? '—',
                  },
                  {
                    title: '架',
                    dataIndex: 'rack',
                    width: 80,
                    render: (v: string | null) => v ?? '—',
                  },
                  {
                    title: '层',
                    dataIndex: 'level',
                    width: 70,
                    render: (v: string | null) => v ?? '—',
                  },
                  { title: '条码', dataIndex: 'barcode', render: (v: string | null) => v ?? '—' },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 80,
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
            </section>
          </Space>
        )}
      </Drawer>

      {/* ---- Delete confirm (L2, shared DS modal) ---- */}
      <DeleteConfirmModal
        open={deleting !== null}
        title={`删除仓库 ${deleting?.name ?? ''}？`}
        description="仅零引用（无库位/绑定/库存）的仓库可删除；被引用时会返回具体原因。"
        confirmLoading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            deleteMutation.mutate(deleting.id);
          }
        }}
        onCancel={() => setDeleting(null)}
      />

      {/* ---- Batch create bins: shared dialog (G9) ---- */}
      <BinBatchCreateModal
        open={batchOpen}
        warehouseId={batchWarehouse?.id ?? null}
        warehouseCode={batchWarehouse?.code ?? ''}
        zIndex={1100}
        onClose={() => setBatchOpen(false)}
      />
    </div>
  );
}
