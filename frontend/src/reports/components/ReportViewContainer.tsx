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
import { useModalEscape } from "../../lib/ui/modalEscapeManager";

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
    "a4" | "a4-landscape" | "a4-portrait" | "thermal" | "dot-matrix" | "dot-matrix-132"
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
    const cols = printLayout === "dot-matrix-132" ? 132 : 80;
    const isLandscape = printLayout === "a4-landscape" || (printLayout === "a4" && printDoc.headers.length >= 7);

    if (isTauri()) {
      const bridge = getIpcBridge();
      bridge.invoke("print_native_job", {
        job_id: `rep_${Date.now()}`,
        paper_size: printLayout === "thermal"
          ? "thermal_80mm"
          : isDot
          ? (cols === 132 ? "dot_matrix_132col" : "dot_matrix_80col")
          : isLandscape
          ? "a4_landscape"
          : "a4",
        html_content: html,
        raw_content: isDot ? printFormatter.generateDotMatrixText(printDoc, cols) : undefined,
      }).catch(() => {
        window.print();
      });
    } else {
      const printWin = window.open("", "_blank");
      if (printWin) {
        printWin.document.write(html);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => {
          printWin.print();
          printWin.close();
        }, 250);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50 overflow-hidden">
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

          {/* Print Layout Options */}
          <div className="flex items-center rounded-md border border-gray-300 shadow-2xs bg-white p-0.5">
            <button
              type="button"
              onClick={() => handleOpenPrintPreview("a4")}
              title="Print standard A4 Report"
              className="px-2 py-1 text-xs font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors flex items-center gap-1"
            >
              <Printer className="w-3.5 h-3.5 text-gray-500" />
              A4
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={() => handleOpenPrintPreview("thermal")}
              title="Print 80mm POS Thermal Receipt"
              className="px-2 py-1 text-xs font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            >
              80mm
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={() => handleOpenPrintPreview("dot-matrix")}
              title="Print 80-Column Dot Matrix ASCII"
              className="px-2 py-1 text-xs font-medium text-gray-700 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
            >
              DotMatrix
            </button>
          </div>
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
