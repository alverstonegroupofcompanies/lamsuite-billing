import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Printer,
  FileDown,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Settings2,
  Copy,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Smartphone,
  Mail,
  FileText,
  Sliders,
  Check,
  Tag,
  Zap,
} from "lucide-react";
import {
  printingEngine,
  PrintRenderOptions,
  InvoicePrintData,
  CreditNotePrintData,
  DebitNotePrintData,
  generateWhatsAppShareUrl,
  generateEmailShareUrl,
} from "../lib/printing/printingEngine";
import {
  printerManagerService,
  SystemPrinterInfo,
  PrinterProfileConfig,
  PaperSize,
  PrintJobRecord,
} from "../lib/printing/printerManagerService";
import { isTauri } from "../lib/ipc/ipcBridge";
import { dotMatrixRenderer, DotMatrixOptions } from "../lib/printing/dotMatrixRenderer";
import { companySettingsService } from "../lib/settings/companySettingsService";

export interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  docType?:
    | "tax_invoice"
    | "invoice"
    | "bill"
    | "sales_return"
    | "credit_note"
    | "customer_debit_note"
    | "purchase_return"
    | "debit_note"
    | "purchase"
    | "purchase_bill"
    | "barcode"
    | "report";
  title?: string;
  data: any;
  initialFormat?: "a4" | "a5" | "half_a4" | "thermal_80mm" | "thermal_58mm" | "dot_matrix_80col" | "barcode_label";
  onAfterPrint?: (result: { success: boolean; mode: string }) => void;
  customerPhone?: string;
  customerEmail?: string;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  isOpen,
  onClose,
  docType = "tax_invoice",
  title = "Print Preview",
  data,
  initialFormat,
  onAfterPrint,
  customerPhone,
  customerEmail,
}) => {
  const settings = companySettingsService.getSettings();

  // Tab State
  const [activeTab, setActiveTab] = useState<"device" | "layout" | "share">("device");

  // Printer Management State
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinterInfo[]>([]);
  const [selectedPrinterName, setSelectedPrinterName] = useState<string>("");
  const [isRefreshingPrinters, setIsRefreshingPrinters] = useState<boolean>(false);
  const [printerProfile, setPrinterProfile] = useState<PrinterProfileConfig | null>(null);
  const [isTestingPrinter, setIsTestingPrinter] = useState<boolean>(false);
  const [lastPrintJob, setLastPrintJob] = useState<PrintJobRecord | null>(null);

  // Print Format & Layout State
  const [paperSize, setPaperSize] = useState<PaperSize>(initialFormat || (settings.printing.paperSize as PaperSize) || "a4");
  const [copies, setCopies] = useState<number>(settings.printing.copies || 1);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [copyMarker, setCopyMarker] = useState<string>(settings.printing.defaultCopyMarker || "Original for Recipient");
  const [currencySymbolFormat, setCurrencySymbolFormat] = useState<"rupee_symbol" | "rs_text">("rupee_symbol");
  const [isDuplicate, setIsDuplicate] = useState<boolean>(false);
  const [silentPrint, setSilentPrint] = useState<boolean>(false);
  const [useSystemDialog, setUseSystemDialog] = useState<boolean>(false);

  // Customization Toggles
  const [showHsnSummary, setShowHsnSummary] = useState<boolean>(settings.printing.printHsnSummary ?? true);
  const [showUpiQr, setShowUpiQr] = useState<boolean>(settings.printing.printUpiQrCode ?? true);
  const [showDoctorPatient, setShowDoctorPatient] = useState<boolean>(settings.printing.printDoctorDetails ?? true);
  const [showDrugLicenses, setShowDrugLicenses] = useState<boolean>(settings.printing.printDrugLicenses ?? true);
  const [showTerms, setShowTerms] = useState<boolean>(true);

  // Dot Matrix View Toggles
  const [showRuler, setShowRuler] = useState<boolean>(true);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(true);
  const [showPageBreaks, setShowPageBreaks] = useState<boolean>(true);

  // Zoom & Action State
  const [zoomScale, setZoomScale] = useState<number>(100);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "info" | "success" | "error" } | null>(null);
  const [savedFilePath, setSavedFilePath] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const printerSelectRef = useRef<HTMLSelectElement | null>(null);

  // Load Printers & Last Used Mapping on Open
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;

    const loadPrintersAndHistory = async () => {
      try {
        const printers = await printerManagerService.getSystemPrinters();
        if (!mounted) return;
        setSystemPrinters(printers);

        // Determine effective paper format
        const effectivePaper: PaperSize = initialFormat || (settings.printing.paperSize as PaperSize) || "a4";
        setPaperSize(effectivePaper);

        // Resolve last-used or default printer
        const defaultOrLastPrinter = await printerManagerService.getLastUsedPrinter(docType, effectivePaper);
        if (mounted) {
          setSelectedPrinterName(defaultOrLastPrinter);
          const prof = await printerManagerService.getProfileForPrinter(defaultOrLastPrinter);
          setPrinterProfile(prof);
          setSilentPrint(prof.silentPrint);
          setCurrencySymbolFormat(prof.currencySymbolFormat);
        }

        // Fetch last printed record for duplicate badge & audit info
        const docNo = data?.invoice_number || data?.return_number || data?.purchase_number;
        if (docNo) {
          const lastJob = await printerManagerService.getLastPrintJobForDocument(docNo);
          if (mounted && lastJob) {
            setLastPrintJob(lastJob);
            setIsDuplicate(true);
            setCopyMarker("DUPLICATE");
          }
        }
      } catch (err) {
        console.error("Error loading printer configurations:", err);
      }
    };

    loadPrintersAndHistory();
    setStatusMessage(null);
    setSavedFilePath(null);
    setZoomScale(paperSize.startsWith("thermal") ? 110 : 95);

    return () => {
      mounted = false;
    };
  }, [isOpen, initialFormat, docType, data]);

  // Refresh Printers Action
  const handleRefreshPrinters = async () => {
    setIsRefreshingPrinters(true);
    try {
      const printers = await printerManagerService.getSystemPrinters(true);
      setSystemPrinters(printers);
      setStatusMessage({ text: `Found ${printers.length} system printer(s)`, type: "info" });
    } catch (err: any) {
      setStatusMessage({ text: "Failed to scan system printers", type: "error" });
    } finally {
      setIsRefreshingPrinters(false);
    }
  };

  // Switch Selected Printer
  const handleSelectPrinter = async (printerName: string) => {
    setSelectedPrinterName(printerName);
    const prof = await printerManagerService.getProfileForPrinter(printerName);
    setPrinterProfile(prof);
    setSilentPrint(prof.silentPrint);
    setCurrencySymbolFormat(prof.currencySymbolFormat);
    await printerManagerService.setLastUsedPrinter(docType, paperSize, printerName);
  };

  // Selected Printer Info
  const selectedPrinterInfo = useMemo(() => {
    return systemPrinters.find((p) => p.name.toLowerCase() === selectedPrinterName.toLowerCase()) || null;
  }, [systemPrinters, selectedPrinterName]);

  // Paper Compatibility Verification
  const paperCompatibility = useMemo(() => {
    if (!selectedPrinterInfo) return { compatible: true };
    return printerManagerService.validatePaperCompatibility(selectedPrinterInfo, paperSize);
  }, [selectedPrinterInfo, paperSize]);

  // Build Rendered HTML
  const renderedHtml = useMemo(() => {
    if (!isOpen || !data) return "";
    const isDot = paperSize === "dot_matrix_80col" || paperSize === "dot_matrix_132col";
    if (isDot) {
      const dotOpts: DotMatrixOptions = {
        columns: paperSize === "dot_matrix_132col" ? 132 : 80,
        linesPerPage: printerProfile?.linesPerPage || 66,
        isDuplicate,
        copyMarker: copyMarker === "None" ? undefined : copyMarker,
        showHsnSummary,
        showDoctorPatient,
        showDrugLicenses,
        showTerms,
        currencyPrefix: "Rs.",
      };
      let rawText = "";
      switch (docType) {
        case "sales_return":
        case "credit_note":
        case "customer_debit_note":
          rawText = dotMatrixRenderer.renderCreditNote(data as CreditNotePrintData, dotOpts);
          break;
        case "purchase_return":
        case "debit_note":
          rawText = dotMatrixRenderer.renderDebitNote(data as DebitNotePrintData, dotOpts);
          break;
        default:
          rawText = dotMatrixRenderer.renderInvoice(data as InvoicePrintData, dotOpts);
          break;
      }
      return dotMatrixRenderer.generateMonospaceHtmlPreview(rawText, {
        columns: paperSize === "dot_matrix_132col" ? 132 : 80,
        showRuler,
        showLineNumbers,
        showPageBreaks,
      });
    }

    const options: PrintRenderOptions = {
      paperSize,
      copies,
      orientation,
      showHsnSummary,
      showUpiQr,
      showDoctorPatient,
      showDrugLicenses,
      showTerms,
      copyMarker: copyMarker === "None" ? undefined : copyMarker,
      currencySymbolFormat: "rupee_symbol",
      isDuplicate,
      printerName: selectedPrinterName,
    };
    return printingEngine.renderDocumentHtml(docType, data, options);
  }, [
    isOpen,
    docType,
    data,
    paperSize,
    copies,
    orientation,
    showHsnSummary,
    showUpiQr,
    showDoctorPatient,
    showDrugLicenses,
    showTerms,
    copyMarker,
    currencySymbolFormat,
    isDuplicate,
    selectedPrinterName,
    printerProfile,
    showRuler,
    showLineNumbers,
    showPageBreaks,
  ]);

  // Write HTML into preview iframe
  useEffect(() => {
    if (isOpen && iframeRef.current && renderedHtml) {
      const doc = iframeRef.current.contentDocument;
      if (doc) {
        doc.open();
        doc.write(renderedHtml);
        doc.close();
      }
    }
  }, [isOpen, renderedHtml]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "F9" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p")) {
        e.preventDefault();
        handleExecutePrint();
      } else if (e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        printerSelectRef.current?.focus();
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoomScale((z) => Math.min(200, z + 10));
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoomScale((z) => Math.max(50, z - 10));
      } else if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setZoomScale(100);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, renderedHtml, paperSize, copies, selectedPrinterName, useSystemDialog, isDuplicate]);

  // Execute Print Job Action
  const handleExecutePrint = async () => {
    if (isPrinting) return;

    if (selectedPrinterName === "Save as PDF" || selectedPrinterName === "Microsoft Print to PDF") {
      await handleSavePdf();
      return;
    }

    if (useSystemDialog && iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
      setStatusMessage({ text: "Sent to OS system print dialog", type: "success" });
      onAfterPrint?.({ success: true, mode: "system_dialog" });
      return;
    }

    if (!isTauri() && !selectedPrinterName.toLowerCase().includes("pdf") && !selectedPrinterName.includes("Save as PDF")) {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
        setStatusMessage({ text: "Sent to browser print dialog", type: "success" });
        onAfterPrint?.({ success: true, mode: paperSize });
        return;
      }
    }

    setIsPrinting(true);
    setStatusMessage({ text: `Sending job to ${selectedPrinterName}...`, type: "info" });

    try {
      const docNo = data.invoice_number || data.return_number || data.purchase_number || "DOC";
      const isThermal = paperSize.startsWith("thermal");
      const isDot = paperSize === "dot_matrix_80col" || paperSize === "dot_matrix_132col";

      let rawEscPosBytes: Uint8Array | undefined;
      let pdfBytes: Uint8Array | undefined;

      if (isThermal) {
        rawEscPosBytes = printingEngine.generateEscPosReceiptBytes(data as InvoicePrintData, {
          paperWidthMm: paperSize === "thermal_58mm" ? 58 : 80,
          autoCut: printerProfile?.enableAutoCut ?? true,
          cashDrawer: printerProfile?.enableCashDrawerKick ?? true,
        });
      } else if (isDot) {
        const dotOpts: DotMatrixOptions = {
          columns: paperSize === "dot_matrix_132col" ? 132 : 80,
          linesPerPage: printerProfile?.linesPerPage || 66,
          cpi: printerProfile?.dotMatrixPitch || "10cpi",
          doubleStrikeCarbon: printerProfile?.doubleStrikeCarbon || false,
          prePrintedStationery: printerProfile?.prePrintedStationery || false,
          leftMarginSpaces: printerProfile?.leftMarginSpaces || 0,
          topMarginLines: printerProfile?.topMarginLines || 0,
          showHsnSummary,
          showDoctorPatient,
          showDrugLicenses,
          showTerms,
          isDuplicate,
          copyMarker: copyMarker === "None" ? undefined : copyMarker,
        };

        let rawText = "";
        switch (docType) {
          case "sales_return":
          case "credit_note":
          case "customer_debit_note":
            rawText = dotMatrixRenderer.renderCreditNote(data as CreditNotePrintData, dotOpts);
            break;
          case "purchase_return":
          case "debit_note":
            rawText = dotMatrixRenderer.renderDebitNote(data as DebitNotePrintData, dotOpts);
            break;
          default:
            rawText = dotMatrixRenderer.renderInvoice(data as InvoicePrintData, dotOpts);
            break;
        }
        rawEscPosBytes = dotMatrixRenderer.generateEscPBytes(rawText, dotOpts);
      } else {
        pdfBytes = printingEngine.renderDocumentPdf(docType, data, {
          paperSize,
          copies,
          orientation,
          isDuplicate,
        });
      }

      const res = await printerManagerService.executePrintJob({
        printerName: selectedPrinterName,
        paperSize,
        docType,
        docNumber: docNo,
        copies,
        isDuplicate,
        htmlContent: renderedHtml,
        pdfBytes,
        rawEscPosBytes,
        useSystemDialog,
      });

      if (res.success) {
        setStatusMessage({ text: `Print job queued to ${selectedPrinterName}!`, type: "success" });
        onAfterPrint?.({ success: true, mode: paperSize });
        setTimeout(() => onClose(), 1200);
      } else {
        setStatusMessage({ text: `Print failed: ${res.error || "Printer rejected job"}`, type: "error" });
      }
    } catch (err: any) {
      console.error("Print execution error:", err);
      setStatusMessage({ text: `Print error: ${err?.message || "Communication failed"}`, type: "error" });
    } finally {
      setIsPrinting(false);
    }
  };

  // Test Print Action
  const handleTestPrint = async () => {
    if (isTestingPrinter || !selectedPrinterName) return;
    setIsTestingPrinter(true);
    setStatusMessage({ text: `Sending test slip to ${selectedPrinterName}...`, type: "info" });

    try {
      const testData: InvoicePrintData = {
        invoice_number: "TEST-PAGE-01",
        invoice_date: new Date().toISOString().split("T")[0],
        invoice_time: new Date().toLocaleTimeString(),
        store_name: settings.store_name || "LamStone Pharmacy",
        store_address: settings.address || "Main Street Branch",
        store_phone: settings.phone || "9876543210",
        store_gstin: settings.gstin || "32AAAAA0000A1Z5",
        lines: [
          { description: "Printer Calibration Test Item", qty: 1, rate: 100, gst_percent: 18, amount: 118 },
        ],
        subtotal: 100,
        tax_total: 18,
        round_off: 0,
        grand_total: 118,
      };

      const isDot = paperSize === "dot_matrix_80col" || paperSize === "dot_matrix_132col";
      let rawBytes: Uint8Array | undefined;
      if (isDot) {
        const text = dotMatrixRenderer.renderInvoice(testData, {
          columns: paperSize === "dot_matrix_132col" ? 132 : 80,
          linesPerPage: 66,
        });
        rawBytes = dotMatrixRenderer.generateEscPBytes(text);
      }

      const res = await printerManagerService.executePrintJob({
        printerName: selectedPrinterName,
        paperSize,
        docType: "test_print",
        docNumber: "TEST-01",
        copies: 1,
        htmlContent: printingEngine.generateInvoiceHtml(testData, { paperSize }),
        rawEscPosBytes: rawBytes,
      });

      if (res.success) {
        setStatusMessage({ text: `Test print sent successfully to ${selectedPrinterName}!`, type: "success" });
      } else {
        setStatusMessage({ text: `Test print error: ${res.error}`, type: "error" });
      }
    } catch (err: any) {
      setStatusMessage({ text: `Test print failed: ${err.message}`, type: "error" });
    } finally {
      setIsTestingPrinter(false);
    }
  };

  // Save as High-Fidelity Vector / Monospace PDF Action
  const handleSavePdf = async () => {
    if (isSavingPdf) return;
    setIsSavingPdf(true);
    setStatusMessage({ text: "Generating PDF...", type: "info" });

    try {
      const invNo = data.invoice_number || data.return_number || data.purchase_number || "Document";
      const fileName = `${invNo.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;
      const isDot = paperSize === "dot_matrix_80col" || paperSize === "dot_matrix_132col";

      if (isDot) {
        const dotOpts: DotMatrixOptions = {
          columns: paperSize === "dot_matrix_132col" ? 132 : 80,
          linesPerPage: printerProfile?.linesPerPage || 66,
          isDuplicate,
          copyMarker: copyMarker === "None" ? undefined : copyMarker,
          showHsnSummary,
          showDoctorPatient,
          showDrugLicenses,
          showTerms,
        };
        let rawText = "";
        switch (docType) {
          case "sales_return":
          case "credit_note":
          case "customer_debit_note":
            rawText = dotMatrixRenderer.renderCreditNote(data as CreditNotePrintData, dotOpts);
            break;
          case "purchase_return":
          case "debit_note":
            rawText = dotMatrixRenderer.renderDebitNote(data as DebitNotePrintData, dotOpts);
            break;
          default:
            rawText = dotMatrixRenderer.renderInvoice(data as InvoicePrintData, dotOpts);
            break;
        }
        const pdfBytes = dotMatrixRenderer.generateMonospacePdf(rawText, dotOpts);
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        setSavedFilePath(fileName);
        setStatusMessage({ text: `Monospace PDF saved successfully: ${fileName}`, type: "success" });
        return;
      }

      if (docType === "sales_return" || docType === "credit_note") {
        const pdfBytes = printingEngine.generateCreditNotePdf(data as CreditNotePrintData);
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        setSavedFilePath(fileName);
        setStatusMessage({ text: `PDF saved successfully: ${fileName}`, type: "success" });
      } else if (docType === "purchase_return" || docType === "debit_note") {
        const pdfBytes = printingEngine.generateDebitNotePdf(data as DebitNotePrintData);
        const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(url);
        setSavedFilePath(fileName);
        setStatusMessage({ text: `PDF saved successfully: ${fileName}`, type: "success" });
      } else {
        const res = await printingEngine.exportToPdf(data as InvoicePrintData);
        if (res.success && res.file_path) {
          setSavedFilePath(res.file_path);
          setStatusMessage({ text: `PDF saved to ${res.file_path}`, type: "success" });
        } else if (res.cancelled) {
          setStatusMessage(null);
        } else {
          setStatusMessage({ text: res.error || "Failed to save PDF", type: "error" });
        }
      }
    } catch (err: any) {
      console.error("Save PDF error:", err);
      setStatusMessage({ text: `PDF export error: ${err?.message || "Error"}`, type: "error" });
    } finally {
      setIsSavingPdf(false);
    }
  };

  // Set Current Printer as Default for Paper Size
  const handleSetAsDefault = async () => {
    if (!selectedPrinterName) return;
    await printerManagerService.setDefaultPrinterForPaperSize(paperSize, selectedPrinterName);
    setStatusMessage({ text: `'${selectedPrinterName}' set as default for ${paperSize.toUpperCase()}`, type: "success" });
  };

  if (!isOpen) return null;

  const isThermal = paperSize.startsWith("thermal");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="flex flex-col h-[95vh] w-full max-w-7xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
        
        {/* Top Header Bar */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-900 text-white border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold tracking-tight">{title}</h2>
                <span className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-400/30 rounded">
                  {paperSize.replace("_", " ")}
                </span>
                {isDuplicate && (
                  <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-400/30 rounded flex items-center gap-1">
                    <Tag className="w-3 h-3" /> Duplicate
                  </span>
                )}
                {lastPrintJob && (
                  <span className="text-xs text-slate-400 font-mono hidden md:inline">
                    (Printed: {new Date(lastPrintJob.timestamp).toLocaleTimeString()})
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Exact print & PDF match • True 100% scale • Real-time OS spooler status
              </p>
            </div>
          </div>

          {/* Zoom and Quick Nav Controls */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
              <button
                type="button"
                onClick={() => setZoomScale((z) => Math.max(50, z - 10))}
                className="p-1.5 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition"
                title="Zoom Out (-)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="px-2.5 text-xs font-semibold text-slate-200 font-mono select-none">
                {zoomScale}%
              </span>
              <button
                type="button"
                onClick={() => setZoomScale((z) => Math.min(200, z + 10))}
                className="p-1.5 hover:bg-slate-700 text-slate-300 hover:text-white rounded transition"
                title="Zoom In (+)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoomScale(100)}
                className="px-2 py-1 text-xs hover:bg-slate-700 text-slate-300 hover:text-white rounded transition border-l border-slate-700 ml-1"
                title="Reset Zoom (Ctrl+0)"
              >
                100%
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-lg transition"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Center Area: Canvas on Left + Side Panel on Right */}
        <div className="flex flex-1 overflow-hidden bg-slate-100 dark:bg-slate-950">
          
          {/* Document Canvas Preview Container */}
          <div className="flex-1 flex justify-center items-start p-6 overflow-y-auto overflow-x-auto relative select-none bg-slate-100 dark:bg-slate-950">
            <div
              className="transition-transform duration-100 shadow-2xl rounded-sm bg-white overflow-hidden shrink-0 my-4"
              style={{
                transform: `scale(${zoomScale / 100})`,
                transformOrigin: "top center",
                width: isThermal
                  ? paperSize === "thermal_58mm"
                    ? "60mm"
                    : "82mm"
                  : paperSize === "a5"
                  ? "150mm"
                  : paperSize === "dot_matrix_132col"
                  ? "320mm"
                  : paperSize === "dot_matrix_80col"
                  ? "220mm"
                  : "215mm",
                minHeight: isThermal ? "120mm" : paperSize === "a5" ? "210mm" : "297mm",
              }}
            >
              <iframe
                ref={iframeRef}
                title="Print Preview Frame"
                className="w-full border-0 pointer-events-auto bg-white"
                style={{
                  height: isThermal
                    ? "750px"
                    : paperSize === "a5"
                    ? "820px"
                    : paperSize.startsWith("dot_matrix")
                    ? "950px"
                    : "1122px",
                }}
                sandbox="allow-same-origin allow-scripts allow-modals"
              />
            </div>
          </div>

          {/* Right Control Sidebar */}
          <div className="w-96 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between overflow-hidden">
            
            {/* Sidebar Tab Selector */}
            <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={() => setActiveTab("device")}
                className={`flex-1 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition ${
                  activeTab === "device"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <Printer className="w-3.5 h-3.5" /> Printer & Profile
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("layout")}
                className={`flex-1 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition ${
                  activeTab === "layout"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <Sliders className="w-3.5 h-3.5" /> Layout & GST
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("share")}
                className={`flex-1 py-3 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition ${
                  activeTab === "share"
                    ? "border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                }`}
              >
                <Share2 className="w-3.5 h-3.5" /> Share & PDF
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 p-5 overflow-y-auto space-y-5">
              
              {activeTab === "device" && (
                <div className="space-y-4">
                  {/* Printer Selection Header */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                        Target Printer <span className="text-slate-400 font-normal">(Alt+P)</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleRefreshPrinters}
                        disabled={isRefreshingPrinters}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        title="Scan OS for new printers"
                      >
                        <RefreshCw className={`w-3 h-3 ${isRefreshingPrinters ? "animate-spin" : ""}`} /> Refresh
                      </button>
                    </div>

                    <select
                      ref={printerSelectRef}
                      value={selectedPrinterName}
                      onChange={(e) => handleSelectPrinter(e.target.value)}
                      className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    >
                      {systemPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.isDefault ? "★ " : ""}{p.displayName} {p.status === "offline" ? "[OFFLINE]" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Printer Status Card */}
                  {selectedPrinterInfo && (
                    <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 dark:text-slate-400">Device Status:</span>
                        <span
                          className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                            selectedPrinterInfo.status === "ready"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400"
                          }`}
                        >
                          {selectedPrinterInfo.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                        <span>Driver:</span>
                        <span className="font-mono text-[11px] truncate max-w-[180px]">{selectedPrinterInfo.driverName || "Standard Spooler"}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                        <span>Port:</span>
                        <span className="font-mono text-[11px]">{selectedPrinterInfo.portName || "USB"}</span>
                      </div>
                    </div>
                  )}

                  {/* Incompatibility Warning */}
                  {!paperCompatibility.compatible && (
                    <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="space-y-1.5">
                        <div className="font-semibold">{paperCompatibility.warning}</div>
                        {paperCompatibility.suggestedPaper && (
                          <button
                            type="button"
                            onClick={() => setPaperSize(paperCompatibility.suggestedPaper!)}
                            className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[11px] font-bold transition"
                          >
                            Switch to {paperCompatibility.suggestedPaper.toUpperCase()}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Dot Matrix on Non-Dot Matrix Printer Notice */}
                  {paperSize.startsWith("dot_matrix") && selectedPrinterInfo && selectedPrinterInfo.printerType !== "dot_matrix" && (
                    <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-700/60 rounded-lg p-3 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2">
                      <Printer className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="font-semibold">Dot Matrix Plain-Text Output Active</div>
                        <div className="text-[11px] text-blue-700 dark:text-blue-300 leading-tight">
                          Sending this job to &apos;{selectedPrinterInfo.displayName}&apos; will print as plain text. For graphical boxed invoices on laser/inkjet printers, select <strong>A4</strong> or <strong>A5</strong>.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Paper Format Picker */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                      Paper Size
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "a4", label: "A4 (210×297mm)" },
                        { id: "a5", label: "A5 (148×210mm)" },
                        { id: "half_a4", label: "Half-A4 (V-Cut)" },
                        { id: "thermal_80mm", label: "Thermal 80mm" },
                        { id: "thermal_58mm", label: "Thermal 58mm" },
                        { id: "dot_matrix_80col", label: "Dot Matrix 80C" },
                        { id: "dot_matrix_132col", label: "Dot Matrix 132C" },
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPaperSize(p.id as PaperSize)}
                          className={`p-2 rounded-lg text-xs font-bold text-left transition border ${
                            paperSize === p.id
                              ? "bg-blue-50 dark:bg-blue-950/60 border-blue-500 text-blue-700 dark:text-blue-300 shadow-sm"
                              : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dot Matrix Specific Controls */}
                  {(paperSize === "dot_matrix_80col" || paperSize === "dot_matrix_132col") && (
                    <div className="bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-lg p-3 space-y-3">
                      <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center justify-between">
                        <span>Dot Matrix Text-Mode Settings</span>
                        <span className="text-[10px] font-mono uppercase bg-emerald-200 dark:bg-emerald-900 px-1.5 py-0.5 rounded">
                          Fixed-Width ASCII
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Command Set
                          </label>
                          <select
                            value={printerProfile?.dotMatrixCommandSet || "esc_p"}
                            onChange={(e) => {
                              if (printerProfile) {
                                const updated = { ...printerProfile, dotMatrixCommandSet: e.target.value as any };
                                setPrinterProfile(updated);
                                printerManagerService.saveProfile(updated);
                              }
                            }}
                            className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-1.5 text-slate-800 dark:text-slate-100"
                          >
                            <option value="esc_p">ESC/P (Epson Standard)</option>
                            <option value="tvs_native">TVS MSP Native</option>
                            <option value="plain_ascii">Generic Text Only</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Lines / Page
                          </label>
                          <select
                            value={printerProfile?.linesPerPage ?? 66}
                            onChange={(e) => {
                              if (printerProfile) {
                                const val = parseInt(e.target.value);
                                const linesPerPage = isNaN(val) ? 66 : val;
                                const updated = { ...printerProfile, linesPerPage };
                                setPrinterProfile(updated);
                                printerManagerService.saveProfile(updated);
                              }
                            }}
                            className="w-full text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded p-1.5 text-slate-800 dark:text-slate-100"
                          >
                            <option value={66}>66 Lines (11" Standard Continuous)</option>
                            <option value={72}>72 Lines (12" Continuous Form)</option>
                            <option value={33}>33 Lines (6" Half-Page Continuous)</option>
                            <option value={0}>Continuous (No Page Breaks / Roll)</option>
                          </select>
                        </div>
                      </div>

                      <div className="space-y-1.5 pt-1 border-t border-emerald-200/60 dark:border-emerald-800/40">
                        <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showRuler}
                            onChange={(e) => setShowRuler(e.target.checked)}
                            className="rounded text-emerald-600"
                          />
                          <span>Show Column Ruler (80/132 Cols)</span>
                        </label>

                        <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showLineNumbers}
                            onChange={(e) => setShowLineNumbers(e.target.checked)}
                            className="rounded text-emerald-600"
                          />
                          <span>Show Line Numbers Gutter</span>
                        </label>

                        <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={showPageBreaks}
                            onChange={(e) => setShowPageBreaks(e.target.checked)}
                            className="rounded text-emerald-600"
                          />
                          <span>Show Continuous Page Breaks</span>
                        </label>

                        <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(printerProfile?.doubleStrikeCarbon)}
                            onChange={(e) => {
                              if (printerProfile) {
                                const updated = { ...printerProfile, doubleStrikeCarbon: e.target.checked };
                                setPrinterProfile(updated);
                                printerManagerService.saveProfile(updated);
                              }
                            }}
                            className="rounded text-emerald-600"
                          />
                          <span>Double-Strike Mode (Darker for Carbon Copies)</span>
                        </label>

                        <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(printerProfile?.prePrintedStationery)}
                            onChange={(e) => {
                              if (printerProfile) {
                                const updated = { ...printerProfile, prePrintedStationery: e.target.checked };
                                setPrinterProfile(updated);
                                printerManagerService.saveProfile(updated);
                              }
                            }}
                            className="rounded text-emerald-600"
                          />
                          <span>Pre-Printed Stationery (Data Only, No Borders)</span>
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Copies & Quick Controls */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Copies
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={copies}
                        onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-full text-xs font-bold bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Currency Format
                      </label>
                      <select
                        disabled={paperSize.startsWith("dot_matrix")}
                        value={paperSize.startsWith("dot_matrix") ? "rs_text" : currencySymbolFormat}
                        onChange={(e) => setCurrencySymbolFormat(e.target.value as any)}
                        className={`w-full text-xs bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2 text-slate-800 dark:text-slate-100 ${
                          paperSize.startsWith("dot_matrix") ? "opacity-75 cursor-not-allowed" : ""
                        }`}
                      >
                        {paperSize.startsWith("dot_matrix") ? (
                          <option value="rs_text">Rs. (Fixed Plain-Text ASCII)</option>
                        ) : (
                          <>
                            <option value="rupee_symbol">₹ (Unicode)</option>
                            <option value="rs_text">Rs. (Text Mode)</option>
                          </>
                        )}
                      </select>
                    </div>
                  </div>

                  {/* Device Specific Options */}
                  <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={silentPrint}
                        onChange={(e) => setSilentPrint(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                      <span>Silent Background Print (No OS popup)</span>
                    </label>

                    <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useSystemDialog}
                        onChange={(e) => setUseSystemDialog(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                      <span>Force Native OS Print Dialog</span>
                    </label>

                    <label className="flex items-center space-x-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isDuplicate}
                        onChange={(e) => {
                          setIsDuplicate(e.target.checked);
                          if (e.target.checked) setCopyMarker("DUPLICATE");
                        }}
                        className="rounded text-blue-600"
                      />
                      <span>Mark as DUPLICATE Reprint</span>
                    </label>
                  </div>

                  {/* Device Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleSetAsDefault}
                      className="flex-1 py-2 px-3 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg border border-slate-300 dark:border-slate-600 transition"
                    >
                      Set as Paper Default
                    </button>
                    <button
                      type="button"
                      onClick={handleTestPrint}
                      disabled={isTestingPrinter}
                      className="py-2 px-3 text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 text-blue-700 dark:text-blue-300 rounded-lg border border-blue-300 dark:border-blue-700 transition flex items-center gap-1"
                    >
                      <Zap className="w-3 h-3" /> Test
                    </button>
                  </div>
                </div>
              )}

              {activeTab === "layout" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-2">
                      Copy Classification Marker
                    </label>
                    <select
                      value={copyMarker}
                      onChange={(e) => setCopyMarker(e.target.value)}
                      className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-slate-800 dark:text-slate-100"
                    >
                      <option value="Original for Recipient">Original for Recipient</option>
                      <option value="Duplicate for Transporter">Duplicate for Transporter</option>
                      <option value="Triplicate for Supplier">Triplicate for Supplier</option>
                      <option value="DUPLICATE">DUPLICATE (Reprint)</option>
                      <option value="Delivery Challan">Delivery Challan / Stock Transfer</option>
                      <option value="None">None</option>
                    </select>
                  </div>

                  {/* Statutory Toggles */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Statutory GST & Clinical Details
                    </label>
                    
                    <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <span>HSN / GST Tax Summary Table</span>
                      <input
                        type="checkbox"
                        checked={showHsnSummary}
                        onChange={(e) => setShowHsnSummary(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <span>Dynamic UPI QR Code</span>
                      <input
                        type="checkbox"
                        checked={showUpiQr}
                        onChange={(e) => setShowUpiQr(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <span>Doctor & Patient Metadata</span>
                      <input
                        type="checkbox"
                        checked={showDoctorPatient}
                        onChange={(e) => setShowDoctorPatient(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <span>Drug Licenses (20B, 21B, FSSAI)</span>
                      <input
                        type="checkbox"
                        checked={showDrugLicenses}
                        onChange={(e) => setShowDrugLicenses(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                    </label>

                    <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 p-2 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 cursor-pointer">
                      <span>Terms & Conditions & Jurisdiction</span>
                      <input
                        type="checkbox"
                        checked={showTerms}
                        onChange={(e) => setShowTerms(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeTab === "share" && (
                <div className="space-y-4">
                  <div className="bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg p-3 text-xs space-y-2">
                    <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <FileDown className="w-4 h-4 text-blue-600" /> Digital PDF Export
                    </div>
                    <p className="text-slate-500 dark:text-slate-400">
                      Generates a standalone vector PDF with embedded Roboto TrueType fonts and ₹ glyph.
                    </p>
                    <button
                      type="button"
                      onClick={handleSavePdf}
                      disabled={isSavingPdf}
                      className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition shadow flex items-center justify-center gap-2"
                    >
                      <FileDown className="w-4 h-4" /> Save High-Fidelity PDF
                    </button>
                  </div>

                  {/* WhatsApp Share */}
                  <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3 text-xs space-y-2">
                    <div className="font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <Smartphone className="w-4 h-4 text-emerald-600" /> WhatsApp Customer Dispatch
                    </div>
                    <p className="text-emerald-700 dark:text-emerald-300">
                      Send document link and summary directly to the customer's WhatsApp.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const phone = customerPhone || data.customer_phone || "";
                        const url = generateWhatsAppShareUrl(phone, data as InvoicePrintData);
                        window.open(url, "_blank");
                      }}
                      className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition shadow"
                    >
                      Share on WhatsApp
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Status Notifications */}
            {statusMessage && (
              <div
                className={`mx-5 mb-3 p-3 rounded-lg text-xs font-semibold flex items-center gap-2 border animate-in fade-in ${
                  statusMessage.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300"
                    : statusMessage.type === "error"
                    ? "bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950 dark:text-rose-300"
                    : "bg-blue-50 text-blue-800 border-blue-300 dark:bg-blue-950 dark:text-blue-300"
                }`}
              >
                {statusMessage.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate">{statusMessage.text}</span>
              </div>
            )}

            {/* Bottom Actions */}
            <div className="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 font-mono">
                <span className="truncate">Printer: {selectedPrinterName || "None"}</span>
                <span>F9 / Ctrl+P</span>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-4 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 rounded-lg transition"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleExecutePrint}
                  disabled={isPrinting}
                  className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" />
                  {isPrinting ? "Spooling..." : "Print Document (F9)"}
                </button>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
