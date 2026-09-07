import { Route, Routes } from 'react-router';
import { HealthTestPage } from '../pages/HealthTestPage';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { AppLayout } from './AppLayout';
import { ProductsPage } from '../pages/products/ProductsPage';
import { SkusPage } from '../pages/skus/SkusPage';
import { ListingsPage } from '../pages/listings/ListingsPage';
import { WarehousesPage } from '../pages/warehouses/WarehousesPage';
import { BinsPage } from '../pages/warehouses/BinsPage';
import { StoresPage } from '../pages/stores/StoresPage';
import { StoreBindingsPage } from '../pages/stores/StoreBindingsPage';
import { ImportPage } from '../pages/import/ImportPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/health-test" element={<HealthTestPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/skus" element={<SkusPage />} />
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/warehouses" element={<WarehousesPage />} />
        <Route path="/bins" element={<BinsPage />} />
        <Route path="/stores" element={<StoresPage />} />
        <Route path="/store-bindings" element={<StoreBindingsPage />} />
        <Route path="/import" element={<ImportPage />} />
      </Route>
    </Routes>
  );
}
