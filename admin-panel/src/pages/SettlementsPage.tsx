import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  RefreshCw,
  X,
  FileUp,
  GitCompareArrows,
  CheckCircle2,
  AlertTriangle,
  EyeOff,
  FileSpreadsheet,
  Link2,
} from "lucide-react";
import { api } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { formatDate, formatDateTime, formatINR } from "../utils/formatters";

interface SettlementBatch {
  id: number;
  source: string;
  file_name: string | null;
  period_start: string | null;
  period_end: string | null;
  total_amount: number;
  line_count: number;
  matched_count: number;
  exception_count: number;
  status: "imported" | "partial" | "reconciled";
  notes: string | null;
  created_at: string | null;
}

interface SettlementLine {
  id: number;
  txn_date: string | null;
  reference: string;
  amount: number;
  mode: string | null;
  payer_ref: string | null;
  status: "matched" | "unmatched" | "exception" | "ignored" | "resolved";
  match_type: string | null;
  match_id: number | null;
  invoice_number: string | null;
  note: string | null;
}

interface PreviewRow {
  txn_date: string | null;
  reference: string;
  amount: number;
  mode: string | null;
  status: SettlementLine["status"];
  match_type: string | null;
  match_id: number | null;
  invoice_number: string | null;
  note: string | null;
}

const BATCH_STYLES: Record<string, string> = {
  reconciled: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  partial: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  imported: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600",
};

const LINE_STYLES: Record<string, string> = {
  matched: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800",
  resolved: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-800",
  unmatched: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:border-slate-600",
  exception: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:border-rose-800",
  ignored: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

export const SettlementsPage: React.FC = () => {
  const { activeStore } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [source, setSource] = useState("upi");
  const [notes, setNotes] = useState("");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [preview, setPreview] = useState<{
    row_count: number;
    total_amount: number;
    matched: number;
    exceptions: number;
    rows: PreviewRow[];
    errors: string[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [selectedBatch, setSelectedBatch] = useState<SettlementBatch | null>(null);
  const [lines, setLines] = useState<SettlementLine[]>([]);
  const [lineFilter, setLineFilter] = useState("");
  const [isLoadingLines, setIsLoadingLines] = useState(false);
  const [isRematching, setIsRematching] = useState(false);

  const fetchBatches = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (activeStore) params.active_store_id = String(activeStore.id);
      const res = await api.get<{ batches: SettlementBatch[] }>("/admin/settlements", params);
      setBatches(res.batches || []);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to load settlement batches");
    } finally {
      setIsLoading(false);
    }
  }, [activeStore]);

  useEffect(() => {
    fetchBatches();
  }, [fetchBatches]);

  const loadLines = async (batch: SettlementBatch, status?: string) => {
    setIsLoadingLines(true);
    try {
      const params: Record<string, string> = {};
      if (activeStore) params.active_store_id = String(activeStore.id);
      if (status) params.status = status;
      const res = await api.get<{ batch: SettlementBatch; lines: SettlementLine[] }>(
        `/admin/settlements/${batch.id}`,
        params
      );
      setSelectedBatch(res.batch);
      setLines(res.lines || []);
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to load settlement lines");
    } finally {
      setIsLoadingLines(false);
    }
  };

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
      setPreview(null);
      setImportError(null);
    } catch {
      setImportError("Could not read the selected file.");
    }
  };

  const buildPayload = () => {
    const payload: Record<string, unknown> = {
      csv: csvText,
      source,
      notes: notes.trim() || undefined,
    };
    if (fileName) payload.file_name = fileName;
    if (activeStore) payload.active_store_id = activeStore.id;
    return payload;
  };

  const handlePreview = async () => {
    setImportError(null);
    setIsPreviewing(true);
    try {
      const res = await api.post<{
        row_count: number;
        total_amount: number;
        matched: number;
        exceptions: number;
        rows: PreviewRow[];
        errors: string[];
      }>("/admin/settlements/preview", buildPayload());
      setPreview(res);
    } catch (err: unknown) {
      setPreview(null);
      setImportError((err as Error).message || "Failed to preview settlement file");
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleImport = async () => {
    setImportError(null);
    setIsImporting(true);
    try {
      const res = await api.post<{ batch: SettlementBatch; parse_errors: string[] }>(
        "/admin/settlements",
        buildPayload()
      );
      setCsvText("");
      setFileName(null);
      setPreview(null);
      setNotes("");
      await fetchBatches();
      await loadLines(res.batch);
    } catch (err: unknown) {
      setImportError((err as Error).message || "Failed to import settlement file");
    } finally {
      setIsImporting(false);
    }
  };

  const handleRematch = async () => {
    if (!selectedBatch) return;
    setIsRematching(true);
    try {
      await api.post(`/admin/settlements/${selectedBatch.id}/rematch`);
      await loadLines(selectedBatch, lineFilter);
      await fetchBatches();
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to re-run matching");
    } finally {
      setIsRematching(false);
    }
  };

  const handleIgnore = async (line: SettlementLine) => {
    if (!window.confirm(`Ignore settlement line ${line.reference} for ${formatINR(line.amount)}?`)) return;
    try {
      await api.post(`/admin/settlements/lines/${line.id}/resolve`, { action: "ignore" });
      if (selectedBatch) await loadLines(selectedBatch, lineFilter);
      await fetchBatches();
    } catch (err: unknown) {
      alert((err as Error).message || "Failed to ignore line");
    }
  };

  const summary = batches.reduce(
    (acc, batch) => {
      acc.total += batch.total_amount;
      acc.lines += batch.line_count;
      acc.exceptions += batch.exception_count;
      return acc;
    },
    { total: 0, lines: 0, exceptions: 0 }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settlement Reconciliation</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Import bank/UPI/card statement CSVs and reconcile them against recorded invoice and customer payments.
          </p>
        </div>
        <button
          onClick={() => fetchBatches()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition self-start"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <FileUp className="w-4 h-4 text-brand-600" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Import Statement</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-600 dark:text-slate-300 mb-1">Statement File (CSV)</label>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                  <Upload className="w-4 h-4" />
                  Choose CSV
                </button>
                {fileName && (
                  <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                    {fileName}
                    <button
                      type="button"
                      onClick={() => {
                        setFileName(null);
                        setCsvText("");
                        setPreview(null);
                      }}
                      className="text-slate-400 hover:text-rose-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Or paste CSV rows
            </label>
            <textarea
              rows={4}
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setPreview(null);
              }}
              placeholder={"date,utr,amount,mode\n2026-11-10,UTR123456,500.00,UPI"}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Header may use UTR / RRN / Txn Ref for reference and Amount / Credit / Net Amount for the value.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Batch Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Nov 1-10 UPI settlement"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>

          {importError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs">
              {importError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handlePreview}
              disabled={isPreviewing || !csvText.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition"
            >
              <GitCompareArrows className={`w-4 h-4 ${isPreviewing ? "animate-spin" : ""}`} />
              Preview Matches
            </button>
            <button
              onClick={handleImport}
              disabled={isImporting || !csvText.trim()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white shadow-sm disabled:opacity-50 transition"
            >
              <Upload className="w-4 h-4" />
              {isImporting ? "Importing..." : "Import & Reconcile"}
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Reconciliation Summary</h2>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">Batches</span>
              <span className="font-bold text-slate-900 dark:text-white">{batches.length}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">Settled Amount</span>
              <span className="font-bold text-slate-900 dark:text-white">{formatINR(summary.total)}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-500">Lines Imported</span>
              <span className="font-bold text-slate-900 dark:text-white">{summary.lines}</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <span className="text-amber-700 dark:text-amber-300">Open Exceptions</span>
              <span className="font-bold text-amber-800 dark:text-amber-200">{summary.exceptions}</span>
            </div>
          </div>
          {preview && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-xs space-y-1.5">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Last Preview</div>
              <div className="flex justify-between text-slate-500">
                <span>Rows</span>
                <span>{preview.row_count}</span>
              </div>
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                <span>Predictable matches</span>
                <span>{preview.matched}</span>
              </div>
              <div className="flex justify-between text-amber-600 dark:text-amber-400">
                <span>Exceptions</span>
                <span>{preview.exceptions}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>Total value</span>
                <span>{formatINR(preview.total_amount)}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {preview && preview.rows.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
            Preview Results ({preview.rows.length} rows, not yet imported)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/80 uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Invoice</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {preview.rows.map((row, index) => (
                  <tr key={`${row.reference}-${index}`}>
                    <td className="px-3 py-2 text-slate-500">{formatDate(row.txn_date)}</td>
                    <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">{row.reference}</td>
                    <td className="px-3 py-2 text-right">{formatINR(row.amount)}</td>
                    <td className="px-3 py-2 uppercase text-slate-500">{row.mode || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold ${LINE_STYLES[row.status] || LINE_STYLES.unmatched}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{row.invoice_number || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{row.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-700 dark:text-rose-200 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
          Settlement Batches
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/80 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Lines</th>
                <th className="px-4 py-3 text-right">Matched</th>
                <th className="px-4 py-3 text-right">Exceptions</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Imported</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading settlement batches...
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-slate-400 text-sm">
                    <FileSpreadsheet className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    No settlement batches imported yet. Upload a statement above to begin.
                  </td>
                </tr>
              ) : (
                batches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-white">#{batch.id}</div>
                      <div className="text-xs text-slate-400">{batch.file_name || batch.notes || "—"}</div>
                    </td>
                    <td className="px-4 py-3 uppercase text-xs font-semibold text-slate-600 dark:text-slate-300">{batch.source}</td>
                    <td className="px-4 py-3 text-right">{formatINR(batch.total_amount)}</td>
                    <td className="px-4 py-3 text-right">{batch.line_count}</td>
                    <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400 font-medium">{batch.matched_count}</td>
                    <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400 font-medium">{batch.exception_count}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold border ${BATCH_STYLES[batch.status] || BATCH_STYLES.imported}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{formatDate(batch.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setLineFilter("");
                          loadLines(batch);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                      >
                        <GitCompareArrows className="w-3.5 h-3.5 text-brand-600" />
                        Review
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-slate-50 dark:bg-slate-900/60">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                  Settlement Batch #{selectedBatch.id}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatINR(selectedBatch.total_amount)} · {selectedBatch.line_count} lines ·{" "}
                  <span className={`inline-flex px-1.5 py-0.2 rounded border text-[10px] font-semibold ${BATCH_STYLES[selectedBatch.status] || BATCH_STYLES.imported}`}>
                    {selectedBatch.status}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={lineFilter}
                  onChange={(e) => {
                    setLineFilter(e.target.value);
                    loadLines(selectedBatch, e.target.value);
                  }}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">All Lines</option>
                  <option value="matched">Matched</option>
                  <option value="unmatched">Unmatched</option>
                  <option value="exception">Exception</option>
                  <option value="resolved">Resolved</option>
                  <option value="ignored">Ignored</option>
                </select>
                <button
                  onClick={handleRematch}
                  disabled={isRematching}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 text-white disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRematching ? "animate-spin" : ""}`} />
                  Re-run Matching
                </button>
                <button onClick={() => setSelectedBatch(null)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto">
              {isLoadingLines ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading settlement lines...
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-900/80 uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Reference</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2">Mode</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Matched To</th>
                        <th className="px-3 py-2">Note</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                            No lines for this filter.
                          </td>
                        </tr>
                      ) : (
                        lines.map((line) => (
                          <tr key={line.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
                            <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatDate(line.txn_date)}</td>
                            <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-200">{line.reference}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatINR(line.amount)}</td>
                            <td className="px-3 py-2 uppercase text-slate-500">{line.mode || "—"}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold ${LINE_STYLES[line.status] || LINE_STYLES.unmatched}`}>
                                {line.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              {line.match_type ? (
                                <span className="inline-flex items-center gap-1">
                                  <Link2 className="w-3 h-3 text-slate-400" />
                                  {line.invoice_number || `${line.match_type} #${line.match_id}`}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-500">
                              <span className="inline-flex items-center gap-1">
                                {line.status === "exception" && <AlertTriangle className="w-3 h-3 text-rose-500" />}
                                {line.status === "matched" && <CheckCircle2 className="w-3 h-3 text-emerald-500" />}
                                {line.note || "—"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {(line.status === "unmatched" || line.status === "exception") && (
                                <button
                                  onClick={() => handleIgnore(line)}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                                >
                                  <EyeOff className="w-3 h-3" />
                                  Ignore
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Imported {formatDateTime(selectedBatch.created_at)}
                {selectedBatch.period_start ? ` · period ${formatDate(selectedBatch.period_start)} – ${formatDate(selectedBatch.period_end)}` : ""}
              </span>
              <button
                onClick={() => setSelectedBatch(null)}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
