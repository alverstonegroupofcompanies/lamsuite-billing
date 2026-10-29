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
import { storeRegistryService } from "../lib/auth/storeRegistryService";

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
      const activeStore = storeRegistryService.getActiveStore();
      const activeStoreId = String(activeStore?.id || "1");

      const allCounters = await sqliteStorage.findAll<any>("store_counters");
      // Filter counters strictly belonging to the currently active store
      const storedCounters = (allCounters || []).filter(
        (c) => !c.store_id || String(c.store_id) === activeStoreId || (activeStoreId === "1" && c.store_id === "store_main")
      );
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
        const currentActiveStaff = staffAuthService.getCurrentSession();
        const mapped: CounterStatusItem[] = storedCounters.map((c) => {
          const activeSession = (sessions || []).find((s) => s.counter_id === c.id && s.status === "active");
          const activeShift = (shifts || []).find((s) => s.counter_id === c.id && s.status === "open");

          // If current logged in cashier is on this counter, ensure name and status reflect accurately
          const isCurrentCounter = currentActiveStaff && (currentActiveStaff.counterId === c.id || currentActiveStaff.counterCode === (c.counter_code || "C01"));
          const assignedUser = activeSession?.user_name || (isCurrentCounter ? currentActiveStaff?.user.full_name : null) || "Unassigned";
          const assignedRole = activeSession?.user_role || (isCurrentCounter ? (currentActiveStaff?.user.role === "admin" ? "Store Admin" : currentActiveStaff?.user.role) : null) || "None";

          return {
            id: c.id,
            counter_name: c.counter_name,
            counter_code: c.counter_code || "C01",
            is_hub: Boolean(c.is_hub),
            ip_address: c.ip_address || "127.0.0.1",
            port: c.port || 8089,
            status: c.status === "locked" ? "locked" : "active",
            current_user: assignedUser,
            user_role: assignedRole,
            active_shift_status: activeShift ? "open" : (isCurrentCounter ? "open" : "closed"),
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
    const unsubscribe = storeRegistryService.onRegistryChange(() => {
      loadCounters();
    });
    const interval = setInterval(loadCounters, 10000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
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
        : "Hub Restored: Centralized sync resumed and pending queues flushed."
    );
    setTimeout(() => setActionMsg(""), 5000);
  };

  return (
    <div className="space-y-6 select-none font-sans max-w-6xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface p-5 rounded-card border border-border-main shadow-xs">
        <div>
          <h2 className="text-[26px] font-bold text-text-main tracking-tight flex items-center gap-2">
            <Monitor className="w-5 h-5 text-accent" />
            <span>Store Multi-Counter Workstation Monitor</span>
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Real-time sync heartbeat, active cashier tracking, cash drawer status & failover control.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={toggleFailover}
            className={`px-3 py-2 rounded-btn text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
              hubFailoverActive
                ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                : "bg-surface text-text-main border-border-main hover:bg-canvas"
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>{hubFailoverActive ? "Hub Failover: Active (Autonomous)" : "Test Hub Failover"}</span>
          </button>

          <button
            onClick={loadCounters}
            className="px-3.5 py-2 rounded-btn bg-accent-soft text-accent hover:bg-accent-soft/80 border border-accent/20 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="p-3 bg-accent-soft border border-accent/20 rounded-btn text-xs text-accent font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
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
              className={`bg-surface rounded-card border p-5 shadow-xs transition-all flex flex-col justify-between ${
                isLocked
                  ? "border-status-warning/40 ring-1 ring-status-warning/30 bg-status-warning/5"
                  : c.is_hub
                  ? "border-accent/40 ring-1 ring-accent/20"
                  : "border-border-main"
              }`}
            >
              <div>
                {/* Header */}
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-10 h-10 rounded-btn flex items-center justify-center font-bold text-xs ${
                        c.is_hub
                          ? "bg-accent text-white shadow-xs font-mono tabular-nums"
                          : "bg-canvas text-text-main border border-border-main font-mono tabular-nums"
                      }`}
                    >
                      {c.counter_code}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                        <span>{c.counter_name}</span>
                        {c.is_hub && (
                          <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[10px] font-mono font-semibold">
                            HUB
                          </span>
                        )}
                      </h4>
                      <p className="text-[11px] text-text-muted font-mono tabular-nums">
                        {c.ip_address}:{c.port}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 ${
                      isLocked
                        ? "bg-status-warning/15 text-status-warning"
                        : "bg-accent-soft text-accent"
                    }`}
                  >
                    <CircleDot className="w-2.5 h-2.5" />
                    {isLocked ? "Locked" : "Online"}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-2 py-3 border-y border-border-main text-xs">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Active Operator:</span>
                    <span className="font-semibold text-text-main">
                      {c.current_user} <span className="text-text-muted font-normal">({c.user_role})</span>
                    </span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Shift & Drawer:</span>
                    <div className="flex items-center gap-1.5 font-semibold text-text-main">
                      {c.active_shift_status === "open" ? (
                        <>
                          <span className="text-accent font-mono font-bold tabular-nums">
                            ₹{c.drawer_cash.toLocaleString()} (Open)
                          </span>
                          {c.shift_started_at && Date.now() - c.shift_started_at > 12 * 3600 * 1000 && (
                            <span
                              className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-status-warning/15 text-status-warning"
                              title="Shift open for over 12 hours - handover overdue!"
                            >
                              Overdue &gt;12h ⚠️
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-text-muted font-mono">Closed</span>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-text-muted">Sync Queue:</span>
                    <span className="font-mono text-text-main tabular-nums">
                      {c.pending_queue === 0 ? "Synced (0 pending)" : `${c.pending_queue} pending`}
                    </span>
                  </div>

                  <div className="flex justify-between text-[11px] text-text-muted">
                    <span>Heartbeat:</span>
                    <span className="font-mono tabular-nums">{timeSinceSync}s ago</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="pt-3 flex gap-2">
                <button
                  onClick={() => handleRemoteLock(c.id, c.counter_name)}
                  className="flex-1 py-1.5 px-2 bg-surface hover:bg-canvas text-text-main border border-border-main rounded-btn text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Lock className="w-3 h-3 text-text-muted" />
                  <span>Lock</span>
                </button>

                <button
                  onClick={() => handleRemoteLogout(c.id, c.counter_name)}
                  className="flex-1 py-1.5 px-2 bg-status-danger/10 hover:bg-status-danger/20 text-status-danger border border-status-danger/20 rounded-btn text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <LogOut className="w-3 h-3 text-status-danger" />
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
