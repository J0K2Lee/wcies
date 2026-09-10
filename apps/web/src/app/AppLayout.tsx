import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router';
import { Avatar, Badge, Button, Drawer, Input, Menu, Tooltip } from 'antd';
import { InputRef } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  CloudSyncOutlined,
  HomeOutlined,
  InboxOutlined,
  LayoutOutlined,
  QuestionCircleOutlined,
  ShoppingOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useRef } from 'react';
import { AppRailSetterProvider, colors, layout, ContextRailContent } from '../design-system';

/**
 * WCIES adaptive three-column workbench shell (redesign task §12-§19):
 * left global nav + main work area + collapsible context rail.
 *
 * Responsive rail behavior (task §17):
 *   >=1600px  rail inline, expanded by default
 *   1400-1599 rail inline, dashboard expands / table pages may collapse
 *   <=1366px  rail never squeezes the table — opens as an overlay drawer
 * The user's manual toggle is remembered across pages (localStorage).
 *
 * `/picking/:id` enters warehouse focus mode (task §46): the nav collapses to
 * icons so the operation workbench owns the screen.
 */

type ViewportTier = 'narrow' | 'mid' | 'wide';

const RAIL_PREF_KEY = 'wcies.rail-expanded';

/** Existing routes regrouped into the Phase 1 nav order (task §13) — no route changes. */
const MENU_ITEMS = [
  { key: '/', label: '首页', icon: <HomeOutlined /> },
  {
    key: 'products-group',
    label: '商品',
    icon: <AppstoreOutlined />,
    children: [
      { key: '/products', label: '商品管理' },
      { key: '/skus', label: 'SKU管理' },
      { key: '/listings', label: 'SKU映射' },
    ],
  },
  {
    key: 'inventory-group',
    label: '库存',
    icon: <InboxOutlined />,
    children: [
      { key: '/inventory', label: '库存查询' },
      { key: '/inventory/transactions', label: '库存流水' },
      { key: '/inventory/reservations', label: 'Reservation' },
    ],
  },
  {
    key: 'order-group',
    label: '订单',
    icon: <ShoppingOutlined />,
    children: [{ key: '/orders', label: '订单管理' }],
  },
  {
    key: 'warehouse-ops-group',
    label: '仓库作业',
    icon: <ToolOutlined />,
    children: [
      { key: '/picking', label: '拣货' },
      { key: '/shipments', label: '发货' },
      { key: '/interceptions', label: '拦截' },
      { key: '/warehouses', label: '仓库管理' },
      { key: '/bins', label: '库位管理' },
    ],
  },
  {
    key: 'platform-group',
    label: '同步与店铺',
    icon: <CloudSyncOutlined />,
    children: [
      { key: '/sync', label: '同步中心' },
      { key: '/stores', label: '店铺管理' },
      { key: '/store-bindings', label: '店仓绑定' },
    ],
  },
  {
    key: 'system-group',
    label: '系统',
    icon: <BarChartOutlined />,
    children: [
      { key: '/import', label: '导入中心' },
      { key: '/notifications', label: '通知中心' },
    ],
  },
];

function useViewportTier(): ViewportTier {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1920 : window.innerWidth,
  );
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (width >= layout.railBreakpointWide) {
    return 'wide';
  }
  return width >= 1400 ? 'mid' : 'narrow';
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const tier = useViewportTier();

  // Focus mode for the picking workbench: shrink nav, no rail (task §46).
  const focusMode = /^\/picking\/[^/]+$/.test(location.pathname);

  const [railContent, setRailContent] = useState<ContextRailContent | null>(null);
  const [userRailPref, setUserRailPref] = useState<boolean | null>(() => {
    const stored = localStorage.getItem(RAIL_PREF_KEY);
    return stored === null ? null : stored === 'true';
  });
  const [overlayOpen, setOverlayOpen] = useState(false);

  const setRail = useCallback((content: ContextRailContent | null) => {
    setRailContent(content);
  }, []);

  // Resolve effective rail state from tier + page default + user preference.
  const railInline = tier !== 'narrow' && !focusMode && railContent !== null;
  const defaultExpanded = railContent?.defaultCollapsed === true ? tier === 'wide' : true;
  const railExpanded = userRailPref ?? defaultExpanded;

  const toggleRail = () => {
    if (tier === 'narrow') {
      setOverlayOpen((open) => !open);
      return;
    }
    const next = !railExpanded;
    setUserRailPref(next);
    localStorage.setItem(RAIL_PREF_KEY, String(next));
  };

  // Re-close the overlay when navigating away or entering focus mode.
  useEffect(() => {
    setOverlayOpen(false);
  }, [location.pathname, focusMode]);

  const selectedKey = location.pathname;
  const openKeys = useMemo(
    () =>
      MENU_ITEMS.filter(
        (item) =>
          'children' in item && item.children?.some((child) => selectedKey.startsWith(child.key)),
      ).map((item) => item.key),
    [selectedKey],
  );

  const railBody = useContextRailContentSafe(railContent);
  const railAvailable = railContent !== null && !focusMode;
  const railButtonActive = railInline ? railExpanded : overlayOpen;

  const searchRef = useRef<InputRef>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <AppRailSetterProvider value={setRail}>
      <div
        style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: colors.canvas }}
      >
        {/* ---- Left global nav (task §13) ---- */}
        <aside
          style={{
            width: focusMode ? 60 : layout.siderWidth,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            background: colors.sidebar,
            borderRight: `1px solid ${colors.border}`,
            transition: 'width .18s ease',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: layout.topbarHeight,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: focusMode ? '0 0 0 18px' : '0 18px',
              borderBottom: `1px solid ${colors.borderSoft}`,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                background: colors.primary,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              W
            </span>
            {!focusMode && (
              <span style={{ fontSize: 15.5, fontWeight: 700, color: colors.textPrimary }}>
                WCIES
              </span>
            )}
          </div>
          <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }} aria-label="全局导航">
            <Menu
              mode="inline"
              inlineCollapsed={focusMode}
              selectedKeys={[selectedKey]}
              defaultOpenKeys={openKeys}
              items={MENU_ITEMS}
              style={{ border: 'none', background: 'transparent' }}
              onClick={({ key }) => {
                if (String(key).startsWith('/')) {
                  void navigate(String(key));
                }
              }}
            />
          </nav>
        </aside>

        {/* ---- Main column: topbar + body ---- */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <header
            style={{
              height: layout.topbarHeight,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '0 20px',
              background: colors.container,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <Input
              ref={searchRef}
              allowClear
              placeholder="搜索订单、商品、SKU、店铺或功能..."
              prefix={
                <span aria-hidden style={{ color: colors.textTertiary }}>
                  ⌕
                </span>
              }
              suffix={
                <kbd
                  style={{
                    fontSize: 11,
                    color: colors.textTertiary,
                    border: `1px solid ${colors.border}`,
                    borderRadius: 4,
                    padding: '0 5px',
                    lineHeight: '18px',
                    background: '#FAFBFC',
                  }}
                >
                  Ctrl K
                </kbd>
              }
              style={{ width: 360, maxWidth: '40vw' }}
              aria-label="全局搜索"
              onPressEnter={(event) => {
                const keyword = event.currentTarget.value.trim();
                if (keyword !== '') {
                  void navigate(`/orders?keyword=${encodeURIComponent(keyword)}`);
                }
              }}
            />
            <div style={{ flex: 1 }} />
            {railAvailable && (
              <Tooltip
                title={tier === 'narrow' ? '上下文面板' : railExpanded ? '收起右栏' : '展开右栏'}
              >
                <Button
                  aria-label="切换上下文右栏"
                  type={railButtonActive ? 'primary' : 'default'}
                  ghost={railButtonActive}
                  icon={<LayoutOutlined />}
                  onClick={toggleRail}
                />
              </Tooltip>
            )}
            <Tooltip title="帮助">
              <Button type="text" aria-label="帮助" icon={<QuestionCircleOutlined />} />
            </Tooltip>
            <Tooltip title="通知中心">
              <Button
                type="text"
                aria-label="通知中心"
                icon={
                  <Badge dot color="#C2760F" offset={[-2, 2]}>
                    <BellIcon />
                  </Badge>
                }
                onClick={() => void navigate('/notifications')}
              />
            </Tooltip>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '3px 10px 3px 4px',
                border: `1px solid ${colors.border}`,
                borderRadius: 999,
                marginLeft: 4,
              }}
            >
              <Avatar size={26} style={{ background: colors.primary, fontSize: 12.5 }}>
                A
              </Avatar>
              <span style={{ fontSize: 13, color: colors.textSecondary }}>Admin</span>
            </div>
          </header>

          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* ---- Main work area (task §15) ---- */}
            <main
              style={{
                flex: 1,
                minWidth: 0,
                overflowY: 'auto',
                padding: layout.contentPadding,
              }}
            >
              <div style={{ maxWidth: layout.contentMaxWidth, margin: '0 auto' }}>
                <Outlet />
              </div>
            </main>

            {/* ---- Inline context rail (>=1400, task §16) ---- */}
            {railInline && railExpanded && (
              <aside
                style={{
                  width: layout.railExpandedWidth,
                  flexShrink: 0,
                  overflowY: 'auto',
                  background: colors.container,
                  borderLeft: `1px solid ${colors.border}`,
                }}
                aria-label="上下文面板"
              >
                {railBody}
              </aside>
            )}
          </div>
        </div>

        {/* ---- Overlay rail for <=1366 (task §17) ---- */}
        <Drawer
          placement="right"
          open={overlayOpen && tier === 'narrow' && railContent !== null}
          onClose={() => setOverlayOpen(false)}
          title="上下文"
          styles={{ body: { padding: 0 } }}
        >
          {railBody}
        </Drawer>
      </div>
    </AppRailSetterProvider>
  );
}

/** Normalizes registered content into the rail frame (header + body). */
function useContextRailContentSafe(content: ContextRailContent | null): React.ReactNode {
  if (content === null) {
    return null;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {content.header !== undefined && (
        <div
          style={{
            padding: '14px 18px',
            borderBottom: `1px solid ${colors.borderSoft}`,
          }}
        >
          {content.header}
        </div>
      )}
      <div>{content.children}</div>
    </div>
  );
}

function BellIcon() {
  return (
    <span aria-hidden style={{ fontSize: 16, lineHeight: 1, display: 'inline-flex' }}>
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">
        <path d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5v2.6L2.3 11a.7.7 0 0 0 .6 1.1h10.2a.7.7 0 0 0 .6-1.1l-1.2-2.4V6A4.5 4.5 0 0 0 8 1.5Zm0 13a2 2 0 0 0 1.9-1.4H6.1A2 2 0 0 0 8 14.5Z" />
      </svg>
    </span>
  );
}
