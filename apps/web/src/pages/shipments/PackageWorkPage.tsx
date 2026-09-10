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
} from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';

/**
 * Package workbench (Sprint 4 task §59): create → scan SKU → progress →
 * seal, with the same warehouse-friendly big-feedback UX as the picking
 * workbench (big green on success, big red on failure). Scanning never
 * touches stock.
 */

interface Workbench {
  package: {
    id: string;
    packageNo: string;
    shipmentId: string;
    status: string;
    sealedAt: string | null;
    createdAt: string;
  };
  shipmentNo: string;
  shipmentStatus: string;
  items: Array<{
    id: string;
    skuCode: string;
    skuName: string;
    quantity: string;
    serialNumbers: string[];
  }>;
  demand: Array<{
    orderItemId: string;
    skuCode: string;
    skuName: string;
    primaryBarcode: string | null;
    requiredQty: string;
    packedQty: string;
    serialTracking: boolean;
    pendingSerialNumbers: string[];
  }>;
}

export function PackageWorkPage() {
  const { id } = useParams<{ id: string }>();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const barcodeRef = useRef<InputRef>(null);
  const [barcode, setBarcode] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );

  const query = useApiQuery<{ data: Workbench }>(
    '/api/v1/packages/{id}/workbench',
    {},
    ['package-workbench', id],
    id === undefined ? undefined : { id },
  );
  const workbench = query.data?.data;

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['package-workbench', id] });
  };

  const scanMutation = useMutation({
    mutationFn: (input: { barcode: string; serialNumber?: string }) =>
      apiPost<{ message: string; skuCode: string; packedQty: string; requiredQty: string }>(
        '/api/v1/packages/{id}/items/scan',
        input,
        { id: id as string },
      ),
    onSuccess: (result) => {
      setFeedback({
        kind: 'success',
        text: `✓ 已装 ${result.skuCode}（${result.packedQty} / ${result.requiredQty}）`,
      });
      setBarcode('');
      setSerialNumber('');
      refresh();
    },
    onError: (error: Error) => {
      setFeedback({ kind: 'error', text: `✗ ${error.message}` });
      setBarcode('');
    },
  });

  const sealMutation = useMutation({
    mutationFn: () => apiPost('/api/v1/packages/{id}/seal', {}, { id: id as string }),
    onSuccess: () => {
      message.success('包裹已封箱');
      refresh();
    },
    onError: (error: Error) => message.error(`封箱失败：${error.message}`),
  });

  useEffect(() => {
    barcodeRef.current?.focus();
  }, [feedback, workbench?.package.status]);

  if (workbench === undefined) {
    return <Card loading title="打包作业" />;
  }

  const pkg = workbench.package;
  const open = pkg.status === 'OPEN' || pkg.status === 'REPACK_REQUIRED';
  const totalRequired = workbench.demand.reduce((sum, row) => sum + Number(row.requiredQty), 0);
  const totalPacked = workbench.demand.reduce((sum, row) => sum + Number(row.packedQty), 0);
  const serialDemand = workbench.demand.find(
    (row) => row.serialTracking && Number(row.packedQty) < Number(row.requiredQty),
  );

  const submitScan = (): void => {
    const trimmed = barcode.trim();
    if (trimmed === '' || scanMutation.isPending) {
      return;
    }
    const input: { barcode: string; serialNumber?: string } = { barcode: trimmed };
    const sn = serialNumber.trim();
    if (sn !== '') {
      input.serialNumber = sn;
    }
    scanMutation.mutate(input);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card size="small">
        <Descriptions size="small" column={4}>
          <Descriptions.Item label="包裹号">
            <span style={{ fontSize: 18, fontWeight: 700 }}>{pkg.packageNo}</span>
          </Descriptions.Item>
          <Descriptions.Item label="发货单">
            <a href={`#/shipments/${pkg.shipmentId}`}>{workbench.shipmentNo}</a>
          </Descriptions.Item>
          <Descriptions.Item label="包裹状态">
            <Badge status={pkg.status === 'SEALED' ? 'success' : 'processing'} text={pkg.status} />
          </Descriptions.Item>
          <Descriptions.Item label="发货单状态">{workbench.shipmentStatus}</Descriptions.Item>
        </Descriptions>
        <Progress
          percent={totalRequired === 0 ? 0 : Math.round((totalPacked / totalRequired) * 100)}
          format={() => `${totalPacked} / ${totalRequired} 件已装`}
        />
        {open && (
          <Button
            type="primary"
            size="large"
            style={{ marginTop: 8 }}
            loading={sealMutation.isPending}
            onClick={() => sealMutation.mutate()}
          >
            封箱（Seal）
          </Button>
        )}
      </Card>

      {open && (
        <Card
          size="small"
          title={<span style={{ fontSize: 16 }}>扫码装箱（每次 1 件，回车提交；不改动库存）</span>}
          style={{ borderColor: '#1677ff' }}
        >
          <Space orientation="vertical" style={{ width: '100%' }} size={12}>
            <Input
              ref={barcodeRef}
              size="large"
              placeholder="扫描 SKU 条码…"
              value={barcode}
              onChange={(event) => setBarcode(event.target.value)}
              onPressEnter={submitScan}
              style={{ fontSize: 20, padding: '8px 16px' }}
              autoFocus
            />
            {serialDemand !== undefined && (
              <Input
                size="large"
                placeholder={`SN 商品（${serialDemand.skuCode}）请再扫序列号`}
                value={serialNumber}
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

      <Card size="small" title={`待装商品 (${workbench.demand.length})`}>
        {workbench.demand.map((row) => (
          <div
            key={row.orderItemId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '8px 0',
              borderBottom: '1px solid #f0f0f0',
              fontSize: 16,
            }}
          >
            <span>
              <strong>{row.skuCode}</strong> {row.skuName}
              {row.serialTracking && (
                <span style={{ color: '#fa8c16', marginLeft: 8 }}>
                  SN：{row.pendingSerialNumbers.join(', ') || '全部已装'}
                </span>
              )}
            </span>
            <span>
              已装 {Number(row.packedQty)} / 应装 {Number(row.requiredQty)}
            </span>
          </div>
        ))}
      </Card>

      {workbench.items.length > 0 && (
        <Card size="small" title={`本包裹已装 (${workbench.items.length})`}>
          {workbench.items.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid #f0f0f0',
                fontSize: 16,
              }}
            >
              <span>
                <strong>{row.skuCode}</strong> {row.skuName}
                {row.serialNumbers.length > 0 && (
                  <span style={{ color: '#fa8c16', marginLeft: 8 }}>
                    SN：{row.serialNumbers.join(', ')}
                  </span>
                )}
              </span>
              <span>×{Number(row.quantity)}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
