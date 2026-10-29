import React, { useEffect, useState } from "react";
import { SyncEvent } from "../types";
import { api } from "../services/api";
import { formatDateTime } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import {
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  RotateCw,
  GitMerge,
  ShieldCheck,
  Activity,
  Layers,
  X,
  Server,
  Laptop,
} from "lucide-react";

export const SyncCenterPage: React.FC = () => {
  const { activeStore, hasPermission } = useAuth();
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"queue" | "conflicts" | "diagnostics">("queue");
  const [isLoading, setIsLoading] = useState(true);

  // Selected conflict for resolution modal
  const [resolvingEvent, setResolvingEvent] = useState<SyncEvent | null>(null);
  const [resolutionChoice, setResolutionChoice] = useState<"keep_cloud" | "keep_local" | "merge">("keep_cloud");
  const [mergedJson, setMergedJson] = useState<string>("{}");

  const fetchSyncData = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ data: SyncEvent[] }>("/admin/sync/events", {
        status: activeTab === "conflicts" ? "conflict" : undefined,
      });
      setEvents(res.data || []);

      if (activeTab === "diagnostics") {
        const diag = await api.get("/admin/sync/diagnostics");
        setDiagnostics(diag);
      }
    } catch (err) {
      console.error("Failed to load sync events:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSyncData();
  }, [activeTab, activeStore]);

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingEvent) return;

    try {
      let mergedData = undefined;
      if (resolutionChoice === "merge") {
        mergedData = JSON.parse(mergedJson);
      }

      await api.post(`/admin/sync/events/${resolvingEvent.id}/resolve`, {
        resolution: resolutionChoice,
        merged_data: mergedData,
      });

      alert(`Conflict successfully resolved using strategy: '${resolutionChoice}'.`);
      setResolvingEvent(null);
      await fetchSyncData();
    } catch (err: any) {
      alert(err?.message || "Failed to resolve conflict.");
    }
  };

  const handleRetry = async (eventId: number) => {
    try {
      await api.post(`/admin/sync/events/${eventId}/retry`);
      alert("Sync event re-queued for transmission.");
      await fetchSyncData();
    } catch (err: any) {
      alert(err?.message || "Retry failed.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Sync Center & Offline Conflict Resolver
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Bidirectional delta queue, optimistic conflict diff engine, keep cloud / keep local resolution, and diagnostics.
          </p>
        </div>

        <button
          onClick={fetchSyncData}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 shadow-2xs hover:bg-slate-50"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Queue</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("queue")}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "queue"
              ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Sync Operations Queue</span>
        </button>

        <button
          onClick={() => setActiveTab("conflicts")}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "conflicts"
              ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <span>Conflicts Needing Resolution</span>
        </button>

        <button
          onClick={() => setActiveTab("diagnostics")}
          className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeTab === "diagnostics"
              ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Mesh & Cloud Diagnostics</span>
        </button>
      </div>

      {/* Content */}
      {activeTab !== "diagnostics" ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Event / Entity</th>
                <th className="px-4 py-3">Store & Terminal</th>
                <th className="px-4 py-3 text-center">Version Diff</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading sync operations...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No sync queue items found.
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-mono">
                      <div className="font-bold text-slate-900 dark:text-white capitalize">
                        {ev.action} {ev.entity_type}
                      </div>
                      <div className="text-[10px] text-slate-400">ID: {ev.entity_id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">
                        {ev.store?.name || "Store Main"}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        Terminal: {ev.device?.device_name || "Counter 01"}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-[11px]">
                      Client v{ev.client_version} ↔ Server v{ev.server_version}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                          ev.status === "resolved"
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                            : ev.status === "conflict"
                            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 animate-pulse"
                            : ev.status === "failed"
                            ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                            : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400"
                        }`}
                      >
                        {ev.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">
                      {formatDateTime(ev.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {ev.status === "conflict" && hasPermission("sync", "edit") && (
                        <button
                          onClick={() => {
                            setResolvingEvent(ev);
                            setResolutionChoice("keep_cloud");
                            setMergedJson(
                              JSON.stringify({ ...(ev.server_data || {}), ...(ev.client_data || {}) }, null, 2)
                            );
                          }}
                          className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-[10px] shadow-xs"
                        >
                          Resolve Conflict
                        </button>
                      )}

                      {ev.status === "failed" && hasPermission("sync", "edit") && (
                        <button
                          onClick={() => handleRetry(ev.id)}
                          className="px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-lg text-[10px] shadow-xs"
                        >
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* Diagnostics View */
        diagnostics && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs font-semibold text-slate-500">Cloud Network Status</span>
              <div className="text-xl font-bold text-emerald-600 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5" />
                <span>{diagnostics.system_status}</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Latency: <span className="font-mono">{diagnostics.cloud_sync_latency_ms} ms</span>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs font-semibold text-slate-500">Centralized Server</span>
              <div className="text-xl font-bold text-slate-900 dark:text-white">
                {diagnostics.server_connection_status || diagnostics.lan_websocket_status || "Online (Centralized Server)"}
              </div>
              <div className="text-[11px] text-slate-400">Online-first central sync bridge active</div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
              <span className="text-xs font-semibold text-slate-500">Active Heartbeats</span>
              <div className="text-xl font-bold text-brand-600">
                {diagnostics.active_devices_count} Devices Online
              </div>
              <div className="text-[10px] text-slate-400 font-mono">
                Last ping: {formatDateTime(diagnostics.last_sync_heartbeat)}
              </div>
            </div>
          </div>
        )
      )}

      {/* Conflict Resolution Diff Modal */}
      {resolvingEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-amber-500/50 max-w-2xl w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 text-amber-500">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                <span>Conflict Resolution Engine: #{resolvingEvent.id}</span>
              </h3>
              <button
                onClick={() => setResolvingEvent(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              {resolvingEvent.conflict_reason || "Simultaneous modification detected between workstation and central database."}
            </p>

            {/* Side-by-side Payload Diff Viewer */}
            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-700 mb-2">
                  <Laptop className="w-3.5 h-3.5 text-blue-500" />
                  <span>Offline Terminal Payload (Local)</span>
                </div>
                <pre className="text-[11px] overflow-x-auto text-slate-600 dark:text-slate-300">
                  {JSON.stringify(resolvingEvent.client_data, null, 2)}
                </pre>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300 pb-2 border-b border-slate-200 dark:border-slate-700 mb-2">
                  <Server className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Central Cloud Payload (Server)</span>
                </div>
                <pre className="text-[11px] overflow-x-auto text-slate-600 dark:text-slate-300">
                  {JSON.stringify(resolvingEvent.server_data, null, 2)}
                </pre>
              </div>
            </div>

            {/* Resolution Strategy Selector */}
            <form onSubmit={handleResolveSubmit} className="space-y-4 text-xs pt-2">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Select Resolution Action *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "keep_cloud", label: "Keep Cloud Record", desc: "Server data wins. Client will pull cloud values." },
                    { id: "keep_local", label: "Keep Local Record", desc: "Client data overwrites cloud central database." },
                    { id: "merge", label: "Merge Fields", desc: "Combine selected fields manually." },
                  ].map((strat) => (
                    <div
                      key={strat.id}
                      onClick={() => setResolutionChoice(strat.id as any)}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        resolutionChoice === strat.id
                          ? "bg-brand-50/60 dark:bg-brand-950/40 border-brand-500 dark:border-brand-500 font-bold"
                          : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                      }`}
                    >
                      <div className="text-slate-900 dark:text-white">{strat.label}</div>
                      <div className="text-[10px] text-slate-400 font-normal mt-0.5">{strat.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {resolutionChoice === "merge" && (
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Custom Merged JSON Payload
                  </label>
                  <textarea
                    rows={4}
                    value={mergedJson}
                    onChange={(e) => setMergedJson(e.target.value)}
                    className="w-full p-2.5 font-mono text-xs rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setResolvingEvent(null)}
                  className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl shadow-sm"
                >
                  Commit Resolution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
