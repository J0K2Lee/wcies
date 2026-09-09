import { Layout, Menu } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router';

const { Sider, Header, Content } = Layout;

/** Sprint 1 navigation tree + Sprint 3/4 warehouse operations (task §56). */
const MENU_ITEMS = [
  { key: '/', label: '首页' },
  {
    key: 'products-group',
    label: '商品',
    children: [
      { key: '/products', label: '商品管理' },
      { key: '/skus', label: 'SKU管理' },
      { key: '/listings', label: 'SKU映射' },
    ],
  },
  {
    key: 'warehouse-group',
    label: '仓库',
    children: [
      { key: '/warehouses', label: '仓库管理' },
      { key: '/bins', label: '库位管理' },
    ],
  },
  {
    key: 'inventory-group',
    label: '库存',
    children: [
      { key: '/inventory', label: '库存查询' },
      { key: '/inventory/transactions', label: '库存流水' },
      { key: '/inventory/reservations', label: 'Reservation' },
    ],
  },
  {
    key: 'order-group',
    label: '订单',
    children: [{ key: '/orders', label: '订单管理' }],
  },
  {
    key: 'warehouse-ops-group',
    label: '仓库作业',
    children: [
      { key: '/picking', label: '拣货' },
      { key: '/shipments', label: '发货' },
      { key: '/interceptions', label: '拦截' },
    ],
  },
  {
    key: 'platform-group',
    label: '平台',
    children: [
      { key: '/stores', label: '店铺管理' },
      { key: '/store-bindings', label: '店仓绑定' },
      { key: '/sync', label: '同步中心' },
    ],
  },
  {
    key: 'system-group',
    label: '系统',
    children: [
      { key: '/import', label: '导入中心' },
      { key: '/notifications', label: '通知中心' },
    ],
  },
];

/** Authenticated app shell with the Sprint 4 sidebar (task §56). */
export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const selectedKey = location.pathname;
  const openKeys = MENU_ITEMS.filter(
    (item) =>
      'children' in item && item.children?.some((child) => selectedKey.startsWith(child.key)),
  ).map((item) => item.key);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200} theme="dark">
        <div style={{ color: '#fff', padding: 16, fontSize: 18, fontWeight: 700 }}>WCIES</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={openKeys}
          items={MENU_ITEMS}
          onClick={({ key }) => {
            if (String(key).startsWith('/')) {
              void navigate(String(key));
            }
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', paddingInline: 24, fontSize: 16, fontWeight: 600 }}>
          跨境电商综合管理系统
        </Header>
        <Content style={{ margin: 16 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
