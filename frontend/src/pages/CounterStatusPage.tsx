import React, { useState } from "react";
import { Monitor, RefreshCw } from "lucide-react";
import { LoggedInDevicesTable } from "../components/devices/LoggedInDevicesTable";

export const CounterStatusPage: React.FC = () => {
  const [deviceCounts, setDeviceCounts] = useState<{ active: number; total: number }>({
    active: 0,
    total: 0,
  });

  return (
    <div className="space-y-6">
      {/* Title & Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-[var(--color-text)] flex items-center gap-2">
            <Monitor className="w-5 h-5 text-emerald-600" />
            <span>Counter Topology & Connected Workstations</span>
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Real-time backend connection status, signed-in cashiers, app versions, and synchronization health.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text-muted)]">
            <span>Active Workstations:</span>
            <span className="font-bold text-emerald-600 font-mono">
              {deviceCounts.active} / {deviceCounts.total}
            </span>
          </div>
        </div>
      </div>

      {/* Real-time backend connected devices table (Item 2) */}
      <LoggedInDevicesTable
        onDeviceCountChange={(active, total) => setDeviceCounts({ active, total })}
      />
    </div>
  );
};
