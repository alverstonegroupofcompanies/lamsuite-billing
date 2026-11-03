import React, { useEffect, useState } from "react";
import { api } from "../services/api";
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
} from "lucide-react";

export const SettingsPage: React.FC = () => {
  const { activeStore, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<"general" | "whatsapp" | "secrets" | "financial_years" | "gst_locks" | "backups">("general");

  const [settingsData, setSettingsData] = useState<any>(null);
  const [financialYears, setFinancialYears] = useState<any[]>([]);
  const [gstPeriods, setGstPeriods] = useState<any[]>([]);
  const [backups, setBackups] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // WhatsApp OpenWA Integration state
  const [availableSessions, setAvailableSessions] = useState<{ id: string; name: string; status: string }[]>([]);
  const [isFetchingSessions, setIsFetchingSessions] = useState(false);
  const [isTestingWhatsApp, setIsTestingWhatsApp] = useState(false);
  const [whatsAppTestFeedback, setWhatsAppTestFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [isSavingWhatsApp, setIsSavingWhatsApp] = useState(false);

  // Rotate Secret Modal
  const [rotateSecretType, setRotateSecretType] = useState<string | null>(null);
  const [newSecretValue, setNewSecretValue] = useState("");

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "general" || activeTab === "secrets" || activeTab === "whatsapp") {
        const res = await api.get("/admin/settings");
        setSettingsData(res);
      } else if (activeTab === "financial_years") {
        const res = await api.get("/admin/settings/financial-years");
        setFinancialYears(res || []);
      } else if (activeTab === "gst_locks") {
        const res = await api.get("/admin/settings/gst-periods");
        setGstPeriods(res || []);
      } else if (activeTab === "backups") {
        const res = await api.get("/admin/settings/backup-restore");
        setBackups(res);
      }
    } catch (err) {
      console.error("Failed to load settings:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [activeTab, activeStore]);

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

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/admin/settings", {
        billing: settingsData.billing,
        sequences: settingsData.sequences,
        printing: settingsData.printing,
        wallet: settingsData.wallet,
        whatsapp: settingsData.whatsapp,
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
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl shadow-sm flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>Save System Settings</span>
            </button>
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
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Disaster Recovery Points</h3>
              <p className="text-[11px] text-slate-400">Automated schedule: {backups.auto_backup_schedule}</p>
            </div>
          </div>

          <div className="space-y-3">
            {backups.restore_points?.map((bp: any) => (
              <div
                key={bp.id}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">{bp.label}</div>
                  <div className="text-[11px] text-slate-500">
                    Created: {bp.timestamp} • Size: {(bp.size_bytes / 1024 / 1024).toFixed(2)} MB
                  </div>
                </div>
                <button
                  onClick={() => alert(`Downloading disaster snapshot ${bp.id}.tar.gz`)}
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-bold flex items-center gap-1.5 shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Backup</span>
                </button>
              </div>
            ))}
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
