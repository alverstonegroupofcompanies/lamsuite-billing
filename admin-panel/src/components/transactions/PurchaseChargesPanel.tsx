import React, { useCallback, useEffect, useState } from "react";
import { Download, Eye, RefreshCw, Search } from "lucide-react";
import { api } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { formatDate, formatINR } from "../../utils/formatters";
import { downloadCsv } from "../../utils/csv";
import { RowAction } from "../RowAction";
import { RecordInspector, type InspectorColumn } from "../RecordInspector";

type InspectorRequest = Omit<React.ComponentProps<typeof RecordInspector>, "onClose">;

/**
 * MV-CHG-01 — the bill a charge line sits on.
 *
 * A charge row carries its own denormalised head, so the only thing it cannot answer is what it was
 * spread against: that is the supplier bill, which `showPurchase` returns with its `charges` relation.
 * A line whose bill has not reached the server has nothing to open.
 */
const chargeBillColumns: InspectorColumn[] = [
  { label: "Charge head", render: (line: any) => line.head_name || line.head?.name || `#${line.head_id}` },
  { label: "Treatment", render: (line: any) => String(line.treatment || "").replace("_", " ") },
  { label: "Payable", align: "center", render: (line: any) => (line.in_payable ? "In" : "Outside") },
  { label: "Amount", align: "right", money: true, render: (line: any) => line.amount },
  { label: "GST", align: "right", render: (line: any) => `${Number(line.gst_percent || 0)}%` },
  { label: "Total", align: "right", money: true, render: (line: any) => line.total_amount },
];

const inspectChargeBill = (row: ChargeRow): InspectorRequest => {
  const purchaseId = row.purchase?.id;
  return {
    kind: "Supplier bill",
    heading: row.purchase?.invoice_number || `Purchase #${purchaseId}`,
    subheading: `${row.head_name} · ${formatDate(row.purchase?.invoice_date)}`,
    endpoint: `/admin/purchases/${purchaseId}`,
    row: {
      invoice_number: row.purchase?.invoice_number,
      supplier_name: row.purchase?.supplier_name,
      invoice_date: row.purchase?.invoice_date,
    },
    lineKey: "charges",
    columns: chargeBillColumns,
    linesEmpty: "This bill carries no charge lines.",
    fields: (record) => [
      { label: "Bill number", value: record.invoice_number, mono: true, strong: true },
      { label: "Supplier", value: record.supplier_name },
      { label: "Bill date", value: formatDate(record.invoice_date) },
      { label: "Supplier GSTIN", value: record.supplier_gstin, mono: true },
      { label: "Bill status", value: record.status },
      { label: "This charge head", value: `${row.head_name} (${row.head_code})` },
      { label: "Entered by", value: row.source },
      { label: "Paid separately", value: row.paid_separately ? row.paid_to_label || "Yes" : "No" },
      { label: "Charge note", value: row.note },
    ],
    totals: (record) => [
      { label: "Goods value (taxable)", value: record.subtotal, money: true },
      { label: "This charge (incl. GST)", value: row.total_amount, money: true },
      { label: "Bill payable", value: record.grand_total, money: true, strong: true },
      { label: "Settled against bill", value: record.paid_amount, money: true },
      { label: "This charge allocated", value: row.allocated_amount, money: true },
      { label: "This charge reversed", value: row.reversed_amount, money: true, tone: "credit" },
    ],
    note: row.paid_separately
      ? "This charge was paid outside the bill, so it is not part of the payable above — the supplier settlement on the bill ignores it."
      : "A charge paid with the bill raises the payable above. Its share of goods value is spread by the method shown on the line, and correcting a posted charge means editing the bill, not this row.",
  };
};

/**
 * CR-C Task 4.14 — the charges of supplier bills, as rows.
 *
 * Every column here is read off `purchase_charges`, never re-derived from today's settings: the row
 * is what a printed bill promised, and a register that quietly updated `in_payable` after a policy
 * switch would contradict the paper an auditor keeps (PUR-016).
 */

type ChargeRow = {
  id: number;
  seq: number;
  store: { id: number; name: string; code: string } | null;
  purchase: {
    id: number;
    invoice_number: string;
    supplier_name: string;
    invoice_date: string;
  } | null;
  head_code: string;
  head_name: string;
  note: string | null;
  treatment: string;
  spread_method: string;
  itc_eligibility: string;
  is_rcm: boolean;
  paid_separately: boolean;
  paid_to_label: string | null;
  in_payable: boolean;
  amount: number;
  gst_percent: number;
  taxable_amount: number;
  total_tax: number;
  total_amount: number;
  allocated_amount: number;
  reversed_amount: number;
  source: string;
};

type ChargesSummary = {
  row_count: number;
  charge_amount_total: number;
  in_payable_total: number;
  outside_payable_total: number;
};

type ChargesResponse = {
  data: ChargeRow[];
  meta?: { total: number; per_page: number; current_page: number; last_page: number } | null;
  summary: ChargesSummary;
};

const EMPTY_FILTERS = {
  head_code: "",
  treatment: "",
  spread_method: "",
  itc_eligibility: "",
  is_rcm: "",
  paid_separately: "",
  in_payable: "",
  from: "",
  to: "",
  search: "",
};

type FilterKey = keyof typeof EMPTY_FILTERS;

const CSV_COLUMNS: Array<{ key: string; value: (row: ChargeRow) => string | number | boolean | null }> = [
  { key: "store", value: (r) => r.store?.code ?? r.store?.name ?? "" },
  { key: "invoice_number", value: (r) => r.purchase?.invoice_number ?? "" },
  { key: "invoice_date", value: (r) => r.purchase?.invoice_date ?? "" },
  { key: "supplier_name", value: (r) => r.purchase?.supplier_name ?? "" },
  { key: "seq", value: (r) => r.seq },
  { key: "head_code", value: (r) => r.head_code },
  { key: "head_name", value: (r) => r.head_name },
  { key: "treatment", value: (r) => r.treatment },
  { key: "spread_method", value: (r) => r.spread_method },
  { key: "itc_eligibility", value: (r) => r.itc_eligibility },
  { key: "is_rcm", value: (r) => r.is_rcm },
  { key: "paid_separately", value: (r) => r.paid_separately },
  { key: "paid_to_label", value: (r) => r.paid_to_label },
  { key: "in_payable", value: (r) => r.in_payable },
  { key: "amount", value: (r) => r.amount },
  { key: "gst_percent", value: (r) => r.gst_percent },
  { key: "taxable_amount", value: (r) => r.taxable_amount },
  { key: "total_tax", value: (r) => r.total_tax },
  { key: "total_amount", value: (r) => r.total_amount },
  { key: "allocated_amount", value: (r) => r.allocated_amount },
  { key: "reversed_amount", value: (r) => r.reversed_amount },
  { key: "source", value: (r) => r.source },
  { key: "note", value: (r) => r.note },
];

const selectClass =
  "px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden";
const labelClass = "text-[10px] uppercase font-semibold text-slate-500 dark:text-slate-400";

export const PurchaseChargesPanel: React.FC = () => {
  const { activeStore, isAllStores, hasPermission } = useAuth();
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS });
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [summary, setSummary] = useState<ChargesSummary | null>(null);
  const [meta, setMeta] = useState<ChargesResponse["meta"]>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [inspector, setInspector] = useState<InspectorRequest | null>(null);

  const query = useCallback(
    () => ({
      ...(activeStore?.id ? { active_store_id: activeStore.id } : {}),
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== "")),
    }),
    [activeStore?.id, filters]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    api
      .get<ChargesResponse>("/admin/purchase-charges", { ...query(), page })
      .then((res) => {
        if (cancelled) return;
        setRows(res.data || []);
        setSummary(res.summary || null);
        setMeta(res.meta || null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || "Could not load the charges register.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, page, reloadKey]);

  const setFilter = (key: FilterKey, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  // Export reads the whole filtered answer, not the page on screen — a month of charges is one file.
  const exportCsv = async () => {
    try {
      const res = await api.get<ChargesResponse>("/admin/purchase-charges", {
        ...query(),
        export: "true",
      });
      downloadCsv(
        `purchase-charges-${new Date().toISOString().slice(0, 10)}.csv`,
        CSV_COLUMNS.map((c) => c.key),
        (res.data || []).map((row) => CSV_COLUMNS.map((c) => c.value(row)))
      );
    } catch (err: any) {
      setError(err?.message || "Export failed.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex flex-wrap items-end gap-2 flex-1">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Search</span>
            <span className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilter("search", e.target.value)}
                placeholder="Head, note, supplier, bill no…"
                className="pl-9 pr-3 py-1.5 w-64 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
              />
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Head code</span>
            <input
              type="text"
              value={filters.head_code}
              onChange={(e) => setFilter("head_code", e.target.value)}
              placeholder="FREIGHT"
              className={`w-32 ${selectClass}`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Treatment</span>
            <select
              value={filters.treatment}
              onChange={(e) => setFilter("treatment", e.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="add_to_cost">Add to cost</option>
              <option value="expense">Expense</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Spread</span>
            <select
              value={filters.spread_method}
              onChange={(e) => setFilter("spread_method", e.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="value">Value</option>
              <option value="quantity">Quantity</option>
              <option value="weight">Weight</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>ITC</span>
            <select
              value={filters.itc_eligibility}
              onChange={(e) => setFilter("itc_eligibility", e.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="eligible">Eligible</option>
              <option value="ineligible">Ineligible</option>
              <option value="blocked">Blocked</option>
              <option value="partial">Partial</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>In payable</span>
            <select
              value={filters.in_payable}
              onChange={(e) => setFilter("in_payable", e.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Separately paid</span>
            <select
              value={filters.paid_separately}
              onChange={(e) => setFilter("paid_separately", e.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>Reverse charge</span>
            <select
              value={filters.is_rcm}
              onChange={(e) => setFilter("is_rcm", e.target.value)}
              className={selectClass}
            >
              <option value="">Any</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilter("from", e.target.value)}
              className={selectClass}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelClass}>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilter("to", e.target.value)}
              className={selectClass}
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200"
            title="Refresh the charges register"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-brand-600" : ""}`} />
            <span>Refresh</span>
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-xs font-semibold rounded-xl text-white"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-xl text-xs font-semibold border bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900">
          {error}
        </div>
      )}

      {summary && (
        <div
          data-testid="charges-summary"
          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300"
        >
          <span>{summary.row_count} charge lines</span>
          <span className="text-slate-400">keyed</span>
          <span className="font-mono">{formatINR(summary.charge_amount_total)}</span>
          <span className="text-slate-400">in payable</span>
          <span className="font-mono text-emerald-600 dark:text-emerald-400">
            {formatINR(summary.in_payable_total)}
          </span>
          <span className="text-slate-400">outside payable</span>
          <span className="font-mono text-amber-600 dark:text-amber-400">
            {formatINR(summary.outside_payable_total)}
          </span>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Charge head</th>
                {isAllStores && <th className="px-4 py-3">Store</th>}
                <th className="px-4 py-3">Supplier bill</th>
                <th className="px-4 py-3">Treatment</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">GST</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-center">Payable</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={isAllStores ? 9 : 8} className="px-4 py-8 text-center text-slate-400">
                    Loading charge lines…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={isAllStores ? 9 : 8} className="px-4 py-8 text-center text-slate-400">
                    No charge lines match this filter.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} data-testid={`charge-row-${row.id}`} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{row.head_name}</div>
                      <div className="text-[10px] text-slate-400 font-mono">{row.head_code}</div>
                      {row.paid_to_label && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400">
                          paid to <span className="font-semibold">{row.paid_to_label}</span>
                        </div>
                      )}
                      {row.note && <div className="text-[10px] text-slate-400">{row.note}</div>}
                    </td>
                    {isAllStores && (
                      <td className="px-4 py-3 font-semibold">
                        {row.store?.name || `Store #${row.store?.id}`}
                        <div className="text-[10px] text-slate-400 font-normal">{row.store?.code}</div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="font-mono font-bold text-slate-900 dark:text-white">
                        {row.purchase?.invoice_number || "—"}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {row.purchase ? formatDate(row.purchase.invoice_date) : ""}
                      </div>
                      <div className="text-[10px]">{row.purchase?.supplier_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="capitalize">{row.treatment.replace("_", " ")}</div>
                      <div className="text-[10px] text-slate-400">
                        spread {row.spread_method.replace("_", " ")} · ITC {row.itc_eligibility}
                        {row.is_rcm ? " · RCM" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(row.amount)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(row.total_tax)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(row.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap ${
                          row.in_payable
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                        }`}
                      >
                        {row.in_payable ? "In payable" : "Outside payable"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <RowAction
                          icon={Eye}
                          title={row.purchase?.id ? "View the supplier bill this charge sits on" : "This charge line has no supplier bill on the server yet"}
                          disabled={!row.purchase?.id || !hasPermission("transactions", "view")}
                          onClick={() => setInspector(inspectChargeBill(row))}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {meta && (
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <div>
              Showing page{" "}
              <strong className="text-slate-800 dark:text-slate-200">{meta?.current_page ?? page}</strong> of{" "}
              <strong className="text-slate-800 dark:text-slate-200">{meta?.last_page ?? 1}</strong> (
              {(meta?.total ?? 0).toLocaleString()} charge lines)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(meta?.last_page ?? 1, p + 1))}
                disabled={page >= (meta?.last_page ?? 1) || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Row Inspector: the supplier bill behind a charge line */}
      {inspector && <RecordInspector {...inspector} onClose={() => setInspector(null)} />}
    </div>
  );
};
