import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { I18nProvider } from "./i18n/I18nContext";
import { Layout } from "./components/Layout";

// Pages
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { StoresPage } from "./pages/StoresPage";
import { DevicesPage } from "./pages/DevicesPage";
import { CountersPage } from "./pages/CountersPage";
import { FeaturesPage } from "./pages/FeaturesPage";
import { UsersPage } from "./pages/UsersPage";
import { MastersPage } from "./pages/MastersPage";
import { SalespeoplePage } from "./pages/SalespeoplePage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { GiftCardsPage } from "./pages/GiftCardsPage";
import { SettlementsPage } from "./pages/SettlementsPage";
import { CompliancePage } from "./pages/CompliancePage";
import { PriceListsPage } from "./pages/PriceListsPage";
import { SalesOrdersPage } from "./pages/SalesOrdersPage";
import { LoyaltyPage } from "./pages/LoyaltyPage";
import { AccountingExportsPage } from "./pages/AccountingExportsPage";
import { PortalPage } from "./pages/PortalPage";
import { PortalAccessPage } from "./pages/PortalAccessPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SyncCenterPage } from "./pages/SyncCenterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AuditLogsPage } from "./pages/AuditLogsPage";
import { MigrationCenterPage } from "./pages/MigrationCenterPage";
import { DayClosePage } from "./pages/DayClosePage";
import { Building2, RefreshCw } from "lucide-react";

const ProtectedRoutes: React.FC = () => {
  const { user, token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 text-slate-100 font-sans">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="font-bold text-lg text-white">LamSuite Admin</div>
            <div className="text-xs text-slate-400">Enterprise Cloud Console</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <RefreshCw className="w-4 h-4 animate-spin text-blue-500" />
          Verifying security credentials & active session...
        </div>
      </div>
    );
  }

  if (!token || !user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/stores" element={<StoresPage />} />
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/counters" element={<CountersPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/masters" element={<MastersPage />} />
        <Route path="/salespeople" element={<SalespeoplePage />} />
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/gift-cards" element={<GiftCardsPage />} />
        <Route path="/settlements" element={<SettlementsPage />} />
        <Route path="/day-close" element={<DayClosePage />} />
        <Route path="/compliance" element={<CompliancePage />} />
        <Route path="/price-lists" element={<PriceListsPage />} />
        <Route path="/sales-orders" element={<SalesOrdersPage />} />
        <Route path="/loyalty" element={<LoyaltyPage />} />
        <Route path="/accounting-exports" element={<AccountingExportsPage />} />
        <Route path="/portal-access" element={<PortalAccessPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/sync" element={<SyncCenterPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/audit" element={<AuditLogsPage />} />
        <Route path="/migrations" element={<MigrationCenterPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
};

const AppRoutes: React.FC = () => {
  const { token, user, isLoading } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={
          !isLoading && token && user ? <Navigate to="/" replace /> : <LoginPage />
        }
      />
      <Route path="/portal" element={<PortalPage />} />
      <Route path="/reset-password" element={<LoginPage />} />
      <Route path="/*" element={<ProtectedRoutes />} />
    </Routes>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <I18nProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </I18nProvider>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
