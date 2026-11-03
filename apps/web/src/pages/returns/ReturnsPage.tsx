import { useCallback, useMemo, useState } from 'react';
import { fmtQty } from '../../utils/format';
import {
  App as AntdApp,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Tabs,
  Tooltip,
} from 'antd';
import { CloudSyncOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';
import {
  ActionIsland,
  ContextAction,
  ContextMetric,
  ContextSection,
  DataTable,
  EntitySummary,
  FilterBar,
  PageHeader,
  RailHint,
  ScanFeedback,
  ScanFeedbackData,
  RETURN_BATCH_STATUS_META,
  RETURN_CONDITION_META,
  SectionCard,
  StatusBadge,
  colors,
  RelativeTime,
  useContextRail,
  ContextRailContent,
} from '../../design-system';

/**
 * Returns workbench (dual-axis T5, docs/business-rules/returns.md):
 *
 * - Tab 1 platform return records: pull-only facts from the platform
 *   (manual sync). Unlinked rows (no batch line yet) are the reconciliation
 *   to-do list; unknown order references surface as RETURN_ORDER_NOT_FOUND
 *   in the exception center.
 * - Tab 2 return batches: the physical work documents. Create (optionally
 *   from pending platform records) -> receive -> per-line inspection
 *   (SELLABLE/DEFECTIVE/LOST - inspection is the only stock write-back).
 */

type Envelope<T> = { data: T; meta: { total: number } };

interface PlatformReturnRow {
  id: string;
  storeId: string;
  platformReturnId: string;
  platformOrderId: string | null;
  orderId: string | null;
  state: string | null;
  refundState: string | null;
  platformSkuId: string | null;
  offerId: string | null;
  /** 店铺内解析出的内部 SKU（未映射为 null）。 */
  skuCode: string | null;
  skuName: string | null;
  /** 已消费该记录的对账批次号。 */
  batchNo: string | null;
  batchStatus: string | null;
  quantity: string;
  platformCreatedAt: string | null;
  createdAt: string;
}

interface ReturnBatchItemRow {
  id: string;
  batchId: string;
  platformReturnId: string | null;
  platformReturnNo: string | null;
  skuId: string;
  skuCode: string;
  skuName: string;
  serialTracking: boolean;
  quantity: string;
  condition: string;
  binId: string | null;
  binCode: string | null;
  /** 扫码已扫到的序列号（SN 商品，扫满数量才入库）。 */
  receivedSerialNumbers: string[];
  remark: string | null;
}

interface ReturnBatchRow {
  id: string;
  batchNo: string;
  warehouseId: string;
  status: string;
  sourceNote: string | null;
  itemCount: number;
  /** 待检验（还没回库处理）的行数。 */
  pendingItems: number;
  createdAt: string;
}

interface ReturnBatchDetail extends ReturnBatchRow {
  items: ReturnBatchItemRow[];
}

/** 建批弹窗的明细草稿：平台记录行或人工行（skuId 必填）。 */
interface BatchItemDraft {
  platformReturnId?: string;
  skuId?: string;
  quantity: string;
}

const BATCH_STATUS_META = RETURN_BATCH_STATUS_META;
const CONDITION_META = RETURN_CONDITION_META;

export function ReturnsPage() {
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('platform');
  const [storeId, setStoreId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [platformPage, setPlatformPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  /** 平台退货记录选中态：右栏承载「用此记录建批次」，主表行内不放按钮。 */
  const [selectedReturnId, setSelectedReturnId] = useState<string | null>(null);
  /** 平台退货记录：搜索 / 入批状态筛选 / 多选批量建批（2026-11-03）。 */
  const [platformKeyword, setPlatformKeyword] = useState('');
  /** 处理阶段（2026-11-04 用户口径）：默认只看待处理。 */
  const [stage, setStage] = useState<'PENDING' | 'PROCESSING' | 'COMPLETED'>('PENDING');
  const [selectedReturnIds, setSelectedReturnIds] = useState<string[]>([]);
  /** 退货批次：搜索 / 状态筛选 / 多选批量确认收货。 */
  const [batchKeyword, setBatchKeyword] = useState('');
  const [batchStatus, setBatchStatus] = useState<string | undefined>();
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  /** 扫码入库（2026-11-04）：条码 / 序列号 / 目标库位 / 最近一次结果。 */
  const [scanBarcode, setScanBarcode] = useState('');
  const [scanSerial, setScanSerial] = useState('');
  const [scanBinId, setScanBinId] = useState<string | undefined>();
  const [scanFeedback, setScanFeedback] = useState<ScanFeedbackData | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  /** 建批确认框里的明细（来自勾选的平台记录，不再手工编辑）。 */
  const [createItems, setCreateItems] = useState<BatchItemDraft[]>([]);
  const [createForm] = Form.useForm<{ warehouseId: string; sourceNote?: string }>();

  const storesQuery = useApiQuery<
    Envelope<Array<{ id: string; name: string; storeCode: string; platformCode: string }>>
  >('/api/v1/stores', { page: 1, pageSize: 100 }, ['stores-for-returns']);

  const warehousesQuery = useApiQuery<
    Envelope<Array<{ id: string; name: string; warehouseCode: string }>>
  >('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-for-returns']);

  const platformReturns = useApiQuery<Envelope<PlatformReturnRow[]>>(
    '/api/v1/returns/platform',
    {
      page: platformPage,
      pageSize: 50,
      ...(storeId ? { storeId } : {}),
      stage,
      ...(platformKeyword.trim() === '' ? {} : { keyword: platformKeyword.trim() }),
    },
    ['platform-returns', platformPage, storeId, stage, platformKeyword],
  );

  /** Pending reconciliation: records no batch line consumed yet. */
  const pendingReturns = useApiQuery<Envelope<PlatformReturnRow[]>>(
    '/api/v1/returns/platform',
    { page: 1, pageSize: 100, linked: 'false', ...(storeId ? { storeId } : {}) },
    ['platform-returns-pending', storeId],
  );

  const batches = useApiQuery<Envelope<ReturnBatchRow[]>>(
    '/api/v1/returns/batches',
    {
      page,
      pageSize: 20,
      ...(batchStatus === undefined ? {} : { status: batchStatus }),
      ...(batchKeyword.trim() === '' ? {} : { keyword: batchKeyword.trim() }),
    },
    ['return-batches', page, batchStatus, batchKeyword],
  );

  const detailQuery = useApiQuery<Envelope<ReturnBatchDetail>>(
    '/api/v1/returns/batches/{id}',
    {},
    ['return-batch-detail', detailId],
    detailId === null ? undefined : { id: detailId },
    detailId !== null,
  );
  const detail = detailId !== null ? detailQuery.data?.data : undefined;

  /** 扫码落库的库位候选（该批次收货仓库；留空 = STAGING 暂存位）。 */
  const binsQuery = useApiQuery<Envelope<Array<{ id: string; binCode: string }>>>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 200 },
    ['return-batch-bins', detail?.warehouseId],
    detail === undefined ? undefined : { warehouseId: detail.warehouseId },
    detail !== undefined,
  );
  const binOptions = (binsQuery.data?.data ?? []).map((bin) => ({
    value: bin.id,
    label: bin.binCode,
  }));

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform-returns'] });
    void queryClient.invalidateQueries({ queryKey: ['return-batches'] });
    void queryClient.invalidateQueries({ queryKey: ['return-batch-detail'] });
    void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
  };

  const syncMutation = useMutation({
    mutationFn: () =>
      apiPost<{ created: number; unlinkable: number }>('/api/v1/returns/platform/sync', {
        storeId,
      }),
    onSuccess: (result) => {
      message.success(
        `同步完成：新增 ${result.created} 条${result.unlinkable > 0 ? `，${result.unlinkable} 条无法关联订单（已建异常）` : ''}`,
      );
      invalidateAll();
    },
    onError: (error: Error) => message.error(`同步失败：${error.message}`),
  });

  const createMutation = useMutation({
    mutationFn: (values: { warehouseId: string; sourceNote?: string; items: BatchItemDraft[] }) =>
      apiPost<ReturnBatchDetail>('/api/v1/returns/batches', values),
    onSuccess: (result) => {
      message.success(`退货批次已创建：${result.batchNo}，请确认收货后逐行检验`);
      setCreateOpen(false);
      createForm.resetFields();
      invalidateAll();
      // 创建后直接落到批次详情，避免运营在页签之间找单据（2026-11-03）。
      setActiveTab('batches');
      setSelectedReturnId(null);
      setSelectedReturnIds([]);
      setDetailId(result.id);
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
  });

  /**
   * 打开建批确认框：明细直接取勾选的平台记录（用户 2026-11-04：不再保留
   * 长列表弹窗，选完就建批；SKU 由后端按店铺解析）。
   */
  const openCreateBatch = useCallback(
    (prefill?: PlatformReturnRow | PlatformReturnRow[]): void => {
      const records = prefill === undefined ? [] : Array.isArray(prefill) ? prefill : [prefill];
      setCreateItems(
        records.map((row) => ({
          platformReturnId: row.id,
          quantity: row.quantity || '1',
        })),
      );
      createForm.setFieldsValue({
        warehouseId: warehousesQuery.data?.data[0]?.id,
        sourceNote:
          records.length === 0
            ? undefined
            : records.length === 1
              ? `平台退货 ${records[0]!.platformReturnId}（${records[0]!.platformOrderId ?? '无订单号'}）`
              : `平台退货批量：${records.length} 条`,
      });
      setCreateOpen(true);
    },
    [createForm, warehousesQuery.data],
  );

  const receiveMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<ReturnBatchRow>(`/api/v1/returns/batches/{id}/receive`, {}, { id }),
    onSuccess: (result) => {
      message.success(`批次 ${result.batchNo} 已确认收货，可开始检验`);
      invalidateAll();
    },
    onError: (error: Error) => message.error(`收货失败：${error.message}`),
  });

  /** 批量确认收货（2026-11-03）：逐张推进，单张失败不影响其它，最后汇总结果。 */
  const receiveManyMutation = useMutation({
    mutationFn: async (ids: string[]): Promise<{ done: number; failed: string[] }> => {
      const failed: string[] = [];
      let done = 0;
      for (const id of ids) {
        try {
          await apiPost<ReturnBatchRow>(`/api/v1/returns/batches/{id}/receive`, {}, { id });
          done += 1;
        } catch (error: unknown) {
          failed.push(error instanceof Error ? error.message : String(error));
        }
      }
      return { done, failed };
    },
    onSuccess: (result) => {
      if (result.failed.length === 0) {
        message.success(`已确认收货 ${result.done} 个批次，可开始检验`);
      } else {
        message.warning(
          `确认收货 ${result.done} 个，失败 ${result.failed.length} 个：${result.failed[0] ?? ''}`,
        );
      }
      setSelectedBatchIds([]);
      invalidateAll();
    },
    onError: (error: Error) => message.error(`批量收货失败：${error.message}`),
  });

  /** 手动完结（RECEIVED）：剩余未检验行按「缺失」结案，不产生库存动作。 */
  const completeMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<ReturnBatchDetail>(`/api/v1/returns/batches/{id}/complete`, {}, { id }),
    onSuccess: (result) => {
      message.success(`批次 ${result.batchNo} 已完结（剩余行按缺失结案，未入账）`);
      invalidateAll();
    },
    onError: (error: Error) => message.error(`完结失败：${error.message}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      apiPost<ReturnBatchRow>(`/api/v1/returns/batches/{id}/cancel`, {}, { id }),
    onSuccess: () => {
      message.success('批次已取消（未产生任何库存动作）');
      invalidateAll();
    },
    onError: (error: Error) => message.error(`取消失败：${error.message}`),
  });

  const inspectMutation = useMutation({
    mutationFn: (input: { itemId: string; condition: 'SELLABLE' | 'DEFECTIVE' | 'LOST' }) =>
      apiPost<ReturnBatchItemRow>(
        `/api/v1/returns/items/{itemId}/inspect`,
        { condition: input.condition },
        { itemId: input.itemId },
      ),
    onSuccess: (result) => {
      message.success(`检验完成：${CONDITION_META[result.condition]?.label ?? result.condition}`);
      invalidateAll();
    },
    onError: (error: Error) => message.error(`检验失败：${error.message}`),
  });

  /** 扫码入库（2026-11-04）：与拦截页同一套作业手感（扫条码 → 落库位）。 */
  const scanMutation = useMutation({
    mutationFn: (input: { barcode: string; serialNumber?: string; binId?: string }) =>
      apiPost<{
        itemId: string;
        skuCode: string;
        skuName: string;
        quantity: string;
        serialNumbers: string[];
        scannedSerials: number;
        requiredSerials: number;
        completed: boolean;
        condition: string | null;
      }>(`/api/v1/returns/batches/{id}/scan`, input, { id: detailId as string }),
    onSuccess: (result) => {
      setScanFeedback({
        kind: 'success',
        title: result.completed ? `已回库：${result.skuCode}` : '序列号已记录，继续扫',
        detail: result.completed
          ? `${result.skuName} ×${Number(result.quantity)}${
              result.serialNumbers.length > 0
                ? `（SN：${result.serialNumbers.join('、')}）`
                : '（非 SN 商品）'
            }`
          : `${result.skuName}：已扫 ${result.scannedSerials} / ${result.requiredSerials} 件`,
        progress:
          result.requiredSerials > 0
            ? `${result.scannedSerials} / ${result.requiredSerials}`
            : undefined,
      });
      setScanBarcode('');
      setScanSerial('');
      void queryClient.invalidateQueries({ queryKey: ['return-batch-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['return-batches'] });
    },
    onError: (error: Error) => {
      setScanFeedback({ kind: 'error', title: '扫码失败', detail: error.message });
      setScanBarcode('');
    },
  });

  const submitScan = (): void => {
    const barcode = scanBarcode.trim();
    if (barcode === '' || scanMutation.isPending) {
      return;
    }
    scanMutation.mutate({
      barcode,
      ...(scanSerial.trim() === '' ? {} : { serialNumber: scanSerial.trim() }),
      ...(scanBinId === undefined ? {} : { binId: scanBinId }),
    });
  };

  const pendingList = pendingReturns.data?.data ?? [];
  const platformRows = platformReturns.data?.data ?? [];
  const selectedReturn =
    selectedReturnId === null
      ? null
      : (platformRows.find((row) => row.id === selectedReturnId) ?? null);
  const batchList = batches.data?.data ?? [];
  const selectedBatch =
    selectedBatchId !== null ? (batchList.find((row) => row.id === selectedBatchId) ?? null) : null;

  // ---- Context rail: batch workbench (entity type when a row is selected) ----
  const railContent = useMemo<ContextRailContent>(() => {
    // 平台退货记录选中态：唯一入口「用此记录建批次」（主表行内不放按钮）。
    if (activeTab === 'platform' && selectedReturn !== null) {
      const store = storesQuery.data?.data.find((row) => row.id === selectedReturn.storeId);
      return {
        defaultCollapsed: false,
        header: (
          <EntitySummary
            title={selectedReturn.platformReturnId}
            subtitle={
              store === undefined ? selectedReturn.storeId : `${store.storeCode} · ${store.name}`
            }
            badge={
              <StatusBadge
                tone="neutral"
                label={selectedReturn.state ?? '状态未知'}
                hint="平台原文状态"
                showDot={false}
              />
            }
          />
        ),
        children: (
          <>
            <ContextSection title="退货记录">
              <ContextMetric label="平台订单" value={selectedReturn.platformOrderId ?? '—'} />
              <ContextMetric label="平台 SKU" value={selectedReturn.platformSkuId ?? '—'} />
              <ContextMetric label="数量" value={fmtQty(selectedReturn.quantity)} />
              <ContextMetric label="退款状态" value={selectedReturn.refundState ?? '—'} />
              <ContextMetric
                label="退货时间"
                value={<RelativeTime value={selectedReturn.platformCreatedAt} fallback="—" />}
              />
            </ContextSection>
            <ContextAction>
              <Button type="primary" block onClick={() => openCreateBatch(selectedReturn)}>
                用此记录建退货批次
              </Button>
            </ContextAction>
            <RailHint>
              实物到仓后在「退货批次」确认收货，再逐行检验（合格回库才产生库存）。
            </RailHint>
          </>
        ),
      };
    }
    if (selectedBatch === null) {
      return {
        defaultCollapsed: true,
        children: (
          <ContextSection title="退货概览">
            <ContextMetric label="待收货平台记录" value={`${pendingList.length} 条`} />
            <ContextMetric
              label="退货批次（当前筛选）"
              value={`${batches.data?.meta.total ?? 0} 个`}
            />
            <RailHint>
              「退货批次」页签下点击批次行查看详情；确认收货 / 取消批次在右栏操作。
            </RailHint>
          </ContextSection>
        ),
      };
    }
    return {
      defaultCollapsed: true,
      header: (
        <EntitySummary
          title={selectedBatch.batchNo}
          subtitle={
            warehousesQuery.data?.data.find((wh) => wh.id === selectedBatch.warehouseId)
              ?.warehouseCode ?? selectedBatch.warehouseId
          }
          badge={
            <StatusBadge
              tone={BATCH_STATUS_META[selectedBatch.status]?.tone ?? 'neutral'}
              label={BATCH_STATUS_META[selectedBatch.status]?.label ?? selectedBatch.status}
              hint={selectedBatch.status}
            />
          }
        />
      ),
      children: (
        <>
          <ContextSection title="批次概况">
            <ContextMetric label="明细行" value={selectedBatch.itemCount} />
            <ContextMetric label="来源说明" value={selectedBatch.sourceNote ?? '—'} />
          </ContextSection>
          <ContextAction>
            <Button block onClick={() => setDetailId(selectedBatch.id)}>
              查看详情
            </Button>
            {selectedBatch.status === 'RECEIVED' && (
              <Button
                block
                style={{ marginTop: 8 }}
                loading={completeMutation.isPending}
                onClick={() => {
                  modal.confirm({
                    title: `手动完结批次 ${selectedBatch.batchNo}？`,
                    content:
                      '剩余未检验行将按「缺失」结案：不产生任何库存动作；关联平台记录的行会创建退货差异异常（索赔/申诉）。',
                    okText: '完结批次',
                    okButtonProps: { danger: true },
                    cancelText: '返回',
                    onOk: () => completeMutation.mutate(selectedBatch.id),
                  });
                }}
              >
                手动完结
              </Button>
            )}
            {selectedBatch.status === 'DRAFT' && (
              <>
                <Button
                  type="primary"
                  block
                  style={{ marginTop: 8 }}
                  loading={receiveMutation.isPending}
                  onClick={() => {
                    // 确认收货 = L2：modal.confirm + danger ok。
                    modal.confirm({
                      title: `确认收货 ${selectedBatch.batchNo}？`,
                      content: '实物已到退货仓并清点完毕；确认后行不可增删，可开始检验。',
                      okText: '确认收货',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        receiveMutation.mutate(selectedBatch.id);
                      },
                    });
                  }}
                >
                  确认收货
                </Button>
                <Button
                  danger
                  block
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    // 取消批次 = L2：modal.confirm + danger ok。
                    modal.confirm({
                      title: `取消批次 ${selectedBatch.batchNo}？`,
                      content: '仅草稿可取消；未产生任何库存动作。',
                      okText: '取消批次',
                      okButtonProps: { danger: true },
                      cancelText: '返回',
                      onOk: () => {
                        cancelMutation.mutate(selectedBatch.id);
                      },
                    });
                  }}
                >
                  取消批次
                </Button>
              </>
            )}
          </ContextAction>
        </>
      ),
    };
    // mutation 对象以 isPending / mutate（稳定引用）承载依赖（规范 §4.4）。
  }, [
    activeTab,
    selectedReturn,
    storesQuery.data,
    openCreateBatch,
    selectedBatch,
    pendingList.length,
    batches.data,
    warehousesQuery.data,
    receiveMutation.isPending,
    receiveMutation.mutate,
    completeMutation.isPending,
    completeMutation.mutate,
    cancelMutation.isPending,
    cancelMutation.mutate,
    modal,
  ]);
  useContextRail(railContent);

  return (
    <div>
      <PageHeader
        title="退货管理"
        description="平台退货记录（只读事实）与退货批次（实物回流：检验后回库）"
        extra={
          <Tabs
            activeKey={activeTab}
            onChange={(key) => {
              setPage(1);
              setPlatformPage(1);
              setActiveTab(key);
              setSelectedReturnId(null);
              setSelectedReturnIds([]);
              setSelectedBatchId(null);
              setSelectedBatchIds([]);
            }}
            items={[
              { key: 'platform', label: `平台退货记录 (${platformReturns.data?.meta.total ?? 0})` },
              { key: 'batches', label: `退货批次 (${batches.data?.meta.total ?? 0})` },
            ]}
          />
        }
        primary={
          activeTab === 'platform' ? (
            <Tooltip title="从平台拉取 rFBS 退货记录（OZON /v2/returns/rfbs/list，只读；不写库存）">
              <Button
                type="primary"
                icon={<CloudSyncOutlined />}
                disabled={storeId === undefined}
                loading={syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
              >
                同步退货记录
              </Button>
            </Tooltip>
          ) : null
        }
      />

      {activeTab === 'platform' && (
        <FilterBar>
          <Input.Search
            allowClear
            placeholder="退货单号 / 平台订单号 / Offer / 平台 SKU"
            style={{ width: 320 }}
            value={platformKeyword}
            onChange={(event) => setPlatformKeyword(event.target.value)}
            onSearch={() => setPlatformPage(1)}
            onClear={() => setPlatformPage(1)}
          />
          <Select
            allowClear
            placeholder="店铺"
            style={{ width: 220 }}
            showSearch
            optionFilterProp="label"
            options={(storesQuery.data?.data ?? []).map((store) => ({
              value: store.id,
              label: `${store.storeCode} · ${store.name}`,
            }))}
            value={storeId}
            onChange={(value) => {
              setPlatformPage(1);
              setStoreId(value);
            }}
          />
          <Segmented
            options={[
              { value: 'PENDING', label: '待处理' },
              { value: 'PROCESSING', label: '处理中' },
              { value: 'COMPLETED', label: '已完结' },
            ]}
            value={stage}
            onChange={(value) => {
              setPlatformPage(1);
              setSelectedReturnIds([]);
              setStage(value as 'PENDING' | 'PROCESSING' | 'COMPLETED');
            }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void platformReturns.refetch()}
            loading={platformReturns.isFetching}
          >
            刷新
          </Button>
        </FilterBar>
      )}

      {activeTab === 'platform' && (
        <SectionCard flush>
          <DataTable<PlatformReturnRow>
            rowKey="id"
            loading={platformReturns.isLoading}
            error={platformReturns.error}
            onRetry={() => void platformReturns.refetch()}
            dataSource={platformReturns.data?.data ?? []}
            pagination={{
              current: platformPage,
              pageSize: 50,
              total: platformReturns.data?.meta.total ?? 0,
              onChange: setPlatformPage,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
            }}
            emptyTitle="暂无平台退货记录"
            emptyDescription="选择店铺后点「同步退货记录」拉取平台 rFBS 退货。"
            rowSelection={{
              selectedRowKeys: selectedReturnIds,
              onChange: (keys) => setSelectedReturnIds(keys as string[]),
              getCheckboxProps: (record) => ({ disabled: record.batchNo !== null }),
            }}
            onRow={(record) => ({
              onClick: () => setSelectedReturnId(record.id === selectedReturnId ? null : record.id),
              style: {
                cursor: 'pointer',
                background: record.id === selectedReturnId ? colors.primarySoft : undefined,
              },
            })}
            columns={[
              {
                title: '退货单号',
                dataIndex: 'platformReturnId',
                key: 'platformReturnId',
                width: 160,
              },
              {
                title: '商品',
                key: 'product',
                width: 240,
                render: (_: unknown, row: PlatformReturnRow) =>
                  row.skuCode === null ? (
                    <span style={{ color: colors.danger }} title="平台 SKU 未映射到内部 SKU">
                      {row.offerId ?? row.platformSkuId ?? '未映射'} ⚠
                    </span>
                  ) : (
                    <span>
                      <span style={{ fontWeight: 550 }}>{row.skuCode}</span>{' '}
                      <span style={{ color: colors.textSecondary, fontSize: 12.5 }}>
                        {row.skuName ?? ''}
                      </span>
                      <div style={{ fontSize: 12, color: colors.textTertiary }}>
                        {row.offerId ?? ''}
                      </div>
                    </span>
                  ),
              },
              {
                title: '数量',
                dataIndex: 'quantity',
                key: 'quantity',
                width: 70,
                align: 'right' as const,
                render: (value: string) => fmtQty(value),
              },
              {
                title: '平台订单',
                dataIndex: 'platformOrderId',
                key: 'platformOrderId',
                width: 170,
                render: (value: string | null, row: PlatformReturnRow) =>
                  value === null ? (
                    '—'
                  ) : row.orderId === null ? (
                    <Tooltip title="该订单在系统内不存在（RETURN_ORDER_NOT_FOUND，去异常中心处理）">
                      <span style={{ color: colors.danger }}>{value} ⚠</span>
                    </Tooltip>
                  ) : (
                    value
                  ),
              },
              {
                title: '平台状态',
                dataIndex: 'state',
                key: 'state',
                width: 190,
                // OZON 退货状态是平台原文事实（俄语自由文本，无稳定枚举）：
                // 徽标化但保持 neutral + 原文展示（Phase 3 T3）。
                render: (value: string | null) =>
                  value === null ? (
                    '—'
                  ) : (
                    <StatusBadge tone="neutral" label={value} hint="平台原文状态" showDot={false} />
                  ),
              },
              {
                title: '退款状态',
                dataIndex: 'refundState',
                key: 'refundState',
                width: 160,
                render: (value: string | null) =>
                  value === null ? (
                    '—'
                  ) : (
                    <StatusBadge
                      tone="neutral"
                      label={value}
                      hint="平台原文退款状态（仅展示）"
                      showDot={false}
                    />
                  ),
              },
              {
                title: '平台SKU',
                dataIndex: 'platformSkuId',
                key: 'platformSkuId',
                width: 140,
                render: (value: string | null) => value ?? '—',
              },
              {
                title: '退货时间',
                dataIndex: 'platformCreatedAt',
                key: 'platformCreatedAt',
                width: 150,
                render: (value: string | null) => <RelativeTime value={value} fallback="—" />,
              },
              {
                title: '批次',
                key: 'batchNo',
                width: 190,
                render: (_: unknown, row: PlatformReturnRow) =>
                  row.batchNo === null ? (
                    <StatusBadge tone="warning" label="待处理" showDot={false} />
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontFamily: 'monospace' }}>{row.batchNo}</span>
                      <StatusBadge
                        tone={BATCH_STATUS_META[row.batchStatus ?? '']?.tone ?? 'neutral'}
                        label={BATCH_STATUS_META[row.batchStatus ?? '']?.label ?? row.batchStatus}
                        showDot={false}
                      />
                    </span>
                  ),
              },
            ]}
          />
        </SectionCard>
      )}

      {activeTab === 'batches' && (
        <>
          <FilterBar>
            <Input.Search
              allowClear
              placeholder="批次号 / 退货单号 / SKU 编码"
              style={{ width: 300 }}
              value={batchKeyword}
              onChange={(event) => setBatchKeyword(event.target.value)}
              onSearch={() => setPage(1)}
              onClear={() => setPage(1)}
            />
            <Select
              allowClear
              placeholder="批次状态"
              style={{ width: 140 }}
              options={Object.entries(BATCH_STATUS_META).map(([value, meta]) => ({
                value,
                label: meta.label,
              }))}
              value={batchStatus}
              onChange={(value) => {
                setPage(1);
                setBatchStatus(value);
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void batches.refetch()}
              loading={batches.isFetching}
            >
              刷新
            </Button>
            <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
              待收货平台记录 {pendingList.length} 条可在建批时直接带入
            </span>
          </FilterBar>
          <SectionCard flush>
            <DataTable<ReturnBatchRow>
              rowKey="id"
              loading={batches.isLoading}
              error={batches.error}
              onRetry={() => void batches.refetch()}
              dataSource={batchList}
              pagination={{
                current: page,
                pageSize: 20,
                total: batches.data?.meta.total ?? 0,
                onChange: setPage,
                showTotal: (total) => `共 ${total} 个批次`,
              }}
              emptyTitle="暂无退货批次"
              emptyDescription="新建批次登记一批退回实物，收货后逐行检验回库。"
              rowSelection={{
                selectedRowKeys: selectedBatchIds,
                onChange: (keys) => setSelectedBatchIds(keys as string[]),
                getCheckboxProps: (record) => ({ disabled: record.status !== 'DRAFT' }),
              }}
              onRow={(record) => ({
                onClick: () => setSelectedBatchId(record.id === selectedBatchId ? null : record.id),
                onDoubleClick: () => setDetailId(record.id),
                style: {
                  cursor: 'pointer',
                  background: record.id === selectedBatchId ? colors.primarySoft : undefined,
                },
              })}
              columns={[
                { title: '批次号', dataIndex: 'batchNo', key: 'batchNo', width: 130 },
                {
                  title: '仓库',
                  dataIndex: 'warehouseId',
                  key: 'warehouseId',
                  width: 140,
                  render: (value: string) =>
                    warehousesQuery.data?.data.find((wh) => wh.id === value)?.warehouseCode ??
                    warehousesQuery.data?.data.find((wh) => wh.id === value)?.name ??
                    value,
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  key: 'status',
                  width: 110,
                  render: (value: string) => (
                    <StatusBadge
                      tone={BATCH_STATUS_META[value]?.tone ?? 'neutral'}
                      label={BATCH_STATUS_META[value]?.label ?? value}
                      hint={value}
                      showDot={false}
                    />
                  ),
                },
                {
                  title: '行数',
                  dataIndex: 'itemCount',
                  key: 'itemCount',
                  width: 70,
                  align: 'right' as const,
                },
                {
                  title: '待处理行',
                  dataIndex: 'pendingItems',
                  key: 'pendingItems',
                  width: 100,
                  align: 'right' as const,
                  render: (value: number) =>
                    value > 0 ? (
                      <StatusBadge tone="warning" label={`${value} 行待检验`} showDot={false} />
                    ) : (
                      <span style={{ color: colors.textTertiary }}>—</span>
                    ),
                },
                {
                  title: '来源说明',
                  dataIndex: 'sourceNote',
                  key: 'sourceNote',
                  render: (value: string | null) => value ?? '—',
                },
                {
                  title: '创建时间',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  width: 160,
                  render: (value: string) => <RelativeTime value={value} />,
                },
              ]}
            />
          </SectionCard>
        </>
      )}

      <Drawer
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        size={880}
        title={detail !== undefined ? `退货批次 ${detail.batchNo}` : '退货批次'}
        destroyOnHidden
      >
        {detail === undefined ? (
          <span style={{ color: colors.textTertiary }}>加载中…</span>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
              <StatusBadge
                tone={BATCH_STATUS_META[detail.status]?.tone ?? 'neutral'}
                label={BATCH_STATUS_META[detail.status]?.label ?? detail.status}
                hint={detail.status}
                showDot={false}
              />
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                {detail.sourceNote ?? ''}
              </span>
            </div>
            {detail.status === 'DRAFT' && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: colors.neutralBg,
                  border: `1px solid ${colors.neutralBorder}`,
                  fontSize: 12.5,
                  color: colors.textSecondary,
                }}
              >
                草稿批次：实物到仓后先在「退货批次」列表选中该批次，右栏点「确认收货」，
                然后才能逐行检验回库。
              </div>
            )}
            {detail.status === 'RECEIVED' && (
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  borderRadius: 10,
                  border: `1px solid ${colors.primary}`,
                  background: colors.container,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Input
                    size="large"
                    autoFocus
                    placeholder="扫描 SKU 条码（回车提交）"
                    style={{ flex: 1, minWidth: 260, fontSize: 16 }}
                    value={scanBarcode}
                    onChange={(event) => setScanBarcode(event.target.value)}
                    onPressEnter={submitScan}
                    disabled={scanMutation.isPending}
                  />
                  <Input
                    placeholder="SN 序列号（SN 商品必填）"
                    style={{ width: 220 }}
                    value={scanSerial}
                    onChange={(event) => setScanSerial(event.target.value)}
                    onPressEnter={submitScan}
                    disabled={scanMutation.isPending}
                  />
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="回库库位（默认 STAGING）"
                    style={{ width: 220 }}
                    options={binOptions}
                    value={scanBinId}
                    onChange={setScanBinId}
                    loading={binsQuery.isLoading}
                  />
                </div>
                <div style={{ fontSize: 12.5, color: colors.textTertiary }}>
                  扫 SKU 条码 → 命中本批次的待检验行：非 SN 商品一次整行入库；SN
                  商品逐件扫序列号，扫满才入账。 不合格 / 缺失仍用下表对应按钮。
                </div>
                <ScanFeedback feedback={scanFeedback} />
              </div>
            )}
            <DataTable<ReturnBatchItemRow>
              rowKey="id"
              dataSource={detail.items}
              pagination={false}
              emptyTitle="无明细"
              columns={[
                {
                  title: '#',
                  key: 'index',
                  width: 40,
                  render: (_: unknown, __: ReturnBatchItemRow, index: number) => index + 1,
                },
                {
                  title: '来源',
                  key: 'source',
                  width: 150,
                  render: (_: unknown, row: ReturnBatchItemRow) =>
                    row.platformReturnNo === null ? (
                      <StatusBadge tone="neutral" label="人工登记" showDot={false} />
                    ) : (
                      row.platformReturnNo
                    ),
                },
                {
                  title: 'SKU',
                  dataIndex: 'skuCode',
                  key: 'skuCode',
                  width: 200,
                  render: (_: unknown, row: ReturnBatchItemRow) => (
                    <span>
                      <span style={{ fontWeight: 550 }}>{row.skuCode}</span>{' '}
                      <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                        {row.skuName}
                      </span>
                    </span>
                  ),
                },
                {
                  title: '数量',
                  dataIndex: 'quantity',
                  key: 'quantity',
                  width: 80,
                  align: 'right' as const,
                  render: (value: string) => fmtQty(value),
                },
                {
                  title: 'SN 进度',
                  key: 'serials',
                  width: 110,
                  render: (_: unknown, row: ReturnBatchItemRow) =>
                    row.serialTracking ? (
                      <span
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          color:
                            row.receivedSerialNumbers.length >= Number(row.quantity)
                              ? colors.success
                              : colors.textSecondary,
                        }}
                        title={row.receivedSerialNumbers.join('、')}
                      >
                        {row.receivedSerialNumbers.length} / {Number(row.quantity)}
                      </span>
                    ) : (
                      <span style={{ color: colors.textTertiary }}>—</span>
                    ),
                },
                {
                  title: '回库库位',
                  dataIndex: 'binCode',
                  key: 'binCode',
                  width: 130,
                  render: (value: string | null) => value ?? '—',
                },
                {
                  title: '检验结论',
                  dataIndex: 'condition',
                  key: 'condition',
                  width: 150,
                  render: (value: string) => (
                    <StatusBadge
                      tone={CONDITION_META[value]?.tone ?? 'neutral'}
                      label={CONDITION_META[value]?.label ?? value}
                      hint={value}
                      showDot={false}
                    />
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  width: 300,
                  render: (_: unknown, row: ReturnBatchItemRow) => {
                    if (detail.status !== 'RECEIVED' || row.condition !== 'PENDING') {
                      return null;
                    }
                    // 子表规范 §4.5：检验推进不是 danger（§3.1）；合格回库为主操作，
                    // 各带 L1 轻确认（Popconfirm）。
                    return (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <Popconfirm
                          title="按合格回库？"
                          description="合格回库（未指定库位时自动落暂存位）。"
                          okText="合格回库"
                          cancelText="取消"
                          onConfirm={() =>
                            inspectMutation.mutate({ itemId: row.id, condition: 'SELLABLE' })
                          }
                        >
                          <Button size="small" type="primary">
                            合格回库
                          </Button>
                        </Popconfirm>
                        <Popconfirm
                          title="标记不合格？"
                          description="不合格入隔离库存；关联平台记录时创建退货差异异常。"
                          okText="不合格"
                          cancelText="取消"
                          onConfirm={() =>
                            inspectMutation.mutate({ itemId: row.id, condition: 'DEFECTIVE' })
                          }
                        >
                          <Button size="small">不合格</Button>
                        </Popconfirm>
                        <Popconfirm
                          title="标记缺失？"
                          description="实物缺失：不做任何库存动作；关联平台记录时创建退货差异异常。"
                          okText="缺失"
                          cancelText="取消"
                          onConfirm={() =>
                            inspectMutation.mutate({ itemId: row.id, condition: 'LOST' })
                          }
                        >
                          <Button size="small">缺失</Button>
                        </Popconfirm>
                      </span>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* 建批确认（2026-11-04 用户口径）：不再用长列表弹窗，勾选记录后直接建批，
          这里只确认收货仓库与已选摘要。 */}
      <Modal
        title="创建退货批次"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => {
          void createForm.validateFields().then((values) => {
            if (createItems.length === 0) {
              message.error('请先勾选平台退货记录');
              return;
            }
            createMutation.mutate({ ...values, items: createItems });
          });
        }}
        okText={`创建（${createItems.length} 条）`}
        cancelText="取消"
        width={620}
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item
            name="warehouseId"
            label="收货仓库（建议专用退货仓/临时仓）"
            rules={[{ required: true, message: '请选择仓库' }]}
          >
            <Select
              options={(warehousesQuery.data?.data ?? []).map((wh) => ({
                value: wh.id,
                label: `${wh.warehouseCode} · ${wh.name}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="sourceNote" label="备注（可选）">
            <Input maxLength={500} />
          </Form.Item>
        </Form>
        <div style={{ borderTop: `1px solid ${colors.borderSoft}`, paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 550, marginBottom: 8 }}>
            已选 {createItems.length} 条 · 合计{' '}
            {fmtQty(createItems.reduce((sum, item) => sum + Number(item.quantity), 0).toFixed(3))}{' '}
            件
          </div>
          <div
            style={{
              maxHeight: 220,
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {createItems.map((item) => {
              const record = platformRows.find((row) => row.id === item.platformReturnId);
              return (
                <div
                  key={item.platformReturnId}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    fontSize: 12.5,
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: colors.neutralBg,
                  }}
                >
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, minWidth: 110 }}>
                    {record?.platformReturnId ?? '—'}
                  </span>
                  <span style={{ flex: 1, color: colors.textSecondary }}>
                    {record?.skuCode ?? '未映射'} {record?.skuName ?? ''}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    ×{Number(item.quantity)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>

      {/* 底部动作浮岛（复用采购页同款）：勾选后出现批量动作，列表再长也不用回顶部。 */}
      <ActionIsland
        hidden={
          activeTab === 'platform' ? selectedReturnIds.length === 0 : selectedBatchIds.length === 0
        }
        summary={
          activeTab === 'platform' ? (
            <>
              <span style={{ fontSize: 13, fontWeight: 550 }}>
                已选 {selectedReturnIds.length} 条退货记录
              </span>
              <span style={{ fontSize: 12, color: colors.textTertiary }}>
                （已入批次的记录不可重复选择）
              </span>
            </>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 550 }}>
              已选 {selectedBatchIds.length} 个草稿批次
            </span>
          )
        }
        actions={
          activeTab === 'platform' ? (
            <>
              <Button
                type="primary"
                disabled={selectedReturnIds.length === 0}
                onClick={() => {
                  const rows = platformRows.filter((row) => selectedReturnIds.includes(row.id));
                  if (rows.length > 0) {
                    openCreateBatch(rows);
                  }
                }}
              >
                用所选记录建退货批次
              </Button>
              <Button type="text" onClick={() => setSelectedReturnIds([])}>
                清空选择
              </Button>
            </>
          ) : (
            <>
              <Button
                loading={receiveManyMutation.isPending}
                onClick={() => {
                  modal.confirm({
                    title: `批量确认收货 ${selectedBatchIds.length} 个批次？`,
                    content: '实物已到退货仓并清点完毕；确认后行不可增删，可开始逐行检验。',
                    okText: '确认收货',
                    okButtonProps: { danger: true },
                    cancelText: '返回',
                    onOk: () => receiveManyMutation.mutate(selectedBatchIds),
                  });
                }}
              >
                批量确认收货
              </Button>
              <Button type="text" onClick={() => setSelectedBatchIds([])}>
                清空选择
              </Button>
            </>
          )
        }
      />
    </div>
  );
}
