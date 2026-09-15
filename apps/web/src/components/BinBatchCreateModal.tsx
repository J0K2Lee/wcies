import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App as AntdApp, Form, Input, InputNumber, Modal, Space } from 'antd';
import { useState } from 'react';
import { apiPost } from '../api/hooks';
import { colors, typography } from '../design-system';

/**
 * Shared batch bin-creation dialog (Phase 3 G9): one implementation for the
 * Bins page and the warehouse detail drawer. The preview mirrors the server's
 * code rule (rack pads to >=2 digits, level stays plain).
 */

interface BatchFormValues {
  zone?: string;
  rackStart: number;
  rackCount: number;
  levelsPerRack: number;
}

function previewBinCodes(
  warehouseCode: string,
  values: Partial<BatchFormValues>,
): { first: string; last: string; total: number } | null {
  const { rackStart, rackCount, levelsPerRack } = values;
  if (
    rackStart === undefined ||
    rackCount === undefined ||
    levelsPerRack === undefined ||
    rackCount < 1 ||
    levelsPerRack < 1
  ) {
    return null;
  }
  const zone = values.zone?.trim() ?? '';
  const lastRack = rackStart + rackCount - 1;
  const width = Math.max(2, String(lastRack).length);
  const pad = (value: number): string => String(value).padStart(width, '0');
  return {
    first: `${warehouseCode}-${zone}${pad(rackStart)}-1`,
    last: `${warehouseCode}-${zone}${pad(lastRack)}-${levelsPerRack}`,
    total: rackCount * levelsPerRack,
  };
}

export interface BinBatchCreateModalProps {
  open: boolean;
  /** Path parameter; snapshot taken when opening so a closing drawer can't blank it. */
  warehouseId: string | null;
  /** Prefix for the code preview. */
  warehouseCode: string;
  onClose: () => void;
  /** Extra query keys to invalidate besides the bin lists. */
  onCreated?: () => void;
  /** 1100 when opened from inside a drawer (UI spec §8.3). */
  zIndex?: number;
}

export function BinBatchCreateModal({
  open,
  warehouseId,
  warehouseCode,
  onClose,
  onCreated,
  zIndex,
}: BinBatchCreateModalProps) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<BatchFormValues>();
  const values = Form.useWatch([], form) as Partial<BatchFormValues> | undefined;
  const [createdWarehouseId, setCreatedWarehouseId] = useState<string | null>(null);
  const effectiveWarehouseId = warehouseId ?? createdWarehouseId;
  const preview = values === undefined ? null : previewBinCodes(warehouseCode, values);

  const batchMutation = useMutation({
    // warehouseId travels in the path only: the DTO has no such property and
    // forbidNonWhitelisted rejects the request body outright when it appears.
    mutationFn: ({ wid, ...body }: BatchFormValues & { wid: string }) =>
      apiPost<{ createdCount: number }>('/api/v1/warehouses/{warehouseId}/bins/batch', body, {
        warehouseId: wid,
      }),
    onSuccess: (data) => {
      void message.success(`已批量创建 ${data.createdCount} 个库位`);
      if (effectiveWarehouseId !== null) {
        void queryClient.invalidateQueries({ queryKey: ['bins', effectiveWarehouseId] });
        void queryClient.invalidateQueries({ queryKey: ['warehouse-bins', effectiveWarehouseId] });
        void queryClient.invalidateQueries({ queryKey: ['bin-zones', effectiveWarehouseId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      onCreated?.();
      onClose();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const submit = () => {
    if (effectiveWarehouseId === null) {
      void message.error('仓库上下文丢失，请重新打开后重试');
      return;
    }
    void form
      .validateFields()
      .then((vals) => batchMutation.mutate({ ...vals, wid: effectiveWarehouseId }));
  };

  return (
    <Modal
      title={`批量创建库位${warehouseCode !== '' ? ` — ${warehouseCode}` : ''}`}
      open={open}
      zIndex={zIndex}
      afterOpenChange={(isOpen) => {
        if (!isOpen) {
          form.resetFields();
          setCreatedWarehouseId(null);
        } else if (warehouseId !== null) {
          setCreatedWarehouseId(warehouseId);
        }
      }}
      onCancel={onClose}
      onOk={submit}
      okText="批量创建"
      cancelText="取消"
      confirmLoading={batchMutation.isPending}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Space wrap>
          <Form.Item name="zone" label="库区" rules={[{ max: 20, message: '库区最多 20 个字符' }]}>
            <Input placeholder="如 A（留空则不分区）" style={{ width: 170 }} />
          </Form.Item>
          <Form.Item
            name="rackStart"
            label="起始货架号"
            rules={[{ required: true, message: '请输入起始货架号' }]}
            initialValue={1}
          >
            <InputNumber min={1} max={9999} precision={0} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item
            name="rackCount"
            label="货架数量"
            rules={[{ required: true, message: '请输入货架数量' }]}
            initialValue={5}
          >
            <InputNumber min={1} max={2000} precision={0} style={{ width: 110 }} />
          </Form.Item>
          <Form.Item
            name="levelsPerRack"
            label="每架层数"
            rules={[{ required: true, message: '请输入每架层数' }]}
            initialValue={4}
          >
            <InputNumber min={1} max={999} precision={0} style={{ width: 110 }} />
          </Form.Item>
        </Space>
        {preview === null ? (
          <p style={{ color: colors.textTertiary, fontSize: 12.5, marginBottom: 0 }}>
            库位编码由系统生成，格式为 仓库-货架-层（如 ZG-01-A05-1）。同一仓库内重复编码会被拒绝。
          </p>
        ) : (
          <div
            style={{
              background: colors.canvas,
              border: `1px solid ${colors.borderSoft}`,
              borderRadius: 6,
              padding: '10px 12px',
            }}
          >
            <div style={{ fontSize: 13, color: colors.textPrimary }}>
              将创建 <strong>{preview.total}</strong> 个库位：
              <span style={{ marginLeft: 6, fontFamily: typography.monoFamily }}>
                {preview.first}
              </span>
              {preview.total > 1 && (
                <>
                  <span style={{ margin: '0 6px', color: colors.textTertiary }}>…</span>
                  <span style={{ fontFamily: typography.monoFamily }}>{preview.last}</span>
                </>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: colors.textTertiary, marginTop: 6 }}>
              货架从第 {values?.rackStart ?? '-'} 号开始
              {values?.zone ? `（区 ${values.zone.trim()}）` : ''}
              ；每架 {values?.levelsPerRack ?? '-'} 层。条码与编码相同。
            </div>
          </div>
        )}
      </Form>
    </Modal>
  );
}
