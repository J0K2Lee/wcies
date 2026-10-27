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
  CopyTextButton,
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
        {/* 头部条（task §47；2026-10-27 压扁）：任务号 + 仓库 + 进度 + 操作挤在一行。
            原来是 22px 标题 + 两条辅助信息 + 大号按钮，纵向吃掉一整块屏幕。 */}
        <div
          style={{
            background: colors.container,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            padding: '8px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <Button
            type="text"
            aria-label="返回拣货列表"
            icon={<ArrowLeftOutlined />}
            onClick={() => void navigate('/warehouse-ops?tab=picking')}
          />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 19, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {task.pickingNo}
            </span>
            <span style={{ fontSize: 12.5, color: colors.textSecondary, whiteSpace: 'nowrap' }}>
              {task.warehouseCode} {task.warehouseName} · {task.ordersCount} 单
            </span>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 160,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderLeft: `1px solid ${colors.border}`,
              paddingLeft: 14,
            }}
          >
            <span style={{ fontSize: 12.5, color: colors.textSecondary, whiteSpace: 'nowrap' }}>
              拣货进度
            </span>
            <Progress
              percent={percent}
              showInfo={false}
              size={{ height: 6 }}
              style={{ margin: 0, flex: 1 }}
              strokeColor={percent === 100 ? colors.success : colors.primary}
            />
            <span style={{ fontSize: 13, fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
              {totals.picked} / {totals.required}
            </span>
          </div>
          <StatusBadge
            tone={PICKING_STATUS_META[task.status]?.tone ?? 'neutral'}
            label={PICKING_STATUS_META[task.status]?.label ?? task.status}
            hint={task.status}
          />
          {task.status === 'CREATED' && (
            <Button
              type="primary"
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
              <Button type="primary" loading={completeMutation.isPending}>
                完成任务
              </Button>
            </Popconfirm>
          )}
        </div>

        {/* 作业卡（2026-10-27 合并「下一库位」与「扫码」）：左半是库位与数量，
            右半是 SKU 身份 + 主条码 + 扫码输入。原来三张全宽卡片纵向堆叠，
            上下留白多、横向利用率低；合并后一屏同时看到库位、商品与扫码框。 */}
        {(inProgress || task.status === 'COMPLETED') && (
          <div
            style={{
              background: colors.container,
              border: `1px solid ${inProgress ? colors.primary : colors.border}`,
              borderRadius: 12,
              padding: '14px 18px',
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              alignItems: 'stretch',
            }}
          >
            {nextItem !== undefined && nextBin !== null ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 6,
                    minWidth: 210,
                  }}
                >
                  <div style={{ fontSize: 12.5, color: colors.textSecondary }}>下一库位</div>
                  <div
                    style={{
                      fontSize: 34,
                      fontWeight: 750,
                      lineHeight: '38px',
                      color: colors.primaryActive,
                      fontVariantNumeric: 'tabular-nums',
                      letterSpacing: 1,
                    }}
                  >
                    {nextBin.binCode}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      需要{' '}
                      <span
                        style={{
                          fontSize: 20,
                          fontWeight: 700,
                          color: colors.textPrimary,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {Number(nextItem.requiredQty)}
                      </span>
                    </span>
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      已拣{' '}
                      <span
                        style={{
                          fontSize: 20,
                          fontWeight: 700,
                          color: colors.success,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {Number(nextItem.pickedQty)}
                      </span>
                    </span>
                  </div>
                </div>
                <div
                  style={{ width: 1, background: colors.border, alignSelf: 'stretch' }}
                  aria-hidden
                />
                <div
                  style={{
                    flex: 1,
                    minWidth: 320,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}
                  >
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{nextItem.skuCode}</span>
                    <span style={{ fontSize: 17, fontWeight: 600, color: colors.textPrimary }}>
                      {nextItem.skuName}
                    </span>
                    <CopyTextButton value={nextItem.skuName} title="SKU 名称" size="middle" />
                    {nextItem.serialTracking && (
                      <span style={{ color: colors.warning, fontSize: 12.5 }}>SN 商品</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>
                      订单 {nextItem.orderNo}
                    </span>
                    <span style={{ fontSize: 12.5, color: colors.textTertiary }}>·</span>
                    <span style={{ fontSize: 12.5, color: colors.textSecondary }}>主条码</span>
                    {nextItem.primaryBarcode === null ? (
                      <span style={{ fontSize: 12.5, color: colors.textTertiary }}>
                        未维护（可按 SKU 编码扫描）
                      </span>
                    ) : (
                      <>
                        <span
                          style={{
                            fontFamily: typography.monoFamily,
                            fontSize: 20,
                            fontWeight: 700,
                            letterSpacing: 2,
                            padding: '1px 10px',
                            borderRadius: 6,
                            background: colors.neutralBg,
                            border: `1px solid ${colors.neutralBorder}`,
                            color: colors.textPrimary,
                          }}
                        >
                          {nextItem.primaryBarcode}
                        </span>
                        <CopyTextButton
                          value={nextItem.primaryBarcode}
                          title="主条码"
                          size="middle"
                        />
                      </>
                    )}
                  </div>
                  <Input
                    id="picking-scan-input"
                    ref={barcodeRef}
                    size="large"
                    placeholder={`扫描商品条码（每次 1 件，回车提交）${
                      nextItem.primaryBarcode === null ? '' : `，如 ${nextItem.primaryBarcode}`
                    }`}
                    value={barcode}
                    disabled={!inProgress}
                    onChange={(event) => setBarcode(event.target.value)}
                    onPressEnter={submitScan}
                    style={{ fontSize: 19, padding: '8px 14px' }}
                    aria-label="扫描商品条码"
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
                      style={{ fontSize: 16, padding: '6px 14px' }}
                    />
                  )}
                  <ScanFeedback feedback={feedback} />
                </div>
              </>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>所有行已拣完，可以完成任务</span>
                <ScanFeedback feedback={feedback} />
              </div>
            )}
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
                        <CopyTextButton value={item.skuName} title="SKU 名称" />
                        {item.serialTracking && (
                          <StatusBadge tone="warning" label="SN" showDot={false} />
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          flexWrap: 'wrap',
                          color: colors.textSecondary,
                          fontSize: 12.5,
                          marginTop: 3,
                        }}
                      >
                        <span>
                          订单 {item.orderNo} · 剩余 {remaining} 件
                        </span>
                        {item.primaryBarcode !== null && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ color: colors.textTertiary, marginRight: 4 }}>
                              主条码
                            </span>
                            <span
                              style={{
                                fontFamily: typography.monoFamily,
                                fontWeight: 600,
                                color: colors.textPrimary,
                                letterSpacing: 0.5,
                              }}
                            >
                              {item.primaryBarcode}
                            </span>
                            <CopyTextButton value={item.primaryBarcode} title="主条码" />
                          </span>
                        )}
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
