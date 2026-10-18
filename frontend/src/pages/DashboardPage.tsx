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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-[var(--color-text)]">Store Dashboard</h2>
              <span className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--color-accent)] uppercase tracking-wider border border-[var(--color-accent-soft)]">
                SQLite Offline Engine
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Live counter sales, payment tenders, statutory GST, and inventory metrics.
            </p>
          </div>

          {/* Sync Status Badge */}
          {metrics && (
            <div
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
                metrics.syncStatus.isOnline
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border-[var(--color-accent-soft)]"
                  : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]"
              }`}
            >
              {metrics.syncStatus.isOnline ? (
                <Wifi className="h-3 w-3 text-[var(--color-accent)]" />
              ) : (
                <WifiOff className="h-3 w-3 text-[var(--color-warning-text)]" />
              )}
              <span className="text-[11px] font-mono font-medium">{metrics.syncStatus.lastSyncedText}</span>
            </div>
          )}
        </div>

        {/* Period Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector */}
          <div className="flex items-center rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface-subtle)] p-0.5 text-xs font-semibold text-[var(--color-text-muted)]">
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
                className={`rounded-[8px] px-2.5 py-1 transition-colors cursor-pointer ${
                  periodType === p.id
                    ? "bg-[var(--color-accent)] text-white shadow-xs font-bold"
                    : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
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
                className="h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs font-medium text-[var(--color-text)]"
              />
              <span className="text-[var(--color-text-muted)]">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs font-medium text-[var(--color-text)]"
              />
            </div>
          )}

          {/* Refresh Button */}
          <button
            onClick={loadData}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors shadow-2xs disabled:opacity-50 cursor-pointer"
            title="Refresh live metrics from SQLite database"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-[var(--color-accent)]" : "text-[var(--color-text-muted)]"}`} />
            <span>{isLoading ? "Refreshing..." : "Refresh"}</span>
          </button>

          {/* Quick Sale / Purchase Buttons */}
          <Link
            to="/pos"
            className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            <span>New Sale (F1)</span>
          </Link>

          <Link
            to="/purchases"
            className="flex items-center gap-1.5 rounded-[10px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-text)] shadow-xs hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <PackagePlus className="h-3.5 w-3.5 text-[var(--color-accent)]" />
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
            <div key={i} className="h-28 rounded-[14px] bg-[var(--color-surface-subtle)]" />
          ))}
        </div>
      ) : (
        /* KPI Stats Cards */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Net Sales */}
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs hover:border-[var(--color-accent)]/50 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                {metrics?.period.label} Net Sales
              </span>
              <div className="rounded-[8px] bg-[var(--color-accent-soft)] p-2 text-[var(--color-accent)]">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[30px] font-bold font-mono text-[var(--color-text)] tabular-nums leading-tight">
              {canViewFinancials ? formatMoney(metrics?.netSales || 0) : "••••••"}
            </p>
            <div className="mt-1 flex items-center justify-between text-xs">
              {metrics?.salesDeltaPercent !== null ? (
                <span
                  className={`flex items-center gap-0.5 font-bold font-mono ${
                    (metrics?.salesDeltaPercent || 0) >= 0 ? "text-[var(--color-success-text)]" : "text-[var(--color-danger-text)]"
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
                <span className="text-[var(--color-text-muted)] font-medium">No previous data</span>
              )}

              {(metrics?.totalReturns || 0) > 0 && (
                <span className="text-[var(--color-danger-text)] text-[11px] font-mono font-medium">
                  Returns: {formatMoney(metrics?.totalReturns || 0)}
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Bills Issued */}
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs hover:border-[var(--color-accent)]/50 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Bills Issued</span>
              <div className="rounded-[8px] bg-[var(--color-accent-soft)] p-2 text-[var(--color-accent)]">
                <Receipt className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[30px] font-bold font-mono text-[var(--color-text)] tabular-nums leading-tight">{metrics?.billsIssuedCount || 0}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1 font-medium">
              Average ticket <span className="font-mono font-bold text-[var(--color-text)]">{canViewFinancials ? formatMoney(metrics?.averageTicket || 0) : "••••"}</span>
            </p>
          </div>

          {/* Card 3: Digital / Cash Split */}
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs hover:border-[var(--color-accent)]/50 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Digital / Cash Split</span>
              <div className="rounded-[8px] bg-[var(--color-surface-subtle)] p-2 text-[var(--color-accent)]">
                <CreditCard className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-2 text-[26px] font-bold font-mono text-[var(--color-text)] tabular-nums leading-tight">
              {canViewFinancials
                ? `${formatCompact(metrics?.payments.digitalTotal || 0)} / ${formatCompact(metrics?.payments.cash || 0)}`
                : "••••"}
            </p>
            <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
              <span className="font-medium font-mono">{metrics?.payments.digitalPercent || 0}% Digital Collections</span>
              {(metrics?.payments.credit || 0) > 0 && (
                <span className="text-[var(--color-warning-text)] font-semibold font-mono">Credit: {formatCompact(metrics?.payments.credit || 0)}</span>
              )}
            </div>
          </div>

          {/* Card 4: Near Expiry Batches */}
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs hover:border-[var(--color-accent)]/50 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                Near Expiry ({metrics?.nearExpiry.thresholdDays || 60}D)
              </span>
              <div
                className={`rounded-[8px] p-2 ${
                  (metrics?.nearExpiry.count || 0) > 0 ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]" : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)]"
                }`}
              >
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>
            <p
              className={`mt-2 text-[30px] font-bold font-mono tabular-nums leading-tight ${
                (metrics?.nearExpiry.count || 0) > 0 ? "text-[var(--color-warning-text)]" : "text-[var(--color-text)]"
              }`}
            >
              {metrics?.nearExpiry.count || 0} <span className="text-sm font-sans font-semibold text-[var(--color-text-muted)]">Batches</span>
            </p>
            <Link
              to="/stock"
              className="text-xs font-semibold text-[var(--color-accent)] hover:underline mt-1 inline-block"
            >
              View expiry ledger (F3) →
            </Link>
          </div>
        </div>
      )}

      {/* Main Grid: Recent Transactions & Statutory Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent Completed Invoices & Returns (2 cols) */}
        <div className="lg:col-span-2 rounded-card border border-border-main bg-surface shadow-2xs overflow-hidden flex flex-col">
          <div className="flex flex-wrap items-center justify-between border-b border-border-main px-4 py-3 gap-2 bg-canvas">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-bold text-text-main">Recent Completed Invoices & Returns</h3>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-text-muted" />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter bills, customers..."
                  className="h-7.5 w-48 rounded-btn border border-border-main bg-surface pl-8 pr-2.5 text-xs font-medium text-text-main placeholder-text-muted focus:border-accent focus:outline-none"
                />
              </div>
              <Link
                to="/bills"
                className="text-xs font-bold text-accent hover:underline whitespace-nowrap"
              >
                All Bills (F6) →
              </Link>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto max-h-[380px]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-canvas text-text-muted border-b border-border-main z-10">
                <tr>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider">Document No</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider">Date / Time</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider">Customer</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-right">Amount</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider">Tender</th>
                  <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {filteredDocuments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-text-muted">
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
                        className="hover:bg-surface-hover transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-2.5 font-bold font-mono">
                          <div className="flex items-center gap-1.5">
                            <span className={isReturn ? "text-[var(--color-danger-text)]" : "text-accent"}>{doc.documentNumber}</span>
                            {isReturn && (
                              <span className="rounded-btn bg-[var(--color-danger-bg)] px-1.5 py-0.2 text-[9px] font-bold text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
                                RETURN
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-text-muted font-mono text-[11px]">
                          {doc.time ? `${doc.date} ${doc.time}` : doc.date}
                        </td>
                        <td className="px-4 py-2.5 text-text-main font-semibold truncate max-w-[150px]">
                          {doc.customerName}
                        </td>
                        <td
                          className={`px-4 py-2.5 font-bold font-mono text-right tabular-nums ${
                            isReturn ? "text-[var(--color-danger-text)]" : "text-text-main"
                          }`}
                        >
                          {isReturn ? `- ${formatMoney(Math.abs(doc.amount))}` : formatMoney(doc.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-text-muted capitalize">{doc.paymentMode}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase ${
                              doc.paymentStatus === "cancelled"
                                ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]"
                                : doc.paymentStatus === "unpaid"
                                ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                                : "bg-accent-soft text-accent border border-accent/20"
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
          <div className="rounded-card border border-border-main bg-surface p-4 shadow-2xs">
            <div className="flex items-center justify-between mb-3 border-b border-border-main pb-2">
              <h3 className="text-sm font-bold text-text-main">Statutory GST Quick View</h3>
              <span className="rounded-full bg-canvas border border-border-main px-2 py-0.5 text-[10px] font-mono font-semibold text-text-muted">
                {metrics?.period.label}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              {metrics?.gst.slabs.length === 0 ? (
                <div className="py-4 text-center text-text-muted">
                  <p>No taxable sales recorded in this period.</p>
                  <p className="text-[11px] text-text-faint font-mono mt-1">₹ 0.00 Tax Accrued</p>
                </div>
              ) : (
                metrics?.gst.slabs.map((slab) => (
                  <div key={slab.rate} className="flex items-center justify-between py-1 border-b border-border-subtle">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-text-main">GST {slab.rate}%:</span>
                      <span className="text-text-muted font-mono text-[11px]">
                        (Taxable: {formatCompact(slab.taxableValue)})
                      </span>
                    </div>
                    <span className="font-bold font-mono text-text-main">{formatMoney(slab.totalTax)}</span>
                  </div>
                ))
              )}

              <div className="flex justify-between py-2 font-bold font-mono text-accent pt-2 border-t border-border-main text-sm">
                <span>Total Tax Accrued:</span>
                <span>{formatMoney(metrics?.gst.totalTaxAccrued || 0)}</span>
              </div>
            </div>

            <Link
              to="/reports"
              className="mt-3 block text-center rounded-btn bg-canvas py-2 text-xs font-semibold text-text-main hover:bg-surface-hover transition-colors border border-border-main"
            >
              Generate GSTR-1 & HSN Summary (F4) →
            </Link>
          </div>

          {/* Quick Operational Actions & Held Bills */}
          <div className="rounded-card border border-border-main bg-surface p-4 shadow-2xs space-y-3">
            <h3 className="text-[11px] font-bold text-text-muted uppercase tracking-wider">Quick Operational Actions</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                to="/returns/sales"
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface p-2 font-semibold text-text-main hover:bg-surface-hover transition-colors"
              >
                <DollarSign className="h-3.5 w-3.5 text-accent shrink-0" />
                <span>Sales Return</span>
              </Link>

              <Link
                to="/returns/debit-notes"
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface p-2 font-semibold text-text-main hover:bg-surface-hover transition-colors"
              >
                <Building2 className="h-3.5 w-3.5 text-accent shrink-0" />
                <span>B2B Returns</span>
              </Link>

              <Link
                to="/stock"
                className="flex items-center gap-1.5 rounded-btn border border-border-main bg-surface p-2 font-semibold text-text-main hover:bg-surface-hover transition-colors"
              >
                <Layers className="h-3.5 w-3.5 text-accent shrink-0" />
                <span>Stock Ledger</span>
              </Link>

              <Link
                to="/pos"
                className="flex items-center justify-between rounded-btn border border-border-main bg-surface p-2 font-semibold text-text-main hover:bg-surface-hover transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <PauseCircle className="h-3.5 w-3.5 text-[var(--color-warning-text)] shrink-0" />
                  <span>Held Bills</span>
                </div>
                {(metrics?.heldBillsCount || 0) > 0 && (
                  <span className="rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)] px-1.5 py-0.2 text-[10px] font-bold font-mono">
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
