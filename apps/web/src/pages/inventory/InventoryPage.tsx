import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { useState } from 'react';
import { apiPost, apiPut, useApiQuery } from '../../api/hooks';

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

/** Form number -> quantity string for the NUMERIC(18,3) wire format. */
const asQty = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const fmtQty = (value: string): string => (Number(value) % 1 === 0 ? String(Number(value)) : value);
const fmtTime = (value: string): string => value.slice(0, 19).replace('T', ' ');

type ActionMode = 'initialize' | 'adjust' | 'safety' | 'move';

/** 库存查询 (task §51-§52, §55-§57): list + drilldown drawer + admin actions. */
export function InventoryPage() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<ActionMode | null>(null);
  const [detailSku, setDetailSku] = useState<string | null>(null);
  const [skuSearch, setSkuSearch] = useState('');
  const [form] = Form.useForm();

  const warehouses = useApiQuery<{
    data: Array<{ id: string; warehouseCode: string; name: string }>;
  }>('/api/v1/warehouses', { page: 1, pageSize: 100 }, ['warehouses-lite']);
  const inventory = useApiQuery<{ data: InventoryRow[]; meta: { total: number } }>(
    '/api/v1/inventory',
    { page, pageSize: 50, keyword: keyword || undefined, warehouseId, status },
    ['inventory', page, keyword, warehouseId, status],
  );
  const detail = useApiQuery<{ data: SkuInventoryDetail }>(
    '/api/v1/inventory/skus/{skuId}',
    {},
    ['inventory-detail', detailSku],
    detailSku === null ? undefined : { skuId: detailSku },
    detailSku !== null,
  );
  const detailReservations = useApiQuery<{ data: ReservationRow[] }>(
    '/api/v1/inventory/reservations',
    { skuId: detailSku ?? undefined, pageSize: 50 },
    ['inventory-detail-reservations', detailSku],
  );
  const detailTransactions = useApiQuery<{ data: TransactionRow[] }>(
    '/api/v1/inventory/transactions',
    { skuId: detailSku ?? undefined, pageSize: 50 },
    ['inventory-detail-transactions', detailSku],
  );

  // Action-form option sources: SKU search + bins of the selected warehouse.
  const skuOptions = useApiQuery<{ data: Array<{ id: string; skuCode: string; nameZh: string }> }>(
    '/api/v1/skus',
    { page: 1, pageSize: 20, keyword: skuSearch || undefined },
    ['skus-search', skuSearch],
  );
  const formWarehouseId = Form.useWatch('warehouseId', form);
  const binsOfWarehouse = useApiQuery<{ data: Array<{ id: string; binCode: string }> }>(
    '/api/v1/warehouses/{warehouseId}/bins',
    { page: 1, pageSize: 100 },
    ['action-bins', formWarehouseId],
    formWarehouseId === undefined ? undefined : { warehouseId: formWarehouseId },
    formWarehouseId !== undefined,
  );

  const warehouseOptions = (warehouses.data?.data ?? []).map((warehouse) => ({
    value: warehouse.id,
    label: `${warehouse.warehouseCode} ${warehouse.name}`,
  }));
  const binOptions = (binsOfWarehouse.data?.data ?? []).map((bin) => ({
    value: bin.id,
    label: bin.binCode,
  }));

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-detail'] });
  };

  const submitMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const ref = crypto.randomUUID();
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
    }
    setAction(mode);
  };

  const detailRow = detail.data?.data;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Space wrap>
        <Input.Search
          placeholder="搜索 SKU 编码 / 名称"
          allowClear
          onSearch={(value) => {
            setPage(1);
            setKeyword(value);
          }}
          style={{ width: 240 }}
        />
        <Select
          placeholder="仓库"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 220 }}
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
          style={{ width: 140 }}
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
        <Button type="primary" onClick={() => openAction('initialize')}>
          库存初始化
        </Button>
        <Button onClick={() => openAction('move')}>库内移位</Button>
        <Button onClick={() => openAction('adjust')}>库存调整</Button>
        <Button onClick={() => openAction('safety')}>安全库存</Button>
      </Space>

      <Table<InventoryRow>
        rowKey="id"
        loading={inventory.isLoading}
        dataSource={inventory.data?.data ?? []}
        pagination={{
          current: page,
          pageSize: 50,
          total: inventory.data?.meta.total ?? 0,
          onChange: setPage,
          showSizeChanger: false,
        }}
        onRow={(record) => ({
          onClick: () => setDetailSku(record.skuId),
          style: { cursor: 'pointer' },
        })}
        columns={[
          { title: 'SKU', dataIndex: 'skuCode', width: 130 },
          { title: '名称', dataIndex: 'skuName', ellipsis: true },
          { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
          { title: '库位', dataIndex: 'binCode', width: 140 },
          { title: 'On Hand', dataIndex: 'onHandQty', width: 90, render: fmtQty, align: 'right' },
          {
            title: 'Reserved',
            dataIndex: 'reservedQty',
            width: 95,
            render: fmtQty,
            align: 'right',
          },
          { title: 'Picked', dataIndex: 'pickedQty', width: 80, render: fmtQty, align: 'right' },
          { title: 'Safety', dataIndex: 'safetyQty', width: 80, render: fmtQty, align: 'right' },
          {
            title: '可售',
            dataIndex: 'sellableAvailableQty',
            width: 80,
            render: (value: string) => <Typography.Text strong>{fmtQty(value)}</Typography.Text>,
            align: 'right',
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (value: string) => (
              <Tag color={value === 'IN_STOCK' ? 'green' : 'default'}>
                {value === 'IN_STOCK' ? '有可售' : '无可售'}
              </Tag>
            ),
          },
          {
            title: '操作',
            width: 210,
            render: (_, record) => (
              <Space size="small" onClick={(event) => event.stopPropagation()}>
                <Button
                  size="small"
                  onClick={() =>
                    openAction('adjust', {
                      skuId: record.skuId,
                      warehouseId: record.warehouseId,
                      binId: record.binId,
                    })
                  }
                >
                  调整
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    openAction('safety', {
                      skuId: record.skuId,
                      safetyWarehouseId: record.warehouseId,
                      safetyQty: Number(record.safetyQty),
                    })
                  }
                >
                  安全库存
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    openAction('move', {
                      skuId: record.skuId,
                      warehouseId: record.warehouseId,
                      fromBinId: record.binId,
                    })
                  }
                >
                  移位
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Drawer
        title={detailRow ? `库存详情：${detailRow.skuCode}` : '库存详情'}
        width={880}
        open={detailSku !== null}
        onClose={() => setDetailSku(null)}
      >
        {detailRow !== undefined && (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Descriptions size="small" bordered column={3}>
              <Descriptions.Item label="SKU">{detailRow.skuCode}</Descriptions.Item>
              <Descriptions.Item label="名称" span={2}>
                {detailRow.skuName}
              </Descriptions.Item>
              <Descriptions.Item label="On Hand">
                {fmtQty(detailRow.totals.onHandQty)}
              </Descriptions.Item>
              <Descriptions.Item label="Reserved">
                {fmtQty(detailRow.totals.reservedQty)}
              </Descriptions.Item>
              <Descriptions.Item label="Picked">
                {fmtQty(detailRow.totals.pickedQty)}
              </Descriptions.Item>
              <Descriptions.Item label="实物可售">
                {fmtQty(detailRow.totals.physicalAvailableQty)}
              </Descriptions.Item>
              <Descriptions.Item label="Safety">
                {fmtQty(detailRow.totals.safetyQty)}
              </Descriptions.Item>
              <Descriptions.Item label="渠道可售">
                {fmtQty(detailRow.totals.sellableAvailableQty)}
              </Descriptions.Item>
            </Descriptions>

            <Tabs
              items={[
                {
                  key: 'bins',
                  label: '仓库 / 库位明细',
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detailRow.bins}
                      columns={[
                        { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
                        { title: '库位', dataIndex: 'binCode', width: 140 },
                        {
                          title: 'On Hand',
                          dataIndex: 'onHandQty',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: 'Reserved',
                          dataIndex: 'reservedQty',
                          align: 'right',
                          render: fmtQty,
                        },
                        { title: 'Picked', dataIndex: 'pickedQty', align: 'right', render: fmtQty },
                        { title: 'Safety', dataIndex: 'safetyQty', align: 'right', render: fmtQty },
                        {
                          title: '渠道可售',
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
                  label: 'Reservation',
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detailReservations.data?.data ?? []}
                      columns={[
                        { title: '预约号', dataIndex: 'reservationNo', width: 120 },
                        {
                          title: '数量',
                          dataIndex: 'requestedQty',
                          width: 80,
                          align: 'right',
                          render: fmtQty,
                        },
                        { title: '状态', dataIndex: 'status', width: 110 },
                        { title: '来源', dataIndex: 'referenceType', width: 90 },
                        { title: '创建时间', dataIndex: 'createdAt', render: fmtTime },
                      ]}
                    />
                  ),
                },
                {
                  key: 'transactions',
                  label: '库存流水',
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      pagination={false}
                      dataSource={detailTransactions.data?.data ?? []}
                      columns={[
                        { title: '类型', dataIndex: 'transactionType', width: 140 },
                        { title: '仓库', dataIndex: 'warehouseCode', width: 90 },
                        { title: '库位', dataIndex: 'binCode', width: 140 },
                        {
                          title: 'Before',
                          dataIndex: 'quantityBefore',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: 'Change',
                          dataIndex: 'quantityChange',
                          align: 'right',
                          render: fmtQty,
                        },
                        {
                          title: 'After',
                          dataIndex: 'quantityAfter',
                          align: 'right',
                          render: fmtQty,
                        },
                        { title: '时间', dataIndex: 'createdAt', render: fmtTime },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </Space>
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
        onOk={() =>
          void form.validateFields().then((values) => {
            if (action === 'adjust') {
              modal.confirm({
                title: '二次确认：执行库存调整？',
                content: `调整量 ${String(values['quantityDelta'])}，原因：${String(values['reason'])}。操作将写入库存流水。`,
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
                <Select options={warehouseOptions} />
              </Form.Item>
              <Form.Item
                name="safetyQty"
                label="安全库存（渠道保护量，不改变 On Hand）"
                rules={[{ required: true }]}
                extra="显示当前值，保存后立即生效"
              >
                <InputNumber min={0} precision={3} style={{ width: '100%' }} />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              name="warehouseId"
              label="仓库"
              rules={[{ required: true, message: '请选择仓库' }]}
            >
              <Select
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
                extra="留空时仅允许没有任何库位的仓库（系统自动创建 DEFAULT 虚拟库位）"
              >
                <Select allowClear showSearch optionFilterProp="label" options={binOptions} />
              </Form.Item>
              <Form.Item
                name="quantity"
                label="数量（允许 0：建立零余额记录）"
                rules={[{ required: true }]}
              >
                <InputNumber min={0} precision={3} style={{ width: '100%' }} />
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
                <InputNumber precision={3} style={{ width: '100%' }} />
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
                <InputNumber min={0.001} precision={3} style={{ width: '100%' }} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>
    </Space>
  );
}
