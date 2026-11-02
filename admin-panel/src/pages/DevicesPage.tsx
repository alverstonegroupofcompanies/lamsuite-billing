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
  Unlock,
  Printer,
  FileSpreadsheet,
  AlertTriangle,
  Laptop,
  PowerOff,
  Edit2,
  Trash2,
  Layers,
  Activity,
  Filter,
} from "lucide-react";

export interface DeviceSessionItem {
  id: string;
  session_id?: string;
  device_uuid?: string;
  device_name: string;
  counter_name: string;
  counter_code?: string;
  user_name: string;
  user_role: string;
  ip_address: string;
  location: string | null;
  status: "Active" | "Idle" | "Offline" | "Locked" | "Revoked";
  sign_in_time: string | null;
  last_seen: string | null;
  app_version: string;
  is_out_of_date?: boolean;
  min_required_version?: string;
  latest_version?: string;
  unsynced_items_count: number;
  is_active: boolean;
}

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
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionItem[]>([]);
  const [counters, setCounters] = useState<CounterItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [minRequiredVersion, setMinRequiredVersion] = useState<string>("2.0.20");
  const [latestVersion, setLatestVersion] = useState<string>("2.0.20");
  const [outOfDateCount, setOutOfDateCount] = useState<number>(0);
  const [isMinVersionModalOpen, setIsMinVersionModalOpen] = useState<boolean>(false);
  const [newMinVersionInput, setNewMinVersionInput] = useState<string>("2.0.20");

  const [activeTab, setActiveTab] = useState<"logged_in" | "counters" | "negative_stock">("logged_in");
  const [negativeReport, setNegativeReport] = useState<any>(null);

  // Rename Workstation modal
  const [renameSession, setRenameSession] = useState<DeviceSessionItem | null>(null);
  const [renameForm, setRenameForm] = useState({ device_name: "", counter_name: "" });

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

  const fetchDeviceSessions = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{
        success: boolean;
        devices: DeviceSessionItem[];
        min_required_version?: string;
        latest_version?: string;
        out_of_date_count?: number;
      }>("/device-sessions");
      setDeviceSessions(res.devices || []);
      if (res.min_required_version) {
        setMinRequiredVersion(res.min_required_version);
        setNewMinVersionInput(res.min_required_version);
      }
      if (res.latest_version) setLatestVersion(res.latest_version);
      if (typeof res.out_of_date_count === "number") setOutOfDateCount(res.out_of_date_count);
    } catch (err) {
      console.error("Failed to load device sessions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveMinVersion = async () => {
    try {
      await api.post("/admin/settings/min-app-version", { min_version: newMinVersionInput.trim() });
      setIsMinVersionModalOpen(false);
      await fetchDeviceSessions();
      alert(`Minimum desktop app version successfully set to v${newMinVersionInput.trim()}.`);
    } catch (err: any) {
      alert(err?.message || "Failed to update minimum version.");
    }
  };

  const fetchCounters = async () => {
    try {
      const res = await api.get<{ success: boolean; counters: CounterItem[] }>("/counters");
      setCounters(res.counters || []);
    } catch (err) {
      console.error("Failed to load counters:", err);
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
    fetchDeviceSessions();
    fetchCounters();
    fetchNegativeStock();
  }, []);

  const handleForceLogoutSession = async (s: DeviceSessionItem) => {
    if (!window.confirm(`Force log out session for "${s.device_name || s.counter_name}"?`)) return;
    try {
      await api.post(`/device-sessions/${s.id}/force-logout`);
      await fetchDeviceSessions();
    } catch (err: any) {
      alert(err?.message || "Failed to force logout session.");
    }
  };

  const handleToggleLockSession = async (s: DeviceSessionItem) => {
    const isLocked = s.status === "Locked";
    const promptText = isLocked
      ? `Unlock workstation "${s.device_name}"?`
      : `Lock workstation "${s.device_name}"?`;
    if (!window.confirm(promptText)) return;

    try {
      if (isLocked) {
        await api.post(`/device-sessions/${s.id}/unlock`);
      } else {
        await api.post(`/device-sessions/${s.id}/lock`);
      }
      await fetchDeviceSessions();
    } catch (err: any) {
      alert(err?.message || "Lock action failed.");
    }
  };

  const handleRevokeSession = async (s: DeviceSessionItem) => {
    const reason = window.prompt(`Revoke device "${s.device_name}" permanently? Enter reason:`, "Unauthorized device");
    if (reason === null) return;

    try {
      await api.post(`/device-sessions/${s.id}/revoke`, { reason });
      await fetchDeviceSessions();
    } catch (err: any) {
      alert(err?.message || "Failed to revoke device.");
    }
  };

  const handleSaveRename = async () => {
    if (!renameSession) return;
    try {
      await api.post(`/device-sessions/${renameSession.id}/rename`, {
        device_name: renameForm.device_name.trim() || undefined,
        counter_name: renameForm.counter_name.trim() || undefined,
      });
      setRenameSession(null);
      await fetchDeviceSessions();
    } catch (err: any) {
      alert(err?.message || "Failed to rename device.");
    }
  };

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

  const filteredSessions = deviceSessions.filter((s) => {
    const matchesSearch =
      s.device_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.counter_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.user_name?.toLowerCase().includes(search.toLowerCase()) ||
      s.user_role?.toLowerCase().includes(search.toLowerCase()) ||
      s.ip_address?.toLowerCase().includes(search.toLowerCase()) ||
      (s.location && s.location.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus =
      !statusFilter ||
      (statusFilter === "out_of_date" ? Boolean(s.is_out_of_date) : s.status.toLowerCase() === statusFilter.toLowerCase());
    return matchesSearch && matchesStatus;
  });

  const filteredCounters = counters.filter((c) => {
    const matchesSearch =
      c.counter_name.toLowerCase().includes(search.toLowerCase()) ||
      c.counter_code.toLowerCase().includes(search.toLowerCase()) ||
      (c.location_name && c.location_name.toLowerCase().includes(search.toLowerCase())) ||
      c.device_uuid?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const renderStatusBadge = (status: DeviceSessionItem["status"]) => {
    switch (status) {
      case "Active":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        );
      case "Idle":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Idle
          </span>
        );
      case "Locked":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
            <Lock className="w-2.5 h-2.5" />
            Locked
          </span>
        );
      case "Revoked":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
            <XCircle className="w-2.5 h-2.5" />
            Revoked
          </span>
        );
      case "Offline":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Offline
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Laptop className="w-6 h-6 text-emerald-600" />
            <span>Devices & Counter Workstations</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time backend device sessions, active cashiers, document series allocation, and device controls.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab("logged_in")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeTab === "logged_in"
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Connected Workstations ({deviceSessions.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("counters")}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeTab === "counters"
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
            }`}
          >
            Registered Hardware ({counters.length})
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
            <span>Negative Stock ({negativeReport?.negative_batches_count || 0})</span>
          </button>
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
            placeholder="Search workstation, counter, user, IP..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
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
            <option value="idle">Idle Only</option>
            <option value="offline">Offline Only</option>
            <option value="locked">Locked Only</option>
            <option value="revoked">Revoked Only</option>
            <option value="out_of_date">Out of Date ({outOfDateCount})</option>
          </select>

          {hasPermission("settings", "edit") && (
            <button
              onClick={() => setIsMinVersionModalOpen(true)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 flex items-center gap-1.5 cursor-pointer"
              title="Configure minimum required app version across stores"
            >
              <span>Min Version:</span>
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">v{minRequiredVersion}</span>
            </button>
          )}

          <button
            onClick={() => {
              if (activeTab === "logged_in") fetchDeviceSessions();
              else fetchCounters();
            }}
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Tab 1: Connected Workstations (Item 2) */}
      {activeTab === "logged_in" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Workstation / Counter</th>
                  <th className="px-4 py-3">Signed-In User</th>
                  <th className="px-4 py-3">IP Address & Location</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sign-In Time</th>
                  <th className="px-4 py-3">Last Seen</th>
                  <th className="px-4 py-3">App Version & Sync</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading && deviceSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Loading connected workstations...
                    </td>
                  </tr>
                ) : filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      No active workstation sessions found.
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      {/* Workstation / Counter */}
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <Laptop className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>{s.device_name || "Workstation"}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                          <span>Counter:</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-300">{s.counter_name}</span>
                          {s.counter_code && (
                            <span className="font-mono text-[9px] bg-slate-100 dark:bg-slate-800 px-1 py-0.2 rounded font-bold">
                              {s.counter_code}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* User & Role */}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{s.user_name}</div>
                        <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 mt-0.5">
                          {s.user_role}
                        </span>
                      </td>

                      {/* IP & Location */}
                      <td className="px-4 py-3">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{s.ip_address}</div>
                        {s.location && (
                          <div className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3" />
                            <span>{s.location}</span>
                          </div>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {renderStatusBadge(s.status)}
                      </td>

                      {/* Sign-In Time */}
                      <td className="px-4 py-3 text-slate-500 text-[11px]">
                        {s.sign_in_time ? formatDateTime(s.sign_in_time) : "N/A"}
                      </td>

                      {/* Last Seen */}
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 font-medium text-[11px]">
                        {s.last_seen ? formatDateTime(s.last_seen) : "Never"}
                      </td>

                      {/* Version & Sync Queue */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] font-semibold text-slate-800 dark:text-slate-200">
                            v{s.app_version || "2.0.20"}
                          </span>
                          {s.is_out_of_date && (
                            <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-rose-700 bg-rose-50 dark:bg-rose-950 dark:text-rose-300 px-1.5 py-0.2 rounded">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Out of Date
                            </span>
                          )}
                        </div>
                        {s.unsynced_items_count > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0.2 rounded mt-0.5">
                            <Layers className="w-2.5 h-2.5" />
                            {s.unsynced_items_count} unsynced
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                            Synced
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            onClick={() => {
                              setRenameSession(s);
                              setRenameForm({ device_name: s.device_name || "", counter_name: s.counter_name || "" });
                            }}
                            title="Rename Workstation / Counter"
                            className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded-lg"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {s.status !== "Revoked" && (
                            <button
                              onClick={() => handleToggleLockSession(s)}
                              title={s.status === "Locked" ? "Unlock Workstation" : "Lock Workstation"}
                              className={`p-1.5 rounded-lg ${
                                s.status === "Locked"
                                  ? "text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                                  : "text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                              }`}
                            >
                              {s.status === "Locked" ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {s.status !== "Offline" && s.status !== "Revoked" && (
                            <button
                              onClick={() => handleForceLogoutSession(s)}
                              title="Force Logout Session"
                              className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-lg"
                            >
                              <PowerOff className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {s.status !== "Revoked" && (
                            <button
                              onClick={() => handleRevokeSession(s)}
                              title="Revoke Authorization"
                              className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
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
      )}

      {/* Tab 2: Registered Hardware Counters */}
      {activeTab === "counters" && (
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
      )}

      {/* Tab 3: Negative Stock */}
      {activeTab === "negative_stock" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Negative Stock Reconciliation Register</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Audit batches dispensed below zero during peak rush to reconcile with pending inward vendor bills.
              </p>
            </div>
          </div>

          {negativeReport?.batches?.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No negative stock batches found across any counters. Stock balances are clean.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2.5">Item & Batch</th>
                    <th className="px-4 py-2.5 text-right">Deficit Quantity</th>
                    <th className="px-4 py-2.5 text-right">Selling Rate</th>
                    <th className="px-4 py-2.5">Reconciliation Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(negativeReport?.batches || []).map((b: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-white">
                        {b.item_name} <span className="font-mono text-slate-500 font-normal">({b.batch_number})</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-red-600">
                        {b.current_stock}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">
                        ₹{Number(b.selling_price || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          Pending Inward Adjustment
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Rename Session Modal */}
      {renameSession && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xl max-w-sm w-full space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Rename Workstation / Counter</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Update display names across admin reports and counter screens.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Device Name
                </label>
                <input
                  type="text"
                  value={renameForm.device_name}
                  onChange={(e) => setRenameForm({ ...renameForm, device_name: e.target.value })}
                  placeholder="e.g. Front Cashier PC"
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Counter Name (Given at Sign-in)
                </label>
                <input
                  type="text"
                  value={renameForm.counter_name}
                  onChange={(e) => setRenameForm({ ...renameForm, counter_name: e.target.value })}
                  placeholder="e.g. Counter 1"
                  className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-slate-900 dark:text-white focus:outline-hidden"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRenameSession(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRename}
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal for setting Minimum Required Desktop Version */}
      {isMinVersionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-sm w-full p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">Minimum App Version Policy</h3>
              <button
                type="button"
                onClick={() => setIsMinVersionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>

            <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
              Define the minimum required build of LamSuite Billing. Connected devices running an older version will be flagged as <strong>Out of Date</strong>.
            </p>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700 dark:text-slate-300 block">
                Required Version (SemVer)
              </label>
              <input
                type="text"
                value={newMinVersionInput}
                onChange={(e) => setNewMinVersionInput(e.target.value)}
                placeholder="2.0.20"
                className="w-full bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 font-mono text-slate-900 dark:text-white focus:outline-hidden"
              />
              <span className="text-[10px] text-slate-400">Current latest release: v{latestVersion}</span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsMinVersionModalOpen(false)}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMinVersion}
                className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
              >
                Save Policy
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Revoke/Approve */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, counter: null, action: "revoke" })}
        onConfirm={handleStatusChange}
        title={confirmModal.action === "approve" ? "Approve Remote Counter" : "Revoke Counter Access"}
        message={
          confirmModal.action === "approve"
            ? `Approve counter "${confirmModal.counter?.counter_name}" (${confirmModal.counter?.counter_code}) to begin live billing?`
            : `Are you sure you want to revoke "${confirmModal.counter?.counter_name}"? The remote cashier will be disconnected immediately and prevented from issuing legal invoices.`
        }
        confirmText={confirmModal.action === "approve" ? "Approve Counter" : "Revoke Permanently"}
        danger={confirmModal.action !== "approve"}
        requireReason={confirmModal.action === "revoke"}
      />
    </div>
  );
};
