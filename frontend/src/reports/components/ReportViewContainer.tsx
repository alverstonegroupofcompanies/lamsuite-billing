import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Search,
  Columns,
  Download,
  Printer,
  FileSpreadsheet,
  FileText,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import type { ReportModule, ReportSortState, ReportQueryParams, ReportQueryResult, PrintableDocumentData } from "../types";
import { reportRunner } from "../engine/ReportRunner";
import { printFormatter } from "../engine/PrintFormatter";
import { ReportFilterBar } from "./ReportFilterBar";
import { ReportTableGrid } from "./ReportTableGrid";
import { ReportColumnManagerModal } from "./ReportColumnManagerModal";
import { ReportPrintPreviewModal } from "./ReportPrintPreviewModal";
import { isTauri, getIpcBridge } from "../../lib/ipc/ipcBridge";
import { printerManagerService } from "../../lib/printing/printerManagerService";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";
import { onlineTransactionService } from "../../lib/sync/onlineTransactionService";

interface ReportViewContainerProps {
  report: ReportModule;
}

export const ReportViewContainer: React.FC<ReportViewContainerProps> = ({ report }) => {
  // Initialize filter defaults
  const initialFilters = useMemo(() => {
    const f: Record<string, any> = {};
    for (const def of report.filters) {
      f[def.id] = def.defaultValue;
    }
    return f;
  }, [report]);

  const [filters, setFilters] = useState<Record<string, any>>(initialFilters);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<ReportSortState | undefined>(report.defaultSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Column visibility state (persisted per report)
  const storageKey = `lamsuite_report_cols_${report.id}`;
  const defaultColIds = useMemo(
    () => report.columns.filter((c) => c.isDefaultVisible).map((c) => c.id),
    [report]
  );

  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) return JSON.parse(saved);
    } catch {}
    return defaultColIds;
  });

  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<ReportQueryResult>({
    rows: [],
    totalCount: 0,
    summary: {},
  });
  const [printDoc, setPrintDoc] = useState<PrintableDocumentData | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [printLayout, setPrintLayout] = useState<
    | "a4"
    | "a4-landscape"
    | "a4-portrait"
    | "thermal"
    | "dot-matrix"
    | "dot-matrix-60"
    | "dot-matrix-120"
    | "dot-matrix-132"
  >("a4");
  const [isCompactColumns, setIsCompactColumns] = useState(false);

  // Global modal escape interception
  useModalEscape(isPrintModalOpen, () => setIsPrintModalOpen(false));

  // Fetch report data
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: ReportQueryParams = {
        filters,
        searchQuery: searchQuery.trim(),
        sort,
        pagination: { page, pageSize },
      };
      const res = await reportRunner.executeReport(report, params);
      setQueryResult(res);
    } catch (err) {
      console.error(`Failed to execute report ${report.id}:`, err);
    } finally {
      setIsLoading(false);
    }
  }, [report, filters, searchQuery, sort, page, pageSize]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle column visibility change
  const handleVisibleColumnsChange = (newIds: string[]) => {
    setVisibleColumnIds(newIds);
    try {
      localStorage.setItem(storageKey, JSON.stringify(newIds));
    } catch {}
  };

  const handleResetColumns = () => {
    setVisibleColumnIds(defaultColIds);
    try {
      localStorage.removeItem(storageKey);
    } catch {}
  };

  // Sorting
  const handleSortChange = (columnId: string) => {
    if (sort?.column === columnId) {
      setSort({
        column: columnId,
        direction: sort.direction === "asc" ? "desc" : "asc",
      });
    } else {
      setSort({ column: columnId, direction: "asc" });
    }
  };

  // Export
  const handleExportCsv = () => {
    reportRunner.exportCsv(
      report,
      queryResult.rows,
      visibleColumnIds,
      filters.date_range?.startDate || filters.startDate
    );
  };

  // Print Preview
  const handleOpenPrintPreview = async (
    layout: "a4" | "a4-landscape" | "a4-portrait" | "thermal" | "dot-matrix" | "dot-matrix-132" = "a4"
  ) => {
    const isWide = visibleColumnIds.length >= 7;
    const effectiveLayout =
      layout === "a4"
        ? (isWide ? "a4-landscape" : "a4-portrait")
        : layout;
    setPrintLayout(effectiveLayout);
    // If opening A4 Portrait with 7+ columns, default to compact combined columns to save space
    if (effectiveLayout === "a4-portrait" && isWide) {
      setIsCompactColumns(true);
    } else {
      setIsCompactColumns(false);
    }
    const doc = await reportRunner.preparePrintableDocument(
      report,
      queryResult,
      filters,
      visibleColumnIds
    );
    setPrintDoc(doc);
    setIsPrintModalOpen(true);
  };

  const handleExecutePrint = () => {
    if (!printDoc) return;
    const html = printFormatter.generatePrintHtml(printDoc, printLayout, isCompactColumns);
    const isDot = printLayout.startsWith("dot-matrix");
    const cols =
      printLayout === "dot-matrix-60"
        ? 50
        : printLayout === "dot-matrix-120"
        ? 120
        : printLayout === "dot-matrix-132"
        ? 132
        : 80;

    let rawEscPosBytes: Uint8Array | undefined;
    if (isDot) {
      const text = printFormatter.generateDotMatrixText(printDoc, cols);
      rawEscPosBytes = new TextEncoder().encode(text);
    }

    printerManagerService.executePrintJob({
      printerName: "Default",
      paperSize: printLayout === "thermal"
        ? "thermal_80mm"
        : isDot
        ? cols === 50
          ? "dot_matrix_6in"
          : cols === 120
          ? "dot_matrix_12in"
          : cols === 132
          ? "dot_matrix_15in"
          : "dot_matrix_10in"
        : "a4",
      docType: "report",
      docNumber: `REP-${report.id.toUpperCase()}-${Date.now().toString().slice(-4)}`,
      copies: 1,
      htmlContent: html,
      rawEscPosBytes,
    }).catch(() => {
      window.print();
    });
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
      {(onlineTransactionService as any).connectionState === "offline" && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-xs text-amber-800">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>
            <strong>Offline Fallback:</strong> Showing local cached report data. Cloud multi-counter figures will refresh automatically once connection is restored.
          </span>
        </div>
      )}
      {/* Top Action Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <div className="relative w-full">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={`Search in ${report.title}...`}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="w-full text-xs pl-8 pr-3 py-1.5 border border-gray-300 rounded-md bg-gray-50 focus:bg-white focus:ring-1 focus:ring-blue-500 text-gray-900 transition-colors"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Column Chooser Button */}
          <button
            type="button"
            onClick={() => setIsColumnModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 shadow-2xs transition-colors"
          >
            <Columns className="w-3.5 h-3.5 text-gray-500" />
            Columns ({visibleColumnIds.length}/{report.columns.length})
          </button>

          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={queryResult.rows.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-300 rounded-md text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 shadow-2xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export CSV
          </button>

          {/* Unified Print Button */}
          <button
            type="button"
            onClick={() => handleOpenPrintPreview()}
            title="Open Report Print Preview"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-2xs cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-blue-600" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <ReportFilterBar
        filterDefs={report.filters}
        values={filters}
        onChange={(k, v) => {
          setFilters((prev) => ({ ...prev, [k]: v }));
          setPage(1);
        }}
        onRefresh={loadData}
        isLoading={isLoading}
      />

      {/* Table Grid */}
      <ReportTableGrid
        columns={report.columns}
        rows={queryResult.rows}
        visibleColumnIds={visibleColumnIds}
        sort={sort}
        onSortChange={handleSortChange}
        summary={queryResult.summary}
        isLoading={isLoading}
        page={page}
        pageSize={pageSize}
        totalCount={queryResult.totalCount}
        onPageChange={setPage}
        onPageSizeChange={(newSize) => {
          setPageSize(newSize);
          setPage(1);
        }}
      />

      {/* Columns Modal */}
      <ReportColumnManagerModal
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        columns={report.columns}
        visibleColumnIds={visibleColumnIds}
        onChangeVisibleColumns={handleVisibleColumnsChange}
        onResetDefaults={handleResetColumns}
      />

      {/* Full-Featured Report Print Preview Modal */}
      {isPrintModalOpen && printDoc && (
        <ReportPrintPreviewModal
          isOpen={isPrintModalOpen}
          onClose={() => setIsPrintModalOpen(false)}
          report={report}
          documentData={printDoc}
          initialLayout={printLayout}
        />
      )}
    </div>
  );
};
