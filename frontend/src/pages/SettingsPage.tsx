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
} from "lucide-react";
import {
  companySettingsService,
  type CompanySettings,
  DEFAULT_SETTINGS,
  DEFAULT_COLUMNS,
  type ColumnSetting,
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
      const res = await companySettingsService.resetLocalData(resetScope);
      showNotification(`Reset executed: ${res.clearedTables.length} tables cleared.`);
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
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          workspace: { ...settings.workspace, theme: e.target.value as any },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
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
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          workspace: { ...settings.workspace, density: e.target.value as any },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="compact">Compact (Dense Data)</option>
                      <option value="comfortable">Comfortable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Font Size</label>
                    <select
                      value={settings.workspace.fontSize}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          workspace: { ...settings.workspace, fontSize: e.target.value as any },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="sm">Small (12px)</option>
                      <option value="base">Standard (13px)</option>
                      <option value="lg">Large (15px)</option>
                    </select>
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
                  <div className="text-xs font-bold text-slate-800">Sales Invoices</div>
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
                  <div className="text-xs font-bold text-slate-800">Sales Returns / Credit Notes</div>
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
                  <div className="text-xs font-bold text-slate-800">Purchase Inwards</div>
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
                  <div className="text-xs font-bold text-slate-800">Estimates & Quotations</div>
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

              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.printing.silentPrinting}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        printing: { ...settings.printing, silentPrinting: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Silent Direct Print (bypass system print dialog)</span>
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
                  <span>Print Dynamic UPI QR Code on Slip</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 5: POS Column Settings */}
          {activeTab === "columns" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-bold text-slate-800">POS Cart Grid Table Columns</h2>
                <p className="text-xs text-slate-500">Show or hide pricing tiers (PTR, PTS), HSN, discount, and batch details.</p>
              </div>

              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {(settings.invoice_columns || DEFAULT_COLUMNS).map((col) => (
                  <div key={col.id} className="flex items-center justify-between p-3 hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleColumnVisibility(col.id)}
                        className={`rounded p-1 ${col.visible ? "text-blue-600" : "text-slate-300"}`}
                      >
                        {col.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <input
                        type="text"
                        value={col.label}
                        onChange={(e) => updateColumnLabel(col.id, e.target.value)}
                        className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-800 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        col.visible ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {col.visible ? "Visible in POS" : "Hidden"}
                    </span>
                  </div>
                ))}
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
