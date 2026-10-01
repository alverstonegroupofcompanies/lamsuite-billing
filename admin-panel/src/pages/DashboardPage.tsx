import React, { useEffect, useState } from "react";
import { api } from "../services/api";
import { formatINR, formatIndianNumber, formatDateTime } from "../utils/formatters";
import {
  TrendingUp,
  ShoppingBag,
  CreditCard,
  AlertTriangle,
  Clock,
  RefreshCw,
  Store,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";

interface DashboardData {
  sales: {
    today: { amount: number; count: number };
    week: { amount: number; count: number };
    month: { amount: number; count: number };
  };
  purchases: {
    today: number;
    week: number;
    month: number;
  };
  receivables: {
    total_outstanding: number;
  };
  alerts: {
    low_stock_count: number;
    near_expiry_count: number;
  };
  top_items: Array<{
    product_name: string;
    total_qty: number;
    total_revenue: number;
  }>;
  store_comparison: Array<{
    store_id: number;
    name: string;
    code: string;
    is_active: boolean;
    total_sales: number;
    invoices_count: number;
    active_devices: number;
    pending_sync: number;
    failed_sync: number;
    sync_status: string;
  }>;
  sync_health: {
    stores_online: number;
    total_active_stores: number;
    last_sync_at: string | null;
    pending_queue: number;
    failed_syncs: number;
    conflicts_count: number;
    status: string;
  };
}

export const DashboardPage: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDashboard = async () => {
    setIsLoading(true);
    try {
      const res = await api.get<DashboardData>("/admin/dashboard");
      setData(res);
    } catch (err) {
      console.error("Dashboard error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
        Loading real-time enterprise metrics...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title & Refresh */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Executive Operations Dashboard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Real-time multi-store telemetry, sales revenue, and sync connectivity.
          </p>
        </div>
        <button
          onClick={fetchDashboard}
          className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 shadow-2xs transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Live Data</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Sales */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Today Sales</span>
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              {formatINR(data.sales.today.amount)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
              <span>{formatIndianNumber(data.sales.today.count)} invoices issued today</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex justify-between text-[11px] text-slate-500">
            <span>Month: {formatINR(data.sales.month.amount)}</span>
            <span>Week: {formatINR(data.sales.week.amount)}</span>
          </div>
        </div>

        {/* Purchases Inward */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Inward Purchases</span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <ShoppingBag className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              {formatINR(data.purchases.today)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Stock inward received today
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex justify-between text-[11px] text-slate-500">
            <span>Month: {formatINR(data.purchases.month)}</span>
            <span>Week: {formatINR(data.purchases.week)}</span>
          </div>
        </div>

        {/* Outstanding Receivables */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Customer Dues</span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              {formatINR(data.receivables.total_outstanding)}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Active ledger balance outstanding
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-purple-600 dark:text-purple-400 flex items-center gap-1">
            <span>Pharmacy credit limit compliance active</span>
          </div>
        </div>

        {/* Stock & Expiry Alerts */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Catalog Warnings</span>
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div>
              <div className="text-2xl font-black text-amber-500">
                {data.alerts.low_stock_count}
              </div>
              <div className="text-[11px] text-slate-500">Low Stock SKUs</div>
            </div>
            <div className="h-8 w-px bg-slate-200 dark:bg-slate-800" />
            <div>
              <div className="text-2xl font-black text-rose-500">
                {data.alerts.near_expiry_count}
              </div>
              <div className="text-[11px] text-slate-500">Near Expiry (&lt;60d)</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-slate-400">
            Automated reorder triggers ready
          </div>
        </div>
      </div>

      {/* Sync Health Banner */}
      <div className="bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 text-white p-5 rounded-2xl border border-slate-700/80 shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/20 text-brand-400 flex items-center justify-center shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm">Offline-to-Cloud Sync Health</h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    data.sync_health.status === "healthy"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-amber-500/20 text-amber-300"
                  }`}
                >
                  {data.sync_health.status}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Stores Online: {data.sync_health.stores_online} / {data.sync_health.total_active_stores} |
                Last Heartbeat: {formatDateTime(data.sync_health.last_sync_at)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-center">
              <div className="text-slate-400 text-[10px]">Pending Queue</div>
              <div className="font-mono font-bold text-white">{data.sync_health.pending_queue}</div>
            </div>
            <div className="bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-center">
              <div className="text-slate-400 text-[10px]">Failed Syncs</div>
              <div className="font-mono font-bold text-rose-400">{data.sync_health.failed_syncs}</div>
            </div>
            <div className="bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-center">
              <div className="text-slate-400 text-[10px]">Conflicts</div>
              <div className="font-mono font-bold text-amber-400">{data.sync_health.conflicts_count}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Store Comparison & Top Selling Items */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Store Comparison Table (2 Cols) */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-brand-600" />
              <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                Store-wise Performance & Sync Connectivity
              </h3>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Store Name</th>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3 text-right">Month Sales</th>
                  <th className="px-4 py-3 text-center">Bills</th>
                  <th className="px-4 py-3 text-center">Devices</th>
                  <th className="px-4 py-3 text-center">Sync Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.store_comparison.map((s) => (
                  <tr key={s.store_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${s.is_active ? "bg-emerald-500" : "bg-red-500"}`} />
                        <span>{s.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500">{s.code}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">
                      {formatINR(s.total_sales)}
                    </td>
                    <td className="px-4 py-3 text-center font-mono">{formatIndianNumber(s.invoices_count)}</td>
                    <td className="px-4 py-3 text-center font-mono">{s.active_devices} Active</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${
                          s.sync_status === "healthy"
                            ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400"
                            : "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400"
                        }`}
                      >
                        {s.sync_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Items Ranking (1 Col) */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Top Revenue Items</h3>
            <span className="text-[10px] text-slate-400">All Stores</span>
          </div>

          <div className="mt-4 space-y-3">
            {data.top_items.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-400">No items recorded yet.</div>
            ) : (
              data.top_items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-bold text-[10px] text-slate-600 dark:text-slate-300">
                      {idx + 1}
                    </span>
                    <div>
                      <div className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                        {item.product_name}
                      </div>
                      <div className="text-[10px] text-slate-400">Qty: {formatIndianNumber(item.total_qty)} units</div>
                    </div>
                  </div>
                  <div className="text-right font-bold text-slate-900 dark:text-white">
                    {formatINR(item.total_revenue)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
