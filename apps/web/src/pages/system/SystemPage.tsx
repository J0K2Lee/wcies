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
} from '@ant-design/icons';
import { Avatar } from 'antd';
import { useApiQuery } from '../../api/hooks';
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
 * real existing modules (warehouses, mapping, import, notifications), shows
 * live service health and the current account. No user-management UI exists
 * (no API) so none is invented.
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
}

interface MeData {
  id: string;
  username: string;
  email: string;
  role: string;
  status: string;
}

const ENTRIES: Array<{ to: string; title: string; description: string; icon: React.ReactNode }> = [
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
];

export function SystemPage() {
  const health = useApiQuery<{ data: HealthData }>('/health/ready', {}, ['health-ready']);
  const me = useApiQuery<{ data: MeData }>('/api/v1/auth/me', {}, ['auth-me']);
  const platforms = useApiQuery<{ data: PlatformRow[] }>('/api/v1/platforms', {}, [
    'platforms-list',
  ]);

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
            {ENTRIES.map((entry) => (
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
            ))}
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
              当前系统暂无用户与权限管理 API，账号由后端种子数据维护。
            </p>
          </SectionCard>
        </div>
      </div>

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
            </div>
          ))}
          {platforms.isLoading && (
            <span style={{ color: colors.textTertiary, fontSize: 13 }}>加载中…</span>
          )}
        </div>
        <p style={{ fontSize: 12.5, color: colors.textTertiary, margin: '12px 0 0' }}>
          平台为系统内置参数（只读）；店铺与凭证在「店铺与平台」中管理。
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
