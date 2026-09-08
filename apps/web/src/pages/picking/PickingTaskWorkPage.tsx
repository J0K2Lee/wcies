import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import {
  App as AntdApp,
  Badge,
  Button,
  Card,
  Descriptions,
  Input,
  InputRef,
  Progress,
  Space,
  Tag,
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';

/**
 * Picking work page (Sprint 3 task §46-§51): warehouse-friendly big layout.
 * The scan box behaves like a USB/Bluetooth scanner sink: auto-focus, Enter
 * submits, re-focus after every result; failures render a BIG red banner and
 * never touch stock. Multi-bin demand shows as "A01 ×2 / A02 ×3".
 */

interface PickingItem {
  id: string;
  orderId: string;
  orderNo: string;
  skuCode: string;
  skuName: string;
  primaryBarcode: string | null;
  requiredQty: string;
  pickedQty: string;
  status: string;
  binLines: Array<{ binCode: string; quantity: string; pickedQty: string }>;
  serialTracking: boolean;
  pendingSerialNumbers: string[];
}

interface TaskDetail {
  id: string;
  pickingNo: string;
  warehouseCode: string;
  warehouseName: string;
  status: string;
  ordersCount: number;
  createdAt: string;
  items: PickingItem[];
}

export function PickingTaskWorkPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const barcodeRef = useRef<InputRef>(null);
  const [barcode, setBarcode] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const query = useApiQuery<{ data: TaskDetail }>(
    '/api/v1/picking-tasks/{id}',
    {},
    ['picking-task', id],
    id === undefined ? undefined : { id },
  );
  const task = query.data?.data;

  const startMutation = useMutation({
    mutationFn: () => apiPost('/api/v1/picking-tasks/{id}/start', {}, { id: id as string }),
    onSuccess: () => {
      message.success('任务已开始');
      void queryClient.invalidateQueries({ queryKey: ['picking-task', id] });
    },
    onError: (error: Error) => message.error(`开始失败：${error.message}`),
  });

  const completeMutation = useMutation({
    mutationFn: () => apiPost('/api/v1/picking-tasks/{id}/complete', {}, { id: id as string }),
    onSuccess: () => {
      message.success('任务已完成');
      void queryClient.invalidateQueries({ queryKey: ['picking-task', id] });
    },
    onError: (error: Error) => message.error(`完成失败：${error.message}`),
  });

  const scanMutation = useMutation({
    mutationFn: (input: { barcode: string; serialNumber?: string }) =>
      apiPost<{ message: string; itemStatus: string; pickedQty: string; requiredQty: string }>(
        '/api/v1/picking-tasks/{id}/scan',
        input,
        { id: id as string },
      ),
    onSuccess: (result: {
      message: string;
      itemStatus: string;
      pickedQty: string;
      requiredQty: string;
    }) => {
      setFeedback({ kind: 'success', text: `✓ ${result.message}` });
      setBarcode('');
      setSerialNumber('');
      void queryClient.invalidateQueries({ queryKey: ['picking-task', id] });
    },
    onError: (error: Error) => {
      setFeedback({ kind: 'error', text: `✗ ${error.message}` });
      setBarcode('');
    },
  });

  useEffect(() => {
    barcodeRef.current?.focus();
  }, [feedback, task?.status]);

  if (task === undefined) {
    return <Card loading title="拣货任务" />;
  }

  const inProgress = task.status === 'IN_PROGRESS';
  const serialItem = task.items.find((item) => item.status === 'PENDING' && item.serialTracking);
  const totalRequired = task.items.reduce((sum, item) => sum + Number(item.requiredQty), 0);
  const totalPicked = task.items.reduce((sum, item) => sum + Number(item.pickedQty), 0);

  const submitScan = (): void => {
    const trimmed = barcode.trim();
    if (trimmed === '' || busy) {
      return;
    }
    setBusy(true);
    const input: { barcode: string; serialNumber?: string } = { barcode: trimmed };
    const sn = serialNumber.trim();
    if (sn !== '') {
      input.serialNumber = sn;
    }
    scanMutation.mutate(input);
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="拣货单号">
            <span style={{ fontSize: 18, fontWeight: 700 }}>{task.pickingNo}</span>
          </Descriptions.Item>
          <Descriptions.Item label="仓库">{`${task.warehouseCode} ${task.warehouseName}`}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Badge
              status={
                task.status === 'COMPLETED'
                  ? 'success'
                  : task.status === 'IN_PROGRESS'
                    ? 'processing'
                    : 'default'
              }
              text={task.status}
            />
          </Descriptions.Item>
          <Descriptions.Item label="订单数">{task.ordersCount}</Descriptions.Item>
        </Descriptions>
        <Progress
          percent={totalRequired === 0 ? 0 : Math.round((totalPicked / totalRequired) * 100)}
          format={() => `${totalPicked} / ${totalRequired} 件`}
        />
        <Space style={{ marginTop: 8 }}>
          {task.status === 'CREATED' && (
            <Button
              type="primary"
              size="large"
              loading={startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              开始任务
            </Button>
          )}
          {inProgress && (
            <Button
              size="large"
              loading={completeMutation.isPending}
              onClick={() => completeMutation.mutate()}
            >
              完成任务（需全部行拣完）
            </Button>
          )}
        </Space>
      </Card>

      {(inProgress || task.status === 'COMPLETED') && (
        <Card
          size="small"
          title={<span style={{ fontSize: 16 }}>扫码拣货（每次 1 件，回车提交）</span>}
          style={{ borderColor: inProgress ? '#1677ff' : undefined }}
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Space.Compact style={{ width: '100%' }}>
              <Input
                ref={barcodeRef}
                size="large"
                placeholder="扫描 SKU 条码…"
                value={barcode}
                disabled={!inProgress}
                onChange={(event) => setBarcode(event.target.value)}
                onPressEnter={submitScan}
                style={{ fontSize: 20, padding: '8px 16px' }}
                autoFocus
              />
            </Space.Compact>
            {serialItem !== undefined && (
              <Input
                size="large"
                placeholder={`SN 商品（${serialItem.skuCode}）请再扫序列号`}
                value={serialNumber}
                disabled={!inProgress}
                onChange={(event) => setSerialNumber(event.target.value)}
                onPressEnter={submitScan}
                style={{ fontSize: 18, padding: '6px 16px' }}
              />
            )}
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

      <Card size="small" title={`待拣行 (${task.items.length})`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {task.items.map((item) => {
            const remaining = Number(item.requiredQty) - Number(item.pickedQty);
            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '12px 16px',
                  borderRadius: 8,
                  background:
                    item.status === 'PICKED' ? '#f6ffed' : remainingItemsHighlight(item.status),
                  border: `1px solid ${item.status === 'PICKED' ? '#b7eb8f' : '#d9d9d9'}`,
                  opacity: item.status === 'PICKED' ? 0.75 : 1,
                }}
              >
                <div style={{ minWidth: 72, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700 }}>
                    {Number(item.pickedQty)} / {Number(item.requiredQty)}
                  </div>
                  <Tag color={item.status === 'PICKED' ? 'green' : 'blue'}>{item.status}</Tag>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 600 }}>
                    {item.skuCode} <span style={{ fontWeight: 400 }}>{item.skuName}</span>
                    {item.serialTracking && (
                      <Tag color="orange" style={{ marginLeft: 8 }}>
                        SN
                      </Tag>
                    )}
                  </div>
                  <div style={{ color: '#555', marginTop: 4 }}>
                    订单 {item.orderNo} · 剩余 {remaining} 件
                    {item.primaryBarcode !== null && ` · 条码 ${item.primaryBarcode}`}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <Space size={6} wrap>
                      {item.binLines.map((line, index) => (
                        <Tag
                          key={index}
                          color={line.pickedQty === line.quantity ? 'green' : 'geekblue'}
                          style={{ fontSize: 14 }}
                        >
                          {line.binCode} ×{Number(line.quantity)}
                          {Number(line.pickedQty) > 0 && `（已拣 ${Number(line.pickedQty)}）`}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                  {item.serialTracking && item.pendingSerialNumbers.length > 0 && (
                    <div style={{ marginTop: 6, color: '#874d00' }}>
                      待扫 SN：{item.pendingSerialNumbers.join('、')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function remainingItemsHighlight(status: string): string {
  return status === 'PENDING' ? '#fffbe6' : '#fafafa';
}
