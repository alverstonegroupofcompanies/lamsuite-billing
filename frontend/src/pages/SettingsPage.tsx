import React, { useState, useEffect } from "react";
import {
  Settings,
  Store,
  RefreshCw,
  Wifi,
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
} from "lucide-react";
import {
  companySettingsService,
  type CompanySettings,
  DEFAULT_SETTINGS,
} from "../lib/settings/companySettingsService";
import { syncQueueService, type SyncQueueItem } from "../lib/sync/syncQueueService";
import { cloudDeltaSyncService } from "../lib/sync/cloudDeltaSyncService";
import { lanPeerService } from "../lib/lan/lanPeerService";
import { backupService, type BackupPackage } from "../lib/backup/backupService";
import { sqliteStorage } from "../lib/db/sqliteStorage";

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"store" | "sync" | "lan" | "backup" | "menus">("store");
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Store settings state
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

  // Backup state
  const [latestBackup, setLatestBackup] = useState<BackupPackage | null>(null);
  const [restoreJsonInput, setRestoreJsonInput] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);

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
      console.error("Failed loading settings data:", err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Save Store Settings
  const handleSaveStoreSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const licenses = drugLicenseInput
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const updated = await companySettingsService.updateSettings({
        ...settings,
        drug_license_numbers: licenses,
        next_invoice_number: Number(settings.next_invoice_number) || 1,
      });

      setSettings(updated);
      showNotification("Company & tax settings updated successfully");
    } catch (err) {
      showNotification("Failed to update settings", "error");
    }
  };

  // Trigger Sync Queue Now
  const handleTriggerSyncNow = async () => {
    setIsSyncing(true);
    try {
      // Mock / local sync API client
      const mockClient = {
        pushInvoices: async () => ({ success: true, ingested_count: 1 }),
        pushStockEvents: async () => ({ success: true, ingested_count: 1 }),
      };

      const result = await syncQueueService.processQueue(mockClient);
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);

      showNotification(`Sync finished: ${result.processed} items pushed, ${result.failed} failed`);
    } catch (err) {
      showNotification("Sync process failed", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Pull Cloud Delta
  const handlePullCloudDelta = async () => {
    setIsSyncing(true);
    try {
      const mockDeltaClient = {
        fetchMasterDeltas: async (since: number) => ({
          watermark: Date.now(),
          products: [],
          batches: [],
          parties: [],
        }),
      };

      const res = await cloudDeltaSyncService.pullMasterDelta(mockDeltaClient);
      setWatermark(res.newWatermark);
      showNotification("Cloud delta sync completed with latest server watermark");
    } catch (err) {
      showNotification("Failed to pull cloud deltas", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Save LAN Config
  const handleSaveLanConfig = (e: React.FormEvent) => {
    e.preventDefault();
    lanPeerService.configureStation(
      lanConfig.role as any,
      lanConfig.stationName,
      Number(lanConfig.port) || 8089
    );
    setLanConfig(lanPeerService.getStationConfig());
    showNotification("LAN Station configuration applied");
  };

  // Discover LAN Main
  const handleDiscoverLan = async () => {
    setIsLanDiscovering(true);
    try {
      const mockMain = {
        station_id: "main_server_01",
        station_name: "Store Server #1",
        ip_address: "192.168.1.100",
        port: 8089,
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

  // Pull Snapshot from LAN Main
  const handlePullLanSnapshot = async () => {
    if (!discoveredMain) return;
    try {
      // Mock fetcher for LAN snapshot
      const mockFetcher = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          snapshot_id: `snap_${Date.now()}`,
          source_station_id: discoveredMain.station_name,
          timestamp: Date.now(),
          products: [],
          batches: [],
          parties: [],
        }),
      });

      const res = await lanPeerService.pullMasterSnapshotFromMain(
        discoveredMain.ip_address,
        discoveredMain.port,
        mockFetcher as any
      );

      showNotification(`LAN sync successful: ${res.appliedCount} catalog records updated`);
    } catch (err) {
      showNotification("Failed to pull snapshot from LAN main server", "error");
    }
  };

  // Create Backup
  const handleCreateBackup = async () => {
    try {
      const pkg = await backupService.createBackupSnapshot("2.0.0");
      setLatestBackup(pkg);
      showNotification(`Backup snapshot created with ${pkg.manifest.length} tables`);
    } catch (err) {
      showNotification("Backup snapshot creation failed", "error");
    }
  };

  // Download Backup JSON
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

  // Restore Backup
  const handleRestoreBackup = async () => {
    if (!restoreJsonInput.trim()) {
      showNotification("Please paste valid JSON backup content", "error");
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

  // Toggle Menu Visibility
  const toggleMenu = async (menuKey: string) => {
    const current = new Set(settings.enabled_menu_items || []);
    if (current.has(menuKey)) {
      current.delete(menuKey);
    } else {
      current.add(menuKey);
    }

    const updatedList = Array.from(current);
    const updated = await companySettingsService.updateSettings({
      enabled_menu_items: updatedList,
    });
    setSettings(updated);
    showNotification("Navigation menu preferences saved");
  };

  const availableMenus = [
    { key: "pos", name: "POS Billing", desc: "Main checkout & retail counter" },
    { key: "purchases", name: "Purchases", desc: "Inward bills & supplier invoices" },
    { key: "stock", name: "Stock Ledger", desc: "Double-entry movement & adjustments" },
    { key: "reports", name: "Reports & GST", desc: "GSTR-1, HSN summary, and registers" },
    { key: "masters", name: "Master Data", desc: "Products, batches, and parties" },
    { key: "settings", name: "Settings", desc: "Terminal & company configuration" },
  ];

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
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Settings & System Configuration</h1>
            <p className="text-xs text-slate-500">Store profile, GSTIN, offline sync queue, LAN sharing, and backup recovery</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex rounded-lg bg-slate-100 p-1 border border-slate-200">
          <button
            onClick={() => setActiveTab("store")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "store" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Store className="h-3.5 w-3.5" />
            <span>Store Profile</span>
          </button>
          <button
            onClick={() => setActiveTab("sync")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "sync" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync Monitor ({syncQueue.filter((q) => q.status === "pending").length})</span>
          </button>
          <button
            onClick={() => setActiveTab("lan")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "lan" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Network className="h-3.5 w-3.5" />
            <span>LAN Network</span>
          </button>
          <button
            onClick={() => setActiveTab("backup")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "backup" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>Backup & Restore</span>
          </button>
          <button
            onClick={() => setActiveTab("menus")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "menus" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            <span>Menu Access</span>
          </button>
        </div>
      </div>

      {/* Main Tab Panels */}
      <div className="flex-1 overflow-auto rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {/* Tab 1: Store & Tax Profile */}
        {activeTab === "store" && (
          <form onSubmit={handleSaveStoreSettings} className="max-w-3xl space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Business & Indian GST Profile</h2>
              <p className="text-xs text-slate-500">Details printed on tax invoices and drug licenses for compliance.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Store / Business Name *</label>
                <input
                  type="text"
                  required
                  value={settings.store_name}
                  onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-medium focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Store Phone *</label>
                <input
                  type="text"
                  required
                  value={settings.phone}
                  onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase text-slate-600">Full Store Address</label>
              <textarea
                rows={2}
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">GSTIN (15 Digits)</label>
                <input
                  type="text"
                  value={settings.gstin || ""}
                  onChange={(e) => setSettings({ ...settings, gstin: e.target.value.toUpperCase() })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono uppercase focus:border-blue-500 focus:outline-none"
                  placeholder="32AAAAA0000A1Z5"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">State Code (e.g. 32)</label>
                <input
                  type="text"
                  value={settings.state_code}
                  onChange={(e) => setSettings({ ...settings, state_code: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">FSSAI License No</label>
                <input
                  type="text"
                  value={settings.fssai_no || ""}
                  onChange={(e) => setSettings({ ...settings, fssai_no: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                  placeholder="10020041000123"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">
                  Drug Licenses (20B, 21B - comma separated)
                </label>
                <input
                  type="text"
                  value={drugLicenseInput}
                  onChange={(e) => setDrugLicenseInput(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                  placeholder="20B-123456, 21B-123457"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Default Tax Mode</label>
                <select
                  value={settings.tax_mode}
                  onChange={(e) => setSettings({ ...settings, tax_mode: e.target.value as any })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                >
                  <option value="inclusive">GST Inclusive (MRP includes Tax)</option>
                  <option value="exclusive">GST Exclusive (Tax added over Sel Rate)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Invoice Series Prefix</label>
                <input
                  type="text"
                  value={settings.invoice_prefix}
                  onChange={(e) => setSettings({ ...settings, invoice_prefix: e.target.value })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono uppercase focus:border-blue-500 focus:outline-none"
                  placeholder="INV"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">Next Invoice Counter</label>
                <input
                  type="number"
                  min="1"
                  value={settings.next_invoice_number}
                  onChange={(e) => setSettings({ ...settings, next_invoice_number: Number(e.target.value) })}
                  className="mt-1 w-full rounded border border-slate-300 p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                <Save className="h-4 w-4" />
                <span>Save Store Configuration</span>
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Sync Monitor */}
        {activeTab === "sync" && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-slate-800">Offline Sync Queue & Cloud Telemetry</h2>
                <p className="text-xs text-slate-500">
                  Transactions enqueued while offline are automatically sent with exponential backoff and idempotency keys.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handlePullCloudDelta}
                  disabled={isSyncing}
                  className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  <span>Pull Cloud Deltas</span>
                </button>
                <button
                  onClick={handleTriggerSyncNow}
                  disabled={isSyncing}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                  <span>Push Queue Now</span>
                </button>
              </div>
            </div>

            {/* Sync Telemetry Cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] uppercase font-semibold text-slate-500">Pending Outbound Items</div>
                <div className="text-xl font-bold text-amber-600 mt-1">
                  {syncQueue.filter((q) => q.status === "pending").length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] uppercase font-semibold text-slate-500">Total Synced Invoices</div>
                <div className="text-xl font-bold text-emerald-600 mt-1">
                  {syncQueue.filter((q) => q.status === "synced").length}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-[11px] uppercase font-semibold text-slate-500">Cloud Delta Watermark</div>
                <div className="text-xl font-mono font-bold text-slate-700 mt-1">
                  {watermark ? new Date(watermark).toLocaleTimeString() : "Synced"}
                </div>
              </div>
            </div>

            {/* Queue Table */}
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Queue ID</th>
                    <th className="px-4 py-2.5">Entity</th>
                    <th className="px-4 py-2.5">Action</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Retries</th>
                    <th className="px-4 py-2.5">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {syncQueue.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-400">
                        Queue is clean. All transactions are synced with the server.
                      </td>
                    </tr>
                  ) : (
                    syncQueue.slice(0, 15).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-mono text-[11px] text-slate-600">{item.id}</td>
                        <td className="px-4 py-2 font-medium capitalize text-slate-800">{item.entity_type}</td>
                        <td className="px-4 py-2 uppercase font-mono text-[10px] text-slate-500">{item.action}</td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              item.status === "synced"
                                ? "bg-emerald-50 text-emerald-700"
                                : item.status === "failed"
                                ? "bg-rose-50 text-rose-700"
                                : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-slate-500">{item.retry_count || 0}</td>
                        <td className="px-4 py-2 text-slate-400">
                          {new Date(item.created_at).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: LAN Network */}
        {activeTab === "lan" && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-800">In-Store Local Area Network (LAN) Peer Sharing</h2>
              <p className="text-xs text-slate-500">
                Share master product catalogs and price updates across billing counters without internet access.
              </p>
            </div>

            <form onSubmit={handleSaveLanConfig} className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Station Role</label>
                  <select
                    value={lanConfig.role}
                    onChange={(e) => setLanConfig({ ...lanConfig, role: e.target.value as any })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="main_station">Main Store Server (Primary Catalog)</option>
                    <option value="counter_client">Counter Client Station</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">Station Name</label>
                  <input
                    type="text"
                    value={lanConfig.stationName}
                    onChange={(e) => setLanConfig({ ...lanConfig, stationName: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-600">LAN Broadcast Port</label>
                <input
                  type="number"
                  value={lanConfig.port}
                  onChange={(e) => setLanConfig({ ...lanConfig, port: Number(e.target.value) })}
                  className="mt-1 w-48 rounded border border-slate-300 bg-white p-2 text-xs font-mono focus:border-blue-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
              >
                Save Station Config
              </button>
            </form>

            <div className="space-y-3 pt-2">
              <h3 className="text-xs font-bold text-slate-700">Counter Client Actions</h3>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleDiscoverLan}
                  disabled={isLanDiscovering}
                  className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  <Network className={`h-3.5 w-3.5 ${isLanDiscovering ? "animate-pulse" : ""}`} />
                  <span>Discover Main Server (mDNS / UDP)</span>
                </button>

                {discoveredMain && (
                  <button
                    type="button"
                    onClick={handlePullLanSnapshot}
                    className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Pull Catalog from {discoveredMain.ip_address}</span>
                  </button>
                )}
              </div>

              {discoveredMain && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <div className="font-bold">Active Main Station Discovered:</div>
                  <div className="mt-1 font-mono">
                    {discoveredMain.station_name} — {discoveredMain.ip_address}:{discoveredMain.port}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 4: Backup & Restore */}
        {activeTab === "backup" && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Disaster Recovery & Scheduled Database Backup</h2>
              <p className="text-xs text-slate-500">
                Generate full encrypted JSON snapshot packages of all invoices, products, batches, and ledger transactions.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800">Create New Database Snapshot</h3>
                  <p className="text-[11px] text-slate-500">Packages all 10 local SQLite tables into a validated schema bundle.</p>
                </div>
                <button
                  onClick={handleCreateBackup}
                  className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>Create Snapshot</span>
                </button>
              </div>

              {latestBackup && (
                <div className="rounded border border-blue-200 bg-blue-50/50 p-3 text-xs space-y-3">
                  <div className="flex items-center justify-between">
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

                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                    <div>Tables Count: <span className="font-bold">{latestBackup.manifest.length}</span></div>
                    <div>Schema Version: <span className="font-mono font-bold">v{latestBackup.schema_version}</span></div>
                  </div>
                </div>
              )}
            </div>

            {/* Restore from JSON */}
            <div className="rounded-lg border border-slate-200 p-4 space-y-3">
              <h3 className="text-xs font-bold text-slate-800">Restore Database from Snapshot</h3>
              <p className="text-[11px] text-slate-500">
                Paste the JSON backup package contents below to restore all tables and catalog items.
              </p>
              <textarea
                rows={4}
                value={restoreJsonInput}
                onChange={(e) => setRestoreJsonInput(e.target.value)}
                placeholder='Paste {"backup_id": "...", "data": { ... }} here'
                className="w-full rounded border border-slate-300 p-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
              />
              <button
                onClick={handleRestoreBackup}
                disabled={isRestoring || !restoreJsonInput.trim()}
                className="flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Restore Records</span>
              </button>
            </div>
          </div>
        )}

        {/* Tab 5: Dynamic Menu Visibility */}
        {activeTab === "menus" && (
          <div className="max-w-2xl space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-800">Store Role & Menu Visibility Configuration</h2>
              <p className="text-xs text-slate-500">
                Enable or disable modules for cashiers and billing operators on this counter station.
              </p>
            </div>

            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {availableMenus.map((m) => {
                const isChecked = (settings.enabled_menu_items || []).includes(m.key);
                return (
                  <div
                    key={m.key}
                    onClick={() => toggleMenu(m.key)}
                    className="flex cursor-pointer items-center justify-between p-3.5 hover:bg-slate-50 transition-colors"
                  >
                    <div>
                      <div className="text-xs font-bold text-slate-800">{m.name}</div>
                      <div className="text-[11px] text-slate-500">{m.desc}</div>
                    </div>
                    <div>
                      {isChecked ? (
                        <CheckSquare className="h-5 w-5 text-blue-600" />
                      ) : (
                        <Square className="h-5 w-5 text-slate-400" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
