import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  Calendar,
  Filter,
  Receipt,
  FileText,
  Printer,
  Download,
  Share2,
  Copy,
  Edit,
  XCircle,
  CheckCircle,
  Clock,
  ArrowLeft,
  AlertCircle,
  Eye,
  Lock,
  UserCheck,
  RefreshCw,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import {
  invoiceManagementService,
  type InvoiceRecord,
  type InvoiceItemRecord,
  type InvoiceAuditEntry,
  type InvoiceFilterCriteria,
} from "../lib/billing/invoiceManagementService";
import {
  printingEngine,
  generateWhatsAppShareUrl,
  generateEmailShareUrl,
  type InvoicePrintData,
} from "../lib/printing/printingEngine";
import { posCartService } from "../lib/billing/posCartService";
import { productsStore, type ProductBatch, type ProductItem } from "../lib/masters/productsStore";

export const BillsPage: React.FC = () => {
  const navigate = useNavigate();

  // State
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<"today" | "yesterday" | "last7days" | "month" | "all">("today");
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Selected Detail Modal
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [selectedInvoiceItems, setSelectedInvoiceItems] = useState<InvoiceItemRecord[]>([]);
  const [selectedInvoiceAudit, setSelectedInvoiceAudit] = useState<InvoiceAuditEntry[]>([]);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Cancel & PIN Dialog
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Edit PIN Dialog
  const [isEditPinModalOpen, setIsEditPinModalOpen] = useState(false);
  const [editPin, setEditPin] = useState("");
  const [editPinError, setEditPinError] = useState("");

  // Notification Toast
  interface NotificationAction {
    label: string;
    icon?: "open" | "folder";
    onClick: () => void;
  }
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error";
    actions?: NotificationAction[];
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLTableSectionElement>(null);

  const showNotification = (
    message: string,
    type: "success" | "error" = "success",
    actions?: NotificationAction[]
  ) => {
    setNotification({ message, type, actions });
    setTimeout(() => setNotification(null), actions && actions.length > 0 ? 8000 : 3500);
  };

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const criteria: InvoiceFilterCriteria = {
        searchQuery,
        dateRange,
        paymentMode: paymentModeFilter,
        status: statusFilter,
      };
      const list = await invoiceManagementService.listInvoices(criteria);
      setInvoices(list);
      setSelectedIndex(0);
    } catch (err) {
      showNotification("Failed to load invoices", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [dateRange, paymentModeFilter, statusFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      loadInvoices();
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, Escape closes modal
      if (isDetailModalOpen || isCancelModalOpen || isEditPinModalOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (isCancelModalOpen) setIsCancelModalOpen(false);
          else if (isEditPinModalOpen) setIsEditPinModalOpen(false);
          else if (isDetailModalOpen) setIsDetailModalOpen(false);
        }
        return;
      }

      // Escape navigates back to POS billing
      if (e.key === "Escape") {
        e.preventDefault();
        navigate("/pos");
        return;
      }

      // F1 navigates to POS
      if (e.key === "F1") {
        e.preventDefault();
        navigate("/pos");
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (invoices.length > 0) {
          setSelectedIndex((prev) => Math.min(prev + 1, invoices.length - 1));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (invoices.length > 0) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = invoices[selectedIndex];
        if (selected) {
          openDetailModal(selected);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDetailModalOpen, isCancelModalOpen, isEditPinModalOpen, invoices, selectedIndex, navigate]);

  // Auto-scroll selected row into view
  useEffect(() => {
    if (tableRef.current && tableRef.current.children[selectedIndex]) {
      const row = tableRef.current.children[selectedIndex] as HTMLElement;
      row.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const openDetailModal = async (invoice: InvoiceRecord) => {
    const details = await invoiceManagementService.getInvoiceWithDetails(invoice.id);
    if (!details) {
      showNotification("Could not load invoice details", "error");
      return;
    }
    setSelectedInvoice(details.invoice);
    setSelectedInvoiceItems(details.items);
    setSelectedInvoiceAudit(details.auditLog);
    setIsDetailModalOpen(true);
  };

  const buildPrintData = (invoice: InvoiceRecord, items: InvoiceItemRecord[]): InvoicePrintData => {
    return {
      invoice_number: invoice.invoice_number + (invoice.is_revised ? " (Revised)" : ""),
      invoice_date: invoice.invoice_date,
      store_name: "LamStone Pharmacy & Retail",
      store_phone: "9876543210",
      customer_name: invoice.customer_name || "Walk-in Customer",
      customer_phone: invoice.customer_phone || "",
      lines: items.map((it) => ({
        description: it.product_name,
        batch_no: it.batch_no,
        expiry_date: it.expiry_date,
        qty: it.qty,
        loose_qty: it.loose_qty,
        rate: it.unit_price,
        gst_percent: it.gst_percent,
        amount: it.total_amount,
      })),
      subtotal: invoice.subtotal,
      tax_total: invoice.tax_total,
      round_off: invoice.round_off,
      grand_total: invoice.grand_total,
    };
  };

  // Actions
  const handleReprint = async (format: "a4" | "thermal" | "pdf") => {
    if (!selectedInvoice) return;
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    try {
      if (format === "thermal") {
        await printingEngine.printThermalReceipt(printData);
        showNotification("Thermal receipt sent to printer");
      } else if (format === "a4") {
        await printingEngine.printA4TaxInvoice(printData);
        showNotification("A4 Tax Invoice sent to printer");
      } else if (format === "pdf") {
        const res = await printingEngine.exportToPdf(printData);
        if (res.cancelled) {
          // User intentionally cancelled the file dialog - show nothing
          return;
        }
        if (!res.success) {
          showNotification(res.error || "Failed to save PDF invoice", "error");
          return;
        }
        showNotification(
          res.file_path ? `Saved to: ${res.file_path}` : "PDF invoice saved successfully!",
          "success",
          res.file_path
            ? [
                {
                  label: "Open file",
                  icon: "open",
                  onClick: () => printingEngine.openFile(res.file_path!),
                },
                {
                  label: "Show in folder",
                  icon: "folder",
                  onClick: () => printingEngine.revealFile(res.file_path!),
                },
              ]
            : undefined
        );
      }
    } catch (err) {
      showNotification("Error printing invoice", "error");
    }
  };

  const handleWhatsAppShare = () => {
    if (!selectedInvoice) return;
    if (!selectedInvoice.customer_phone?.trim()) {
      showNotification("Customer mobile number not recorded on this bill", "error");
      return;
    }
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const url = generateWhatsAppShareUrl(selectedInvoice.customer_phone, printData);
    window.open(url, "_blank");
    showNotification("WhatsApp share window opened");
  };

  const handleEmailShare = () => {
    if (!selectedInvoice) return;
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const url = generateEmailShareUrl("customer@example.com", printData);
    window.open(url, "_blank");
    showNotification("Email client opened");
  };

  const handleDuplicateAsNewBill = async () => {
    if (!selectedInvoice || selectedInvoiceItems.length === 0) return;

    // Clear cart and populate with selected invoice items
    posCartService.clearCart();

    for (const it of selectedInvoiceItems) {
      const batches: ProductBatch[] = await productsStore.getBatchesForProduct(it.product_id, false);
      const batch: ProductBatch = batches.find((b: ProductBatch) => b.batch_no === it.batch_no) || {
        id: `batch_${it.product_id}_${it.batch_no}`,
        product_id: it.product_id,
        batch_no: it.batch_no,
        expiry_date: it.expiry_date,
        stock_qty: 100,
        mrp: it.mrp || it.unit_price,
        selling_rate: it.unit_price,
      };

      const productItem: ProductItem = {
        id: it.product_id,
        name: it.product_name,
        barcode: "",
        mrp: it.mrp || it.unit_price,
        sel_rate: it.unit_price,
        gst_percent: it.gst_percent,
        hsn_sac_code: it.hsn_code,
        units_per_pack: it.units_per_pack || 1,
        is_active: true,
      };

      posCartService.addProductToCart(productItem, batch, it.qty, it.loose_qty);
    }

    setIsDetailModalOpen(false);
    navigate("/pos");
  };

  const handlePromptEdit = () => {
    if (!selectedInvoice) return;
    const lock = invoiceManagementService.checkInvoiceLockStatus(selectedInvoice);
    if (lock.isLocked) {
      showNotification(lock.lockReason || "Invoice is locked from editing", "error");
      return;
    }
    setEditPin("");
    setEditPinError("");
    setIsEditPinModalOpen(true);
  };

  const handleConfirmEditPin = () => {
    if (!invoiceManagementService.verifyManagerPin(editPin)) {
      setEditPinError("Invalid Manager PIN. Default is 1234.");
      return;
    }
    setIsEditPinModalOpen(false);
    setIsDetailModalOpen(false);
    navigate(`/pos?edit=${selectedInvoice?.id}`);
  };

  const handlePromptCancel = () => {
    if (!selectedInvoice) return;
    const lock = invoiceManagementService.checkInvoiceLockStatus(selectedInvoice);
    if (lock.isLocked) {
      showNotification(lock.lockReason || "Invoice cannot be cancelled", "error");
      return;
    }
    setCancelReason("");
    setManagerPin("");
    setPinError("");
    setIsCancelModalOpen(true);
  };

  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) {
      setPinError("Mandatory cancellation reason required");
      return;
    }
    if (!invoiceManagementService.verifyManagerPin(managerPin)) {
      setPinError("Invalid Manager PIN. Default is 1234.");
      return;
    }

    try {
      await invoiceManagementService.cancelInvoice(
        selectedInvoice!.id,
        cancelReason.trim(),
        "Manager (Counter 01)"
      );
      showNotification(`Invoice ${selectedInvoice?.invoice_number} cancelled. Stock restored.`);
      setIsCancelModalOpen(false);
      setIsDetailModalOpen(false);
      loadInvoices();
    } catch (err) {
      setPinError(err instanceof Error ? err.message : "Error cancelling bill");
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex flex-col gap-2 rounded-xl p-3.5 text-xs font-semibold shadow-2xl transition-all max-w-lg border ${
            notification.type === "success"
              ? "bg-slate-900 text-slate-100 border-emerald-500/50"
              : "bg-red-800 text-white border-red-600"
          }`}
        >
          <div className="flex items-start gap-2.5">
            {notification.type === "success" ? (
              <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-200 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 overflow-hidden">
              <p className="font-medium break-all leading-relaxed">{notification.message}</p>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-white p-0.5 cursor-pointer ml-1"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </div>

          {notification.actions && notification.actions.length > 0 && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-700/60 mt-0.5">
              {notification.actions.map((act, i) => (
                <button
                  key={i}
                  onClick={act.onClick}
                  className="flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-[11px] font-bold text-emerald-400 border border-slate-700 shadow-xs cursor-pointer transition-colors"
                >
                  {act.icon === "folder" ? (
                    <FolderOpen className="h-3 w-3" />
                  ) : (
                    <ExternalLink className="h-3 w-3" />
                  )}
                  <span>{act.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Top Header & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/pos")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            title="Return to POS Billing (Esc)"
          >
            <ArrowLeft className="h-4 w-4 text-slate-500" />
            <span>Back to POS (Esc)</span>
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div>
            <h1 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-blue-600" />
              <span>Invoices & Past Bills Register</span>
            </h1>
            <p className="text-[11px] text-slate-500">
              Search, reprint, audit, edit, or cancel customer tax invoices offline.
            </p>
          </div>
        </div>

        {/* Global Search Input */}
        <div className="relative w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search invoice no, customer, mobile, product..."
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-9 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-sm">
        {/* Date Range Chips */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mr-1">Period:</span>
          {(
            [
              { id: "today", label: "Today" },
              { id: "yesterday", label: "Yesterday" },
              { id: "last7days", label: "Last 7 Days" },
              { id: "month", label: "This Month" },
              { id: "all", label: "All Time" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              onClick={() => setDateRange(chip.id)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                dateRange === chip.id
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Mode & Status Filters */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Payment:</span>
            <select
              value={paymentModeFilter}
              onChange={(e) => setPaymentModeFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="all">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Credit">Credit</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <span className="text-[11px] font-semibold text-slate-400 uppercase">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="issued">Issued</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <button
            onClick={loadInvoices}
            className="flex items-center gap-1 rounded border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
            title="Refresh Invoices"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="flex-1 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-slate-600 border-b border-slate-200 z-10">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Invoice No</th>
                <th className="px-4 py-2.5 font-semibold">Date & Time</th>
                <th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 font-semibold">Mobile</th>
                <th className="px-4 py-2.5 font-semibold text-right">Net Amount</th>
                <th className="px-4 py-2.5 font-semibold">Tender</th>
                <th className="px-4 py-2.5 font-semibold text-center">Status</th>
                <th className="px-4 py-2.5 font-semibold text-center">Sync</th>
                <th className="px-4 py-2.5 font-semibold text-center">Action</th>
              </tr>
            </thead>
            <tbody ref={tableRef} className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin text-blue-500 mb-2" />
                    <span>Loading invoices...</span>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <Receipt className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="font-semibold text-slate-600">No invoices found matching criteria</p>
                    <p className="text-[11px] text-slate-400">Try adjusting date range or clearing search query</p>
                  </td>
                </tr>
              ) : (
                invoices.map((inv, idx) => {
                  const isHighlighted = idx === selectedIndex;
                  const isCancelled = inv.status === "cancelled";
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => {
                        setSelectedIndex(idx);
                        openDetailModal(inv);
                      }}
                      className={`cursor-pointer transition-colors ${
                        isHighlighted
                          ? "bg-blue-50/80 ring-1 ring-inset ring-blue-500 font-medium"
                          : "hover:bg-slate-50"
                      } ${isCancelled ? "opacity-75" : ""}`}
                    >
                      <td className="px-4 py-2.5 font-mono font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span className={isCancelled ? "line-through text-red-500" : "text-blue-700"}>
                            {inv.invoice_number}
                          </span>
                          {inv.is_revised ? (
                            <span className="rounded bg-purple-100 px-1.5 py-0.2 text-[9px] font-bold text-purple-700 uppercase">
                              Revised
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {inv.invoice_date}
                        {inv.created_at ? (
                          <span className="ml-1 text-[10px] text-slate-400">
                            {new Date(inv.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 font-semibold text-slate-800">
                        {inv.customer_name || "Walk-in Customer"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono">
                        {inv.customer_phone || "-"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900">
                        <span className={isCancelled ? "line-through text-red-400" : ""}>
                          ₹ {inv.grand_total.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          {inv.payment_mode || "Cash"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {isCancelled ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                            Cancelled
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            Issued
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {inv.sync_state === "pending" ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <Clock className="h-3 w-3" />
                            <span>Local</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <CheckCircle className="h-3 w-3" />
                            <span>Synced</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetailModal(inv);
                          }}
                          className="rounded bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                        >
                          View / Actions
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer shortcuts hint */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500 font-medium">
          <div className="flex items-center gap-4">
            <span><kbd className="rounded border bg-white px-1.5 py-0.5 shadow-xs">↑/↓</kbd> Select Invoice</span>
            <span><kbd className="rounded border bg-white px-1.5 py-0.5 shadow-xs">Enter</kbd> Open Details</span>
            <span><kbd className="rounded border bg-white px-1.5 py-0.5 shadow-xs">Esc</kbd> Return to POS</span>
          </div>
          <div>
            <span>Total Invoices: <strong>{invoices.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {isDetailModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-3">
              <div className="flex items-center gap-3">
                <Receipt className="h-5 w-5 text-blue-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                    <span>Tax Invoice: {selectedInvoice.invoice_number}</span>
                    {selectedInvoice.status === "cancelled" ? (
                      <span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        Cancelled
                      </span>
                    ) : (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        Issued
                      </span>
                    )}
                    {selectedInvoice.is_revised ? (
                      <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                        Revised Bill
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Billed on {selectedInvoice.invoice_date} • Counter: {selectedInvoice.user_counter || "Counter 01"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Customer & Bill Meta */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Customer Name</span>
                  <p className="font-bold text-slate-800">{selectedInvoice.customer_name || "Walk-in Customer"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Mobile Number</span>
                  <p className="font-mono font-medium text-slate-700">{selectedInvoice.customer_phone || "Not specified"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">Payment Mode</span>
                  <p className="font-semibold text-blue-600">{selectedInvoice.payment_mode || "Cash"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase">GSTIN / Place of Supply</span>
                  <p className="font-mono text-slate-600">
                    {selectedInvoice.customer_gstin || "Unregistered"} ({selectedInvoice.place_of_supply || "32-Kerala"})
                  </p>
                </div>
              </div>

              {selectedInvoice.status === "cancelled" && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
                  <span className="font-bold uppercase tracking-wide text-[10px]">Cancellation Reason:</span>
                  <p className="font-medium text-xs mt-0.5">{selectedInvoice.cancel_reason || "No reason specified"}</p>
                </div>
              )}

              {/* Items Table */}
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Item & Description</th>
                      <th className="px-3 py-2 font-semibold">Batch</th>
                      <th className="px-3 py-2 font-semibold">Expiry</th>
                      <th className="px-3 py-2 font-semibold text-right">Qty</th>
                      <th className="px-3 py-2 font-semibold text-right">Unit Rate</th>
                      <th className="px-3 py-2 font-semibold text-right">GST %</th>
                      <th className="px-3 py-2 font-semibold text-right">Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedInvoiceItems.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-bold text-slate-800">{item.product_name}</td>
                        <td className="px-3 py-2 font-mono text-slate-600">{item.batch_no}</td>
                        <td className="px-3 py-2 font-mono text-slate-500">{item.expiry_date}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {item.qty} {item.loose_qty ? `+ ${item.loose_qty}L` : ""}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">₹ {item.unit_price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.gst_percent}%</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                          ₹ {item.total_amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Breakdown */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Taxable Subtotal:</span>
                    <span className="font-mono">₹ {selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>GST Tax Total:</span>
                    <span className="font-mono">₹ {selectedInvoice.tax_total.toFixed(2)}</span>
                  </div>
                  {selectedInvoice.round_off !== 0 && (
                    <div className="flex justify-between text-slate-600">
                      <span>Round-Off:</span>
                      <span className="font-mono">
                        {selectedInvoice.round_off > 0 ? "+" : ""}
                        {selectedInvoice.round_off.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-slate-200 pt-1 flex justify-between font-bold text-sm text-slate-900">
                    <span>Grand Total:</span>
                    <span className="font-mono text-blue-700">₹ {selectedInvoice.grand_total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Audit History Log */}
              {selectedInvoiceAudit.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <h4 className="font-bold text-slate-700 text-xs mb-2">Audit & Revision Trail</h4>
                  <div className="space-y-1.5">
                    {selectedInvoiceAudit.map((entry, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px] text-slate-600">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold uppercase text-[9px]">
                          {entry.action}
                        </span>
                        <span className="font-semibold text-slate-700">{entry.user}</span>
                        <span className="text-slate-400">
                          ({new Date(entry.timestamp).toLocaleString()})
                        </span>
                        <span className="text-slate-600">— {entry.diffSummary || entry.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              {/* Reprints */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReprint("a4")}
                  className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Reprint A4</span>
                </button>
                <button
                  onClick={() => handleReprint("thermal")}
                  className="flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-900"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Reprint Thermal</span>
                </button>
                <button
                  onClick={() => handleReprint("pdf")}
                  className="flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Save PDF</span>
                </button>
                <button
                  onClick={handleWhatsAppShare}
                  className="flex items-center gap-1 rounded bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  title="Share via WhatsApp"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  <span>WhatsApp</span>
                </button>
              </div>

              {/* Privileged / Modification Operations */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDuplicateAsNewBill}
                  className="flex items-center gap-1 rounded bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                  title="Load into POS cart as a new bill"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Duplicate as New</span>
                </button>

                {selectedInvoice.status !== "cancelled" && (
                  <>
                    <button
                      onClick={handlePromptEdit}
                      className="flex items-center gap-1 rounded bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      <span>Edit Bill</span>
                    </button>
                    <button
                      onClick={handlePromptCancel}
                      className="flex items-center gap-1 rounded bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancel Bill</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit PIN Prompt Modal */}
      {isEditPinModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-amber-600 mb-3">
              <Lock className="h-5 w-5" />
              <h3 className="font-bold text-slate-800 text-sm">Manager Authorization Required</h3>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Editing a saved invoice requires manager verification. Please enter Manager PIN.
            </p>
            <input
              type="password"
              value={editPin}
              onChange={(e) => setEditPin(e.target.value)}
              placeholder="Enter PIN (Default: 1234)"
              autoFocus
              className="w-full rounded border border-slate-300 px-3 py-2 text-center text-sm font-mono tracking-widest focus:border-blue-500 focus:outline-none"
            />
            {editPinError && <p className="mt-1.5 text-[11px] font-bold text-red-600">{editPinError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsEditPinModalOpen(false)}
                className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEditPin}
                className="rounded bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700"
              >
                Authorize & Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              <h3 className="font-bold text-slate-800 text-sm">Cancel Invoice {selectedInvoice?.invoice_number}</h3>
            </div>
            <p className="text-xs text-slate-600">
              Cancelling will restore all items to batch inventory, update reports, and retain this invoice number marked as <strong>Cancelled</strong>.
            </p>

            <div>
              <label className="text-xs font-bold text-slate-700">Mandatory Cancellation Reason:</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g., Customer returned items, Billing mistake..."
                className="w-full rounded border border-slate-300 p-2 text-xs focus:border-red-500 focus:outline-none mt-1"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700">Manager PIN:</label>
              <input
                type="password"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                placeholder="Default: 1234"
                className="w-full rounded border border-slate-300 p-2 text-xs font-mono tracking-widest focus:border-red-500 focus:outline-none mt-1"
              />
            </div>

            {pinError && <p className="text-xs font-bold text-red-600">{pinError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="rounded px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Keep Invoice
              </button>
              <button
                onClick={handleConfirmCancel}
                className="rounded bg-red-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-red-700"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
