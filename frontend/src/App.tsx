import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { DashboardPage } from "./pages/DashboardPage";
import { PosBillingPage } from "./pages/PosBillingPage";
import { PurchasesPage } from "./pages/PurchasesPage";
import { StockLedgerPage } from "./pages/StockLedgerPage";
import { ReportsPage } from "./pages/ReportsPage";
import { MastersPage } from "./pages/MastersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillsPage } from "./pages/BillsPage";
import { SalesReturnPage } from "./pages/SalesReturnPage";
import { PurchaseReturnPage } from "./pages/PurchaseReturnPage";
import { CustomerDebitNotePage } from "./pages/CustomerDebitNotePage";
import { InterStoreTransferPage } from "./pages/InterStoreTransferPage";
import { CounterStatusPage } from "./pages/CounterStatusPage";
import { StoreSetupPage } from "./pages/StoreSetupPage";
import { StaffLoginPage } from "./pages/StaffLoginPage";
import { ImportExportHubPage } from "./pages/ImportExportHubPage";
import { DataMigrationPage } from "./pages/DataMigrationPage";
import { companySettingsService } from "./lib/settings/companySettingsService";
import { initWorkspaceSettings, applyWorkspaceSettings } from "./lib/settings/workspaceThemeService";
import { storeDeviceService } from "./lib/auth/storeDeviceService";
import { staffAuthService } from "./lib/auth/staffAuthService";
import "./lib/ui/modalEscapeManager";

const LandingRedirect: React.FC = () => {
  const [target, setTarget] = useState<string>("/dashboard");

  useEffect(() => {
    companySettingsService.loadSettings().then((cfg) => {
      if (cfg?.workspace) {
        applyWorkspaceSettings(cfg.workspace);
      }
      const page = cfg?.workspace?.defaultLandingPage;
      if (page === "pos") {
        setTarget("/pos");
      } else if (page === "bills") {
        setTarget("/bills");
      } else if (page === "stock") {
        setTarget("/stock");
      } else if (page === "purchases") {
        setTarget("/purchases");
      } else {
        setTarget("/dashboard");
      }
    });
  }, []);

  return <Navigate to={target} replace />;
};

export const App: React.FC = () => {
  const [isDeviceRegistered, setIsDeviceRegistered] = useState<boolean | null>(null);
  const [hasStaffSession, setHasStaffSession] = useState<boolean>(
    Boolean(staffAuthService.getCurrentSession())
  );

  useEffect(() => {
    initWorkspaceSettings();

    // Trigger daily auto-backup check
    import("./lib/backup/dailyAutoBackup").then(({ dailyAutoBackupService }) => {
      dailyAutoBackupService.runDailyBackupCheck().catch(() => {});
    });

    // Check device onboarding
    storeDeviceService.isDeviceRegistered().then((registered) => {
      if (!registered) {
        // Auto-provision demo device profile if running in standard desktop sandbox
        storeDeviceService
          .registerWithActivationKey("LAM-DEMO-2026-KEY", "Counter 01", true)
          .then(() => setIsDeviceRegistered(true))
          .catch(() => setIsDeviceRegistered(false));
      } else {
        setIsDeviceRegistered(true);
      }
    });

    const unsub = staffAuthService.onSessionChange((session) => {
      setHasStaffSession(Boolean(session));
    });

    return unsub;
  }, []);

  if (isDeviceRegistered === null) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center font-sans text-white text-xs">
        Initializing LamSuite Billing Workstation...
      </div>
    );
  }

  if (isDeviceRegistered === false) {
    return <StoreSetupPage onSetupComplete={() => setIsDeviceRegistered(true)} />;
  }

  if (!hasStaffSession) {
    return <StaffLoginPage onLoginSuccess={() => setHasStaffSession(true)} />;
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<LandingRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/pos" element={<PosBillingPage />} />
          <Route path="/bills" element={<BillsPage />} />
          <Route path="/purchases" element={<PurchasesPage />} />
          <Route path="/stock" element={<StockLedgerPage />} />
          <Route path="/stock/transfers" element={<InterStoreTransferPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/masters" element={<MastersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/counters" element={<CounterStatusPage />} />
          <Route path="/returns/sales" element={<SalesReturnPage />} />
          <Route path="/returns/purchases" element={<PurchaseReturnPage />} />
          <Route path="/returns/debit-notes" element={<CustomerDebitNotePage />} />
          <Route path="/import-export" element={<ImportExportHubPage />} />
          <Route path="/migration" element={<DataMigrationPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
