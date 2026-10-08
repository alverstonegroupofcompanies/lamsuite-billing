import React, { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  TrendingUp,
  Receipt,
  AlertTriangle,
  CreditCard,
  PlusCircle,
  PackagePlus,
  RefreshCw,
  FileText,
  Clock,
  CheckCircle,
  DollarSign,
  Building2,
  Calendar,
  Search,
  ArrowDownRight,
  ArrowUpRight,
  ShieldAlert,
  Wifi,
  WifiOff,
  Layers,
  PauseCircle,
} from "lucide-react";
import { dashboardMetricsService, type DashboardMetricsResult } from "../lib/dashboard/dashboardMetricsService";
import { operatorAuthService } from "../lib/auth/operatorAuthService";

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [periodType, setPeriodType] = useState<"today" | "yesterday" | "this_week" | "this_month" | "custom">("today");
  const [customStart, setCustomStart] = useState<string>(dashboardMetricsService.formatLocalDate(new Date()));
  const [customEnd, setCustomEnd] = useState<string>(dashboardMetricsService.formatLocalDate(new Date()));
  const [filterQuery, setFilterQuery] = useState("");

  const [metrics, setMetrics] = useState<DashboardMetricsResult | null>(null);

  const currentUser = operatorAuthService.getSession()?.user;
  const userRole = currentUser?.role || "admin";
  const canViewFinancials = userRole === "admin" || userRole === "manager" || userRole === "pharmacist";

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await dashboardMetricsService.getDashboardMetrics(periodType, customStart, customEnd);
      setMetrics(data);
    } catch (err) {
      console.error("Failed to load dashboard metrics:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load database metrics");
    } finally {
      setIsLoading(false);
    }
  }, [periodType, customStart, customEnd]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Format currency helpers
  const formatMoney = (amount: number): string => {
    return `₹ ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatCompact = (amount: number): string => {
    if (amount >= 100000) {
      return `₹ ${(amount / 100000).toFixed(2)}L`;
    }
    if (amount >= 1000) {
      return `₹ ${(amount / 1000).toFixed(1)}k`;
    }
    return `₹ ${amount.toFixed(0)}`;
  };

  const filteredDocuments = (metrics?.recentDocuments || []).filter((doc) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      doc.documentNumber.toLowerCase().includes(q) ||
      doc.customerName.toLowerCase().includes(q) ||
      doc.paymentMode.toLowerCase().includes(q) ||
      doc.paymentStatus.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Top Action & Period Control Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-slate-800">Store Dashboard</h2>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase tracking-wider border border-emerald-200">
                SQLite Offline Engine
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Live counter sales, payment tenders, statutory GST, and inventory metrics.
            </p>
          </div>

          {/* Sync Status Badge */}
          {metrics && (
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                metrics.syncStatus.isOnline
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              {metrics.syncStatus.isOnline ? (
                <Wifi className="h-3 w-3 text-blue-600" />
              ) : (
                <WifiOff className="h-3 w-3 text-amber-600" />
              )}
              <span className="text-[11px] font-medium">{metrics.syncStatus.lastSyncedText}</span>
            </div>
          )}
        </div>

        {/* Period Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold text-slate-600">
            {(
              [
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "this_week", label: "This Week" },
                { id: "this_month", label: "This Month" },
                { id: "custom", label: "Custom" },
              ] as const
            ).map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriodType(p.id)}
                className={`rounded-md px-2.5 py-1 transition-colors cursor-pointer ${
                  periodType === p.id
                    ? "bg-white text-blue-600 shadow-xs font-bold"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom Date Inputs if Custom is selected */}
          {periodType === "custom" && (
            <div className="flex items-center gap-1.5 text-xs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-700"
              />
            </div>
          )}

          {/* Refresh Button */}
          <button
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            title="Refresh live metrics from SQLite database"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-blue-600" : "text-slate-500"}`} />
            <span>{isLoading ? "Refreshing..." : "Refresh"}</span>
          </button>

          {/* Quick Sale / Purchase Buttons */}
          <Link
            to="/pos"
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 transition-colors"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>New Sale (F1)</span>
          </Link>

          <Link
            to="/purchases"
            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-900 transition-colors"
          >
            <PackagePlus className="h-3.5 w-3.5" />
            <span>Inward (F2)</span>
          </Link>
        </div>
      </div>

      {/* Error State Banner */}
      {errorMessage && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <ShieldAlert className="h-5 w-5 shrink-0 text-red-500" />
          <div className="flex-1">
            <p className="font-bold">Database Error Loading Dashboard</p>
            <p>{errorMessage}</p>
          </div>
          <button
            onClick={loadData}
            className="rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeletons */}
      {isLoading && !metrics ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-lg bg-slate-200" />
          ))}
        </div>
      ) : (
        /* KPI Stats Cards */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Net Sales */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                {metrics?.period.label} Net Sales
              </span>
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">
              {canViewFinancials ? formatMoney(metrics?.netSales || 0) : "••••••"}
            </p>
            <div className="mt-1 flex items-center justify-between text-xs">
              {metrics?.salesDeltaPercent !== null ? (
                <span
                  className={`flex items-center gap-0.5 font-bold ${
                    (metrics?.salesDeltaPercent || 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {(metrics?.salesDeltaPercent || 0) >= 0 ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  )}
                  {Math.abs(metrics?.salesDeltaPercent || 0)}% vs previous
                </span>
              ) : (
                <span className="text-slate-400 font-medium">No previous data</span>
              )}

              {(metrics?.totalReturns || 0) > 0 && (
                <span className="text-rose-500 text-[11px] font-medium">
                  Returns: {formatMoney(metrics?.totalReturns || 0)}
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Bills Issued */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Bills Issued</span>
              <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
                <Receipt className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-800">{metrics?.billsIssuedCount || 0}</p>
            <p className="text-xs text-slate-500 mt-1 font-medium">
              Average ticket {canViewFinancials ? formatMoney(metrics?.averageTicket || 0) : "••••"}
            </p>
          </div>

          {/* Card 3: Digital / Cash Split */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Digital / Cash Split</span>
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                <CreditCard className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-xl font-bold text-slate-800">
              {canViewFinancials
                ? `${formatCompact(metrics?.payments.digitalTotal || 0)} / ${formatCompact(metrics?.payments.cash || 0)}`
                : "••••"}
            </p>
            <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
              <span className="font-medium">{metrics?.payments.digitalPercent || 0}% Digital Collections</span>
              {(metrics?.payments.credit || 0) > 0 && (
                <span className="text-amber-600 font-semibold">Credit: {formatCompact(metrics?.payments.credit || 0)}</span>
              )}
            </div>
          </div>

          {/* Card 4: Near Expiry Batches */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                Near Expiry ({metrics?.nearExpiry.thresholdDays || 60}D)
              </span>
              <div
                className={`rounded-lg p-2 ${
                  (metrics?.nearExpiry.count || 0) > 0 ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400"
                }`}
              >
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>
            <p
              className={`mt-2 text-2xl font-extrabold ${
                (metrics?.nearExpiry.count || 0) > 0 ? "text-amber-600" : "text-slate-700"
              }`}
            >
              {metrics?.nearExpiry.count || 0} <span className="text-sm font-semibold text-slate-500">Batches</span>
            </p>
            <Link
              to="/stock"
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 hover:underline mt-1 inline-block"
            >
              View expiry ledger (F3) →
            </Link>
          </div>
        </div>
      )}

      {/* Main Grid: Recent Transactions & Statutory Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent Completed Invoices & Returns (2 cols) */}
        <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden flex flex-col">
          <div className="flex flex-wrap items-center justify-between border-b border-slate-200 px-4 py-3 gap-2 bg-slate-50/50">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <h3 className="text-sm font-bold text-slate-800">Recent Completed Invoices & Returns</h3>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter bills, customers..."
                  className="h-7.5 w-44 rounded-md border border-slate-200 bg-white pl-8 pr-2 text-xs font-medium text-slate-700 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                />
              </div>
              <Link
                to="/bills"
                className="text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
              >
                All Bills (F6) →
              </Link>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto max-h-[380px]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Document No</th>
                  <th className="px-4 py-2.5 font-semibold">Date / Time</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Amount</th>
                  <th className="px-4 py-2.5 font-semibold">Tender</th>
                  <th className="px-4 py-2.5 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDocuments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      {filterQuery ? "No records matching filter." : "No transactions recorded yet in the database."}
                    </td>
                  </tr>
                ) : (
                  filteredDocuments.map((doc) => {
                    const isReturn = doc.documentType === "sales_return" || doc.documentType === "credit_note";
                    return (
                      <tr
                        key={doc.id}
                        onClick={() => navigate("/bills")}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-2.5 font-bold">
                          <div className="flex items-center gap-1.5">
                            <span className={isReturn ? "text-rose-600" : "text-blue-600"}>{doc.documentNumber}</span>
                            {isReturn && (
                              <span className="rounded bg-rose-50 px-1 py-0.5 text-[9px] font-bold text-rose-700 border border-rose-200">
                                RETURN
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {doc.time ? `${doc.date} ${doc.time}` : doc.date}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700 font-medium truncate max-w-[150px]">
                          {doc.customerName}
                        </td>
                        <td
                          className={`px-4 py-2.5 font-bold text-right ${
                            isReturn ? "text-rose-600" : "text-slate-800"
                          }`}
                        >
                          {isReturn ? `- ${formatMoney(Math.abs(doc.amount))}` : formatMoney(doc.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 capitalize">{doc.paymentMode}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              doc.paymentStatus === "cancelled"
                                ? "bg-red-50 text-red-700 border border-red-200"
                                : doc.paymentStatus === "unpaid"
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}
                          >
                            {doc.paymentStatus}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Reports & Statutory Tax View (1 col) */}
        <div className="space-y-4">
          {/* Statutory GST Widget */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-800">Statutory GST Quick View</h3>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-slate-600">
                {metrics?.period.label}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {metrics?.gst.slabs.length === 0 ? (
                <div className="py-4 text-center text-slate-400">
                  <p>No taxable sales recorded in this period.</p>
                  <p className="text-[11px] text-slate-300 mt-1">₹ 0.00 Tax Accrued</p>
                </div>
              ) : (
                metrics?.gst.slabs.map((slab) => (
                  <div key={slab.rate} className="flex items-center justify-between py-1 border-b border-slate-50">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-slate-700">GST {slab.rate}%:</span>
                      <span className="text-slate-400 text-[11px]">
                        (Taxable: {formatCompact(slab.taxableValue)})
                      </span>
                    </div>
                    <span className="font-bold text-slate-800">{formatMoney(slab.totalTax)}</span>
                  </div>
                ))
              )}

              <div className="flex justify-between py-2 font-bold text-blue-700 pt-2 border-t border-slate-200">
                <span>Total Tax Accrued:</span>
                <span>{formatMoney(metrics?.gst.totalTaxAccrued || 0)}</span>
              </div>
            </div>

            <Link
              to="/reports"
              className="mt-3 block text-center rounded-lg bg-slate-50 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors border border-slate-200"
            >
              Generate GSTR-1 & HSN Summary (F4) →
            </Link>
          </div>

          {/* Quick Operational Actions & Held Bills */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs space-y-3">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Quick Operational Actions</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                to="/returns/sales"
                className="flex items-center gap-1.5 rounded-md border border-slate-200 p-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <DollarSign className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>Sales Return</span>
              </Link>

              <Link
                to="/returns/debit-notes"
                className="flex items-center gap-1.5 rounded-md border border-slate-200 p-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Building2 className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                <span>B2B Returns</span>
              </Link>

              <Link
                to="/stock"
                className="flex items-center gap-1.5 rounded-md border border-slate-200 p-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Layers className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>Stock Ledger</span>
              </Link>

              <Link
                to="/pos"
                className="flex items-center justify-between rounded-md border border-slate-200 p-2 font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <PauseCircle className="h-3.5 w-3.5 text-orange-600 shrink-0" />
                  <span>Held Bills</span>
                </div>
                {(metrics?.heldBillsCount || 0) > 0 && (
                  <span className="rounded-full bg-orange-100 px-1.5 py-0.2 text-[10px] font-bold text-orange-700">
                    {metrics?.heldBillsCount}
                  </span>
                )}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
