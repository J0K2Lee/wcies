import { useState } from 'react';
import {
  App as AntdApp,
  Badge,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Space,
  Steps,
  Timeline,
} from 'antd';
import { useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';

/**
 * Interception workbench (Sprint 4 task §61): big-button scan UI showing
 * WHAT to find (order / SKU / SN), WHERE to find it (original picking bins)
 * and the return-to-stock target bin. Scan validates SKU/SN/bin on the
 * backend; return-to-stock is the only stock-touching step.
 */

interface InterceptionDetail {
  id: string;
  interceptionNo: string;
  orderNo: string;
  orderErpStatus: string;
  warehouseCode: string;
  status: string;
  reason: string | null;
  assignedToName: string | null;
  targetBinId: string | null;
  failedReason: string | null;
  returnedToStockAt: string | null;
  createdAt: string;
  item: {
    orderItemId: string;
    skuId: string;
    skuCode: string;
    skuName: string;
    serialTracking: boolean;
    remainingQty: string;
    pickedSerialNumbers: string[];
    pickBins: Array<{ binCode: string; pickedQty: string; shippedQty: string }>;
    packedPackages: Array<{ packageNo: string; status: string; quantity: string }>;
  } | null;
  history: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    action: string;
    operatorName: string;
    createdAt: string;
  }>;
}

const STATUS_STEPS = ['CREATED', 'LOCATING', 'INTERCEPTED', 'RETURNED_TO_STOCK', 'CLOSED'];

export function InterceptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { modal } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [barcode, setBarcode] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [binBarcode, setBinBarcode] = useState('');
  const [failReason, setFailReason] = useState('');
  const [failOpen, setFailOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  const query = useApiQuery<{ data: InterceptionDetail }>(
    '/api/v1/interceptions/{id}',
    {},
    ['interception', id],
    id === undefined ? undefined : { id },
  );
  const detail = query.data?.data;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['interception', id] });
  };

  const act = useMutation({
    mutationFn: (input: { path: string; body?: Record<string, unknown> }) =>
      apiPost(input.path, input.body ?? {}, { id: id as string }),
    onSuccess: () => {
      setFeedback({ kind: 'success', text: '✓ 操作成功' });
      setBarcode('');
      setSerialNumber('');
      setBinBarcode('');
      refresh();
    },
    onError: (error: Error) => {
      setFeedback({ kind: 'error', text: `✗ ${error.message}` });
    },
  });

  if (detail === undefined) {
    return <Card loading title="拦截任务" />;
  }

  const item = detail.item;
  const activeStep = Math.max(0, STATUS_STEPS.indexOf(detail.status));
  const canWork = ['CREATED', 'ASSIGNED', 'LOCATING'].includes(detail.status);

  const confirmReturn = (): void => {
    modal.confirm({
      title: '确认回库？',
      content:
        '将执行 Picked - N（On Hand 不变），SN 回到目标库位，关联包裹同步解除。该操作原子执行。',
      okText: '确认回库',
      onOk: () =>
        act.mutate({
          path: '/api/v1/interceptions/{id}/return-to-stock',
          body: binBarcode.trim() === '' ? {} : { binBarcode: binBarcode.trim() },
        }),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="拦截单号">
            <span style={{ fontSize: 18, fontWeight: 700 }}>{detail.interceptionNo}</span>
          </Descriptions.Item>
          <Descriptions.Item label="订单">{detail.orderNo}</Descriptions.Item>
          <Descriptions.Item label="仓库">{detail.warehouseCode}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Badge
              status={
                detail.status === 'RETURNED_TO_STOCK' || detail.status === 'CLOSED'
                  ? 'success'
                  : detail.status === 'FAILED'
                    ? 'error'
                    : 'processing'
              }
              text={detail.status}
            />
          </Descriptions.Item>
          <Descriptions.Item label="取消原因" span={2}>
            {detail.reason ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="指派给">{detail.assignedToName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {new Date(detail.createdAt).toLocaleString()}
          </Descriptions.Item>
        </Descriptions>
        {detail.status !== 'FAILED' && (
          <Steps
            size="small"
            current={activeStep}
            items={STATUS_STEPS.map((step) => ({ title: step }))}
          />
        )}
      </Card>

      <Card size="small" title={<span style={{ fontSize: 16 }}>要找什么 / 在哪里找</span>}>
        {item === null ? (
          '缺少订单行信息'
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>
              {item.skuCode} ×{Number(item.remainingQty)}
              <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 12 }}>{item.skuName}</span>
            </div>
            <div>
              原拣货库位：
              {item.pickBins
                .filter((bin) => Number(bin.pickedQty) > Number(bin.shippedQty))
                .map(
                  (bin) => `${bin.binCode}（余 ${Number(bin.pickedQty) - Number(bin.shippedQty)}）`,
                )
                .join('、') || '无'}
            </div>
            {item.serialTracking && (
              <div style={{ color: '#fa8c16', fontSize: 16 }}>
                需找回 SN：{item.pickedSerialNumbers.join(', ') || '无'}
              </div>
            )}
            {item.packedPackages.length > 0 && (
              <div>
                已打包：
                {item.packedPackages
                  .map((pkg) => `${pkg.packageNo}（${pkg.status} ×${Number(pkg.quantity)}）`)
                  .join('、')}
              </div>
            )}
          </Space>
        )}
      </Card>

      {canWork && item !== null && (
        <Card
          size="small"
          title={
            <span style={{ fontSize: 16 }}>拦截扫码（SKU + 目标库位必扫，SN 商品加扫 SN）</span>
          }
          style={{ borderColor: '#1677ff' }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Input
              size="large"
              placeholder="扫描 SKU 条码…"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              style={{ fontSize: 20, padding: '8px 16px' }}
              autoFocus
            />
            {item.serialTracking && (
              <Input
                size="large"
                placeholder="扫描序列号 SN…"
                value={serialNumber}
                onChange={(event) => setSerialNumber(event.target.value)}
                style={{ fontSize: 18, padding: '6px 16px' }}
              />
            )}
            <Input
              size="large"
              placeholder="扫描目标回库库位条码…"
              value={binBarcode}
              onChange={(event) => setBinBarcode(event.target.value)}
              style={{ fontSize: 18, padding: '6px 16px' }}
            />
            <Space wrap>
              <Button
                type="primary"
                size="large"
                loading={act.isPending}
                onClick={() => {
                  const body: Record<string, unknown> = {
                    barcode: barcode.trim(),
                    binBarcode: binBarcode.trim(),
                  };
                  const sn = serialNumber.trim();
                  if (sn !== '') {
                    body.serialNumber = sn;
                  }
                  act.mutate({ path: '/api/v1/interceptions/{id}/scan', body });
                }}
              >
                验证扫码（→ INTERCEPTED）
              </Button>
              <Button
                size="large"
                onClick={() => act.mutate({ path: '/api/v1/interceptions/{id}/start' })}
              >
                开始查找
              </Button>
              <Button
                size="large"
                onClick={() => act.mutate({ path: '/api/v1/interceptions/{id}/assign' })}
              >
                指派给我
              </Button>
              <Button danger size="large" onClick={() => setFailOpen(true)}>
                标记失败
              </Button>
            </Space>
            {feedback !== null && (
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  padding: '10px 16px',
                  borderRadius: 8,
                  color: feedback.kind === 'success' ? '#237804' : '#a8071a',
                  background: feedback.kind === 'success' ? '#f6ffed' : '#fff1f0',
                  border: `1px solid ${feedback.kind === 'success' ? '#b7eb8f' : '#ffa39e'}`,
                }}
              >
                {feedback.text}
              </div>
            )}
          </Space>
        </Card>
      )}

      {detail.status === 'INTERCEPTED' && (
        <Card size="small">
          <Button type="primary" danger size="large" onClick={confirmReturn}>
            确认回库（Picked - N，OnHand 不变）
          </Button>
        </Card>
      )}

      {['RETURNED_TO_STOCK', 'FAILED'].includes(detail.status) && detail.status !== 'CLOSED' && (
        <Card size="small">
          <Button
            size="large"
            onClick={() => act.mutate({ path: '/api/v1/interceptions/{id}/close' })}
          >
            关闭拦截任务
          </Button>
          {detail.failedReason !== null && (
            <div style={{ marginTop: 8, color: '#a8071a' }}>失败原因：{detail.failedReason}</div>
          )}
        </Card>
      )}

      <Card size="small" title="操作历史">
        <Timeline
          items={detail.history.map((entry) => ({
            children: (
              <span>
                {entry.fromStatus === null ? '∅' : entry.fromStatus} →{' '}
                <strong>{entry.toStatus}</strong>（{entry.action}，{entry.operatorName}，
                {new Date(entry.createdAt).toLocaleString()}）
              </span>
            ),
          }))}
        />
      </Card>

      <Modal
        title="标记拦截失败（找不到商品）"
        open={failOpen}
        confirmLoading={act.isPending}
        onCancel={() => setFailOpen(false)}
        onOk={() =>
          act.mutate({
            path: '/api/v1/interceptions/{id}/fail',
            body: { reason: failReason.trim() === '' ? undefined : failReason.trim() },
          })
        }
      >
        <Input
          placeholder="失败原因（库存保持 Picked，将创建异常）"
          value={failReason}
          onChange={(event) => setFailReason(event.target.value)}
        />
      </Modal>
    </div>
  );
}
