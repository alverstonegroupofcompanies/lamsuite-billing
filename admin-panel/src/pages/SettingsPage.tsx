import React, { useEffect, useState } from "react";
import { api, downloadFile } from "../services/api";
import { formatDate } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import {
  Settings,
  Shield,
  KeyRound,
  Lock,
  Unlock,
  Download,
  Calendar,
  Save,
  RotateCw,
  Mail,
  Printer,
  X,
  CreditCard,
  FileCheck,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Webhook,
  RefreshCw,
} from "lucide-react";

export const SettingsPage: React.FC = () => {
  const { activeStore, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<"general" | "whatsapp" | "secrets" | "webhooks" | "financial_years" | "gst_locks" | "backups">("general");

  const [settingsData, setSettingsData] = useState<any>(null);
  const [financialYears, setFinancialYears] = useState<any[]>([]);
  const [gstPeriods, setGstPeriods] = useState<any[]>([]);
  const [backups, setBackups] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Webhook outbox state
  const [webhookDeliveries, setWebhookDeliveries] = useState<any[]>([]);
  const [webhookSummary, setWebhookSummary] = useState<{ pending: number; delivered: number; failed: number } | null>(null);
  const [webhookEndpointLive, setWebhookEndpointLive] = useState(false);
  const [webhookStatusFilter, setWebhookStatusFilter] = useState("");
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [isTestingWebhook, setIsTestingWebhook] = useState(false);
  const [webhookTestFeedback, setWebhookTestFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [retryingDeliveryId, setRetryingDeliveryId] = useState<number | null>(null);

  const WEBHOOK_EVENTS = [
    { id: "invoice.created", label: "Invoice Created" },
    { id: "invoice.cancelled", label: "Invoice Cancelled" },
    { id: "payment.received", label: "Customer Payment Received" },
    { id: "purchase.created", label: "Purchase Created" },
  ];

  // WhatsApp OpenWA Integration state
  const [availableSessions, setAvailableSessions] = useState<{ id: string; name: string; status: string }[]>([]);
  const [isFetchingSessions, setIsFetchingSessions] = useState(false);
  const [isTestingWhatsApp, setIsTestingWhatsApp] = useState(false);
  const [whatsAppTestFeedback, setWhatsAppTestFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [isSavingWhatsApp, setIsSavingWhatsApp] = useState(false);

  // Rotate Secret Modal
  const [rotateSecretType, setRotateSecretType] = useState<string | null>(null);
  const [newSecretValue, setNewSecretValue] = useState("");

  // Database backups
  const [backupBusy, setBackupBusy] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<any>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");

  const handleCreateBackup = async () => {
    setBackupBusy("create");
    setBackupNotice(null);
    try {
      await api.post("/admin/settings/backups", {});
      await fetchSettings();
      setBackupNotice({ kind: "ok", text: "Snapshot created and checksummed." });
    } catch (err: any) {
      setBackupNotice({ kind: "error", text: err?.message || "Failed to create snapshot." });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleDownloadBackup = async (bp: any) => {
    setBackupBusy(`download-${bp.id}`);
    try {
      await downloadFile(`/admin/settings/backups/${bp.id}/download`, bp.filename);
    } catch (err: any) {
      setBackupNotice({ kind: "error", text: err?.message || "Download failed." });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoreTarget) return;
    setBackupBusy("restore");
    setBackupNotice(null);
    try {
      const res = await api.post(`/admin/settings/backups/${restoreTarget.id}/restore`, {
        confirmation: restoreConfirm,
      });
      setRestoreTarget(null);
      setRestoreConfirm("");
      await fetchSettings();
      setBackupNotice({ kind: "ok", text: res?.message || "Database restored." });
    } catch (err: any) {
      setBackupNotice({ kind: "error", text: err?.message || "Restore failed." });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleDeleteBackup = async (bp: any) => {
    if (!window.confirm(`Delete backup ${bp.filename}? This cannot be undone.`)) return;
    setBackupBusy(`delete-${bp.id}`);
    setBackupNotice(null);
    try {
      await api.delete(`/admin/settings/backups/${bp.id}`);
      await fetchSettings();
    } catch (err: any) {
      setBackupNotice({ kind: "error", text: err?.message || "Delete failed." });
    } finally {
      setBackupBusy(null);
    }
  };

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "general" || activeTab === "secrets" || activeTab === "whatsapp") {
        const res = await api.get("/admin/settings");
        setSettingsData(res);
      } else if (activeTab === "webhooks") {
        const [settingsRes, deliveriesRes] = await Promise.all([
          api.get("/admin/settings"),
          api.get(`/admin/webhooks${webhookStatusFilter ? `?status=${webhookStatusFilter}` : ""}`),
        ]);
        setSettingsData(settingsRes);
        setWebhookDeliveries(deliveriesRes?.deliveries || []);
        setWebhookSummary(deliveriesRes?.summary || null);
        setWebhookEndpointLive(Boolean(deliveriesRes?.enabled));
      } else if (activeTab === "financial_years") {
        const res = await api.get("/admin/settings/financial-years");
        setFinancialYears(res || []);
      } else if (activeTab === "gst_locks") {
        const res = await api.get("/admin/settings/gst-periods");
        setGstPeriods(res || []);
      } else if (activeTab === "backups") {
        try {
          const res = await api.get("/admin/settings/backups");
          setBackups(res);
        } catch (err: any) {
          if (err?.status === 403) {
            setBackups({ restricted: true, backups: [] });
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [activeTab, activeStore, webhookStatusFilter]);

  const handleFetchSessions = async () => {
    setIsFetchingSessions(true);
    try {
      const res = await api.get("/admin/settings/whatsapp/sessions");
      if (res.success && Array.isArray(res.sessions)) {
        setAvailableSessions(res.sessions);
        if (res.sessions.length > 0 && !settingsData?.whatsapp?.session_id) {
          setSettingsData((prev: any) => ({
            ...prev,
            whatsapp: {
              ...(prev?.whatsapp || {}),
              session_id: res.sessions[0].id,
            },
          }));
        }
      } else {
        alert(res.error || "Failed to fetch sessions from OpenWA.");
      }
    } catch (err: any) {
      alert(err?.message || "Failed to fetch OpenWA sessions. Make sure API key is configured.");
    } finally {
      setIsFetchingSessions(false);
    }
  };

  const handleTestWhatsAppConnection = async () => {
    setIsTestingWhatsApp(true);
    setWhatsAppTestFeedback(null);
    try {
      const res = await api.post("/admin/settings/whatsapp/test", {
        api_url: settingsData?.whatsapp?.api_url,
        api_key: settingsData?.whatsapp?.api_key,
      });
      if (res.success && res.valid) {
        setWhatsAppTestFeedback({
          success: true,
          message: `Connected successfully! Role: ${res.role || "operator"}${res.engineType ? ` | Engine: ${res.engineType}` : ""}`,
        });
        // Auto fetch active sessions on verified test
        handleFetchSessions();
      } else {
        setWhatsAppTestFeedback({
          success: false,
          message: res.error || "Failed to authenticate with OpenWA.",
        });
      }
    } catch (err: any) {
      setWhatsAppTestFeedback({
        success: false,
        message: err?.message || "Network error connecting to OpenWA.",
      });
    } finally {
      setIsTestingWhatsApp(false);
    }
  };

  const handleSaveWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWhatsApp(true);
    try {
      await api.post("/admin/settings", {
        whatsapp: settingsData.whatsapp,
      });
      alert("WhatsApp settings saved successfully.");
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to save WhatsApp settings.");
    } finally {
      setIsSavingWhatsApp(false);
    }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingWebhook(true);
    try {
      await api.post("/admin/settings", { webhook: settingsData?.webhook });
      alert("Webhook configuration saved.");
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to save webhook configuration.");
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleTestWebhook = async () => {
    setIsTestingWebhook(true);
    setWebhookTestFeedback(null);
    try {
      const res = await api.post("/admin/webhooks/test", {});
      setWebhookTestFeedback({
        success: Boolean(res.success),
        message: res.success
          ? `Test event delivered (HTTP ${res.response_status ?? 200}).`
          : res.error || res.message || "Delivery failed. Check the endpoint URL and secret.",
      });
      await fetchSettings();
    } catch (err: any) {
      setWebhookTestFeedback({
        success: false,
        message: err?.message || "Network error while sending test event.",
      });
    } finally {
      setIsTestingWebhook(false);
    }
  };

  const handleRetryDelivery = async (id: number) => {
    setRetryingDeliveryId(id);
    try {
      await api.post(`/admin/webhooks/${id}/retry`, {});
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to retry webhook delivery.");
    } finally {
      setRetryingDeliveryId(null);
    }
  };

  const toggleWebhookEvent = (eventId: string) => {
    setSettingsData((prev: any) => {
      const current: string[] = prev?.webhook?.events || [];
      const next = current.includes(eventId)
        ? current.filter((e) => e !== eventId)
        : [...current, eventId];
      return {
        ...prev,
        webhook: { ...(prev?.webhook || {}), events: next },
      };
    });
  };

  const handleSaveGeneral = async (e: React.FormEvent) => {    e.preventDefault();
    try {
      await api.post("/admin/settings", {
        billing: settingsData.billing,
        sequences: settingsData.sequences,
        printing: settingsData.printing,
        wallet: settingsData.wallet,
        whatsapp: settingsData.whatsapp,
        workspace: settingsData.workspace,
        security: settingsData.security,
        inventory: settingsData.inventory,
        batch_required: Boolean(settingsData.batch_required),
        timezone: settingsData.timezone,
      });
      alert("Settings saved successfully.");
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to update settings.");
    }
  };

  const handleRotateSecretSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotateSecretType || !newSecretValue.trim()) return;

    try {
      await api.post("/admin/settings/rotate-secret", {
        secret_type: rotateSecretType,
        new_value: newSecretValue,
      });
      alert(`Secret credential successfully rotated and secured.`);
      setRotateSecretType(null);
      setNewSecretValue("");
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to rotate secret.");
    }
  };

  const toggleFyLock = async (id: number) => {
    try {
      await api.post(`/admin/settings/financial-years/${id}/toggle-lock`);
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to toggle financial year lock.");
    }
  };

  const toggleGstLock = async (periodMonth: string, currentLocked: boolean) => {
    try {
      await api.post("/admin/settings/gst-periods/toggle-lock", {
        period_month: periodMonth,
        is_locked: !currentLocked,
      });
      await fetchSettings();
    } catch (err: any) {
      alert(err?.message || "Failed to toggle GST period lock.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
          System Administration & Governance
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Statutory financial year closing, GST return period locks, masked credential rotation, and backups.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold overflow-x-auto pb-0.5">
        {[
          { id: "general", label: "Billing & Document Sequences", icon: Settings },
          { id: "whatsapp", label: "WhatsApp Gateway (OpenWA)", icon: MessageSquare },
          { id: "secrets", label: "Masked Secrets & SMTP", icon: Shield },
          { id: "webhooks", label: "Webhooks & Event Outbox", icon: Webhook },
          { id: "financial_years", label: "Financial Years Closing", icon: Calendar },
          { id: "gst_locks", label: "GST Period Lock Engine", icon: Lock },
          { id: "backups", label: "Disaster Recovery Snapshots", icon: Download },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Contents */}
      {activeTab === "general" && settingsData && (
        <form onSubmit={handleSaveGeneral} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Billing Rules */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Billing & Calculation Rules</h3>
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    GST Tax Calculation Mode
                  </label>
                  <select
                    value={settingsData.billing?.tax_mode || "inclusive"}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        billing: { ...settingsData.billing, tax_mode: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="inclusive">MRP Inclusive Tax (Retail & Pharma)</option>
                    <option value="exclusive">Tax Exclusive (B2B Wholesale)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Default Rate Basis
                  </label>
                  <select
                    value={settingsData.billing?.default_rate_basis || "sel_rate"}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        billing: { ...settingsData.billing, default_rate_basis: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="sel_rate">Standard Selling Rate</option>
                    <option value="mrp">Maximum Retail Price (MRP)</option>
                    <option value="ptr">Price To Retailer (PTR)</option>
                    <option value="pts">Price To Stockist (PTS)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Credit Period (Days)
                  </label>
                  <input
                    type="number"
                    value={settingsData.billing?.credit_period_days || 30}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        billing: { ...settingsData.billing, credit_period_days: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Past Bills Default Period
                  </label>
                  <select
                    value={
                      settingsData.workspace?.billsDefaultPeriod ||
                      settingsData.bills_default_period ||
                      "today"
                    }
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        workspace: { ...settingsData.workspace, billsDefaultPeriod: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    <option value="today">Today</option>
                    <option value="yesterday">Yesterday</option>
                    <option value="last7days">Last 7 Days</option>
                    <option value="month">This Month</option>
                    <option value="all">All Time</option>
                  </select>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Store default. Staff can pin their own period from the Past Bills screen.
                  </p>
                </div>
              </div>
            </div>

            {/* Document Sequences & Prefixes */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Document Sequences & Prefixes</h3>
              <div className="space-y-3 text-xs font-mono">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sales Invoice Prefix
                  </label>
                  <input
                    type="text"
                    value={settingsData.sequences?.invoice_prefix || "INV"}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        sequences: { ...settingsData.sequences, invoice_prefix: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white uppercase"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Next Invoice Serial Number
                  </label>
                  <input
                    type="number"
                    value={settingsData.sequences?.next_invoice_number || 1001}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        sequences: { ...settingsData.sequences, next_invoice_number: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Sales Return Prefix
                  </label>
                  <input
                    type="text"
                    value={settingsData.sequences?.return_prefix || "SR"}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        sequences: { ...settingsData.sequences, return_prefix: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white uppercase"
                  />
                </div>
              </div>
            </div>

            {/* Store Clock, Security & Inventory */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 lg:col-span-2">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Store Clock, Security & Inventory</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Store Timezone
                  </label>
                  <input
                    type="text"
                    list="timezone-options"
                    value={settingsData.timezone || settingsData.store_details?.timezone || "Asia/Kolkata"}
                    onChange={(e) => setSettingsData({ ...settingsData, timezone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <datalist id="timezone-options">
                    <option value="Asia/Kolkata" />
                    <option value="Asia/Dubai" />
                    <option value="Asia/Singapore" />
                    <option value="UTC" />
                  </datalist>
                  <p className="mt-1 text-[10px] text-slate-400">Drives dashboard "today", GST periods and bills dates.</p>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Offline Sign-in Grace (Hours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={settingsData.security?.offlineGraceHours ?? 72}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        security: { ...settingsData.security, offlineGraceHours: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Max Failed Logins
                  </label>
                  <input
                    type="number"
                    min={3}
                    value={settingsData.security?.maxFailedLogins ?? 5}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        security: { ...settingsData.security, maxFailedLogins: Number(e.target.value) },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl font-mono border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Multi-Counter Login Roles
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. manager, store_owner (blank = one active counter for everyone)"
                    value={(settingsData.security?.allowMultiCounterRoles || []).join(", ")}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        security: {
                          ...settingsData.security,
                          allowMultiCounterRoles: e.target.value
                            .split(",")
                            .map((r) => r.trim().toLowerCase())
                            .filter(Boolean),
                        },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <label className="flex items-center gap-2 self-end pb-2 font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(settingsData.batch_required)}
                    onChange={(e) => setSettingsData({ ...settingsData, batch_required: e.target.checked })}
                    className="rounded border-slate-300 text-brand-600"
                  />
                  <span>Require batch &amp; expiry (pharmacy)</span>
                </label>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            {hasPermission("settings", "edit") && (
              <button
                type="submit"
                className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5"
              >
                <Save className="w-4 h-4" />
                <span>Save System Settings</span>
              </button>
            )}
          </div>
        </form>
      )}

      {/* WhatsApp Gateway (OpenWA) Settings */}
      {activeTab === "whatsapp" && settingsData && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="p-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 rounded-xl">
                    <MessageSquare className="w-5 h-5" />
                  </span>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                      OpenWA WhatsApp Gateway Dispatch
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Automated electronic invoice dispatch via self-hosted OpenWA REST service.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestWhatsAppConnection}
                  disabled={isTestingWhatsApp}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isTestingWhatsApp ? "animate-spin" : ""}`} />
                  <span>{isTestingWhatsApp ? "Verifying..." : "Test Connection"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRotateSecretType("whatsapp_api_key")}
                  className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-sm"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Set / Rotate API Key</span>
                </button>
              </div>
            </div>

            {/* Test Feedback Notice */}
            {whatsAppTestFeedback && (
              <div
                className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 ${
                  whatsAppTestFeedback.success
                    ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                    : "bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300"
                }`}
              >
                {whatsAppTestFeedback.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                )}
                <span className="font-medium">{whatsAppTestFeedback.message}</span>
              </div>
            )}

            {/* Configuration Form */}
            <form onSubmit={handleSaveWhatsApp} className="space-y-6 text-xs">
              {/* Enabled Switch */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    Enable WhatsApp Invoice Dispatch
                  </div>
                  <div className="text-[11px] text-slate-500">
                    When enabled, the POS billing screen and Bills explorer will display automated WhatsApp bill dispatch options.
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsData.whatsapp?.enabled ?? false}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        whatsapp: {
                          ...(settingsData.whatsapp || {}),
                          enabled: e.target.checked,
                        },
                      })
                    }
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Server URL */}
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    OpenWA Server Gateway URL *
                  </label>
                  <input
                    type="url"
                    required
                    value={settingsData.whatsapp?.api_url || "https://wa-api.alverstone.in"}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        whatsapp: {
                          ...(settingsData.whatsapp || {}),
                          api_url: e.target.value,
                        },
                      })
                    }
                    placeholder="https://wa-api.alverstone.in"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Your deployed OpenWA REST server endpoint.
                  </p>
                </div>

                {/* Session Selector */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-medium text-slate-700 dark:text-slate-300">
                      OpenWA Active Session *
                    </label>
                    <button
                      type="button"
                      onClick={handleFetchSessions}
                      disabled={isFetchingSessions}
                      className="text-[11px] text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1 disabled:opacity-50"
                    >
                      <RotateCw className={`w-3 h-3 ${isFetchingSessions ? "animate-spin" : ""}`} />
                      <span>{isFetchingSessions ? "Fetching..." : "Fetch Sessions"}</span>
                    </button>
                  </div>

                  {availableSessions.length > 0 ? (
                    <select
                      value={settingsData.whatsapp?.session_id || "default"}
                      onChange={(e) =>
                        setSettingsData({
                          ...settingsData,
                          whatsapp: {
                            ...(settingsData.whatsapp || {}),
                            session_id: e.target.value,
                          },
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    >
                      {availableSessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.id}) - [{s.status}]
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={settingsData.whatsapp?.session_id || "default"}
                      onChange={(e) =>
                        setSettingsData({
                          ...settingsData,
                          whatsapp: {
                            ...(settingsData.whatsapp || {}),
                            session_id: e.target.value,
                          },
                        })
                      }
                      placeholder="default"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                    />
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    WhatsApp session identifier configured in OpenWA. Click "Fetch Sessions" to populate active sessions from the server.
                  </p>
                </div>
              </div>

              {/* API Key Display & Quick Rotate */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-emerald-600" />
                      <span>OpenWA Operator / Admin API Key</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Current Key: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.whatsapp?.api_key || "••••••••••••"}</code>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRotateSecretType("whatsapp_api_key")}
                    className="px-3 py-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-1 shadow-2xs"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Change API Key</span>
                  </button>
                </div>
              </div>

              {/* Behavior & Dispatch Options */}
              <div className="space-y-3 pt-2">
                <div className="font-bold text-slate-900 dark:text-white">
                  Dispatch Preferences
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/20">
                  <input
                    type="checkbox"
                    id="wa_send_pdf"
                    checked={settingsData.whatsapp?.send_pdf ?? true}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        whatsapp: {
                          ...(settingsData.whatsapp || {}),
                          send_pdf: e.target.checked,
                        },
                      })
                    }
                    className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="wa_send_pdf" className="cursor-pointer">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Attach High-Resolution PDF Invoice
                    </div>
                    <div className="text-[11px] text-slate-500">
                      When checked, OpenWA sends the rendered vector PDF invoice document alongside the formatted text summary.
                    </div>
                  </label>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/20">
                  <input
                    type="checkbox"
                    id="wa_auto_send"
                    checked={settingsData.whatsapp?.auto_send_on_save ?? false}
                    onChange={(e) =>
                      setSettingsData({
                        ...settingsData,
                        whatsapp: {
                          ...(settingsData.whatsapp || {}),
                          auto_send_on_save: e.target.checked,
                        },
                      })
                    }
                    className="mt-0.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="wa_auto_send" className="cursor-pointer">
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      Auto-Send on Bill Finalization
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Automatically dispatch the invoice to the customer's WhatsApp upon POS sale completion whenever a valid phone number is entered.
                    </div>
                  </label>
                </div>
              </div>

              {/* Custom Caption */}
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Custom Message / Caption Template (Optional)
                </label>
                <textarea
                  rows={3}
                  value={settingsData.whatsapp?.custom_caption || ""}
                  onChange={(e) =>
                    setSettingsData({
                      ...settingsData,
                      whatsapp: {
                        ...(settingsData.whatsapp || {}),
                        custom_caption: e.target.value,
                      },
                    })
                  }
                  placeholder="Thank you for shopping with {store_name}! Your invoice #{invoice_no} for {grand_total} is attached."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Available tags: <code>{"{invoice_no}"}</code>, <code>{"{store_name}"}</code>, <code>{"{grand_total}"}</code>, <code>{"{date}"}</code>. Leave blank for default summary.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={isSavingWhatsApp}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{isSavingWhatsApp ? "Saving..." : "Save WhatsApp Settings"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Masked Secrets & Credentials */}
      {activeTab === "secrets" && settingsData && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Secret Masking & Key Rotation Protection
              </h3>
              <p className="text-[11px] text-slate-400">
                Passwords and access tokens are strictly masked on the wire and never exposed in plain text.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {/* SMTP Secret */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                  <Mail className="w-4 h-4 text-brand-600" />
                  <span>SMTP Outbound Email Relay</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Host: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.smtp?.host}</code> |
                  User: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.smtp?.username}</code> |
                  Password: <code className="font-mono text-slate-400">{settingsData.smtp?.password}</code>
                </div>
              </div>
              <button
                onClick={() => setRotateSecretType("smtp_password")}
                className="px-3 py-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-1 shadow-2xs"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Rotate Password</span>
              </button>
            </div>

            {/* SMS Gateway Secret */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-purple-600" />
                  <span>Transactional SMS Gateway (Fast2SMS / MSG91)</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Provider: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.sms?.provider}</code> |
                  API Key: <code className="font-mono text-slate-400">{settingsData.sms?.api_key}</code>
                </div>
              </div>
              <button
                onClick={() => setRotateSecretType("sms_api_key")}
                className="px-3 py-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-1 shadow-2xs"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Rotate API Key</span>
              </button>
            </div>

            {/* WhatsApp OpenWA Secret */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-600" />
                  <span>WhatsApp Gateway (OpenWA) API Key</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Host: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.whatsapp?.api_url || "https://wa-api.alverstone.in"}</code> |
                  Session: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.whatsapp?.session_id || "default"}</code> |
                  API Key: <code className="font-mono text-slate-400">{settingsData.whatsapp?.api_key || "Not configured"}</code>
                </div>
              </div>
              <button
                onClick={() => setRotateSecretType("whatsapp_api_key")}
                className="px-3 py-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-1 shadow-2xs"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Rotate / Set API Key</span>
              </button>
            </div>

            {/* Webhook Signing Secret */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
              <div>
                <div className="font-bold text-slate-900 dark:text-white text-xs flex items-center gap-2">
                  <Webhook className="w-4 h-4 text-amber-600" />
                  <span>Webhook Signing Secret</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Endpoint: <code className="font-mono text-slate-700 dark:text-slate-300">{settingsData.webhook?.url || "Not configured"}</code> |
                  Secret: <code className="font-mono text-slate-400">{settingsData.webhook?.has_secret ? settingsData.webhook?.secret : "Not configured"}</code>
                </div>
              </div>
              <button
                onClick={() => setRotateSecretType("webhook_secret")}
                className="px-3 py-1.5 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg text-xs font-bold hover:opacity-90 flex items-center gap-1 shadow-2xs"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Rotate Secret</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Webhooks & Event Outbox */}
      {activeTab === "webhooks" && settingsData && (
        <div className="space-y-6">
          <form onSubmit={handleSaveWebhook} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-5">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                  <Webhook className="w-4 h-4 text-brand-600" />
                  <span>Signed Webhook Endpoint</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Events are persisted to a durable outbox and retried with backoff. Every delivery carries an
                  HMAC-SHA256 signature over <code className="font-mono">timestamp.body</code>.
                </p>
              </div>
              <span
                className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                  webhookEndpointLive
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                }`}
              >
                {webhookEndpointLive ? "Endpoint Active" : "Not Configured"}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Endpoint URL</label>
                <input
                  type="url"
                  placeholder="https://your-system.example/webhooks/lamsuite"
                  value={settingsData.webhook?.url || ""}
                  onChange={(e) =>
                    setSettingsData((prev: any) => ({
                      ...prev,
                      webhook: { ...(prev?.webhook || {}), url: e.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Signing Secret</label>
                <input
                  type="text"
                  value={settingsData.webhook?.secret || ""}
                  onChange={(e) =>
                    setSettingsData((prev: any) => ({
                      ...prev,
                      webhook: { ...(prev?.webhook || {}), secret: e.target.value },
                    }))
                  }
                  placeholder="Enter a new secret to replace the stored one"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Leave the masked value untouched to keep the current secret.
                </p>
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">Request Timeout (seconds)</label>
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={settingsData.webhook?.timeout ?? 10}
                  onChange={(e) =>
                    setSettingsData((prev: any) => ({
                      ...prev,
                      webhook: { ...(prev?.webhook || {}), timeout: Number(e.target.value) },
                    }))
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={Boolean(settingsData.webhook?.enabled)}
                    onChange={(e) =>
                      setSettingsData((prev: any) => ({
                        ...prev,
                        webhook: { ...(prev?.webhook || {}), enabled: e.target.checked },
                      }))
                    }
                    className="rounded border-slate-300"
                  />
                  <span>Enable webhook delivery</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-2 text-xs">Subscribed Events</label>
              <div className="flex flex-wrap gap-2">
                {WEBHOOK_EVENTS.map((evt) => {
                  const active = (settingsData.webhook?.events || []).includes(evt.id);
                  return (
                    <button
                      type="button"
                      key={evt.id}
                      onClick={() => toggleWebhookEvent(evt.id)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
                        active
                          ? "bg-brand-50 border-brand-300 text-brand-700 dark:bg-brand-900/30 dark:border-brand-700 dark:text-brand-300"
                          : "bg-white border-slate-200 text-slate-500 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-400"
                      }`}
                    >
                      {evt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="submit"
                disabled={isSavingWebhook}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg text-xs font-bold hover:bg-brand-700 disabled:opacity-50 flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingWebhook ? "Saving..." : "Save Webhook Config"}</span>
              </button>
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={isTestingWebhook || !webhookEndpointLive}
                className="px-4 py-2 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-lg text-xs font-bold hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingWebhook ? "animate-spin" : ""}`} />
                <span>{isTestingWebhook ? "Sending..." : "Send Test Event"}</span>
              </button>
              {webhookTestFeedback && (
                <span
                  className={`text-[11px] font-semibold flex items-center gap-1 ${
                    webhookTestFeedback.success ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {webhookTestFeedback.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  {webhookTestFeedback.message}
                </span>
              )}
            </div>
          </form>

          {/* Delivery Log */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">Delivery Log</h3>
                <div className="flex items-center gap-2 mt-1 text-[10px] font-semibold">
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    Pending {webhookSummary?.pending ?? 0}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    Delivered {webhookSummary?.delivered ?? 0}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
                    Failed {webhookSummary?.failed ?? 0}
                  </span>
                </div>
              </div>
              <select
                value={webhookStatusFilter}
                onChange={(e) => setWebhookStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
              >
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="delivered">Delivered</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-4 py-2 font-semibold">Event</th>
                    <th className="text-left px-4 py-2 font-semibold">Object</th>
                    <th className="text-left px-4 py-2 font-semibold">Status</th>
                    <th className="text-left px-4 py-2 font-semibold">Attempts</th>
                    <th className="text-left px-4 py-2 font-semibold">Last Error</th>
                    <th className="text-left px-4 py-2 font-semibold">Created</th>
                    <th className="text-right px-4 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {webhookDeliveries.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                        No webhook deliveries recorded for this store yet.
                      </td>
                    </tr>
                  )}
                  {webhookDeliveries.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2 font-mono font-semibold text-slate-800 dark:text-slate-200">{row.event}</td>
                      <td className="px-4 py-2 text-slate-500">
                        {row.object_type ? `${row.object_type} #${row.object_id ?? "-"}` : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            row.status === "delivered"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                              : row.status === "failed"
                              ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {row.attempts}
                        {row.response_status ? ` · HTTP ${row.response_status}` : ""}
                      </td>
                      <td className="px-4 py-2 text-slate-500 max-w-[220px] truncate" title={row.last_error || ""}>
                        {row.last_error || "—"}
                      </td>
                      <td className="px-4 py-2 text-slate-500">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-2 text-right">
                        {hasPermission("settings", "edit") && row.status !== "delivered" && (
                          <button
                            onClick={() => handleRetryDelivery(row.id)}
                            disabled={retryingDeliveryId === row.id}
                            className="px-2.5 py-1 rounded-md bg-slate-900 text-white dark:bg-white dark:text-slate-900 text-[10px] font-bold hover:opacity-90 disabled:opacity-50"
                          >
                            {retryingDeliveryId === row.id ? "Retrying..." : "Retry"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Financial Years Closing */}
      {activeTab === "financial_years" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Financial Years & Year-End Closing
            </h3>
            <p className="text-[11px] text-slate-400">
              Locked financial years prohibit backdated sales or inward stock entries.
            </p>
          </div>
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Year Code</th>
                <th className="px-4 py-3">Date Period</th>
                <th className="px-4 py-3 text-center">Lock Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {financialYears.map((fy) => (
                <tr key={fy.id}>
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{fy.year_code}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatDate(fy.start_date)} to {formatDate(fy.end_date)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        fy.is_locked ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {fy.is_locked ? "LOCKED" : "OPEN / ACTIVE"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleFyLock(fy.id)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold text-white shadow-2xs ${
                        fy.is_locked ? "bg-amber-600 hover:bg-amber-500" : "bg-red-600 hover:bg-red-500"
                      }`}
                    >
                      {fy.is_locked ? "Unlock Year" : "Lock Year"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* GST Period Locking */}
      {activeTab === "gst_locks" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Monthly GST Period Locks (GSTR-1 Statutory Lock)
              </h3>
              <p className="text-[11px] text-slate-400">
                Invoices falling in a locked GST period cannot be modified or cancelled.
              </p>
            </div>
          </div>
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Return Month</th>
                <th className="px-4 py-3 text-center">Statutory Lock</th>
                <th className="px-4 py-3 text-right">Lock / Unlock Toggle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
              {gstPeriods.map((gp) => (
                <tr key={gp.id}>
                  <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{gp.period_month}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        gp.is_locked
                          ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                      }`}
                    >
                      {gp.is_locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                      <span>{gp.is_locked ? "Period Locked" : "Period Unlocked"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleGstLock(gp.period_month, gp.is_locked)}
                      className={`px-3 py-1 rounded-lg text-[10px] font-bold text-white shadow-2xs ${
                        gp.is_locked ? "bg-amber-600 hover:bg-amber-500" : "bg-red-600 hover:bg-red-500"
                      }`}
                    >
                      {gp.is_locked ? "Unlock Period" : "Lock Period"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Disaster Recovery Snapshots */}
      {activeTab === "backups" && backups && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Database Snapshots</h3>
              <p className="text-[11px] text-slate-400">
                {backups.restricted
                  ? "Central snapshots are restricted to the super administrator."
                  : `${backups.schedule?.text || "Not scheduled"} • ${backups.retention_days}-day retention • ${backups.driver?.toUpperCase()}`}
              </p>
            </div>
            {!backups.restricted && (
              <button
                onClick={handleCreateBackup}
                disabled={backupBusy === "create" || !backups.can_create}
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded-lg font-bold text-xs flex items-center gap-1.5 shadow-2xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${backupBusy === "create" ? "animate-spin" : ""}`} />
                <span>Create Snapshot</span>
              </button>
            )}
          </div>

          {backupNotice && (
            <div
              className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                backupNotice.kind === "ok"
                  ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400"
              }`}
            >
              {backupNotice.kind === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              <span>{backupNotice.text}</span>
            </div>
          )}

          {backups.restricted ? (
            <p className="text-xs text-slate-500">
              Ask a super administrator to create, download or restore central database snapshots.
            </p>
          ) : !backups.can_create ? (
            <p className="text-xs text-slate-500">
              Automated snapshots are only configured for SQLite. Use the native database dump tooling for this driver.
            </p>
          ) : backups.backups?.length === 0 ? (
            <p className="text-xs text-slate-500">No snapshots yet. Create one before your next risky change.</p>
          ) : (
            <div className="space-y-3">
              {backups.backups?.map((bp: any) => (
                <div
                  key={bp.id}
                  className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 dark:text-white font-mono truncate">{bp.filename}</div>
                    <div className="text-[11px] text-slate-500">
                      {formatDate(bp.created_at || bp.finished_at)}
                      {" • "}
                      {(bp.size_bytes / 1024 / 1024).toFixed(2)} MB
                      {" • "}
                      <span className="uppercase tracking-wide">{bp.kind.replace("_", " ")}</span>
                      {bp.creator_name ? ` • ${bp.creator_name}` : ""}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono truncate">
                      sha256 {bp.sha256 ? `${bp.sha256.slice(0, 16)}…` : "n/a"}
                      {!bp.exists && <span className="text-red-500"> • file missing</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadBackup(bp)}
                      disabled={!bp.exists || backupBusy === `download-${bp.id}`}
                      className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => {
                        setRestoreTarget(bp);
                        setRestoreConfirm("");
                        setBackupNotice(null);
                      }}
                      disabled={!backups.can_restore || !bp.exists}
                      className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Restore</span>
                    </button>
                    <button
                      onClick={() => handleDeleteBackup(bp)}
                      disabled={backupBusy === `delete-${bp.id}`}
                      className="px-2.5 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg font-bold disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Restore confirmation modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span>Restore Database Snapshot</span>
              </h3>
              <button
                onClick={() => setRestoreTarget(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              This replaces the live database with <span className="font-mono font-bold">{restoreTarget.filename}</span>.
              A pre-restore snapshot is taken automatically first, but any changes made after this snapshot will be lost.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                Type the filename to confirm
              </label>
              <input
                value={restoreConfirm}
                onChange={(e) => setRestoreConfirm(e.target.value)}
                placeholder={restoreTarget.filename}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setRestoreTarget(null)}
                className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleRestoreBackup}
                disabled={restoreConfirm.trim() !== restoreTarget.filename || backupBusy === "restore"}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-xs font-bold"
              >
                {backupBusy === "restore" ? "Restoring…" : "Restore Snapshot"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotate Secret Modal */}
      {rotateSecretType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-brand-600" />
                <span>
                  {rotateSecretType === "whatsapp_api_key"
                    ? "Set OpenWA WhatsApp API Key"
                    : `Rotate Secret: ${rotateSecretType}`}
                </span>
              </h3>
              <button
                onClick={() => setRotateSecretType(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRotateSecretSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Secret Credential Value *
                </label>
                <input
                  type="password"
                  required
                  minLength={4}
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  placeholder={
                    rotateSecretType === "whatsapp_api_key"
                      ? "Paste OpenWA API key from dashboard"
                      : "Enter new strong secret"
                  }
                  className="w-full px-3 py-2 font-mono rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRotateSecretType(null)}
                  className="px-3.5 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Commit Rotation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
