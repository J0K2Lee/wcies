import { useState } from 'react';
import { App as AntdApp, Button, Collapse, Input, Modal, Progress, Space, Upload } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch, apiPost, useApiQuery } from '../../api/hooks';
import {
  DataTable,
  InfoGrid,
  PACKAGE_STATUS_META,
  PageHeader,
  SectionCard,
  SHIPMENT_STATUS_META,
  StatusBadge,
} from '../../design-system';
import { fmtDateTime } from '../../utils/format';

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

export function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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
      void navigate(`/packages/${result.packageId}`);
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
    return <SectionCard title="发货单">加载中…</SectionCard>;
  }

  const totalRequired = shipment.items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const totalPacked = shipment.items.reduce((sum, item) => sum + Number(item.packedQty), 0);
  const canOperate = ['READY_TO_PACK', 'PACKING', 'READY_TO_SHIP'].includes(shipment.status);

  const confirmShip = (): void => {
    modal.confirm({
      title: '确认正式出库？',
      content: '出库后实体库存将扣减（在库 / 已拣货减少，SN 转为已发货）。',
      okText: '确认出库',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => shipMutation.mutate(),
    });
  };

  return (
    <div>
      <PageHeader
        title={
          <span>
            <Button
              type="text"
              aria-label="返回发货列表"
              icon={<ArrowLeftOutlined />}
              onClick={() => void navigate('/shipments')}
            />{' '}
            发货单 {shipment.shipmentNo}
          </span>
        }
        description={`${shipment.warehouseCode} ${shipment.warehouseName} · 订单 ${shipment.orderNo}`}
        secondary={
          canOperate ? (
            <Button
              onClick={() => {
                setTrackingNumber(shipment.trackingNumber ?? '');
                setCarrierCode(shipment.carrierCode ?? '');
                setTrackingOpen(true);
              }}
            >
              录入物流单号
            </Button>
          ) : undefined
        }
        primary={
          shipment.status === 'READY_TO_SHIP' ? (
            <Button type="primary" danger onClick={confirmShip}>
              正式出库
            </Button>
          ) : canOperate ? (
            <Button
              type="primary"
              loading={createPackageMutation.isPending}
              onClick={() => createPackageMutation.mutate()}
            >
              新建包裹
            </Button>
          ) : undefined
        }
      />

      <SectionCard style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <StatusBadge
            tone={SHIPMENT_STATUS_META[shipment.status]?.tone ?? 'neutral'}
            label={SHIPMENT_STATUS_META[shipment.status]?.label ?? shipment.status}
            hint={shipment.status}
          />
          <span>
            物流单号 {shipment.trackingNumber ?? '未录入'}
            {shipment.carrierCode ? `（${shipment.carrierCode}）` : ''}
          </span>
        </div>
        <InfoGrid
          items={[
            { label: '订单', children: shipment.orderNo },
            { label: '仓库', children: `${shipment.warehouseCode} ${shipment.warehouseName}` },
            { label: '创建时间', children: fmtDateTime(shipment.createdAt) },
            {
              label: '出库时间',
              children: shipment.shippedAt ? fmtDateTime(shipment.shippedAt) : '—',
            },
          ]}
        />
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={totalRequired === 0 ? 0 : Math.round((totalPacked / totalRequired) * 100)}
            format={() => `${totalPacked} / ${totalRequired} 件已打包`}
          />
        </div>
      </SectionCard>

      <SectionCard flush title={`待发商品 (${shipment.items.length})`} style={{ marginBottom: 16 }}>
        <DataTable
          rowKey="id"
          dataSource={shipment.items}
          pagination={false}
          emptyTitle="无待发商品"
          columns={[
            { title: 'SKU', dataIndex: 'skuCode', key: 'skuCode', width: 130 },
            { title: '名称', dataIndex: 'skuName', key: 'skuName' },
            { title: '应发数量', dataIndex: 'quantity', key: 'quantity', width: 100 },
            { title: '已打包', dataIndex: 'packedQty', key: 'packedQty', width: 100 },
            {
              title: 'SN',
              key: 'serial',
              render: (_: unknown, row: ShipmentItem) =>
                row.serialTracking ? row.serialNumbers.join(', ') : '—',
            },
          ]}
        />
      </SectionCard>

      {shipment.voidedItems.length > 0 && (
        <Collapse
          size="small"
          defaultActiveKey={[]}
          style={{ marginBottom: 16 }}
          items={[
            {
              key: 'voided',
              label: `已作废 / 历史记录 (${shipment.voidedItems.length})`,
              children: (
                <DataTable
                  rowKey="id"
                  dataSource={shipment.voidedItems}
                  pagination={false}
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
                      // 作废行的行状态：VOIDED（或缺失）统一呈现为已作废，
                      // 不再误用发货单状态表（Phase 3 T4）。
                      render: (value: string | undefined) =>
                        value === 'ACTIVE' ? (
                          <StatusBadge
                            tone={SHIPMENT_STATUS_META['EXCEPTION']?.tone ?? 'warning'}
                            label="行已作废"
                            hint={value}
                            showDot={false}
                          />
                        ) : (
                          <StatusBadge
                            tone="neutral"
                            label="已作废"
                            hint={value ?? 'VOIDED'}
                            showDot={false}
                          />
                        ),
                    },
                    {
                      title: '作废原因',
                      dataIndex: 'voidReason',
                      key: 'voidReason',
                      render: (value: string | null) => value ?? '—',
                    },
                    {
                      title: '作废时间',
                      dataIndex: 'voidedAt',
                      key: 'voidedAt',
                      width: 170,
                      render: (value: string | null) => (value ? fmtDateTime(value) : '—'),
                    },
                    {
                      title: '作废人',
                      dataIndex: 'voidedByName',
                      key: 'voidedByName',
                      width: 120,
                      render: (value: string | null) => value ?? '—',
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
                          (row.voidSourceType ?? '—')
                        ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      )}

      <SectionCard flush title={`包裹 (${shipment.packages.length})`} style={{ marginBottom: 16 }}>
        <DataTable
          rowKey="id"
          dataSource={shipment.packages}
          pagination={false}
          emptyTitle="暂无包裹"
          emptyDescription="待打包/打包中的发货单可新建包裹。"
          onRow={(record) => ({
            onDoubleClick: () => {
              if (record.status === 'OPEN' || record.status === 'REPACK_REQUIRED') {
                void navigate(`/packages/${record.id}`);
              }
            },
            style: {
              cursor:
                record.status === 'OPEN' || record.status === 'REPACK_REQUIRED'
                  ? 'pointer'
                  : undefined,
            },
          })}
          columns={[
            { title: '包裹号', dataIndex: 'packageNo', key: 'packageNo', width: 140 },
            {
              title: '状态',
              dataIndex: 'status',
              key: 'status',
              width: 130,
              render: (value: string) => (
                <StatusBadge
                  tone={PACKAGE_STATUS_META[value]?.tone ?? 'neutral'}
                  label={PACKAGE_STATUS_META[value]?.label ?? value}
                  hint={value}
                  showDot={false}
                />
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
              render: (value: string | null) => (value ? fmtDateTime(value) : '—'),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
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
      </SectionCard>

      <Modal
        title="录入物流信息"
        open={trackingOpen}
        confirmLoading={trackingMutation.isPending}
        okText="保存"
        cancelText="取消"
        onCancel={() => setTrackingOpen(false)}
        onOk={() => trackingMutation.mutate()}
      >
        <Space orientation="vertical" style={{ width: '100%' }}>
          <Input
            size="large"
            placeholder="物流单号"
            value={trackingNumber}
            onChange={(event) => setTrackingNumber(event.target.value)}
          />
          <Input
            size="large"
            placeholder="承运商代码（如 CDEK）"
            value={carrierCode}
            onChange={(event) => setCarrierCode(event.target.value)}
          />
        </Space>
      </Modal>
    </div>
  );
}
