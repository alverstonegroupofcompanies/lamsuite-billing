import React, { useEffect, useState } from "react";
import { api, downloadFile } from "../../services/api";
import { formatINR } from "../../utils/formatters";
import { Download, RefreshCw, AlertCircle } from "lucide-react";

interface Props {
  startDate: string;
  endDate: string;
}

export const Gstr3bPanel: React.FC<Props> = ({ startDate, endDate }) => {
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
        const res = await api.get("/admin/reports/gstr3b", { start_date: startDate, end_date: endDate });
        if (!cancelled) setData(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load GSTR-3B working paper.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const exportCsv = async () => {
    setIsExporting(true);
    setError(null);
    try {
      await downloadFile(
        `/admin/reports/gstr3b/export?start_date=${startDate}&end_date=${endDate}`,
        `gstr3b-working-${startDate}-to-${endDate}.csv`
      );
    } catch (err: any) {
      setError(err?.message || "Failed to export GSTR-3B working paper.");
    } finally {
      setIsExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-slate-400">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
        Compiling GSTR-3B working paper...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        <AlertCircle className="w-4 h-4" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  const outward = data.outward || {};
  const itc = data.itc || {};
  const net = data.net_payable || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900 dark:text-white">GSTR-3B Working Paper</h2>
          <p className="text-[11px] text-slate-500">
            Period {data.period?.from} to {data.period?.to} — outward supplies net of credit notes, eligible ITC and estimated net payable.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={isExporting}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white rounded-xl text-xs font-bold shadow-2xs transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          {isExporting ? "Exporting..." : "Export 3B CSV"}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="3.1 Outward Taxable" value={formatINR(outward.total_taxable)} hint={`${outward.documents ?? 0} documents`} />
        <SummaryCard label="3.1 Output Tax" value={formatINR(outward.total_tax)} hint="CGST + SGST + IGST + Cess" tone="text-rose-600" />
        <SummaryCard label="4 ITC Available" value={formatINR(itc.total_itc)} hint={`Ineligible: ${formatINR(itc.ineligible_itc)}`} tone="text-emerald-600" />
        <SummaryCard label="6.1 Net Payable" value={formatINR(net.total)} hint="After ITC set-off (estimate)" tone="text-brand-600" />
      </div>

      <RateTable title="3.1 Outward Taxable Supplies (Rate-wise)" rows={outward.rate_wise || []} />
      <RateTable title="4 Eligible ITC (Rate-wise)" rows={itc.rate_wise || []} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard label="Inter-state Taxable" value={formatINR(outward.inter_state_taxable)} />
        <SummaryCard label="Intra-state Taxable" value={formatINR(outward.intra_state_taxable)} />
        <SummaryCard label="Reverse Charge Inward" value={formatINR(itc.rcm_tax)} hint={`Taxable: ${formatINR(itc.rcm_taxable)}`} tone="text-amber-600" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        <p className="font-bold text-slate-700 dark:text-slate-300 mb-1">Notes</p>
        <ul className="list-disc pl-4 space-y-1">
          {(data.notes || []).map((note: string, index: number) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <SummaryCard label="Net CGST" value={formatINR(net.cgst)} />
        <SummaryCard label="Net SGST" value={formatINR(net.sgst)} />
        <SummaryCard label="Net IGST" value={formatINR(net.igst)} />
        <SummaryCard label="Net Cess" value={formatINR(net.cess)} />
      </div>
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
              No entries for this period.
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
