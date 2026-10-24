import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { SetupStatus } from '@flexpos/shared';
import { api } from './lib/api';
import { useSession } from './lib/session';
import { useSettings, useTheme } from './lib/settings';
import { useLiveInvalidation } from './lib/live';
import { AppShell } from './components/layout/AppShell';
import { Spinner, ErrorState } from './components/ui/core';
import { LoginPage } from './pages/LoginPage';

const SetupWizard = lazy(() => import('./pages/setup/SetupWizard'));
const PosPage = lazy(() => import('./pages/pos/PosPage'));
const DashboardPage = lazy(() => import('./pages/reports/DashboardPage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const ProductsPage = lazy(() => import('./pages/products/ProductsPage'));
const ProductEditor = lazy(() => import('./pages/products/ProductEditor'));
const StockPage = lazy(() => import('./pages/stock/StockPage'));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'));
const PromotionsPage = lazy(() => import('./pages/promotions/PromotionsPage'));
const SalesPage = lazy(() => import('./pages/sales/SalesPage'));
const ShiftPage = lazy(() => import('./pages/shift/ShiftPage'));
const FloorPage = lazy(() => import('./pages/tables/FloorPage'));
const OrdersPage = lazy(() => import('./pages/tables/OrdersPage'));
const KitchenPage = lazy(() => import('./pages/kitchen/KitchenPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const HelpPage = lazy(() => import('./pages/HelpPage'));
const CustomerDisplay = lazy(() => import('./pages/display/CustomerDisplay'));
const OrderApp = lazy(() => import('./order/OrderApp'));

function FullSpinner() {
  return (
    <div className="grid h-full min-h-[60vh] place-items-center">
      <Spinner className="h-7 w-7" />
    </div>
  );
}

function Home() {
  const { can } = useSession();
  const settings = useSettings();
  if (can('pos.sell')) return <Navigate to="/pos" replace />;
  if (can('kitchen.view') && settings.modules.kitchenDisplay) return <Navigate to="/kitchen" replace />;
  if (can('tables.manage') && settings.modules.restaurant) return <Navigate to="/tables" replace />;
  if (can('reports.view')) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/help" replace />;
}

function Authed() {
  const settings = useSettings();
  useTheme(settings);
  useLiveInvalidation();
  return (
    <AppShell>
      <Suspense fallback={<FullSpinner />}>
        <Routes>
          <Route index element={<Home />} />
          <Route path="pos" element={<PosPage />} />
          <Route path="tables" element={<FloorPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="kitchen" element={<KitchenPage />} />
          <Route path="sales" element={<SalesPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="products/new" element={<ProductEditor />} />
          <Route path="products/:id" element={<ProductEditor />} />
          <Route path="stock/*" element={<StockPage />} />
          <Route path="customers/*" element={<CustomersPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="shift" element={<ShiftPage />} />
          <Route path="settings/:section?" element={<SettingsPage />} />
          <Route path="help" element={<HelpPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}

export function App() {
  const { user, loading } = useSession();
  const loc = useLocation();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<SetupStatus>('/api/setup/status'), staleTime: 30_000, retry: 3 });

  useEffect(() => {
    document.title = 'FlexPOS';
  }, []);

  if (loc.pathname === '/order' || loc.pathname.startsWith('/order/')) {
    return (
      <Suspense fallback={<FullSpinner />}>
        <OrderApp />
      </Suspense>
    );
  }
  if (loc.pathname.startsWith('/display')) {
    return (
      <Suspense fallback={<FullSpinner />}>
        <CustomerDisplay />
      </Suspense>
    );
  }
  if (status.isLoading || loading) return <FullSpinner />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => status.refetch()} className="min-h-screen justify-center" />;
  const s = status.data!;
  if (!s.configured || !s.hasOwner) {
    return (
      <Suspense fallback={<FullSpinner />}>
        <SetupWizard status={s} />
      </Suspense>
    );
  }
  if (!user) return <LoginPage status={s} />;
  return <Authed />;
}
