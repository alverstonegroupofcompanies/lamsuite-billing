import React, { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { AccessGate } from "./components/AccessGate";
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
import { ExpensesPage } from "./pages/ExpensesPage";
import { InterStoreTransferPage } from "./pages/InterStoreTransferPage";
import { CounterStatusPage } from "./pages/CounterStatusPage";
import { StoreSetupPage } from "./pages/StoreSetupPage";
import { ImportExportHubPage } from "./pages/ImportExportHubPage";
import { DataMigrationPage } from "./pages/DataMigrationPage";
import { companySettingsService } from "./lib/settings/companySettingsService";
import { initWorkspaceSettings, applyWorkspaceSettings } from "./lib/settings/workspaceThemeService";
import { storeDeviceService } from "./lib/auth/storeDeviceService";
import { staffAuthService } from "./lib/auth/staffAuthService";
import { counterSessionService } from "./lib/auth/counterSessionService";
import "./lib/ui/modalEscapeManager";

import { StoreGatewayPage } from "./pages/StoreGatewayPage";
import { storeRegistryService, type RegisteredStoreRecord } from "./lib/auth/storeRegistryService";
import { autoUpdateService, type UpdateInfo } from "./lib/settings/autoUpdateService";
import { UpdateNotificationModal } from "./components/UpdateNotificationModal";
import { windows7PrereqService, type Windows7PrereqStatus } from "./lib/lan/windows7PrereqService";
import { Windows7PrereqModal } from "./components/Windows7PrereqModal";
import { API_BASE_URL } from "./config/env";
import { cloudDeltaSyncService } from "./lib/sync/cloudDeltaSyncService";
import { deviceSessionService } from "./lib/devices/deviceSessionService";
import { syncQueueService } from "./lib/sync/syncQueueService";
import { productsStore } from "./lib/masters/productsStore";
import { unitsStore } from "./lib/masters/unitsStore";
import { ModalStackProvider } from "./lib/modal/CentralModalManager";

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
  const [availableUpdate, setAvailableUpdate] = useState<UpdateInfo | null>(null);
  const [win7Status, setWin7Status] = useState<Windows7PrereqStatus | null>(null);
  const [showWin7Modal, setShowWin7Modal] = useState<boolean>(false);
  const [unsentBillCount, setUnsentBillCount] = useState<number>(0);

  useEffect(() => {
    initWorkspaceSettings();

    // Apply store security policy to the local staff auth service and push any
    // security audit events queued while the workstation was offline.
    companySettingsService
      .loadSettings()
      .then((cfg) => {
        if (cfg?.security) {
          if (Number.isFinite(cfg.security.maxFailedLogins)) {
            staffAuthService.setMaxFailedAttempts(cfg.security.maxFailedLogins);
          }
          if (cfg.security.offlineGraceHours !== undefined) {
            staffAuthService.setOfflineGraceHours(cfg.security.offlineGraceHours);
          }
        }
      })
      .catch(() => {});
    staffAuthService.flushOfflineAudit().catch(() => {});
    const flushAuditOnReconnect = () => {
      staffAuthService.flushOfflineAudit().catch(() => {});
    };
    window.addEventListener("online", flushAuditOnReconnect);

    // Check Windows 7 / 8.1 runtime prerequisites
    const { isLegacy } = windows7PrereqService.detectLegacyWindows();
    if (isLegacy) {
      windows7PrereqService.runDiagnostics().then((status) => {
        setWin7Status(status);
        if (!status.httpsProbePassed || status.certStoreIssueDetected || status.tls12IssueDetected) {
          setShowWin7Modal(true);
        }
      });
    }

    // Check for updates in desktop mode
    const updateCfg = autoUpdateService.getConfig();
    if (updateCfg.autoCheckOnStartup) {
      autoUpdateService.checkForUpdates().then((res) => {
        if (res.shouldUpdate) {
          setAvailableUpdate(res);
        }
      }).catch(() => {
        // Silent catch on background check
      });
    }

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
          const legacyActiveId = storeRegistryService.getActiveStore()?.id;
          if (legacyActiveId) {
            productsStore.ensureCatalogPopulated(String(legacyActiveId)).catch(() => {});
          }
          unitsStore.seedDefaultsIfEmpty().catch(() => {});
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

          // registry.stores is non-empty here, so currentActive is a claimed store;
          // never fall back to naming store 1.
          const activeStoreId = String(currentActive.id);
          productsStore.ensureCatalogPopulated(activeStoreId).catch(() => {});
          unitsStore.seedDefaultsIfEmpty().catch(() => {});

          // The catalog pull used to ride on the operator's sign-in. Nobody
          // signs in at the till, so it rides on opening the store.
          cloudDeltaSyncService
            .pullMasterDelta({
              fetchMasterDeltas: async (wm) => {
                const res = await fetch(
                  `${API_BASE_URL}/api/sync/pull/deltas?store_id=${activeStoreId}&since_watermark=${wm}`
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
              },
            })
            .catch(() => {});

          // Fast online verification of store status and remote reset events.
          // Check every registered store so a reset clears the local DB of
          // inactive stores too, not only the currently open one.
          registry.stores.forEach((registeredStore) => {
            const storeId = String(registeredStore.id);
            fetch(`${API_BASE_URL}/api/license/check?store_id=${encodeURIComponent(storeId)}`)
              .then((r) => (r.ok ? r.json() : null))
              .then(async (lic) => {
                if (!lic) return;
                if (
                  storeId === activeStoreId &&
                  lic.is_active !== undefined &&
                  currentActive.is_active !== Boolean(lic.is_active)
                ) {
                  await storeRegistryService.setStoreActiveStatus(currentActive.id, Boolean(lic.is_active));
                  const { companySettingsService } = await import("./lib/settings/companySettingsService");
                  await companySettingsService.updateLocalFromRemote({ is_active: Boolean(lic.is_active) });
                }
                if (lic.last_reset_at) {
                  await storeRegistryService.applyRemoteResetOnce(
                    storeId,
                    lic.last_reset_at,
                    lic.last_reset_options || undefined
                  );
                }
              })
              .catch(() => {});
          });
        }
      }
      // PRF-001: the counter's own document is in hand before the first screen
      // draws, so a till never paints a surface the owner closed.
      await counterSessionService.hydrate().catch(() => {});
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

    // Continuous device session presence heartbeat for logged-in devices tracking
    const stopDeviceHeartbeat = deviceSessionService.startHeartbeatTimer(45000);

    // PRF-004: an attached till is inside the surface its owner just saved
    // within about five seconds, so this poll is on the app's own clock rather
    // than on the 45-second beat.
    counterSessionService.startWatermarkWatch();

    const unsubSync = syncQueueService.subscribe((status) => {
      setUnsentBillCount(status.unsentCount);
    });

    const unsubReg = storeRegistryService.onRegistryChange((reg) => {
      // SYNC-02: a revoked store is deactivated in the registry. Dropping it
      // here is what takes the shell away; keeping it selected left a retired
      // till drawing the POS with its header falling back to "C01".
      const stores = reg.stores.filter((store) => store.is_active !== false);
      const selected = storeRegistryService.getActiveStore();
      setRegisteredStores(stores);
      setActiveStore(selected && selected.is_active !== false ? selected : null);
    });

    return () => {
      clearInterval(heartbeatTimer);
      stopDeviceHeartbeat();
      counterSessionService.stopWatermarkWatch();
      unsubSync();
      unsubReg();
      window.removeEventListener("online", flushAuditOnReconnect);
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
      <>
        {unsentBillCount > 0 && (
          <div className="fixed inset-x-0 top-0 z-50 border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-semibold text-amber-900">
            {unsentBillCount} bill{unsentBillCount === 1 ? "" : "s"} saved on this till{" "}
            {unsentBillCount === 1 ? "is" : "are"} waiting to be sent. They stay on this machine
            until a counter code is claimed again.
          </div>
        )}
        <StoreSetupPage
          onSetupComplete={async (profile) => {
            setIsAddingStore(false);
            const reg = await storeRegistryService.loadRegistry();
            setRegisteredStores(reg.stores);
            const active = storeRegistryService.getActiveStore() || reg.stores[reg.stores.length - 1];
            setActiveStore(active);
            setShowGateway(false);
            // The queue survived the revocation; the fresh claim is what lets it go.
            syncQueueService.resumeAfterClaim();
            syncQueueService.processQueue().catch(() => {});
            productsStore.ensureCatalogPopulated(active?.id || profile.store_id).catch(() => {});
          }}
          onCancel={registeredStores.length > 0 ? () => setIsAddingStore(false) : undefined}
        />
      </>
    );
  }

  // Tally-style Store Gateway Selection Screen
  if (showGateway || !activeStore) {
    return (
      <StoreGatewayPage
        onSelectStore={(selected) => {
          setActiveStore(selected);
          setShowGateway(false);
          productsStore.ensureCatalogPopulated(selected.id).catch(() => {});
        }}
        onAddNewStore={() => setIsAddingStore(true)}
      />
    );
  }

  // The claimed counter is the workstation's identity — there is no sign-in
  // screen between opening a store and drawing the POS.
  return (
    <ModalStackProvider>
      <BrowserRouter>
      <Layout
        onOpenGateway={() => setShowGateway(true)}
        onAddNewStore={() => setIsAddingStore(true)}
      >
        <Routes>
          <Route path="/" element={<LandingRedirect />} />
          <Route path="/dashboard" element={<AccessGate menu="dashboard"><DashboardPage /></AccessGate>} />
          <Route path="/pos" element={<AccessGate menu="pos"><PosBillingPage /></AccessGate>} />
          <Route path="/bills" element={<AccessGate menu="bills"><BillsPage /></AccessGate>} />
          <Route path="/purchases" element={<AccessGate menu="purchases"><PurchasesPage /></AccessGate>} />
          <Route path="/stock" element={<AccessGate menu="stock"><StockLedgerPage /></AccessGate>} />
          <Route path="/stock/transfers" element={<AccessGate menu="stock_transfers"><InterStoreTransferPage /></AccessGate>} />
          <Route path="/reports" element={<AccessGate menu="reports"><ReportsPage /></AccessGate>} />
          <Route path="/masters" element={<AccessGate menu="masters"><MastersPage /></AccessGate>} />
          <Route path="/settings" element={<AccessGate menu="settings"><SettingsPage /></AccessGate>} />
          <Route path="/counters" element={<AccessGate menu="counters"><CounterStatusPage /></AccessGate>} />
          <Route path="/returns/sales" element={<AccessGate menu="sales_returns"><SalesReturnPage /></AccessGate>} />
          <Route path="/returns/purchases" element={<AccessGate menu="purchase_returns"><PurchaseReturnPage /></AccessGate>} />
          <Route path="/returns/debit-notes" element={<AccessGate menu="customer_debit_notes"><CustomerDebitNotePage /></AccessGate>} />
          <Route path="/expenses" element={<AccessGate menu="expenses"><ExpensesPage /></AccessGate>} />
          <Route path="/import-export" element={<AccessGate menu="import_export"><ImportExportHubPage /></AccessGate>} />
          <Route path="/migration" element={<AccessGate menu="migration"><DataMigrationPage /></AccessGate>} />
        </Routes>
      </Layout>
      {availableUpdate && (
        <UpdateNotificationModal
          updateInfo={availableUpdate}
          onClose={() => setAvailableUpdate(null)}
        />
      )}
      {showWin7Modal && win7Status && (
        <Windows7PrereqModal
          status={win7Status}
          onClose={() => setShowWin7Modal(false)}
          onRefresh={() => {
            const updated = windows7PrereqService.getCachedStatus();
            if (updated) {
              setWin7Status(updated);
              if (updated.httpsProbePassed && !updated.certStoreIssueDetected) {
                setShowWin7Modal(false);
              }
            }
          }}
        />
      )}
      </BrowserRouter>
    </ModalStackProvider>
  );
};

export default App;
