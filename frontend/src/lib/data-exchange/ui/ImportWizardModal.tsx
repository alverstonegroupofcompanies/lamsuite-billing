import React, { useState, useEffect } from "react";
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Download,
  Sparkles,
  Settings,
  Layers,
  Save,
  Check,
  RotateCcw,
  RefreshCw,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { entityRegistry } from "../registry/entityRegistry";
import type {
  EntityDefinition,
  ColumnMapping,
  ImportPreviewRow,
  ImportDryRunSummary,
  RowAction,
} from "../registry/types";
import { universalDataParser, type ParseResult } from "../engine/parser";
import { columnMapper, BUILTIN_SOURCE_PRESETS } from "../engine/columnMapper";
import { dataValidator } from "../engine/validator";
import { templateGenerator } from "../engine/templateGenerator";
import { transactionalImporter } from "../engine/transactionalImporter";
import { nonBlockingChunkRunner, type WorkerProgressEvent } from "../engine/importWorker";
import { EditablePreviewGrid } from "./EditablePreviewGrid";
import { sqliteStorage } from "../../db/sqliteStorage";
import { useModalEscape } from "../../ui/modalEscapeManager";

interface ImportWizardModalProps {
  isOpen: boolean;
  initialEntityId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

type WizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export const ImportWizardModal: React.FC<ImportWizardModalProps> = ({
  isOpen,
  initialEntityId = "items",
  onClose,
  onSuccess,
}) => {
  useModalEscape(isOpen, onClose);

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [selectedEntityId, setSelectedEntityId] = useState<string>(initialEntityId);
  const [entitySearch, setEntitySearch] = useState("");

  // File & parsing state
  const [fileName, setFileName] = useState("import.csv");
  const [pastedText, setPastedText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);

  // Column mapping state
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("lamsuite_standard");

  // Preview & Validation state
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [dryRunSummary, setDryRunSummary] = useState<ImportDryRunSummary | null>(null);
  const [actionPolicy, setActionPolicy] = useState<
    "create_missing_masters" | "skip_duplicates" | "update_existing" | "merge_existing"
  >("create_missing_masters");

  // Progress & Execution state
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<WorkerProgressEvent | null>(null);
  const [importResult, setImportResult] = useState<any | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<"csv" | "excel" | null>(null);
  const [templateNotification, setTemplateNotification] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const entityDef: EntityDefinition =
    entityRegistry.get(selectedEntityId) || entityRegistry.get("items")!;

  // Keyboard shortcut Ctrl+Enter to proceed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (currentStep < 8 && !isProcessing) {
          handleNextStep();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (!isOpen) return null;

  // STEP 2: File Upload / Text handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        processUploadedContent(content, file.name);
      }
    };
    reader.readAsText(file);
  };

  const processUploadedContent = (text: string, name: string) => {
    setPastedText(text);
    const parsed = universalDataParser.parseText(text, name);
    setParseResult(parsed);
    setSelectedSheetIndex(0);

    // Initial column mapping suggestion
    const activeSheet = parsed.sheets[0];
    if (activeSheet) {
      const mappings = columnMapper.suggestMapping(activeSheet.headers, entityDef, selectedPreset);
      setColumnMappings(mappings);
    }

    if (parsed.sheets.length > 1) {
      setCurrentStep(3); // Sheet picker
    } else {
      setCurrentStep(4); // Column mapping
    }
  };

  const handleApplyPreset = (presetId: string) => {
    setSelectedPreset(presetId);
    if (parseResult) {
      const activeSheet = parseResult.sheets[selectedSheetIndex];
      if (activeSheet) {
        const mappings = columnMapper.suggestMapping(activeSheet.headers, entityDef, presetId);
        setColumnMappings(mappings);
      }
    }
  };

  const handleUpdateMapping = (sourceCol: string, targetField: string | null) => {
    setColumnMappings((prev) =>
      prev.map((m) =>
        m.sourceColumn === sourceCol
          ? { ...m, targetField, isAutoMatched: false, confidence: 1.0 }
          : m
      )
    );
  };

  // STEP 4 -> 5: Build preview data and validate
  const preparePreviewAndValidate = async () => {
    if (!parseResult) return;
    const activeSheet = parseResult.sheets[selectedSheetIndex];
    if (!activeSheet) return;

    setIsProcessing(true);
    try {
      // 1. Map columns into entity fields
      const mappingDict: Record<string, string> = {};
      columnMappings.forEach((m) => {
        if (m.targetField) mappingDict[m.sourceColumn] = m.targetField;
      });

      const mappedRows = activeSheet.rows.map((row) => {
        const entityRow: Record<string, any> = {};
        for (const [srcCol, targetField] of Object.entries(mappingDict)) {
          entityRow[targetField] = row[srcCol];
        }
        return entityRow;
      });

      // 2. Load context (existing records & foreign keys)
      const existing = entityDef.exportQuery
        ? await entityDef.exportQuery()
        : await sqliteStorage.findAll<any>(entityDef.targetTable);
      const foreignKeysCache: Record<string, any[]> = {};
      if (entityDef.foreignKeys) {
        for (const fk of entityDef.foreignKeys) {
          const targetDef = entityRegistry.get(fk.targetEntityId);
          if (targetDef) {
            foreignKeysCache[fk.targetEntityId] = targetDef.exportQuery
              ? await targetDef.exportQuery()
              : await sqliteStorage.findAll<any>(targetDef.targetTable);
          }
        }
      }

      // 3. Perform Dry Run
      const { previewRows: pRows, summary } = dataValidator.performDryRun(
        mappedRows,
        entityDef,
        { existingRecords: existing, foreignKeysCache },
        actionPolicy
      );

      setPreviewRows(pRows);
      setDryRunSummary(summary);
      setCurrentStep(5);
    } catch (err: any) {
      alert(`Dry run validation failed: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // In-grid row editing
  const handleUpdateRowData = (rowNumber: number, field: string, newValue: any) => {
    setPreviewRows((prev) =>
      prev.map((r) => {
        if (r.rowNumber === rowNumber) {
          return {
            ...r,
            data: { ...r.data, [field]: newValue },
          };
        }
        return r;
      })
    );
  };

  const handleUpdateRowAction = (rowNumber: number, action: RowAction) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.rowNumber === rowNumber ? { ...r, action } : r))
    );
  };

  // STEP 8: Execute Import
  const handleCommitImport = async () => {
    setIsProcessing(true);
    setCurrentStep(8);
    setProgress({
      processed: 0,
      total: previewRows.length,
      percentage: 0,
      rowsPerSecond: 0,
      stage: "importing",
    });

    const actionMap = new Map<number, RowAction>();
    previewRows.forEach((r) => actionMap.set(r.rowNumber, r.action));

    try {
      const result = await transactionalImporter.executeImport({
        entityDef,
        fileName,
        rows: previewRows.map((r) => r.data),
        rowActions: actionMap,
        actionPolicy,
        onProgress: (p) => {
          setProgress({
            processed: p.current,
            total: p.total,
            percentage: p.percent,
            rowsPerSecond: 0,
            stage: "importing",
          });
        },
        shouldCancel: () => nonBlockingChunkRunner.cancelled,
      });

      setImportResult(result);
    } catch (err: any) {
      alert(`Import transaction aborted: ${err?.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleModalClose = () => {
    if (importResult && onSuccess) {
      onSuccess();
    } else {
      onClose();
    }
  };

  const handleDownloadTemplate = async (format: "csv" | "excel") => {
    setDownloadingFormat(format);
    try {
      const isCsv = format === "csv";
      const content = isCsv
        ? templateGenerator.generateCsvTemplate(entityDef, true)
        : templateGenerator.generateExcelXmlTemplate(entityDef, true);
      const mime = isCsv ? "text/csv;charset=utf-8;" : "application/vnd.ms-excel";
      const fileName = `${entityDef.id}_template.${isCsv ? "csv" : "xlsx"}`;

      const res = await templateGenerator.downloadTemplate(fileName, content, format, mime);
      if (res.success) {
        setTemplateNotification({
          message: res.filePath
            ? `Template saved: ${res.filePath}`
            : `Template downloaded successfully (${fileName})`,
          type: "success",
        });
        setTimeout(() => setTemplateNotification(null), 4500);
      } else if (res.error) {
        setTemplateNotification({
          message: `Download failed: ${res.error}`,
          type: "error",
        });
        setTimeout(() => setTemplateNotification(null), 4500);
      }
    } catch (err: any) {
      setTemplateNotification({
        message: `Download failed: ${err?.message || err}`,
        type: "error",
      });
      setTimeout(() => setTemplateNotification(null), 4500);
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleDownloadErrorSpreadsheet = async () => {
    try {
      const errorRows = previewRows.filter((r) => r.errors.length > 0 || r.action === "error");
      const csv = templateGenerator.generateErrorCsv(errorRows);
      const errName = `Errors_${fileName || entityDef.id}.csv`;
      const res = await templateGenerator.downloadTemplate(errName, csv, "csv");
      if (res.success) {
        setTemplateNotification({
          message: res.filePath
            ? `Error report saved: ${res.filePath}`
            : `Downloaded ${errName}`,
          type: "success",
        });
        setTimeout(() => setTemplateNotification(null), 4500);
      }
    } catch (err: any) {
      setTemplateNotification({
        message: `Export failed: ${err?.message || err}`,
        type: "error",
      });
      setTimeout(() => setTemplateNotification(null), 4500);
    }
  };

  const handleNextStep = () => {
    if (currentStep === 1) setCurrentStep(2);
    else if (currentStep === 2) {
      if (!pastedText.trim()) {
        alert("Please select a file or paste spreadsheet data.");
        return;
      }
      processUploadedContent(pastedText, fileName);
    } else if (currentStep === 3) setCurrentStep(4);
    else if (currentStep === 4) preparePreviewAndValidate();
    else if (currentStep === 5) setCurrentStep(6);
    else if (currentStep === 6) setCurrentStep(7);
    else if (currentStep === 7) handleCommitImport();
  };

  const handlePrevStep = () => {
    if (currentStep > 1) setCurrentStep((prev) => (prev - 1) as WizardStep);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 select-none">
      <div className="w-full max-w-5xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Wizard Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-3.5 bg-gradient-to-r from-slate-50 to-blue-50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800">Import Wizard: {entityDef.label}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                  Step {currentStep} of 8
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">
                Universal offline-first spreadsheet importer with atomic rollback
              </p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Step Progress Pills */}
        <div className="px-6 py-2 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold text-slate-500 overflow-x-auto">
          {[
            { s: 1, label: "1. Type" },
            { s: 2, label: "2. Upload" },
            { s: 3, label: "3. Sheet" },
            { s: 4, label: "4. Map" },
            { s: 5, label: "5. Preview" },
            { s: 6, label: "6. Dry Run" },
            { s: 7, label: "7. Policy" },
            { s: 8, label: "8. Commit" },
          ].map((item) => (
            <div
              key={item.s}
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 py-0.5 rounded ${
                currentStep === item.s
                  ? "bg-blue-600 text-white font-bold"
                  : currentStep > item.s
                  ? "text-blue-700 font-bold"
                  : "text-slate-400"
              }`}
            >
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Template Notification Toast */}
        {templateNotification && (
          <div
            className={`mx-6 mt-3 flex items-center justify-between rounded-xl px-4 py-2.5 text-xs font-semibold shadow-xs transition-all ${
              templateNotification.type === "success"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {templateNotification.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
              )}
              <span>{templateNotification.message}</span>
            </div>
            <button
              onClick={() => setTemplateNotification(null)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Wizard Main Content Body */}
        <div className="flex-1 overflow-auto p-6">
          {/* STEP 1: Choose Entity Type & Download Templates */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Select Data Type to Import</h4>
                  <p className="text-xs text-slate-500">
                    Choose which catalog master, party directory, or transaction type to import.
                  </p>
                </div>
                {/* Download Templates Button */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadTemplate("csv")}
                    disabled={downloadingFormat !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-60"
                  >
                    {downloadingFormat === "csv" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                    ) : (
                      <Download className="h-3.5 w-3.5 text-blue-600" />
                    )}
                    <span>Download CSV Template</span>
                  </button>
                  <button
                    onClick={() => handleDownloadTemplate("excel")}
                    disabled={downloadingFormat !== null}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-60"
                  >
                    {downloadingFormat === "excel" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    <span>Download Excel Template</span>
                  </button>
                </div>
              </div>

              {/* Grid of 20 Entity Types */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[380px] overflow-auto p-1">
                {entityRegistry.getImportable().map((def) => {
                  const isSelected = selectedEntityId === def.id;
                  return (
                    <div
                      key={def.id}
                      onClick={() => setSelectedEntityId(def.id)}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        isSelected
                          ? "border-blue-600 bg-blue-50/70 shadow-sm ring-2 ring-blue-500/20"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-bold text-slate-800">{def.label}</span>
                        {isSelected && <Check className="h-4 w-4 text-blue-600" />}
                      </div>
                      <p className="text-[10px] text-slate-500 line-clamp-2 leading-relaxed">
                        {def.description}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Upload File or Paste Spreadsheet Data */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Upload Excel or CSV File</h4>
                <p className="text-xs text-slate-500">
                  Select a `.xlsx`, `.csv`, or `.tsv` file, or paste tabular spreadsheet rows directly.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Drag and drop upload box */}
                <label className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer bg-slate-50/50 hover:bg-blue-50/30 transition-colors text-center">
                  <FileSpreadsheet className="h-10 w-10 text-blue-600 mb-2" />
                  <span className="text-xs font-bold text-slate-800">Click to browse or drag file here</span>
                  <span className="text-[11px] text-slate-500 mt-1">Supports Excel (.xlsx, XML) and CSV (.csv, .tsv)</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,.tsv,.xml,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>

                {/* Paste Textarea */}
                <div className="flex flex-col">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-700">Or Paste Tabular Text:</span>
                    <button
                      onClick={() => {
                        const sample = templateGenerator.generateCsvTemplate(entityDef, true);
                        setPastedText(sample);
                        processUploadedContent(sample, "sample.csv");
                      }}
                      className="text-[11px] text-blue-600 font-semibold hover:underline flex items-center gap-1"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Load Sample Rows</span>
                    </button>
                  </div>
                  <textarea
                    rows={8}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder="Paste CSV, TSV, or Excel copy-paste text here..."
                    className="w-full flex-1 rounded-xl border border-slate-300 p-3 font-mono text-xs focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Multi-Sheet Picker */}
          {currentStep === 3 && parseResult && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Select Worksheet</h4>
                <p className="text-xs text-slate-500">
                  The uploaded file contains multiple sheets. Choose which sheet to import.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {parseResult.sheets.map((sh, idx) => (
                  <div
                    key={sh.sheetName}
                    onClick={() => {
                      setSelectedSheetIndex(idx);
                      const mappings = columnMapper.suggestMapping(sh.headers, entityDef, selectedPreset);
                      setColumnMappings(mappings);
                    }}
                    className={`p-4 rounded-xl border cursor-pointer text-left transition-all ${
                      selectedSheetIndex === idx
                        ? "border-blue-600 bg-blue-50 ring-2 ring-blue-500/20"
                        : "border-slate-200 bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-800 mb-1">{sh.sheetName}</div>
                    <div className="text-[11px] text-slate-500">
                      {sh.totalRows} rows · {sh.headers.length} columns
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: Column Mapping with Presets */}
          {currentStep === 4 && parseResult && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Map File Columns to Product Fields</h4>
                  <p className="text-xs text-slate-500">
                    Verify and map spreadsheet headers. Use presets for Marg ERP, Busy, or Tally.
                  </p>
                </div>

                {/* Preset Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">Source Preset:</span>
                  <select
                    value={selectedPreset}
                    onChange={(e) => handleApplyPreset(e.target.value)}
                    className="text-xs font-bold rounded-lg border border-slate-300 p-1.5 bg-white text-slate-800 focus:border-blue-600"
                  >
                    {BUILTIN_SOURCE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mapping Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs max-h-[380px] overflow-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-slate-700 sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5">Spreadsheet Column (Source)</th>
                      <th className="px-4 py-2.5">Mapping Status</th>
                      <th className="px-4 py-2.5">Destination Field ({entityDef.label})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {columnMappings.map((m) => (
                      <tr key={m.sourceColumn} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 font-bold text-slate-800">{m.sourceColumn}</td>
                        <td className="px-4 py-2.5">
                          {m.targetField ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              Matched ({Math.round(m.confidence * 100)}%)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">
                              Ignore Column
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={m.targetField || ""}
                            onChange={(e) => handleUpdateMapping(m.sourceColumn, e.target.value || null)}
                            className="w-full rounded-lg border border-slate-300 p-1.5 text-xs text-slate-800 bg-white font-medium focus:border-blue-600"
                          >
                            <option value="">-- Ignore (Do Not Import) --</option>
                            {Object.values(entityDef.fields).map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label} {f.required ? "*" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* STEP 5: Interactive Editable Grid */}
          {currentStep === 5 && (
            <div className="space-y-3 flex flex-col h-full">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Interactive Preview & Grid Editing</h4>
                  <p className="text-xs text-slate-500">
                    Review parsed records. Invalid cells are highlighted in red. Click any cell to fix in-place.
                  </p>
                </div>
                {previewRows.some((r) => r.errors.length > 0) && (
                  <button
                    onClick={handleDownloadErrorSpreadsheet}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-semibold"
                  >
                    <Download className="h-3.5 w-3.5 text-rose-600" />
                    <span>Download Error File</span>
                  </button>
                )}
              </div>

              <EditablePreviewGrid
                rows={previewRows}
                entityDef={entityDef}
                onUpdateRowData={handleUpdateRowData}
                onUpdateRowAction={handleUpdateRowAction}
              />
            </div>
          )}

          {/* STEP 6: Dry Run Summary */}
          {currentStep === 6 && dryRunSummary && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Dry Run Validation Results</h4>
                <p className="text-xs text-slate-500">
                  Pre-computation of exactly what will be created, updated, or skipped before writing to database.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50">
                  <div className="text-[11px] font-bold text-emerald-700 uppercase">To Create</div>
                  <div className="text-2xl font-extrabold text-emerald-900 mt-1">
                    {dryRunSummary.toCreateCount}
                  </div>
                  <div className="text-[10px] text-emerald-600">Brand new records</div>
                </div>

                <div className="p-4 rounded-xl border border-blue-200 bg-blue-50">
                  <div className="text-[11px] font-bold text-blue-700 uppercase">To Update</div>
                  <div className="text-2xl font-extrabold text-blue-900 mt-1">
                    {dryRunSummary.toUpdateCount}
                  </div>
                  <div className="text-[10px] text-blue-600">Matching existing keys</div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
                  <div className="text-[11px] font-bold text-slate-600 uppercase">To Skip</div>
                  <div className="text-2xl font-extrabold text-slate-800 mt-1">
                    {dryRunSummary.toSkipCount}
                  </div>
                  <div className="text-[10px] text-slate-500">Ignored rows</div>
                </div>

                <div className="p-4 rounded-xl border border-rose-200 bg-rose-50">
                  <div className="text-[11px] font-bold text-rose-700 uppercase">Errors</div>
                  <div className="text-2xl font-extrabold text-rose-900 mt-1">
                    {dryRunSummary.errorRowsCount}
                  </div>
                  <div className="text-[10px] text-rose-600">Must be fixed or skipped</div>
                </div>
              </div>

              {/* Missing Masters Notice */}
              {dryRunSummary.missingMasters.length > 0 && (
                <div className="p-4 rounded-xl border border-amber-200 bg-amber-50">
                  <div className="flex items-center gap-2 text-amber-900 font-bold text-xs mb-1">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span>Referenced Masters Not Found</span>
                  </div>
                  <p className="text-[11px] text-amber-800 mb-2">
                    The following groups, brands or units were not found in local registries:
                  </p>
                  <div className="space-y-1">
                    {dryRunSummary.missingMasters.map((mm) => (
                      <div key={mm.entityId} className="text-xs text-amber-900">
                        <span className="font-bold capitalize">{mm.entityId}:</span>{" "}
                        {mm.values.join(", ")}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 7: Conflict Resolution Policy */}
          {currentStep === 7 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Conflict Resolution & Action Policy</h4>
                <p className="text-xs text-slate-500">
                  Choose how existing duplicate items and missing master records should be resolved.
                </p>
              </div>

              <div className="space-y-3">
                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    actionPolicy === "create_missing_masters"
                      ? "border-blue-600 bg-blue-50/50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="policy"
                    checked={actionPolicy === "create_missing_masters"}
                    onChange={() => setActionPolicy("create_missing_masters")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-800">
                      Auto-create Missing Masters & Update Existing Records (Recommended)
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Automatically creates new categories, brands, or units if they do not exist, and updates prices/stock for existing barcodes.
                    </div>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    actionPolicy === "skip_duplicates"
                      ? "border-blue-600 bg-blue-50/50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="policy"
                    checked={actionPolicy === "skip_duplicates"}
                    onChange={() => setActionPolicy("skip_duplicates")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-800">Skip Existing Records (Insert New Only)</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Never modifies existing items or parties. Only inserts records with unseen barcodes or phone numbers.
                    </div>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${
                    actionPolicy === "update_existing"
                      ? "border-blue-600 bg-blue-50/50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="policy"
                    checked={actionPolicy === "update_existing"}
                    onChange={() => setActionPolicy("update_existing")}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-xs font-bold text-slate-800">Overwrite & Replace Existing Records</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Completely replaces existing catalog prices, MRPs, and metadata with the spreadsheet contents.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 8: Execution & Result Progress */}
          {currentStep === 8 && (
            <div className="space-y-5 text-center py-6">
              {isProcessing ? (
                <div className="space-y-4 max-w-md mx-auto">
                  <div className="p-4 rounded-full bg-blue-100 text-blue-600 inline-block animate-pulse">
                    <RefreshCw className="h-8 w-8 animate-spin" />
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">Processing Batch Import...</h4>
                  <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${progress?.percentage || 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 font-mono">
                    <span>
                      {progress?.processed || 0} of {progress?.total || 0} records
                    </span>
                    <span>{progress?.percentage || 0}%</span>
                  </div>
                  <button
                    onClick={() => nonBlockingChunkRunner.cancel()}
                    className="text-xs text-rose-600 hover:underline font-semibold"
                  >
                    Cancel Import
                  </button>
                </div>
              ) : importResult ? (
                <div className="space-y-4 max-w-md mx-auto">
                  <div className="p-4 rounded-full bg-emerald-100 text-emerald-600 inline-block">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-slate-800">Import Completed Successfully!</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      All valid {entityDef.label.toLowerCase()} records have been committed to the database.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">Created</div>
                      <div className="text-lg font-bold text-emerald-600">{importResult.createdCount}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">Updated</div>
                      <div className="text-lg font-bold text-blue-600">{importResult.updatedCount}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">Skipped</div>
                      <div className="text-lg font-bold text-slate-600">{importResult.skippedCount}</div>
                    </div>
                  </div>
                  {actionPolicy === "create_missing_masters" &&
                    dryRunSummary &&
                    dryRunSummary.missingMasters.length > 0 && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-left text-xs text-emerald-800">
                        <div className="font-bold mb-1 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          <span>Referenced Masters Auto-Created:</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {dryRunSummary.missingMasters.map((mm) => (
                            <span
                              key={mm.entityId}
                              className="px-2 py-0.5 rounded bg-white border border-emerald-200 text-emerald-900 font-semibold text-[11px]"
                            >
                              {mm.entityId}: {mm.values.join(", ")}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  <div className="text-xs text-slate-500">
                    Execution time: {importResult.executionTimeMs}ms · Batch Token:{" "}
                    <span className="font-mono text-slate-700">{importResult.batchId}</span>
                  </div>
                  <div className="pt-2">
                    <button
                      onClick={handleModalClose}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-6 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
                    >
                      <Check className="h-4 w-4" />
                      <span>Done & Close</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Wizard Footer Controls */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-between items-center">
          <div>
            {currentStep > 1 && currentStep < 8 && !isProcessing && (
              <button
                onClick={handlePrevStep}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleModalClose}
              className={`rounded-lg px-4 py-1.5 text-xs font-semibold ${
                currentStep === 8 && !isProcessing
                  ? "bg-emerald-600 text-white hover:bg-emerald-700 font-bold"
                  : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }`}
            >
              {currentStep === 8 && !isProcessing ? "Done & Close" : "Cancel"}
            </button>

            {currentStep < 7 && (
              <button
                onClick={handleNextStep}
                disabled={isProcessing}
                className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
              >
                <span>Continue</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}

            {currentStep === 7 && (
              <button
                onClick={handleCommitImport}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Execute Import Batch</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
