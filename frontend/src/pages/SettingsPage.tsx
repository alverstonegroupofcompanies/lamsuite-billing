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
  Laptop,
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
  QrCode,
  Plus,
  Check,
  ExternalLink,
  MessageCircle,
  Users,
  Package,
  ShoppingCart,
  ArrowRightLeft,
  ArrowUpDown,
  Search,
  Filter,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  companySettingsService,
  type CompanySettings,
  type StoreUpiAccount,
  type UpiSettingsConfig,
  validateUpiId,
  DEFAULT_SETTINGS,
  DEFAULT_COLUMNS,
  DEFAULT_HEADER_FIELDS,
  BUILTIN_BILLING_PRESETS,
  type ColumnSetting,
  type HeaderFieldSetting,
  type BillingScreenPreset,
} from "../lib/settings/companySettingsService";
import { whatsappService } from "../lib/integrations/whatsappService";
import { generateQrCodeSvg, generateUpiPaymentString } from "../lib/printing/printingEngine";
import { syncQueueService, type SyncQueueItem } from "../lib/sync/syncQueueService";
import { cloudDeltaSyncService } from "../lib/sync/cloudDeltaSyncService";
import { LoggedInDevicesTable } from "../components/devices/LoggedInDevicesTable";
import { backupService, type BackupPackage } from "../lib/backup/backupService";
import { printingEngine } from "../lib/printing/printingEngine";
import {
  printerManagerService,
  type SystemPrinterInfo,
  type PrintJobRecord,
  type PaperSize,
} from "../lib/printing/printerManagerService";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { productsStore } from "../lib/masters/productsStore";
import { partiesStore } from "../lib/masters/partiesStore";

import { applyWorkspaceSettings } from "../lib/settings/workspaceThemeService";
import { autoUpdateService, type UpdateInfo } from "../lib/settings/autoUpdateService";
import { APP_FULL_VERSION } from "../config/version";
import { UpdateNotificationModal } from "../components/UpdateNotificationModal";
import { SoftwareUpdatesTab } from "../components/settings/SoftwareUpdatesTab";
import { storeRegistryService } from "../lib/auth/storeRegistryService";

export const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "general" | "billing" | "sequences" | "printing" | "columns" | "security" | "integrations" | "offline_sync" | "sync_devices" | "backup_reset" | "tools" | "updates"
  >("general");

  const [billingSubTab, setBillingSubTab] = useState<"taxes" | "payments">("taxes");

  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Core settings state
  const [settings, setSettings] = useState<CompanySettings>(DEFAULT_SETTINGS);
  const [drugLicenseInput, setDrugLicenseInput] = useState("");

  // Sync Queue state
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [watermark, setWatermark] = useState<number>(0);
  const [syncFilter, setSyncFilter] = useState<"all" | "unsynced" | "pending" | "failed" | "synced">("unsynced");
  const [syncEntityTypeFilter, setSyncEntityTypeFilter] = useState<string>("all");
  const [syncSearchQuery, setSyncSearchQuery] = useState<string>("");
  const [syncingItemId, setSyncingItemId] = useState<string | null>(null);
  const [selectedPayloadItem, setSelectedPayloadItem] = useState<SyncQueueItem | null>(null);
  const [isScanningOffline, setIsScanningOffline] = useState(false);

  // Backup & Reset state
  const [latestBackup, setLatestBackup] = useState<BackupPackage | null>(null);
  const [restoreJsonInput, setRestoreJsonInput] = useState("");
  const [isRestoring, setIsRestoring] = useState(false);
  const [resetConfirmPhrase, setResetConfirmPhrase] = useState("");
  const [resetScope, setResetScope] = useState<"transactions_only" | "full_factory_reset">("transactions_only");

  // Diagnostics & Tools
  const [isTestingPrinter, setIsTestingPrinter] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [foundUpdate, setFoundUpdate] = useState<UpdateInfo | null>(null);

  // Native Print Spooler Diagnostics & Audit
  const [detectedPrinters, setDetectedPrinters] = useState<SystemPrinterInfo[]>([]);
  const [selectedTestPrinter, setSelectedTestPrinter] = useState<string>("");
  const [selectedTestPaper, setSelectedTestPaper] = useState<PaperSize>("thermal_80mm");
  const [printLogs, setPrintLogs] = useState<PrintJobRecord[]>([]);
  const [isScanningPrinters, setIsScanningPrinters] = useState(false);
  const [testPrintFeedback, setTestPrintFeedback] = useState<{ text: string; success: boolean } | null>(null);
  const [selectedHexDumpLog, setSelectedHexDumpLog] = useState<PrintJobRecord | null>(null);

  // Test QR Modal State
  const [testQrModal, setTestQrModal] = useState<{
    isOpen: boolean;
    account: StoreUpiAccount | null;
    amount: number;
  }>({
    isOpen: false,
    account: null,
    amount: 100,
  });

  // WhatsApp Gateway State
  const [waSessions, setWaSessions] = useState<{ id: string; name: string; status: string }[]>([]);
  const [isFetchingWaSessions, setIsFetchingWaSessions] = useState(false);
  const [isTestingWa, setIsTestingWa] = useState(false);
  const [waTestFeedback, setWaTestFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [showWaApiKey, setShowWaApiKey] = useState(false);

  const handleFetchWaSessions = async () => {
    setIsFetchingWaSessions(true);
    try {
      const res = await whatsappService.fetchSessions(settings.whatsapp?.apiUrl, settings.whatsapp?.apiKey);
      if (res.success && res.sessions.length > 0) {
        setWaSessions(res.sessions);
        showNotification(`Found ${res.sessions.length} active OpenWA session(s)`, "success");
      } else {
        showNotification(res.error || "No active OpenWA sessions found", "error");
      }
    } catch (err: any) {
      showNotification(err?.message || "Failed to fetch OpenWA sessions", "error");
    } finally {
      setIsFetchingWaSessions(false);
    }
  };

  const handleTestWaConnection = async () => {
    setIsTestingWa(true);
    setWaTestFeedback(null);
    try {
      const res = await whatsappService.testConnection(settings.whatsapp?.apiUrl, settings.whatsapp?.apiKey);
      if (res.success && res.valid) {
        setWaTestFeedback({
          success: true,
          message: `Connected! Role: ${res.role || "operator"}${res.engineType ? ` | Engine: ${res.engineType}` : ""}`,
        });
        showNotification("WhatsApp Gateway connected successfully", "success");
        handleFetchWaSessions();
      } else {
        setWaTestFeedback({
          success: false,
          message: res.error || "Connection test failed",
        });
        showNotification(res.error || "Failed to connect to WhatsApp Gateway", "error");
      }
    } catch (err: any) {
      setWaTestFeedback({
        success: false,
        message: err?.message || "Network error",
      });
      showNotification("Could not contact WhatsApp Gateway", "error");
    } finally {
      setIsTestingWa(false);
    }
  };

  useEffect(() => {
    if (activeTab === "printing") {
      printerManagerService.getSystemPrinters().then((printers) => {
        setDetectedPrinters(printers);
        if (printers.length > 0 && !selectedTestPrinter) {
          const def = printers.find((p) => p.isDefault)?.name || printers[0].name;
          setSelectedTestPrinter(def);
        }
      });
      printerManagerService.getPrintHistory().then(setPrintLogs);
    }
  }, [activeTab]);

  const handleRefreshPrinters = async () => {
    setIsScanningPrinters(true);
    try {
      const printers = await printerManagerService.getSystemPrinters(true);
      setDetectedPrinters(printers);
      showNotification(`Discovered ${printers.length} printer(s) natively`, "success");
    } catch {
      showNotification("Failed to scan system printers", "error");
    } finally {
      setIsScanningPrinters(false);
    }
  };

  const handleRefreshLogs = async () => {
    const logs = await printerManagerService.getPrintHistory();
    setPrintLogs(logs);
    showNotification("Spooler audit log refreshed", "success");
  };

  const handleClearLogs = async () => {
    await printerManagerService.clearPrintHistory();
    setPrintLogs([]);
    showNotification("Spooler audit log cleared", "success");
  };

  const handleSendHardwareTestPrint = async () => {
    if (!selectedTestPrinter) return;
    setIsTestingPrinter(true);
    setTestPrintFeedback(null);
    try {
      const res = await printerManagerService.sendTestPrint(selectedTestPrinter, selectedTestPaper);
      if (res.success) {
        setTestPrintFeedback({
          text: `Test job accepted by spooler for '${selectedTestPrinter}' (Job ID: ${res.jobId || "N/A"})`,
          success: true,
        });
        showNotification("Test print job accepted by spooler", "success");
      } else {
        setTestPrintFeedback({
          text: `Spooler error: ${res.error || "Printer rejected job"}`,
          success: false,
        });
        showNotification(res.error || "Printer test failed", "error");
      }
      const logs = await printerManagerService.getPrintHistory();
      setPrintLogs(logs);
    } catch (err: any) {
      setTestPrintFeedback({
        text: `Error: ${err?.message || "Communication failed"}`,
        success: false,
      });
      showNotification(err?.message || "Test print failed", "error");
    } finally {
      setIsTestingPrinter(false);
    }
  };

  const handleFeedOneLine = async () => {
    if (!selectedTestPrinter) return;
    try {
      const res = await printerManagerService.feedOneLine(selectedTestPrinter);
      if (res.success) {
        showNotification(`Advanced paper 1 line on '${selectedTestPrinter}'`, "success");
      } else {
        showNotification(res.error || "Feed line command failed", "error");
      }
      const logs = await printerManagerService.getPrintHistory();
      setPrintLogs(logs);
    } catch (err: any) {
      showNotification(err.message || "Failed to feed line", "error");
    }
  };

  const handleFormFeed = async () => {
    if (!selectedTestPrinter) return;
    try {
      const res = await printerManagerService.formFeed(selectedTestPrinter);
      if (res.success) {
        showNotification(`Form feed dispatched to '${selectedTestPrinter}'`, "success");
      } else {
        showNotification(res.error || "Form feed command failed", "error");
      }
      const logs = await printerManagerService.getPrintHistory();
      setPrintLogs(logs);
    } catch (err: any) {
      showNotification(err.message || "Failed to form feed", "error");
    }
  };

  const handleManualCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const info = await autoUpdateService.checkForUpdates();
      if (info.shouldUpdate) {
        setFoundUpdate(info);
      } else {
        showNotification("You are on the latest version! No updates found.", "success");
      }
    } catch (err: any) {
      showNotification(`Update check failed: ${err?.message || "Server unreachable"}`, "error");
    } finally {
      setIsCheckingUpdate(false);
    }
  };

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



  // Trigger Sync Queue Now
  const handleTriggerSyncNow = async () => {
    setIsSyncing(true);
    try {
      const result = await syncQueueService.processQueue();
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      showNotification(`Sync complete: ${result.processed} pushed to database, ${result.failed} failed`);
    } catch (err) {
      showNotification("Sync queue processing failed", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Sync a single queue item to database immediately
  const handleSyncSingleItem = async (itemId: string) => {
    setSyncingItemId(itemId);
    try {
      const res = await syncQueueService.syncSingleItem(itemId);
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      if (res.success) {
        showNotification("Item synced to database successfully!", "success");
      } else {
        showNotification(res.error || "Failed to sync item to database", "error");
      }
    } catch (err: any) {
      showNotification(err?.message || "Sync execution error", "error");
    } finally {
      setSyncingItemId(null);
    }
  };

  // Force sync all unsynced (pending + failed) items immediately
  const handleForceSyncAll = async () => {
    setIsSyncing(true);
    try {
      const result = await syncQueueService.forceSyncAll();
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      showNotification(`Full sync complete: ${result.processed} pushed to database, ${result.failed} failed`);
    } catch (err: any) {
      showNotification(err?.message || "Sync operation failed", "error");
    } finally {
      setIsSyncing(false);
    }
  };

  // Discover and queue any local offline bills not yet in sync queue
  const handleDiscoverOfflineInvoices = async () => {
    setIsScanningOffline(true);
    try {
      const count = await syncQueueService.discoverUnsyncedInvoices();
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      if (count > 0) {
        showNotification(`Discovered & queued ${count} offline bill(s) for database sync!`, "success");
      } else {
        showNotification("All offline bills are already tracked in sync queue.");
      }
    } catch (err: any) {
      showNotification(err?.message || "Error scanning offline bills", "error");
    } finally {
      setIsScanningOffline(false);
    }
  };

  // Delete a queue item
  const handleDeleteQueueItem = async (itemId: string) => {
    if (!window.confirm("Are you sure you want to remove this item from the sync queue?")) return;
    try {
      await syncQueueService.deleteQueueItem(itemId);
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      showNotification("Item removed from sync queue");
    } catch (err: any) {
      showNotification("Failed to delete queue item", "error");
    }
  };

  // Clear all synced items
  const handleClearSyncedItems = async () => {
    try {
      const cleared = await syncQueueService.clearSyncedItems();
      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
      setSyncQueue(queue);
      showNotification(`Cleared ${cleared} synced item(s) from history`);
    } catch (err: any) {
      showNotification("Failed to clear synced history", "error");
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

  // Auto-refresh queue when switching to sync tabs
  useEffect(() => {
    if (activeTab === "offline_sync" || activeTab === "sync_devices") {
      sqliteStorage.findAll<SyncQueueItem>("sync_queue").then((q) => setSyncQueue(q)).catch(() => {});
    }
  }, [activeTab]);

  // Filtered queue for Offline Database Sync tab
  const filteredSyncQueue = syncQueue.filter((item) => {
    // 1. Status Filter
    if (syncFilter === "unsynced") {
      if (item.status === "synced") return false;
    } else if (syncFilter !== "all") {
      if (item.status !== syncFilter) return false;
    }

    // 2. Entity Type Filter
    if (syncEntityTypeFilter !== "all") {
      if (item.entity_type !== syncEntityTypeFilter) return false;
    }

    // 3. Search Query
    if (syncSearchQuery.trim()) {
      const q = syncSearchQuery.toLowerCase();
      const matchId = item.entity_id?.toLowerCase().includes(q);
      const matchType = item.entity_type?.toLowerCase().includes(q);
      const matchError = item.last_error?.toLowerCase().includes(q);
      const matchPayload = item.payload_json?.toLowerCase().includes(q);
      if (!matchId && !matchType && !matchError && !matchPayload) return false;
    }

    return true;
  });

  const getPayloadSummary = (item: SyncQueueItem) => {
    try {
      const data = JSON.parse(item.payload_json || "{}");
      if (item.entity_type === "invoice") {
        const invNum = data.invoice_number || data.invoice_no || item.entity_id;
        const total = data.total_amount ?? data.grand_total ?? data.net_amount ?? 0;
        const cust = data.customer_name || data.customer?.name || "Cash Customer";
        const itemsCount = Array.isArray(data.items) ? data.items.length : 0;
        return {
          title: `Invoice #${invNum}`,
          subtitle: `${cust} • ${itemsCount} item${itemsCount === 1 ? "" : "s"}`,
          amount: Number(total),
        };
      }
      if (item.entity_type === "customer" || item.entity_type === "party") {
        const name = data.name || data.customer_name || item.entity_id;
        const phone = data.phone || data.mobile || "";
        return {
          title: `Customer: ${name}`,
          subtitle: phone ? `Phone: ${phone}` : "Customer Record",
          amount: null,
        };
      }
      if (item.entity_type === "product") {
        const name = data.name || data.item_name || item.entity_id;
        const code = data.barcode || data.item_code || data.sku || "";
        return {
          title: `Product: ${name}`,
          subtitle: code ? `Code: ${code}` : "Inventory Catalog Item",
          amount: data.selling_price || data.sale_price ? Number(data.selling_price || data.sale_price) : null,
        };
      }
      if (item.entity_type === "stock_adjustment" || item.entity_type === "stock_event") {
        const reason = data.reason || data.adjustment_type || "Stock adjustment";
        const itemsCount = Array.isArray(data.items) ? data.items.length : 1;
        return {
          title: `Stock Adjustment #${item.entity_id.slice(0, 8)}`,
          subtitle: `${reason} • ${itemsCount} item${itemsCount === 1 ? "" : "s"}`,
          amount: null,
        };
      }
      if (item.entity_type === "purchase" || item.entity_type === "purchase_order") {
        const billNo = data.bill_number || data.invoice_number || item.entity_id;
        const supplier = data.supplier_name || "Supplier";
        const total = data.grand_total ?? data.total_amount ?? 0;
        return {
          title: `Purchase #${billNo}`,
          subtitle: `${supplier}`,
          amount: Number(total),
        };
      }
      if (item.entity_type === "payment" || item.entity_type === "customer_payment") {
        const ref = data.payment_ref || item.entity_id;
        const amount = data.amount ?? 0;
        const mode = data.payment_mode || "Cash";
        return {
          title: `Payment #${ref}`,
          subtitle: `Mode: ${mode}`,
          amount: Number(amount),
        };
      }
      if (item.entity_type === "transfer") {
        const dest = data.destination_store_id || data.to_branch || "Branch";
        return {
          title: `Stock Transfer #${item.entity_id.slice(0, 8)}`,
          subtitle: `Target Branch: ${dest}`,
          amount: null,
        };
      }
      return {
        title: `${item.entity_type.toUpperCase()} #${item.entity_id.slice(0, 8)}`,
        subtitle: `Action: ${item.action}`,
        amount: null,
      };
    } catch {
      return {
        title: `${item.entity_type.toUpperCase()} #${item.entity_id}`,
        subtitle: `Action: ${item.action}`,
        amount: null,
      };
    }
  };

  const getEntityIcon = (entityType: string) => {
    switch (entityType) {
      case "invoice":
        return <ShoppingCart className="h-4 w-4 text-emerald-600" />;
      case "customer":
      case "party":
        return <Users className="h-4 w-4 text-blue-600" />;
      case "product":
        return <Package className="h-4 w-4 text-purple-600" />;
      case "transfer":
      case "stock_adjustment":
      case "stock_event":
        return <ArrowRightLeft className="h-4 w-4 text-amber-600" />;
      default:
        return <Database className="h-4 w-4 text-slate-500" />;
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
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
      <div className="flex items-center justify-between rounded-card border border-border-main bg-surface p-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-accent-soft text-accent">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-[26px] font-bold text-text-main tracking-tight">System Settings & Terminal Control</h1>
            <p className="text-xs text-text-muted mt-0.5">Configure store profile, billing defaults, sequences, printing, security, and sync</p>
          </div>
        </div>

        <button
          onClick={() => handleSaveAllSettings()}
          className="flex items-center gap-1.5 rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 transition-colors"
        >
          <Save className="h-4 w-4" />
          <span>Save All Changes</span>
        </button>
      </div>

      {/* Main Container with Sidebar Tabs */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Settings Navigation Sidebar */}
        <div className="w-56 shrink-0 overflow-y-auto rounded-card border border-border-main bg-surface p-2 shadow-xs text-xs space-y-1">
          {[
            { id: "general", label: "General & Workspace", icon: Store },
            { id: "updates", label: "Software Updates", icon: RefreshCw },
            { id: "billing", label: "Billing & Taxes", icon: DollarSign },
            { id: "sequences", label: "Document Sequences", icon: Hash },
            { id: "printing", label: "Printing & Templates", icon: Printer },
            { id: "columns", label: "POS Column Settings", icon: Sliders },
            { id: "security", label: "Security & Cashiers", icon: ShieldCheck },
            { id: "integrations", label: "Wallet & WhatsApp Gateway", icon: Mail },
            {
              id: "offline_sync",
              label: "Offline Database Sync",
              icon: ArrowUpDown,
              badge: syncQueue.filter((q) => q.status !== "synced").length,
            },
            { id: "sync_devices", label: "Logged-In Devices", icon: Laptop },
            { id: "backup_reset", label: "Backup & Danger Zone", icon: Database },
            { id: "tools", label: "Testing Tools", icon: Play },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const badgeCount = (item as any).badge ?? 0;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`flex w-full items-center justify-between rounded-btn px-3 py-2 text-left font-medium transition-colors ${
                  isActive
                    ? "bg-accent-soft text-accent font-semibold"
                    : "text-text-muted hover:bg-canvas hover:text-text-main"
                }`}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <Icon className={`h-4 w-4 shrink-0 ${isActive ? "text-accent" : "text-text-muted"}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {badgeCount > 0 && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 font-bold px-1.5 py-0.5 text-[10px]">
                    {badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Content Panel */}
        <div className="flex-1 overflow-y-auto rounded-card border border-border-main bg-surface p-6 shadow-xs">
          {/* TAB 1: General & Workspace */}
          {activeTab === "general" && (
            <div className="max-w-2xl space-y-6">
              <div>
                <h2 className="text-sm font-semibold text-text-main">Store Profile & Display Information</h2>
                <p className="text-xs text-text-muted mt-0.5">Business identity printed on receipts and customer tax invoices.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Legal Store Name *</label>
                  <input
                    type="text"
                    value={settings.store_name}
                    onChange={(e) => setSettings({ ...settings, store_name: e.target.value })}
                    className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Trading Display Name</label>
                  <input
                    type="text"
                    value={settings.display_name || ""}
                    onChange={(e) => setSettings({ ...settings, display_name: e.target.value })}
                    className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Store Phone Number *</label>
                  <input
                    type="text"
                    value={settings.phone}
                    onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                    className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs font-mono font-medium text-text-main focus:border-accent focus:outline-none tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Store Email</label>
                  <input
                    type="email"
                    value={settings.email || ""}
                    onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                    className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Store Address</label>
                <textarea
                  rows={2}
                  value={settings.address}
                  onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                  className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none"
                />
              </div>

              <div className="pt-4 border-t border-border-main">
                <h3 className="text-xs font-semibold text-text-main">Workspace Appearance & Environment</h3>
                <div className="grid grid-cols-3 gap-4 mt-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Theme</label>
                    <select
                      value={settings.workspace.theme}
                      onChange={(e) => {
                        const nextTheme = e.target.value as "light" | "dark" | "system";
                        const nextWs = { ...settings.workspace, theme: nextTheme };
                        setSettings({ ...settings, workspace: nextWs });
                        applyWorkspaceSettings(nextWs);
                      }}
                      className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none cursor-pointer"
                    >
                      <option value="light">Light Theme</option>
                      <option value="dark">Dark Theme</option>
                      <option value="system">Follow System</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Grid Density</label>
                    <select
                      value={settings.workspace.density}
                      onChange={(e) => {
                        const nextDensity = e.target.value as "compact" | "comfortable";
                        const nextWs = { ...settings.workspace, density: nextDensity };
                        setSettings({ ...settings, workspace: nextWs });
                        applyWorkspaceSettings(nextWs);
                      }}
                      className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none cursor-pointer"
                    >
                      <option value="compact">Compact (Dense Data)</option>
                      <option value="comfortable">Comfortable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">Font Size</label>
                    <select
                      value={settings.workspace.fontSize}
                      onChange={(e) => {
                        const nextFontSize = e.target.value as "sm" | "base" | "lg";
                        const nextWs = { ...settings.workspace, fontSize: nextFontSize };
                        setSettings({ ...settings, workspace: nextWs });
                        applyWorkspaceSettings(nextWs);
                      }}
                      className="mt-1 w-full rounded-btn border border-border-main bg-surface p-2 text-xs text-text-main focus:border-accent focus:outline-none cursor-pointer"
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

                {/* Software Updates Quick Access in General Tab */}
                <div className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-slate-800">Software Updates & Version</div>
                      <p className="text-[11px] text-slate-500">
                        Check for new versions of LamSuite Billing Desktop.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 text-[11px] font-mono font-bold text-indigo-700">
                      Installed: {APP_FULL_VERSION}
                    </span>
                  </div>
                  <button
                    onClick={handleManualCheckUpdate}
                    disabled={isCheckingUpdate}
                    className="flex items-center gap-1.5 rounded bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isCheckingUpdate ? "animate-spin" : ""}`} />
                    <span>{isCheckingUpdate ? "Checking for Updates..." : "Check for Updates"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Dedicated Software Updates */}
          {activeTab === "updates" && (
            <SoftwareUpdatesTab
              onFoundUpdate={(info) => setFoundUpdate(info)}
              showNotification={showNotification}
              onNavigateToSync={() => setActiveTab("offline_sync")}
            />
          )}

          {/* TAB 2: Billing & Taxes */}
          {activeTab === "billing" && (
            <div className="max-w-3xl space-y-6">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Billing Policies & Payment Modes</h2>
                  <p className="text-xs text-slate-500">Tax policies, payment tenders, split rules, and reference capture.</p>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 p-1 border border-slate-200">
                  <button
                    type="button"
                    onClick={() => setBillingSubTab("taxes")}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                      billingSubTab === "taxes"
                        ? "bg-white text-blue-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    GST & General
                  </button>
                  <button
                    type="button"
                    onClick={() => setBillingSubTab("payments")}
                    className={`rounded-md px-3 py-1 text-xs font-semibold transition-all cursor-pointer ${
                      billingSubTab === "payments"
                        ? "bg-white text-blue-700 shadow-xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Payments & References
                  </button>
                </div>
              </div>

              {billingSubTab === "taxes" && (
                <div className="space-y-6">

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

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase text-slate-600">GST Registration Type</label>
                  <select
                    value={settings.gst_type || "regular"}
                    onChange={(e) => setSettings({ ...settings, gst_type: e.target.value as any })}
                    className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                  >
                    <option value="regular">Regular GST (Tax Invoice with CGST/SGST/IGST)</option>
                    <option value="composition">Composition Scheme (Bill of Supply, 0% Tax)</option>
                    <option value="no_tax">Unregistered / No Tax (Bill of Supply, 0% Tax)</option>
                  </select>
                </div>
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

              <div className="flex items-center gap-2 pt-1 pb-1">
                <input
                  type="checkbox"
                  id="allow_tax_override_per_bill"
                  checked={Boolean(settings.allow_tax_override_per_bill)}
                  onChange={(e) => setSettings({ ...settings, allow_tax_override_per_bill: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="allow_tax_override_per_bill" className="text-xs font-medium text-slate-700 cursor-pointer">
                  Allow cashiers to override Tax Mode / GST Type per bill in POS
                </label>
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

              {/* Keyboard & Product Entry Workflow */}
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 border-b pb-2 flex items-center justify-between">
                  <span>Product Entry & Keyboard Navigation</span>
                  <span className="text-[11px] font-normal text-slate-500">POS High-Speed Billing Workflow</span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">Product Entry Style</label>
                    <select
                      value={settings.keyboard?.productEntryStyle || "inline_row"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          keyboard: {
                            ...settings.keyboard,
                            productEntryStyle: e.target.value as "inline_row" | "search_bar",
                            enterAfterQty: settings.keyboard?.enterAfterQty || "search",
                            autoFocusQtyAfterAdd: settings.keyboard?.autoFocusQtyAfterAdd ?? true,
                            selectAllOnFocus: settings.keyboard?.selectAllOnFocus ?? true,
                            quickDeleteWithoutConfirm: settings.keyboard?.quickDeleteWithoutConfirm ?? true,
                            scannerSpeedThresholdMs: settings.keyboard?.scannerSpeedThresholdMs || 45,
                          },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="inline_row">Inline row inside grid (Default - Continuous rapid billing)</option>
                      <option value="search_bar">Search bar above grid (Legacy layout)</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Inline row shares table columns directly beneath items for an uninterrupted keyboard flow.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700">Inline Row Position</label>
                    <select
                      value={settings.keyboard?.entryRowPosition || "bottom"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          keyboard: {
                            ...settings.keyboard,
                            entryRowPosition: e.target.value as "bottom" | "top",
                            enterAfterQty: settings.keyboard?.enterAfterQty || "search",
                            autoFocusQtyAfterAdd: settings.keyboard?.autoFocusQtyAfterAdd ?? true,
                            selectAllOnFocus: settings.keyboard?.selectAllOnFocus ?? true,
                            quickDeleteWithoutConfirm: settings.keyboard?.quickDeleteWithoutConfirm ?? true,
                            scannerSpeedThresholdMs: settings.keyboard?.scannerSpeedThresholdMs || 45,
                          },
                        })
                      }
                      disabled={(settings.keyboard?.productEntryStyle || "inline_row") === "search_bar"}
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="bottom">Bottom of grid (Pinned below cart items)</option>
                      <option value="top">Top of grid (Pinned above cart items)</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Pinned row stays permanently visible even when the cart contains 100+ items.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700">Add Line Behavior</label>
                    <select
                      value={settings.keyboard?.addLineMode || "immediate"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          keyboard: {
                            ...settings.keyboard,
                            addLineMode: e.target.value as "immediate" | "after_enter",
                            enterAfterQty: settings.keyboard?.enterAfterQty || "search",
                            autoFocusQtyAfterAdd: settings.keyboard?.autoFocusQtyAfterAdd ?? true,
                            selectAllOnFocus: settings.keyboard?.selectAllOnFocus ?? true,
                            quickDeleteWithoutConfirm: settings.keyboard?.quickDeleteWithoutConfirm ?? true,
                            scannerSpeedThresholdMs: settings.keyboard?.scannerSpeedThresholdMs || 45,
                          },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="immediate">Immediately on selection (default)</option>
                      <option value="after_enter">After Enter</option>
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Immediately adds line and updates totals on product selection; Enter confirms line quantity.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {billingSubTab === "payments" && (
            <div className="space-y-6">
              {/* UPI & Instant QR Settlement Settings (Item 10) */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-5">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-4 w-4 text-indigo-600" />
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        UPI Payment & Instant QR Settlement
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Configure statutory UPI VPAs, payee handles, multiple counter accounts, and test live QR codes.
                      </p>
                    </div>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-slate-50 border border-slate-200 px-3 py-1 rounded-lg">
                    <input
                      type="checkbox"
                      checked={settings.payments?.upi?.enabled ?? true}
                      onChange={(e) => {
                        const upi = settings.payments?.upi || {
                          enabled: true,
                          showInSettlement: true,
                          showOnPrintedBills: true,
                          qrSubtext: "Scan with any UPI app to pay",
                          accounts: [],
                        };
                        setSettings({
                          ...settings,
                          payments: {
                            ...settings.payments,
                            upi: { ...upi, enabled: e.target.checked },
                          },
                        });
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-bold text-slate-800">
                      Enable UPI Payments
                    </span>
                  </label>
                </div>

                {/* Display Preferences */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer border border-slate-100 rounded-lg p-2.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={settings.payments?.upi?.showInSettlement ?? true}
                      onChange={(e) => {
                        const upi = settings.payments?.upi || {
                          enabled: true,
                          showInSettlement: true,
                          showOnPrintedBills: true,
                          qrSubtext: "Scan with any UPI app to pay",
                          accounts: [],
                        };
                        setSettings({
                          ...settings,
                          payments: {
                            ...settings.payments,
                            enableDynamicUpiQr: e.target.checked,
                            upi: { ...upi, showInSettlement: e.target.checked },
                          },
                        });
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-medium text-slate-700">
                      Show QR in POS settlement dialog
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer border border-slate-100 rounded-lg p-2.5 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={settings.payments?.upi?.showOnPrintedBills ?? true}
                      onChange={(e) => {
                        const upi = settings.payments?.upi || {
                          enabled: true,
                          showInSettlement: true,
                          showOnPrintedBills: true,
                          qrSubtext: "Scan with any UPI app to pay",
                          accounts: [],
                        };
                        setSettings({
                          ...settings,
                          printing: { ...settings.printing, printUpiQrCode: e.target.checked },
                          payments: {
                            ...settings.payments,
                            upi: { ...upi, showOnPrintedBills: e.target.checked },
                          },
                        });
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs font-medium text-slate-700">
                      Show QR on printed bills & receipts
                    </span>
                  </label>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">QR Subtext Note</label>
                    <input
                      type="text"
                      value={settings.payments?.upi?.qrSubtext ?? "Scan with any UPI app to pay"}
                      onChange={(e) => {
                        const upi = settings.payments?.upi || {
                          enabled: true,
                          showInSettlement: true,
                          showOnPrintedBills: true,
                          qrSubtext: "Scan with any UPI app to pay",
                          accounts: [],
                        };
                        setSettings({
                          ...settings,
                          payments: {
                            ...settings.payments,
                            upi: { ...upi, qrSubtext: e.target.value },
                          },
                        });
                      }}
                      placeholder="e.g. Scan with any UPI app to pay"
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Multi-Account UPI Management */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800">Store UPI Accounts & Counter Overrides</h4>
                      <p className="text-[11px] text-slate-500">
                        Define store accounts. You can set a primary default and assign dedicated accounts to specific counters.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const curAccounts = settings.payments?.upi?.accounts || [];
                        const newAcc: StoreUpiAccount = {
                          id: `upi_acc_${Date.now()}`,
                          upiId: "",
                          payeeName: settings.store_name || "Store",
                          isDefault: curAccounts.length === 0,
                          counterOverrides: [],
                        };
                        const upi = settings.payments?.upi || {
                          enabled: true,
                          showInSettlement: true,
                          showOnPrintedBills: true,
                          qrSubtext: "Scan with any UPI app to pay",
                          accounts: [],
                        };
                        setSettings({
                          ...settings,
                          payments: {
                            ...settings.payments,
                            upi: {
                              ...upi,
                              accounts: [...curAccounts, newAcc],
                            },
                          },
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-xs font-bold cursor-pointer transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add UPI Account</span>
                    </button>
                  </div>

                  {/* Accounts Table */}
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2.5">Default</th>
                          <th className="px-3 py-2.5">UPI ID (VPA)</th>
                          <th className="px-3 py-2.5">Payee Name</th>
                          <th className="px-3 py-2.5">Merchant Code (MCC)</th>
                          <th className="px-3 py-2.5">Counter Override</th>
                          <th className="px-3 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {((settings.payments?.upi?.accounts && settings.payments.upi.accounts.length > 0)
                          ? settings.payments.upi.accounts
                          : [
                              {
                                id: "def_acc_1",
                                upiId: settings.payments?.upiVpa || "",
                                payeeName: settings.payments?.upiPayeeName || settings.store_name || "",
                                isDefault: true,
                                counterOverrides: [],
                              },
                            ]
                        ).map((acc, accIdx) => {
                          const isValid = validateUpiId(acc.upiId);
                          return (
                            <tr key={acc.id || accIdx} className="hover:bg-slate-50/60">
                              <td className="px-3 py-2.5">
                                <input
                                  type="radio"
                                  name="default_upi_account"
                                  checked={Boolean(acc.isDefault)}
                                  onChange={() => {
                                    const allAccs = (settings.payments?.upi?.accounts || []).map((a, i) => ({
                                      ...a,
                                      isDefault: (a.id ? a.id === acc.id : i === accIdx),
                                    }));
                                    const upi = settings.payments?.upi || {
                                      enabled: true,
                                      showInSettlement: true,
                                      showOnPrintedBills: true,
                                      qrSubtext: "Scan with any UPI app to pay",
                                      accounts: [],
                                    };
                                    setSettings({
                                      ...settings,
                                      payments: {
                                        ...settings.payments,
                                        upiVpa: acc.upiId,
                                        upiPayeeName: acc.payeeName,
                                        upi: { ...upi, accounts: allAccs, defaultUpiId: acc.upiId, defaultPayeeName: acc.payeeName },
                                      },
                                    });
                                  }}
                                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="text"
                                    value={acc.upiId}
                                    onChange={(e) => {
                                      const val = e.target.value.trim();
                                      const allAccs = [...(settings.payments?.upi?.accounts || [])];
                                      allAccs[accIdx] = { ...allAccs[accIdx], upiId: val };
                                      const upi = settings.payments?.upi || {
                                        enabled: true,
                                        showInSettlement: true,
                                        showOnPrintedBills: true,
                                        qrSubtext: "Scan with any UPI app to pay",
                                        accounts: [],
                                      };
                                      setSettings({
                                        ...settings,
                                        payments: {
                                          ...settings.payments,
                                          upiVpa: acc.isDefault ? val : settings.payments?.upiVpa,
                                          upi: { ...upi, accounts: allAccs },
                                        },
                                      });
                                    }}
                                    placeholder="storename@bank"
                                    className={`w-48 rounded border p-1.5 text-xs font-mono focus:outline-none ${
                                      acc.upiId.length === 0
                                        ? "border-slate-300"
                                        : isValid
                                        ? "border-emerald-400 bg-emerald-50/30 text-emerald-900"
                                        : "border-red-300 bg-red-50/30 text-red-700"
                                    }`}
                                  />
                                  {acc.upiId.length > 0 && (
                                    <span
                                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                        isValid ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                                      }`}
                                    >
                                      {isValid ? "Valid" : "Invalid VPA"}
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2.5">
                                <input
                                  type="text"
                                  value={acc.payeeName}
                                  onChange={(e) => {
                                    const allAccs = [...(settings.payments?.upi?.accounts || [])];
                                    allAccs[accIdx] = { ...allAccs[accIdx], payeeName: e.target.value };
                                    const upi = settings.payments?.upi || {
                                      enabled: true,
                                      showInSettlement: true,
                                      showOnPrintedBills: true,
                                      qrSubtext: "Scan with any UPI app to pay",
                                      accounts: [],
                                    };
                                    setSettings({
                                      ...settings,
                                      payments: {
                                        ...settings.payments,
                                        upiPayeeName: acc.isDefault ? e.target.value : settings.payments?.upiPayeeName,
                                        upi: { ...upi, accounts: allAccs },
                                      },
                                    });
                                  }}
                                  placeholder="Store / Payee Name"
                                  className="w-40 rounded border border-slate-300 p-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <input
                                  type="text"
                                  value={acc.merchantCode || ""}
                                  onChange={(e) => {
                                    const allAccs = [...(settings.payments?.upi?.accounts || [])];
                                    allAccs[accIdx] = { ...allAccs[accIdx], merchantCode: e.target.value };
                                    const upi = settings.payments?.upi || {
                                      enabled: true,
                                      showInSettlement: true,
                                      showOnPrintedBills: true,
                                      qrSubtext: "Scan with any UPI app to pay",
                                      accounts: [],
                                    };
                                    setSettings({
                                      ...settings,
                                      payments: {
                                        ...settings.payments,
                                        upi: { ...upi, accounts: allAccs },
                                      },
                                    });
                                  }}
                                  placeholder="e.g. 5912 (Optional)"
                                  className="w-28 rounded border border-slate-300 p-1.5 text-xs font-mono focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2.5">
                                <input
                                  type="text"
                                  value={(acc.counterOverrides || []).join(", ")}
                                  onChange={(e) => {
                                    const split = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                                    const allAccs = [...(settings.payments?.upi?.accounts || [])];
                                    allAccs[accIdx] = { ...allAccs[accIdx], counterOverrides: split };
                                    const upi = settings.payments?.upi || {
                                      enabled: true,
                                      showInSettlement: true,
                                      showOnPrintedBills: true,
                                      qrSubtext: "Scan with any UPI app to pay",
                                      accounts: [],
                                    };
                                    setSettings({
                                      ...settings,
                                      payments: {
                                        ...settings.payments,
                                        upi: { ...upi, accounts: allAccs },
                                      },
                                    });
                                  }}
                                  placeholder="e.g. Counter 01, Counter 02"
                                  className="w-40 rounded border border-slate-300 p-1.5 text-xs focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2.5 text-right space-x-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTestQrModal({
                                      isOpen: true,
                                      account: acc,
                                      amount: 100,
                                    });
                                  }}
                                  disabled={!isValid}
                                  className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-xs font-bold disabled:opacity-40 cursor-pointer inline-flex items-center gap-1"
                                >
                                  <QrCode className="h-3 w-3" />
                                  <span>Test QR</span>
                                </button>
                                {(settings.payments?.upi?.accounts?.length || 0) > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const allAccs = (settings.payments?.upi?.accounts || []).filter((_, i) => i !== accIdx);
                                      const upi = settings.payments?.upi || {
                                        enabled: true,
                                        showInSettlement: true,
                                        showOnPrintedBills: true,
                                        qrSubtext: "Scan with any UPI app to pay",
                                        accounts: [],
                                      };
                                      setSettings({
                                        ...settings,
                                        payments: {
                                          ...settings.payments,
                                          upi: { ...upi, accounts: allAccs },
                                        },
                                      });
                                    }}
                                    className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                                    title="Delete UPI Account"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.payments?.enableQuickDenominations ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          payments: { ...settings.payments, enableQuickDenominations: e.target.checked },
                        })
                      }
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs font-medium text-slate-700">
                      Show Cash Denomination quick buttons (+₹100, +₹200, +₹500, +₹2000)
                    </span>
                  </label>
                </div>
              </div>

              {/* Credit & Security Policies */}
              <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 border-b pb-2">
                  Customer Credit (Udhari) & Print Rules
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600">Credit Limit Breach Action</label>
                    <select
                      value={settings.payments?.creditPolicy || "warn_on_exceed"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          payments: { ...settings.payments, creditPolicy: e.target.value as any },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                    >
                      <option value="warn_on_exceed">Warn but allow cashier to proceed</option>
                      <option value="block_on_exceed">Block checkout strictly when limit is exceeded</option>
                      <option value="allow_with_limit">Always allow without warnings</option>
                    </select>
                  </div>
                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={settings.payments?.printShowReferences ?? false}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            payments: { ...settings.payments, printShowReferences: e.target.checked },
                          })
                        }
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-medium text-slate-700">
                        Print payment references (masked) on customer receipts
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Payment Tender Modes & Reference Rules */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Payment Modes & Reference Rules
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Configure requirement rules, formats, duplicate checks, and captured fields per tender.
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  {(settings.payments?.modes || []).map((modeCfg, idx) => {
                    const updateMode = (patch: Partial<typeof modeCfg>) => {
                      const updatedModes = [...settings.payments.modes];
                      updatedModes[idx] = { ...modeCfg, ...patch };
                      setSettings({
                        ...settings,
                        payments: { ...settings.payments, modes: updatedModes },
                      });
                    };

                    return (
                      <div
                        key={modeCfg.id}
                        className={`rounded-lg border p-4 transition-all ${
                          modeCfg.enabled ? "border-slate-300 bg-white" : "border-slate-200 bg-slate-50 opacity-70"
                        }`}
                      >
                        <div className="flex items-center justify-between border-b pb-2 mb-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-slate-800">{modeCfg.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                modeCfg.referenceRequirement === "required"
                                  ? "bg-red-100 text-red-700"
                                  : modeCfg.referenceRequirement === "optional"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              Ref: {modeCfg.referenceRequirement}
                            </span>
                          </div>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={modeCfg.enabled}
                              onChange={(e) => updateMode({ enabled: e.target.checked })}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-[11px] font-medium text-slate-600">Enabled</span>
                          </label>
                        </div>

                        {modeCfg.enabled && (
                          <div className="space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="block text-[11px] font-medium text-slate-600">Reference Requirement</label>
                                <select
                                  value={modeCfg.referenceRequirement}
                                  onChange={(e) => updateMode({ referenceRequirement: e.target.value as any })}
                                  className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs focus:border-blue-500 focus:outline-none"
                                >
                                  <option value="off">Off (No reference field)</option>
                                  <option value="optional">Optional (Cashier may fill)</option>
                                  <option value="required">Required (Cannot save without reference)</option>
                                </select>
                              </div>

                              {modeCfg.referenceRequirement !== "off" && (
                                <>
                                  <div>
                                    <label className="block text-[11px] font-medium text-slate-600">Field Label</label>
                                    <input
                                      type="text"
                                      value={modeCfg.referenceLabel}
                                      onChange={(e) => updateMode({ referenceLabel: e.target.value })}
                                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs focus:border-blue-500 focus:outline-none"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-medium text-slate-600">Duplicate Check</label>
                                    <select
                                      value={modeCfg.duplicateCheck || "off"}
                                      onChange={(e) => updateMode({ duplicateCheck: e.target.value as any })}
                                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs focus:border-blue-500 focus:outline-none"
                                    >
                                      <option value="off">Off (Allow same reference)</option>
                                      <option value="warn">Warn on duplicate</option>
                                      <option value="block">Block duplicate reference</option>
                                    </select>
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Extra Field Toggles */}
                            <div className="border-t border-slate-100 pt-2">
                              <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">Optional Extra Fields</span>
                              <div className="flex flex-wrap gap-4 text-xs">
                                {modeCfg.id === "upi" && (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={modeCfg.extraFields?.payerVpa ?? true}
                                      onChange={(e) =>
                                        updateMode({
                                          extraFields: { ...modeCfg.extraFields, payerVpa: e.target.checked },
                                        })
                                      }
                                      className="rounded border-slate-300 text-blue-600"
                                    />
                                    <span>Payer UPI ID</span>
                                  </label>
                                )}
                                {modeCfg.id === "card" && (
                                  <>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={modeCfg.extraFields?.cardLastFour ?? true}
                                        onChange={(e) =>
                                          updateMode({
                                            extraFields: { ...modeCfg.extraFields, cardLastFour: e.target.checked },
                                          })
                                        }
                                        className="rounded border-slate-300 text-blue-600"
                                      />
                                      <span>Masked Last 4 Digits</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={modeCfg.extraFields?.cardNetwork ?? true}
                                        onChange={(e) =>
                                          updateMode({
                                            extraFields: { ...modeCfg.extraFields, cardNetwork: e.target.checked },
                                          })
                                        }
                                        className="rounded border-slate-300 text-blue-600"
                                      />
                                      <span>Card Network</span>
                                    </label>
                                  </>
                                )}
                                {(modeCfg.id === "bank_transfer" || modeCfg.id === "cheque") && (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={modeCfg.extraFields?.bankName ?? true}
                                      onChange={(e) =>
                                        updateMode({
                                          extraFields: { ...modeCfg.extraFields, bankName: e.target.checked },
                                        })
                                      }
                                      className="rounded border-slate-300 text-blue-600"
                                    />
                                    <span>Bank Name</span>
                                  </label>
                                )}
                                {modeCfg.id === "cheque" && (
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={modeCfg.extraFields?.chequeDate ?? true}
                                      onChange={(e) =>
                                        updateMode({
                                          extraFields: { ...modeCfg.extraFields, chequeDate: e.target.checked },
                                        })
                                      }
                                      className="rounded border-slate-300 text-blue-600"
                                    />
                                    <span>Cheque Date (Post-dated)</span>
                                  </label>
                                )}
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={modeCfg.extraFields?.notes ?? true}
                                    onChange={(e) =>
                                      updateMode({
                                        extraFields: { ...modeCfg.extraFields, notes: e.target.checked },
                                      })
                                    }
                                    className="rounded border-slate-300 text-blue-600"
                                  />
                                  <span>Remarks / Note</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
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
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-mono text-[11px] font-bold text-accent">
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
                    <option value="half_a4">Half-A4 (V-Cut)</option>
                    <option value="dot_matrix_6in">Dot Matrix 6" (Narrow Continuous)</option>
                    <option value="dot_matrix_10in">Dot Matrix 10" (Standard Fanfold)</option>
                    <option value="dot_matrix_12in">Dot Matrix 12" (Continuous Form)</option>
                    <option value="dot_matrix_15in">Dot Matrix 15" (Wide Carriage)</option>
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

              {/* Dot Matrix Continuous Stationery Configuration */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                    <Sliders className="h-4 w-4 text-emerald-600" />
                    <span>Dot Matrix Continuous Stationery Settings</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Fine-tune paper handling, end-of-job head positioning, and command sets for continuous tractor-feed forms (TVS, Epson MSP).
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      After Last Printed Line
                    </label>
                    <select
                      value={settings.printing.dotMatrixEndOfJob || "stop_immediately"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          printing: {
                            ...settings.printing,
                            dotMatrixEndOfJob: e.target.value as "stop_immediately" | "feed_tear_off" | "form_feed",
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white"
                    >
                      <option value="stop_immediately">Stop immediately (default - no extra feed)</option>
                      <option value="feed_tear_off">Feed N lines for tear-off</option>
                      <option value="form_feed">Form feed to top of next page</option>
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Default stops print head right after content to save paper for the next invoice.
                    </p>
                  </div>

                  {settings.printing.dotMatrixEndOfJob === "feed_tear_off" && (
                    <div>
                      <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                        Tear-off Feed Lines (0 - 10)
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={settings.printing.dotMatrixTearOffFeedLines ?? 0}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            printing: {
                              ...settings.printing,
                              dotMatrixTearOffFeedLines: Math.max(0, Math.min(10, parseInt(e.target.value) || 0)),
                            },
                          })
                        }
                        className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none"
                      />
                      <p className="mt-1 text-[10px] text-slate-500">
                        Blank lines to advance past printer tear-off bar.
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Hardware Page Length
                    </label>
                    <select
                      value={String(settings.printing.dotMatrixPageLength || 66)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          printing: {
                            ...settings.printing,
                            dotMatrixPageLength: e.target.value === "continuous" ? "continuous" : (parseInt(e.target.value) as 66 | 72 | 33),
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white"
                    >
                      <option value="66">66 Lines (11-inch Standard Fanfold)</option>
                      <option value="72">72 Lines (12-inch Legal Fanfold)</option>
                      <option value="33">33 Lines (5.5-inch Half-Page)</option>
                      <option value="continuous">Continuous (Roll / No Fixed Perforations)</option>
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Used only to repeat headers on multi-page bills. Never pads short bills.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Command Set Profile
                    </label>
                    <select
                      value={settings.printing.dotMatrixCommandSet || "esc_p"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          printing: {
                            ...settings.printing,
                            dotMatrixCommandSet: e.target.value as "esc_p" | "tvs_native" | "plain_ascii",
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white font-mono"
                    >
                      <option value="esc_p">ESC/P Standard (Epson LX, FX, LQ, Citizen)</option>
                      <option value="tvs_native">TVS Native (MSP 240/245/250 Star)</option>
                      <option value="plain_ascii">Plain ASCII (Generic / Text-Only Driver)</option>
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Clean mode reset without trailing paper ejects.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Default Loaded Paper Width
                    </label>
                    <select
                      value={settings.printing.dotMatrixDefaultPaperWidth || "10in"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          printing: {
                            ...settings.printing,
                            dotMatrixDefaultPaperWidth: e.target.value as "6in" | "10in" | "12in" | "15in",
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white font-mono"
                    >
                      <option value="6in">6-inch (50 Columns Usable - Narrow Form)</option>
                      <option value="10in">10-inch (80 Columns - Standard Fanfold)</option>
                      <option value="12in">12-inch (120 Columns - Continuous Form)</option>
                      <option value="15in">15-inch (132 Columns - Wide Carriage)</option>
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Loaded continuous paper width. Printable width is also switchable per job in preview.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Printer Carriage Width (Hardware)
                    </label>
                    <select
                      value={String(settings.printing.dotMatrixCarriageWidth || 80)}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          printing: {
                            ...settings.printing,
                            dotMatrixCarriageWidth: parseInt(e.target.value) as 80 | 120 | 132 | 136,
                          },
                        })
                      }
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white font-mono"
                    >
                      <option value="80">80 Columns (10-inch Standard Platen)</option>
                      <option value="120">120 Columns (12-inch Platen - TVS 245)</option>
                      <option value="132">132 Columns (15-inch Wide Carriage)</option>
                      <option value="136">136 Columns (15-inch Extended Platen)</option>
                    </select>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Physical width of printer platen. Narrow paper is dynamically centered against this width.
                    </p>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Horizontal Paper Alignment
                    </label>
                    <label className="flex items-center gap-2 pt-2 cursor-pointer text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={settings.printing.dotMatrixAutoCenter !== false}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            printing: {
                              ...settings.printing,
                              dotMatrixAutoCenter: e.target.checked,
                            },
                          })
                        }
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium">Auto-center narrow paper in wide carriage</span>
                    </label>
                    <p className="mt-1 text-[10px] text-slate-500">
                      Centers 6&quot; or 10&quot; paper automatically (e.g. +30 cols for 6&quot; on 12&quot; printer).
                    </p>
                  </div>
                </div>
              </div>

              {/* Native Printer Diagnostics & Hardware Test Print */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                      <Printer className="h-4 w-4 text-blue-600" />
                      <span>Hardware Printer Diagnostics & Test Spool</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Verify physical printer connectivity and test Windows print spooler acceptance directly.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRefreshPrinters}
                    disabled={isScanningPrinters}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isScanningPrinters ? "animate-spin" : ""}`} />
                    <span>Scan Printers</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Target System Printer
                    </label>
                    <select
                      value={selectedTestPrinter}
                      onChange={(e) => setSelectedTestPrinter(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white font-mono"
                    >
                      {detectedPrinters.length === 0 ? (
                        <option value="">No printers detected</option>
                      ) : (
                        detectedPrinters.map((p) => (
                          <option key={p.name} value={p.name}>
                            {p.displayName} {p.isDefault ? "[Default]" : ""} ({p.status.toUpperCase()})
                          </option>
                        ))
                      )}
                    </select>
                    {detectedPrinters.length > 0 && (
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <span>Status:</span>
                        {(() => {
                          const curr = detectedPrinters.find((p) => p.name === selectedTestPrinter);
                          const st = curr?.status || "ready";
                          return (
                            <span
                              className={`font-semibold px-1.5 py-0.5 rounded text-[10px] ${
                                st === "ready"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : st === "offline"
                                  ? "bg-rose-100 text-rose-800"
                                  : st === "paper_out"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-800"
                              }`}
                            >
                              {st.toUpperCase()}
                            </span>
                          );
                        })()}
                        {(() => {
                          const curr = detectedPrinters.find((p) => p.name === selectedTestPrinter);
                          return curr?.statusDetails ? (
                            <span className="truncate">({curr.statusDetails})</span>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase text-slate-600 mb-1">
                      Test Format / Paper Size
                    </label>
                    <select
                      value={selectedTestPaper}
                      onChange={(e) => setSelectedTestPaper(e.target.value as PaperSize)}
                      className="w-full rounded-lg border border-slate-300 p-2 text-xs focus:border-blue-500 focus:outline-none bg-white"
                    >
                      <option value="thermal_80mm">Thermal 80mm ESC/POS Receipt</option>
                      <option value="thermal_58mm">Thermal 58mm ESC/POS Receipt</option>
                      <option value="a4">Standard A4 Tax Invoice</option>
                      <option value="half_a4">Half-A4 (V-Cut)</option>
                      <option value="dot_matrix_6in">Dot Matrix 6" (50 Columns Usable - Narrow Form)</option>
                      <option value="dot_matrix_10in">Dot Matrix 10" (80-Column ESC/P - Standard)</option>
                      <option value="dot_matrix_80col">Dot Matrix 80-Col (10-Inch)</option>
                      <option value="dot_matrix_12in">Dot Matrix 12" (120-Column ESC/P - Continuous)</option>
                      <option value="dot_matrix_120col">Dot Matrix 120-Col (12-Inch)</option>
                      <option value="dot_matrix_15in">Dot Matrix 15" (132-Column ESC/P - Wide Carriage)</option>
                      <option value="dot_matrix_132col">Dot Matrix 132-Col (15-Inch)</option>
                    </select>
                  </div>
                </div>

                {/* Profile & Driver Pairing Compatibility Warnings */}
                {(() => {
                  const currPrinter = detectedPrinters.find((p) => p.name === selectedTestPrinter);
                  if (!currPrinter) return null;
                  const compat = printerManagerService.validatePaperCompatibility(currPrinter, selectedTestPaper);
                  if (compat.compatible && !compat.driverWarning) return null;
                  return (
                    <div className="space-y-2 pt-1">
                      {compat.warning && (
                        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5">
                          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <span className="font-bold">Printer Profile Mismatch Warning: </span>
                            <span>{compat.warning}</span>
                            {compat.suggestedPaper && (
                              <button
                                type="button"
                                onClick={() => setSelectedTestPaper(compat.suggestedPaper!)}
                                className="ml-2 px-2 py-0.5 rounded bg-amber-200 hover:bg-amber-300 text-amber-900 font-bold transition inline-block text-[11px]"
                              >
                                Switch to {compat.suggestedPaper === "thermal_80mm" ? "Thermal 80mm" : compat.suggestedPaper}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                      {compat.driverWarning && (
                        <div className="p-2.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 text-xs flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-semibold">Driver Notice: </span>
                            <span>{compat.driverWarning}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Dot Matrix Manual Alignment & Calibration Bar */}
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-800">Dot Matrix Alignment & Calibration Tools</span>
                      <p className="text-[11px] text-slate-500">
                        Manually align tractor paper and verify print head boundary with zero paper waste.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleFeedOneLine}
                        disabled={!selectedTestPrinter}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition disabled:opacity-50"
                        title="Send single CRLF (0x0D 0x0A) to advance paper exactly 1 line"
                      >
                        Feed 1 Line
                      </button>
                      <button
                        type="button"
                        onClick={handleFormFeed}
                        disabled={!selectedTestPrinter}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition disabled:opacity-50"
                        title="Send Form Feed (0x0C) to advance paper to next page perforation"
                      >
                        Form Feed
                      </button>
                      <button
                        type="button"
                        onClick={handleSendHardwareTestPrint}
                        disabled={isTestingPrinter || !selectedTestPrinter}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition shadow-sm disabled:opacity-50 shrink-0"
                        title="Prints exactly 3 lines with NO trailing form feed or empty page ejection"
                      >
                        <Printer className={`h-3.5 w-3.5 ${isTestingPrinter ? "animate-bounce" : ""}`} />
                        <span>{isTestingPrinter ? "Spooling..." : "Test Print (3 Lines)"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Set Top of Form (TOF) Guide */}
                  <details className="text-[11px] text-slate-600 bg-white rounded border border-slate-200 p-2">
                    <summary className="font-semibold text-slate-700 cursor-pointer select-none hover:text-blue-600">
                      ℹ️ How to Set Top of Form (TOF) on Dot Matrix Printers (TVS / Epson)
                    </summary>
                    <ol className="list-decimal pl-5 mt-2 space-y-1 text-slate-600">
                      <li>Power on the printer and engage continuous fanfold paper into the tractor pins.</li>
                      <li>Rotate the platen knob or click <strong>Feed 1 Line</strong> until the horizontal page perforation is aligned right at the print head or ribbon line.</li>
                      <li>Press the physical <strong>"Set TOF"</strong> or <strong>"Load/Eject"</strong> button on the printer control panel to lock this position as Line 1.</li>
                      <li>Click <strong>Test Print (3 Lines)</strong> above: 3 test lines will print and stop immediately on Line 3 without advancing or ejecting an empty page.</li>
                    </ol>
                  </details>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex-1 min-w-0 pr-4">
                    {testPrintFeedback && (
                      <div
                        className={`text-xs font-medium p-2 rounded-lg flex items-center gap-1.5 ${
                          testPrintFeedback.success
                            ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                            : "bg-rose-50 text-rose-800 border border-rose-200"
                        }`}
                      >
                        {testPrintFeedback.success ? (
                          <CheckCircle className="h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                        )}
                        <span className="truncate">{testPrintFeedback.text}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Print Spooler Audit Log */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      <span>Print Spooler Audit Log</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      Real-time log of spooler job IDs, target devices, status, and failure reasons.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRefreshLogs}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Refresh</span>
                    </button>
                    {printLogs.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearLogs}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded transition"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Clear Log</span>
                      </button>
                    )}
                  </div>
                </div>

                {printLogs.length === 0 ? (
                  <div className="text-center py-6 text-xs text-slate-400">
                    No print spooler records found yet. Dispatched print jobs will be logged here.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 text-slate-600 uppercase font-semibold sticky top-0 border-b border-slate-200">
                        <tr>
                          <th className="p-2">Timestamp</th>
                          <th className="p-2">Document</th>
                          <th className="p-2">Printer</th>
                          <th className="p-2">Format</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Job ID / Error</th>
                          <th className="p-2 text-right">Raw Bytes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {printLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-slate-50/50">
                            <td className="p-2 whitespace-nowrap text-slate-500 font-mono">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                            </td>
                            <td className="p-2 font-medium text-slate-800">
                              {log.documentNumber || log.documentType}
                            </td>
                            <td className="p-2 text-slate-700 max-w-[150px] truncate" title={log.printerName}>
                              {log.printerName}
                            </td>
                            <td className="p-2 uppercase text-slate-500 font-mono text-[10px]">
                              {log.paperSize}
                            </td>
                            <td className="p-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  log.status === "success"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                {log.status.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-2 text-slate-600 max-w-[200px] truncate" title={log.errorMessage || log.id}>
                              {log.status === "success" ? (
                                <span className="font-mono text-slate-500">{log.id}</span>
                              ) : (
                                <span className="text-rose-600 font-semibold">{log.errorMessage || "Spooler rejected job"}</span>
                              )}
                            </td>
                            <td className="p-2 text-right">
                              {log.hexDump ? (
                                <button
                                  type="button"
                                  onClick={() => setSelectedHexDumpLog(log)}
                                  className="px-2 py-0.5 text-[10px] font-mono font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded transition"
                                  title="View hexadecimal byte dump of this print job"
                                >
                                  {log.rawBytesLength ? `${log.rawBytesLength} B` : "Hex Dump"}
                                </button>
                              ) : (
                                <span className="text-slate-400 font-mono text-[10px]">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Hex Dump Modal Viewer */}
              {selectedHexDumpLog && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                  <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col overflow-hidden border border-slate-200">
                    <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
                      <div>
                        <h4 className="text-sm font-bold text-slate-800">
                          Spooler Job Raw Byte Diagnostic ({selectedHexDumpLog.documentNumber || selectedHexDumpLog.documentType})
                        </h4>
                        <p className="text-xs text-slate-500 font-mono">
                          Target: {selectedHexDumpLog.printerName} | Length: {selectedHexDumpLog.rawBytesLength ?? 0} bytes
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedHexDumpLog(null)}
                        className="text-slate-400 hover:text-slate-700 font-bold px-2 py-1"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="p-4 overflow-y-auto flex-1 bg-slate-950 font-mono text-xs text-emerald-400">
                      <pre className="whitespace-pre overflow-x-auto leading-relaxed">
                        {selectedHexDumpLog.hexDump || "No hex dump available."}
                      </pre>
                    </div>

                    <div className="p-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                      <span className="text-xs text-slate-500">
                        Inspecting raw escape bytes sent directly to Windows Spooler.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedHexDumpLog.hexDump) {
                            navigator.clipboard.writeText(selectedHexDumpLog.hexDump);
                            showNotification("Hex dump copied to clipboard", "success");
                          }
                        }}
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition"
                      >
                        Copy Hex Dump
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
                    <Layers className="h-3.5 w-3.5 text-accent" />
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

              {/* WhatsApp Gateway (OpenWA) Card */}
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/30 dark:bg-emerald-950/20 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-emerald-600" />
                    <div>
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        WhatsApp Gateway Dispatch (OpenWA)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Automated invoice dispatch with high-fidelity PDF attachment via OpenWA.
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.whatsapp?.enabled ?? false}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), enabled: e.target.checked },
                      })
                    }
                    className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                </div>

                {/* Test Feedback */}
                {waTestFeedback && (
                  <div
                    className={`p-2.5 rounded-md text-[11px] font-medium flex items-center gap-2 ${
                      waTestFeedback.success
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                        : "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200"
                    }`}
                  >
                    {waTestFeedback.success ? (
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    )}
                    <span>{waTestFeedback.message}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600">OpenWA Gateway URL</label>
                    <input
                      type="text"
                      value={settings.whatsapp?.apiUrl || "https://wa-api.alverstone.in"}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), apiUrl: e.target.value },
                        })
                      }
                      className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label className="block text-[11px] font-semibold text-slate-600">Active Session</label>
                      <button
                        type="button"
                        onClick={handleFetchWaSessions}
                        disabled={isFetchingWaSessions}
                        className="text-[10px] text-emerald-700 hover:underline flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${isFetchingWaSessions ? "animate-spin" : ""}`} />
                        <span>{isFetchingWaSessions ? "Fetching..." : "Fetch"}</span>
                      </button>
                    </div>

                    {waSessions.length > 0 ? (
                      <select
                        value={settings.whatsapp?.sessionId || "default"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), sessionId: e.target.value },
                          })
                        }
                        className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs font-mono"
                      >
                        {waSessions.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.status})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={settings.whatsapp?.sessionId || "default"}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), sessionId: e.target.value },
                          })
                        }
                        placeholder="default"
                        className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs font-mono"
                      />
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-[11px] font-semibold text-slate-600">OpenWA API Key</label>
                    <button
                      type="button"
                      onClick={() => setShowWaApiKey(!showWaApiKey)}
                      className="text-[10px] text-slate-500 hover:text-slate-800"
                    >
                      {showWaApiKey ? "Hide Key" : "Show Key"}
                    </button>
                  </div>
                  <input
                    type={showWaApiKey ? "text" : "password"}
                    value={settings.whatsapp?.apiKey || ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), apiKey: e.target.value },
                      })
                    }
                    placeholder="Enter operator / admin API key"
                    className="w-full rounded border border-slate-300 p-1.5 text-xs font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    API key from your OpenWA instance. You can also configure this centrally from Admin Panel.
                  </p>
                </div>

                {/* Dispatch Options */}
                <div className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="opt_send_pdf"
                      checked={settings.whatsapp?.sendPdfInvoice ?? true}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), sendPdfInvoice: e.target.checked },
                        })
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <label htmlFor="opt_send_pdf" className="text-xs text-slate-700 cursor-pointer">
                      Attach high-resolution vector PDF invoice with dispatch
                    </label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="opt_auto_send"
                      checked={settings.whatsapp?.autoSendOnBillSave ?? false}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          whatsapp: { ...(settings.whatsapp || DEFAULT_SETTINGS.whatsapp), autoSendOnBillSave: e.target.checked },
                        })
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <label htmlFor="opt_auto_send" className="text-xs text-slate-700 cursor-pointer">
                      Auto-send WhatsApp bill when saving invoice (requires customer phone)
                    </label>
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleTestWaConnection}
                    disabled={isTestingWa}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTestingWa ? "animate-spin" : ""}`} />
                    <span>{isTestingWa ? "Testing Connection..." : "Test Connection"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Offline to Database Sync */}
          {activeTab === "offline_sync" && (
            <div className="space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-text-main flex items-center gap-2">
                    <ArrowUpDown className="h-5 w-5 text-accent" />
                    <span>Offline to Database Sync</span>
                    {syncQueue.filter((q) => q.status !== "synced").length > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-semibold">
                        {syncQueue.filter((q) => q.status !== "synced").length} unsynced
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-text-muted mt-0.5">
                    View offline bills, customers, adjustments, and transactions stored locally in SQLite and push them to the central MySQL server database.
                  </p>
                </div>
                <div className="flex items-center flex-wrap gap-2">
                  <button
                    onClick={handleDiscoverOfflineInvoices}
                    disabled={isScanningOffline}
                    title="Scan SQLite invoices table for any offline bills not yet tracked in sync queue"
                    className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-canvas disabled:opacity-50 transition-colors shadow-xs"
                  >
                    <Search className={`h-3.5 w-3.5 ${isScanningOffline ? "animate-spin text-accent" : ""}`} />
                    <span>{isScanningOffline ? "Scanning..." : "Scan Offline Bills"}</span>
                  </button>

                  <button
                    onClick={handleClearSyncedItems}
                    disabled={syncQueue.filter((q) => q.status === "synced").length === 0}
                    title="Purge successfully synced history items"
                    className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-1.5 text-xs font-semibold text-text-muted hover:text-text-main hover:bg-canvas disabled:opacity-40 transition-colors shadow-xs"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Clear Synced</span>
                  </button>

                  <button
                    onClick={async () => {
                      const queue = await sqliteStorage.findAll<SyncQueueItem>("sync_queue");
                      setSyncQueue(queue);
                    }}
                    title="Refresh sync queue from SQLite"
                    className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-canvas transition-colors shadow-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Refresh</span>
                  </button>

                  <button
                    onClick={handleForceSyncAll}
                    disabled={isSyncing || syncQueue.filter((q) => q.status !== "synced").length === 0}
                    className="flex items-center gap-1.5 rounded-btn bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                    <span>{isSyncing ? "Syncing..." : "Sync All to Database"}</span>
                  </button>
                </div>
              </div>

              {/* Status Metric Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-card border border-border-main bg-surface p-3.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Pending Push</span>
                    <Clock className="h-4 w-4 text-amber-500" />
                  </div>
                  <p className="text-2xl font-bold text-amber-600 mt-1">
                    {syncQueue.filter((q) => q.status === "pending").length}
                  </p>
                  <span className="text-[11px] text-text-muted">Awaiting sync cycle</span>
                </div>

                <div className="rounded-card border border-border-main bg-surface p-3.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Failed / Errors</span>
                    <AlertCircle className="h-4 w-4 text-rose-500" />
                  </div>
                  <p className="text-2xl font-bold text-rose-600 mt-1">
                    {syncQueue.filter((q) => q.status === "failed").length}
                  </p>
                  <span className="text-[11px] text-text-muted">Click "Sync Now" to retry</span>
                </div>

                <div className="rounded-card border border-border-main bg-surface p-3.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Synced to DB</span>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  </div>
                  <p className="text-2xl font-bold text-emerald-600 mt-1">
                    {syncQueue.filter((q) => q.status === "synced").length}
                  </p>
                  <span className="text-[11px] text-text-muted">Saved on central MySQL</span>
                </div>

                <div className="rounded-card border border-border-main bg-surface p-3.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Network Status</span>
                    <span className={`h-2.5 w-2.5 rounded-full ${navigator.onLine ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
                  </div>
                  <p className="text-base font-bold text-text-main mt-2">
                    {navigator.onLine ? "Online (Server Reachable)" : "Offline (Local Only)"}
                  </p>
                  <span className="text-[11px] text-text-muted">
                    {navigator.onLine ? "Auto-sync active" : "Changes queued in SQLite"}
                  </span>
                </div>
              </div>

              {/* Filters & Search Toolbar */}
              <div className="rounded-card border border-border-main bg-surface p-3 space-y-3 shadow-xs">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  {/* Status Pills */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { id: "unsynced", label: "Unsynced", count: syncQueue.filter((q) => q.status !== "synced").length },
                      { id: "pending", label: "Pending", count: syncQueue.filter((q) => q.status === "pending").length },
                      { id: "failed", label: "Failed", count: syncQueue.filter((q) => q.status === "failed").length },
                      { id: "synced", label: "Synced", count: syncQueue.filter((q) => q.status === "synced").length },
                      { id: "all", label: "All Records", count: syncQueue.length },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => setSyncFilter(tab.id as any)}
                        className={`flex items-center gap-1.5 rounded-btn px-2.5 py-1 text-xs font-semibold transition-colors ${
                          syncFilter === tab.id
                            ? "bg-accent text-white shadow-xs"
                            : "bg-canvas text-text-muted hover:text-text-main hover:bg-border-main/50"
                        }`}
                      >
                        <span>{tab.label}</span>
                        <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                          syncFilter === tab.id ? "bg-white/20 text-white" : "bg-surface text-text-muted"
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Search Input */}
                  <div className="relative min-w-[220px]">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-text-muted" />
                    <input
                      type="text"
                      value={syncSearchQuery}
                      onChange={(e) => setSyncSearchQuery(e.target.value)}
                      placeholder="Search ID, invoice #, error..."
                      className="w-full rounded-btn border border-border-main bg-canvas pl-8 pr-3 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {syncSearchQuery && (
                      <button
                        onClick={() => setSyncSearchQuery("")}
                        className="absolute right-2.5 top-2.5 text-text-muted hover:text-text-main"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Entity Type Filter Bar */}
                <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-border-main/60 text-xs">
                  <span className="text-[11px] font-semibold text-text-muted mr-1 flex items-center gap-1">
                    <Filter className="h-3 w-3" /> Type:
                  </span>
                  {[
                    { id: "all", label: "All Types" },
                    { id: "invoice", label: "Invoices" },
                    { id: "customer", label: "Customers" },
                    { id: "product", label: "Products" },
                    { id: "stock_adjustment", label: "Stock Adjustments" },
                    { id: "purchase", label: "Purchases" },
                    { id: "payment", label: "Payments" },
                    { id: "transfer", label: "Transfers" },
                  ].map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSyncEntityTypeFilter(t.id)}
                      className={`rounded-btn px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
                        syncEntityTypeFilter === t.id
                          ? "bg-accent-soft text-accent font-semibold"
                          : "text-text-muted hover:text-text-main"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Items Table */}
              <div className="rounded-card border border-border-main bg-surface shadow-xs overflow-hidden">
                {filteredSyncQueue.length === 0 ? (
                  <div className="p-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 mb-3">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <h3 className="text-sm font-bold text-text-main">
                      {syncFilter === "unsynced"
                        ? "No unsynced items found!"
                        : "No matching sync queue records"}
                    </h3>
                    <p className="text-xs text-text-muted max-w-sm mx-auto mt-1">
                      {syncFilter === "unsynced"
                        ? "All local sales, customers, and inventory events have been successfully synced with the server database."
                        : "Try selecting a different filter or clearing your search query."}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-border-main bg-canvas/60 text-text-muted uppercase text-[10px] font-bold">
                        <tr>
                          <th className="px-3.5 py-2.5">Entity / Item Details</th>
                          <th className="px-3 py-2.5">Action</th>
                          <th className="px-3 py-2.5">Queued Time</th>
                          <th className="px-3 py-2.5">Sync Status</th>
                          <th className="px-3 py-2.5">Retries</th>
                          <th className="px-3 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-main">
                        {filteredSyncQueue.map((item) => {
                          const summary = getPayloadSummary(item);
                          const isItemSyncing = syncingItemId === item.id;
                          return (
                            <tr key={item.id} className="hover:bg-canvas/50 transition-colors">
                              {/* Entity / Details */}
                              <td className="px-3.5 py-3">
                                <div className="flex items-start gap-2.5">
                                  <div className="mt-0.5 rounded-btn bg-canvas p-1.5 border border-border-main/50">
                                    {getEntityIcon(item.entity_type)}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-text-main">{summary.title}</span>
                                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-canvas text-text-muted border border-border-main/40 uppercase">
                                        {item.entity_type}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-text-muted mt-0.5">{summary.subtitle}</p>
                                    {summary.amount !== null && (
                                      <p className="text-[11px] font-semibold text-text-main mt-0.5">
                                        ₹{summary.amount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                                      </p>
                                    )}
                                    {item.status === "failed" && item.last_error && (
                                      <div className="mt-1.5 rounded bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 p-1.5 text-[10px] text-rose-700 dark:text-rose-300">
                                        <span className="font-bold">Error:</span> {item.last_error}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* Action */}
                              <td className="px-3 py-3">
                                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                  item.action === "create"
                                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                    : item.action === "update"
                                    ? "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                                    : "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                                }`}>
                                  {item.action}
                                </span>
                              </td>

                              {/* Queued Time */}
                              <td className="px-3 py-3 text-text-muted whitespace-nowrap">
                                <div className="text-[11px] text-text-main font-medium">
                                  {formatRelativeTime(item.created_at)}
                                </div>
                                <div className="text-[10px] font-mono">
                                  {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </div>
                              </td>

                              {/* Status */}
                              <td className="px-3 py-3 whitespace-nowrap">
                                {item.status === "synced" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3 w-3" /> Synced
                                  </span>
                                ) : item.status === "failed" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 dark:bg-rose-950/40 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:text-rose-300">
                                    <AlertCircle className="h-3 w-3" /> Failed
                                  </span>
                                ) : item.status === "in_progress" ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-950/40 px-2 py-0.5 text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                                    <RefreshCw className="h-3 w-3 animate-spin" /> In Progress
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                    <Clock className="h-3 w-3" /> Pending
                                  </span>
                                )}
                              </td>

                              {/* Retries */}
                              <td className="px-3 py-3 text-[11px] font-mono text-text-muted">
                                {item.retry_count > 0 ? (
                                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                                    {item.retry_count} {item.retry_count === 1 ? "retry" : "retries"}
                                  </span>
                                ) : (
                                  "0"
                                )}
                              </td>

                              {/* Actions */}
                              <td className="px-3 py-3 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1.5">
                                  {item.status !== "synced" && (
                                    <button
                                      onClick={() => handleSyncSingleItem(item.id)}
                                      disabled={isItemSyncing || isSyncing}
                                      className="flex items-center gap-1 rounded-btn bg-accent px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs hover:bg-accent/90 disabled:opacity-50 transition-colors"
                                      title="Push this item to database now"
                                    >
                                      <RefreshCw className={`h-3 w-3 ${isItemSyncing ? "animate-spin" : ""}`} />
                                      <span>{isItemSyncing ? "Syncing..." : "Sync Now"}</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={() => setSelectedPayloadItem(item)}
                                    className="rounded-btn border border-border-main bg-canvas p-1 text-text-muted hover:text-text-main hover:bg-border-main/50 transition-colors"
                                    title="View JSON Payload"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteQueueItem(item.id)}
                                    className="rounded-btn border border-border-main bg-canvas p-1 text-text-muted hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                                    title="Delete from sync queue"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Payload Inspector Modal */}
              {selectedPayloadItem && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                  <div className="w-full max-w-2xl rounded-card border border-border-main bg-surface shadow-xl flex flex-col max-h-[85vh]">
                    <div className="flex items-center justify-between border-b border-border-main p-4">
                      <div>
                        <h3 className="text-sm font-bold text-text-main flex items-center gap-2">
                          <Eye className="h-4 w-4 text-accent" />
                          <span>Payload Inspector: {selectedPayloadItem.entity_type.toUpperCase()}</span>
                          <span className="font-mono text-xs text-text-muted">#{selectedPayloadItem.entity_id}</span>
                        </h3>
                        <p className="text-xs text-text-muted mt-0.5">
                          Action: <strong className="uppercase">{selectedPayloadItem.action}</strong> • Status: <strong className="uppercase">{selectedPayloadItem.status}</strong> • Retries: {selectedPayloadItem.retry_count}
                        </p>
                      </div>
                      <button
                        onClick={() => setSelectedPayloadItem(null)}
                        className="rounded-btn p-1 text-text-muted hover:text-text-main hover:bg-canvas"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    </div>

                    {selectedPayloadItem.last_error && (
                      <div className="bg-rose-50 dark:bg-rose-950/30 border-b border-rose-200 dark:border-rose-900/40 p-3 text-xs text-rose-800 dark:text-rose-200">
                        <strong className="font-bold">Last Error: </strong> {selectedPayloadItem.last_error}
                      </div>
                    )}

                    <div className="flex-1 overflow-auto p-4 bg-slate-900 text-slate-100 font-mono text-xs rounded-b">
                      <pre className="whitespace-pre-wrap break-all">
                        {(() => {
                          try {
                            return JSON.stringify(JSON.parse(selectedPayloadItem.payload_json), null, 2);
                          } catch {
                            return selectedPayloadItem.payload_json;
                          }
                        })()}
                      </pre>
                    </div>

                    <div className="flex items-center justify-between border-t border-border-main p-3 bg-canvas/40">
                      <div className="text-[11px] text-text-muted font-mono">
                        Queued: {new Date(selectedPayloadItem.created_at).toLocaleString()}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedPayloadItem.status !== "synced" && (
                          <button
                            onClick={async () => {
                              await handleSyncSingleItem(selectedPayloadItem.id);
                              setSelectedPayloadItem(null);
                            }}
                            disabled={syncingItemId === selectedPayloadItem.id}
                            className="flex items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${syncingItemId === selectedPayloadItem.id ? "animate-spin" : ""}`} />
                            <span>Sync to Database Now</span>
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedPayloadItem(null)}
                          className="rounded-btn border border-border-main bg-surface px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-canvas"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 8: Logged-In Devices & Sync */}
          {(activeTab === "sync_devices" || (activeTab as any) === "sync_lan") && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Cloud Sync & Logged-In Devices</h2>
                  <p className="text-xs text-slate-500">Telemetry, pending queue retries, and authenticated workstation sessions.</p>
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

              {/* Logged-In Devices (Replaces LAN Clients) */}
              <div className="pt-2">
                <LoggedInDevicesTable />
              </div>
            </div>
          )}

          {/* TAB 9: Backup & Danger Zone */}
          {activeTab === "backup_reset" && (
            <div className="max-w-2xl space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-800">Database Backup & Disaster Recovery</h2>
                  <p className="text-xs text-slate-500">Create encrypted snapshots, download backup JSON, or restore data.</p>
                </div>
                {(() => {
                  const activeStore = storeRegistryService.getActiveStore();
                  if (!activeStore) return null;
                  return (
                    <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border border-slate-200 bg-slate-50">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeStore.color }} />
                      <span>Target: {activeStore.alias || activeStore.name}</span>
                    </div>
                  );
                })()}
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


              </div>
            </div>
          )}
        </div>
      </div>
      {foundUpdate && (
        <UpdateNotificationModal
          updateInfo={foundUpdate}
          onClose={() => setFoundUpdate(null)}
        />
      )}

      {/* Test QR Preview Modal */}
      {testQrModal.isOpen && testQrModal.account && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-800">Test Dynamic UPI QR</h3>
              </div>
              <button
                type="button"
                onClick={() => setTestQrModal({ isOpen: false, account: null, amount: 100 })}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-slate-500 mb-1">
                  Test Bill Amount (₹)
                </label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={testQrModal.amount}
                  onChange={(e) => setTestQrModal({ ...testQrModal, amount: Math.max(0.01, Number(e.target.value) || 0) })}
                  className="w-full rounded-lg border border-slate-300 p-2 text-xs font-bold text-slate-800 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {(() => {
                const uri = generateUpiPaymentString(
                  testQrModal.account.upiId,
                  testQrModal.account.payeeName,
                  testQrModal.amount,
                  "TEST-QR-001"
                );
                const svg = generateQrCodeSvg(uri, 150);
                return (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-indigo-100 bg-indigo-50/30 p-4">
                    <div className="bg-white p-2 rounded-lg border border-indigo-200 shadow-xs">
                      <div dangerouslySetInnerHTML={{ __html: svg }} />
                    </div>
                    <div className="mt-3 text-center space-y-1">
                      <div className="text-xs font-bold text-indigo-900">{testQrModal.account.payeeName}</div>
                      <div className="text-[11px] font-mono text-slate-600">{testQrModal.account.upiId}</div>
                      <div className="text-[10px] text-slate-500">{testQrModal.account.qrSubtext || "Scan with any UPI app to pay"}</div>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setTestQrModal({ isOpen: false, account: null, amount: 100 })}
                className="px-4 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-bold hover:bg-slate-700"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
