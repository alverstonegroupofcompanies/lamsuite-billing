import React, { useState } from "react";
import { X, Upload, FileSpreadsheet, CheckCircle, AlertCircle, ArrowRight, Sparkles } from "lucide-react";
import {
  interStoreTransferService,
  type InterStoreTransferLine,
  type TransferRateBasis,
  type TransferGstTreatment,
} from "../lib/stock/interStoreTransferService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

interface CsvTransferImportModalProps {
  isOpen: boolean;
  rateBasis: TransferRateBasis;
  gstTreatment: TransferGstTreatment;
  onClose: () => void;
  onImportSuccess: (lines: InterStoreTransferLine[]) => void;
}

export const CsvTransferImportModal: React.FC<CsvTransferImportModalProps> = ({
  isOpen,
  rateBasis,
  gstTreatment,
  onClose,
  onImportSuccess,
}) => {
  useModalEscape(isOpen, onClose);

  const [pastedText, setPastedText] = useState("");
  const [parsedResult, setParsedResult] = useState<{
    validLines: InterStoreTransferLine[];
    invalidRows: Array<{ row: number; raw: string; error: string }>;
    summary: { totalRows: number; validCount: number; invalidCount: number };
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isOpen) return null;

  const handleValidate = async () => {
    if (!pastedText.trim()) return;
    setIsProcessing(true);
    try {
      const result = await interStoreTransferService.importFromCsv(pastedText, rateBasis, gstTreatment);
      setParsedResult(result);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setPastedText(content);
        interStoreTransferService.importFromCsv(content, rateBasis, gstTreatment).then(setParsedResult);
      }
    };
    reader.readAsText(file);
  };

  const handleApply = () => {
    if (parsedResult && parsedResult.validLines.length > 0) {
      onImportSuccess(parsedResult.validLines);
      onClose();
    }
  };

  const handleLoadSample = () => {
    const sample = `Barcode\tBatch\tQty
8901234567890\tDL-101\t5
8909876543210\tBN-55\t10
8901112223334\tP-99\t2.5`;
    setPastedText(sample);
    interStoreTransferService.importFromCsv(sample, rateBasis, gstTreatment).then(setParsedResult);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 select-none font-sans animate-in fade-in duration-100">
      <div className="w-full max-w-3xl rounded-card bg-surface shadow-modal border border-border-main overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-main px-6 py-4 bg-canvas">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-btn bg-accent-soft text-accent">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-text-main">Bulk Import Transfer Lines</h3>
              <p className="text-xs text-text-muted">
                Upload CSV / Excel or paste table data (Barcode/Product, Batch, Transfer Quantity)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-main rounded-btn hover:bg-surface transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg border border-slate-300 transition-colors shadow-2xs">
                <Upload className="h-3.5 w-3.5 text-blue-600" />
                <span>Upload CSV / Excel File</span>
                <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
              </label>
              <button
                type="button"
                onClick={handleLoadSample}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline inline-flex items-center gap-1"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Load Sample Template
              </button>
            </div>

            {parsedResult && (
              <div className="flex items-center gap-3 text-xs font-bold">
                <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                  {parsedResult.summary.validCount} Valid Lines
                </span>
                {parsedResult.summary.invalidCount > 0 && (
                  <span className="text-red-700 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                    {parsedResult.summary.invalidCount} Invalid Rows
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Paste Input Area */}
          <div>
            <textarea
              rows={5}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={`Paste your tabular data here (tab or comma-separated)...\nExample:\n8901234567890\tDL-101\t5\n8909876543210\tBN-55\t10`}
              className="w-full rounded-xl border border-slate-300 p-3 font-mono text-xs text-slate-800 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 focus:outline-none"
            />
            <div className="flex justify-end mt-1.5">
              <button
                type="button"
                onClick={handleValidate}
                disabled={!pastedText.trim() || isProcessing}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition-colors disabled:opacity-50"
              >
                {isProcessing ? "Validating..." : "Validate & Preview Rows"}
              </button>
            </div>
          </div>

          {/* Validation Preview Tables */}
          {parsedResult && (
            <div className="space-y-3 pt-2">
              {/* Valid lines preview */}
              {parsedResult.validLines.length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
                  <h4 className="text-xs font-bold text-emerald-900 mb-2 flex items-center gap-1.5">
                    <CheckCircle className="h-4 w-4 text-emerald-600" />
                    Ready to Import ({parsedResult.validLines.length} lines)
                  </h4>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-emerald-100 bg-white">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-emerald-50/80 text-emerald-900 font-bold border-b border-emerald-100">
                        <tr>
                          <th className="p-2">#</th>
                          <th className="p-2">Product Name</th>
                          <th className="p-2">Batch</th>
                          <th className="p-2">Expiry</th>
                          <th className="p-2 text-right">Transfer Qty</th>
                          <th className="p-2 text-right">Rate (₹)</th>
                          <th className="p-2 text-right">Line Total (₹)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedResult.validLines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-2 text-slate-400 font-mono">{idx + 1}</td>
                            <td className="p-2 font-bold text-slate-800">{line.product_name}</td>
                            <td className="p-2 font-mono text-slate-600">{line.batch_no}</td>
                            <td className="p-2 text-slate-500">{line.expiry_date}</td>
                            <td className="p-2 text-right font-bold text-blue-700">
                              {line.transfer_packs > 0 ? `${line.transfer_packs} pk ` : ""}
                              {line.transfer_loose > 0 ? `${line.transfer_loose} ${line.loose_unit_name}` : ""}
                            </td>
                            <td className="p-2 text-right text-slate-700">₹{line.unit_rate.toFixed(2)}</td>
                            <td className="p-2 text-right font-bold text-slate-900">₹{line.total_amount.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Invalid rows feedback */}
              {parsedResult.invalidRows.length > 0 && (
                <div className="rounded-xl border border-red-200 bg-red-50/40 p-3.5">
                  <h4 className="text-xs font-bold text-red-900 mb-2 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    Invalid Rows ({parsedResult.invalidRows.length}) - will be skipped
                  </h4>
                  <div className="max-h-32 overflow-y-auto rounded-lg border border-red-100 bg-white">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-red-50/80 text-red-900 font-bold border-b border-red-100">
                        <tr>
                          <th className="p-2 w-12">Row</th>
                          <th className="p-2">Raw Content</th>
                          <th className="p-2">Validation Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-50">
                        {parsedResult.invalidRows.map((err, idx) => (
                          <tr key={idx} className="hover:bg-red-50/30">
                            <td className="p-2 font-mono font-bold text-red-700">{err.row}</td>
                            <td className="p-2 font-mono text-slate-600">{err.raw}</td>
                            <td className="p-2 font-semibold text-red-700">{err.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border-main bg-canvas px-6 py-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="rounded-btn border border-border-main bg-surface px-4 py-2 text-xs font-semibold text-text-muted hover:text-text-main transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!parsedResult || parsedResult.validLines.length === 0}
            className="rounded-btn bg-accent hover:opacity-90 px-5 py-2 text-xs font-bold text-white shadow-xs transition-colors disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer"
          >
            <span>Import {parsedResult?.validLines.length || 0} Lines to Transfer</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
