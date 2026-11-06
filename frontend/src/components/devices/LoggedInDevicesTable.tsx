import React, { useState, useEffect, useCallback } from "react";
import {
  Laptop,
  Monitor,
  Search,
  RefreshCw,
  MapPin,
  Clock,
  Activity,
  AlertCircle,
  PowerOff,
  Filter,
  Lock,
  Unlock,
  Edit2,
  Trash2,
  ShieldAlert,
  Layers,
  CheckCircle2,
  XCircle,
  Globe,
  Building2,
} from "lucide-react";
import {
  deviceSessionService,
  type LoggedInDevice,
  type DeviceStatus,
} from "../../lib/devices/deviceSessionService";
import { storeRegistryService } from "../../lib/auth/storeRegistryService";
import { publicIpService } from "../../lib/network/publicIpService";
import { deviceIpService } from "../../lib/network/deviceIpService";

export interface LoggedInDevicesTableProps {
  autoRefreshIntervalMs?: number;
  onDeviceCountChange?: (online: number, total: number) => void;
}

export const LoggedInDevicesTable: React.FC<LoggedInDevicesTableProps> = ({
  autoRefreshIntervalMs = 15000,
  onDeviceCountChange,
}) => {
  const [devices, setDevices] = useState<LoggedInDevice[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [successMsg, setSuccessMsg] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [storeFilter, setStoreFilter] = useState<string>("current");
  const [callerPublicIp, setCallerPublicIp] = useState<string | null>(null);
  const [thisDeviceIpv4, setThisDeviceIpv4] = useState<string | null>(null);
  const [otherStoresActiveCount, setOtherStoresActiveCount] = useState<number>(0);
  const [otherActiveStores, setOtherActiveStores] = useState<any[]>([]);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);

  // Rename modal state
  const [renameDevice, setRenameDevice] = useState<LoggedInDevice | null>(null);
  const [renameForm, setRenameForm] = useState({ device_name: "", counter_name: "" });

  const activeStore = storeRegistryService.getActiveStore();

  const fetchDevices = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMsg("");

      try {
        const curStore = storeRegistryService.getActiveStore();
        const list = await deviceSessionService.getLoggedInDevices({
          search: searchQuery.trim() || undefined,
          status: statusFilter,
          store_id: storeFilter === "all" ? "all" : (curStore?.id || "1"),
        });
        setDevices(list);

        const meta = deviceSessionService.getMetadata();
        let pubIp = meta.caller_public_ip || publicIpService.getCachedIp();
        if (!pubIp) {
          pubIp = await publicIpService.getPublicIp().catch(() => null);
        }
        setCallerPublicIp(pubIp);

        const localIpv4 = await deviceIpService.getLocalIpv4().catch(() => null);
        setThisDeviceIpv4(localIpv4);

        setOtherStoresActiveCount(meta.other_stores_active_count || 0);
        setOtherActiveStores(meta.other_active_stores || []);

        if (onDeviceCountChange) {
          const activeCount = list.filter((d) => d.status === "Active").length;
          onDeviceCountChange(activeCount, list.length);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to retrieve logged-in devices.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [searchQuery, statusFilter, storeFilter, onDeviceCountChange]
  );

  useEffect(() => {
    fetchDevices(false);
    const interval = setInterval(() => {
      fetchDevices(true);
    }, autoRefreshIntervalMs);

    return () => clearInterval(interval);
  }, [fetchDevices, autoRefreshIntervalMs]);

  const handleForceLogout = async (deviceId: string, name: string | null) => {
    if (!window.confirm(`Force log out session for "${name || 'this workstation'}"? The device will be disconnected immediately.`)) {
      return;
    }

    setActiveActionId(deviceId);
    try {
      await deviceSessionService.forceLogout(deviceId);
      setSuccessMsg(`Session terminated for "${name || 'workstation'}".`);
      setTimeout(() => setSuccessMsg(""), 4000);
      await fetchDevices(true);
    } catch (err: any) {
      alert(err?.message || "Failed to force logout.");
    } finally {
      setActiveActionId(null);
    }
  };

  const handleToggleLock = async (device: LoggedInDevice) => {
    const isLocked = device.status === "Locked";
    const promptMsg = isLocked
      ? `Unlock workstation "${device.device_name || device.counter_name}"?`
      : `Lock workstation "${device.device_name || device.counter_name}"? Cashier will require authorization to unlock.`;

    if (!window.confirm(promptMsg)) return;

    setActiveActionId(device.id);
    try {
      if (isLocked) {
        await deviceSessionService.unlockDevice(device.id);
        setSuccessMsg(`Workstation "${device.device_name}" unlocked.`);
      } else {
        await deviceSessionService.lockDevice(device.id);
        setSuccessMsg(`Workstation "${device.device_name}" locked.`);
      }
      setTimeout(() => setSuccessMsg(""), 4000);
      await fetchDevices(true);
    } catch (err: any) {
      alert(err?.message || "Lock action failed.");
    } finally {
      setActiveActionId(null);
    }
  };

  const handleRevokeDevice = async (device: LoggedInDevice) => {
    const reason = window.prompt(
      `Revoke workstation "${device.device_name || device.counter_name}" permanently? Enter revocation reason:`,
      "Decommissioned or unauthorized device"
    );
    if (reason === null) return;

    setActiveActionId(device.id);
    try {
      await deviceSessionService.revokeDevice(device.id, reason);
      setSuccessMsg(`Workstation "${device.device_name}" revoked permanently.`);
      setTimeout(() => setSuccessMsg(""), 4000);
      await fetchDevices(true);
    } catch (err: any) {
      alert(err?.message || "Failed to revoke device.");
    } finally {
      setActiveActionId(null);
    }
  };

  const openRenameModal = (device: LoggedInDevice) => {
    setRenameDevice(device);
    setRenameForm({
      device_name: device.device_name || "",
      counter_name: device.counter_name || "",
    });
  };

  const handleSaveRename = async () => {
    if (!renameDevice) return;
    try {
      await deviceSessionService.renameDevice(renameDevice.id, {
        device_name: renameForm.device_name.trim() || undefined,
        counter_name: renameForm.counter_name.trim() || undefined,
      });
      setRenameDevice(null);
      setSuccessMsg("Device / Counter renamed successfully.");
      setTimeout(() => setSuccessMsg(""), 4000);
      await fetchDevices(true);
    } catch (err: any) {
      alert(err?.message || "Failed to rename device.");
    }
  };

  const formatDate = (isoString: string | null): string => {
    if (!isoString) return "N/A";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "N/A";
      return date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "N/A";
    }
  };

  const formatRelativeTime = (isoString: string | null): string => {
    if (!isoString) return "Never";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "Never";
      const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
      if (diffSec < 15) return "Just now";
      if (diffSec < 60) return `${diffSec}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      return formatDate(isoString);
    } catch {
      return "Never";
    }
  };

  const renderStatusBadge = (status: DeviceStatus) => {
    switch (status) {
      case "Active":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Active
          </span>
        );
      case "Idle":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Idle
          </span>
        );
      case "Locked":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <Lock className="w-3 h-3 text-blue-600" />
            Locked
          </span>
        );
      case "Revoked":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3 h-3 text-rose-600" />
            Revoked
          </span>
        );
      case "Offline":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Offline
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--color-surface)] p-4 rounded-xl border border-[var(--color-border)] shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-[var(--color-text)]">Logged-In Workstations & Counters</h3>
            <span className="bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] text-xs px-2 py-0.5 rounded-full font-mono font-medium">
              {devices.length}
            </span>
          </div>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Real-time backend connection status, signed-in cashiers, app versions, and synchronization health.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* This Workstation Local IPv4 Badge */}
          {thisDeviceIpv4 && (
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 text-xs font-mono font-medium shadow-2xs dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
              title="This workstation's detected local network IPv4 address"
            >
              <span className="text-[9px] font-extrabold uppercase px-1 py-0.2 rounded bg-blue-200/80 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                IPv4
              </span>
              <span>This Device:</span>
              <span className="font-bold">{thisDeviceIpv4}</span>
            </div>
          )}

          {/* Public IP Badge */}
          {callerPublicIp && (
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-mono font-medium shadow-2xs"
              title="Your workstation's detected Public WAN IP address"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Public IP:</span>
              <span className="font-bold">{callerPublicIp}</span>
            </div>
          )}

          {/* Search Box */}
          <div className="relative min-w-[180px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workstation, counter, user..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Store Filter */}
          <div className="flex items-center gap-1.5 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]">
            <Building2 className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <select
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
              className="bg-transparent focus:outline-none cursor-pointer text-xs font-medium text-[var(--color-text)]"
            >
              <option value="current">Current Store ({activeStore?.code || "STORE-01"})</option>
              <option value="all">All Stores (Cross-Branch)</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 text-xs text-[var(--color-text-muted)]">
            <Filter className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent focus:outline-none cursor-pointer text-xs font-medium text-[var(--color-text)]"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="idle">Idle</option>
              <option value="offline">Offline</option>
              <option value="locked">Locked</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchDevices(false)}
            disabled={isLoading || isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] text-xs font-semibold hover:bg-[var(--color-surface-subtle)] disabled:opacity-50 transition-colors shadow-xs"
            title="Refresh device list"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-[var(--color-text-muted)] ${isRefreshing || isLoading ? "animate-spin text-emerald-600" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Other Stores Active Devices Alert */}
      {storeFilter === "current" && otherStoresActiveCount > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3.5 bg-blue-50/90 border border-blue-200 rounded-xl text-xs text-blue-900 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
            <div>
              <span className="font-bold">Other Store Sessions Detected:</span>{" "}
              <span>
                {otherStoresActiveCount} workstation{otherStoresActiveCount > 1 ? "s are" : " is"} currently logged in to{" "}
                <strong>
                  {Array.from(new Set(otherActiveStores.map((s) => s.store_name || s.store_code || `Store ${s.store_id}`))).join(", ")}
                </strong>
                .
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStoreFilter("all")}
            className="self-start sm:self-auto shrink-0 px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors cursor-pointer shadow-2xs"
          >
            Show All Stores ({otherStoresActiveCount + devices.length})
          </button>
        </div>
      )}

      {/* Notifications */}
      {successMsg && (
        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center justify-between p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchDevices(false)}
            className="text-xs font-semibold text-rose-700 underline hover:text-rose-900"
          >
            Retry
          </button>
        </div>
      )}

      {/* Devices Table */}
      {isLoading && devices.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-[var(--color-text-muted)]">
            <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
            <span>Retrieving connected workstations from backend...</span>
          </div>
        </div>
      ) : devices.length === 0 ? (
        <div className="bg-[var(--color-surface)] border border-dashed border-[var(--color-border)] rounded-xl p-10 text-center space-y-2">
          <Monitor className="h-8 w-8 text-[var(--color-text-muted)] mx-auto opacity-40" />
          <h4 className="text-xs font-bold text-[var(--color-text)]">No Connected Workstations Found</h4>
          <p className="text-[11px] text-[var(--color-text-muted)] max-w-sm mx-auto">
            {searchQuery || statusFilter !== "all"
              ? "No devices match the applied filter criteria. Try clearing your search."
              : "When cash counters and workstations log in to the server, their active sessions will appear here in real time."}
          </p>
        </div>
      ) : (
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--color-surface-subtle)] border-b border-[var(--color-border)] text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <th className="py-3 px-4">Workstation / Counter</th>
                  <th className="py-3 px-4">Signed-In User</th>
                  <th className="py-3 px-4">Device IPv4</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Sign-In Time</th>
                  <th className="py-3 px-4">Last Seen</th>
                  <th className="py-3 px-4">Version & Queue</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-subtle)]">
                {devices.map((device) => {
                  return (
                    <tr
                      key={device.id}
                      className={`hover:bg-[var(--color-surface-subtle)] transition-colors ${
                        device.is_this_device ? "bg-emerald-50/20" : ""
                      }`}
                    >
                      {/* Workstation / Counter */}
                      <td className="py-3 px-4">
                        <div className="flex items-start gap-2">
                          <Laptop className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-[var(--color-text)]">
                                {device.device_name || "Workstation"}
                              </span>
                              {device.is_this_device && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                  This device
                                </span>
                              )}
                              {(storeFilter === "all" || (device.store_code && device.store_code !== activeStore?.code)) && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200" title={device.store_name || undefined}>
                                  {device.store_code || `STORE-${device.store_id}`}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1">
                              <span>Counter:</span>
                              <span className="font-semibold text-[var(--color-text)]">
                                {device.counter_name || "Unassigned"}
                              </span>
                              {device.counter_code && (
                                <span className="font-mono text-[9px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-1 py-0.2 rounded">
                                  {device.counter_code}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* User & Role */}
                      <td className="py-3 px-4">
                        <div>
                          <span className="font-semibold text-[var(--color-text)] block">
                            {device.user_name || "Cashier"}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] border border-[var(--color-border)] mt-0.5">
                            {device.user_role || "Cashier"}
                          </span>
                        </div>
                      </td>

                      {/* Device IPv4 */}
                      <td className="py-3 px-4">
                        <div className="space-y-1">
                          {/* Workstation Local / Device IPv4 */}
                          <div className="flex items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-slate-900 bg-slate-100 dark:bg-slate-800 dark:text-slate-100 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 shadow-2xs"
                              title="Workstation Local / Device IPv4 Address"
                            >
                              <span className="text-[9px] font-extrabold uppercase px-1 py-0.2 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-200">
                                IPv4
                              </span>
                              <span>
                                {device.device_ipv4 || device.ip_address || (device.is_this_device && thisDeviceIpv4 ? thisDeviceIpv4 : "127.0.0.1")}
                              </span>
                            </span>
                          </div>

                          {/* Public WAN IP if available and different from IPv4 */}
                          {device.public_ip && device.public_ip !== (device.device_ipv4 || device.ip_address) && (
                            <div
                              className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400 font-mono"
                              title="Public WAN IP Address"
                            >
                              <Globe className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>WAN: {device.public_ip}</span>
                            </div>
                          )}

                          {/* Location */}
                          {device.location ? (
                            <div className="text-[10px] text-[var(--color-text-muted)] flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-[var(--color-text-muted)] shrink-0" />
                              <span>{device.location}</span>
                            </div>
                          ) : null}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {renderStatusBadge(device.status)}
                      </td>

                      {/* Sign-In Time */}
                      <td className="py-3 px-4 text-[var(--color-text-muted)]">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 opacity-60 shrink-0" />
                          <span>{formatDate(device.sign_in_time)}</span>
                        </div>
                      </td>

                      {/* Last Seen */}
                      <td className="py-3 px-4 text-[var(--color-text)]">
                        <div className="flex items-center gap-1">
                          <Activity className={`w-3.5 h-3.5 shrink-0 ${device.status === "Active" ? "text-emerald-500" : "text-slate-400"}`} />
                          <span className="font-medium">
                            {formatRelativeTime(device.last_seen)}
                          </span>
                        </div>
                      </td>

                      {/* App Version & Unsynced Queue */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-mono text-[11px] text-[var(--color-text)]">
                            v{device.app_version || "2.0.36"}
                          </span>
                          {device.unsynced_items_count > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded w-fit">
                              <Layers className="w-2.5 h-2.5" />
                              {device.unsynced_items_count} unsynced
                            </span>
                          ) : (
                            <span className="text-[10px] text-emerald-600 font-medium">
                              Fully synced
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          {/* Rename Button */}
                          <button
                            type="button"
                            onClick={() => openRenameModal(device)}
                            className="p-1 text-[var(--color-text-muted)] hover:text-emerald-600 hover:bg-[var(--color-surface-subtle)] rounded transition-colors"
                            title="Rename workstation or counter"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {/* Lock / Unlock Button */}
                          {device.status !== "Revoked" && (
                            <button
                              type="button"
                              onClick={() => handleToggleLock(device)}
                              disabled={activeActionId === device.id}
                              className={`p-1 rounded transition-colors ${
                                device.status === "Locked"
                                  ? "text-blue-600 hover:bg-blue-50"
                                  : "text-[var(--color-text-muted)] hover:text-blue-600 hover:bg-[var(--color-surface-subtle)]"
                              }`}
                              title={device.status === "Locked" ? "Unlock workstation" : "Lock workstation"}
                            >
                              {device.status === "Locked" ? (
                                <Unlock className="w-3.5 h-3.5" />
                              ) : (
                                <Lock className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}

                          {/* Force Logout Button */}
                          {device.status !== "Offline" && device.status !== "Revoked" && (
                            <button
                              type="button"
                              onClick={() => handleForceLogout(device.id, device.device_name || device.counter_name)}
                              disabled={activeActionId === device.id}
                              className="p-1 text-[var(--color-text-muted)] hover:text-amber-600 hover:bg-amber-50 rounded transition-colors disabled:opacity-50"
                              title="Force log out active session"
                            >
                              <PowerOff className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Revoke Button */}
                          {device.status !== "Revoked" && (
                            <button
                              type="button"
                              onClick={() => handleRevokeDevice(device)}
                              disabled={activeActionId === device.id}
                              className="p-1 text-[var(--color-text-muted)] hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-50"
                              title="Revoke device permanently"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rename Dialog Modal */}
      {renameDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-5 shadow-2xl max-w-sm w-full space-y-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text)]">Rename Workstation / Counter</h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Update the display name for this device across all terminals and reports.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text)] block mb-1">
                  Device Name
                </label>
                <input
                  type="text"
                  value={renameForm.device_name}
                  onChange={(e) => setRenameForm({ ...renameForm, device_name: e.target.value })}
                  placeholder="e.g. Main Cashier PC"
                  className="w-full text-xs bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-[var(--color-text)] focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-[var(--color-text)] block mb-1">
                  Counter Name (Given at Sign-in)
                </label>
                <input
                  type="text"
                  value={renameForm.counter_name}
                  onChange={(e) => setRenameForm({ ...renameForm, counter_name: e.target.value })}
                  placeholder="e.g. Counter 1"
                  className="w-full text-xs bg-[var(--color-surface-subtle)] border border-[var(--color-border)] rounded-lg px-3 py-1.5 text-[var(--color-text)] focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRenameDevice(null)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveRename}
                className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
