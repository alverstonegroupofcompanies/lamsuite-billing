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
import { isTauri } from "../lib/ipc/ipcBridge";
import { posCartService } from "../lib/billing/posCartService";
import { productsStore, type ProductBatch, type ProductItem } from "../lib/masters/productsStore";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { lanPeerService } from "../lib/lan/lanPeerService";
import { PrintPreviewModal } from "../components/PrintPreviewModal";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

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
  useModalEscape(isDetailModalOpen, () => setIsDetailModalOpen(false));

  // Cancel & PIN Dialog
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  useModalEscape(isCancelModalOpen, () => setIsCancelModalOpen(false));
  const [cancelReason, setCancelReason] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Edit PIN Dialog
  const [isEditPinModalOpen, setIsEditPinModalOpen] = useState(false);
  useModalEscape(isEditPinModalOpen, () => setIsEditPinModalOpen(false));
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

  const [isRefreshingFromLan, setIsRefreshingFromLan] = useState(false);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const criteria: InvoiceFilterCriteria = {
        searchQuery,
        dateRange,
        paymentMode: paymentModeFilter,
        status: statusFilter,
      };
      let list = await invoiceManagementService.listInvoices(criteria);

      // If empty or if secondary LAN counter, check LAN Hub for latest snapshot
      const activeStoreId = localStorage.getItem("lamsuite_active_store_id") || "default";
      const isLanClient = localStorage.getItem("lamsuite_device_token") || localStorage.getItem("lamsuite_hub_ip");
      if (isLanClient && (list.length === 0 || criteria.dateRange === "all" || criteria.dateRange === "today")) {
        try {
          const hubIp = localStorage.getItem("lamsuite_hub_ip");
          const hubPort = Number(localStorage.getItem("lamsuite_hub_port")) || 8000;
          const deviceToken = localStorage.getItem("lamsuite_device_token") || undefined;
          if (hubIp) {
            await lanPeerService.pullMasterSnapshotFromMain(hubIp, hubPort, undefined, deviceToken).catch(async () => {
              if (hubPort !== 8000) {
                await lanPeerService.pullMasterSnapshotFromMain(hubIp, 8000, undefined, deviceToken).catch(() => {});
              }
            });
            list = await invoiceManagementService.listInvoices(criteria);
          }
        } catch (_) {}
      }

      setInvoices(list);
      setSelectedIndex(0);
    } catch (err) {
      showNotification("Failed to load invoices", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshSync = async () => {
    setIsRefreshingFromLan(true);
    try {
      const hubIp = localStorage.getItem("lamsuite_hub_ip");
      const hubPort = Number(localStorage.getItem("lamsuite_hub_port")) || 8000;
      const deviceToken = localStorage.getItem("lamsuite_device_token") || undefined;
      if (hubIp) {
        const res = await lanPeerService.pullMasterSnapshotFromMain(hubIp, hubPort, undefined, deviceToken).catch(async () => {
          return await lanPeerService.pullMasterSnapshotFromMain(hubIp, 8000, undefined, deviceToken);
        });
        showNotification(`Synced ${res.appliedCount} records from Store Hub!`, "success");
      }
      await loadInvoices();
    } catch (e: any) {
      await loadInvoices();
      showNotification("Refreshed local records.", "success");
    } finally {
      setIsRefreshingFromLan(false);
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
      store_address: "Main Road, Palakkad, Kerala - 678001",
      store_phone: "9876543210",
      store_gstin: "32ABCDE1234F1Z5",
      drug_license_numbers: ["20B/KL-PKD-1029", "21B/KL-PKD-1030"],
      fssai_no: "10020042001234",
      place_of_supply: invoice.place_of_supply || "32-Kerala",
      customer_name: invoice.customer_name || "Walk-in Customer",
      customer_phone: invoice.customer_phone || "",
      customer_gstin: invoice.customer_gstin || undefined,
      payment_mode: invoice.payment_mode || "Cash",
      payment_status: (invoice as any).payment_status || "Paid",
      lines: items.map((it) => ({
        description: it.product_name,
        hsn_code: (it as any).hsn_code || "300490",
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
      upi_vpa: "pharmacy@upi",
    };
  };

  // Print Preview Modal State
  const [previewModalState, setPreviewModalState] = useState<{
    isOpen: boolean;
    data: InvoicePrintData | null;
    initialFormat?: "a4" | "half_a4" | "thermal_80mm" | "thermal_58mm";
    title?: string;
  }>({
    isOpen: false,
    data: null,
  });

  // Actions
  const handleReprint = async (format: "a4" | "thermal" | "pdf", e?: React.MouseEvent) => {
    if (!selectedInvoice) return;
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const settings = companySettingsService.getSettings();
    const previewMode = settings.printing.previewMode || "always";
    const bypassPreview = (e && e.shiftKey) || previewMode === "never" || (previewMode === "skip_thermal" && format === "thermal");

    if (!bypassPreview) {
      setPreviewModalState({
        isOpen: true,
        data: printData,
        initialFormat: format === "a4" ? "a4" : "thermal_80mm",
        title: `Reprint Preview - #${selectedInvoice.invoice_number}`,
      });
      return;
    }

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
    if (isTauri()) {
      import("@tauri-apps/api/shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
    showNotification("WhatsApp share window opened");
  };

  const handleEmailShare = () => {
    if (!selectedInvoice) return;
    const printData = buildPrintData(selectedInvoice, selectedInvoiceItems);
    const url = generateEmailShareUrl("customer@example.com", printData);
    if (isTauri()) {
      import("@tauri-apps/api/shell").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
    } else {
      window.open(url, "_blank");
    }
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/pos")}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            title="Return to POS Billing (Esc)"
          >
            <ArrowLeft className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span>Back to POS (Esc)</span>
          </button>
          <div className="h-6 w-px bg-[var(--color-border)]" />
          <div>
            <h1 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[var(--color-accent)]" />
              <span>Invoices & Past Bills Register</span>
            </h1>
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Search, reprint, audit, edit, or cancel customer tax invoices offline.
            </p>
          </div>
        </div>

        {/* Global Search Input */}
        <div className="relative w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-faint)]" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search invoice no, customer, mobile, product..."
            className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-9 pr-3 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 shadow-2xs">
        {/* Date Range Chips */}
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider mr-1">Period:</span>
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
              className={`rounded-[8px] px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                dateRange === chip.id
                  ? "bg-[var(--color-accent)] text-white shadow-2xs"
                  : "bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Mode & Status Filters */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Payment:</span>
            <select
              value={paymentModeFilter}
              onChange={(e) => setPaymentModeFilter(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="all">All Modes</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Credit">Credit</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <span className="text-[11px] font-bold uppercase tracking-wider">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs font-medium text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="issued">Issued</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <button
            onClick={handleRefreshSync}
            disabled={isRefreshingFromLan}
            className="flex items-center gap-1.5 rounded-[8px] border border-[var(--color-border)] px-2.5 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer disabled:opacity-50"
            title="Refresh & Pull from LAN Hub"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingFromLan ? "animate-spin text-emerald-500" : ""}`} />
            <span>Sync Hub</span>
          </button>
        </div>
      </div>

      {/* Invoices List Table */}
      <div className="flex-1 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xs overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] border-b border-[var(--color-border)] z-10">
              <tr>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Invoice No</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Date & Time</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Customer</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Mobile</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-right">Net Amount</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Tender</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-center">Status</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-center">Sync</th>
                <th className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] text-center">Action</th>
              </tr>
            </thead>
            <tbody ref={tableRef} className="divide-y divide-[var(--color-border-subtle)]">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[var(--color-text-muted)]">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin text-[var(--color-accent)] mb-2" />
                    <span>Loading invoices...</span>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-[var(--color-text-muted)]">
                    <Receipt className="mx-auto h-8 w-8 text-[var(--color-text-faint)] mb-2" />
                    <p className="font-semibold text-[var(--color-text)]">No invoices found matching criteria</p>
                    <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">Try adjusting date range or clearing search query</p>
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
                          ? "bg-[var(--color-accent-soft)] ring-1 ring-inset ring-[var(--color-accent)] font-medium text-[var(--color-text)]"
                          : "hover:bg-[var(--color-surface-hover)] text-[var(--color-text)]"
                      } ${isCancelled ? "opacity-75 bg-[var(--color-danger-bg)]/20" : ""}`}
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
                          <span className="rounded-full bg-[var(--color-danger-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger-text)] border border-[var(--color-danger-border)]">
                            Cancelled
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-success-text)] border border-[var(--color-success-border)]">
                            Issued
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {inv.sync_state === "pending" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-warning-text)] border border-[var(--color-warning-border)]">
                            <Clock className="h-3 w-3" />
                            <span>Local</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-success-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success-text)] border border-[var(--color-success-border)]">
                            <CheckCircle className="h-3 w-3 text-[var(--color-accent)]" />
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
                          className="rounded-[8px] bg-[var(--color-surface-subtle)] border border-[var(--color-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-accent)] transition-colors cursor-pointer"
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
        <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-canvas)] px-4 py-2 text-[11px] text-[var(--color-text-muted)] font-medium">
          <div className="flex items-center gap-4">
            <span><kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 shadow-2xs font-mono">↑/↓</kbd> Select Invoice</span>
            <span><kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 shadow-2xs font-mono">Enter</kbd> Open Details</span>
            <span><kbd className="rounded-[6px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 shadow-2xs font-mono">Esc</kbd> Return to POS</span>
          </div>
          <div>
            <span>Total Invoices: <strong className="font-mono text-[var(--color-text)]">{invoices.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {isDetailModalOpen && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-modal overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
              <div className="flex items-center gap-3">
                <Receipt className="h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                    <span className="font-mono">Tax Invoice: {selectedInvoice.invoice_number}</span>
                    {selectedInvoice.status === "cancelled" ? (
                      <span className="rounded-full bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger-text)]">
                        Cancelled
                      </span>
                    ) : (
                      <span className="rounded-full bg-[var(--color-accent-soft)] border border-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent)]">
                        Issued
                      </span>
                    )}
                    {selectedInvoice.is_revised ? (
                      <span className="rounded-full bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-warning-text)]">
                        Revised Bill
                      </span>
                    ) : null}
                  </h3>
                  <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
                    Billed on {selectedInvoice.invoice_date} • Counter: {selectedInvoice.user_counter || "Counter 01"}
                  </p>
                </div>
              </div>

              <button
                onClick={() => setIsDetailModalOpen(false)}
                className="rounded-[6px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {/* Customer & Bill Meta */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] p-3">
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Customer Name</span>
                  <p className="font-bold text-[var(--color-text)] mt-0.5">{selectedInvoice.customer_name || "Walk-in Customer"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Mobile Number</span>
                  <p className="font-mono font-medium text-[var(--color-text)] mt-0.5">{selectedInvoice.customer_phone || "Not specified"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Payment Mode</span>
                  <p className="font-semibold text-[var(--color-accent)] mt-0.5">{selectedInvoice.payment_mode || "Cash"}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">GSTIN / Place of Supply</span>
                  <p className="font-mono text-[var(--color-text-muted)] mt-0.5">
                    {selectedInvoice.customer_gstin || "Unregistered"} ({selectedInvoice.place_of_supply || "32-Kerala"})
                  </p>
                </div>
              </div>

              {selectedInvoice.status === "cancelled" && (
                <div className="rounded-[10px] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] p-3 text-[var(--color-danger-text)]">
                  <span className="font-bold uppercase tracking-wider text-[10px]">Cancellation Reason:</span>
                  <p className="font-medium text-xs mt-0.5">{selectedInvoice.cancel_reason || "No reason specified"}</p>
                </div>
              )}

              {/* Items Table */}
              <div className="rounded-[10px] border border-[var(--color-border)] overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] border-b border-[var(--color-border)] uppercase tracking-wider text-[11px] font-bold">
                    <tr>
                      <th className="px-3 py-2">Item & Description</th>
                      <th className="px-3 py-2">Batch</th>
                      <th className="px-3 py-2">Expiry</th>
                      <th className="px-3 py-2 text-right">Qty</th>
                      <th className="px-3 py-2 text-right">Unit Rate</th>
                      <th className="px-3 py-2 text-right">GST %</th>
                      <th className="px-3 py-2 text-right">Total (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {selectedInvoiceItems.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-[var(--color-surface-hover)]">
                        <td className="px-3 py-2 font-bold text-[var(--color-text)]">{item.product_name}</td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-muted)]">{item.batch_no}</td>
                        <td className="px-3 py-2 font-mono text-[var(--color-text-muted)]">{item.expiry_date}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                          {item.qty} {item.loose_qty ? `+ ${item.loose_qty}L` : ""}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums">₹ {item.unit_price.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.gst_percent}%</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-[var(--color-text)] tabular-nums">
                          ₹ {item.total_amount.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Breakdown */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-canvas)] p-3 text-xs">
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>Taxable Subtotal:</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-[var(--color-text-muted)]">
                    <span>GST Tax Total:</span>
                    <span className="font-mono tabular-nums text-[var(--color-text)]">₹ {selectedInvoice.tax_total.toFixed(2)}</span>
                  </div>
                  {selectedInvoice.round_off !== 0 && (
                    <div className="flex justify-between text-[var(--color-text-muted)]">
                      <span>Round-Off:</span>
                      <span className="font-mono tabular-nums">
                        {selectedInvoice.round_off > 0 ? "+" : ""}
                        {selectedInvoice.round_off.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="border-t border-[var(--color-border)] pt-1 flex justify-between font-bold text-sm text-[var(--color-text)]">
                    <span>Grand Total:</span>
                    <span className="font-mono text-[var(--color-accent)] tabular-nums">₹ {selectedInvoice.grand_total.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Audit History Log */}
              {selectedInvoiceAudit.length > 0 && (
                <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                  <h4 className="font-bold text-[var(--color-text)] text-xs mb-2 uppercase tracking-wider">Audit & Revision Trail</h4>
                  <div className="space-y-1.5">
                    {selectedInvoiceAudit.map((entry, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-[11px] text-[var(--color-text-muted)]">
                        <span className="rounded-full bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 font-bold uppercase text-[9px] text-[var(--color-text)]">
                          {entry.action}
                        </span>
                        <span className="font-semibold text-[var(--color-text)]">{entry.user}</span>
                        <span className="font-mono text-[var(--color-text-muted)]">
                          ({new Date(entry.timestamp).toLocaleString()})
                        </span>
                        <span>— {entry.diffSummary || entry.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Actions Footer */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
              {/* Reprints */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleReprint("a4")}
                  className="flex items-center gap-1 rounded-[10px] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Reprint A4</span>
                </button>
                <button
                  onClick={() => handleReprint("thermal")}
                  className="flex items-center gap-1 rounded-[10px] bg-[var(--color-text)] px-3 py-1.5 text-xs font-bold text-white hover:bg-black cursor-pointer transition-colors"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Reprint Thermal</span>
                </button>
                <button
                  onClick={() => handleReprint("pdf")}
                  className="flex items-center gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Save PDF</span>
                </button>
                <button
                  onClick={handleWhatsAppShare}
                  className="flex items-center gap-1 rounded-[10px] bg-[var(--color-accent-soft)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-accent)] hover:bg-[var(--color-border)] cursor-pointer transition-colors"
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
                  className="flex items-center gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                  title="Load into POS cart as a new bill"
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Duplicate as New</span>
                </button>

                {selectedInvoice.status !== "cancelled" && (
                  <>
                    <button
                      onClick={() => {
                        setIsDetailModalOpen(false);
                        navigate(`/returns/sales?invoiceId=${selectedInvoice.id}`);
                      }}
                      className="flex items-center gap-1 rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-warning-text)] hover:bg-[var(--color-warning-bg)] cursor-pointer transition-colors"
                      title="Issue credit note / process customer return"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Return / Credit Note</span>
                    </button>
                    <button
                      onClick={handlePromptEdit}
                      className="flex items-center gap-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      <span>Edit Bill</span>
                    </button>
                    <button
                      onClick={handlePromptCancel}
                      className="flex items-center gap-1 rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-danger-text)] hover:bg-red-700 hover:text-white cursor-pointer transition-colors"
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
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="w-full max-w-sm rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-modal">
            <div className="flex items-center gap-2 text-[var(--color-warning-text)] mb-3">
              <Lock className="h-5 w-5" />
              <h3 className="font-bold text-[var(--color-text)] text-sm">Manager Authorization Required</h3>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              Editing a saved invoice requires manager verification. Please enter Manager PIN.
            </p>
            <input
              type="password"
              value={editPin}
              onChange={(e) => setEditPin(e.target.value)}
              placeholder="Enter PIN (Default: 1234)"
              autoFocus
              className="w-full rounded-[10px] border border-[var(--color-border)] px-3 py-2 text-center text-sm font-mono tracking-widest text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
            />
            {editPinError && <p className="mt-1.5 text-[11px] font-bold text-[var(--color-danger-text)]">{editPinError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setIsEditPinModalOpen(false)}
                className="rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEditPin}
                className="rounded-[10px] bg-[var(--color-accent)] px-4 py-1.5 text-xs font-bold text-white hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
              >
                Authorize & Edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Invoice Modal */}
      {isCancelModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="w-full max-w-md rounded-[14px] border border-[var(--color-danger-border)] bg-[var(--color-surface)] p-5 shadow-modal space-y-4">
            <div className="flex items-center gap-2 text-[var(--color-danger-text)]">
              <AlertCircle className="h-5 w-5" />
              <h3 className="font-bold text-[var(--color-text)] text-sm">Cancel Invoice {selectedInvoice?.invoice_number}</h3>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              Cancelling will restore all items to batch inventory, update reports, and retain this invoice number marked as <strong>Cancelled</strong>.
            </p>

            <div>
              <label className="text-xs font-bold text-[var(--color-text)]">Mandatory Cancellation Reason:</label>
              <input
                type="text"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="e.g., Customer returned items, Billing mistake..."
                className="w-full rounded-[10px] border border-[var(--color-border)] p-2 text-xs text-[var(--color-text)] focus:border-[var(--color-danger-text)] focus:outline-none mt-1 bg-[var(--color-surface)]"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-bold text-[var(--color-text)]">Manager PIN:</label>
              <input
                type="password"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                placeholder="Default: 1234"
                className="w-full rounded-[10px] border border-[var(--color-border)] p-2 text-xs font-mono tracking-widest text-[var(--color-text)] focus:border-[var(--color-danger-text)] focus:outline-none mt-1 bg-[var(--color-surface)]"
              />
            </div>

            {pinError && <p className="text-xs font-bold text-[var(--color-danger-text)]">{pinError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
              >
                Keep Invoice
              </button>
              <button
                onClick={handleConfirmCancel}
                className="rounded-[10px] bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-4 py-1.5 text-xs font-bold text-[var(--color-danger-text)] hover:bg-red-700 hover:text-white cursor-pointer transition-colors"
              >
                Confirm Cancellation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {previewModalState.isOpen && previewModalState.data && (
        <PrintPreviewModal
          isOpen={previewModalState.isOpen}
          onClose={() => setPreviewModalState({ isOpen: false, data: null })}
          docType="tax_invoice"
          title={previewModalState.title || "Print Preview - Tax Invoice"}
          data={previewModalState.data}
          initialFormat={previewModalState.initialFormat}
          customerPhone={selectedInvoice?.customer_phone}
        />
      )}
    </div>
  );
};
