import React, { useState, useEffect, useCallback } from "react";
import {
  ShieldCheck,
  Search,
  Filter,
  Download,
  Eye,
  RefreshCw,
  UserCheck,
  Globe,
  Clock,
  ArrowRight,
  Lock,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateTime } from "../utils/formatters";
import type { AuditLog } from "../types";

export const AuditLogsPage: React.FC = () => {
  const { activeStore } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Detail Modal
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = {
        page,
      };
      if (search.trim()) params.search = search.trim();
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity_type = entityFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (activeStore) params.active_store_id = activeStore.id;

      const res = await api.get<{
        data: AuditLog[];
        current_page: number;
        last_page: number;
        total: number;
      }>("/audit-logs", params);

      setLogs(res.data || []);
      setPage(res.current_page || 1);
      setTotalPages(res.last_page || 1);
      setTotalCount(res.total || 0);
    } catch (err: unknown) {
      const e = err as Error;
      setError(e.message || "Failed to load audit logs");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, actionFilter, entityFilter, startDate, endDate, activeStore]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleExportCSV = async () => {
    try {
      const params: Record<string, string | number> = {
        export: "true",
      };
      if (search.trim()) params.search = search.trim();
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entity_type = entityFilter;
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
      if (activeStore) params.active_store_id = activeStore.id;

      const res = await api.get<{ data: AuditLog[] }>("/audit-logs", params);
      const rows = res.data || [];

      if (rows.length === 0) {
        alert("No records to export.");
        return;
      }

      const headers = [
        "Log ID",
        "Timestamp",
        "Action",
        "Entity Type",
        "Entity ID",
        "User Name",
        "User Email",
        "User Role",
        "Impersonated By",
        "Store",
        "IP Address",
        "User Agent",
      ];

      const csvContent = [
        headers.join(","),
        ...rows.map((r) =>
          [
            r.id,
            `"${formatDateTime(r.created_at)}"`,
            `"${r.action}"`,
            `"${r.entity_type || ""}"`,
            `"${r.entity_id || ""}"`,
            `"${r.user?.name || "System"}"`,
            `"${r.user?.email || ""}"`,
            `"${r.user?.role || ""}"`,
            `"${r.impersonator ? `${r.impersonator.name} (${r.impersonator.email})` : "None"}"`,
            `"${r.store?.name || ""}"`,
            `"${r.ip_address || ""}"`,
            `"${(r.user_agent || "").replace(/"/g, '""')}"`,
          ].join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      const e = err as Error;
      alert(`Export failed: ${e.message}`);
    }
  };

  const getActionBadgeColor = (action: string) => {
    if (action.includes("cancel") || action.includes("delete") || action.includes("revoke") || action.includes("reset")) {
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-800";
    }
    if (action.includes("impersonat")) {
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-800";
    }
    if (action.includes("disable") || action.includes("lock") || action.includes("failed")) {
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800";
    }
    if (action.includes("create") || action.includes("enable") || action.includes("approve")) {
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800";
    }
    return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800";
  };

  return (
    <div className="space-y-6">
      {/* Page Title & Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Audit Trail
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <Lock className="w-3 h-3" /> Tamper-Evident & Immutable
            </span>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Complete sequential log of administrative operations, state transitions, security events, and user impersonations. Entries cannot be altered or removed.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchLogs()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search action, entity, IP..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Actions</option>
              <option value="store.create">Store Created</option>
              <option value="store.update">Store Updated</option>
              <option value="store.disable">Store Disabled</option>
              <option value="store.enable">Store Enabled</option>
              <option value="store.reset">Remote Store Reset</option>
              <option value="device.approve">Device Approved</option>
              <option value="device.revoke">Device Revoked</option>
              <option value="device.resync">Device Force Resync</option>
              <option value="user.create">User Created</option>
              <option value="user.impersonate">User Impersonation</option>
              <option value="user.password_reset">Password Reset</option>
              <option value="invoice.cancel">Invoice Cancelled</option>
              <option value="sync.resolve_conflict">Sync Conflict Resolved</option>
              <option value="settings.update">Settings Updated</option>
            </select>
          </div>

          <div>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">All Entity Types</option>
              <option value="Store">Store</option>
              <option value="Device">Device</option>
              <option value="User">User</option>
              <option value="Invoice">Invoice</option>
              <option value="Product">Product</option>
              <option value="SyncEvent">SyncEvent</option>
              <option value="CompanySetting">CompanySetting</option>
              <option value="GstLockPeriod">GstLockPeriod</option>
            </select>
          </div>

          <div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              title="Start Date"
            />
          </div>

          <div>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              title="End Date"
            />
          </div>
        </div>

        {(search || actionFilter || entityFilter || startDate || endDate) && (
          <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-700/60">
            <span>
              Filtered results: Showing {logs.length} of {totalCount} records
            </span>
            <button
              onClick={() => {
                setSearch("");
                setActionFilter("");
                setEntityFilter("");
                setStartDate("");
                setEndDate("");
                setPage(1);
              }}
              className="text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-200 text-sm">
          {error}
        </div>
      )}

      {/* Audit Log Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-900/80 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3">Timestamp (IST)</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Entity</th>
                <th className="px-4 py-3">Actor / Impersonator</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3">Network / IP</th>
                <th className="px-4 py-3 text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-xs">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                    Loading immutable audit trail records...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-400 font-sans">
                    <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    No audit records match the selected filter criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition group"
                  >
                    {/* Timestamp */}
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-400">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <span>{formatDateTime(log.created_at)}</span>
                      </div>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${getActionBadgeColor(
                          log.action
                        )}`}
                      >
                        {log.action}
                      </span>
                    </td>

                    {/* Entity */}
                    <td className="px-4 py-3 whitespace-nowrap font-sans">
                      {log.entity_type ? (
                        <div className="text-slate-800 dark:text-slate-200">
                          <span className="font-medium text-slate-900 dark:text-white">
                            {log.entity_type}
                          </span>
                          {log.entity_id && (
                            <span className="text-xs text-slate-400 ml-1">
                              #{log.entity_id}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Actor */}
                    <td className="px-4 py-3 font-sans">
                      <div className="space-y-0.5">
                        <div className="font-medium text-slate-900 dark:text-white flex items-center gap-1">
                          {log.user ? log.user.name : "System Worker"}
                          {log.user?.role && (
                            <span className="text-[10px] px-1.5 py-0.2 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                              {log.user.role}
                            </span>
                          )}
                        </div>
                        {log.user?.email && (
                          <div className="text-xs text-slate-400">{log.user.email}</div>
                        )}
                        {log.impersonator && (
                          <div className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-200 dark:border-purple-800 mt-0.5">
                            <UserCheck className="w-3 h-3" />
                            by SuperAdmin: {log.impersonator.name}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Store */}
                    <td className="px-4 py-3 whitespace-nowrap font-sans">
                      {log.store ? (
                        <div>
                          <div className="font-medium text-slate-800 dark:text-slate-200">
                            {log.store.name}
                          </div>
                          <div className="text-xs text-slate-400">{log.store.code}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">All Stores / Global</span>
                      )}
                    </td>

                    {/* Network & IP */}
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">
                      <div className="flex items-center gap-1">
                        <Globe className="w-3 h-3 text-slate-400" />
                        <span>{log.ip_address || "127.0.0.1"}</span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right whitespace-nowrap font-sans">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
                      >
                        <Eye className="w-3.5 h-3.5 text-primary-500" />
                        Diff / Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            Showing Page <span className="font-medium text-slate-700 dark:text-slate-300">{page}</span> of{" "}
            <span className="font-medium text-slate-700 dark:text-slate-300">{totalPages}</span> (Total{" "}
            <span className="font-medium text-slate-700 dark:text-slate-300">{totalCount}</span> records)
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-300 font-medium hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Audit Detail & Diff Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-500" />
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Audit Entry Inspection: #{selectedLog.id}
                </h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Metadata Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block mb-1">Action</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {selectedLog.action}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block mb-1">Timestamp</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {formatDateTime(selectedLog.created_at)}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block mb-1">Actor</span>
                  <span className="font-semibold text-slate-900 dark:text-white truncate block">
                    {selectedLog.user ? selectedLog.user.name : "System"}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-400 block mb-1">Store</span>
                  <span className="font-semibold text-slate-900 dark:text-white truncate block">
                    {selectedLog.store ? selectedLog.store.name : "Global"}
                  </span>
                </div>
              </div>

              {/* Impersonation Details if applicable */}
              {selectedLog.impersonator && (
                <div className="p-3 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 text-xs text-purple-900 dark:text-purple-200 flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  <div>
                    <span className="font-semibold">Impersonation Notice:</span> This action was triggered during an active impersonation session by SuperAdmin{" "}
                    <strong>{selectedLog.impersonator.name}</strong> ({selectedLog.impersonator.email}).
                  </div>
                </div>
              )}

              {/* Client Network & Platform Details */}
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Client IP Address:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {selectedLog.ip_address || "N/A"}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <span className="text-slate-400 shrink-0">User Agent:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300 text-right truncate">
                    {selectedLog.user_agent || "N/A"}
                  </span>
                </div>
              </div>

              {/* Old Values vs New Values Diff */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  State Mutation Diff (Old vs New Values)
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Old Values */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium text-rose-600 dark:text-rose-400">
                      <span>Previous / Old State</span>
                      <span>{selectedLog.old_values ? "Values Present" : "None / Created"}</span>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto max-h-60 border border-slate-800">
                      {selectedLog.old_values
                        ? JSON.stringify(selectedLog.old_values, null, 2)
                        : "// No prior record (Creation action)"}
                    </pre>
                  </div>

                  {/* New Values */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <span>Applied / New State</span>
                      <span>{selectedLog.new_values ? "Values Present" : "None / Deleted"}</span>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs overflow-x-auto max-h-60 border border-slate-800">
                      {selectedLog.new_values
                        ? JSON.stringify(selectedLog.new_values, null, 2)
                        : "// No subsequent record"}
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between">
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-400" />
                Audit records are tamper-proof and strictly immutable.
              </span>
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
