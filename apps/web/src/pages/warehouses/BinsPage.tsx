import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Form, Input, InputNumber, Modal, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { apiDelete, apiPost, useApiQuery } from '../../api/hooks';
import { printTasksBrowser } from '../../printing/print-browser';
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
  FilterBar,
  PageHeader,
  RailHint,
  SectionCard,
  StatusBadge,
  StatusSwitch,
  useContextRail,
} from '../../design-system';

interface BinRow {
  id: string;
  warehouseId: string;
  binCode: string;
  zone: string | null;
  rack: string | null;
  level: string | null;
  position: string | null;
  barcode: string | null;
  status: string;
}

interface SingleFormValues {
  zone?: string;
  rackNumber: number;
  level: string;
  position?: string;
}

/**
 * Mirrors the server's code rule so a dialog can preview exactly what will be
 * created: the rack is `{zone}{number padded to 2}`, the level stays plain.
 */
function formatRackLabel(zone: string | undefined, rackNumber: number): string {
  return `${zone?.trim() ?? ''}${String(rackNumber).padStart(2, '0')}`;
}

/** Preview for the single-bin dialog. */
function previewSingleBin(warehouseCode: string, values: Partial<SingleFormValues>): string | null {
  const { rackNumber, level } = values;
  const normalizedLevel = level?.trim().replace(/^0+(?=\d)/, '');
  if (rackNumber === undefined || rackNumber < 1 || !normalizedLevel) {
    return null;
  }
  const position = values.position?.trim().replace(/^0+(?=\d)/, '');
  const base = `${warehouseCode}-${formatRackLabel(values.zone, rackNumber)}-${normalizedLevel}`;
  return position ? `${base}-${position}` : base;
}

/** 库位管理 (task §63/§77): pick a warehouse, browse/search/batch-create bins. */
export function BinsPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [zone, setZone] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [deleting, setDeleting] = useState<BinRow | null>(null);
  const [form] = Form.useForm<SingleFormValues>();
  const singleValues = Form.useWatch([], form) as Partial<SingleFormValues> | undefined;

  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);
  const bins = useApiQuery<{ data: BinRow[]; meta: { total: number } }>(
    '/api/v1/warehouses/{warehouseId}/bins',
    {
      page,
      pageSize: 50,
      keyword: keyword || undefined,
      ...(zone ? { zone } : {}),
    },
    ['bins', warehouseId, page, keyword, zone],
    { warehouseId: warehouseId ?? '' },
    warehouseId !== undefined,
  );
  const zones = useApiQuery<{ data: string[] }>(
    '/api/v1/warehouses/{warehouseId}/bins/zones',
    {},
    ['bin-zones', warehouseId],
    { warehouseId: warehouseId ?? '' },
    warehouseId !== undefined,
  );
  const selectedWarehouse = (warehouses.data?.data ?? []).find((item) => item.id === warehouseId);
  const singlePreview =
    selectedWarehouse === undefined || singleValues === undefined
      ? null
      : previewSingleBin(selectedWarehouse.warehouseCode, singleValues);

  const invalidateBins = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    void queryClient.invalidateQueries({ queryKey: ['bin-zones', warehouseId] });
  };

  const createMutation = useMutation({
    // warehouseId is a path parameter; sending it in the body fails validation
    // because the DTO does not declare it (forbidNonWhitelisted).
    mutationFn: ({ warehouseId: wid, ...body }: SingleFormValues & { warehouseId: string }) =>
      apiPost('/api/v1/warehouses/{warehouseId}/bins', body, { warehouseId: wid }),
    onSuccess: () => {
      void message.success('库位已创建');
      setCreateOpen(false);
      form.resetFields();
      invalidateBins();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const binStatusMutation = useMutation({
    mutationFn: ({
      warehouseId: wid,
      binId,
      action,
    }: {
      warehouseId: string;
      binId: string;
      action: 'enable' | 'disable';
    }) =>
      apiPost(
        `/api/v1/warehouses/{warehouseId}/bins/{binId}/${action}`,
        {},
        {
          warehouseId: wid,
          binId,
        },
      ),
    onSuccess: () => {
      void message.success('状态已更新');
      void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const binDeleteMutation = useMutation({
    mutationFn: ({ warehouseId: wid, binId }: { warehouseId: string; binId: string }) =>
      apiDelete('/api/v1/warehouses/{warehouseId}/bins/{binId}', { warehouseId: wid, binId }),
    onSuccess: () => {
      void message.success('库位已删除');
      setDeleting(null);
      setSelectedId(null);
      void queryClient.invalidateQueries({ queryKey: ['bins', warehouseId] });
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const submitCreate = () => {
    if (warehouseId === undefined) {
      void message.error('请先选择仓库');
      return;
    }
    void form.validateFields().then((values) => createMutation.mutate({ ...values, warehouseId }));
  };

  const rows = bins.data?.data ?? [];
  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedRow === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="库位概览">
            <ContextMetric
              label={
                warehouseId === undefined
                  ? '当前筛选'
                  : `${selectedWarehouse?.warehouseCode ?? ''} 库位`
              }
              value={
                warehouseId === undefined ? '请先选择仓库' : `${bins.data?.meta.total ?? 0} 个`
              }
            />
            <RailHint>点击库位行查看详情；启停、打印标签、删除在右栏操作。</RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedRow.binCode}
          subtitle={selectedRow.barcode ?? undefined}
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
          <ContextSection title="库位信息">
            <ContextMetric label="仓库" value={selectedWarehouse?.warehouseCode ?? '—'} />
            <ContextMetric label="库区" value={selectedRow.zone ?? '—'} />
            <ContextMetric label="货架" value={selectedRow.rack ?? '—'} />
            <ContextMetric
              label="层 / 位"
              value={`${selectedRow.level ?? '—'} / ${selectedRow.position ?? '—'}`}
            />
            <StatusSwitch
              active={selectedRow.status === 'ACTIVE'}
              entityName="库位"
              disableHint="停用后不可被收货、拣货选用"
              loading={binStatusMutation.isPending}
              onChange={(next) =>
                binStatusMutation.mutate({
                  warehouseId: selectedRow.warehouseId,
                  binId: selectedRow.id,
                  action: next ? 'enable' : 'disable',
                })
              }
            />
          </ContextSection>
          <ContextAction>
            <Button
              block
              onClick={() =>
                printTasksBrowser([
                  {
                    type: 'BIN_LABEL',
                    payload: { binCode: selectedRow.binCode, copies: 1 },
                  },
                ])
              }
            >
              打印标签
            </Button>
            <Button block danger style={{ marginTop: 8 }} onClick={() => setDeleting(selectedRow)}>
              删除
            </Button>
          </ContextAction>
        </>
      ),
    };
  }, [
    selectedRow,
    selectedWarehouse,
    warehouseId,
    bins.data,
    binStatusMutation.isPending,
    binStatusMutation.mutate,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="库位管理"
        description="按仓库浏览、搜索、新建库位；批量创建使用同一编码规则（仓库-货架-层）"
        secondary={
          <Button disabled={warehouseId === undefined} onClick={() => setBatchOpen(true)}>
            批量创建库位
          </Button>
        }
        primary={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={warehouseId === undefined}
            onClick={() => setCreateOpen(true)}
          >
            新建库位
          </Button>
        }
      />

      <FilterBar>
        <Input.Search
          placeholder="搜索库位编码 / 条码"
          allowClear
          disabled={warehouseId === undefined}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索库位"
        />
        <Select
          placeholder="选择仓库"
          style={{ width: 220 }}
          showSearch
          optionFilterProp="label"
          value={warehouseId}
          onChange={(value) => {
            setPage(1);
            setZone(undefined);
            setSelectedId(null);
            setWarehouseId(value);
          }}
          options={(warehouses.data?.data ?? []).map((warehouse) => ({
            value: warehouse.id,
            label: `${warehouse.warehouseCode} ${warehouse.name}`,
          }))}
        />
        <Select
          allowClear
          placeholder="全部库区"
          style={{ width: 130 }}
          disabled={warehouseId === undefined}
          value={zone}
          onChange={(value: string | undefined) => {
            setPage(1);
            setZone(value);
          }}
          options={(zones.data?.data ?? []).map((item) => ({ value: item, label: item }))}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<BinRow>
          rowKey="id"
          loading={bins.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: bins.data?.meta.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 个库位`,
          }}
          emptyTitle={warehouseId === undefined ? '请先选择仓库' : '暂无库位'}
          emptyDescription={
            warehouseId === undefined
              ? '选择仓库后浏览、搜索或批量创建库位。'
              : '可单个新建或按货架批量创建。'
          }
          onRow={(record) => ({
            onClick: () => setSelectedId(record.id === selectedId ? null : record.id),
            style: {
              cursor: 'pointer',
              background: record.id === selectedId ? colors.primarySoft : undefined,
            },
          })}
          columns={[
            { title: '库位编码', dataIndex: 'binCode' },
            { title: '区', dataIndex: 'zone', width: 70, render: (v: string | null) => v ?? '—' },
            { title: '货架', dataIndex: 'rack', width: 80, render: (v: string | null) => v ?? '—' },
            { title: '层', dataIndex: 'level', width: 70, render: (v: string | null) => v ?? '—' },
            {
              title: '位',
              dataIndex: 'position',
              width: 70,
              render: (v: string | null) => v ?? '—',
            },
            {
              title: '条码',
              dataIndex: 'barcode',
              render: (v: string | null) => v ?? '—',
            },
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
        title="新建库位"
        open={createOpen}
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
          }
        }}
        onCancel={() => setCreateOpen(false)}
        onOk={submitCreate}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Space wrap>
            <Form.Item name="zone" label="库区">
              <Input style={{ width: 100 }} placeholder="如 A" />
            </Form.Item>
            <Form.Item
              name="rackNumber"
              label="货架号"
              rules={[{ required: true, message: '请输入货架号' }]}
            >
              <InputNumber min={1} max={9999} precision={0} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item name="level" label="层" rules={[{ required: true, message: '请输入层号' }]}>
              <Input style={{ width: 80 }} placeholder="1" />
            </Form.Item>
            <Form.Item name="position" label="位（选填）">
              <Input style={{ width: 100 }} placeholder="02" />
            </Form.Item>
          </Space>
          {singlePreview === null ? (
            <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 0 }}>
              货架号为数字，与库区组合成完整货架：区 A + 货架号 3 → 货架 A03 → 编码
              ZG-01-A03-1。批量创建库位使用同一规则。
            </p>
          ) : (
            <div
              style={{
                background: colors.canvas,
                border: `1px solid ${colors.borderSoft}`,
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 13,
                color: colors.textPrimary,
              }}
            >
              将创建：<span style={{ fontFamily: 'monospace' }}>{singlePreview}</span>
            </div>
          )}
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={deleting !== null}
        title={`删除库位 ${deleting?.binCode ?? ''}？`}
        description="仅零引用（无库存/流水）的库位可删除；被引用时会返回具体原因。"
        confirmLoading={binDeleteMutation.isPending}
        onConfirm={() => {
          if (deleting !== null) {
            binDeleteMutation.mutate({ warehouseId: deleting.warehouseId, binId: deleting.id });
          }
        }}
        onCancel={() => setDeleting(null)}
      />

      <BinBatchCreateModal
        open={batchOpen}
        warehouseId={warehouseId ?? null}
        warehouseCode={selectedWarehouse?.warehouseCode ?? ''}
        onClose={() => setBatchOpen(false)}
      />
    </div>
  );
}
