import React, { useState, useEffect } from "react";
import {
  X,
  Download,
  FileSpreadsheet,
  FileText,
  FileCheck,
  CheckCircle,
  FolderOpen,
  Eye,
  Sliders,
} from "lucide-react";
import { entityRegistry } from "../registry/entityRegistry";
import type { EntityDefinition } from "../registry/types";
import { universalExporter, type ExportFormat, type ExportResult } from "../engine/exporter";
import { useModalEscape } from "../../ui/modalEscapeManager";
import { getIpcBridge } from "../../ipc/ipcBridge";

interface ExportDialogModalProps {
  isOpen: boolean;
  initialEntityId?: string;
  initialRows?: Record<string, any>[];
  onClose: () => void;
}

export const ExportDialogModal: React.FC<ExportDialogModalProps> = ({
  isOpen,
  initialEntityId = "items",
  initialRows,
  onClose,
}) => {
  useModalEscape(isOpen, onClose);

  const [selectedEntityId, setSelectedEntityId] = useState<string>(initialEntityId);
  const [format, setFormat] = useState<ExportFormat>("excel");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  const entityDef = entityRegistry.get(selectedEntityId) || entityRegistry.get("items")!;

  useEffect(() => {
    if (entityDef) {
      setSelectedColumns(Object.keys(entityDef.fields));
    }
  }, [selectedEntityId]);

  if (!isOpen) return null;

  const handleToggleColumn = (key: string) => {
    if (selectedColumns.includes(key)) {
      setSelectedColumns(selectedColumns.filter((c) => c !== key));
    } else {
      setSelectedColumns([...selectedColumns, key]);
    }
  };

  const handleSelectAll = () => {
    setSelectedColumns(Object.keys(entityDef.fields));
  };

  const handleDeselectAll = () => {
    setSelectedColumns([]);
  };

  const handleExecuteExport = async () => {
    setIsExporting(true);
    setExportResult(null);

    try {
      // 1. Fetch rows if not provided
      const rows = initialRows || (entityDef.exportQuery ? await entityDef.exportQuery() : []);

      // 2. Filter selected columns
      const cols = selectedColumns.map((key) => {
        const field = entityDef.fields[key];
        return {
          key,
          label: field ? field.label : key,
          format: field?.type === "currency" ? ("currency" as const) : ("text" as const),
        };
      });

      const res = await universalExporter.exportData({
        fileName: `${entityDef.id}_export_${new Date().toISOString().slice(0, 10)}`,
        format,
        title: `${entityDef.label} Export`,
        columns: cols,
        rows,
        entityDef,
        orientation,
      });

      setExportResult(res);
    } catch (err: any) {
      alert(`Export failed: ${err?.message || err}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleRevealFile = async (path: string) => {
    try {
      const ipc = getIpcBridge();
      await ipc.invoke("reveal_file", { path });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">Export Records</h3>
              <p className="text-xs text-slate-500 font-medium">
                Export to Excel, CSV, or formatted PDF with column selection
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-auto flex-1">
          {/* Entity Selector (if not pre-locked) */}
          {!initialRows && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Target Entity / Master:</label>
              <select
                value={selectedEntityId}
                onChange={(e) => setSelectedEntityId(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-300 p-2 font-semibold text-slate-800 focus:border-blue-600 focus:outline-none"
              >
                {entityRegistry.getExportable().map((def) => (
                  <option key={def.id} value={def.id}>
                    {def.label} ({def.category})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Format Picker */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">Choose Format:</label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setFormat("excel")}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  format === "excel"
                    ? "border-blue-600 bg-blue-50 text-blue-800 ring-2 ring-blue-500/20"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FileSpreadsheet className="h-6 w-6 text-emerald-600 mb-1" />
                <span className="text-xs font-bold">Excel (.xlsx)</span>
                <span className="text-[10px] text-slate-500">Styled workbook</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  format === "csv"
                    ? "border-blue-600 bg-blue-50 text-blue-800 ring-2 ring-blue-500/20"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FileCheck className="h-6 w-6 text-blue-600 mb-1" />
                <span className="text-xs font-bold">CSV (.csv)</span>
                <span className="text-[10px] text-slate-500">UTF-8 BOM compliant</span>
              </button>

              <button
                type="button"
                onClick={() => setFormat("pdf")}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all ${
                  format === "pdf"
                    ? "border-blue-600 bg-blue-50 text-blue-800 ring-2 ring-blue-500/20"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <FileText className="h-6 w-6 text-rose-600 mb-1" />
                <span className="text-xs font-bold">Vector PDF (.pdf)</span>
                <span className="text-[10px] text-slate-500">Printable document</span>
              </button>
            </div>
          </div>

          {/* PDF Orientation Option */}
          {format === "pdf" && (
            <div className="flex items-center gap-4 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
              <span className="font-semibold text-slate-700">PDF Orientation:</span>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="orientation"
                  checked={orientation === "landscape"}
                  onChange={() => setOrientation("landscape")}
                />
                <span>Landscape (Recommended for wide tables)</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="orientation"
                  checked={orientation === "portrait"}
                  onChange={() => setOrientation("portrait")}
                />
                <span>Portrait</span>
              </label>
            </div>
          )}

          {/* Column Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-700">Select Columns to Include:</label>
              <div className="flex gap-2 text-[11px]">
                <button onClick={handleSelectAll} className="text-blue-600 hover:underline">
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button onClick={handleDeselectAll} className="text-slate-500 hover:underline">
                  Deselect All
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 border border-slate-200 rounded-xl p-3 max-h-48 overflow-auto bg-slate-50">
              {Object.values(entityDef.fields).map((f) => {
                const isSelected = selectedColumns.includes(f.key);
                return (
                  <label
                    key={f.key}
                    className={`flex items-center gap-2 p-1.5 rounded-lg border text-xs cursor-pointer select-none transition-colors ${
                      isSelected ? "bg-white border-blue-400 text-slate-800 shadow-2xs" : "border-transparent text-slate-500 hover:bg-slate-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleToggleColumn(f.key)}
                      className="rounded text-blue-600 focus:ring-0"
                    />
                    <span className="truncate" title={f.label}>
                      {f.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Success Banner with Real Saved Path */}
          {exportResult && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs font-bold text-emerald-900">
                  Export Completed ({exportResult.rowCount} rows)
                </div>
                {exportResult.filePath ? (
                  <div className="text-[11px] text-emerald-700 mt-0.5 break-all">
                    Saved to: <span className="font-mono">{exportResult.filePath}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-emerald-700 mt-0.5">
                    File <span className="font-mono">{exportResult.fileName}</span> downloaded to your browser downloads folder.
                  </div>
                )}
              </div>
              {exportResult.filePath && (
                <button
                  onClick={() => handleRevealFile(exportResult.filePath!)}
                  className="px-2.5 py-1 rounded bg-white border border-emerald-300 text-emerald-800 text-[11px] font-semibold hover:bg-emerald-100 flex items-center gap-1 shadow-2xs"
                >
                  <FolderOpen className="h-3 w-3" />
                  <span>Reveal</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3.5 flex justify-between items-center">
          <div className="text-[11px] text-slate-500 font-medium">
            {selectedColumns.length} of {Object.keys(entityDef.fields).length} columns selected
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleExecuteExport}
              disabled={isExporting || selectedColumns.length === 0}
              className="rounded-lg bg-blue-600 px-5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isExporting ? "Exporting..." : "Export File"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
