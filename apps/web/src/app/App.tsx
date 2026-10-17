import { Suspense } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router';
import { Button } from 'antd';
import { EmptyState } from '../design-system';
import { AppLayout } from './AppLayout';
import { AuthGate } from './AuthGate';
import { BootFallback } from './RouteFallback';
import { page } from './lazy-page';

/**
 * 路由表（S1-1 代码分割，2026-10-17 体检报告 §4.3）。
 *
 * 分包策略：
 * - **常驻静态**：AuthGate / AppLayout / design-system —— 首帧必需的外壳。
 * - **按需加载**：全部页面组件经 `page()` 走动态 import，构建时各自成块。
 *   改造前 43 个页面 + 全部依赖挤在 1 个 1.94 MB（gzip 572 kB）的 chunk 里。
 * - **重定向路由保持静态**：`<Navigate>` 不引任何页面代码，没有分包价值。
 *
 * 新增页面时照抄一行 `const XxxPage = page(() => import('...'), 'XxxPage');` 即可，
 * 不要在路由表里改回静态 import —— 那会把该页面的代码重新拽进首屏。
 */
const DashboardPage = page(() => import('../pages/DashboardPage'), 'DashboardPage');
const HealthTestPage = page(() => import('../pages/HealthTestPage'), 'HealthTestPage');
const LoginPage = page(() => import('../pages/LoginPage'), 'LoginPage');
const SkusPage = page(() => import('../pages/skus/SkusPage'), 'SkusPage');
const ListingsPage = page(() => import('../pages/listings/ListingsPage'), 'ListingsPage');
const WarehousesPage = page(() => import('../pages/warehouses/WarehousesPage'), 'WarehousesPage');
const BinsPage = page(() => import('../pages/warehouses/BinsPage'), 'BinsPage');
const StoresPage = page(() => import('../pages/stores/StoresPage'), 'StoresPage');
const ImportPage = page(() => import('../pages/import/ImportPage'), 'ImportPage');
const InventoryPage = page(() => import('../pages/inventory/InventoryPage'), 'InventoryPage');
const InventoryTransactionsPage = page(
  () => import('../pages/inventory/InventoryTransactionsPage'),
  'InventoryTransactionsPage',
);
const ReservationsPage = page(
  () => import('../pages/inventory/ReservationsPage'),
  'ReservationsPage',
);
const ReplenishmentPage = page(
  () => import('../pages/inventory/ReplenishmentPage'),
  'ReplenishmentPage',
);
const OrdersPage = page(() => import('../pages/orders/OrdersPage'), 'OrdersPage');
const WarehouseOpsPage = page(
  () => import('../pages/warehouse-ops/WarehouseOpsPage'),
  'WarehouseOpsPage',
);
const PickingTaskWorkPage = page(
  () => import('../pages/picking/PickingTaskWorkPage'),
  'PickingTaskWorkPage',
);
const ShipmentDetailPage = page(
  () => import('../pages/shipments/ShipmentDetailPage'),
  'ShipmentDetailPage',
);
const PackageWorkPage = page(() => import('../pages/shipments/PackageWorkPage'), 'PackageWorkPage');
const InterceptionDetailPage = page(
  () => import('../pages/interceptions/InterceptionDetailPage'),
  'InterceptionDetailPage',
);
const NotificationsPage = page(
  () => import('../pages/notifications/NotificationsPage'),
  'NotificationsPage',
);
const SyncCenterPage = page(() => import('../pages/sync/SyncCenterPage'), 'SyncCenterPage');
const ExceptionsPage = page(() => import('../pages/exceptions/ExceptionsPage'), 'ExceptionsPage');
const SuppliersPage = page(() => import('../pages/purchase/SuppliersPage'), 'SuppliersPage');
const PurchaseOrdersPage = page(
  () => import('../pages/purchase/PurchaseOrdersPage'),
  'PurchaseOrdersPage',
);
const PurchaseReceiptsPage = page(
  () => import('../pages/purchase/PurchaseReceiptsPage'),
  'PurchaseReceiptsPage',
);
const FinanceOverviewPage = page(
  () => import('../pages/finance/FinanceOverviewPage'),
  'FinanceOverviewPage',
);
const FinanceTransactionsPage = page(
  () => import('../pages/finance/FinanceTransactionsPage'),
  'FinanceTransactionsPage',
);
const FinancePayoutsPage = page(
  () => import('../pages/finance/FinancePayoutsPage'),
  'FinancePayoutsPage',
);
const FinanceSettlementsPage = page(
  () => import('../pages/finance/FinanceSettlementsPage'),
  'FinanceSettlementsPage',
);
const FinancePayablesPage = page(
  () => import('../pages/finance/FinancePayablesPage'),
  'FinancePayablesPage',
);
const TransfersPage = page(() => import('../pages/transfer/TransfersPage'), 'TransfersPage');
const SystemPage = page(() => import('../pages/system/SystemPage'), 'SystemPage');
const UsersPage = page(() => import('../pages/system/UsersPage'), 'UsersPage');
const AccountSecurityPage = page(
  () => import('../pages/system/AccountSecurityPage'),
  'AccountSecurityPage',
);
const PlatformMappingsPage = page(
  () => import('../pages/system/PlatformMappingsPage'),
  'PlatformMappingsPage',
);
const InvitePage = page(() => import('../pages/auth/InvitePage'), 'InvitePage');
const ResetPasswordPage = page(
  () => import('../pages/auth/ResetPasswordPage'),
  'ResetPasswordPage',
);
const ConfirmEmailChangePage = page(
  () => import('../pages/auth/ConfirmEmailChangePage'),
  'ConfirmEmailChangePage',
);

export function App() {
  return (
    // 公共路由（未登录可达）此时还没有工作台外壳，只能全屏兜底；
    // 应用内页面的骨架由 AppLayout 内那层 Suspense 负责（离内容区更近，优先命中）。
    <Suspense fallback={<BootFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 邮件验证链接的公共落地页：令牌即凭证，无需登录（users.md）。 */}
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/change-email/confirm" element={<ConfirmEmailChangePage />} />
        <Route element={<AuthGate />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/health-test" element={<HealthTestPage />} />
            <Route path="/skus" element={<SkusPage />} />
            <Route path="/listings" element={<ListingsPage />} />
            <Route path="/warehouses" element={<WarehousesPage />} />
            <Route path="/bins" element={<BinsPage />} />
            <Route path="/stores" element={<StoresPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/inventory/transactions" element={<InventoryTransactionsPage />} />
            <Route path="/inventory/reservations" element={<ReservationsPage />} />
            <Route path="/inventory/replenishment" element={<ReplenishmentPage />} />
            <Route path="/orders" element={<OrdersPage />} />
            {/* 作业中心：拣货/发货/拦截/退货合并入口；旧列表路由重定向保持深链兼容。 */}
            <Route path="/warehouse-ops" element={<WarehouseOpsPage />} />
            <Route path="/picking" element={<Navigate to="/warehouse-ops?tab=picking" replace />} />
            <Route path="/picking/:id" element={<PickingTaskWorkPage />} />
            <Route
              path="/shipments"
              element={<Navigate to="/warehouse-ops?tab=shipments" replace />}
            />
            <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
            <Route path="/packages/:id" element={<PackageWorkPage />} />
            <Route
              path="/interceptions"
              element={<Navigate to="/warehouse-ops?tab=interceptions" replace />}
            />
            <Route path="/interceptions/:id" element={<InterceptionDetailPage />} />
            <Route path="/returns" element={<Navigate to="/warehouse-ops?tab=returns" replace />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/sync" element={<SyncCenterPage />} />
            <Route path="/exceptions" element={<ExceptionsPage />} />
            <Route path="/suppliers" element={<SuppliersPage />} />
            <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/purchase-receipts" element={<PurchaseReceiptsPage />} />
            {/* 财务中心（Sprint 10）：流水/回款/结算/应付 + 总览。 */}
            <Route path="/finance" element={<FinanceOverviewPage />} />
            <Route path="/finance/transactions" element={<FinanceTransactionsPage />} />
            <Route path="/finance/payouts" element={<FinancePayoutsPage />} />
            <Route path="/finance/settlements" element={<FinanceSettlementsPage />} />
            <Route path="/finance/payables" element={<FinancePayablesPage />} />
            <Route path="/transfers" element={<TransfersPage />} />
            <Route path="/system" element={<SystemPage />} />
            <Route path="/system/users" element={<UsersPage />} />
            <Route path="/account" element={<AccountSecurityPage />} />
            <Route path="/platform-mappings" element={<PlatformMappingsPage />} />
            {/* 404：未知路由回到空态 + 返回首页（Phase 3 G10）。 */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div style={{ padding: '80px 0', display: 'flex', justifyContent: 'center' }}>
      <EmptyState
        title="页面不存在"
        description="地址有误或页面已被移除。"
        action={
          <Button type="primary" onClick={() => void navigate('/')}>
            返回首页
          </Button>
        }
      />
    </div>
  );
}
