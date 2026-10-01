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
} from "lucide-react";

export const SettingsPage: React.FC = () => {
  const { activeStore, hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<"general" | "secrets" | "financial_years" | "gst_locks" | "backups">("general");

  const [settingsData, setSettingsData] = useState<any>(null);
  const [financialYears, setFinancialYears] = useState<any[]>([]);
  const [gstPeriods, setGstPeriods] = useState<any[]>([]);
  const [backups, setBackups] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Rotate Secret Modal
  const [rotateSecretType, setRotateSecretType] = useState<string | null>(null);
  const [newSecretValue, setNewSecretValue] = useState("");

  const fetchSettings = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "general" || activeTab === "secrets") {
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

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/admin/settings", {
        billing: settingsData.billing,
        sequences: settingsData.sequences,
        printing: settingsData.printing,
        wallet: settingsData.wallet,
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
                <span>Rotate Secret: {rotateSecretType}</span>
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
                  minLength={8}
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                  placeholder="Enter new strong secret"
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
