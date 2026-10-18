import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatDateTime } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { ConfirmModal } from "../components/ConfirmModal";
import {
  Cpu,
  RefreshCw,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCw,
  Sliders,
  MapPin,
  Lock,
  Printer,
  FileSpreadsheet,
  AlertTriangle,
} from "lucide-react";

export interface CounterItem {
  id: number;
  counter_code: string;
  counter_name: string;
  location_name: string;
  is_remote: boolean;
  is_digital_only: boolean;
  status: "active" | "pending_approval" | "revoked" | "locked";
  device_uuid: string;
  ip_address: string;
  last_seen_at: string;
  last_sync_at: string;
  is_online: boolean;
  role_profile?: {
    allow_cancel?: boolean;
    allow_price_change?: boolean;
    allow_stock_adj?: boolean;
    require_manager_pin?: boolean;
  };
  manager_pin?: string;
  printer_profile?: {
    type?: string;
    paper_size?: string;
    copies?: number;
  };
  sequences?: Array<{
    id: number;
    doc_type: string;
    financial_year: string;
    prefix: string;
    next_number: number;
  }>;
}

export const DevicesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [counters, setCounters] = useState<CounterItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [activeTab, setActiveTab] = useState<"counters" | "negative_stock">("counters");
  const [negativeReport, setNegativeReport] = useState<any>(null);

  const [selectedCounter, setSelectedCounter] = useState<CounterItem | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    location_name: "",
    is_digital_only: false,
    allow_cancel: false,
    allow_price_change: false,
    allow_stock_adj: false,
    require_manager_pin: false,
    manager_pin: "",
    printer_type: "thermal_80mm",
  });

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    counter: CounterItem | null;
    action: "approve" | "revoke";
  }>({ isOpen: false, counter: null, action: "revoke" });

  const fetchCounters = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ success: boolean; counters: CounterItem[] }>("/counters");
      setCounters(res.counters || []);
    } catch (err) {
      console.error("Failed to load counters:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNegativeStock = async () => {
    try {
      const res = await api.get<any>("/inventory/negative-stock-report");
      setNegativeReport(res);
    } catch (err) {
      console.error("Failed to load negative stock report:", err);
    }
  };

  useEffect(() => {
    fetchCounters();
    fetchNegativeStock();
  }, []);

  const handleStatusChange = async (reason: string) => {
    const { counter, action } = confirmModal;
    if (!counter) return;

    try {
      const newStatus = action === "approve" ? "active" : "revoked";
      await api.post(`/admin/counters/${counter.id}/status`, {
        status: newStatus,
        revoke_reason: reason,
      });
      await fetchCounters();
    } catch (err: any) {
      alert(err?.message || "Failed to update counter status.");
    }
  };

  const openSettings = (c: CounterItem) => {
    setSelectedCounter(c);
    setSettingsForm({
      location_name: c.location_name || "",
      is_digital_only: Boolean(c.is_digital_only),
      allow_cancel: Boolean(c.role_profile?.allow_cancel),
      allow_price_change: Boolean(c.role_profile?.allow_price_change),
      allow_stock_adj: Boolean(c.role_profile?.allow_stock_adj),
      require_manager_pin: Boolean(c.role_profile?.require_manager_pin),
      manager_pin: c.manager_pin || "",
      printer_type: c.printer_profile?.type || "thermal_80mm",
    });
    setIsSettingsModalOpen(true);
  };

  const saveSettings = async () => {
    if (!selectedCounter) return;
    try {
      await api.post(`/admin/counters/${selectedCounter.id}/settings`, {
        location_name: settingsForm.location_name,
        is_digital_only: settingsForm.is_digital_only,
        role_profile: {
          allow_cancel: settingsForm.allow_cancel,
          allow_price_change: settingsForm.allow_price_change,
          allow_stock_adj: settingsForm.allow_stock_adj,
          require_manager_pin: settingsForm.require_manager_pin,
        },
        manager_pin: settingsForm.manager_pin,
        printer_profile: {
          type: settingsForm.printer_type,
          auto_print: true,
        },
      });
      setIsSettingsModalOpen(false);
      await fetchCounters();
      alert(`Settings saved for counter ${selectedCounter.counter_code}.`);
    } catch (err: any) {
      alert(err?.message || "Failed to update settings.");
    }
  };

  const filteredCounters = counters.filter((c) => {
    const matchesSearch =
      c.counter_name.toLowerCase().includes(search.toLowerCase()) ||
      c.counter_code.toLowerCase().includes(search.toLowerCase()) ||
      (c.location_name && c.location_name.toLowerCase().includes(search.toLowerCase())) ||
      c.device_uuid?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Remote Counters & Device Enrollment
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Enroll shop & remote home counters, allocate document number series, configure role profiles, and monitor real-time sync.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab("counters")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === "counters"
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            Counters & Devices ({counters.length})
          </button>
          <button
            onClick={() => {
              setActiveTab("negative_stock");
              fetchNegativeStock();
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === "negative_stock"
                ? "bg-amber-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            Negative Stock Reconciliation ({negativeReport?.negative_batches_count || 0})
          </button>
        </div>
      </div>

      {activeTab === "counters" && (
        <>
          {/* GST Notice Banner */}
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-2xl p-3.5 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">GST Compliance & Additional Place of Business:</span>
              <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/80 text-[11px]">
                Under Section 22/24 of the CGST Act, operating a remote billing counter from an owner's residence or secondary premises may require declaration as an
                <strong> "Additional Place of Business" (APOB)</strong> on the GST portal (Form GST REG-14). Confirm with your Chartered Accountant (CA) before issuing legal tax invoices from remote premises.
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search counter name, code, location, UUID..."
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-700 dark:text-slate-300 focus:outline-hidden"
              >
                <option value="">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="revoked">Revoked</option>
              </select>

              <button
                onClick={fetchCounters}
                className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Counters Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Counter / Location</th>
                    <th className="px-4 py-3">Type & Features</th>
                    <th className="px-4 py-3">Number Series</th>
                    <th className="px-4 py-3">Heartbeat / IP</th>
                    <th className="px-4 py-3 text-center">Live State</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        Loading counters...
                      </td>
                    </tr>
                  ) : filteredCounters.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        No counters found.
                      </td>
                    </tr>
                  ) : (
                    filteredCounters.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                            <span className="font-mono bg-brand-50 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 px-1.5 py-0.5 rounded text-[11px]">
                              {c.counter_code}
                            </span>
                            <span>{c.counter_name}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {c.location_name || "Unspecified Location"}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.is_remote ? 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                              {c.is_remote ? "Remote Counter" : "In-Store POS"}
                            </span>
                            {c.is_digital_only && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                Digital Only
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          {c.sequences && c.sequences.length > 0 ? (
                            c.sequences.map((s) => (
                              <div key={s.id} className="text-slate-700 dark:text-slate-300">
                                {s.prefix}-{s.next_number}
                              </div>
                            ))
                          ) : (
                            <span className="text-slate-400 italic">Default series</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400">{c.ip_address || "127.0.0.1"}</div>
                          <div className="text-[10px] text-slate-400">{c.last_seen_at ? formatDateTime(c.last_seen_at) : "Never"}</div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                c.status === "active"
                                  ? c.is_online
                                    ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
                                  : c.status === "pending_approval"
                                  ? "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
                                  : "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400"
                              }`}
                            >
                              {c.status === "active" && (c.is_online ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />)}
                              {c.status === "pending_approval" && <Clock className="w-3 h-3" />}
                              {c.status === "revoked" && <XCircle className="w-3 h-3" />}
                              <span>{c.status === "active" ? (c.is_online ? "Online" : "Offline") : c.status === "pending_approval" ? "Pending Approval" : "Revoked"}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openSettings(c)}
                              title="Counter Settings & Permissions"
                              className="p-1.5 text-slate-500 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                            >
                              <Sliders className="w-3.5 h-3.5" />
                            </button>

                            {c.status === "pending_approval" && (
                              <button
                                onClick={() => setConfirmModal({ isOpen: true, counter: c, action: "approve" })}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[10px]"
                              >
                                Approve
                              </button>
                            )}

                            {c.status === "active" && (
                              <button
                                onClick={() => setConfirmModal({ isOpen: true, counter: c, action: "revoke" })}
                                className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-[10px]"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "negative_stock" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Negative Stock Reconciliation Register</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Identifies product batches whose delta merges produced deficit stock across concurrent offline counters.
              </p>
            </div>
            <button
              onClick={fetchNegativeStock}
              className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 rounded-xl hover:bg-slate-100"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2.5">Product Name</th>
                  <th className="px-4 py-2.5">Batch No</th>
                  <th className="px-4 py-2.5 text-right">Reconciled Stock</th>
                  <th className="px-4 py-2.5 text-right">Deficit Qty</th>
                  <th className="px-4 py-2.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(!negativeReport?.negative_batches || negativeReport.negative_batches.length === 0) ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-emerald-600 dark:text-emerald-400 font-semibold">
                      ✓ No negative stock discrepancies detected across counters. All physical batches balance positively.
                    </td>
                  </tr>
                ) : (
                  negativeReport.negative_batches.map((b: any) => (
                    <tr key={b.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">
                        {b.product?.name || "Product #" + b.product_id}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[11px]">{b.batch_no}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600 dark:text-red-400">
                        {b.stock_qty}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-red-600">
                        {Math.abs(Number(b.stock_qty))}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                          Deficit Flagged
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsModalOpen && selectedCounter && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Counter Settings: {selectedCounter.counter_name} ({selectedCounter.counter_code})
                </h3>
                <p className="text-[11px] text-slate-500">Configure permissions, security, and hardware profile</p>
              </div>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Location Name</label>
                <input
                  type="text"
                  value={settingsForm.location_name}
                  onChange={(e) => setSettingsForm({ ...settingsForm, location_name: e.target.value })}
                  placeholder="e.g. Shop Floor, Owner Residence, Warehouse"
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="block font-semibold text-slate-700 dark:text-slate-300">Counter Permissions Profile</label>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.allow_cancel}
                    onChange={(e) => setSettingsForm({ ...settingsForm, allow_cancel: e.target.checked })}
                    className="rounded text-brand-600"
                  />
                  <span>Allow Bill Cancellation at this counter</span>
                </label>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.allow_price_change}
                    onChange={(e) => setSettingsForm({ ...settingsForm, allow_price_change: e.target.checked })}
                    className="rounded text-brand-600"
                  />
                  <span>Allow Price & Rate Changes at billing time</span>
                </label>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.allow_stock_adj}
                    onChange={(e) => setSettingsForm({ ...settingsForm, allow_stock_adj: e.target.checked })}
                    className="rounded text-brand-600"
                  />
                  <span>Allow Stock Adjustments & Write-Offs</span>
                </label>
                <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settingsForm.is_digital_only}
                    onChange={(e) => setSettingsForm({ ...settingsForm, is_digital_only: e.target.checked })}
                    className="rounded text-brand-600"
                  />
                  <span>Mark Digital-Only (No cash drawer or physical cash float)</span>
                </label>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Manager Security PIN</label>
                <input
                  type="password"
                  value={settingsForm.manager_pin}
                  onChange={(e) => setSettingsForm({ ...settingsForm, manager_pin: e.target.value })}
                  placeholder="Optional 4-digit PIN for privileged actions"
                  maxLength={6}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Printer Profile</label>
                <select
                  value={settingsForm.printer_type}
                  onChange={(e) => setSettingsForm({ ...settingsForm, printer_type: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="thermal_80mm">3-inch Thermal POS Printer (80mm)</option>
                  <option value="thermal_58mm">2-inch Thermal POS Printer (58mm)</option>
                  <option value="a4_laser">Laser / Inkjet A4 Receipt</option>
                  <option value="pdf_whatsapp">Digital PDF Only (WhatsApp / Email)</option>
                </select>
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={saveSettings}
                className="px-3 py-1.5 text-xs font-bold text-white bg-brand-600 hover:bg-brand-500 rounded-xl"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={handleStatusChange}
        title={
          confirmModal.action === "revoke"
            ? `Revoke Counter: ${confirmModal.counter?.counter_name}`
            : `Approve Counter: ${confirmModal.counter?.counter_name}`
        }
        message={
          confirmModal.action === "revoke"
            ? "Revoking counter access will immediately terminate its offline sync privileges and invalidate its bearer authentication keys. A mandatory reason is recorded in the audit log."
            : "Approving this counter will activate its bidirectional synchronization capabilities and assign document number series."
        }
        danger={confirmModal.action === "revoke"}
        confirmText={confirmModal.action === "revoke" ? "Confirm Revocation" : "Approve Counter"}
        requireReason={true}
      />
    </div>
  );
};
