import { useMemo, useState } from 'react';
import { App, Button, Divider, Empty, Input, Modal, Select, Space, Switch, Tag } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiDelete, apiPatch, apiPost, useApiQuery } from '../api/hooks';
import { colors, NOTIFICATION_TYPE_META, StatusBadge } from '../design-system';

/**
 * 我的通知订阅（2026-10-26）。
 *
 * 订阅模型：**用户 × 通道 × 事件 × 条件（AND）**。条件只能按事件目录声明的
 * 字段过滤（storeId / warehouseCode / skuCode / level），每个字段给一组候选值，
 * payload 命中任一即满足；不提供 OR 树与脚本——规则必须一眼能解释「为什么收到」。
 *
 * 默认全不订阅：不建规则就不会收到任何推送；站内事件流不受影响。
 */

interface EventCatalogItem {
  type: string;
  label: string;
  level: string;
  conditionFields: Array<{ key: string; label: string }>;
}

interface SubscriptionRow {
  id: string;
  channel: string;
  eventType: string;
  conditions: Record<string, string[]>;
  enabled: boolean;
}

interface ChannelBinding {
  id: string;
  channel: string;
  address: string;
  enabled: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  FEISHU_DM: '飞书私聊',
  FEISHU_GROUP: '飞书群',
};

const LEVEL_OPTIONS = ['INFO', 'WARN', 'HIGH'];

export function NotificationSubscriptionsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [eventType, setEventType] = useState<string | undefined>();
  const [channel, setChannel] = useState<'FEISHU_DM' | 'FEISHU_GROUP'>('FEISHU_DM');
  const [conditionDraft, setConditionDraft] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState('');

  const catalog = useApiQuery<{ data: EventCatalogItem[] }>(
    '/api/v1/notifications/event-catalog',
    {},
    ['notification-event-catalog'],
    undefined,
    open,
  );
  const subscriptions = useApiQuery<{ data: SubscriptionRow[] }>(
    '/api/v1/notifications/subscriptions',
    {},
    ['notification-subscriptions'],
    undefined,
    open,
  );
  const bindings = useApiQuery<{ data: ChannelBinding[] }>(
    '/api/v1/notifications/channels',
    {},
    ['notification-channel-bindings'],
    undefined,
    open,
  );

  const events = catalog.data?.data ?? [];
  const rules = subscriptions.data?.data ?? [];
  const feishuBinding = (bindings.data?.data ?? []).find((row) => row.channel === 'FEISHU_DM');
  const selectedEvent = useMemo(
    () => events.find((event) => event.type === eventType) ?? null,
    [events, eventType],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notification-subscriptions'] });
    void queryClient.invalidateQueries({ queryKey: ['notification-channel-bindings'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/v1/notifications/subscriptions', {
        channel,
        eventType,
        conditions: Object.fromEntries(
          Object.entries(conditionDraft)
            .map(([key, value]) => [
              key,
              value
                .split(/[,，\s]+/)
                .map((item) => item.trim())
                .filter((item) => item !== ''),
            ])
            .filter(([, values]) => (values as string[]).length > 0),
        ),
        enabled: true,
      }),
    onSuccess: () => {
      void message.success('订阅已保存');
      setConditionDraft({});
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) =>
      apiPatch(
        '/api/v1/notifications/subscriptions/{id}',
        { enabled: input.enabled },
        { id: input.id },
      ),
    onSuccess: invalidate,
    onError: (error: Error) => void message.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete('/api/v1/notifications/subscriptions/{id}', { id }),
    onSuccess: () => {
      void message.success('订阅已删除');
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  const bindingMutation = useMutation({
    mutationFn: () =>
      apiPost('/api/v1/notifications/channels', {
        channel: 'FEISHU_DM',
        address: openId.trim(),
        enabled: true,
      }),
    onSuccess: () => {
      void message.success('飞书 open_id 已绑定');
      setOpenId('');
      invalidate();
    },
    onError: (error: Error) => void message.error(error.message),
  });

  return (
    <Modal
      open={open}
      title="我的通知订阅"
      width={760}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 12.5, color: colors.textSecondary }}>
          默认不推送任何通知。订阅规则 = 事件 + 通道 + 条件（多个条件为 AND，值命中任一即可）；
          条件的可选字段由事件目录决定。站内通知中心始终记录事件，不受订阅影响。
        </div>

        <Divider style={{ margin: '4px 0' }}>飞书私聊绑定</Divider>
        <Space wrap>
          <Input
            style={{ width: 380 }}
            placeholder="open_id（ou_…，按飞书应用隔离）"
            value={openId}
            onChange={(event) => setOpenId(event.target.value)}
          />
          <Button
            type="primary"
            loading={bindingMutation.isPending}
            disabled={openId.trim() === ''}
            onClick={() => bindingMutation.mutate()}
          >
            保存
          </Button>
          {feishuBinding === undefined ? (
            <StatusBadge tone="warning" label="未绑定" showDot={false} />
          ) : (
            <StatusBadge
              tone="success"
              label={`已绑定 ${feishuBinding.address.slice(0, 12)}…`}
              showDot={false}
            />
          )}
        </Space>

        <Divider style={{ margin: '4px 0' }}>新增订阅</Divider>
        <Space wrap>
          <Select
            style={{ width: 220 }}
            placeholder="事件"
            value={eventType}
            onChange={setEventType}
            options={events.map((event) => ({ value: event.type, label: event.label }))}
          />
          <Select
            style={{ width: 130 }}
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'FEISHU_DM', label: '飞书私聊' },
              { value: 'FEISHU_GROUP', label: '飞书群' },
            ]}
          />
        </Space>
        {selectedEvent !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12.5, color: colors.textTertiary }}>
              条件（留空 = 不限制；多个值用逗号分隔，命中任一即可）
            </div>
            <Select
              mode="multiple"
              style={{ maxWidth: 320 }}
              placeholder="级别（level）"
              value={conditionDraft['level']?.split(/[,，\s]+/).filter((v) => v !== '') ?? []}
              onChange={(values: string[]) =>
                setConditionDraft((prev) => ({ ...prev, level: values.join(',') }))
              }
              options={LEVEL_OPTIONS.map((level) => ({ value: level, label: level }))}
            />
            {selectedEvent.conditionFields.map((field) => (
              <Input
                key={field.key}
                style={{ maxWidth: 420 }}
                placeholder={`${field.label}（${field.key}）`}
                value={conditionDraft[field.key] ?? ''}
                onChange={(event) =>
                  setConditionDraft((prev) => ({ ...prev, [field.key]: event.target.value }))
                }
              />
            ))}
          </div>
        )}
        <div>
          <Button
            type="primary"
            disabled={eventType === undefined}
            loading={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            保存订阅
          </Button>
        </div>

        <Divider style={{ margin: '4px 0' }}>我的订阅（{rules.length}）</Divider>
        {rules.length === 0 ? (
          <Empty description="还没有订阅，不会收到任何推送" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rules.map((rule) => (
              <div
                key={rule.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  padding: '8px 10px',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                }}
              >
                <StatusBadge
                  tone={NOTIFICATION_TYPE_META[rule.eventType]?.tone ?? 'neutral'}
                  label={NOTIFICATION_TYPE_META[rule.eventType]?.label ?? rule.eventType}
                  showDot={false}
                />
                <span style={{ fontSize: 13 }}>{CHANNEL_LABEL[rule.channel] ?? rule.channel}</span>
                {Object.entries(rule.conditions).length === 0 ? (
                  <span style={{ fontSize: 12.5, color: colors.textTertiary }}>不限条件</span>
                ) : (
                  Object.entries(rule.conditions).map(([key, values]) => (
                    <Tag key={key} style={{ marginInlineEnd: 0 }}>
                      {key} ∈ {values.join('/')}
                    </Tag>
                  ))
                )}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                  <Switch
                    size="small"
                    checked={rule.enabled}
                    onChange={(enabled) => toggleMutation.mutate({ id: rule.id, enabled })}
                  />
                  <Button size="small" danger onClick={() => deleteMutation.mutate(rule.id)}>
                    删除
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
