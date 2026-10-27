import { useMemo } from 'react';
import { Link } from 'react-router';
import {
  AppstoreOutlined,
  BellOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  ImportOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { App as AntdApp, Avatar, InputNumber } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPatch, useApiQuery } from '../../api/hooks';
import {
  colors,
  ContextRailContent,
  ContextSection,
  ContextMetric,
  ErrorState,
  PageHeader,
  RailHint,
  SectionCard,
  StatusBadge,
  typography,
  useContextRail,
} from '../../design-system';

/**
 * System hub (Phase 2 task §26-§28): settings IA entry point — links to the
 * real existing modules (warehouses, mapping, import, notifications, users,
 * account security), shows live service health and the current account.
 */

interface HealthData {
  status: string;
  checks: Record<string, string>;
}

interface PlatformRow {
  id: string;
  code: string;
  name: string;
  status: string;
  /** 分配优先级（数值小=优先，ADR 0022）。 */
  priority: number;
}

interface MeData {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
}

/** 订单平台事实回读的分阶段阈值（小时），与后端 SystemSettingsService 默认值一致。 */
interface FallbackHours {
  awaitingShipment: number;
  inTransit: number;
  delivered: number;
}

const ENTRIES: Array<{
  to: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}> = [
  {
    to: '/warehouses',
    title: '仓库与库位',
    description: '仓库档案、库位与批量创建',
    icon: <DatabaseOutlined />,
  },
  {
    to: '/platform-mappings',
    title: 'SKU 映射总览',
    description: '平台 SKU 映射状态与未映射处理入口',
    icon: <AppstoreOutlined />,
  },
  {
    to: '/stores',
    title: '店铺与平台',
    description: '店铺、凭证与店仓绑定',
    icon: <ShopOutlined />,
  },
  {
    to: '/sync',
    title: '同步中心',
    description: '平台同步任务与事件订阅',
    icon: <CloudSyncOutlined />,
  },
  {
    to: '/import',
    title: '导入中心',
    description: 'Excel 批量导入任务',
    icon: <ImportOutlined />,
  },
  {
    to: '/notifications',
    title: '通知中心',
    description: '系统与飞书通知投递记录',
    icon: <BellOutlined />,
  },
  {
    to: '/system/users',
    title: '用户管理',
    description: '添加用户（邮箱验证激活）与账号停用启用',
    icon: <TeamOutlined />,
    adminOnly: true,
  },
  {
    to: '/account',
    title: '账号与安全',
    description: '通过已验证邮箱修改密码与邮箱',
    icon: <UserOutlined />,
  },
];

export function SystemPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const health = useApiQuery<{ data: HealthData }>('/health/ready', {}, ['health-ready']);
  const me = useApiQuery<{ data: MeData }>('/api/v1/auth/me', {}, ['auth-me']);
  const platforms = useApiQuery<{ data: PlatformRow[] }>('/api/v1/platforms', {}, [
    'platforms-list',
  ]);
  const isAdmin = me.data?.data?.role === 'ADMIN';

  // 订单平台事实回读（2026-10-27，用户要求有 UI）：分阶段阈值，越短越能早发现
  // 平台取消；读写都走 /system/settings，修改仅管理员。
  const settings = useApiQuery<{ data: { orderFallbackHours: FallbackHours } }>(
    '/api/v1/system/settings',
    {},
    ['system-settings'],
  );
  const fallbackHours = settings.data?.data?.orderFallbackHours;
  const fallbackMutation = useMutation({
    mutationFn: (patch: Partial<FallbackHours>) =>
      apiPatch('/api/v1/system/settings', { orderFallbackHours: patch }),
    onSuccess: () => {
      message.success('回读频率已保存');
      void queryClient.invalidateQueries({ queryKey: ['system-settings'] });
    },
    onError: (error: Error) => message.error(`保存失败：${error.message}`),
  });

  // 平台分配优先级（用户指示 2026-10-16，ADR 0022）：数值小=优先；管理员可改。
  const priorityMutation = useMutation({
    mutationFn: ({ id, priority }: { id: string; priority: number }) =>
      apiPatch<PlatformRow>('/api/v1/platforms/{id}/priority', { priority }, { id }),
    onSuccess: () => {
      message.success('平台优先级已更新');
      void queryClient.invalidateQueries({ queryKey: ['platforms-list'] });
    },
    onError: (error: Error) => message.error(`更新失败：${error.message}`),
  });

  const railContent = useMemo<ContextRailContent>(
    () => ({
      defaultCollapsed: true,
      children: (
        // 服务状态只在正文卡展示（规范 §2：同一数字/状态只出现一次）。
        <>
          <ContextSection title="当前账号">
            <ContextMetric label="用户" value={me.data?.data?.username ?? '—'} />
            <ContextMetric label="角色" value={me.data?.data?.role ?? '—'} />
            <RailHint>服务运行状态见页面「系统状态」卡片。</RailHint>
          </ContextSection>
        </>
      ),
    }),
    [me.data],
  );
  useContextRail(railContent);

  return (
    <div>
      <PageHeader title="系统管理" description="仓库、映射、平台连接与系统运行状态的管理入口" />

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 16 }}>
        <SectionCard title="功能入口">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            {ENTRIES.filter((entry) => !entry.adminOnly || me.data?.data?.role === 'ADMIN').map(
              (entry) => (
                <Link
                  key={entry.to}
                  to={entry.to}
                  className="wcies-entry-tile"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 8,
                    color: 'inherit',
                    textDecoration: 'none',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-flex',
                      fontSize: 18,
                      color: colors.primary,
                      flexShrink: 0,
                    }}
                  >
                    {entry.icon}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 14,
                        fontWeight: 550,
                        color: colors.textPrimary,
                      }}
                    >
                      {entry.title}
                    </span>
                    <span style={{ display: 'block', fontSize: 12.5, color: colors.textTertiary }}>
                      {entry.description}
                    </span>
                  </span>
                </Link>
              ),
            )}
          </div>
        </SectionCard>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SectionCard title="系统状态">
            {health.isError ? (
              <ErrorState
                description={(health.error as Error | null)?.message}
                onRetry={() => void health.refetch()}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <StatusRow
                  label="API 服务"
                  value={
                    <StatusBadge
                      tone={
                        health.isLoading
                          ? 'neutral'
                          : health.data?.data?.status === 'ok'
                            ? 'success'
                            : 'danger'
                      }
                      label={
                        health.isLoading
                          ? '检测中…'
                          : health.data?.data?.status === 'ok'
                            ? '运行正常'
                            : '异常'
                      }
                    />
                  }
                />
                <StatusRow
                  label="PostgreSQL"
                  value={
                    <StatusBadge
                      tone={health.data?.data?.checks.postgres === 'up' ? 'success' : 'warning'}
                      label={health.data?.data?.checks.postgres === 'up' ? '已连接' : '未知'}
                    />
                  }
                />
                <StatusRow
                  label="Redis"
                  value={
                    <StatusBadge
                      tone={health.data?.data?.checks.redis === 'up' ? 'success' : 'warning'}
                      label={health.data?.data?.checks.redis === 'up' ? '已连接' : '未知'}
                    />
                  }
                />
              </div>
            )}
          </SectionCard>

          <SectionCard title="当前账号">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar size={40} style={{ background: colors.primary, fontSize: 16 }}>
                {(me.data?.data?.username ?? '—').slice(0, 1).toUpperCase()}
              </Avatar>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: colors.textPrimary }}>
                  {me.data?.data?.username ?? '加载中…'}
                </div>
                <div style={{ fontSize: 12.5, color: colors.textTertiary }}>
                  {me.data?.data?.email ?? ''} · {me.data?.data?.role ?? ''}
                </div>
              </div>
            </div>
            <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '12px 0 0' }}>
              用户由「<Link to="/system/users">用户管理</Link>」维护；修改密码/邮箱请前往「
              <Link to="/account">账号与安全</Link>」。
            </p>
          </SectionCard>
        </div>
      </div>

      <SectionCard title="订单回读频率">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(
            [
              {
                key: 'awaitingShipment',
                label: 'AWAITING_SHIPMENT（未交给平台）',
                hint: '平台取消几乎都发生在这个阶段；越短越早发现（默认 2 小时）',
              },
              {
                key: 'inTransit',
                label: 'IN_TRANSIT（运输中）',
                hint: '用于物流停滞判定（默认 12 小时）',
              },
              {
                key: 'delivered',
                label: 'DELIVERED（已妥投，ERP 未终态）',
                hint: '差异收敛（默认 24 小时）',
              },
            ] as const
          ).map((row) => (
            <div
              key={`${row.key}:${fallbackHours?.[row.key] ?? 'pending'}`}
              style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <span style={{ fontSize: 13.5, color: colors.textPrimary, minWidth: 280 }}>
                {row.label}
              </span>
              {isAdmin ? (
                <InputNumber
                  size="small"
                  min={0.1}
                  max={720}
                  step={0.5}
                  defaultValue={fallbackHours?.[row.key]}
                  style={{ width: 90 }}
                  onBlur={(event) => {
                    const raw = Number(event.target.value);
                    if (!Number.isFinite(raw) || raw <= 0) {
                      return;
                    }
                    if (fallbackHours !== undefined && raw === fallbackHours[row.key]) {
                      return;
                    }
                    fallbackMutation.mutate({ [row.key]: raw });
                  }}
                  onPressEnter={(event) => (event.target as HTMLInputElement).blur()}
                />
              ) : (
                <span style={{ fontFamily: typography.monoFamily }}>
                  {fallbackHours?.[row.key] ?? '—'}
                </span>
              )}
              <span style={{ fontSize: 12.5, color: colors.textTertiary }}>小时 · {row.hint}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '12px 0 0' }}>
          轮询会按订单当前的平台阶段挑对应阈值回读一次（OZON 为 /v3/posting/fbs/get）。
          推送订阅正常时这层只是兜底；订阅被暂停时它就是唯一发现平台取消的通道，所以
          AWAITING_SHIPMENT 建议保持较短。
        </p>
      </SectionCard>

      <SectionCard title="平台参数">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {(platforms.data?.data ?? []).map((platform) => (
            <div
              key={platform.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '10px 14px',
              }}
            >
              <DeploymentUnitOutlined style={{ color: colors.primary }} />
              <span style={{ fontSize: 13.5, fontWeight: 550, color: colors.textPrimary }}>
                {platform.name}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontFamily: typography.monoFamily,
                  color: colors.textTertiary,
                }}
              >
                {platform.code}
              </span>
              <StatusBadge
                tone={platform.status === 'ACTIVE' ? 'success' : 'neutral'}
                label={platform.status === 'ACTIVE' ? '启用' : platform.status}
                hint={platform.status}
              />
              {/* 分配优先级（ADR 0022）：数值小=优先。管理员可改，其他人只读。 */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12.5, color: colors.textSecondary }}>优先级</span>
                {isAdmin ? (
                  <InputNumber
                    size="small"
                    min={0}
                    max={1000}
                    defaultValue={platform.priority}
                    // 失焦/回车提交（值未变则不发请求，避免无意义写审计）。
                    onBlur={(event) => {
                      const raw = Number(event.target.value);
                      if (!Number.isInteger(raw) || raw === platform.priority) {
                        return;
                      }
                      priorityMutation.mutate({ id: platform.id, priority: raw });
                    }}
                    onPressEnter={(event) => (event.target as HTMLInputElement).blur()}
                    style={{ width: 76 }}
                  />
                ) : (
                  <span style={{ fontSize: 13, fontFamily: typography.monoFamily }}>
                    {platform.priority}
                  </span>
                )}
              </span>
            </div>
          ))}
          {platforms.isLoading && (
            <span style={{ color: colors.textTertiary, fontSize: 13 }}>加载中…</span>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '12px 0 0' }}>
          平台为系统内置参数（只读）；分配优先级用于缺货到货后「平台 &gt; 发货时限」的库存分配排序，
          数值小者优先。店铺与凭证在「<Link to="/stores">店铺与平台</Link>」中管理。
        </p>
      </SectionCard>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13.5, color: colors.textSecondary }}>{label}</span>
      {value}
    </div>
  );
}
