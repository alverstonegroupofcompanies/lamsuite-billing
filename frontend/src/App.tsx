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

import { StoreGatewayPage } from "./pages/StoreGatewayPage";
import { storeRegistryService, type RegisteredStoreRecord } from "./lib/auth/storeRegistryService";
import { autoUpdateService, type UpdateInfo } from "./lib/settings/autoUpdateService";
import { UpdateNotificationModal } from "./components/UpdateNotificationModal";
import { API_BASE_URL, DEFAULT_LAN_PORT } from "./config/env";
import { cloudDeltaSyncService } from "./lib/sync/cloudDeltaSyncService";
import { lanPeerService } from "./lib/lan/lanPeerService";
import { productsStore } from "./lib/masters/productsStore";

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
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [registeredStores, setRegisteredStores] = useState<RegisteredStoreRecord[]>([]);
  const [activeStore, setActiveStore] = useState<RegisteredStoreRecord | null>(null);
  const [showGateway, setShowGateway] = useState<boolean>(false);
  const [isAddingStore, setIsAddingStore] = useState<boolean>(false);
  const [hasStaffSession, setHasStaffSession] = useState<boolean>(
    Boolean(staffAuthService.getCurrentSession())
  );
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    initWorkspaceSettings();

    // Check for updates in desktop mode
    companySettingsService.loadSettings().then((cfg) => {
      if (cfg?.workspace?.autoUpdateCheck !== false) {
        autoUpdateService.checkForUpdates().then((res) => {
          if (res.shouldUpdate) {
            setAvailableUpdate(res);
          }
        }).catch(() => {
          // Silent catch on network/offline
        });
      }
    });

    // Trigger daily auto-backup check
    import("./lib/backup/dailyAutoBackup").then(({ dailyAutoBackupService }) => {
      dailyAutoBackupService.runDailyBackupCheck().catch(() => {});
    });

    // Initialize Store Registry
    storeRegistryService.loadRegistry().then(async (registry) => {
      if (!registry.stores || registry.stores.length === 0) {
        // Fallback check legacy store
        const isLegacyReg = await storeDeviceService.isDeviceRegistered();
        if (isLegacyReg) {
          const updated = await storeRegistryService.loadRegistry();
          setRegisteredStores(updated.stores);
          setActiveStore(storeRegistryService.getActiveStore());
        } else {
          setRegisteredStores([]);
        }
      } else {
        // Online token re-validation with cloud backend on boot
        const validation = await storeDeviceService.validateDeviceSession().catch(() => ({ valid: true, locked: false }));
        if (validation.locked) {
          console.warn("Workstation token unrecognized or revoked by server. Device reset to Setup.");
          const updated = await storeRegistryService.loadRegistry();
          setRegisteredStores(updated.stores.filter((s) => s.is_active));
          setActiveStore(null);
        } else {
          setRegisteredStores(registry.stores);
          const currentActive = storeRegistryService.getActiveStore() || registry.stores[0];
          setActiveStore(currentActive);

          // If auto_open_last is false, present gateway screen on boot
          if (!registry.auto_open_last) {
            setShowGateway(true);
          } else if (currentActive) {
            await storeRegistryService.switchActiveStore(currentActive.id, true).catch(() => {});
          }
        }
      }
      setIsInitializing(false);
    });

    // Periodic heartbeat token re-validation while online (every 5 minutes)
    const heartbeatTimer = setInterval(() => {
      storeDeviceService.validateDeviceSession().then((val) => {
        if (val.locked) {
          storeRegistryService.loadRegistry().then((updated) => {
            setRegisteredStores(updated.stores.filter((s) => s.is_active));
            setActiveStore(null);
          });
        }
      }).catch(() => {});
    }, 5 * 60 * 1000);

    const unsubStaff = staffAuthService.onSessionChange((session) => {
      setHasStaffSession(Boolean(session));
    });

    const unsubReg = storeRegistryService.onRegistryChange((reg) => {
      setRegisteredStores(reg.stores);
      setActiveStore(storeRegistryService.getActiveStore());
    });

    return () => {
      clearInterval(heartbeatTimer);
      unsubStaff();
      unsubReg();
    };
  }, []);

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center font-sans text-white text-xs">
        Initializing LamSuite Multi-Store Billing Workstation...
      </div>
    );
  }

  // If no stores are registered at all, or user clicked "Add Store"
  if (registeredStores.length === 0 || isAddingStore) {
    return (
      <StoreSetupPage
        onSetupComplete={async (profile) => {
          setIsAddingStore(false);
          const reg = await storeRegistryService.loadRegistry();
          setRegisteredStores(reg.stores);
          const active = storeRegistryService.getActiveStore() || reg.stores[reg.stores.length - 1];
          setActiveStore(active);
          setShowGateway(false);
        }}
        onCancel={registeredStores.length > 0 ? () => setIsAddingStore(false) : undefined}
      />
    );
  }

  // Tally-style Store Gateway Selection Screen
  if (showGateway || !activeStore) {
    return (
      <StoreGatewayPage
        onSelectStore={(selected) => {
          setActiveStore(selected);
          setShowGateway(false);
        }}
        onAddNewStore={() => setIsAddingStore(true)}
      />
    );
  }

  // Operator PIN/Password Login for Active Store
  if (!hasStaffSession) {
    return (
      <StaffLoginPage
        key={activeStore?.id || "default"}
        activeStore={activeStore}
        onLoginSuccess={async () => {
          setHasStaffSession(true);

          // On first login / sign in, ensure master catalog is pulled and ready for work
          try {
            const currentProducts = await productsStore.getAllProducts();
            const activeProfile = await storeDeviceService.getDeviceProfile();

            // Check if secondary LAN counter
            const isLanClient = !activeStore?.is_hub && (
              activeProfile?.store_id?.startsWith("store_lan") ||
              activeStore?.db_path?.includes("lan") ||
              activeProfile?.license_plan?.includes("LAN") ||
              activeProfile?.counter_code !== "C01"
            );

            if (isLanClient) {
              // Fetch only from LAN Server Hub, not from backend server
              const hubIp = localStorage.getItem("lamsuite_hub_ip");
              const hubPort = Number(localStorage.getItem("lamsuite_hub_port")) || DEFAULT_LAN_PORT;
              const deviceToken = localStorage.getItem("lamsuite_device_token") || undefined;
              if (hubIp) {
                await lanPeerService.pullMasterSnapshotFromMain(hubIp, hubPort, undefined, deviceToken).catch(async () => {
                  if (hubPort !== 8000) {
                    await lanPeerService.pullMasterSnapshotFromMain(hubIp, 8000, undefined, deviceToken).catch(() => {});
                  }
                });
              }
            } else if (currentProducts.length <= 1) {
              // Master station / first sign in: check backend server for catalog data
              const storeId = activeStore?.id || activeProfile?.store_id || "1";
              await cloudDeltaSyncService.pullMasterDelta({
                fetchMasterDeltas: async (wm) => {
                  const res = await fetch(`${API_BASE_URL}/api/sync/pull/deltas?store_id=${storeId}&since_watermark=${wm}`);
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  return res.json();
                },
              }).catch(() => {});
            }
          } catch (e) {
            console.warn("Post-login data pull check deferred:", e);
          }
        }}
        onBackToStores={() => setShowGateway(true)}
      />
    );
  }

  return (
    <BrowserRouter>
      <Layout
        onOpenGateway={() => setShowGateway(true)}
        onAddNewStore={() => setIsAddingStore(true)}
      >
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
      {availableUpdate && (
        <UpdateNotificationModal
          updateInfo={availableUpdate}
          onClose={() => setAvailableUpdate(null)}
        />
      )}
    </BrowserRouter>
  );
};

export default App;
