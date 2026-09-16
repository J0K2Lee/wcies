import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useNavigate } from 'react-router';
import { App as AntdApp, Button, Input, InputRef, Popconfirm, Progress, Skeleton } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../../api/hooks';
import {
  ContextMetric,
  ContextSection,
  EmptyState,
  PICKING_STATUS_META,
  ScanFeedback,
  StatusBadge,
  colors,
  typography,
  ScanFeedbackData,
} from '../../design-system';

/**
 * Picking workbench (redesign task §46-§51) — warehouse operation mode. The
 * shell already collapses the left nav for `/picking/:id`; this page owns the
 * full viewport: header progress strip, next-bin focus card, large scan sink
 * with big success/error feedback, item list, and a right task-info rail.
 * Scan business logic (start/scan/complete + SN handling) is unchanged.
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
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const barcodeRef = useRef<InputRef>(null);
  const [barcode, setBarcode] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [feedback, setFeedback] = useState<ScanFeedbackData | null>(null);
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
      setFeedback({
        kind: 'success',
        title: '扫码成功',
        detail: result.message,
        progress: `${Number(result.pickedQty)} / ${Number(result.requiredQty)}`,
      });
      setBarcode('');
      setSerialNumber('');
      void queryClient.invalidateQueries({ queryKey: ['picking-task', id] });
    },
    onError: (error: Error) => {
      setFeedback({ kind: 'error', title: '商品错误', detail: error.message });
      setBarcode('');
    },
  });

  // Scanner sink contract (task §49): always refocus after every outcome.
  useEffect(() => {
    barcodeRef.current?.focus();
  }, [feedback, task?.status]);

  const totals = useMemo(() => {
    if (task === undefined) {
      return { required: 0, picked: 0, lines: 0, doneLines: 0 };
    }
    return {
      required: task.items.reduce((sum, item) => sum + Number(item.requiredQty), 0),
      picked: task.items.reduce((sum, item) => sum + Number(item.pickedQty), 0),
      lines: task.items.length,
      doneLines: task.items.filter((item) => item.status === 'PICKED').length,
    };
  }, [task]);

  // Next focus: first unfinished item's first unfinished bin (task §47).
  const nextItem = useMemo(() => task?.items.find((item) => item.status !== 'PICKED'), [task]);
  const nextBin = useMemo(() => {
    if (nextItem === undefined) {
      return null;
    }
    return (
      nextItem.binLines.find((line) => Number(line.pickedQty) < Number(line.quantity)) ??
      nextItem.binLines[0] ??
      null
    );
  }, [nextItem]);
  const remainingBins = useMemo(() => {
    if (task === undefined) {
      return [];
    }
    const seen = new Set<string>();
    for (const item of task.items) {
      if (item.status === 'PICKED') {
        continue;
      }
      for (const line of item.binLines) {
        if (Number(line.pickedQty) < Number(line.quantity)) {
          seen.add(line.binCode);
        }
      }
    }
    return [...seen];
  }, [task]);

  if (task === undefined) {
    return (
      <div style={{ padding: 24 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    );
  }

  const inProgress = task.status === 'IN_PROGRESS';
  const serialItem = task.items.find((item) => item.status === 'PENDING' && item.serialTracking);
  const percent = totals.required === 0 ? 0 : Math.round((totals.picked / totals.required) * 100);

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
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      {/* ---- Main operation area ---- */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Header strip (task §47): id + warehouse + progress + controls */}
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
          <Button
            type="text"
            aria-label="返回拣货列表"
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate('/warehouse-ops?tab=picking')}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {task.pickingNo}
            </span>
            <span style={{ fontSize: 13, color: colors.textSecondary }}>
              {task.warehouseCode} {task.warehouseName} · {task.ordersCount} 单
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 12.5, color: colors.textSecondary }}>拣货进度</span>
              <span style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
                {totals.picked} / {totals.required}
              </span>
            </div>
            <Progress
              percent={percent}
              showInfo={false}
              size={{ height: 8 }}
              strokeColor={percent === 100 ? colors.success : colors.primary}
            />
          </div>
          <StatusBadge
            tone={PICKING_STATUS_META[task.status]?.tone ?? 'neutral'}
            label={PICKING_STATUS_META[task.status]?.label ?? task.status}
            hint={task.status}
          />
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
            /* 完成=终态推进主操作（UI 规范 §12），L1 轻确认。 */
            <Popconfirm
              title="确认完成任务？"
              description="需全部行拣完才能完成；完成后任务进入终态。"
              okText="完成任务"
              cancelText="取消"
              onConfirm={() => completeMutation.mutate()}
            >
              <Button type="primary" size="large" loading={completeMutation.isPending}>
                完成任务（需全部行拣完）
              </Button>
            </Popconfirm>
          )}
        </div>

        {/* Next bin focus card (task §47) */}
        {(inProgress || task.status === 'COMPLETED') &&
          nextItem !== undefined &&
          nextBin !== null && (
            <div
              style={{
                background: colors.container,
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: '18px 24px',
                display: 'flex',
                alignItems: 'center',
                gap: 28,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 4 }}>
                  下一库位
                </div>
                <div
                  style={{
                    fontSize: 40,
                    fontWeight: 750,
                    lineHeight: '44px',
                    color: colors.primaryActive,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: 1,
                  }}
                >
                  {nextBin.binCode}
                </div>
              </div>
              <div style={{ minWidth: 220, flex: 1 }}>
                <div style={{ fontSize: 17, fontWeight: 650 }}>{nextItem.skuCode}</div>
                <div style={{ fontSize: 13.5, color: colors.textSecondary, marginTop: 2 }}>
                  {nextItem.skuName}
                  {nextItem.serialTracking && (
                    <span style={{ color: colors.warning, marginLeft: 8 }}>SN 商品</span>
                  )}
                </div>
                <div style={{ fontSize: 13, color: colors.textTertiary, marginTop: 6 }}>
                  订单 {nextItem.orderNo}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 28 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12.5, color: colors.textSecondary }}>需要</div>
                  <div
                    style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Number(nextItem.requiredQty)}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 12.5, color: colors.textSecondary }}>已拣</div>
                  <div
                    style={{
                      fontSize: 28,
                      fontWeight: 700,
                      color: colors.success,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {Number(nextItem.pickedQty)}
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* Scan sink — the visual focus (task §49) */}
        {(inProgress || task.status === 'COMPLETED') && (
          <div
            style={{
              background: colors.container,
              border: `1px solid ${inProgress ? colors.primary : colors.border}`,
              borderRadius: 12,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <label
              htmlFor="picking-scan-input"
              style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}
            >
              扫描商品条码（每次 1 件，回车提交）
            </label>
            <Input
              id="picking-scan-input"
              ref={barcodeRef}
              size="large"
              placeholder="扫描 SKU 条码…"
              value={barcode}
              disabled={!inProgress}
              onChange={(event) => setBarcode(event.target.value)}
              onPressEnter={submitScan}
              style={{ fontSize: 20, padding: '10px 16px' }}
              autoFocus
            />
            {serialItem !== undefined && (
              <Input
                size="large"
                placeholder={`SN 商品（${serialItem.skuCode}）请再扫序列号`}
                value={serialNumber}
                disabled={!inProgress}
                onChange={(event) => setSerialNumber(event.target.value)}
                onPressEnter={submitScan}
                style={{ fontSize: 17, padding: '8px 16px' }}
              />
            )}
            <ScanFeedback feedback={feedback} />
          </div>
        )}

        {/* Item list */}
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
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            待拣行（{totals.doneLines} / {totals.lines} 完成）
          </div>
          {task.items.length === 0 ? (
            <EmptyState title="暂无待拣行" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {task.items.map((item) => {
                const remaining = Number(item.requiredQty) - Number(item.pickedQty);
                const done = item.status === 'PICKED';
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      padding: '12px 20px',
                      borderBottom: `1px solid ${colors.borderSoft}`,
                      opacity: done ? 0.6 : 1,
                      background:
                        nextItem !== undefined && item.id === nextItem.id && !done
                          ? colors.primarySoft
                          : undefined,
                    }}
                  >
                    <div style={{ minWidth: 64, textAlign: 'center' }}>
                      <div
                        style={{
                          fontSize: 22,
                          fontWeight: 700,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {Number(item.pickedQty)} / {Number(item.requiredQty)}
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>
                        {item.skuCode}{' '}
                        <span style={{ fontWeight: 400, color: colors.textSecondary }}>
                          {item.skuName}
                        </span>
                        {item.serialTracking && (
                          <StatusBadge tone="warning" label="SN" showDot={false} />
                        )}
                      </div>
                      <div style={{ color: colors.textSecondary, fontSize: 12.5, marginTop: 3 }}>
                        订单 {item.orderNo} · 剩余 {remaining} 件
                        {item.primaryBarcode !== null && ` · 条码 ${item.primaryBarcode}`}
                      </div>
                      {item.pendingSerialNumbers.length > 0 && (
                        <div style={{ marginTop: 4, color: colors.warning, fontSize: 12.5 }}>
                          待扫 SN：{item.pendingSerialNumbers.join('、')}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 280 }}>
                      {item.binLines.map((line, index) => (
                        <StatusBadge
                          key={index}
                          tone={line.pickedQty === line.quantity ? 'success' : 'info'}
                          label={`${line.binCode} ×${Number(line.quantity)}${
                            Number(line.pickedQty) > 0 ? `（已拣 ${Number(line.pickedQty)}）` : ''
                          }`}
                          showDot={false}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- Right task info rail (task §48) ---- */}
      <aside
        style={{
          width: 280,
          flexShrink: 0,
          position: 'sticky',
          top: 0,
          background: colors.container,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          overflow: 'hidden',
        }}
        aria-label="任务信息"
      >
        <div
          style={{
            padding: '13px 18px',
            borderBottom: `1px solid ${colors.borderSoft}`,
            fontSize: typography.cardTitle.size,
            fontWeight: 600,
          }}
        >
          任务概要
        </div>
        <ContextSection title="任务">
          <ContextMetric label="订单数" value={task.ordersCount} />
          <ContextMetric label="商品行" value={`${totals.doneLines} / ${totals.lines}`} />
          <ContextMetric label="总件数" value={totals.required} strong />
        </ContextSection>
        <ContextSection title="当前进度">
          <ContextMetric
            label="已拣"
            value={
              <span style={{ color: colors.success, fontWeight: 650 }}>
                {totals.picked} / {totals.required}
              </span>
            }
            strong
          />
          <Progress
            percent={percent}
            showInfo={false}
            size={{ height: 6 }}
            strokeColor={percent === 100 ? colors.success : colors.primary}
          />
        </ContextSection>
        <ContextSection title={`剩余库位（${remainingBins.length}）`}>
          {remainingBins.length === 0 ? (
            <span style={{ fontSize: 12.5, color: colors.textTertiary }}>全部库位已拣完</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {remainingBins.map((binCode) => (
                <span
                  key={binCode}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: colors.primarySoft,
                    color: colors.primaryActive,
                  }}
                >
                  {binCode}
                </span>
              ))}
            </div>
          )}
        </ContextSection>
        <ContextSection title="异常">
          <ContextMetric
            label="扫码异常"
            value={feedback?.kind === 'error' ? 1 : 0}
            strong={feedback?.kind === 'error'}
          />
        </ContextSection>
      </aside>
    </div>
  );
}
