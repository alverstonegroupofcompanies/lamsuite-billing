import React, { useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../../services/api";
import { formatINR } from "../../utils/formatters";
import { useAuth } from "../../context/AuthContext";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileSearch,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

const HEADER_ALIASES: Record<string, string> = {
  supplier_gstin: "supplier_gstin",
  gstin: "supplier_gstin",
  "supplier gstin": "supplier_gstin",
  "gstin/uin of supplier": "supplier_gstin",
  supplier: "supplier_name",
  supplier_name: "supplier_name",
  "supplier name": "supplier_name",
  invoice_number: "invoice_number",
  "invoice number": "invoice_number",
  "invoice no": "invoice_number",
  "invoice no.": "invoice_number",
  "document number": "invoice_number",
  invoice_date: "invoice_date",
  "invoice date": "invoice_date",
  "document date": "invoice_date",
  taxable_value: "taxable_value",
  "taxable value": "taxable_value",
  taxable: "taxable_value",
  igst_amount: "igst_amount",
  igst: "igst_amount",
  "igst amount": "igst_amount",
  cgst_amount: "cgst_amount",
  cgst: "cgst_amount",
  "cgst amount": "cgst_amount",
  sgst_amount: "sgst_amount",
  sgst: "sgst_amount",
  "sgst amount": "sgst_amount",
  cess_amount: "cess_amount",
  cess: "cess_amount",
  "cess amount": "cess_amount",
  total_value: "total_value",
  "total value": "total_value",
  total: "total_value",
  "invoice value": "total_value",
};

const num = (value: any): number => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = parseFloat(String(value).replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeDate = (value: any): string | undefined => {
  if (!value) return undefined;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  return undefined;
};

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const parseCsv = (text: string): any[] => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((header) => HEADER_ALIASES[header.toLowerCase()] || header.toLowerCase());

  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, any> = {};
    headers.forEach((header, index) => {
      if (header) row[header] = cells[index] ?? "";
    });
    return row;
  });
};

const normalizeRow = (row: any) => ({
  supplier_gstin: row.supplier_gstin ? String(row.supplier_gstin).trim().toUpperCase() : undefined,
  supplier_name: row.supplier_name ? String(row.supplier_name).trim() : undefined,
  invoice_number: String(row.invoice_number ?? "").trim(),
  invoice_date: normalizeDate(row.invoice_date),
  taxable_value: num(row.taxable_value),
  igst_amount: num(row.igst_amount),
  cgst_amount: num(row.cgst_amount),
  sgst_amount: num(row.sgst_amount),
  cess_amount: num(row.cess_amount),
  total_value: num(row.total_value),
  itc_eligible: row.itc_eligible === undefined || row.itc_eligible === null || row.itc_eligible === ""
    ? true
    : ["true", "yes", "1", "y"].includes(String(row.itc_eligible).toLowerCase()),
});

const currentMonth = () => new Date().toISOString().slice(0, 7);

export const Gstr2bPanel: React.FC = () => {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("reports", "edit");

  const [imports, setImports] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [report, setReport] = useState<any>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [period, setPeriod] = useState(currentMonth());
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<any[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canImport = useMemo(() => canEdit && rows.length > 0, [canEdit, rows]);

  const loadImports = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<{ imports: any[] }>("/admin/reports/gstr2b/imports");
      setImports(res.imports || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load GSTR-2B imports.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadImports();
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setReport(null);
      return;
    }

    let cancelled = false;
    setIsReportLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await api.get(`/admin/reports/gstr2b/imports/${selectedId}`);
        if (!cancelled) setReport(res);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load GSTR-2B import.");
      } finally {
        if (!cancelled) setIsReportLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const openModal = () => {
    setPeriod(currentMonth());
    setFileName("");
    setRows([]);
    setParseError(null);
    setFeedback(null);
    setIsModalOpen(true);
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;

    setFileName(file.name);
    setParseError(null);
    setRows([]);

    try {
      const text = await file.text();
      let parsed: any[] = [];

      if (file.name.toLowerCase().endsWith(".json")) {
        const json = JSON.parse(text);
        parsed = Array.isArray(json) ? json : Array.isArray(json?.rows) ? json.rows : [];
      } else {
        parsed = parseCsv(text);
      }

      const normalized = parsed.map(normalizeRow).filter((row) => row.invoice_number.length > 0);

      if (normalized.length === 0) {
        setParseError("No valid rows found. Include an invoice number column and at least one data row.");
        return;
      }

      setRows(normalized);
    } catch (err: any) {
      setParseError(err?.message || "Could not read the selected file.");
    }
  };

  const submitImport = async () => {
    if (!canImport) return;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await api.post<{ message: string; import: any }>("/admin/reports/gstr2b/import", {
        period,
        file_name: fileName || undefined,
        rows,
      });

      setIsModalOpen(false);
      setFeedback(res.message || "GSTR-2B import completed.");
      await loadImports();
      setSelectedId(res.import.id);
    } catch (err: any) {
      setError(err?.message || "Failed to import GSTR-2B data.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteImport = async (id: number) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }

    setConfirmDeleteId(null);
    setError(null);
    try {
      await api.delete(`/admin/reports/gstr2b/imports/${id}`);
      setFeedback("GSTR-2B import deleted.");
      if (selectedId === id) setSelectedId(null);
      await loadImports();
    } catch (err: any) {
      setError(err?.message || "Failed to delete GSTR-2B import.");
    }
  };

  const exportCsv = async (id: number) => {
    setError(null);
    try {
      await downloadFile(`/admin/reports/gstr2b/imports/${id}/export`, `gstr2b-${id}.csv`);
    } catch (err: any) {
      setError(err?.message || "Failed to export GSTR-2B data.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-black text-slate-900 dark:text-white">GSTR-2B Import & ITC Matching</h2>
          <p className="text-[11px] text-slate-500">
            Upload the portal GSTR-2B CSV/JSON. Entries are matched against purchase bills by supplier GSTIN and invoice number.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadImports}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          {canEdit && (
            <button
              onClick={openModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-bold shadow-2xs transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Import GSTR-2B
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {selectedId !== null ? (
        isReportLoading ? (
          <div className="flex h-48 items-center justify-center text-xs text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
            Loading matched entries...
          </div>
        ) : report ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 dark:text-slate-300"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to imports
              </button>
              <button
                onClick={() => exportCsv(selectedId)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-2xs"
              >
                <Download className="w-3.5 h-3.5" />
                Export matched CSV
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <SummaryCard label="Entries" value={String(report.summary?.total_entries ?? 0)} />
              <SummaryCard label="Matched" value={String(report.summary?.matched ?? 0)} tone="text-emerald-600" />
              <SummaryCard label="Mismatch" value={String(report.summary?.mismatch ?? 0)} tone="text-amber-600" />
              <SummaryCard label="Unmatched" value={String(report.summary?.unmatched ?? 0)} tone="text-rose-600" />
              <SummaryCard label="Eligible ITC" value={formatINR(report.summary?.itc_eligible_value)} />
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Supplier / Invoice</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Taxable</th>
                    <th className="px-4 py-3 text-right">Tax</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Matched Purchase</th>
                    <th className="px-4 py-3 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(report.entries || []).map((entry: any) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3">
                        <div className="font-bold text-slate-900 dark:text-white">{entry.supplier_name || entry.supplier_gstin || "Unknown"}</div>
                        <div className="text-[10px] font-mono text-slate-400">{entry.supplier_gstin || "—"} · {entry.invoice_number}</div>
                      </td>
                      <td className="px-4 py-3 font-mono">{entry.invoice_date || "—"}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(entry.taxable_value)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(entry.tax_amount)}</td>
                      <td className="px-4 py-3">
                        <MatchBadge status={entry.match_status} />
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px]">
                        {entry.matched_purchase ? (
                          <>
                            <div className="font-bold text-slate-800 dark:text-slate-200">{entry.matched_purchase.invoice_number}</div>
                            <div className="text-slate-400">Bill tax {formatINR(entry.matched_purchase.tax_total)}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{entry.tax_difference === null ? "—" : formatINR(entry.tax_difference)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null
      ) : isLoading ? (
        <div className="flex h-48 items-center justify-center text-xs text-slate-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2 text-brand-600" />
          Loading GSTR-2B imports...
        </div>
      ) : imports.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 rounded-2xl border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700">
          <FileSearch className="w-6 h-6" />
          No GSTR-2B data imported yet.
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-x-auto">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Store</th>
                <th className="px-4 py-3 text-center">Entries</th>
                <th className="px-4 py-3 text-center">Matched</th>
                <th className="px-4 py-3 text-center">Mismatch</th>
                <th className="px-4 py-3 text-center">Unmatched</th>
                <th className="px-4 py-3 text-right">ITC Available</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {imports.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">{item.period}</td>
                  <td className="px-4 py-3">{item.file_name || item.source || "—"}</td>
                  <td className="px-4 py-3">{item.store_name || "All Stores"}</td>
                  <td className="px-4 py-3 text-center font-mono">{item.total_entries}</td>
                  <td className="px-4 py-3 text-center font-mono text-emerald-600">{item.matched_count}</td>
                  <td className="px-4 py-3 text-center font-mono text-amber-600">{item.mismatch_count}</td>
                  <td className="px-4 py-3 text-center font-mono text-rose-600">{item.unmatched_count}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold">{formatINR(item.itc_available)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedId(item.id)}
                        className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-700 dark:text-slate-200"
                      >
                        View
                      </button>
                      <button
                        onClick={() => exportCsv(item.id)}
                        className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"
                        title="Export CSV"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => deleteImport(item.id)}
                          onBlur={() => setConfirmDeleteId((current) => (current === item.id ? null : current))}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold ${
                            confirmDeleteId === item.id
                              ? "bg-rose-600 text-white"
                              : "bg-rose-50 text-rose-600 dark:bg-rose-950/40"
                          }`}
                          title="Delete import"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {confirmDeleteId === item.id ? "Confirm?" : ""}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-black text-slate-900 dark:text-white">Import GSTR-2B</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Return period</label>
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-200"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">GSTR-2B file (CSV or JSON)</label>
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(e) => handleFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 dark:text-slate-300 file:mr-3 file:px-3 file:py-2 file:rounded-xl file:border-0 file:bg-brand-50 file:text-brand-700 file:text-xs file:font-bold dark:file:bg-slate-800 dark:file:text-slate-200"
                />
                <p className="mt-1.5 text-[10px] text-slate-400 leading-relaxed">
                  Expected columns: GSTIN, Supplier, Invoice Number, Invoice Date, Taxable Value, IGST, CGST, SGST, Cess, Total Value.
                  A JSON array of the same fields is also accepted.
                </p>
              </div>

              {parseError && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  {parseError}
                </div>
              )}

              {rows.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-bold text-slate-900 dark:text-white">{rows.length}</span> rows ready to import
                  {fileName ? ` from ${fileName}` : ""}. First entry: {rows[0].invoice_number} — {formatINR(rows[0].taxable_value)} taxable.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-slate-200 dark:border-slate-800">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={submitImport}
                disabled={!canImport || isSubmitting}
                className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-bold"
              >
                {isSubmitting ? "Importing..." : "Import & Match"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: string; tone?: string }> = ({
  label,
  value,
  tone = "text-slate-900 dark:text-white",
}) => (
  <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs">
    <div className="text-xs font-bold text-slate-500">{label}</div>
    <div className={`text-xl font-bold mt-1 ${tone}`}>{value}</div>
  </div>
);

const MatchBadge: React.FC<{ status: string }> = ({ status }) => {
  const styles: Record<string, string> = {
    matched: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    mismatch: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    unmatched: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  };

  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles[status] || styles.unmatched}`}>
      {status}
    </span>
  );
};
