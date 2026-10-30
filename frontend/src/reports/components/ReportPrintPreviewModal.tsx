import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Printer,
  FileDown,
  X,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Columns,
  ChevronLeft,
  ChevronRight,
  FileText,
  Receipt,
  Maximize2,
  Minimize2,
  Sliders,
  Check,
  RotateCcw,
} from "lucide-react";
import type { ReportModule, PrintableDocumentData, ReportPrintFormattingOptions } from "../types";
import { printFormatter } from "../engine/PrintFormatter";
import {
  printerManagerService,
  getPrinterCarriageColumns,
  type SystemPrinterInfo,
  type PaperSize,
} from "../../lib/printing/printerManagerService";
import { dotMatrixRenderer } from "../../lib/printing/dotMatrixRenderer";
import { isTauri, getIpcBridge } from "../../lib/ipc/ipcBridge";
import { useModalEscape } from "../../lib/ui/modalEscapeManager";
import { companySettingsService } from "../../lib/settings/companySettingsService";
import { operatorAuthService } from "../../lib/auth/operatorAuthService";

export interface ReportPrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: ReportModule;
  documentData: PrintableDocumentData;
  initialLayout?: "a4" | "a4-landscape" | "a4-portrait" | "thermal" | "dot-matrix" | "dot-matrix-60" | "dot-matrix-120" | "dot-matrix-132";
}

export const ReportPrintPreviewModal: React.FC<ReportPrintPreviewModalProps> = ({
  isOpen,
  onClose,
  report,
  documentData,
  initialLayout = "a4",
}) => {
  const settings = companySettingsService.getSettings();
  const session = operatorAuthService.getSession();
  const operatorName = session?.user?.name || "Authorized Staff";

  // Total columns in the report
  const nCols = documentData.headers.length;
  const isWideReport = nCols >= 7;

  // Layout mode state
  const [printLayout, setPrintLayout] = useState<
    "a4-portrait" | "a4-landscape" | "thermal" | "dot-matrix" | "dot-matrix-60" | "dot-matrix-120" | "dot-matrix-132"
  >(() => {
    if (initialLayout === "a4") {
      return isWideReport ? "a4-landscape" : "a4-portrait";
    }
    return initialLayout as any;
  });

  // Combine columns state
  const [isCompactColumns, setIsCompactColumns] = useState<boolean>(() => {
    // If opening in portrait with 7+ columns, auto-compact to fit 100% cleanly
    return printLayout === "a4-portrait" && isWideReport;
  });

  // Auto-adjustment notification banner state
  const [autoNoticeDismissed, setAutoNoticeDismissed] = useState<boolean>(false);
  const showAutoNotice = useMemo(() => {
    return (
      !autoNoticeDismissed &&
      printLayout === "a4-portrait" &&
      isWideReport &&
      isCompactColumns
    );
  }, [autoNoticeDismissed, printLayout, isWideReport, isCompactColumns]);

  // Printer management state
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinterInfo[]>([]);
  const [selectedPrinterName, setSelectedPrinterName] = useState<string>("");
  const [isRefreshingPrinters, setIsRefreshingPrinters] = useState<boolean>(false);
  const [copies, setCopies] = useState<number>(1);
  const [margins, setMargins] = useState<"normal" | "compact" | "none">("normal");
  const [fontSize, setFontSize] = useState<"small" | "normal" | "large">("normal");

  // Customization toggles
  const [showHeader, setShowHeader] = useState<boolean>(true);
  const [showFooter, setShowFooter] = useState<boolean>(true);
  const [showFilterSummary, setShowFilterSummary] = useState<boolean>(true);
  const [showSettingsDrawer, setShowSettingsDrawer] = useState<boolean>(false);

  // Zoom / View scale
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [zoomScale, setZoomScale] = useState<number>(100);

  // Pagination navigation
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);

  // Printing execution state
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    type: "info" | "success" | "error";
  } | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Global modal escape interception
  useModalEscape(isOpen, onClose);

  // Load system printers on open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    printerManagerService
      .getSystemPrinters()
      .then((printers) => {
        if (!mounted) return;
        setSystemPrinters(printers);

        // Find default or laser/thermal printer based on layout
        const defaultPrinter =
          printers.find((p) => p.isDefault)?.name ||
          (printers.length > 0 ? printers[0].name : "System Default Printer");
        setSelectedPrinterName(defaultPrinter);
      })
      .catch((err) => {
        console.error("Failed to load system printers:", err);
      });

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  // Refresh system printers
  const handleRefreshPrinters = async () => {
    setIsRefreshingPrinters(true);
    try {
      const printers = await printerManagerService.getSystemPrinters(true);
      setSystemPrinters(printers);
      setStatusMessage({
        text: `Found ${printers.length} system printer(s)`,
        type: "info",
      });
    } catch {
      setStatusMessage({ text: "Failed to scan system printers", type: "error" });
    } finally {
      setIsRefreshingPrinters(false);
    }
  };

  // Selected printer object
  const selectedPrinterInfo = useMemo(() => {
    return (
      systemPrinters.find(
        (p) => p.name.toLowerCase() === selectedPrinterName.toLowerCase()
      ) || null
    );
  }, [systemPrinters, selectedPrinterName]);

  // Compute total pages based on layout and document size
  useEffect(() => {
    if (!documentData) return;
    const isDense = printLayout === "a4-portrait" && nCols >= 8;
    const isLand = printLayout === "a4-landscape";
    const p1Rows = isDense ? 26 : isLand ? 16 : 22;
    const pOtherRows = isDense ? 32 : isLand ? 22 : 28;

    if (documentData.rows.length <= p1Rows) {
      setTotalPages(1);
    } else {
      const remaining = documentData.rows.length - p1Rows;
      const additional = Math.ceil(remaining / pOtherRows);
      setTotalPages(1 + additional);
    }
  }, [documentData, printLayout, nCols]);

  // Formatting options
  const formattingOptions: ReportPrintFormattingOptions = useMemo(() => {
    const carriage = getPrinterCarriageColumns(selectedPrinterInfo);
    return {
      fontSize,
      margins,
      showHeader,
      showFooter,
      showFilterSummary,
      operatorName,
      zoomScale: typeof zoomMode === "number" ? zoomMode : zoomScale,
      printerColumns: carriage,
      autoCenter: true,
    };
  }, [fontSize, margins, showHeader, showFooter, showFilterSummary, operatorName, zoomMode, zoomScale, selectedPrinterInfo]);

  // Generated preview HTML
  const previewHtml = useMemo(() => {
    if (!isOpen || !documentData) return "";
    return printFormatter.generatePrintHtml(
      documentData,
      printLayout,
      isCompactColumns,
      formattingOptions
    );
  }, [isOpen, documentData, printLayout, isCompactColumns, formattingOptions]);

  // Write HTML into iframe and listen for ESC inside iframe
  useEffect(() => {
    if (isOpen && iframeRef.current && previewHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(previewHtml);
        doc.close();

        try {
          const win = iframeRef.current.contentWindow;
          if (win) {
            win.addEventListener(
              "keydown",
              (e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  onClose();
                } else if (e.key === "ArrowLeft") {
                  handlePrevPage();
                } else if (e.key === "ArrowRight") {
                  handleNextPage();
                } else if (e.key === "F9" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p")) {
                  e.preventDefault();
                  handleExecutePrint();
                }
              },
              true
            );
          }
        } catch {
          // Cross-origin fallback
        }
      }
    }
  }, [isOpen, previewHtml, onClose]);

  // Listen for iframe postMessage escape
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "MODAL_ESCAPE") {
        onClose();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [onClose]);

  // Page jumping inside iframe
  const scrollToPage = useCallback((pageNum: number) => {
    if (!iframeRef.current?.contentDocument) return;
    const target = iframeRef.current.contentDocument.getElementById(`page-${pageNum}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setCurrentPage(pageNum);
    }
  }, []);

  const handlePrevPage = () => {
    if (currentPage > 1) {
      scrollToPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      scrollToPage(currentPage + 1);
    }
  };

  // Keyboard Shortcuts for modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === "F9" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p")) {
        e.preventDefault();
        handleExecutePrint();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoomMode((z) => (typeof z === "number" ? Math.min(180, z + 10) : 110));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoomMode((z) => (typeof z === "number" ? Math.max(50, z - 10) : 90));
      } else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoomMode("fit");
      } else if (e.key === "ArrowLeft") {
        handlePrevPage();
      } else if (e.key === "ArrowRight") {
        handleNextPage();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen, currentPage, totalPages, onClose]);

  // Calculate container scale when in "fit" mode
  useEffect(() => {
    if (zoomMode === "fit") {
      const isLand = printLayout === "a4-landscape";
      const isThermal = printLayout === "thermal";
      const isDot = printLayout.startsWith("dot-matrix");

      if (isThermal) {
        setZoomScale(105);
      } else if (isDot) {
        setZoomScale(95);
      } else if (isLand) {
        setZoomScale(85);
      } else {
        setZoomScale(92);
      }
    } else {
      setZoomScale(zoomMode);
    }
  }, [zoomMode, printLayout]);

  // Execute Print Job Action
  const handleExecutePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    setStatusMessage({
      text: `Sending print job to ${selectedPrinterName || "System Default"}...`,
      type: "info",
    });

    try {
      const isDot = printLayout.startsWith("dot-matrix");
      const cols =
        printLayout === "dot-matrix-60"
          ? 60
          : printLayout === "dot-matrix-120"
          ? 120
          : printLayout === "dot-matrix-132"
          ? 132
          : 80;
      const activePaperSize: PaperSize =
        printLayout === "thermal"
          ? "thermal_80mm"
          : isDot
          ? cols === 60
            ? "dot_matrix_6in"
            : cols === 120
            ? "dot_matrix_120col"
            : cols === 132
            ? "dot_matrix_132col"
            : "dot_matrix_80col"
          : printLayout === "a4-landscape"
          ? "a4"
          : "a4";

      let rawEscPosBytes: Uint8Array | undefined;
      if (isDot) {
        const carriageCols = getPrinterCarriageColumns(selectedPrinterInfo);
        const text = printFormatter.generateDotMatrixText(documentData, cols, {
          printerColumns: carriageCols,
          autoCenter: true,
        });
        rawEscPosBytes = dotMatrixRenderer.generateEscPBytes(text, {
          columns: cols,
          printerCarriageColumns: carriageCols,
          autoCenterPaper: true,
          endOfJobAction: "stop_immediately",
        });
      }

      const res = await printerManagerService.executePrintJob({
        printerName: selectedPrinterName || "Default",
        paperSize: activePaperSize,
        docType: "report",
        docNumber: `REP-${report.id.toUpperCase()}-${Date.now().toString().slice(-4)}`,
        copies,
        htmlContent: previewHtml,
        rawEscPosBytes,
        skipWebviewFallback: true,
      });

      if (res.success) {
        if (res.fallbackToWebview && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.focus();
          iframeRef.current.contentWindow.print();
        }
        setStatusMessage({
          text: `✓ Report successfully printed to ${selectedPrinterName || "Printer"}`,
          type: "success",
        });
      } else {
        setStatusMessage({
          text: `✕ Print failed: ${res.error || "Could not complete print job"}`,
          type: "error",
        });
      }
    } catch (err: any) {
      console.error("Print execution failed:", err);
      setStatusMessage({
        text: `✕ Print failed: ${err?.message || "Could not complete print job"}`,
        type: "error",
      });
    } finally {
      setIsPrinting(false);
    }
  };

  // Save PDF Action
  const handleSavePdf = async () => {
    if (isSavingPdf) return;
    setIsSavingPdf(true);
    setStatusMessage({ text: "Generating high-fidelity PDF document...", type: "info" });

    try {
      const cleanTitle = report.title.replace(/[^a-zA-Z0-9_-]/g, "_");
      const defaultFileName = `${cleanTitle}_${new Date().toISOString().slice(0, 10)}.pdf`;

      if (printLayout.startsWith("dot-matrix")) {
        const cols =
          printLayout === "dot-matrix-60"
            ? 60
            : printLayout === "dot-matrix-120"
            ? 120
            : printLayout === "dot-matrix-132"
            ? 132
            : 80;
        const carriageCols = getPrinterCarriageColumns(selectedPrinterInfo);
        const text = printFormatter.generateDotMatrixText(documentData, cols, {
          printerColumns: carriageCols,
          autoCenter: true,
        });
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${cleanTitle}_dotmatrix_${cols}c.txt`;
        link.click();
        URL.revokeObjectURL(url);
        setStatusMessage({
          text: `✓ Text file exported successfully: ${cleanTitle}_dotmatrix_${cols}c.txt`,
          type: "success",
        });
        return;
      }

      if (isTauri()) {
        // Trigger native print spooler with PDF destination or Save PDF dialog
        const bridge = getIpcBridge();
        await bridge.invoke("print_native_job", {
          job_id: `rep_pdf_${Date.now()}`,
          printer_name: "Save as PDF",
          paper_size: printLayout === "a4-landscape" ? "a4" : "a4",
          html_content: previewHtml,
        });
        setStatusMessage({ text: `✓ PDF saved successfully`, type: "success" });
      } else {
        // Browser Save as PDF via print dialog
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.focus();
          iframeRef.current.contentWindow.print();
          setStatusMessage({
            text: "Select 'Save as PDF' in the destination dropdown",
            type: "info",
          });
        }
      }
    } catch (err: any) {
      console.error("Save PDF failed:", err);
      setStatusMessage({ text: `✕ PDF generation failed: ${err?.message || "Error"}`, type: "error" });
    } finally {
      setIsSavingPdf(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-print-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-2xs p-2 sm:p-4 animate-in fade-in duration-150"
    >
      <div
        ref={containerRef}
        className="bg-white rounded-xl shadow-2xl max-w-[98vw] 2xl:max-w-7xl w-full h-[94vh] border border-gray-200 overflow-hidden flex flex-col focus:outline-none"
      >
        {/* Modal Top Header */}
        <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between bg-gray-50/90 gap-2 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
              <Printer className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3
                id="report-print-modal-title"
                className="font-bold text-gray-900 text-sm truncate flex items-center gap-2"
              >
                <span>Print Preview: {report.title}</span>
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-200/70 px-2 py-0.5 rounded-full">
                  {nCols} Columns • {documentData.rows.length} {documentData.rows.length === 1 ? "Row" : "Rows"}
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Paper Size / Layout Tabs */}
            <div className="flex items-center bg-gray-200/80 rounded-lg p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setPrintLayout("a4-portrait")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  printLayout === "a4-portrait"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="A4 Portrait (210 x 297 mm)"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>A4 Portrait</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout("a4-landscape")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  printLayout === "a4-landscape"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="A4 Landscape (297 x 210 mm) - Recommended for wide registers"
              >
                <FileText className="w-3.5 h-3.5 rotate-90" />
                <span>A4 Landscape</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout("thermal")}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition-all ${
                  printLayout === "thermal"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="POS Thermal 80mm Roll"
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>Thermal 80mm</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout("dot-matrix-60")}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${
                  printLayout === "dot-matrix-60"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="Dot Matrix 60-Column (6-inch Narrow)"
              >
                <span>60C (6")</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout("dot-matrix")}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${
                  printLayout === "dot-matrix"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="Dot Matrix 80-Column (10-inch Standard)"
              >
                <span>80C (10")</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout("dot-matrix-120")}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${
                  printLayout === "dot-matrix-120"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="Dot Matrix 120-Column (12-inch Form)"
              >
                <span>120C (12")</span>
              </button>
              <button
                type="button"
                onClick={() => setPrintLayout("dot-matrix-132")}
                className={`flex items-center gap-1 px-2 py-1 rounded-md transition-all ${
                  printLayout === "dot-matrix-132"
                    ? "bg-white text-blue-600 shadow-xs font-semibold"
                    : "text-gray-600 hover:text-gray-900"
                }`}
                title="Dot Matrix 132-Column (15-inch Wide)"
              >
                <span>132C (15")</span>
              </button>
            </div>

            {/* Combine Columns Toggle Button */}
            {printLayout.startsWith("a4") && isWideReport && (
              <button
                type="button"
                onClick={() => setIsCompactColumns(!isCompactColumns)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all ${
                  isCompactColumns
                    ? "bg-blue-600 text-white border-blue-600 shadow-xs"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
                }`}
                title="Combines Voucher+Date, Supplier+Bill+Items, Tax Split, and Total+Status into 5 spacious columns to save portrait space"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>{isCompactColumns ? "Combined (5 Col)" : "Combine Columns"}</span>
              </button>
            )}

            {/* Print Settings Drawer Toggle */}
            <button
              type="button"
              onClick={() => setShowSettingsDrawer(!showSettingsDrawer)}
              className={`p-1.5 rounded-lg border text-gray-600 transition-colors ${
                showSettingsDrawer
                  ? "bg-blue-50 border-blue-300 text-blue-600 font-semibold"
                  : "bg-white border-gray-300 hover:bg-gray-100"
              }`}
              title="Print Preferences & Layout Settings"
            >
              <Sliders className="w-4 h-4" />
            </button>

            {/* Large Accessible Close Button */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Preview (Esc)"
              title="Close Preview (Esc)"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200/80 transition-colors font-bold text-base"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-Header Toolbar: Printer Picker, Zoom, Page Stepper */}
        <div className="px-4 py-2 bg-white border-b border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          {/* Printer Picker */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-700 flex items-center gap-1">
              <Printer className="w-3.5 h-3.5 text-gray-500" />
              Printer:
            </span>
            <div className="relative flex items-center">
              <select
                value={selectedPrinterName}
                onChange={(e) => setSelectedPrinterName(e.target.value)}
                className="pl-6 pr-8 py-1 border border-gray-300 rounded-md bg-gray-50 font-medium text-gray-800 text-xs focus:ring-1 focus:ring-blue-500 focus:bg-white"
              >
                {systemPrinters.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.displayName || p.name} {p.isDefault ? "(Default)" : ""}
                  </option>
                ))}
                {systemPrinters.length === 0 && (
                  <option value="System Default Printer">System Default Printer</option>
                )}
                <option value="Save as PDF">Save as PDF</option>
              </select>
              {/* Printer Status Dot */}
              <span
                className={`w-2 h-2 rounded-full absolute left-2 pointer-events-none ${
                  selectedPrinterInfo?.status === "offline"
                    ? "bg-red-500"
                    : selectedPrinterInfo?.isDefault
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
                title={`Status: ${selectedPrinterInfo?.status || "Ready"}`}
              />
            </div>

            <button
              type="button"
              onClick={handleRefreshPrinters}
              disabled={isRefreshingPrinters}
              className="p-1 text-gray-500 hover:text-gray-800 rounded hover:bg-gray-100 transition-colors"
              title="Rescan connected printers"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingPrinters ? "animate-spin" : ""}`} />
            </button>

            {/* Copies Stepper */}
            <div className="flex items-center border border-gray-300 rounded-md bg-gray-50 ml-2">
              <span className="px-2 text-gray-600 font-medium">Copies:</span>
              <button
                type="button"
                onClick={() => setCopies((c) => Math.max(1, c - 1))}
                className="px-2 py-0.5 hover:bg-gray-200 text-gray-700 font-bold"
              >
                -
              </button>
              <span className="px-2 font-semibold text-gray-900">{copies}</span>
              <button
                type="button"
                onClick={() => setCopies((c) => c + 1)}
                className="px-2 py-0.5 hover:bg-gray-200 text-gray-700 font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* Center: Zoom / Scale Controls */}
          <div className="flex items-center gap-1.5 bg-gray-100 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => setZoomMode((z) => (typeof z === "number" ? Math.max(50, z - 10) : 85))}
              className="p-1 text-gray-600 hover:text-gray-900 hover:bg-white rounded transition-colors"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                zoomMode === "fit" ? "bg-white text-blue-600 shadow-xs" : "text-gray-700 hover:bg-white"
              }`}
              title="Fit entire page to viewport (Ctrl+0)"
            >
              Fit to Page
            </button>
            <button
              type="button"
              onClick={() => setZoomMode(100)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                zoomMode === 100 ? "bg-white text-blue-600 shadow-xs" : "text-gray-700 hover:bg-white"
              }`}
            >
              100%
            </button>
            <button
              type="button"
              onClick={() => setZoomMode((z) => (typeof z === "number" ? Math.min(180, z + 10) : 115))}
              className="p-1 text-gray-600 hover:text-gray-900 hover:bg-white rounded transition-colors"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="text-gray-500 text-[10px] pl-1 pr-1.5 font-mono">{zoomScale}%</span>
          </div>

          {/* Right: Multi-Page Stepper */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className="p-1 text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed rounded hover:bg-gray-100"
              title="Previous Page (Left Arrow)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-medium text-gray-700 px-1">
              Page <strong className="text-gray-900">{currentPage}</strong> of{" "}
              <strong>{totalPages}</strong>
            </span>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage >= totalPages}
              className="p-1 text-gray-600 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed rounded hover:bg-gray-100"
              title="Next Page (Right Arrow)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Informative Auto-Adjustment Notice Banner */}
        {showAutoNotice && (
          <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <span className="font-bold text-blue-700">Notice:</span>
              <span>
                Report has {nCols} columns. Auto-combined into 5 spacious columns to prevent
                overflow on A4 Portrait.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPrintLayout("a4-landscape")}
                className="text-xs font-semibold underline text-blue-700 hover:text-blue-900"
              >
                Switch to A4 Landscape
              </button>
              <span className="text-blue-300">•</span>
              <button
                type="button"
                onClick={() => setIsCompactColumns(false)}
                className="text-xs font-semibold underline text-blue-700 hover:text-blue-900"
              >
                Expand all {nCols} columns
              </button>
              <button
                type="button"
                onClick={() => setAutoNoticeDismissed(true)}
                className="ml-3 text-blue-400 hover:text-blue-700 font-bold"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Collapsible Print Preferences Drawer */}
        {showSettingsDrawer && (
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs animate-in slide-in-from-top-2 duration-150">
            <div className="flex flex-wrap items-center gap-4">
              {/* Margins */}
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-gray-700">Margins:</span>
                <select
                  value={margins}
                  onChange={(e) => setMargins(e.target.value as any)}
                  className="px-2 py-1 border border-gray-300 rounded bg-white text-xs font-medium"
                >
                  <option value="normal">Normal (12mm)</option>
                  <option value="compact">Compact (6mm)</option>
                  <option value="none">Minimal (4mm)</option>
                </select>
              </div>

              {/* Font Size */}
              <div className="flex items-center gap-1.5">
                <span className="font-medium text-gray-700">Font Size:</span>
                <select
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value as any)}
                  className="px-2 py-1 border border-gray-300 rounded bg-white text-xs font-medium"
                >
                  <option value="small">Small (8pt - High Density)</option>
                  <option value="normal">Normal (9.5pt)</option>
                  <option value="large">Large (11pt)</option>
                </select>
              </div>

              {/* Header / Footer Checkboxes */}
              <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={showHeader}
                  onChange={(e) => setShowHeader(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Store Header
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={showFilterSummary}
                  onChange={(e) => setShowFilterSummary(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Filter Box
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={showFooter}
                  onChange={(e) => setShowFooter(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Audit Footer
              </label>
            </div>

            <button
              type="button"
              onClick={() => setShowSettingsDrawer(false)}
              className="text-gray-500 hover:text-gray-800 text-xs font-semibold"
            >
              Done
            </button>
          </div>
        )}

        {/* Central Printable Area Viewport */}
        <div className="flex-1 overflow-auto bg-slate-300/70 p-0 flex justify-center items-start relative select-none">
          <div
            style={{
              transform: `scale(${zoomScale / 100})`,
              transformOrigin: "top center",
              transition: "transform 120ms ease-out",
              width: "100%",
              height: "100%",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <iframe
              ref={iframeRef}
              title="Report Print Preview"
              srcDoc={previewHtml}
              className="w-full h-full border-0 bg-transparent"
            />
          </div>
        </div>

        {/* Bottom Action Footer with Status & Parity Buttons */}
        <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50/95 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          {/* Printer Status Message */}
          <div className="flex items-center gap-2 min-w-0">
            {statusMessage ? (
              <span
                className={`font-medium flex items-center gap-1.5 truncate ${
                  statusMessage.type === "success"
                    ? "text-emerald-700 font-semibold"
                    : statusMessage.type === "error"
                    ? "text-rose-700 font-semibold"
                    : "text-blue-700"
                }`}
              >
                {statusMessage.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : statusMessage.type === "error" ? (
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                )}
                <span className="truncate">{statusMessage.text}</span>
              </span>
            ) : (
              <span className="text-gray-600 flex items-center gap-1.5 truncate">
                <span
                  className={`w-2 h-2 rounded-full ${
                    selectedPrinterInfo?.status === "offline" ? "bg-red-500" : "bg-emerald-500"
                  }`}
                />
                <span className="font-semibold text-gray-800">
                  {selectedPrinterInfo?.displayName || selectedPrinterName || "System Default"}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-500">
                  {selectedPrinterInfo?.status === "offline"
                    ? "Offline"
                    : selectedPrinterInfo?.isDefault
                    ? "Default Printer"
                    : "Ready"}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-gray-500 font-mono text-[11px]">
                  {printLayout.toUpperCase()} • {copies} {copies === 1 ? "Copy" : "Copies"}
                </span>
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Cancel (Esc)
            </button>

            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isSavingPdf || isPrinting}
              className="px-3.5 py-1.5 border border-gray-300 rounded-md text-xs font-semibold text-gray-800 bg-white hover:bg-gray-50 shadow-2xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
              title="Save pixel-identical PDF document"
            >
              <FileDown className="w-3.5 h-3.5 text-blue-600" />
              <span>{isSavingPdf ? "Saving PDF..." : "Save PDF"}</span>
            </button>

            <button
              type="button"
              onClick={handleExecutePrint}
              disabled={isPrinting || isSavingPdf}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold shadow-xs flex items-center gap-2 transition-all disabled:opacity-50"
              title="Send to physical printer (F9)"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>{isPrinting ? "Printing..." : "Print"}</span>
              <kbd className="px-1.5 py-0.2 bg-blue-700 text-[10px] rounded font-mono text-blue-100 border border-blue-500">
                F9
              </kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
