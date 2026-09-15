import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { Link } from 'react-router';
import { App as AntdApp, Button, Input, InputRef, Popconfirm, Progress } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';
import {
  PACKAGE_STATUS_META,
  ScanFeedback,
  ScanFeedbackData,
  SHIPMENT_STATUS_META,
  StatusBadge,
  colors,
  typography,
} from '../../design-system';

/**
 * Package workbench (Sprint 4 task §59): create → scan SKU → progress →
 * seal, with the same warehouse-friendly big-feedback UX as the picking
 * workbench (DS ScanFeedback). Scanning never touches stock.
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
  const [feedback, setFeedback] = useState<ScanFeedbackData | null>(null);

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
        title: '已装',
        detail: `${result.skuCode}（${result.packedQty} / ${result.requiredQty}）`,
        progress: `${result.packedQty} / ${result.requiredQty}`,
      });
      setBarcode('');
      setSerialNumber('');
      refresh();
    },
    onError: (error: Error) => {
      setFeedback({ kind: 'error', title: '扫码失败', detail: error.message });
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
    return <div style={{ padding: 24 }}>加载中…</div>;
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

  const lineStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: `1px solid ${colors.borderSoft}`,
    fontSize: 16,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header strip: id + status + progress + primary seal button (spec §12). */}
      <div
        style={{
          background: colors.container,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {pkg.packageNo}
          </span>
          <span style={{ fontSize: 13, color: colors.textSecondary }}>
            发货单{' '}
            <Link to={`/shipments/${pkg.shipmentId}`} style={{ color: colors.primary }}>
              {workbench.shipmentNo}
            </Link>
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <StatusBadge
            tone={PACKAGE_STATUS_META[pkg.status]?.tone ?? 'neutral'}
            label={PACKAGE_STATUS_META[pkg.status]?.label ?? pkg.status}
            hint={pkg.status}
          />
          <StatusBadge
            tone={SHIPMENT_STATUS_META[workbench.shipmentStatus]?.tone ?? 'neutral'}
            label={
              SHIPMENT_STATUS_META[workbench.shipmentStatus]?.label ?? workbench.shipmentStatus
            }
            hint={workbench.shipmentStatus}
            showDot={false}
          />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 12.5, color: colors.textSecondary }}>装箱进度</span>
            <span style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
              {totalPacked} / {totalRequired}
            </span>
          </div>
          <Progress
            percent={totalRequired === 0 ? 0 : Math.round((totalPacked / totalRequired) * 100)}
            showInfo={false}
            size={{ height: 8 }}
            strokeColor={totalPacked === totalRequired ? colors.success : colors.primary}
          />
        </div>
        {open && (
          /* 封箱 = L1 轻确认（UI 规范 §12）。 */
          <Popconfirm
            title="确认封箱？"
            description="封箱后本包裹不可再扫码装货；需要调整时将生成重新打包任务。"
            okText="封箱"
            cancelText="取消"
            onConfirm={() => sealMutation.mutate()}
          >
            <Button type="primary" size="large" loading={sealMutation.isPending}>
              封箱（Seal）
            </Button>
          </Popconfirm>
        )}
      </div>

      {open && (
        <div
          style={{
            background: colors.container,
            border: `1px solid ${colors.primary}`,
            borderRadius: 12,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <label
            htmlFor="package-scan-input"
            style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}
          >
            扫码装箱（每次 1 件，回车提交；不改动库存）
          </label>
          <Input
            id="package-scan-input"
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
          <ScanFeedback feedback={feedback} />
        </div>
      )}

      <div
        style={{
          background: colors.container,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '13px 20px',
            borderBottom: `1px solid ${colors.borderSoft}`,
            fontSize: typography.cardTitle.size,
            fontWeight: 600,
          }}
        >
          待装商品（{workbench.demand.length}）
        </div>
        {workbench.demand.map((row) => (
          <div key={row.orderItemId} style={{ ...lineStyle, padding: '8px 20px' }}>
            <span>
              <strong>{row.skuCode}</strong> {row.skuName}
              {row.serialTracking && (
                <span style={{ color: colors.warning, marginLeft: 8 }}>
                  SN：{row.pendingSerialNumbers.join(', ') || '全部已装'}
                </span>
              )}
            </span>
            <span>
              已装 {Number(row.packedQty)} / 应装 {Number(row.requiredQty)}
            </span>
          </div>
        ))}
      </div>

      {workbench.items.length > 0 && (
        <div
          style={{
            background: colors.container,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '13px 20px',
              borderBottom: `1px solid ${colors.borderSoft}`,
              fontSize: typography.cardTitle.size,
              fontWeight: 600,
            }}
          >
            本包裹已装（{workbench.items.length}）
          </div>
          {workbench.items.map((row) => (
            <div key={row.id} style={{ ...lineStyle, padding: '8px 20px' }}>
              <span>
                <strong>{row.skuCode}</strong> {row.skuName}
                {row.serialNumbers.length > 0 && (
                  <span style={{ color: colors.warning, marginLeft: 8 }}>
                    SN：{row.serialNumbers.join(', ')}
                  </span>
                )}
              </span>
              <span>×{Number(row.quantity)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
