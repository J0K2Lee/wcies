import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tabs,
} from 'antd';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { fmtDateTime } from '../../utils/format';
import { newUuid } from '../../utils/uuid';
import { apiPost, apiPut, useApiQuery } from '../../api/hooks';
import {
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  INVENTORY_STATUS_META,
  InfoGrid,
  KpiRow,
  MetricCard,
  PageHeader,
  RailHint,
  RESERVATION_STATUS_META,
  SectionCard,
  StatusBadge,
  TRANSACTION_TYPE_META,
  colors,
  useContextRail,
  ContextRailContent,
} from '../../design-system';
import {
  AppstoreOutlined,
  ExclamationCircleOutlined,
  InboxOutlined,
  WarningOutlined,
} from '@ant-design/icons';

/**
 * Inventory workbench (redesign task §31-§36): compact KPI row + dense table +
 * risk-focused context rail (default) switching to a SKU summary on row
 * selection. All stock mutations (initialize/adjust/safety/move) are the
 * unchanged Sprint 2 business flows.
 */

/**
 * Staging-bin display hint (Sprint 8 T4b): goods on an ST-zone bin
 * ({warehouse}-{STnn}-{level}) await MOVE_BIN to a sellable rack. Derived
 * display only - it never gates picking or counting.
 */
function isStagingBin(binCode: string): boolean {
  const rack = binCode.split('-')[2] ?? '';
  return /^ST\d+$/.test(rack);
}

interface InventoryRow {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  binId: string;
  binCode: string;
  condition: string;
  onHandQty: string;
  reservedQty: string;
  pickedQty: string;
  physicalAvailableQty: string;
  safetyQty: string;
  sellableAvailableQty: string;
  status: string;
}

interface SkuInventoryDetail {
  skuId: string;
  skuCode: string;
  skuName: string;
  totals: {
    onHandQty: string;
    reservedQty: string;
    pickedQty: string;
    physicalAvailableQty: string;
    safetyQty: string;
    sellableAvailableQty: string;
  };
  bins: InventoryRow[];
}

interface ReservationRow {
  id: string;
  reservationNo: string;
  referenceType: string;
  requestedQty: string;
  status: string;
  createdAt: string;
}

interface TransactionRow {
  id: string;
  transactionType: string;
  warehouseCode: string;
  binCode: string;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
  createdAt: string;
}

type Envelope<T> = { data: T; meta: { total: number } };

/** Form number -> quantity string for the NUMERIC(18,3) wire format. */
const asQty = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const fmtQty = (value: string): string => (Number(value) % 1 === 0 ? String(Number(value)) : value);

type ActionMode = 'initialize' | 'adjust' | 'safety' | 'move';

export function InventoryPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [keyword, setKeyword] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>(() => {
    const fromUrl = searchParams.get('status');
    return fromUrl === 'OUT_OF_STOCK' || fromUrl === 'IN_STOCK' ? fromUrl : undefined;
  });
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<ActionMode | null>(null);
  const [detailSku, setDetailSku] = useState<string | null>(null);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [skuSearch, setSkuSearch] = useState('');
  // Warehouse pickers use server-side keyword search: the warehouse table can
  // hold far more rows than one page of options (test leftovers sort earlier
  // by createdAt DESC), so local filtering on page 1 is not enough.
  const [warehouseSearch, setWarehouseSearch] = useState('');
  const [presetWarehouses, setPresetWarehouses] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [form] = Form.useForm();

  const warehouses = useApiQuery<
    Envelope<Array<{ id: string; warehouseCode: string; name: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 20, keyword: warehouseSearch || undefined }, [
    'warehouses-lite',
    warehouseSearch,
  ]);
  const inventory = useApiQuery<Envelope<InventoryRow[]>>(
    '/api/v1/inventory',
    { page, pageSize: 50, keyword: keyword || undefined, warehouseId, status },
    ['inventory', page, keyword, warehouseId, status],
  );
  // KPI counters (task §33): three light meta.total queries — real numbers only.
  const inStockTotal = useApiQuery<Envelope<unknown[]>>(
    '/api/v1/inventory',
    { page: 1, pageSize: 1, status: 'IN_STOCK' },
    ['inventory-kpi-instock'],
  );
  const outOfStockTotal = useApiQuery<Envelope<unknown[]>>(
    '/api/v1/inventory',
    { page: 1, pageSize: 1, status: 'OUT_OF_STOCK' },
    ['inventory-kpi-oos'],
  );
  const stockExceptions = useApiQuery<Envelope<unknown[]>>(
    '/api/v1/exceptions',
    { page: 1, pageSize: 1, status: 'OPEN', exceptionType: 'ORDER_OUT_OF_STOCK' },
    ['inventory-kpi-exceptions'],
  );
  // Rail: lowest-stock rows among out-of-stock records (real query).
  const oosRows = useApiQuery<Envelope<InventoryRow[]>>(
    '/api/v1/inventory',
    { page: 1, pageSize: 6, status: 'OUT_OF_STOCK' },
    ['inventory-oos-top'],
  );

  // Rail + drawer share one cached detail query per selected SKU (task §68).
  const railSku = selectedSku ?? detailSku;
  const detail = useApiQuery<Envelope<SkuInventoryDetail> & { data: SkuInventoryDetail }>(
    '/api/v1/inventory/skus/{skuId}',
    {},
    ['inventory-detail', railSku],
    railSku === null ? undefined : { skuId: railSku },
    railSku !== null,
  );
  const detailReservations = useApiQuery<Envelope<ReservationRow[]>>(
    '/api/v1/inventory/reservations',
    { skuId: detailSku ?? undefined, pageSize: 50 },
    ['inventory-detail-reservations', detailSku],
    {},
    detailSku !== null,
  );
  const detailTransactions = useApiQuery<Envelope<TransactionRow[]>>(
    '/api/v1/inventory/transactions',
    { skuId: detailSku ?? undefined, pageSize: 50 },
    ['inventory-detail-transactions', detailSku],
    {},
    detailSku !== null,
  );

  // Action-form option sources: SKU search + bins of the selected warehouse.
  const skuOptions = useApiQuery<Envelope<Array<{ id: string; skuCode: string; nameZh: string }>>>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, keyword: skuSearch || undefined },
    ['skus-search', skuSearch],
  );
  const formWarehouseId = Form.useWatch('warehouseId', form);
  const binsOfWarehouse = useApiQuery<Envelope<Array<{ id: string; binCode: string }>>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 100 },
    ['action-bins', formWarehouseId],
    formWarehouseId === undefined ? undefined : { warehouseId: formWarehouseId },
    formWarehouseId !== undefined,
  );

  // Search results first, then preset options (row actions open the modal with
  // a warehouse that may not be in the current search result page).
  const warehouseOptions = (warehouses.data?.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.warehouseCode} ${warehouse.name}`,
  }));
  for (const preset of presetWarehouses) {
    if (!warehouseOptions.some((option) => option.value === preset.value)) {
      warehouseOptions.push(preset);
    }
  }
  const binOptions = (binsOfWarehouse.data?.data ?? []).map((bin) => ({
    value: bin.id,
    label: bin.binCode,
  }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-detail'] });
  };

  /** Rail/block actions share this opener so presets (sku/warehouse) preload. */
  const openRowAction = (mode: ActionMode) => {
    if (selectedRow === null) {
      return;
    }
    openAction(mode, {
      skuId: selectedRow.skuId,
      warehouseId: selectedRow.warehouseId,
      warehouseCode: selectedRow.warehouseCode,
      warehouseName: selectedRow.warehouseName,
      binId: selectedRow.binId,
      fromBinId: selectedRow.binId,
      safetyWarehouseId: selectedRow.warehouseId,
      safetyQty: Number(selectedRow.safetyQty),
    });
  };

  const submitMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const ref = newUuid();
      if (action === 'initialize') {
        return apiPost('/api/v1/inventory/initialize', {
          skuId: values['skuId'],
          warehouseId: values['warehouseId'],
          binId: values['binId'],
          quantity: asQty(values['quantity']),
          referenceType: 'MANUAL',
          referenceId: ref,
          remark: (values['remark'] as string | undefined) ?? null,
          idempotencyKey: `INIT:${ref}`,
        });
      }
      if (action === 'adjust') {
        return apiPost('/api/v1/inventory/adjust', {
          skuId: values['skuId'],
          warehouseId: values['warehouseId'],
          binId: values['binId'],
          quantityDelta: asQty(values['quantityDelta']),
          reason: values['reason'],
          remark: (values['remark'] as string | undefined) ?? null,
          idempotencyKey: `ADJ:${ref}`,
        });
      }
      if (action === 'safety') {
        return apiPut(
          '/api/v1/inventory/safety-stocks/{skuId}/{warehouseId}',
          { safetyQty: asQty(values['safetyQty']) },
          { skuId: String(values['skuId']), warehouseId: String(values['safetyWarehouseId']) },
        );
      }
      return apiPost('/api/v1/inventory/move-bin', {
        skuId: values['skuId'],
        warehouseId: values['warehouseId'],
        fromBinId: values['fromBinId'],
        toBinId: values['toBinId'],
        quantity: asQty(values['quantity']),
        referenceType: 'MANUAL',
        referenceId: ref,
        idempotencyKey: `MOVE:${ref}`,
      });
    },
    onSuccess: () => {
      void message.success('操作成功');
      setAction(null);
      form.resetFields();
      refresh();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const openAction = (mode: ActionMode, preset?: Partial<Record<string, unknown>>) => {
    form.resetFields();
    if (preset !== undefined) {
      form.setFieldsValue(preset);
      const warehouseId = (preset['warehouseId'] ?? preset['safetyWarehouseId']) as
        string | undefined;
      const code = preset['warehouseCode'] as string | undefined;
      if (warehouseId !== undefined && code !== undefined) {
        const label = `${code} ${(preset['warehouseName'] as string | undefined) ?? ''}`.trim();
        setPresetWarehouses((prev) =>
          prev.some((item) => item.value === warehouseId)
            ? prev
            : [...prev, { value: warehouseId, label }],
        );
      }
    }
    setAction(mode);
  };

  const detailRow = detail.data?.data;
  const rows = inventory.data?.data ?? [];
  // One representative row for the selected SKU (rail actions preload from it).
  const selectedRow = rows.find((row) => row.skuId === selectedSku) ?? null;

  // ---- Context rail: stock risk by default, SKU summary on selection ----
  const railContent = useMemo<ContextRailContent>(() => {
    if (selectedSku !== null && detailRow !== undefined && detailRow.skuId === selectedSku) {
      return {
        defaultCollapsed: true,
        header: (
          <EntitySummary
            title={detailRow.skuCode}
            subtitle={detailRow.skuName}
            badge={
              <StatusBadge
                tone={Number(detailRow.totals.sellableAvailableQty) > 0 ? 'success' : 'danger'}
                label={Number(detailRow.totals.sellableAvailableQty) > 0 ? '有可售' : '无可售'}
              />
            }
          />
        ),
        children: (
          <>
            <ContextSection title="库存汇总">
              <ContextMetric label="在库" value={fmtQty(detailRow.totals.onHandQty)} strong />
              <ContextMetric label="已占用" value={fmtQty(detailRow.totals.reservedQty)} />
              <ContextMetric label="已拣货" value={fmtQty(detailRow.totals.pickedQty)} />
              <ContextMetric label="安全库存" value={fmtQty(detailRow.totals.safetyQty)} />
              <ContextMetric
                label="可售"
                value={fmtQty(detailRow.totals.sellableAvailableQty)}
                strong
              />
            </ContextSection>
            <ContextSection title="分布">
              <ContextMetric label="仓库 / 库位" value={`${detailRow.bins.length} 条记录`} />
            </ContextSection>
            <ContextAction>
              <Button block onClick={() => setDetailSku(detailRow.skuId)}>
                查看详情
              </Button>
              <Button block style={{ marginTop: 8 }} onClick={() => openRowAction('adjust')}>
                库存调整
              </Button>
              <Button block style={{ marginTop: 8 }} onClick={() => openRowAction('safety')}>
                安全库存
              </Button>
              <Button block style={{ marginTop: 8 }} onClick={() => openRowAction('move')}>
                库内移位
              </Button>
            </ContextAction>
          </>
        ),
      };
    }
    const oos = oosRows.data?.data ?? [];
    return {
      defaultCollapsed: true,
      children: (
        <>
          <ContextSection title="库存风险">
            <ContextMetric
              label={<span style={{ color: colors.danger }}>缺货记录</span>}
              value={outOfStockTotal.data?.meta.total ?? 0}
              strong
            />
            <ContextMetric label="有可售记录" value={inStockTotal.data?.meta.total ?? 0} />
            <ContextMetric label="缺货异常（订单）" value={stockExceptions.data?.meta.total ?? 0} />
          </ContextSection>
          <ContextSection title="缺货 TOP">
            {oos.length === 0 ? (
              <RailHint>暂无缺货记录</RailHint>
            ) : (
              oos.map((row) => (
                <ContextMetric
                  key={row.id}
                  label={row.skuCode}
                  value={
                    <span style={{ color: colors.danger }}>
                      可售 {fmtQty(row.sellableAvailableQty)}
                    </span>
                  }
                />
              ))
            )}
          </ContextSection>
        </>
      ),
    };
  }, [
    selectedRow,
    selectedSku,
    detailRow,
    oosRows.data,
    outOfStockTotal.data,
    inStockTotal.data,
    stockExceptions.data,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="库存管理"
        description="查看各仓库实时库存、占用、拣货和可售状态；库存调整 / 安全库存 / 库内移位在右侧选中 SKU 后操作"
        primary={
          <Button type="primary" onClick={() => openAction('initialize')}>
            库存初始化
          </Button>
        }
      />

      <KpiRow>
        <MetricCard
          icon={<InboxOutlined />}
          title="库存记录"
          value={inventory.isLoading ? '…' : (inventory.data?.meta.total ?? 0)}
          aux={`${rows.length} 条 / 本页`}
        />
        <MetricCard
          icon={<AppstoreOutlined />}
          title="有可售"
          value={inStockTotal.isLoading ? '…' : (inStockTotal.data?.meta.total ?? 0)}
          aux="有可售库存记录"
        />
        <MetricCard
          icon={<WarningOutlined />}
          title="缺货记录"
          value={outOfStockTotal.isLoading ? '…' : (outOfStockTotal.data?.meta.total ?? 0)}
          aux="无可售库存记录"
        />
        <MetricCard
          icon={<ExclamationCircleOutlined />}
          title="库存异常"
          value={stockExceptions.isLoading ? '…' : (stockExceptions.data?.meta.total ?? 0)}
          aux="未处理缺货异常"
        />
      </KpiRow>

      <FilterBar>
        <Input.Search
          placeholder="搜索 SKU 编码 / 名称"
          allowClear
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
          aria-label="搜索 SKU"
        />
        <Select
          placeholder="仓库"
          allowClear
          showSearch
          filterOption={false}
          onSearch={setWarehouseSearch}
          notFoundContent={warehouses.isLoading ? '搜索中...' : '无匹配仓库'}
          style={{ width: 200 }}
          options={warehouseOptions}
          value={warehouseId}
          onChange={(value) => {
            setPage(1);
            setWarehouseId(value);
          }}
        />
        <Select
          placeholder="可售状态"
          allowClear
          style={{ width: 130 }}
          options={[
            { value: 'IN_STOCK', label: '有可售' },
            { value: 'OUT_OF_STOCK', label: '无可售' },
          ]}
          value={status}
          onChange={(value) => {
            setPage(1);
            setStatus(value);
          }}
        />
      </FilterBar>

      <SectionCard flush>
        <DataTable<InventoryRow>
          rowKey="id"
          loading={inventory.isLoading}
          dataSource={rows}
          pagination={{
            current: page,
            pageSize: 50,
            total: inventory.data?.meta.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条库存记录`,
          }}
          onRow={(record) => ({
            onClick: () => setSelectedSku(record.skuId === selectedSku ? null : record.skuId),
            onDoubleClick: () => setDetailSku(record.skuId),
            style: {
              cursor: 'pointer',
              background: record.skuId === selectedSku ? colors.primarySoft : undefined,
            },
          })}
          scroll={{ x: 1060 }}
          emptyTitle="没有匹配的库存记录"
          columns={[
            {
              title: '商品',
              key: 'sku',
              width: 260,
              render: (_: unknown, record: InventoryRow) => (
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 550, color: colors.textPrimary }}>
                    {record.skuCode}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: colors.textSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {record.skuName}
                  </div>
                </div>
              ),
            },
            {
              title: '仓库',
              dataIndex: 'warehouseCode',
              width: 90,
              render: (value: string, record: InventoryRow) => (
                <span title={record.warehouseName}>{value}</span>
              ),
            },
            {
              title: '库位',
              dataIndex: 'binCode',
              width: 150,
              render: (value: string | null) =>
                value === null ? (
                  <span style={{ color: colors.textTertiary }}>自动（DEFAULT）</span>
                ) : isStagingBin(value) ? (
                  <Space size={4}>
                    <span>{value}</span>
                    <StatusBadge tone="warning" label="待上架" showDot={false} />
                  </Space>
                ) : (
                  value
                ),
            },
            {
              title: '在库',
              dataIndex: 'onHandQty',
              width: 90,
              render: fmtQty,
              align: 'right',
            },
            {
              title: '已占用',
              dataIndex: 'reservedQty',
              width: 95,
              render: fmtQty,
              align: 'right',
            },
            { title: '已拣货', dataIndex: 'pickedQty', width: 80, render: fmtQty, align: 'right' },
            {
              title: '安全库存',
              dataIndex: 'safetyQty',
              width: 80,
              render: fmtQty,
              align: 'right',
            },
            {
              title: '可售',
              dataIndex: 'sellableAvailableQty',
              width: 95,
              align: 'right',
              render: (value: string) => (
                <span style={{ fontWeight: 650, color: colors.textPrimary }}>{fmtQty(value)}</span>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 95,
              render: (value: string) => (
                <StatusBadge
                  tone={INVENTORY_STATUS_META[value]?.tone ?? 'neutral'}
                  label={INVENTORY_STATUS_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
              ),
            },
          ]}
        />
      </SectionCard>

      <Drawer
        open={detailSku !== null}
        onClose={() => setDetailSku(null)}
        size={880}
        title={
          <span style={{ fontSize: 16, fontWeight: 650 }}>
            {detailRow ? `库存详情 · ${detailRow.skuCode}` : '库存详情'}
          </span>
        }
        styles={{ body: { padding: 20 } }}
        destroyOnHidden
      >
        {detailRow !== undefined && (
          <>
            <div style={{ marginBottom: 16 }}>
              <InfoGrid
                items={[
                  { label: '在库', children: fmtQty(detailRow.totals.onHandQty) },
                  { label: '已占用', children: fmtQty(detailRow.totals.reservedQty) },
                  { label: '已拣货', children: fmtQty(detailRow.totals.pickedQty) },
                  { label: '安全库存', children: fmtQty(detailRow.totals.safetyQty) },
                  { label: '实物可售', children: fmtQty(detailRow.totals.physicalAvailableQty) },
                  {
                    label: '渠道可售',
                    children: (
                      <span style={{ fontWeight: 650, color: colors.primary }}>
                        {fmtQty(detailRow.totals.sellableAvailableQty)}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            <Tabs
              items={[
                {
                  key: 'bins',
                  label: `仓库明细 (${detailRow.bins.length})`,
                  children: (
                    <DataTable<InventoryRow>
                      rowKey="id"
                      dataSource={detailRow.bins}
                      pagination={false}
                      emptyTitle="暂无库位记录"
                      columns={[
                        { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
                        { title: '库位', dataIndex: 'binCode', width: 140 },
                        {
                          title: '在库',
                          dataIndex: 'onHandQty',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: '已占用',
                          dataIndex: 'reservedQty',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: '已拣货',
                          dataIndex: 'pickedQty',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: '安全库存',
                          dataIndex: 'safetyQty',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: '可售',
                          dataIndex: 'sellableAvailableQty',
                          align: 'right',
                          render: fmtQty,
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: 'reservations',
                  label: '库存占用',
                  children: (
                    <DataTable<ReservationRow>
                      rowKey="id"
                      dataSource={detailReservations.data?.data ?? []}
                      pagination={false}
                      loading={detailReservations.isLoading}
                      emptyTitle="暂无库存占用"
                      emptyDescription="当前没有订单占用该 SKU 库存。"
                      columns={[
                        { title: '预约号', dataIndex: 'reservationNo', width: 130 },
                        {
                          title: '数量',
                          dataIndex: 'requestedQty',
                          width: 80,
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: '状态',
                          dataIndex: 'status',
                          width: 110,
                          render: (value: string) => (
                            <StatusBadge
                              tone={RESERVATION_STATUS_META[value]?.tone ?? 'neutral'}
                              label={RESERVATION_STATUS_META[value]?.label ?? value}
                              hint={value}
                              showDot={false}
                            />
                          ),
                        },
                        { title: '来源', dataIndex: 'referenceType', width: 90 },
                        { title: '创建时间', dataIndex: 'createdAt', render: fmtDateTime },
                      ]}
                    />
                  ),
                },
                {
                  key: 'transactions',
                  label: '库存流水',
                  children: (
                    <DataTable<TransactionRow>
                      rowKey="id"
                      dataSource={detailTransactions.data?.data ?? []}
                      pagination={false}
                      loading={detailTransactions.isLoading}
                      emptyTitle="暂无库存流水"
                      emptyDescription="该 SKU 尚未发生库存变动。"
                      columns={[
                        {
                          title: '类型',
                          dataIndex: 'transactionType',
                          width: 150,
                          render: (value: string) => (
                            <StatusBadge
                              tone={TRANSACTION_TYPE_META[value]?.tone ?? 'neutral'}
                              label={TRANSACTION_TYPE_META[value]?.label ?? value}
                              hint={value}
                              showDot={false}
                            />
                          ),
                        },
                        { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
                        { title: '库位', dataIndex: 'binCode', width: 140 },
                        {
                          title: '变更前',
                          dataIndex: 'quantityBefore',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: '变更量',
                          dataIndex: 'quantityChange',
                          align: 'right',
                          render: (value: string) => (
                            <span
                              style={{
                                color: Number(value) < 0 ? colors.danger : colors.success,
                                fontWeight: 600,
                              }}
                            >
                              {fmtQty(value)}
                            </span>
                          ),
                        },
                        {
                          title: '变更后',
                          dataIndex: 'quantityAfter',
                          align: 'right',
                          render: fmtQty,
                        },
                        { title: '时间', dataIndex: 'createdAt', render: fmtDateTime },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>

      <Modal
        title={
          action === 'initialize'
            ? '库存初始化（首次上线导入现有库存）'
            : action === 'adjust'
              ? '手工库存调整（危险操作）'
              : action === 'safety'
                ? '安全库存设置（库存策略，不产生流水）'
                : '库内移位'
        }
        open={action !== null}
        onCancel={() => setAction(null)}
        confirmLoading={submitMutation.isPending}
        okText={
          action === 'initialize'
            ? '初始化'
            : action === 'adjust'
              ? '提交调整'
              : action === 'safety'
                ? '保存'
                : '确认移位'
        }
        cancelText="取消"
        footer={
          action === 'move'
            ? [
                <Button key="cancel" onClick={() => setAction(null)}>
                  取消
                </Button>,
                // 库内移位 = L1 轻确认（UI 规范 §7）：同仓移动未占用库存，可逆。
                <Popconfirm
                  key="submit"
                  title="确认执行库内移位？"
                  description="将在同一仓库内移动未占用库存，并写入移库流水。"
                  okText="移位"
                  cancelText="取消"
                  onConfirm={() =>
                    void form.validateFields().then((values) => submitMutation.mutate(values))
                  }
                >
                  <Button type="primary" loading={submitMutation.isPending}>
                    确认移位
                  </Button>
                </Popconfirm>,
              ]
            : undefined
        }
        onOk={() =>
          void form.validateFields().then((values) => {
            if (action === 'adjust') {
              // 手工库存调整 = L2 强确认（UI 规范 §7）：直接改写事实库存。
              modal.confirm({
                title: '二次确认：执行库存调整？',
                content: `调整量 ${String(values['quantityDelta'])}，原因：${String(values['reason'])}。操作将写入库存流水。`,
                okText: '执行调整',
                okButtonProps: { danger: true },
                cancelText: '返回',
                onOk: () => submitMutation.mutate(values),
              });
            } else {
              submitMutation.mutate(values);
            }
          })
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="skuId" label="SKU" rules={[{ required: true, message: '请选择 SKU' }]}>
            <Select
              showSearch
              allowClear
              filterOption={false}
              placeholder="输入 SKU 编码 / 名称搜索"
              onSearch={setSkuSearch}
              notFoundContent={skuOptions.isLoading ? '搜索中...' : '无匹配 SKU'}
              options={(skuOptions.data?.data ?? []).map((sku) => ({
                value: sku.id,
                label: `${sku.skuCode} ${sku.nameZh}`,
              }))}
            />
          </Form.Item>

          {action === 'safety' ? (
            <>
              <Form.Item name="safetyWarehouseId" label="仓库" rules={[{ required: true }]}>
                <Select
                  showSearch
                  filterOption={false}
                  onSearch={setWarehouseSearch}
                  notFoundContent={warehouses.isLoading ? '搜索中...' : '无匹配仓库'}
                  options={warehouseOptions}
                />
              </Form.Item>
              <Form.Item
                name="safetyQty"
                label="安全库存（渠道保护量，不改变在库）"
                rules={[{ required: true }]}
                extra="显示当前值，保存后立即生效"
              >
                <InputNumber min={0} precision={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="warehouseId"
              label="仓库"
              rules={[{ required: true, message: '请选择仓库' }]}
            >
              <Select
                showSearch
                filterOption={false}
                onSearch={setWarehouseSearch}
                notFoundContent={warehouses.isLoading ? '搜索中...' : '无匹配仓库'}
                options={warehouseOptions}
                onChange={() => form.setFieldValue('binId', undefined)}
              />
            </Form.Item>
          )}

          {action === 'initialize' && (
            <>
              <Form.Item
                name="binId"
                label="库位"
                // 仓库已有库位时必选（否则提交才报 INVENTORY_DIMENSION_INVALID，2026-09-18 改为提前拦截）；
                // 无库位仓库可留空（系统自动创建 DEFAULT 虚拟库位）。
                rules={
                  binOptions.length > 0
                    ? [{ required: true, message: '该仓库已有库位，请选择库位' }]
                    : []
                }
                extra="留空时仅允许没有任何库位的仓库（系统自动创建 DEFAULT 虚拟库位）"
              >
                <Select allowClear showSearch optionFilterProp="label" options={binOptions} />
              </Form.Item>
              <Form.Item
                name="quantity"
                label="数量（整数；允许 0：建立零余额记录）"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} precision={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}

          {action === 'adjust' && (
            <>
              <Form.Item name="binId" label="库位" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={binOptions} />
              </Form.Item>
              <Form.Item
                name="quantityDelta"
                label="调整量（+N / -N，不允许 0）"
                rules={[{ required: true }]}
              >
                <InputNumber precision={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="reason" label="原因（必填）" rules={[{ required: true }]}>
                <Input placeholder="如：盘点补录 / 商品损坏" />
              </Form.Item>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}

          {action === 'move' && (
            <>
              <Form.Item name="fromBinId" label="源库位" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={binOptions} />
              </Form.Item>
              <Form.Item name="toBinId" label="目标库位（必须同仓库）" rules={[{ required: true }]}>
                <Select showSearch optionFilterProp="label" options={binOptions} />
              </Form.Item>
              <Form.Item
                name="quantity"
                label="移位数量（不可超过未占用库存）"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} precision={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </div>
  );
}
