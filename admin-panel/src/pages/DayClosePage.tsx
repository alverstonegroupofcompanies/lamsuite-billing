import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Eye,
  Lock,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Wallet,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatDateTime, formatINR } from "../utils/formatters";
import { RowAction } from "../components/RowAction";
import { RecordInspector } from "../components/RecordInspector";

interface TenderRow {
  collected: number;
  refunded: number;
  net: number;
  pending: number;
  receipts: number;
}

interface DayCloseSummary {
  store_id: number;
  store_name: string | null;
  close_date: string;
  sales: {
    gross_total: number;
    tax_total: number;
    discount_total: number;
    bills_count: number;
  };
  returns: { count: number; total: number };
  tenders: Record<string, TenderRow>;
  cash: {
    opening_float: number;
    cash_sales: number;
    cash_refunds: number;
    cash_expenses: number;
    cash_drops: number;
    expected: number;
  };
  totals: {
    cash_collected: number;
    digital_collected: number;
    credit_sales: number;
    refunds: number;
    pending_clearance: number;
  };
  counters: Array<{
    counter_code: string | null;
    counter_id: number | null;
    counter_name: string;
    location_name: string | null;
    bills_count: number;
    gross_total: number;
    tax_total: number;
    cash_net: number;
    digital_net: number;
    refunds: number;
  }>;
  shifts: Array<{
    id: number;
    counter_id: number | null;
    status: string;
    opening_float: number;
    cash_sales: number;
    digital_sales: number;
    cash_refunds: number;
    cash_drops: number;
    expected_cash: number;
    counted_cash: number | null;
    variance: number | null;
    opened_at: string | null;
    closed_at: string | null;
  }>;
  saved: {
    id: number;
    status: "open" | "closed" | "reconciled";
    counted_cash: number | null;
    cash_variance: number;
    locked_at: string | null;
    reconciliation_notes: string | null;
    closed_by_user_id: number | null;
  } | null;
}

interface HistoryRow {
  id: number;
  close_date: string;
  status: string;
  gross_sales: number;
  cash_collected: number;
  digital_collected: number;
  refunds: number;
  expected_cash: number;
  counted_cash: number | null;
  cash_variance: number;
  bills_count: number;
  locked_at: string | null;
}

const TENDER_LABELS: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  credit: "Credit / Khata",
  wallet: "Wallet",
  gift_card: "Gift Card",
  bank: "Bank / NEFT",
  other: "Other",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600",
  closed: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  reconciled: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
};

type InspectorRequest = Omit<React.ComponentProps<typeof RecordInspector>, "onClose">;

/**
 * DCL-04 — a closed day stays readable after the panel has moved on to today.
 *
 * The history row already carries the money that close posted, so the row opens it directly instead
 * of making the operator re-pick the date and wait for the summary endpoint.
 */
const inspectDayClose = (row: HistoryRow): InspectorRequest => ({
  kind: "Day close",
  heading: row.close_date,
  subheading: row.status,
  row,
  fields: (record) => [
    { label: "Date", value: record.close_date, strong: true },
    { label: "Status", value: record.status },
    { label: "Bills", value: String(record.bills_count ?? "—") },
    { label: "Locked at", value: record.locked_at ? formatDateTime(record.locked_at) : "—" },
  ],
  totals: (record) => [
    { label: "Gross sales", value: record.gross_sales, money: true },
    { label: "Cash collected", value: record.cash_collected, money: true },
    { label: "Digital collected", value: record.digital_collected, money: true },
    { label: "Refunds", value: record.refunds, money: true, tone: "credit" },
    { label: "Expected cash", value: record.expected_cash, money: true },
    { label: "Counted cash", value: record.counted_cash, money: true },
    {
      label: "Variance",
      value: record.cash_variance,
      money: true,
      strong: true,
      tone: Number(record.cash_variance) < 0 ? "credit" : "received",
    },
  ],
  note: "Reconciling or re-opening a close happens in the panel above, with that date loaded.",
});

const todayISO = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

export const DayClosePage: React.FC = () => {
  const { user, activeStore } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";

  const [date, setDate] = useState(todayISO());
  const [summary, setSummary] = useState<DayCloseSummary | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [inspector, setInspector] = useState<InspectorRequest | null>(null);
  const [busy, setBusy] = useState<"close" | "reconcile" | "reopen" | null>(null);

  const storeId = activeStore?.id ?? user?.store_id ?? null;
  const status = summary?.saved?.status ?? "open";

  const loadSummary = useCallback(async () => {
    if (!storeId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ day_close: DayCloseSummary }>("/admin/day-close", { date });
      setSummary(res.day_close);
      const saved = res.day_close.saved;
      setCountedCash(saved?.counted_cash != null ? String(saved.counted_cash) : "");
      setNotes(saved?.reconciliation_notes ?? "");
    } catch (err: unknown) {
      setSummary(null);
      setError((err as Error).message || "Failed to load day close.");
    } finally {
      setIsLoading(false);
    }
  }, [date, storeId]);

  const loadHistory = useCallback(async () => {
    setIsHistoryLoading(true);
    try {
      const res = await api.get<{ history: HistoryRow[] }>("/admin/day-close/history");
      setHistory(res.history || []);
    } catch {
      setHistory([]);
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const variance = useMemo(() => {
    if (!summary || countedCash.trim() === "") return null;
    const counted = Number(countedCash);
    if (Number.isNaN(counted)) return null;
    return Math.round((counted - summary.cash.expected) * 100) / 100;
  }, [countedCash, summary]);

  const runAction = async (action: "close" | "reconcile" | "reopen") => {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = { close_date: date };
      if (action === "reconcile") {
        if (countedCash.trim() === "" || Number.isNaN(Number(countedCash))) {
          setError("Enter the cash counted in the drawer before reconciling.");
          return;
        }
        body.counted_cash = Number(countedCash);
      }
      if (action === "reopen") {
        body.reason = reopenReason.trim() || undefined;
      }
      if (notes.trim()) body.notes = notes.trim();

      const res = await api.post<{ day_close: DayCloseSummary; message: string }>(
        `/admin/day-close/${action}`,
        body
      );
      setSummary(res.day_close);
      setNotice(res.message || "Done.");
      setReopenReason("");
      loadHistory();
    } catch (err: unknown) {
      setError((err as Error).message || `Failed to ${action} the day.`);
    } finally {
      setBusy(null);
    }
  };

  if (!storeId) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 text-sm text-slate-500">
        Select a specific store from the header to view its day close.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Wallet className="w-5 h-5 text-brand-600" />
            Day Close &amp; Cash Reconciliation
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Tender-wise collection, expected drawer cash and end-of-day lock for{" "}
            {summary?.store_name || activeStore?.name || `store #${storeId}`}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200">
            <CalendarDays className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent focus:outline-none"
            />
          </label>
          <button
            onClick={() => {
              loadSummary();
              loadHistory();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading || isHistoryLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-200 text-xs">
          {notice}
        </div>
      )}

      {isLoading && !summary ? (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 text-sm text-slate-500">
          Loading day close…
        </div>
      ) : summary ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-wider ${
                STATUS_STYLES[status] || STATUS_STYLES.open
              }`}
            >
              {status === "reconciled" ? <Lock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {status}
            </span>
            {summary.saved?.locked_at && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Locked at {new Date(summary.saved.locked_at).toLocaleString()}
              </span>
            )}
            {status === "reconciled" && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Backdated bills and cancellations are blocked for this date.
              </span>
            )}
            {status === "closed" && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Cancellations are blocked for this date until it is reopened.
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: "Gross Sales", value: formatINR(summary.sales.gross_total), tone: "text-slate-900 dark:text-white" },
              { label: "Bills", value: String(summary.sales.bills_count), tone: "text-slate-900 dark:text-white" },
              { label: "Cash Collected", value: formatINR(summary.totals.cash_collected), tone: "text-emerald-700 dark:text-emerald-400" },
              { label: "Digital", value: formatINR(summary.totals.digital_collected), tone: "text-blue-700 dark:text-blue-400" },
              { label: "Refunds", value: formatINR(summary.totals.refunds), tone: "text-rose-700 dark:text-rose-400" },
              { label: "Expected Cash", value: formatINR(summary.cash.expected), tone: "text-brand-700 dark:text-brand-400" },
            ].map((card) => (
              <div
                key={card.label}
                className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4"
              >
                <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {card.label}
                </div>
                <div className={`mt-1 text-lg font-bold ${card.tone}`}>{card.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
                Tender Collections
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/80 uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-2">Tender</th>
                      <th className="px-3 py-2 text-right">Collected</th>
                      <th className="px-3 py-2 text-right">Refunded</th>
                      <th className="px-3 py-2 text-right">Net</th>
                      <th className="px-3 py-2 text-right">Pending</th>
                      <th className="px-3 py-2 text-right">Receipts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {Object.entries(summary.tenders).map(([tender, row]) => (
                      <tr key={tender} className={row.collected || row.refunded ? "" : "opacity-50"}>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">
                          {TENDER_LABELS[tender] || tender}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{formatINR(row.collected)}</td>
                        <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">{formatINR(row.refunded)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">{formatINR(row.net)}</td>
                        <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{formatINR(row.pending)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{row.receipts}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Cash Drawer</h2>
              <div className="space-y-1.5 text-xs">
                {[
                  ["Opening float", summary.cash.opening_float],
                  ["Cash sales", summary.cash.cash_sales],
                  ["Cash refunds", -summary.cash.cash_refunds],
                  ["Cash expenses", -summary.cash.cash_expenses],
                  ["Cash drops", -summary.cash.cash_drops],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{formatINR(value as number)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between p-2 rounded-lg bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800">
                  <span className="font-semibold text-brand-700 dark:text-brand-300">Expected in drawer</span>
                  <span className="font-bold text-brand-800 dark:text-brand-200">{formatINR(summary.cash.expected)}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Cash counted
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={countedCash}
                    onChange={(e) => setCountedCash(e.target.value)}
                    disabled={status === "reconciled"}
                    placeholder="0.00"
                    className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                  />
                </label>
                {variance !== null && (
                  <div
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${
                      Math.abs(variance) < 0.01
                        ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
                        : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                    }`}
                  >
                    <span>{variance < 0 ? "Short by" : variance > 0 ? "Over by" : "Balanced"}</span>
                    <span>{formatINR(Math.abs(variance))}</span>
                  </div>
                )}
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                  Notes
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={status === "reconciled"}
                    placeholder="Denomination count, handover notes…"
                    className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2">
                {status === "open" && (
                  <button
                    onClick={() => runAction("close")}
                    disabled={busy !== null}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white shadow-sm disabled:opacity-50 transition"
                  >
                    <Save className="w-4 h-4" />
                    {busy === "close" ? "Closing…" : "Close Day"}
                  </button>
                )}
                {status !== "reconciled" && (
                  <button
                    onClick={() => runAction("reconcile")}
                    disabled={busy !== null || countedCash.trim() === ""}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50 transition"
                  >
                    <Lock className="w-4 h-4" />
                    {busy === "reconcile" ? "Reconciling…" : "Reconcile & Lock"}
                  </button>
                )}
                {/* G12: a closed day blocks cancellations, so whoever closed it can reopen it; a reconciled day needs a super admin. */}
                {(status === "closed" || (status === "reconciled" && isSuperAdmin)) && (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={reopenReason}
                      onChange={(e) => setReopenReason(e.target.value)}
                      placeholder="Reason for reopening (audited)"
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <button
                      onClick={() => runAction("reopen")}
                      disabled={busy !== null}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50 transition"
                    >
                      <RotateCcw className="w-4 h-4" />
                      {busy === "reopen" ? "Reopening…" : "Reopen Day"}
                    </button>
                  </div>
                )}
                {status === "reconciled" && !isSuperAdmin && (
                  <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    Reconciled days can only be reopened by a super administrator.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
                Counter Breakdown
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/80 uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-2">Counter</th>
                      <th className="px-3 py-2 text-right">Bills</th>
                      <th className="px-3 py-2 text-right">Gross</th>
                      <th className="px-3 py-2 text-right">Cash</th>
                      <th className="px-3 py-2 text-right">Digital</th>
                      <th className="px-3 py-2 text-right">Refunds</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {summary.counters.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                          No counters configured.
                        </td>
                      </tr>
                    )}
                    {summary.counters.map((row) => (
                      <tr key={row.counter_code || "unassigned"}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-slate-700 dark:text-slate-200">{row.counter_name}</div>
                          <div className="text-[10px] text-slate-400">
                            {row.counter_code || "unassigned"}
                            {row.location_name ? ` · ${row.location_name}` : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{row.bills_count}</td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{formatINR(row.gross_total)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{formatINR(row.cash_net)}</td>
                        <td className="px-3 py-2 text-right text-blue-600 dark:text-blue-400">{formatINR(row.digital_net)}</td>
                        <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-400">{formatINR(row.refunds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
                Shifts
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/80 uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="px-3 py-2">Counter</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Float</th>
                      <th className="px-3 py-2 text-right">Expected</th>
                      <th className="px-3 py-2 text-right">Counted</th>
                      <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                    {summary.shifts.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                          No shifts opened for this day.
                        </td>
                      </tr>
                    )}
                    {summary.shifts.map((shift) => (
                      <tr key={shift.id}>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200">#{shift.counter_id ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase ${
                              shift.status === "closed" ? STATUS_STYLES.closed : STATUS_STYLES.open
                            }`}
                          >
                            {shift.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{formatINR(shift.opening_float)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{formatINR(shift.expected_cash)}</td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                          {shift.counted_cash === null ? "—" : formatINR(shift.counted_cash)}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-semibold ${
                            shift.variance === null
                              ? "text-slate-400"
                              : Math.abs(shift.variance) < 0.01
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {shift.variance === null ? "—" : formatINR(shift.variance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : null}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
          Recent Day Closes
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/80 uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Bills</th>
                <th className="px-3 py-2 text-right">Gross</th>
                <th className="px-3 py-2 text-right">Expected Cash</th>
                <th className="px-3 py-2 text-right">Counted</th>
                <th className="px-3 py-2 text-right">Variance</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isHistoryLoading && history.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {!isHistoryLoading && history.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    No days closed yet.
                  </td>
                </tr>
              )}
              {history.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setDate(row.close_date)}
                  className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40"
                >
                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{row.close_date}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase ${
                        STATUS_STYLES[row.status] || STATUS_STYLES.open
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600 dark:text-slate-300">{row.bills_count}</td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{formatINR(row.gross_sales)}</td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{formatINR(row.expected_cash)}</td>
                  <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                    {row.counted_cash === null ? "—" : formatINR(row.counted_cash)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-semibold ${
                      Math.abs(row.cash_variance) < 0.01
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"
                    }`}
                  >
                    {formatINR(row.cash_variance)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      <RowAction icon={Eye} title="View this day close" onClick={() => setInspector(inspectDayClose(row))} />
                      <RowAction
                        icon={CalendarDays}
                        title="Load this date into the day close panel"
                        tone="brand"
                        onClick={() => setDate(row.close_date)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Row Inspector: a day close read from history */}
      {inspector && <RecordInspector {...inspector} onClose={() => setInspector(null)} />}
    </div>
  );
};
