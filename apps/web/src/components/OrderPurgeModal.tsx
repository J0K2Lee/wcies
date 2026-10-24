import { useEffect, useState } from 'react';
import { Alert, App, Button, Input, Modal, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost, useApiQuery } from '../api/hooks';
import { colors, InfoGrid } from '../design-system';

/**
 * 「彻底移除错误摄入的订单」（2026-10-24 用户指示）。
 *
 * 与「取消订单」的区别：取消表示这张单确实发生过、后来不做了，它会留在
 * 已取消列表与统计里；删除表示这张单**本就不该存在**（平台事实没有对应
 * 关系，或与另一张单是同一事实），只适用于没有产生任何业务事实的订单。
 *
 * 界面先展示影响面与阻断项，再要求输入单号确认——不可逆动作必须二次确认。
 */
interface PurgePreview {
  orderId: string;
  orderNo: string;
  platformOrderId: string;
  erpStatus: string;
  items: Array<{ id: string; lineNo: number; fulfillmentStatus: string }>;
  willDelete: {
    items: number;
    statusHistory: number;
    platformStatusHistory: number;
    exceptions: number;
  };
  blockers: string[];
}

export function OrderPurgeModal({
  order,
  onClose,
  onPurged,
}: {
  order: { id: string; orderNo: string; platformOrderId: string } | null;
  onClose: () => void;
  onPurged?: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmNo, setConfirmNo] = useState('');

  useEffect(() => {
    setReason('');
    setConfirmNo('');
  }, [order?.id]);

  const preview = useApiQuery<{ data: PurgePreview }>(
    '/api/v1/orders/{id}/purge-preview',
    {},
    ['order-purge-preview', order?.id ?? 'NONE'],
    { id: order?.id ?? '' },
    order !== null,
  );
  const data = preview.data?.data;
  const blocked = (data?.blockers.length ?? 0) > 0;
  const ready = data !== undefined && !blocked && confirmNo.trim() === data.orderNo;

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<{ orderNo: string }>(
        '/api/v1/orders/{id}/purge',
        {
          reason: reason.trim() === '' ? '错误摄入，彻底移除' : reason.trim(),
          confirmOrderNo: confirmNo,
        },
        { id: order?.id ?? '' },
      ),
    onSuccess: (result) => {
      void message.success(`已移除订单 ${result.orderNo}（及其明细与异常）`);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order-detail'] });
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      onPurged?.();
      onClose();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Modal
      title={`彻底移除订单 ${order?.orderNo ?? ''}？`}
      open={order !== null}
      zIndex={1150}
      onCancel={onClose}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button
          key="purge"
          danger
          type="primary"
          disabled={!ready}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          彻底移除
        </Button>,
      ]}
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Alert
          type="warning"
          showIcon
          title="这是删除，不是取消"
          description="仅用于「错误摄入、本不该存在」的订单（平台重复推送、映射错单等）。删除不可撤销：订单行、状态历史与异常会一并消失。"
        />
        {preview.isLoading && <span style={{ fontSize: 12.5 }}>读取影响面…</span>}
        {data !== undefined && (
          <InfoGrid
            columns={2}
            items={[
              { label: '平台单号', children: data.platformOrderId },
              { label: '当前状态', children: data.erpStatus },
              {
                label: '将删除',
                children: `明细 ${data.willDelete.items} 行 · 状态历史 ${data.willDelete.statusHistory} 条 · 异常 ${data.willDelete.exceptions} 条`,
              },
              {
                label: '明细行状态',
                children: data.items
                  .map((item) => `#${item.lineNo} ${item.fulfillmentStatus}`)
                  .join('，'),
              },
            ]}
          />
        )}
        {blocked && (
          <Alert
            type="error"
            showIcon
            title="该订单已产生业务事实，不能删除"
            description={`${data?.blockers.join('；')}。这类订单请先走取消/拦截/退回等正式流程——删除会让库存流水与报表指向不存在的订单。`}
          />
        )}
        {!blocked && data !== undefined && (
          <>
            <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
              移除原因（写入操作日志）
            </div>
            <Input
              value={reason}
              maxLength={450}
              placeholder="例如：WB 统计流水重复建单，FBS 记录为权威"
              onChange={(event) => setReason(event.target.value)}
            />
            <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
              再次输入订单号 <b>{data.orderNo}</b> 确认
            </div>
            <Input
              value={confirmNo}
              placeholder={data.orderNo}
              onChange={(event) => setConfirmNo(event.target.value)}
            />
          </>
        )}
      </Space>
    </Modal>
  );
}
