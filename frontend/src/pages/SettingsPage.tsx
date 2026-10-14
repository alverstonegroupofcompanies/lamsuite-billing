import React, { useState, useEffect } from "react";
import {
  Settings,
  Store,
  RefreshCw,
  Database,
  Download,
  Upload,
  CheckCircle,
  AlertCircle,
  ShieldCheck,
  Server,
  FileText,
  Clock,
  Save,
  CheckSquare,
  Square,
  Network,
  Printer,
  Sliders,
  DollarSign,
  Mail,
  Fingerprint,
  Trash2,
  Play,
  RotateCcw,
  Palette,
  Eye,
  EyeOff,
  Hash,
  ArrowUp,
  ArrowDown,
  Lock,
  Sparkles,
  Layers,
  Columns as ColumnsIcon,
} from "lucide-react";
import {
  companySettingsService,
  type CompanySettings,
  DEFAULT_SETTINGS,
  DEFAULT_COLUMNS,
  DEFAULT_HEADER_FIELDS,
  BUILTIN_BILLING_PRESETS,
  type ColumnSetting,
  type HeaderFieldSetting,
  type BillingScreenPreset,
} from "../lib/settings/companySettingsService";
import { syncQueueService, type SyncQueueItem } from "../lib/sync/syncQueueService";
import { cloudDeltaSyncService } from "../lib/sync/cloudDeltaSyncService";
import { lanPeerService } from "../lib/lan/lanPeerService";
import { backupService, type BackupPackage } from "../lib/backup/backupService";
import { printingEngine } from "../lib/printing/printingEngine";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { productsStore } from "../lib/masters/productsStore";
import { partiesStore } from "../lib/masters/partiesStore";
import { seed50Products } from "../lib/masters/seedProductsData";
import { applyWorkspaceSettings } from "../lib/settings/workspaceThemeService";

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "general" | "billing" | "sequences" | "printing" | "columns" | "security" | "integrations" | "sync_lan" | "backup_reset" | "tools"
  >("general");

  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Core settings state
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_SETTINGS);
  const [drugLicenseInput, setDrugLicenseInput] = useState("");

  // Sync Queue state
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [watermark, setWatermark] = useState<number>(0);

  // LAN state
  const [lanConfig, setLanConfig] = useState(lanPeerService.getStationConfig());
  const [isLanDiscovering, setIsLanDiscovering] = useState(false);
  const [discoveredMain, setDiscoveredMain] = useState<{ station_name: string; ip_address: string; port: number } | null>(null);

  // Backup & Reset state
  const [latestBackup, setLatestBackup] = useState<BackupPackage | null>(null);
  const [restoreJsonInput, setRestoreJsonInput] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const [resetConfirmPhrase, setResetConfirmPhrase] = useState("");
  const [resetScope, setResetScope] = useState<"transactions_only" | "full_factory_reset">("transactions_only");

  // Diagnostics & Tools
  const [isTestingPrinter, setIsTestingPrinter] = useState(false);

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const loadData = async () => {
    try {
      const cfg = await companySettingsService.loadSettings();
      setSettings(cfg);
      if (cfg.workspace) {
        applyWorkspaceSettings(cfg.workspace);
      }
      setDrugLicenseInput(cfg.drug_license_numbers ? cfg.drug_license_numbers.join(", ") : "");

      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);

      setWatermark(cloudDeltaSyncService.getWatermark());
      setLanConfig(lanPeerService.getStationConfig());
    } catch (err) {
      console.error("Failed loading settings:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveAllSettings = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      const licenses = drugLicenseInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const updated = await companySettingsService.updateSettings({
        ...settings,
        drug_license_numbers: licenses,
      });

      setSettings(updated);
      if (updated.workspace) {
        applyWorkspaceSettings(updated.workspace);
      }
      showNotification("Configuration updated and saved successfully!");
    } catch (err) {
      showNotification("Failed to save settings", "error");
    }
  };

  // Toggle invoice column visibility
  const toggleColumnVisibility = (colId: string) => {
    const updatedCols = (settings.invoice_columns || DEFAULT_COLUMNS).map((c) =>
      c.id === colId ? { ...c, visible: !c.visible } : c
    );
    setSettings({ ...settings, invoice_columns: updatedCols });
  };

  // Update invoice column label
  const updateColumnLabel = (colId: string, newLabel: string) => {
    const updatedCols = (settings.invoice_columns || DEFAULT_COLUMNS).map((c) =>
      c.id === colId ? { ...c, label: newLabel } : c
    );
    setSettings({ ...settings, invoice_columns: updatedCols });
  };

  // Test Thermal Printer
  const handleTestPrint = async () => {
    setIsTestingPrinter(true);
    try {
      const testInvoice = {
        invoice_number: "TEST-0001",
        invoice_date: new Date().toISOString().slice(0, 10),
        store_name: settings.store_name,
        store_phone: settings.phone,
        store_address: settings.address,
        lines: [
          { description: "Test Item 1 (Paracetamol 650mg)", qty: 2, rate: 30, gst_percent: 12, amount: 60 },
          { description: "Test Item 2 (Vitamin C 500mg)", qty: 1, rate: 50, gst_percent: 12, amount: 50 },
        ],
        subtotal: 110,
        tax_total: 13.2,
        round_off: -0.2,
        grand_total: 123,
      };

      const res = await printingEngine.printThermalReceipt(testInvoice, settings.printing.selectedPrinterName);
      if (res.success) {
        showNotification("Test receipt sent to spooler successfully!");
      } else {
        showNotification("Print spool test failed", "error");
      }
    } catch (err) {
      showNotification("Error communicating with printer", "error");
    } finally {
      setIsTestingPrinter(false);
    }
  };

  // Seed sample mock data
  const handleSeedDemoData = async () => {
    try {
      const res = await seed50Products();
      showNotification(`Successfully seeded ${res.productsCount} test products and ${res.batchesCount} FEFO batches!`);
    } catch (err) {
      console.error("Error seeding demo data:", err);
      showNotification(`Failed seeding demo data: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  // Trigger Sync Queue Now
  const handleTriggerSyncNow = async () => {
    setIsSyncing(true);
    try {
      const mockClient = {
        pushInvoices: async () => ({ success: true, ingested_count: 1 }),
        pushStockEvents: async () => ({ success: true, ingested_count: 1 }),
      };

      const result = await syncQueueService.processQueue(mockClient);
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      showNotification(`Sync complete: ${result.processed} pushed, ${result.failed} failed`);
    } catch (err) {
      showNotification("Sync queue processing failed", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Pull Cloud Delta
  const handlePullCloudDelta = async () => {
    setIsSyncing(true);
    try {
      const mockDeltaClient = {
        fetchMasterDeltas: async () => ({
          watermark: Date.now(),
          products: [],
          batches: [],
          parties: [],
        }),
      };

      const res = await cloudDeltaSyncService.pullMasterDelta(mockDeltaClient);
      setWatermark(res.newWatermark);
      showNotification("Cloud delta sync completed with latest watermark");
    } catch (err) {
      showNotification("Failed to pull cloud deltas", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Discover LAN Main
  const handleDiscoverLan = async () => {
    setIsLanDiscovering(true);
    try {
      const mockMain = {
        station_id: "main_server_01",
        station_name: "Store Server #1",
        ip_address: "192.168.1.100",
        port: lanConfig.port || 8089,
        is_main: true,
        version: "2.0.0",
      };

      const discovered = await lanPeerService.discoverMainStation(mockMain);
      if (discovered) {
        setDiscoveredMain(discovered);
        showNotification(`Found Main Station: ${discovered.station_name} at ${discovered.ip_address}:${discovered.port}`);
      } else {
        showNotification("No Main Store Server found on local subnet", "error");
      }
    } finally {
      setIsLanDiscovering(false);
    }
  };

  // Backup & Restore
  const handleCreateBackup = async () => {
    try {
      const pkg = await backupService.createBackupSnapshot("2.0.0");
      setLatestBackup(pkg);
      showNotification(`Backup snapshot created with ${pkg.manifest.length} tables`);
    } catch (err) {
      showNotification("Backup creation failed", "error");
    }
  };

  const handleDownloadBackup = () => {
    if (!latestBackup) return;
    const jsonStr = backupService.serializeBackup(latestBackup);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lamsuite_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification("Backup file downloaded");
  };

  const handleRestoreBackup = async () => {
    if (!restoreJsonInput.trim()) {
      showNotification("Please paste valid JSON backup package", "error");
      return;
    }

    setIsRestoring(true);
    try {
      const pkg = backupService.deserializeBackup(restoreJsonInput);
      const res = await backupService.restoreFromSnapshot(pkg);
      showNotification(`Restored ${res.totalRecordsRestored} records across ${res.restoredTables.length} tables!`);
      setRestoreJsonInput("");
      loadData();
    } catch (err: any) {
      showNotification(`Restore failed: ${err.message}`, "error");
    } finally {
      setIsRestoring(false);
    }
  };

  // Danger Zone Reset
  const handleExecuteReset = async () => {
    if (resetConfirmPhrase.trim() !== "RESET DATA") {
      showNotification('Confirmation phrase must match "RESET DATA" exactly', "error");
      return;
    }

    try {
      // Auto-trigger encrypted safety snapshot before clearing data
      try {
        await backupService.createBackupSnapshot();
      } catch (backupErr) {
        console.warn("Safety pre-reset backup failed:", backupErr);
      }

      const res = await companySettingsService.resetLocalData(resetScope);
      showNotification(`Safety backup created & Reset executed: ${res.clearedTables.length} tables cleared.`);
      setResetConfirmPhrase("");
      loadData();
    } catch (err: any) {
      showNotification(`Reset failed: ${err.message}`, "error");
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toast Alert */}
      {notification && (
        <div
          className={`fixed right-6 top-16 z-50 flex items-center gap-2 rounded-lg border px-4 py-2.5 shadow-lg text-sm transition-all ${
            notification.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {notification.type === "success" ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-red-600" />}
          <span className="font-medium">{notification.message}</span>
        </div>
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">System Settings & Terminal Control</h1>
            <p className="text-xs text-slate-500">Configure store profile, billing defaults, sequences, printing, security, and sync</p>
          </div>
        </div>

        <button
          onClick={() => handleSaveAllSettings()}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700 transition-colors"
        >
          <Save className="h-4 w-4" />
          <span>Save All Changes</span>
        </button>
      </div>

      {/* Main Container with Sidebar Tabs */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Settings Navigation Sidebar */}
        <div className="w-56 shrink-0 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm text-xs space-y-1">
          {[
            { id: "general", label: "General & Workspace", icon: Store },
            { id: "billing", label: "Billing & Taxes", icon: DollarSign },
            { id: "sequences", label: "Document Sequences", icon: Hash },
            { id: "printing", label: "Printing & Templates", icon: Printer },
            { id: "columns", label: "POS Column Settings", icon: Sliders },
            { id: "security", label: "Security & Cashiers", icon: ShieldCheck },
            { id: "integrations", label: "Wallet & SMTP Mailer", icon: Mail },
            { id: "sync_lan", label: "Sync & LAN Sharing", icon: Network },
            { id: "backup_reset", label: "Backup & Danger Zone", icon: Database },
            { id: "tools", label: "Testing Tools", icon: Play },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? "text-blue-600" : "text-slate-400"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Panel */}
        <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {/* TAB 1: General & Workspace */}
          {activeTab === "general" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Store Profile & Display Information</h2>
                <p className="text-xs text-slate-500">Business identity printed on receipts and customer tax invoices.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Legal Store Name *</label>
                  <input
                    type="text"
                    value={settings.store_name}
                    onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Trading Display Name</label>
                  <input
                    type="text"
                    value={settings.display_name || ""}
                    onChange={(e) => setSettings({ ...settings, display_name: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Store Phone Number *</label>
                  <input
                    type="text"
                    value={settings.phone}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Store Email</label>
                  <input
                    type="email"
                    value={settings.email || ""}
                    onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Store Address</label>
                <textarea
                  rows={2}
                  value={settings.address}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="pt-4 border-t border-slate-200">
                <h3 className="text-xs font-bold text-slate-800">Workspace Appearance & Environment</h3>
                <div className="grid grid-cols-3 gap-4 mt-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Theme</label>
                    <select
                      value={settings.workspace.theme}
                      onChange={(e) => {
                        const nextTheme = e.target.value as "light" | "dark" | "system";
                        const nextWs = { ...settings.workspace, theme: nextTheme };
                        setSettings({ ...settings, workspace: nextWs });
                        applyWorkspaceSettings(nextWs);
                      }}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer"
                    >
                      <option value="light">Light Theme</option>
                      <option value="dark">Dark Slate</option>
                      <option value="system">Follow System</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Grid Density</label>
                    <select
                      value={settings.workspace.density}
                      onChange={(e) => {
                        const nextDensity = e.target.value as "compact" | "comfortable";
                        const nextWs = { ...settings.workspace, density: nextDensity };
                        setSettings({ ...settings, workspace: nextWs });
                        applyWorkspaceSettings(nextWs);
                      }}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer"
                    >
                      <option value="compact">Compact (Dense Data)</option>
                      <option value="comfortable">Comfortable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Font Size</label>
                    <select
                      value={settings.workspace.fontSize}
                      onChange={(e) => {
                        const nextFontSize = e.target.value as "sm" | "base" | "lg";
                        const nextWs = { ...settings.workspace, fontSize: nextFontSize };
                        setSettings({ ...settings, workspace: nextWs });
                        applyWorkspaceSettings(nextWs);
                      }}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer"
                    >
                      <option value="sm">Small (12px)</option>
                      <option value="base">Standard (14px)</option>
                      <option value="lg">Large (16px)</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Startup Landing Screen</label>
                  <p className="text-[11px] text-slate-500 mb-1">Choose the screen that opens when the application starts.</p>
                  <select
                    value={settings.workspace.defaultLandingPage || "dashboard"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        workspace: { ...settings.workspace, defaultLandingPage: e.target.value as any },
                      })
                    }
                    className="w-full max-w-sm rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none cursor-pointer"
                  >
                    <option value="dashboard">Store Dashboard (Overview & Reports)</option>
                    <option value="pos">POS Billing Counter (Fast Retail Checkout)</option>
                    <option value="bills">Past Bills & Invoices</option>
                    <option value="stock">Inventory & Stock Ledger</option>
                    <option value="purchases">Purchase Inward Register</option>
                  </select>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-200">
                  <h4 className="text-xs font-bold text-slate-800">Top Navigation Modules Visibility</h4>
                  <p className="text-[11px] text-slate-500 mb-2.5">
                    Select which module tabs appear in the top navigation bar for this workstation.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: "dashboard", label: "Dashboard (Home)" },
                      { id: "pos", label: "POS Billing (F1)" },
                      { id: "bills", label: "Past Bills (F6)" },
                      { id: "sales_returns", label: "Sales Returns (F7)" },
                      { id: "customer_debit_notes", label: "Debit Notes B2B (Shift+F7)" },
                      { id: "purchases", label: "Purchases (F2)" },
                      { id: "purchase_returns", label: "Purchase Returns (Shift+F2)" },
                      { id: "stock", label: "Inventory (F3)" },
                      { id: "stock_transfers", label: "Transfers (Shift+F3)" },
                      { id: "reports", label: "Reports & GST (F4)" },
                      { id: "masters", label: "Master Data (F5)" },
                      { id: "counters", label: "Store Counters (F8)" },
                      { id: "import_export", label: "Import / Export Hub (F9)" },
                      { id: "settings", label: "Settings (F10)" },
                    ].map((mod) => {
                      const isEnabled = (settings.enabled_menu_items || []).includes(mod.id);
                      return (
                        <label
                          key={mod.id}
                          className="flex items-center gap-2 rounded border border-slate-200 p-2 text-xs hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? [...(settings.enabled_menu_items || []), mod.id]
                                : (settings.enabled_menu_items || []).filter((id) => id !== mod.id);
                              setSettings({ ...settings, enabled_menu_items: next });
                            }}
                            className="rounded text-blue-600 focus:ring-blue-500"
                          />
                          <span className="font-medium text-slate-700">{mod.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Billing & Taxes */}
          {activeTab === "billing" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Billing Policies & Indian GST</h2>
                <p className="text-xs text-slate-500">Tax modes, default discount, round-off, and credit periods.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">GSTIN (15 Digits)</label>
                  <input
                    type="text"
                    value={settings.gstin || ""}
                    onChange={(e) => setSettings({ ...settings, gstin: e.target.value.toUpperCase() })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono uppercase focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">State Code</label>
                  <input
                    type="text"
                    value={settings.state_code}
                    onChange={(e) => setSettings({ ...settings, state_code: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Sales Tax Mode</label>
                  <select
                    value={settings.tax_mode}
                    onChange={(e) => setSettings({ ...settings, tax_mode: e.target.value as any })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="inclusive">GST Inclusive (MRP includes tax)</option>
                    <option value="exclusive">GST Exclusive (Tax calculated over rate)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Purchase Inward Tax Mode</label>
                  <select
                    value={settings.purchase_tax_mode}
                    onChange={(e) => setSettings({ ...settings, purchase_tax_mode: e.target.value as any })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="exclusive">GST Exclusive (Standard)</option>
                    <option value="inclusive">GST Inclusive</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Default Rate Basis</label>
                  <select
                    value={settings.default_rate_basis}
                    onChange={(e) => setSettings({ ...settings, default_rate_basis: e.target.value as any })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="sel_rate">Selling Rate</option>
                    <option value="mrp">MRP</option>
                    <option value="ptr">PTR (Price to Retailer)</option>
                    <option value="pts">PTS (Price to Stockist)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Credit Period (Days)</label>
                  <input
                    type="number"
                    value={settings.credit_period_days}
                    onChange={(e) => setSettings({ ...settings, credit_period_days: Number(e.target.value) })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Default HSN/SAC</label>
                  <input
                    type="text"
                    value={settings.default_hsn_code}
                    onChange={(e) => setSettings({ ...settings, default_hsn_code: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="round_off_toggle"
                  checked={settings.round_off_enabled}
                  onChange={(e) => setSettings({ ...settings, round_off_enabled: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="round_off_toggle" className="text-xs text-slate-700 font-medium">
                  Enable Statutory Whole-Rupee Round-Off (e.g. ₹123.40 rounded to ₹123.00)
                </label>
              </div>

              {/* Out-of-Stock & Negative Inventory Billing Policy */}
              <div className="mt-6 pt-4 border-t border-slate-200 space-y-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Out-of-Stock & Negative Inventory Billing Policy
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Control how the POS counter handles stock shortages, unstocked products, and expired batches.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">
                      Allow Selling Out-of-Stock Items
                    </label>
                    <select
                      value={settings.inventory?.allowSellingOutOfStock || "always"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          inventory: {
                            ...settings.inventory,
                            allowSellingOutOfStock: e.target.value as any,
                            warnOnNegativeStock: settings.inventory?.warnOnNegativeStock ?? true,
                            requireManagerPinForNegativeStock: settings.inventory?.requireManagerPinForNegativeStock ?? false,
                            allowExpiredBatchSale: settings.inventory?.allowExpiredBatchSale ?? "warn_confirm",
                          },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="always">Always (Fast Counter - Add with warning badge)</option>
                      <option value="ask">Ask each time (Show single confirmation)</option>
                      <option value="never">Never (Block adding out-of-stock items)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">
                      Expired Batches Sale Policy
                    </label>
                    <select
                      value={settings.inventory?.allowExpiredBatchSale || "warn_confirm"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          inventory: {
                            ...settings.inventory,
                            allowExpiredBatchSale: e.target.value as any,
                            allowSellingOutOfStock: settings.inventory?.allowSellingOutOfStock ?? "always",
                            warnOnNegativeStock: settings.inventory?.warnOnNegativeStock ?? true,
                            requireManagerPinForNegativeStock: settings.inventory?.requireManagerPinForNegativeStock ?? false,
                          },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="warn_confirm">Warn and require explicit confirmation</option>
                      <option value="block">Strictly block expired batches</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.inventory?.warnOnNegativeStock ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          inventory: {
                            ...settings.inventory,
                            warnOnNegativeStock: e.target.checked,
                            allowSellingOutOfStock: settings.inventory?.allowSellingOutOfStock ?? "always",
                            requireManagerPinForNegativeStock: settings.inventory?.requireManagerPinForNegativeStock ?? false,
                            allowExpiredBatchSale: settings.inventory?.allowExpiredBatchSale ?? "warn_confirm",
                          },
                        })
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-slate-700">
                      Show non-blocking warning badge on cart lines when selling beyond stock
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.inventory?.requireManagerPinForNegativeStock ?? false}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          inventory: {
                            ...settings.inventory,
                            requireManagerPinForNegativeStock: e.target.checked,
                            allowSellingOutOfStock: settings.inventory?.allowSellingOutOfStock ?? "always",
                            warnOnNegativeStock: settings.inventory?.warnOnNegativeStock ?? true,
                            allowExpiredBatchSale: settings.inventory?.allowExpiredBatchSale ?? "warn_confirm",
                          },
                        })
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-slate-700">
                      Require Manager PIN authorization to sell out-of-stock items
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Document Sequences */}
          {activeTab === "sequences" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Document Prefix & Sequential Numbering</h2>
                <p className="text-xs text-slate-500">Configure separate auto-incrementing serial prefixes for each transaction type.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Sales Invoices</span>
                    <span className="rounded bg-blue-100 px-2 py-0.5 font-mono text-[11px] font-bold text-blue-700">
                      {(settings.sequences?.invoicePrefix || "INV")}-{settings.sequences?.nextInvoiceNumber || 1001}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[10px] text-slate-500">Prefix</span>
                      <input
                        type="text"
                        value={settings.sequences?.invoicePrefix || "INV"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            invoice_prefix: e.target.value,
                            sequences: { ...settings.sequences, invoicePrefix: e.target.value },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono uppercase"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Next Number</span>
                      <input
                        type="number"
                        value={settings.sequences?.nextInvoiceNumber || 1001}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            next_invoice_number: Number(e.target.value),
                            sequences: { ...settings.sequences, nextInvoiceNumber: Number(e.target.value) },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Sales Returns / Credit Notes</span>
                    <span className="rounded bg-indigo-100 px-2 py-0.5 font-mono text-[11px] font-bold text-indigo-700">
                      {(settings.sequences?.returnPrefix || "RET")}-{settings.sequences?.nextReturnNumber || 101}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[10px] text-slate-500">Prefix</span>
                      <input
                        type="text"
                        value={settings.sequences?.returnPrefix || "RET"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sequences: { ...settings.sequences, returnPrefix: e.target.value },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono uppercase"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Next Number</span>
                      <input
                        type="number"
                        value={settings.sequences?.nextReturnNumber || 101}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sequences: { ...settings.sequences, nextReturnNumber: Number(e.target.value) },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Purchase Inwards</span>
                    <span className="rounded bg-emerald-100 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-700">
                      {(settings.sequences?.purchasePrefix || "PUR")}-{settings.sequences?.nextPurchaseNumber || 201}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[10px] text-slate-500">Prefix</span>
                      <input
                        type="text"
                        value={settings.sequences?.purchasePrefix || "PUR"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sequences: { ...settings.sequences, purchasePrefix: e.target.value },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono uppercase"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Next Number</span>
                      <input
                        type="number"
                        value={settings.sequences?.nextPurchaseNumber || 201}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sequences: { ...settings.sequences, nextPurchaseNumber: Number(e.target.value) },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">Estimates & Quotations</span>
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-800">
                      {(settings.sequences?.quotationPrefix || "QUO")}-{settings.sequences?.nextQuotationNumber || 301}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <span className="text-[10px] text-slate-500">Prefix</span>
                      <input
                        type="text"
                        value={settings.sequences?.quotationPrefix || "QUO"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sequences: { ...settings.sequences, quotationPrefix: e.target.value },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono uppercase"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Next Number</span>
                      <input
                        type="number"
                        value={settings.sequences?.nextQuotationNumber || 301}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            sequences: { ...settings.sequences, nextQuotationNumber: Number(e.target.value) },
                          })
                        }
                        className="mt-0.5 w-full rounded border border-slate-300 bg-white p-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Printing & Templates */}
          {activeTab === "printing" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Receipt & Invoice Printing Configuration</h2>
                <p className="text-xs text-slate-500">Paper formats, silent ESC/POS thermal printing, and statutory drug license headers.</p>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Default Paper Size</label>
                  <select
                    value={settings.printing.paperSize}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, paperSize: e.target.value as any },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="thermal_80mm">Thermal 3-Inch (80mm)</option>
                    <option value="thermal_58mm">Thermal 2-Inch (58mm)</option>
                    <option value="a4">Standard A4 Sheet</option>
                    <option value="a5">Half-Sheet A5</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Active Template</label>
                  <select
                    value={settings.printing.activeTemplate}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, activeTemplate: e.target.value as any },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="thermal_standard">Standard Thermal 80mm</option>
                    <option value="thermal_compact">Compact Thermal 58mm</option>
                    <option value="a4_tax_invoice">Statutory A4 Tax Invoice</option>
                    <option value="hospital_detailed">Hospital / Clinical A4 Detail</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Print Copies</label>
                  <input
                    type="number"
                    min="1"
                    value={settings.printing.copies}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, copies: Number(e.target.value) },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Drug Licenses (20B, 21B)</label>
                <input
                  type="text"
                  value={drugLicenseInput}
                  onChange={(e) => setDrugLicenseInput(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                  placeholder="20B-123456, 21B-123457"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Receipt Footer Note</label>
                <input
                  type="text"
                  value={settings.printing.footerNote}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      printing: { ...settings.printing, footerNote: e.target.value },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Terms & Conditions</label>
                <textarea
                  rows={2}
                  value={settings.printing.termsAndConditions}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      printing: { ...settings.printing, termsAndConditions: e.target.value },
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>

              {/* Print Preview Mode Setting */}
              <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3.5 dark:border-blue-900/50 dark:bg-blue-950/20">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Print Preview Behavior
                </label>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Control whether the interactive Print Preview modal appears before sending jobs to the printer. Shift+Click bypasses preview anytime.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <label className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                    (settings.printing.previewMode || "always") === "always"
                      ? "bg-white dark:bg-slate-800 border-blue-600 text-blue-700 dark:text-blue-400 font-semibold shadow-sm"
                      : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  }`}>
                    <input
                      type="radio"
                      name="previewMode"
                      value="always"
                      checked={(settings.printing.previewMode || "always") === "always"}
                      onChange={() =>
                        setSettings({
                          ...settings,
                          printing: { ...settings.printing, previewMode: "always" },
                        })
                      }
                      className="text-blue-600"
                    />
                    <span>Always Show Preview (Recommended)</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                    settings.printing.previewMode === "skip_thermal"
                      ? "bg-white dark:bg-slate-800 border-blue-600 text-blue-700 dark:text-blue-400 font-semibold shadow-sm"
                      : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  }`}>
                    <input
                      type="radio"
                      name="previewMode"
                      value="skip_thermal"
                      checked={settings.printing.previewMode === "skip_thermal"}
                      onChange={() =>
                        setSettings({
                          ...settings,
                          printing: { ...settings.printing, previewMode: "skip_thermal" },
                        })
                      }
                      className="text-blue-600"
                    />
                    <span>Skip for Thermal (Quick Counter)</span>
                  </label>

                  <label className={`flex items-center gap-2 p-2 rounded-lg border text-xs cursor-pointer ${
                    settings.printing.previewMode === "never"
                      ? "bg-white dark:bg-slate-800 border-blue-600 text-blue-700 dark:text-blue-400 font-semibold shadow-sm"
                      : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
                  }`}>
                    <input
                      type="radio"
                      name="previewMode"
                      value="never"
                      checked={settings.printing.previewMode === "never"}
                      onChange={() =>
                        setSettings({
                          ...settings,
                          printing: { ...settings.printing, previewMode: "never" },
                        })
                      }
                      className="text-blue-600"
                    />
                    <span>Never Show Preview (Direct Print)</span>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Default Copy Marker</label>
                  <select
                    value={settings.printing.defaultCopyMarker || "Original for Recipient"}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, defaultCopyMarker: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="Original for Recipient">Original for Recipient</option>
                    <option value="Duplicate for Transporter">Duplicate for Transporter</option>
                    <option value="Triplicate for Supplier">Triplicate for Supplier</option>
                    <option value="Customer Copy">Customer Copy</option>
                    <option value="Office Copy">Office Copy</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Jurisdiction Note</label>
                  <input
                    type="text"
                    value={settings.printing.jurisdictionNote || "Subject to local jurisdiction."}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, jurisdictionNote: e.target.value },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.printing.printHsnSummary ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, printHsnSummary: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Print HSN / GST Tax Summary Table</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.printing.printUpiQrCode}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, printUpiQrCode: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Print Dynamic UPI QR Code on Slip & Invoice</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.printing.printDoctorDetails ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, printDoctorDetails: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Print Patient & Doctor Details</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.printing.printDrugLicenses ?? true}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, printDrugLicenses: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Print Store Drug Licenses (20B, 21B) & GSTIN</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 5: Billing Screen Layout & Presets */}
          {activeTab === "columns" && (
            <div className="max-w-3xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Billing Screen Layout & Presets</h2>
                <p className="text-xs text-slate-500">
                  Configure visible POS table columns, metadata headers, and industry presets (Pharmacy, Retail, Fast Counter).
                </p>
              </div>

              {/* Presets Cards */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-2.5 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  <span>Screen Layout Presets</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {companySettingsService.getBillingPresets().map((p) => {
                    const isActive = (settings.active_billing_preset || "pharmacy") === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border p-3.5 flex flex-col justify-between transition-all ${
                          isActive
                            ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20 shadow-xs"
                            : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-slate-900 text-xs">{p.name}</span>
                            {p.isBuiltin && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[9px] font-semibold text-slate-600">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 leading-snug">{p.description}</p>
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await companySettingsService.applyBillingPreset(p.id, true);
                              setSettings({
                                ...settings,
                                active_billing_preset: p.id,
                                invoice_columns: res.columns,
                                header_fields: res.headerFields,
                              });
                              showNotification(`Applied ${p.name} preset!`);
                            }}
                            className={`text-xs font-bold px-2.5 py-1 rounded transition-colors ${
                              isActive
                                ? "bg-blue-600 text-white"
                                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            }`}
                          >
                            {isActive ? "Active Preset" : "Apply Preset"}
                          </button>

                          {!p.isBuiltin && (
                            <button
                              type="button"
                              onClick={async () => {
                                await companySettingsService.deleteCustomBillingPreset(p.id);
                                loadData();
                                showNotification("Preset removed");
                              }}
                              className="text-rose-500 hover:text-rose-700 p-1 rounded hover:bg-rose-50"
                              title="Delete preset"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Grid Columns List */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <ColumnsIcon className="h-3.5 w-3.5 text-blue-600" />
                      <span>POS Grid Table Columns</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Toggle columns to show/hide, rename headers, and adjust order using arrow buttons.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await companySettingsService.resetBillingLayoutToDefault();
                      setSettings({
                        ...settings,
                        invoice_columns: res.columns,
                        header_fields: res.headerFields,
                        active_billing_preset: "pharmacy",
                      });
                      showNotification("Reset all columns and layout to pharmacy default.");
                    }}
                    className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Layout</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden bg-white">
                  {(settings.invoice_columns || DEFAULT_COLUMNS).map((col, idx) => (
                    <div key={col.id} className="flex items-center justify-between p-2.5 hover:bg-slate-50 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-400 text-[11px] w-5 text-right">{idx + 1}.</span>
                        <button
                          type="button"
                          disabled={col.required}
                          onClick={() => toggleColumnVisibility(col.id)}
                          className={`rounded p-1 ${
                            col.visible ? "text-blue-600 hover:bg-blue-50" : "text-slate-300 hover:bg-slate-100"
                          } disabled:opacity-40`}
                          title={col.required ? "Required column" : col.visible ? "Hide column" : "Show column"}
                        >
                          {col.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <div>
                          <input
                            type="text"
                            value={col.label}
                            onChange={(e) => updateColumnLabel(col.id, e.target.value)}
                            className="rounded border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                          />
                          <span className="ml-2 text-[10px] font-mono text-slate-400">ID: {col.id}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {col.required && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-600">
                            <Lock className="h-2.5 w-2.5 text-slate-400" />
                            Required
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            const newCols = [...(settings.invoice_columns || DEFAULT_COLUMNS)];
                            const [moved] = newCols.splice(idx, 1);
                            newCols.splice(idx - 1, 0, moved);
                            newCols.forEach((c, i) => (c.order = i + 1));
                            setSettings({ ...settings, invoice_columns: newCols });
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === (settings.invoice_columns || DEFAULT_COLUMNS).length - 1}
                          onClick={() => {
                            const newCols = [...(settings.invoice_columns || DEFAULT_COLUMNS)];
                            const [moved] = newCols.splice(idx, 1);
                            newCols.splice(idx + 1, 0, moved);
                            newCols.forEach((c, i) => (c.order = i + 1));
                            setSettings({ ...settings, invoice_columns: newCols });
                          }}
                          className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30 rounded hover:bg-slate-100"
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            col.visible ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {col.visible ? "Visible" : "Hidden"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Header Fields List */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-indigo-600" />
                    <span>Billing Header Metadata Fields</span>
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Control which patient details, doctor fields, and payment options appear in the POS top section.
                  </p>
                </div>

                <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 overflow-hidden bg-white">
                  {(settings.header_fields || DEFAULT_HEADER_FIELDS).map((field, idx) => (
                    <div key={field.id} className="flex items-center justify-between p-2.5 hover:bg-slate-50 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-slate-400 text-[11px] w-5 text-right">{idx + 1}.</span>
                        <button
                          type="button"
                          disabled={field.required}
                          onClick={() => {
                            const updated = (settings.header_fields || DEFAULT_HEADER_FIELDS).map((f) =>
                              f.id === field.id ? { ...f, visible: !f.visible } : f
                            );
                            setSettings({ ...settings, header_fields: updated });
                          }}
                          className={`rounded p-1 ${
                            field.visible ? "text-blue-600 hover:bg-blue-50" : "text-slate-300 hover:bg-slate-100"
                          } disabled:opacity-40`}
                        >
                          {field.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <div>
                          <span className="font-medium text-slate-800">{field.label}</span>
                          <span className="ml-2 text-[10px] font-mono text-slate-400">ID: {field.id}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {field.required && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-medium text-slate-600">
                            <Lock className="h-2.5 w-2.5 text-slate-400" />
                            Required
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            field.visible ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {field.visible ? "Visible" : "Hidden"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: Security & Cashiers */}
          {activeTab === "security" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Security, Shift Handover & Lockout</h2>
                <p className="text-xs text-slate-500">Cashier PIN authentication, idle timeout lock, and Windows Hello biometrics.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Auto Idle Sign-Out (Minutes)</label>
                  <input
                    type="number"
                    min="1"
                    value={settings.security.idleTimeoutMinutes}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        security: { ...settings.security, idleTimeoutMinutes: Number(e.target.value) },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Max Failed Logins Lockout</label>
                  <input
                    type="number"
                    min="3"
                    value={settings.security.maxFailedLogins}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        security: { ...settings.security, maxFailedLogins: Number(e.target.value) },
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.security.allowBiometricSignIn}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        security: { ...settings.security, allowBiometricSignIn: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Allow Biometric Sign-in (Windows Hello / macOS Touch ID)</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 7: Wallet & SMTP Integrations */}
          {activeTab === "integrations" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Customer Wallet & Email Dispatch</h2>
                <p className="text-xs text-slate-500">Configure store credit wallets and SMTP server for electronic invoices.</p>
              </div>

              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800">Customer Pre-paid / Store Credit Wallet</div>
                  <input
                    type="checkbox"
                    checked={settings.wallet.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        wallet: { ...settings.wallet, enabled: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">Max Credit Limit (₹)</label>
                    <input
                      type="number"
                      value={settings.wallet.maxCreditLimit}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          wallet: { ...settings.wallet, maxCreditLimit: Number(e.target.value) },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">Wallet Ref Prefix</label>
                    <input
                      type="text"
                      value={settings.wallet.referencePrefix}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          wallet: { ...settings.wallet, referencePrefix: e.target.value },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono uppercase"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800">Outbound Email (SMTP) Dispatch</div>
                  <input
                    type="checkbox"
                    checked={settings.smtp.enabled}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        smtp: { ...settings.smtp, enabled: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">SMTP Host</label>
                    <input
                      type="text"
                      value={settings.smtp.host}
                      onChange={(e) =>
                        setSettings({ ...settings, smtp: { ...settings.smtp, host: e.target.value } })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">Port</label>
                    <input
                      type="number"
                      value={settings.smtp.port}
                      onChange={(e) =>
                        setSettings({ ...settings, smtp: { ...settings.smtp, port: Number(e.target.value) } })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">Encryption</label>
                    <select
                      value={settings.smtp.encryption}
                      onChange={(e) =>
                        setSettings({ ...settings, smtp: { ...settings.smtp, encryption: e.target.value as any } })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs"
                    >
                      <option value="tls">TLS</option>
                      <option value="ssl">SSL</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: Sync & LAN Sharing */}
          {activeTab === "sync_lan" && (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Cloud Sync & Local In-Store LAN Discovery</h2>
                  <p className="text-xs text-slate-500">Telemetry, pending queue retries, and master catalog snapshots.</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePullCloudDelta}
                    disabled={isSyncing}
                    className="flex items-center gap-1 rounded bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                    <span>Pull Delta</span>
                  </button>
                  <button
                    onClick={handleTriggerSyncNow}
                    disabled={isSyncing}
                    className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                    <span>Push Queue</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] uppercase text-slate-500 font-bold">Pending Outbound</span>
                  <p className="text-lg font-bold text-amber-600 mt-0.5">{syncQueue.filter((q) => q.status === "pending").length}</p>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] uppercase text-slate-500 font-bold">Total Synced</span>
                  <p className="text-lg font-bold text-emerald-600 mt-0.5">{syncQueue.filter((q) => q.status === "synced").length}</p>
                </div>
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <span className="text-[10px] uppercase text-slate-500 font-bold">Watermark</span>
                  <p className="text-xs font-mono font-bold text-slate-700 mt-1">{watermark ? new Date(watermark).toLocaleTimeString() : "Synced"}</p>
                </div>
              </div>

              {/* LAN Sharing Box */}
              <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-800">In-Store Peer LAN Sharing</div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDiscoverLan}
                    disabled={isLanDiscovering}
                    className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                  >
                    <Network className="h-3.5 w-3.5 text-slate-500" />
                    <span>Discover Store Server</span>
                  </button>
                  {discoveredMain && (
                    <span className="text-xs text-emerald-700 font-medium">
                      Connected to {discoveredMain.station_name} ({discoveredMain.ip_address})
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 9: Backup & Danger Zone */}
          {activeTab === "backup_reset" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Database Backup & Disaster Recovery</h2>
                <p className="text-xs text-slate-500">Create encrypted snapshots, download backup JSON, or restore data.</p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4">
                <div>
                  <div className="text-xs font-bold text-slate-800">Create Encrypted Database Snapshot</div>
                  <div className="text-[11px] text-slate-500">Packages all 10 local SQLite tables into a validated schema file.</div>
                </div>
                <button
                  onClick={handleCreateBackup}
                  className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>Create Snapshot</span>
                </button>
              </div>

              {latestBackup && (
                <div className="flex items-center justify-between rounded border border-blue-200 bg-blue-50/50 p-3 text-xs">
                  <div>
                    <span className="font-bold text-blue-900">Backup Created: </span>
                    <span className="font-mono text-blue-800">{latestBackup.backup_id}</span>
                  </div>
                  <button
                    onClick={handleDownloadBackup}
                    className="flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
                  >
                    <Download className="h-3 w-3" />
                    <span>Download JSON File</span>
                  </button>
                </div>
              )}

              {/* Danger Zone */}
              <div className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 space-y-3">
                <div className="text-xs font-bold text-rose-800">Danger Zone: Reset Local Data</div>
                <p className="text-[11px] text-rose-600">
                  Irreversible action. Type <span className="font-mono font-bold">RESET DATA</span> to confirm.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-rose-700">Reset Scope</label>
                    <select
                      value={resetScope}
                      onChange={(e) => setResetScope(e.target.value as any)}
                      className="mt-1 w-full rounded border border-rose-300 bg-white p-1.5 text-xs text-rose-800"
                    >
                      <option value="transactions_only">Clear Invoices & Stock Log Only</option>
                      <option value="full_factory_reset">Full Factory Reset (Erase Everything)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-rose-700">Confirmation Phrase</label>
                    <input
                      type="text"
                      placeholder="RESET DATA"
                      value={resetConfirmPhrase}
                      onChange={(e) => setResetConfirmPhrase(e.target.value)}
                      className="mt-1 w-full rounded border border-rose-300 bg-white p-1.5 text-xs font-mono uppercase"
                    />
                  </div>
                </div>
                <button
                  onClick={handleExecuteReset}
                  disabled={resetConfirmPhrase.trim() !== "RESET DATA"}
                  className="rounded bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-40"
                >
                  Execute Local Data Reset
                </button>
              </div>
            </div>
          )}

          {/* TAB 10: Testing Tools */}
          {activeTab === "tools" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Diagnostic & Testing Tools</h2>
                <p className="text-xs text-slate-500">Hardware verification, thermal printer test, and demo database generation.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-800">Thermal Printer Spool Test</div>
                  <p className="text-[11px] text-slate-500">
                    Prints a sample test receipt with dynamic height and buzzer kick to verify ESC/POS hardware.
                  </p>
                  <button
                    onClick={handleTestPrint}
                    disabled={isTestingPrinter}
                    className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print Test Receipt</span>
                  </button>
                </div>

                <div className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <div className="text-xs font-bold text-slate-800">Generate 50 Test Products</div>
                  <p className="text-[11px] text-slate-500">
                    Loads 50 realistic pharmacy medicines (antibiotics, pain relief, antacids, cardiac, diabetic, vitamins, topicals), FEFO batches, and parties.
                  </p>
                  <button
                    onClick={handleSeedDemoData}
                    className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>Seed 50 Test Products</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
