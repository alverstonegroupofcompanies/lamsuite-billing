import React, { useEffect, useState } from "react";
import { Device } from "../types";
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
  ShieldAlert,
  RotateCw,
} from "lucide-react";

export const DevicesPage: React.FC = () => {
  const { hasPermission } = useAuth();
  const [devices, setDevices] = useState<Device[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    device: Device | null;
    action: "approve" | "revoke";
  }>({ isOpen: false, device: null, action: "revoke" });

  const fetchDevices = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<{ data: Device[] }>("/admin/devices", {
        search,
        status: statusFilter,
      });
      setDevices(res.data || []);
    } catch (err) {
      console.error("Failed to load devices:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [search, statusFilter]);

  const handleStatusChange = async (reason: string) => {
    const { device, action } = confirmModal;
    if (!device) return;

    try {
      const newStatus = action === "approve" ? "active" : "revoked";
      await api.post(`/admin/devices/${device.id}/status`, {
        status: newStatus,
        reason,
      });
      await fetchDevices();
    } catch (err: any) {
      alert(err?.message || "Failed to update device status.");
    }
  };

  const handleForceResync = async (device: Device) => {
    try {
      await api.post(`/admin/devices/${device.id}/force-resync`);
      alert(`Forced re-sync triggered for device '${device.device_name}'. Workstation will pull complete catalog delta on next poll.`);
      await fetchDevices();
    } catch (err: any) {
      alert(err?.message || "Failed to force resync.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Device & Counter Workstations
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Hardware fingerprints, app versions, heartbeat monitor, and remote access revocation.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search device name, UUID, IP..."
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
            <option value="pending">Pending Only</option>
            <option value="revoked">Revoked Only</option>
          </select>

          <button
            onClick={fetchDevices}
            className="p-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Devices Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Workstation / Store</th>
                <th className="px-4 py-3">Hardware UUID</th>
                <th className="px-4 py-3">App Version</th>
                <th className="px-4 py-3">Last Seen / Sync</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    Loading devices...
                  </td>
                </tr>
              ) : devices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No devices registered.
                  </td>
                </tr>
              ) : (
                devices.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Cpu className="w-3.5 h-3.5 text-brand-600" />
                        <span>{d.device_name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400">{d.store?.name || "Unassigned"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{d.device_uuid}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                        v{d.app_version}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>Seen: {formatDateTime(d.last_seen_at)}</div>
                      <div className="text-[10px] text-slate-400">Sync: {formatDateTime(d.last_sync_at)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          d.status === "active"
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                            : d.status === "pending"
                            ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400"
                            : "bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-400"
                        }`}
                      >
                        {d.status === "active" && <CheckCircle2 className="w-3 h-3" />}
                        {d.status === "pending" && <Clock className="w-3 h-3" />}
                        {d.status === "revoked" && <XCircle className="w-3 h-3" />}
                        <span className="capitalize">{d.status}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {hasPermission("devices", "edit") && (
                          <>
                            <button
                              onClick={() => handleForceResync(d)}
                              title="Force Cloud Delta Re-Sync"
                              className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                            >
                              <RotateCw className="w-3.5 h-3.5" />
                            </button>

                            {d.status !== "active" ? (
                              <button
                                onClick={() =>
                                  setConfirmModal({
                                    isOpen: true,
                                    device: d,
                                    action: "approve",
                                  })
                                }
                                title="Approve Device"
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[10px]"
                              >
                                Approve
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  setConfirmModal({
                                    isOpen: true,
                                    device: d,
                                    action: "revoke",
                                  })
                                }
                                title="Revoke Device Access"
                                className="px-2.5 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-[10px]"
                              >
                                Revoke
                              </button>
                            )}
                          </>
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

      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
        onConfirm={handleStatusChange}
        title={
          confirmModal.action === "revoke"
            ? `Revoke Access: ${confirmModal.device?.device_name}`
            : `Approve Device: ${confirmModal.device?.device_name}`
        }
        message={
          confirmModal.action === "revoke"
            ? "Revoking device access will immediately terminate its offline sync privileges and invalidate its bearer authentication keys. A mandatory reason is recorded in the audit log."
            : "Approving this workstation will activate its bidirectional synchronization capabilities."
        }
        danger={confirmModal.action === "revoke"}
        confirmText={confirmModal.action === "revoke" ? "Confirm Revocation" : "Approve Workstation"}
        requireReason={true}
      />
    </div>
  );
};
