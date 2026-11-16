import React, { useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../../services/api";
import { formatINR } from "../../utils/formatters";
import { Download, RefreshCw, AlertCircle } from "lucide-react";

const fiscalYearLabel = (startYear: number) => `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;

export const Gstr9Panel: React.FC = () => {
  const currentFyStart = useMemo(() => {
    const now = new Date();
    return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  }, []);

  const fiscalYears = useMemo(
    () => [currentFyStart, currentFyStart - 1, currentFyStart - 2].map((year) => fiscalYearLabel(year)),
    [currentFyStart]
  );

  const [fy, setFy] = useState(fiscalYears[0]);
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/admin/reports/gstr9", { fy });
        if (!cancelled) setData(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load GSTR-9 working paper.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fy]);

  const exportCsv = async () => {
    setIsExporting(true);
    setError(null);
    try {
      await downloadFile(`/admin/reports/gstr9/export?fy=${fy}`, `gstr9-working-${fy}.csv`);
    } catch (err: any) {
      setError(err?.message || "Failed to export GSTR-9 working paper.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900 dark:text-white">GSTR-9 Annual Working Paper</h2>
          <p className="text-[11px] text-slate-500">
            {data ? `${data.period?.from} to ${data.period?.to}` : "Annual aggregate of outward supplies, ITC and documents."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={fy}
            onChange={(e) => setFy(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            {fiscalYears.map((year) => (
              <option key={year} value={year}>
                FY {year}
              </option>
            ))}
          </select>

          <button
            onClick={exportCsv}
            disabled={isExporting || !data}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-2xs transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? "Exporting..." : "Export GSTR-9 CSV"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center text-xs text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
          Aggregating annual GST data...
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="Net Turnover" value={formatINR(data.turnover?.net_turnover)} hint={`Gross ${formatINR(data.turnover?.gross_sales)} — Returns ${formatINR(data.turnover?.returns)}`} />
            <SummaryCard label="Tax on Outward" value={formatINR(data.turnover?.tax_on_outward)} tone="text-rose-600" />
            <SummaryCard label="ITC Availed" value={formatINR(data.itc?.total_itc)} hint={`Ineligible ${formatINR(data.itc?.ineligible_itc)}`} tone="text-emerald-600" />
            <SummaryCard label="Net Tax Estimate" value={formatINR(data.reconciliation?.net_tax_estimate)} tone="text-brand-600" />
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Turnover & Reconciliation</h3>
            </div>
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <Row label="Gross sales" value={formatINR(data.turnover?.gross_sales)} />
                <Row label="Returns / credit notes" value={formatINR(data.turnover?.returns)} />
                <Row label="Net turnover" value={formatINR(data.turnover?.net_turnover)} bold />
                <Row label="Taxable turnover" value={formatINR(data.turnover?.taxable_turnover)} />
                <Row label="Nil / exempt turnover" value={formatINR(data.turnover?.nil_exempt_turnover)} />
                <Row label="Tax payable (per books)" value={formatINR(data.reconciliation?.tax_per_books)} />
                <Row label="ITC availed" value={formatINR(data.reconciliation?.itc_availed)} />
                <Row label="Net tax estimate" value={formatINR(data.reconciliation?.net_tax_estimate)} bold />
              </tbody>
            </table>
          </div>

          <RateTable title="Outward Supplies (Rate-wise)" rows={data.rate_wise_outward || []} />
          <RateTable title="ITC Availed (Rate-wise)" rows={data.itc?.rate_wise || []} />

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">Table 13: Documents Issued</h3>
            </div>
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                <Row label="Invoices" value={String(data.documents?.invoices ?? 0)} />
                <Row label="Credit notes" value={String(data.documents?.credit_notes ?? 0)} />
                <Row label="Purchase bills" value={String(data.documents?.purchase_bills ?? 0)} />
                <Row label="Cancelled invoices" value={String(data.documents?.cancelled ?? 0)} />
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900">
            <p className="font-bold text-slate-700 dark:text-slate-300 mb-1">Notes</p>
            <ul className="list-disc pl-4 space-y-1">
              {(data.notes || []).map((note: string, index: number) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string; hint?: string; tone?: string }> = ({
  label,
  value,
  hint,
  tone = "text-slate-900 dark:text-white",
}) => (
  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
    <div className="text-xs font-bold text-slate-500">{label}</div>
    <div className={`text-xl font-bold mt-1 ${tone}`}>{value}</div>
    {hint && <div className="text-[10px] text-slate-400 mt-1">{hint}</div>}
  </div>
);

const Row: React.FC<{ label: string; value: string; bold?: boolean }> = ({ label, value, bold }) => (
  <tr>
    <td className={`px-4 py-3 ${bold ? "font-bold text-slate-900 dark:text-white" : ""}`}>{label}</td>
    <td className={`px-4 py-3 text-right font-mono ${bold ? "font-bold text-slate-900 dark:text-white" : ""}`}>{value}</td>
  </tr>
);

const RateTable: React.FC<{ title: string; rows: any[] }> = ({ title, rows }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
    <div className="p-4 border-b border-slate-200 dark:border-slate-800">
      <h3 className="font-bold text-slate-900 dark:text-white text-sm">{title}</h3>
    </div>
    <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
      <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
        <tr>
          <th className="px-4 py-3">GST %</th>
          <th className="px-4 py-3 text-right">Taxable Value</th>
          <th className="px-4 py-3 text-right">CGST (₹)</th>
          <th className="px-4 py-3 text-right">SGST (₹)</th>
          <th className="px-4 py-3 text-right">IGST (₹)</th>
          <th className="px-4 py-3 text-right">Cess (₹)</th>
          <th className="px-4 py-3 text-right">Tax Total (₹)</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono">
        {rows.length === 0 ? (
          <tr>
            <td colSpan={7} className="px-4 py-6 text-center text-slate-400 font-sans">
              No entries for this fiscal year.
            </td>
          </tr>
        ) : (
          rows.map((row: any, index: number) => (
            <tr key={index}>
              <td className="px-4 py-3 font-bold text-slate-900 dark:text-white">{row.rate_label ?? `${row.rate}%`}</td>
              <td className="px-4 py-3 text-right">{formatINR(row.taxable_value)}</td>
              <td className="px-4 py-3 text-right">{formatINR(row.cgst_amount)}</td>
              <td className="px-4 py-3 text-right">{formatINR(row.sgst_amount)}</td>
              <td className="px-4 py-3 text-right">{formatINR(row.igst_amount)}</td>
              <td className="px-4 py-3 text-right">{formatINR(row.cess_amount)}</td>
              <td className="px-4 py-3 text-right font-bold text-slate-900 dark:text-white">{formatINR(row.tax_amount)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);
