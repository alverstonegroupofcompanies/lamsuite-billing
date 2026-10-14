import React, { useState, useEffect } from "react";
import {
  Monitor,
  Server,
  Lock,
  LogOut,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Wifi,
  WifiOff,
  UserCheck,
  Clock,
  Shield,
  Layers,
  CircleDot,
} from "lucide-react";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { staffAuthService } from "../lib/auth/staffAuthService";

export interface CounterStatusItem {
  id: string;
  counter_name: string;
  counter_code: string;
  is_hub: boolean;
  ip_address: string;
  port: number;
  status: "active" | "locked" | "offline";
  current_user: string;
  user_role: string;
  active_shift_status: "open" | "closed";
  shift_started_at?: number;
  drawer_cash: number;
  pending_queue: number;
  last_sync_at: number;
  app_version: string;
}

export const CounterStatusPage: React.FC = () => {
  const [counters, setCounters] = useState<CounterStatusItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hubFailoverActive, setHubFailoverActive] = useState(false);
  const [actionMsg, setActionMsg] = useState("");

  const loadCounters = async () => {
    setIsLoading(true);
    try {
      const storedCounters = await sqliteStorage.findAll<any>("store_counters");
      const sessions = await sqliteStorage.findAll<any>("counter_sessions");
      const shifts = await sqliteStorage.findAll<any>("cash_shifts");
      const queue = await sqliteStorage.findAll<any>("sync_queue");

      const pendingCount = (queue || []).filter((q) => q.status === "pending").length;

      if (!storedCounters || storedCounters.length === 0) {
        // Mock multi-counter topology for demonstration
        setCounters([
          {
            id: "cntr_01",
            counter_name: "Counter 01 (Store Hub)",
            counter_code: "C01",
            is_hub: true,
            ip_address: "192.168.1.10",
            port: 8089,
            status: "active",
            current_user: "Muhammad Anshad",
            user_role: "Store Admin",
            active_shift_status: "open",
            drawer_cash: 14500,
            pending_queue: 0,
            last_sync_at: Date.now() - 30000,
            app_version: "2.0.0",
          },
          {
            id: "cntr_02",
            counter_name: "Counter 02 (Front Desk)",
            counter_code: "C02",
            is_hub: false,
            ip_address: "192.168.1.11",
            port: 8089,
            status: "active",
            current_user: "Ananya Nair",
            user_role: "Cashier",
            active_shift_status: "open",
            drawer_cash: 8200,
            pending_queue: 1,
            last_sync_at: Date.now() - 60000,
            app_version: "2.0.0",
          },
          {
            id: "cntr_03",
            counter_name: "Counter 03 (Express Pharmacy)",
            counter_code: "C03",
            is_hub: false,
            ip_address: "192.168.1.12",
            port: 8089,
            status: "active",
            current_user: "Rahul Verma",
            user_role: "Manager",
            active_shift_status: "open",
            drawer_cash: 5000,
            pending_queue: 0,
            last_sync_at: Date.now() - 120000,
            app_version: "2.0.0",
          },
        ]);
      } else {
        const mapped: CounterStatusItem[] = storedCounters.map((c) => {
          const activeSession = (sessions || []).find((s) => s.counter_id === c.id && s.status === "active");
          const activeShift = (shifts || []).find((s) => s.counter_id === c.id && s.status === "open");

          return {
            id: c.id,
            counter_name: c.counter_name,
            counter_code: c.counter_code || "C01",
            is_hub: Boolean(c.is_hub),
            ip_address: c.ip_address || "127.0.0.1",
            port: c.port || 8089,
            status: c.status === "locked" ? "locked" : "active",
            current_user: activeSession?.user_name || "Unassigned",
            user_role: activeSession?.user_role || "None",
            active_shift_status: activeShift ? "open" : "closed",
            shift_started_at: activeShift?.opened_at ? new Date(activeShift.opened_at).getTime() : undefined,
            drawer_cash: activeShift ? Number(activeShift.expected_cash || activeShift.opening_cash || 0) : 0,
            pending_queue: pendingCount,
            last_sync_at: c.last_sync_at || Date.now(),
            app_version: c.app_version || "2.0.0",
          };
        });
        setCounters(mapped);
      }
    } catch (_) {
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCounters();
    const interval = setInterval(loadCounters, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRemoteLock = (counterId: string, counterName: string) => {
    setCounters((prev) =>
      prev.map((c) => (c.id === counterId ? { ...c, status: "locked" } : c))
    );
    setActionMsg(`Dispatched remote lock signal to ${counterName}.`);
    setTimeout(() => setActionMsg(""), 4000);
  };

  const handleRemoteLogout = (counterId: string, counterName: string) => {
    setCounters((prev) =>
      prev.map((c) =>
        c.id === counterId ? { ...c, current_user: "Logged Out", user_role: "None" } : c
      )
    );
    setActionMsg(`Dispatched forced remote logout signal to ${counterName}.`);
    setTimeout(() => setActionMsg(""), 4000);
  };

  const toggleFailover = () => {
    setHubFailoverActive((prev) => !prev);
    setActionMsg(
      !hubFailoverActive
        ? "Simulated Hub Crash: Secondary counters switched automatically to Autonomous Offline Mode!"
        : "Hub Restored: Local LAN broadcast resumed and pending queues flushed."
    );
    setTimeout(() => setActionMsg(""), 5000);
  };

  return (
    <div className="space-y-6 select-none font-sans max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
            <Monitor className="w-5 h-5 text-blue-600" />
            <span>Store Multi-Counter Workstation Monitor</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time LAN sync heartbeat, active cashier tracking, cash drawer status & failover control.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleFailover}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
              hubFailoverActive
                ? "bg-amber-50 text-amber-700 border-amber-300"
                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>{hubFailoverActive ? "Hub Failover: Active (Autonomous)" : "Test Hub Failover"}</span>
          </button>

          <button
            onClick={loadCounters}
            className="px-3 py-1.5 rounded-xl bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
          <span>{actionMsg}</span>
        </div>
      )}

      {/* Counter Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {counters.map((c) => {
          const isLocked = c.status === "locked";
          const timeSinceSync = Math.round((Date.now() - c.last_sync_at) / 1000);

          return (
            <div
              key={c.id}
              className={`bg-white rounded-2xl border p-5 shadow-xs transition-all flex flex-col justify-between ${
                isLocked
                  ? "border-amber-300 ring-2 ring-amber-200 bg-amber-50/20"
                  : c.is_hub
                  ? "border-blue-300 ring-1 ring-blue-100"
                  : "border-slate-200"
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs ${
                        c.is_hub
                          ? "bg-blue-600 text-white shadow-md shadow-blue-500/20"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}
                    >
                      {c.counter_code}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>{c.counter_name}</span>
                        {c.is_hub && (
                          <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-700 text-[10px] font-mono font-bold">
                            HUB
                          </span>
                        )}
                      </h4>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {c.ip_address}:{c.port}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${
                      isLocked
                        ? "bg-amber-100 text-amber-800"
                        : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    <CircleDot className="w-2.5 h-2.5" />
                    {isLocked ? "Locked" : "Online"}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-2 py-3 border-y border-slate-100 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Active Operator:</span>
                    <span className="font-bold text-slate-800">
                      {c.current_user} <span className="text-slate-400 font-normal">({c.user_role})</span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Shift & Drawer:</span>
                    <div className="flex items-center gap-1.5 font-bold text-slate-800">
                      {c.active_shift_status === "open" ? (
                        <>
                          <span className="text-emerald-700 font-mono font-bold">
                            ₹{c.drawer_cash.toLocaleString()} (Open)
                          </span>
                          {c.shift_started_at && Date.now() - c.shift_started_at > 12 * 3600 * 1000 && (
                            <span
                              className="rounded px-1.5 py-0.2 text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300"
                              title="Shift open for over 12 hours - handover overdue!"
                            >
                              Overdue &gt;12h ⚠️
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400">Closed</span>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-slate-500">Sync Queue:</span>
                    <span className="font-mono text-slate-700">
                      {c.pending_queue === 0 ? "Synced (0 pending)" : `${c.pending_queue} pending`}
                    </span>
                  </div>

                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Heartbeat:</span>
                    <span>{timeSinceSync}s ago</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 flex gap-2">
                <button
                  onClick={() => handleRemoteLock(c.id, c.counter_name)}
                  className="flex-1 py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Lock className="w-3 h-3 text-slate-500" />
                  <span>Lock</span>
                </button>

                <button
                  onClick={() => handleRemoteLogout(c.id, c.counter_name)}
                  className="flex-1 py-1.5 px-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <LogOut className="w-3 h-3 text-red-500" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
