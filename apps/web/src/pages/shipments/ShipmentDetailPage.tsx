import { useState } from 'react';
import {
  App as AntdApp,
  Badge,
  Button,
  Card,
  Collapse,
  Descriptions,
  Input,
  Modal,
  Progress,
  Space,
  Table,
  Tag,
  Upload,
} from 'antd';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch, apiPost, useApiQuery } from '../../api/hooks';

/**
 * Shipment workbench (Sprint 4 task §58): pending items, packed packages,
 * package progress, labels, tracking input and the double-confirmed formal
 * ship (task §60).
 */

/**
 * One shipment line. `status = ACTIVE` means the line is still a valid part of
 * the shipment — it does NOT mean "not yet shipped", so a SHIPPED shipment
 * keeps its lines ACTIVE. VOIDED lines are audit history only.
 */
interface ShipmentItem {
  id: string;
  skuCode: string;
  skuName: string;
  quantity: string;
  packedQty: string;
  serialTracking: boolean;
  serialNumbers: string[];
  status?: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidedByName?: string | null;
  voidReason?: string | null;
  voidSourceType?: string | null;
  voidSourceId?: string | null;
}

interface ShipmentDetail {
  id: string;
  shipmentNo: string;
  orderNo: string;
  warehouseCode: string;
  warehouseName: string;
  status: string;
  trackingNumber: string | null;
  carrierCode: string | null;
  shippingMethod: string | null;
  shippedAt: string | null;
  createdAt: string;
  /** Valid lines only (API filters VOIDED out); drives every calculation. */
  items: ShipmentItem[];
  /** VOIDED history, permanently retained, never counted. */
  voidedItems: ShipmentItem[];
  packages: Array<{
    id: string;
    packageNo: string;
    status: string;
    sealedAt: string | null;
    totalQty: string;
    items: Array<{ skuCode: string; quantity: string; serialNumbers: string[] }>;
  }>;
  labels: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    signedUrl: string;
    createdAt: string;
  }>;
}

const PACKAGE_STATUS_COLORS: Record<string, string> = {
  OPEN: 'blue',
  SEALED: 'cyan',
  SHIPPED: 'success',
  CANCELLED: 'default',
  REPACK_REQUIRED: 'warning',
};

export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { message, modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [trackingOpen, setTrackingOpen] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrierCode, setCarrierCode] = useState('');

  const query = useApiQuery<{ data: ShipmentDetail }>(
    '/api/v1/shipments/{id}',
    {},
    ['shipment', id],
    id === undefined ? undefined : { id },
  );
  const shipment = query.data?.data;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['shipment', id] });
  };

  const createPackageMutation = useMutation({
    mutationFn: () =>
      apiPost<{ packageId: string }>('/api/v1/shipments/{id}/packages', {}, { id: id as string }),
    onSuccess: (result) => {
      message.success(`包裹已创建，进入打包工作台`);
      refresh();
      window.location.href = `#/packages/${result.packageId}`;
    },
    onError: (error: Error) => message.error(`创建失败：${error.message}`),
  });

  const trackingMutation = useMutation({
    mutationFn: () =>
      apiPatch(
        '/api/v1/shipments/{id}/tracking',
        { trackingNumber, carrierCode },
        { id: id as string },
      ),
    onSuccess: () => {
      message.success('物流信息已保存');
      setTrackingOpen(false);
      refresh();
    },
    onError: (error: Error) => message.error(`保存失败：${error.message}`),
  });

  const shipMutation = useMutation({
    mutationFn: () => apiPost('/api/v1/shipments/{id}/ship', {}, { id: id as string }),
    onSuccess: () => {
      message.success('正式出库完成');
      refresh();
    },
    onError: (error: Error) => message.error(`出库失败：${error.message}`),
  });

  const uploadLabel = async (file: File): Promise<void> => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch(`/api/v1/shipments/${id}/labels`, {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const body = (await response.json()) as { success: boolean; error?: { message: string } };
    if (!body.success) {
      message.error(`面单上传失败：${body.error?.message ?? response.status}`);
      return;
    }
    message.success('面单已上传');
    refresh();
  };

  if (shipment === undefined) {
    return <Card loading title="发货单" />;
  }

  const totalRequired = shipment.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const totalPacked = shipment.items.reduce((sum, item) => sum + Number(item.packedQty), 0);
  const canOperate = ['READY_TO_PACK', 'PACKING', 'READY_TO_SHIP'].includes(shipment.status);

  const confirmShip = (): void => {
    modal.confirm({
      title: '确认正式出库？',
      content: '出库后实体库存将扣减（On Hand / Picked 减少，SN 转为 SHIPPED）。',
      okText: '确认出库',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => shipMutation.mutate(),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="发货单号">
            <span style={{ fontSize: 18, fontWeight: 700 }}>{shipment.shipmentNo}</span>
          </Descriptions.Item>
          <Descriptions.Item label="订单">{shipment.orderNo}</Descriptions.Item>
          <Descriptions.Item label="仓库">
            {`${shipment.warehouseCode} ${shipment.warehouseName}`}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Badge
              status={shipment.status === 'SHIPPED' ? 'success' : 'processing'}
              text={shipment.status}
            />
          </Descriptions.Item>
          <Descriptions.Item label="物流单号">
            {shipment.trackingNumber ?? '未录入'}
            {shipment.carrierCode ? `（${shipment.carrierCode}）` : ''}
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(shipment.createdAt).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="出库时间">
            {shipment.shippedAt ? new Date(shipment.shippedAt).toLocaleString() : '-'}
          </Descriptions.Item>
        </Descriptions>
        <Progress
          percent={totalRequired === 0 ? 0 : Math.round((totalPacked / totalRequired) * 100)}
          format={() => `${totalPacked} / ${totalRequired} 件已打包`}
        />
        <Space style={{ marginTop: 8 }} wrap>
          {canOperate && (
            <Button
              type="primary"
              size="large"
              loading={createPackageMutation.isPending}
              onClick={() => createPackageMutation.mutate()}
            >
              新建包裹
            </Button>
          )}
          {canOperate && (
            <Button
              size="large"
              onClick={() => {
                setTrackingNumber(shipment.trackingNumber ?? '');
                setCarrierCode(shipment.carrierCode ?? '');
                setTrackingOpen(true);
              }}
            >
              录入物流单号
            </Button>
          )}
          {shipment.status === 'READY_TO_SHIP' && (
            <Button type="primary" danger size="large" onClick={confirmShip}>
              正式出库
            </Button>
          )}
        </Space>
      </Card>

      <Card size="small" title={`待发商品 (${shipment.items.length})`}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={shipment.items}
          columns={[
            { title: 'SKU', dataIndex: 'skuCode', key: 'skuCode', width: 130 },
            { title: '名称', dataIndex: 'skuName', key: 'skuName' },
            { title: '应发数量', dataIndex: 'quantity', key: 'quantity', width: 100 },
            { title: '已打包', dataIndex: 'packedQty', key: 'packedQty', width: 100 },
            {
              title: 'SN',
              key: 'serial',
              render: (_: unknown, row: ShipmentDetail['items'][number]) =>
                row.serialTracking ? row.serialNumbers.join(', ') : '-',
            },
          ]}
        />
      </Card>

      {shipment.voidedItems.length > 0 && (
        <Collapse
          size="small"
          defaultActiveKey={[]}
          items={[
            {
              key: 'voided',
              label: `已作废 / 历史记录 (${shipment.voidedItems.length})`,
              children: (
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  dataSource={shipment.voidedItems}
                  columns={[
                    { title: 'SKU', dataIndex: 'skuCode', key: 'skuCode', width: 130 },
                    { title: '名称', dataIndex: 'skuName', key: 'skuName' },
                    {
                      title: '原数量',
                      dataIndex: 'quantity',
                      key: 'quantity',
                      width: 90,
                      render: (value: string) => Number(value),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      key: 'status',
                      width: 100,
                      render: (value: string) => <Tag color="default">{value}</Tag>,
                    },
                    {
                      title: '作废原因',
                      dataIndex: 'voidReason',
                      key: 'voidReason',
                      render: (value: string | null) => value ?? '-',
                    },
                    {
                      title: '作废时间',
                      dataIndex: 'voidedAt',
                      key: 'voidedAt',
                      width: 170,
                      render: (value: string | null) =>
                        value ? new Date(value).toLocaleString() : '-',
                    },
                    {
                      title: '作废人',
                      dataIndex: 'voidedByName',
                      key: 'voidedByName',
                      width: 120,
                      render: (value: string | null) => value ?? '-',
                    },
                    {
                      title: '来源',
                      key: 'source',
                      width: 150,
                      render: (_: unknown, row: ShipmentItem) =>
                        row.voidSourceType === 'ORDER_INTERCEPTION' &&
                        row.voidSourceId !== null &&
                        row.voidSourceId !== undefined ? (
                          <Link to={`/interceptions/${row.voidSourceId}`}>查看拦截任务</Link>
                        ) : (
                          (row.voidSourceType ?? '-')
                        ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      <Card size="small" title={`包裹 (${shipment.packages.length})`}>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={shipment.packages}
          columns={[
            { title: '包裹号', dataIndex: 'packageNo', key: 'packageNo', width: 140 },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 150,
              render: (value: string) => (
                <Tag color={PACKAGE_STATUS_COLORS[value] ?? 'default'}>{value}</Tag>
              ),
            },
            {
              title: '内容',
              key: 'contents',
              render: (_: unknown, row: ShipmentDetail['packages'][number]) =>
                row.items
                  .map(
                    (item) =>
                      `${item.skuCode} ×${Number(item.quantity)}${
                        item.serialNumbers.length > 0 ? `（${item.serialNumbers.join(', ')}）` : ''
                      }`,
                  )
                  .join('；') || '空',
            },
            { title: '件数', dataIndex: 'totalQty', key: 'totalQty', width: 80 },
            {
              title: '封箱时间',
              dataIndex: 'sealedAt',
              key: 'sealedAt',
              width: 170,
              render: (value: string | null) => (value ? new Date(value).toLocaleString() : '-'),
            },
            {
              title: '操作',
              key: 'actions',
              width: 120,
              render: (_: unknown, row: ShipmentDetail['packages'][number]) =>
                row.status === 'OPEN' || row.status === 'REPACK_REQUIRED' ? (
                  <Link to={`/packages/${row.id}`}>
                    <Button type="primary" ghost size="small">
                      打包作业
                    </Button>
                  </Link>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card
        size="small"
        title="面单（PDF / PNG / JPEG，浏览器打开打印）"
        extra={
          canOperate ? (
            <Upload
              accept=".pdf,.png,.jpg,.jpeg"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadLabel(file);
                return false;
              }}
            >
              <Button size="small">上传面单</Button>
            </Upload>
          ) : null
        }
      >
        {shipment.labels.length === 0
          ? '暂无面单'
          : shipment.labels.map((label) => (
              <Space key={label.id} style={{ display: 'flex', marginBottom: 4 }}>
                <span>{label.fileName}</span>
                <a href={label.signedUrl} target="_blank" rel="noreferrer">
                  查看 / 打印
                </a>
              </Space>
            ))}
      </Card>

      <Modal
        title="录入物流信息"
        open={trackingOpen}
        confirmLoading={trackingMutation.isPending}
        onCancel={() => setTrackingOpen(false)}
        onOk={() => trackingMutation.mutate()}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input
            size="large"
            placeholder="物流单号 trackingNumber"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
          />
          <Input
            size="large"
            placeholder="承运商 carrierCode（如 CDEK）"
            value={carrierCode}
            onChange={(event) => setCarrierCode(event.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
