import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Printer,
  FileDown,
  Share2,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Check,
  RotateCw,
  Settings2,
  Copy,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Smartphone,
  Mail,
  AlertCircle,
  Eye,
  CheckCircle2,
  Save,
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
  initialFormat?: "a4" | "half_a4" | "thermal_80mm" | "thermal_58mm";
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

  // Determine initial paper size based on preference & props
  const defaultPaper = useMemo<"a4" | "half_a4" | "thermal_80mm" | "thermal_58mm">(() => {
    if (initialFormat) return initialFormat;
    const settingPaper = settings.printing.paperSize;
    if (settingPaper === "a4" || settingPaper === "thermal_80mm" || settingPaper === "thermal_58mm") {
      return settingPaper;
    }
    return "a4";
  }, [initialFormat, settings.printing.paperSize]);

  // Options State
  const [paperSize, setPaperSize] = useState<"a4" | "half_a4" | "thermal_80mm" | "thermal_58mm">(defaultPaper);
  const [copies, setCopies] = useState<number>(settings.printing.copies || 1);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [copyMarker, setCopyMarker] = useState<string>(settings.printing.defaultCopyMarker || "Original for Recipient");
  
  // Customization Toggles
  const [showHsnSummary, setShowHsnSummary] = useState<boolean>(settings.printing.printHsnSummary ?? true);
  const [showUpiQr, setShowUpiQr] = useState<boolean>(settings.printing.printUpiQrCode ?? true);
  const [showDoctorPatient, setShowDoctorPatient] = useState<boolean>(settings.printing.printDoctorDetails ?? true);
  const [showDrugLicenses, setShowDrugLicenses] = useState<boolean>(settings.printing.printDrugLicenses ?? true);
  const [showTerms, setShowTerms] = useState<boolean>(true);

  // Zoom & View state
  const [zoomScale, setZoomScale] = useState<number>(100);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);
  const [isSavingPdf, setIsSavingPdf] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "info" | "success" | "error" } | null>(null);
  const [savedFilePath, setSavedFilePath] = useState<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Synchronize initial format when modal opens
  useEffect(() => {
    if (isOpen) {
      if (initialFormat) {
        setPaperSize(initialFormat);
      } else {
        const p = settings.printing.paperSize;
        if (p === "a4" || p === "thermal_80mm" || p === "thermal_58mm") {
          setPaperSize(p);
        }
      }
      setStatusMessage(null);
      setSavedFilePath(null);
      setZoomScale(paperSize.startsWith("thermal") ? 110 : 95);
    }
  }, [isOpen, initialFormat]);

  // Build rendered HTML whenever options change
  const renderedHtml = useMemo(() => {
    if (!isOpen || !data) return "";
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
  ]);

  // Push HTML into sandbox preview iframe
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

  // Keyboard Shortcuts Listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handleExecutePrint();
      } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && (e.target as HTMLElement).tagName !== "BUTTON" && (e.target as HTMLElement).tagName !== "SELECT" && (e.target as HTMLElement).tagName !== "INPUT") {
        e.preventDefault();
        handleExecutePrint();
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
  }, [isOpen, renderedHtml, paperSize, copies, copyMarker]);

  // Execute Print Action
  const handleExecutePrint = async () => {
    if (isPrinting) return;
    setIsPrinting(true);
    setStatusMessage({ text: "Sending job to printer...", type: "info" });

    try {
      if (paperSize.startsWith("thermal")) {
        const res = await printingEngine.printThermalReceipt(data);
        if (res.success) {
          setStatusMessage({ text: "Thermal receipt printed successfully!", type: "success" });
          onAfterPrint?.({ success: true, mode: "thermal" });
          setTimeout(() => onClose(), 1200);
        } else {
          setStatusMessage({ text: "Printer communication failed. Please verify printer status.", type: "error" });
        }
      } else {
        // A4 / Half-A4 Print
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.focus();
          iframeRef.current.contentWindow.print();
          setStatusMessage({ text: "Sent to system print spooler", type: "success" });
          onAfterPrint?.({ success: true, mode: "a4" });
        } else {
          const res = await printingEngine.printA4TaxInvoice(data);
          if (res.success) {
            setStatusMessage({ text: "A4 Tax Invoice sent to printer!", type: "success" });
            onAfterPrint?.({ success: true, mode: "a4" });
            setTimeout(() => onClose(), 1200);
          } else {
            setStatusMessage({ text: "Print failed.", type: "error" });
          }
        }
      }
    } catch (err: any) {
      console.error("Print error:", err);
      setStatusMessage({ text: `Print error: ${err?.message || "Unknown error"}`, type: "error" });
    } finally {
      setIsPrinting(false);
    }
  };

  // Save PDF Action
  const handleSavePdf = async () => {
    if (isSavingPdf) return;
    setIsSavingPdf(true);
    setStatusMessage({ text: "Generating high-fidelity vector PDF...", type: "info" });

    try {
      const invNo = data.invoice_number || data.return_number || data.purchase_number || "Document";
      const fileName = `${invNo.replace(/[^a-zA-Z0-9_-]/g, "_")}.pdf`;

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

  // WhatsApp Share Action
  const handleShareWhatsApp = () => {
    const phone = customerPhone || data.customer_phone || "";
    if (docType === "tax_invoice" || docType === "invoice") {
      const url = generateWhatsAppShareUrl(phone, data as InvoicePrintData);
      window.open(url, "_blank");
    } else {
      const text = encodeURIComponent(
        `Dear Customer, here are your document details from ${data.store_name}:\nDocument: #${data.return_number || data.invoice_number}\nAmount: ₹${(data.grand_total || 0).toFixed(2)}\nThank you!`
      );
      window.open(`https://wa.me/${phone.replace(/[^0-9]/g, "")}?text=${text}`, "_blank");
    }
  };

  // Email Share Action
  const handleShareEmail = () => {
    const email = customerEmail || data.customer_email || "customer@example.com";
    if (docType === "tax_invoice" || docType === "invoice") {
      const url = generateEmailShareUrl(email, data as InvoicePrintData);
      window.location.href = url;
    } else {
      const subject = encodeURIComponent(`${data.store_name} Document #${data.return_number || data.invoice_number}`);
      const body = encodeURIComponent(
        `Dear Customer,\n\nPlease find details for #${data.return_number || data.invoice_number}.\nTotal Amount: ₹${(data.grand_total || 0).toFixed(2)}\n\nThank you,\n${data.store_name}`
      );
      window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
    }
  };

  // Save current choices as defaults for this doc type
  const handleSaveAsDefaults = () => {
    companySettingsService.updateSettings({
      printing: {
        ...settings.printing,
        paperSize: paperSize === "half_a4" ? "a4" : paperSize,
        copies,
        defaultCopyMarker: copyMarker,
        printHsnSummary: showHsnSummary,
        printUpiQrCode: showUpiQr,
        printDoctorDetails: showDoctorPatient,
        printDrugLicenses: showDrugLicenses,
      },
    });
    setStatusMessage({ text: "Saved preferences as default settings!", type: "success" });
  };

  if (!isOpen) return null;

  const isThermal = paperSize.startsWith("thermal");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-4">
      <div className="flex flex-col h-[94vh] w-full max-w-7xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 animate-in fade-in zoom-in-95 duration-150">
        
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
                {copyMarker !== "None" && (
                  <span className="px-2 py-0.5 text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 rounded">
                    {copyMarker}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Exact print & PDF match • Embedded TrueType fonts • High-fidelity vector rendering
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
              <button
                type="button"
                onClick={() => setZoomScale(isThermal ? 120 : 85)}
                className="px-2 py-1 text-xs hover:bg-slate-700 text-slate-300 hover:text-white rounded transition"
                title="Fit to screen"
              >
                Fit
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

        {/* Main Center Area: Canvas on Left + Options Sidebar on Right */}
        <div className="flex flex-1 overflow-hidden bg-slate-100 dark:bg-slate-950">
          
          {/* Document Canvas Preview Container */}
          <div className="flex-1 flex items-center justify-center p-6 overflow-auto relative select-none">
            <div
              className="transition-transform duration-100 origin-top shadow-2xl rounded-sm bg-white overflow-hidden"
              style={{
                transform: `scale(${zoomScale / 100})`,
                width: isThermal
                  ? paperSize === "thermal_58mm"
                    ? "68mm"
                    : "92mm"
                  : paperSize === "half_a4"
                  ? "215mm"
                  : "215mm",
                minHeight: isThermal ? "140mm" : paperSize === "half_a4" ? "150mm" : "297mm",
              }}
            >
              <iframe
                ref={iframeRef}
                title="Print Preview Frame"
                className="w-full h-[850px] border-0 pointer-events-auto bg-white"
                sandbox="allow-same-origin allow-scripts allow-modals"
              />
            </div>
          </div>

          {/* Right Control Sidebar */}
          <div className="w-84 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 overflow-y-auto flex flex-col justify-between">
            <div className="space-y-5">
              
              {/* Format / Paper Size */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Paper Format
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPaperSize("a4");
                      setZoomScale(90);
                    }}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left flex flex-col transition ${
                      paperSize === "a4"
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-600 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>A4 Tax Invoice</span>
                    <span className="text-[10px] text-slate-400 font-normal">Full page laser</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaperSize("half_a4");
                      setZoomScale(95);
                    }}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left flex flex-col transition ${
                      paperSize === "half_a4"
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-600 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>Half A4 (A5)</span>
                    <span className="text-[10px] text-slate-400 font-normal">Dot-matrix / 2-in-1</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaperSize("thermal_80mm");
                      setZoomScale(110);
                    }}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left flex flex-col transition ${
                      paperSize === "thermal_80mm"
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-600 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>Thermal 80mm</span>
                    <span className="text-[10px] text-slate-400 font-normal">Standard POS Roll</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setPaperSize("thermal_58mm");
                      setZoomScale(120);
                    }}
                    className={`px-3 py-2 text-xs font-semibold rounded-lg border text-left flex flex-col transition ${
                      paperSize === "thermal_58mm"
                        ? "bg-blue-50 dark:bg-blue-900/30 border-blue-600 text-blue-600 dark:text-blue-400 shadow-sm"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span>Thermal 58mm</span>
                    <span className="text-[10px] text-slate-400 font-normal">Compact 2-inch</span>
                  </button>
                </div>
              </div>

              {/* Copies & Orientation */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Copies
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={copies}
                    onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Orientation
                  </label>
                  <select
                    value={orientation}
                    onChange={(e) => setOrientation(e.target.value as "portrait" | "landscape")}
                    disabled={isThermal}
                    className="w-full px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                </div>
              </div>

              {/* Copy Marker Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Copy Marker
                </label>
                <select
                  value={copyMarker}
                  onChange={(e) => setCopyMarker(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:ring-2 focus:ring-blue-500"
                >
                  <option value="Original for Recipient">Original for Recipient</option>
                  <option value="Duplicate for Transporter">Duplicate for Transporter</option>
                  <option value="Triplicate for Supplier">Triplicate for Supplier</option>
                  <option value="Revised Tax Invoice">Revised Tax Invoice</option>
                  <option value="Customer Copy">Customer Copy</option>
                  <option value="Office Copy">Office Copy</option>
                  <option value="None">None (No Marker)</option>
                </select>
              </div>

              {/* Customization Toggles */}
              <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-2.5">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Sections & Layout
                </label>

                <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <span>Show HSN / GST Summary</span>
                  <input
                    type="checkbox"
                    checked={showHsnSummary}
                    onChange={(e) => setShowHsnSummary(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <span>Show Dynamic UPI QR Code</span>
                  <input
                    type="checkbox"
                    checked={showUpiQr}
                    onChange={(e) => setShowUpiQr(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <span>Show Doctor & Patient Details</span>
                  <input
                    type="checkbox"
                    checked={showDoctorPatient}
                    onChange={(e) => setShowDoctorPatient(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <span>Show Drug Licenses & GSTIN</span>
                  <input
                    type="checkbox"
                    checked={showDrugLicenses}
                    onChange={(e) => setShowDrugLicenses(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                <label className="flex items-center justify-between text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                  <span>Show Terms & Conditions</span>
                  <input
                    type="checkbox"
                    checked={showTerms}
                    onChange={(e) => setShowTerms(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>
              </div>

              {/* Save Preferences Button */}
              <button
                type="button"
                onClick={handleSaveAsDefaults}
                className="w-full flex items-center justify-center space-x-1.5 py-1.5 px-3 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save as Default Settings</span>
              </button>
            </div>

            {/* Quick Share Buttons */}
            <div className="border-t border-slate-200 dark:border-slate-800 pt-4 mt-4 space-y-2">
              <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">
                Instant Share
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleShareWhatsApp}
                  className="flex items-center justify-center space-x-1 py-1.5 px-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 rounded-lg text-xs font-semibold hover:bg-emerald-100 transition"
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>

                <button
                  type="button"
                  onClick={handleShareEmail}
                  className="flex items-center justify-center space-x-1 py-1.5 px-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-800 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition"
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Email</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Action & Status Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800">
          
          {/* Status Message */}
          <div className="flex items-center space-x-2">
            {statusMessage ? (
              <div
                className={`flex items-center space-x-2 text-xs font-medium px-3 py-1.5 rounded-lg ${
                  statusMessage.type === "success"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300"
                    : statusMessage.type === "error"
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300"
                    : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300"
                }`}
              >
                {statusMessage.type === "success" && <CheckCircle2 className="w-4 h-4" />}
                {statusMessage.type === "error" && <AlertCircle className="w-4 h-4" />}
                <span>{statusMessage.text}</span>
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Keyboard shortcuts: <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300 font-mono text-[10px]">Enter</kbd> to Print, <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300 font-mono text-[10px]">Esc</kbd> to Cancel
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition"
            >
              Cancel (Esc)
            </button>

            <button
              type="button"
              onClick={handleSavePdf}
              disabled={isSavingPdf}
              className="flex items-center space-x-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-bold shadow transition disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" />
              <span>{isSavingPdf ? "Saving PDF..." : "Save PDF"}</span>
            </button>

            <button
              type="button"
              onClick={handleExecutePrint}
              disabled={isPrinting}
              className="flex items-center space-x-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-500/25 transition disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              <span>{isPrinting ? "Printing..." : `Print (${paperSize.toUpperCase()})`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
