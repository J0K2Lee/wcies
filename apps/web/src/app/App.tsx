import { Navigate, Route, Routes } from 'react-router';
import { useNavigate } from 'react-router';
import { Button } from 'antd';
import { HealthTestPage } from '../pages/HealthTestPage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { AuthGate } from './AuthGate';
import { AppLayout } from './AppLayout';
import { ProductsPage } from '../pages/products/ProductsPage';
import { SkusPage } from '../pages/skus/SkusPage';
import { ListingsPage } from '../pages/listings/ListingsPage';
import { WarehousesPage } from '../pages/warehouses/WarehousesPage';
import { BinsPage } from '../pages/warehouses/BinsPage';
import { StoresPage } from '../pages/stores/StoresPage';
import { StoreBindingsPage } from '../pages/stores/StoreBindingsPage';
import { ImportPage } from '../pages/import/ImportPage';
import { InventoryPage } from '../pages/inventory/InventoryPage';
import { InventoryTransactionsPage } from '../pages/inventory/InventoryTransactionsPage';
import { ReservationsPage } from '../pages/inventory/ReservationsPage';
import { OrdersPage } from '../pages/orders/OrdersPage';
import { WarehouseOpsPage } from '../pages/warehouse-ops/WarehouseOpsPage';
import { PickingTaskWorkPage } from '../pages/picking/PickingTaskWorkPage';
import { ShipmentDetailPage } from '../pages/shipments/ShipmentDetailPage';
import { PackageWorkPage } from '../pages/shipments/PackageWorkPage';
import { InterceptionDetailPage } from '../pages/interceptions/InterceptionDetailPage';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { SyncCenterPage } from '../pages/sync/SyncCenterPage';
import { ExceptionsPage } from '../pages/exceptions/ExceptionsPage';
import { SuppliersPage } from '../pages/purchase/SuppliersPage';
import { PurchaseOrdersPage } from '../pages/purchase/PurchaseOrdersPage';
import { PurchaseReceiptsPage } from '../pages/purchase/PurchaseReceiptsPage';
import { SystemPage } from '../pages/system/SystemPage';
import { PlatformMappingsPage } from '../pages/system/PlatformMappingsPage';
import { EmptyState } from '../design-system';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGate />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/health-test" element={<HealthTestPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/skus" element={<SkusPage />} />
          <Route path="/listings" element={<ListingsPage />} />
          <Route path="/warehouses" element={<WarehousesPage />} />
          <Route path="/bins" element={<BinsPage />} />
          <Route path="/stores" element={<StoresPage />} />
          <Route path="/store-bindings" element={<StoreBindingsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/inventory/transactions" element={<InventoryTransactionsPage />} />
          <Route path="/inventory/reservations" element={<ReservationsPage />} />
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
          <Route path="/system" element={<SystemPage />} />
          <Route path="/platform-mappings" element={<PlatformMappingsPage />} />
          {/* 404：未知路由回到空态 + 返回首页（Phase 3 G10）。 */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
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
