import { Route, Routes } from 'react-router';
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
import { PickingPage } from '../pages/picking/PickingPage';
import { PickingTaskWorkPage } from '../pages/picking/PickingTaskWorkPage';
import { ShipmentsPage } from '../pages/shipments/ShipmentsPage';
import { ShipmentDetailPage } from '../pages/shipments/ShipmentDetailPage';
import { PackageWorkPage } from '../pages/shipments/PackageWorkPage';
import { InterceptionsPage } from '../pages/interceptions/InterceptionsPage';
import { InterceptionDetailPage } from '../pages/interceptions/InterceptionDetailPage';
import { NotificationsPage } from '../pages/notifications/NotificationsPage';
import { SyncCenterPage } from '../pages/sync/SyncCenterPage';
import { ExceptionsPage } from '../pages/exceptions/ExceptionsPage';
import { SuppliersPage } from '../pages/purchase/SuppliersPage';
import { PurchaseOrdersPage } from '../pages/purchase/PurchaseOrdersPage';
import { SystemPage } from '../pages/system/SystemPage';
import { PlatformMappingsPage } from '../pages/system/PlatformMappingsPage';

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
          <Route path="/picking" element={<PickingPage />} />
          <Route path="/picking/:id" element={<PickingTaskWorkPage />} />
          <Route path="/shipments" element={<ShipmentsPage />} />
          <Route path="/shipments/:id" element={<ShipmentDetailPage />} />
          <Route path="/packages/:id" element={<PackageWorkPage />} />
          <Route path="/interceptions" element={<InterceptionsPage />} />
          <Route path="/interceptions/:id" element={<InterceptionDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/sync" element={<SyncCenterPage />} />
          <Route path="/exceptions" element={<ExceptionsPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
          <Route path="/system" element={<SystemPage />} />
          <Route path="/platform-mappings" element={<PlatformMappingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
