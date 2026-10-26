import { useNavigate } from 'react-router';
import { Badge, Button, Popover, Tooltip } from 'antd';
import { useApiQuery } from '../api/hooks';
import { colors, NOTIFICATION_TYPE_META, RelativeTime, StatusBadge } from '../design-system';

/**
 * Topbar notification popover (Phase 2 task §35-§36): recent event stream
 * (Title / Description / Time) with a dot when delivery failures exist.
 * Clicking the bell shows the popover; items link to the notification center
 * (pre-filtered by the item's type).
 */

interface NotificationItem {
  id: string;
  type: string;
  channel: string;
  title: string;
  content: string;
  status: string;
  createdAt: string;
  isRead: boolean;
  deliveryStatus: string | null;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const query = useApiQuery<{ data: NotificationItem[] }>(
    '/api/v1/notifications',
    { page: 1, pageSize: 6 },
    ['notifications', 'recent'],
    undefined,
    true,
  );

  const items = query.data?.data ?? [];
  const unread = useApiQuery<{ data: { unreadTotal: number } }>(
    '/api/v1/notifications/unread-count',
    {},
    ['notifications-unread'],
  );
  const unreadTotal = unread.data?.data.unreadTotal ?? 0;

  const content = (
    <div style={{ width: 320 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: colors.textPrimary,
          padding: '2px 2px 8px',
        }}
      >
        通知
      </div>
      {query.isError ? (
        <div
          style={{
            padding: '20px 0',
            textAlign: 'center',
            fontSize: 12.5,
            color: colors.textTertiary,
          }}
        >
          无法加载通知
        </div>
      ) : items.length === 0 ? (
        <div
          style={{
            padding: '20px 0',
            textAlign: 'center',
            fontSize: 12.5,
            color: colors.textTertiary,
          }}
        >
          暂无通知
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => void navigate(`/notifications?type=${encodeURIComponent(item.type)}`)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '9px 8px',
                border: 'none',
                borderBottom: `1px solid ${colors.borderSoft}`,
                textAlign: 'left',
                cursor: 'pointer',
                background: 'transparent',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = colors.primarySoft;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent';
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {!item.isRead && (
                  <span
                    aria-label="未读"
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: colors.primary,
                      flexShrink: 0,
                    }}
                  />
                )}
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 550,
                    color: colors.textPrimary,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {NOTIFICATION_TYPE_META[item.type]?.label ?? item.type} · {item.title}
                </span>
                {/* 站内事件行恒为 SENT，「能看到即已送达」；只提示自己推送失败。 */}
                {item.deliveryStatus === 'FAILED' && (
                  <StatusBadge
                    tone="danger"
                    label="推送失败"
                    hint="飞书推送失败，可在通知中心重试"
                    showDot={false}
                  />
                )}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: colors.textTertiary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.content}
              </span>
              <span style={{ fontSize: 11.5, color: colors.textTertiary }}>
                <RelativeTime value={item.createdAt} />
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => void navigate('/notifications')}
        style={{
          width: '100%',
          padding: '9px 0',
          marginTop: 4,
          border: 'none',
          borderTop: `1px solid ${colors.borderSoft}`,
          background: 'transparent',
          color: colors.primary,
          fontSize: 12.5,
          cursor: 'pointer',
        }}
      >
        查看全部通知
      </button>
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight" arrow={false}>
      <Tooltip title="通知中心" mouseEnterDelay={0.8}>
        <Button
          type="text"
          aria-label="通知中心"
          icon={
            /* 未读计数（2026-10-26）；没有未读就不显示角标。 */
            <Badge
              count={unreadTotal}
              size="small"
              offset={[-4, 2]}
              style={{ display: unreadTotal > 0 ? undefined : 'none' }}
            >
              <BellGlyph />
            </Badge>
          }
        />
      </Tooltip>
    </Popover>
  );
}

function BellGlyph() {
  return (
    <span aria-hidden style={{ fontSize: 16, lineHeight: 1, display: 'inline-flex' }}>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
        <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.6L2.3 11a.7.7 0 0 0 .6 1.1h10.2a.7.7 0 0 0 .6-1.1l-1.2-2.4V6A4.5 4.5 0 0 0 8 1.5Zm0 13a2 2 0 0 0 1.9-1.4H6.1A2 2 0 0 0 8 14.5Z" />
      </svg>
    </span>
  );
}
