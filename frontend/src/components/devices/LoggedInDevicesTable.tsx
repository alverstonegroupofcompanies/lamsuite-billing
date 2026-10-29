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
} from "lucide-react";
import { deviceSessionService, type LoggedInDevice } from "../../lib/devices/deviceSessionService";

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
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expiringId, setExpiringId] = useState<string | null>(null);

  const fetchDevices = useCallback(
    async (isBackground = false) => {
      if (!isBackground) setIsLoading(true);
      else setIsRefreshing(true);
      setErrorMsg("");

      try {
        const list = await deviceSessionService.getLoggedInDevices({
          search: searchQuery.trim() || undefined,
          status: statusFilter,
        });
        setDevices(list);

        if (onDeviceCountChange) {
          const onlineCount = list.filter((d) => d.status === "Online").length;
          onDeviceCountChange(onlineCount, list.length);
        }
      } catch (err: any) {
        setErrorMsg(err?.message || "Failed to retrieve logged-in devices.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [searchQuery, statusFilter, onDeviceCountChange]
  );

  useEffect(() => {
    fetchDevices(false);
    const interval = setInterval(() => {
      fetchDevices(true);
    }, autoRefreshIntervalMs);

    return () => clearInterval(interval);
  }, [fetchDevices, autoRefreshIntervalMs]);

  const handleExpireSession = async (deviceId: string, name: string | null) => {
    if (!window.confirm(`Are you sure you want to expire the session for "${name || 'this device'}"?`)) {
      return;
    }

    setExpiringId(deviceId);
    try {
      await deviceSessionService.expireDeviceSession(deviceId);
      await fetchDevices(true);
    } catch (err: any) {
      alert(err?.message || "Failed to expire session.");
    } finally {
      setExpiringId(null);
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
    if (!isoString) return "N/A";
    try {
      const date = new Date(isoString);
      if (isNaN(date.getTime())) return "N/A";
      const diffSec = Math.round((Date.now() - date.getTime()) / 1000);

      if (diffSec < 15) return "Just now";
      if (diffSec < 60) return `${diffSec}s ago`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}h ago`;
      return formatDate(isoString);
    } catch {
      return "N/A";
    }
  };

  const renderStatusBadge = (status: LoggedInDevice["status"]) => {
    switch (status) {
      case "Online":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </span>
        );
      case "Offline":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            Offline
          </span>
        );
      case "Session Expired":
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Session Expired
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Header & Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-emerald-600" />
            <h3 className="text-sm font-bold text-slate-800">Logged-In Devices</h3>
            <span className="bg-slate-100 text-slate-600 text-xs px-2 py-0.5 rounded-full font-mono font-medium">
              {devices.length}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Centralized inventory of authenticated workstations, active counters, and online sessions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search counter, device, IP..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white transition-colors"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent focus:outline-none cursor-pointer text-xs font-medium text-slate-700"
            >
              <option value="all">All Statuses</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="expired">Session Expired</option>
            </select>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => fetchDevices(false)}
            disabled={isLoading || isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-xs"
            title="Refresh device list"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${isRefreshing || isLoading ? "animate-spin text-emerald-600" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error State Banner */}
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

      {/* Devices View */}
      {isLoading && devices.length === 0 ? (
        /* Loading Skeleton */
        <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
            <span>Retrieving authenticated devices...</span>
          </div>
          <div className="space-y-2 max-w-md mx-auto pt-2">
            <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
            <div className="h-3 bg-slate-100 rounded animate-pulse w-5/6 mx-auto" />
          </div>
        </div>
      ) : devices.length === 0 ? (
        /* Empty State */
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-10 text-center space-y-2">
          <Monitor className="h-8 w-8 text-slate-300 mx-auto" />
          <h4 className="text-xs font-bold text-slate-700">No Logged-In Devices Found</h4>
          <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
            {searchQuery || statusFilter !== "all"
              ? "No devices match the applied filter criteria. Try clearing your search."
              : "When cash counters and workstations log in to the centralized server, their active sessions will appear here."}
          </p>
        </div>
      ) : (
        /* Data Table (Desktop) & Cards (Mobile) */
        <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Device Name</th>
                  <th className="py-3 px-4">Counter Name</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Login Time</th>
                  <th className="py-3 px-4">Last Active</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {devices.map((device) => {
                  const isOnline = device.status === "Online";

                  return (
                    <tr
                      key={device.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      {/* Device Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Laptop className={`w-4 h-4 ${isOnline ? "text-emerald-600" : "text-slate-400"}`} />
                          <div>
                            <span className="font-semibold text-slate-800 block">
                              {device.device_name || "N/A"}
                            </span>
                            {device.user_name && (
                              <span className="text-[10px] text-slate-500">
                                User: {device.user_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Counter Name */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-slate-700">
                            {device.counter_name || "N/A"}
                          </span>
                          {device.counter_code && (
                            <span className="font-mono text-[10px] bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-slate-600 font-bold">
                              {device.counter_code}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* IP Address */}
                      <td className="py-3 px-4">
                        <span className="font-mono text-slate-600">
                          {device.ip_address || "N/A"}
                        </span>
                      </td>

                      {/* Location */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 text-slate-600">
                          {device.location ? (
                            <>
                              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{device.location}</span>
                            </>
                          ) : (
                            <span>N/A</span>
                          )}
                        </div>
                      </td>

                      {/* Login Time */}
                      <td className="py-3 px-4 text-slate-600">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{formatDate(device.login_time)}</span>
                        </div>
                      </td>

                      {/* Last Active */}
                      <td className="py-3 px-4 text-slate-600">
                        <div className="flex items-center gap-1" title={device.last_active || undefined}>
                          <Activity className={`w-3.5 h-3.5 shrink-0 ${isOnline ? "text-emerald-500" : "text-slate-400"}`} />
                          <span className="font-medium text-slate-700">
                            {formatRelativeTime(device.last_active)}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4">
                        {renderStatusBadge(device.status)}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right">
                        {device.is_active && (
                          <button
                            type="button"
                            onClick={() => handleExpireSession(device.id, device.device_name || device.counter_name)}
                            disabled={expiringId === device.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors disabled:opacity-50"
                            title="Expire and disconnect this workstation session"
                          >
                            <PowerOff className="w-3 h-3" />
                            <span>{expiringId === device.id ? "Expiring..." : "Expire Session"}</span>
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
      )}
    </div>
  );
};
