import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Undo2,
  Search,
  Plus,
  XCircle,
  CheckCircle,
  AlertCircle,
  Receipt,
  RefreshCw,
  ChevronDown,
  Printer,
  Clock,
  Building2,
} from "lucide-react";
import {
  salesReturnService,
  type SalesReturnRecord,
  type SalesReturnInput,
  type SalesReturnLineInput,
  type ReturnReason,
  type ReturnCondition,
  type RefundPaymentMode,
} from "../lib/billing/salesReturnService";
import { useModalEscape } from "../lib/ui/modalEscapeManager";
import { invoiceManagementService, type InvoiceRecord, type InvoiceItemRecord } from "../lib/billing/invoiceManagementService";
import { printingEngine, type CreditNotePrintData } from "../lib/printing/printingEngine";
import { companySettingsService } from "../lib/settings/companySettingsService";
import { PrintPreviewModal } from "../components/PrintPreviewModal";

const RETURN_REASONS: { value: ReturnReason; label: string }[] = [
  { value: "customer_return", label: "Customer Return" },
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "wrong_item", label: "Wrong Item" },
  { value: "other", label: "Other" },
];

const REFUND_MODES: RefundPaymentMode[] = ["Cash", "UPI", "Card", "Credit Adjust", "Store Credit"];

interface ReturnLineState {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  sold_qty: number;
  max_returnable: number; // sold_qty - already_returned
  return_qty: number;
  unit_price: number;
  discount_percent: number;
  gst_percent: number;
  reason: ReturnReason;
  condition: ReturnCondition;
  selected: boolean;
}

export const SalesReturnPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledInvoiceId = searchParams.get("invoiceId");

  // Print Preview Modal State
  const [previewModalState, setPreviewModalState] = useState<{
    isOpen: boolean;
    data: CreditNotePrintData | null;
    title?: string;
  }>({
    isOpen: false,
    data: null,
  });

  // --- List state ---
  const [returns, setReturns] = useState<SalesReturnRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // --- Form modal state ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  useModalEscape(isFormOpen, () => setIsFormOpen(false));
  const [returnSource, setReturnSource] = useState<"counter" | "customer_debit_note">("counter");
  const [formStep, setFormStep] = useState<"invoice_search" | "line_selection" | "payment">("invoice_search");

  // Step 1: Invoice search
  const [invoiceSearchQuery, setInvoiceSearchQuery] = useState("");
  const [invoiceSearchResults, setInvoiceSearchResults] = useState<InvoiceRecord[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRecord | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItemRecord[]>([]);
  const [returnLines, setReturnLines] = useState<ReturnLineState[]>([]);
  const [returnedQtyMap, setReturnedQtyMap] = useState<Map<string, number>>(new Map());

  // Step 3: Payment
  const [refundMode, setRefundMode] = useState<RefundPaymentMode>("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const invoiceSearchRef = useRef<HTMLInputElement>(null);

  // ── Load list ────────────────────────────────────────────────────────────────
  const loadList = async () => {
    setListLoading(true);
    try {
      const all = await salesReturnService.getSalesReturns();
      setReturns(all.sort((a, b) => b.created_at - a.created_at));
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  // Auto-open form if invoiceId passed via URL
  useEffect(() => {
    if (prefilledInvoiceId) {
      openFormForInvoiceId(prefilledInvoiceId);
    }
  }, [prefilledInvoiceId]);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Open form helpers ─────────────────────────────────────────────────────────
  const openForm = () => {
    setIsFormOpen(true);
    setFormStep("invoice_search");
    setInvoiceSearchQuery("");
    setInvoiceSearchResults([]);
    setSelectedInvoice(null);
    setInvoiceItems([]);
    setReturnLines([]);
    setRefundMode("Cash");
    setNotes("");
    setTimeout(() => invoiceSearchRef.current?.focus(), 100);
  };

  const openFormForInvoiceId = async (invoiceId: string) => {
    openForm();
    try {
      const details = await invoiceManagementService.getInvoiceWithDetails(invoiceId);
      if (details?.invoice) {
        await selectInvoice(details.invoice);
      }
    } catch (e) {
      // ignore
    }
  };

  // ── Invoice search ────────────────────────────────────────────────────────────
  const handleInvoiceSearch = async (q: string) => {
    setInvoiceSearchQuery(q);
    if (q.trim().length < 2) {
      setInvoiceSearchResults([]);
      return;
    }
    const results = await invoiceManagementService.listInvoices({ searchQuery: q });
    setInvoiceSearchResults(results.filter((r) => r.status !== "cancelled").slice(0, 8));
  };

  const selectInvoice = async (inv: InvoiceRecord) => {
    setSelectedInvoice(inv);
    setInvoiceSearchResults([]);
    setInvoiceSearchQuery(inv.invoice_number);

    // Load items via getInvoiceWithDetails
    const details = await invoiceManagementService.getInvoiceWithDetails(inv.id);
    const items: InvoiceItemRecord[] = details?.items || [];
    setInvoiceItems(items);

    // Get already returned qty
    const qtyMap = await salesReturnService.getReturnedQtyMapForInvoice(inv.invoice_number);
    setReturnedQtyMap(qtyMap);

    // Build return lines
    const lines: ReturnLineState[] = items.map((item) => {
      const key = `${item.product_id}_${item.batch_no}`;
      const alreadyReturned = qtyMap.get(key) || 0;
      const maxReturnable = Math.max(0, item.qty - alreadyReturned);
      return {
        product_id: item.product_id || "",
        product_name: item.product_name,
        hsn_code: item.hsn_code,
        batch_id: (item as any).batch_id || "",
        batch_no: item.batch_no || "",
        expiry_date: item.expiry_date,
        sold_qty: item.qty,
        max_returnable: maxReturnable,
        return_qty: 0,
        unit_price: item.unit_price,
        discount_percent: item.discount_percent || 0,
        gst_percent: item.gst_percent || 0,
        reason: "customer_return",
        condition: "restock",
        selected: false,
      };
    });
    setReturnLines(lines);
    setFormStep("line_selection");
  };

  // ── Line editing ──────────────────────────────────────────────────────────────
  const toggleLine = (idx: number) => {
    setReturnLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const newSelected = !l.selected;
        return { ...l, selected: newSelected, return_qty: newSelected ? Math.min(1, l.max_returnable) : 0 };
      })
    );
  };

  const updateLineField = <K extends keyof ReturnLineState>(idx: number, field: K, value: ReturnLineState[K]) => {
    setReturnLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (field === "return_qty") {
          const qty = Math.max(0, Math.min(Number(value), l.max_returnable));
          return { ...l, return_qty: qty, selected: qty > 0 };
        }
        return { ...l, [field]: value };
      })
    );
  };

  // ── Calculations ──────────────────────────────────────────────────────────────
  const selectedLines = returnLines.filter((l) => l.selected && l.return_qty > 0);

  const calcTotals = () => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let grandTotal = 0;

    for (const l of selectedLines) {
      const gross = l.unit_price * l.return_qty;
      const disc = (gross * (l.discount_percent || 0)) / 100;
      const taxable = gross - disc;
      const gstAmt = (taxable * l.gst_percent) / 100;
      subtotal += gross;
      discountTotal += disc;
      taxTotal += gstAmt;
      grandTotal += taxable + gstAmt;
    }
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      discountTotal: Math.round(discountTotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  };

  const totals = calcTotals();

  const handlePrintCreditNote = (ret: any) => {
    const header = companySettingsService.getStorePrintHeader();
    const printData: CreditNotePrintData = {
      return_number: ret.return_number,
      return_date: ret.return_date,
      original_invoice_number: ret.original_invoice_number,
      original_invoice_date: ret.original_invoice_date,
      store_name: header.store_name,
      store_address: header.store_address,
      store_phone: header.store_phone,
      store_gstin: header.store_gstin,
      store_type: header.store_type,
      customer_name: ret.customer_name || "Walk-in Customer",
      customer_phone: ret.customer_phone,
      customer_gstin: ret.customer_gstin,
      lines: (ret.lines || []).map((l: any) => ({
        description: l.product_name,
        hsn_code: l.hsn_code,
        batch_no: l.batch_no,
        expiry_date: l.expiry_date,
        qty: l.return_qty,
        rate: l.unit_price,
        gst_percent: l.gst_percent,
        amount: l.total_amount,
        reason: l.reason,
      })),
      subtotal: ret.subtotal,
      cgst_total: ret.cgst_total,
      sgst_total: ret.sgst_total,
      tax_total: ret.tax_total,
      round_off: ret.round_off,
      grand_total: ret.grand_total,
      refund_mode: ret.refund_mode,
      notes: ret.notes,
    };

    setPreviewModalState({
      isOpen: true,
      data: printData,
      title: `Credit Note Preview - #${ret.return_number}`,
    });
  };

  // ── Save return ───────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (selectedLines.length === 0) {
      showToast("Select at least one item to return", "error");
      return;
    }
    setSaving(true);
    try {
      const lines: SalesReturnLineInput[] = selectedLines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        hsn_code: l.hsn_code,
        batch_id: l.batch_id,
        batch_no: l.batch_no,
        expiry_date: l.expiry_date,
        sold_qty: l.sold_qty,
        return_qty: l.return_qty,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent,
        gst_percent: l.gst_percent,
        reason: l.reason,
        condition: l.condition,
      }));

      const input: SalesReturnInput = {
        original_invoice_id: selectedInvoice?.id,
        original_invoice_number: selectedInvoice?.invoice_number,
        original_invoice_date: selectedInvoice?.invoice_date,
        customer_id: selectedInvoice?.customer_id,
        customer_name: selectedInvoice?.customer_name,
        customer_phone: selectedInvoice?.customer_phone,
        customer_gstin: selectedInvoice?.customer_gstin,
        lines,
        refund_mode: refundMode,
        refund_amount: totals.grandTotal,
        notes,
      };

      const result = await salesReturnService.createSalesReturn(input);
      showToast(`Credit Note ${result.returnNumber} created — ₹${result.grandTotal.toFixed(2)} refund`, "success");
      setIsFormOpen(false);
      loadList();

      // Open Print Preview Modal
      try {
        const ret = await salesReturnService.getSalesReturnById(result.returnId);
        if (ret) {
          handlePrintCreditNote(ret);
        }
      } catch (_) {
        // print failure is non-fatal
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create credit note", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filteredReturns = returns.filter((r) => {
    const q = listSearch.toLowerCase();
    const matchesSearch =
      !q ||
      r.return_number.toLowerCase().includes(q) ||
      r.customer_name?.toLowerCase().includes(q) ||
      r.original_invoice_number?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusBadge = (status: string) => {
    if (status === "completed")
      return <span className="rounded-full bg-[var(--color-accent-soft)] border border-[var(--color-accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-accent)]">Completed</span>;
    if (status === "cancelled")
      return <span className="rounded-full bg-[var(--color-danger-bg)] border border-[var(--color-danger-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-danger-text)]">Cancelled</span>;
    return <span className="rounded-full bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-warning-text)]">Draft</span>;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 font-sans">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] flex items-center gap-2 rounded-[10px] px-4 py-3 text-xs font-semibold text-white shadow-modal ${
            toast.type === "success" ? "bg-[var(--color-accent)]" : "bg-red-700"
          }`}
        >
          {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--color-text)]">
            <Undo2 className="h-5 w-5 text-[var(--color-danger-text)]" />
            <span>Sales Returns (Credit Notes)</span>
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Process customer returns, issue credit notes, manage stock restocking.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/returns/debit-notes")}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-bold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] shadow-2xs transition-colors cursor-pointer"
          >
            <Building2 className="h-4 w-4 text-[var(--color-accent)]" />
            <span>B2B Debit Notes</span>
          </button>
          <button
            onClick={openForm}
            className="flex items-center gap-2 rounded-[10px] bg-[var(--color-danger-text)] px-4 py-2 text-xs font-bold text-white shadow-2xs hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Return (F7)</span>
          </button>
        </div>
      </div>

      {/* Module Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)]">
        <button
          className="flex items-center gap-2 border-b-2 border-[var(--color-danger-text)] pb-2 px-3 text-xs font-bold text-[var(--color-danger-text)] cursor-pointer"
        >
          <Undo2 className="h-4 w-4" />
          <span>Counter Returns (Walk-in)</span>
        </button>
        <button
          onClick={() => navigate("/returns/debit-notes")}
          className="flex items-center gap-2 border-b-2 border-transparent pb-2 px-3 text-xs font-bold text-[var(--color-text-muted)] hover:text-[var(--color-text)] cursor-pointer transition-colors"
        >
          <Building2 className="h-4 w-4 text-[var(--color-accent)]" />
          <span>Customer Debit Notes (B2B Multi-Invoice)</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search return no, invoice no, customer..."
            className="w-full rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-3 py-2 text-xs text-[var(--color-text)] placeholder-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* List */}
      <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xs overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3 bg-[var(--color-canvas)]">
          <h3 className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wider">Credit Note Register</h3>
          <span className="text-[11px] text-[var(--color-text-muted)] font-mono">{filteredReturns.length} Records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-2.5">Return No</th>
                <th className="px-4 py-2.5">Date</th>
                <th className="px-4 py-2.5">Original Invoice</th>
                <th className="px-4 py-2.5">Customer</th>
                <th className="px-4 py-2.5 text-right">Refund Amt</th>
                <th className="px-4 py-2.5">Refund Mode</th>
                <th className="px-4 py-2.5 text-center">Status</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {listLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-[var(--color-text-muted)]">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin text-[var(--color-text-muted)] mb-1" />
                    <span>Loading...</span>
                  </td>
                </tr>
              ) : filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[var(--color-text-muted)]">
                    <Undo2 className="mx-auto h-8 w-8 text-[var(--color-text-muted)] opacity-40 mb-1" />
                    <p className="font-semibold text-xs text-[var(--color-text)]">No sales returns yet</p>
                    <p className="text-[11px] text-[var(--color-text-muted)]">Click "New Return" to process a customer return</p>
                  </td>
                </tr>
              ) : (
                filteredReturns.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                    <td className="px-4 py-2.5 font-mono font-bold text-[var(--color-danger-text)]">{r.return_number}</td>
                    <td className="px-4 py-2.5 font-mono text-[var(--color-text-muted)]">{r.return_date}</td>
                    <td className="px-4 py-2.5 font-mono text-[var(--color-accent)]">{r.original_invoice_number || "—"}</td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--color-text)]">{r.customer_name || "Walk-in"}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-bold text-[var(--color-text)] tabular-nums">
                      ₹ {r.grand_total.toFixed(2)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-[var(--color-canvas)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-text)]">{r.refund_mode}</span>
                    </td>
                    <td className="px-4 py-2.5 text-center">{statusBadge(r.status)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handlePrintCreditNote(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[var(--color-text)] hover:text-[var(--color-accent)] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[8px] hover:bg-[var(--color-surface-hover)] shadow-2xs transition cursor-pointer"
                        title="Print Credit Note"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New Return Form Modal ──────────────────────────────────────────────── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-modal overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
              <div className="flex items-center gap-3">
                <Undo2 className="h-5 w-5 text-[var(--color-danger-text)]" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-text)]">New Sales Return / Credit Note</h3>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {formStep === "invoice_search"
                      ? "Step 1: Search and select the original invoice"
                      : formStep === "line_selection"
                      ? "Step 2: Select items and quantities to return"
                      : "Step 3: Choose refund method and confirm"}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsFormOpen(false)} className="rounded-[6px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Step progress */}
            <div className="flex items-center gap-0 border-b border-[var(--color-border)] bg-[var(--color-canvas)] px-5 py-2">
              {["Invoice", "Items", "Payment"].map((step, idx) => {
                const stepKeys = ["invoice_search", "line_selection", "payment"];
                const isActive = stepKeys[idx] === formStep;
                const isPast = stepKeys.indexOf(formStep) > idx;
                return (
                  <React.Fragment key={step}>
                    <div
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                        isActive
                          ? "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]"
                          : isPast
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      <span className={`h-4 w-4 rounded-full text-center text-[10px] leading-4 font-bold ${isActive ? "bg-[var(--color-danger-text)] text-white" : isPast ? "bg-[var(--color-accent)] text-white" : "bg-[var(--color-border)] text-[var(--color-text-muted)]"}`}>
                        {idx + 1}
                      </span>
                      {step}
                    </div>
                    {idx < 2 && <ChevronDown className="h-3 w-3 -rotate-90 text-[var(--color-border)] mx-1" />}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* ── Step 1: Invoice Search & Return Source ───────────────────── */}
              {formStep === "invoice_search" && (
                <div className="space-y-4">
                  {/* Return Source Selection (Requirement #1) */}
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      Return Source *
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <div
                        onClick={() => setReturnSource("counter")}
                        className={`cursor-pointer rounded-xl border p-3 transition-all ${
                          returnSource === "counter"
                            ? "border-rose-500 bg-rose-50/70 shadow-xs"
                            : "border-slate-200 bg-white hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Undo2 className="h-4 w-4 text-rose-600" />
                          <span className="text-xs font-bold text-slate-800">Counter Return</span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Walk-in customer returns goods against a specific sales bill.
                        </p>
                      </div>

                      <div
                        onClick={() => {
                          setReturnSource("customer_debit_note");
                          setIsFormOpen(false);
                          navigate("/returns/debit-notes");
                        }}
                        className={`cursor-pointer rounded-card border p-3 transition-all ${
                          returnSource === "customer_debit_note"
                            ? "border-accent bg-accent-soft shadow-xs"
                            : "border-border-main bg-surface hover:bg-canvas"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-accent" />
                          <span className="text-xs font-bold text-text-main">Customer Debit Note (B2B)</span>
                        </div>
                        <p className="mt-1 text-[11px] text-text-muted">
                          Customer sent a debit note covering products across 1 or more invoices.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="relative">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Search Original Invoice by Number, Customer Name, or Mobile
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        ref={invoiceSearchRef}
                        type="text"
                        value={invoiceSearchQuery}
                        onChange={(e) => handleInvoiceSearch(e.target.value)}
                        placeholder="e.g. INV-001, Ravi Kumar, 9876543210..."
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-rose-400 focus:bg-white focus:outline-none"
                      />
                    </div>
                    {invoiceSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                        {invoiceSearchResults.map((inv) => (
                          <button
                            key={inv.id}
                            onClick={() => selectInvoice(inv)}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs hover:bg-rose-50"
                          >
                            <div>
                              <span className="font-mono font-bold text-blue-700">{inv.invoice_number}</span>
                              <span className="mx-2 text-slate-300">•</span>
                              <span className="font-medium text-slate-800">{inv.customer_name || "Walk-in"}</span>
                              {inv.customer_phone && (
                                <span className="ml-2 text-slate-500">{inv.customer_phone}</span>
                              )}
                            </div>
                            <div className="text-right">
                              <div className="font-mono font-bold text-slate-900">₹ {inv.grand_total.toFixed(2)}</div>
                              <div className="text-[10px] text-slate-400">{inv.invoice_date}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                    <Receipt className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="font-medium">Search for an invoice above to load its items</p>
                    <p className="text-[11px] mt-0.5">Type at least 2 characters to search</p>
                  </div>
                </div>
              )}

              {/* ── Step 2: Line Selection ────────────────────────────────────── */}
              {formStep === "line_selection" && selectedInvoice && (
                <div className="space-y-4">
                  {/* Invoice summary */}
                  <div className="grid grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Invoice</p>
                      <p className="font-mono font-bold text-blue-700">{selectedInvoice.invoice_number}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Date</p>
                      <p className="font-medium text-slate-800">{selectedInvoice.invoice_date}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Customer</p>
                      <p className="font-medium text-slate-800">{selectedInvoice.customer_name || "Walk-in"}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Invoice Total</p>
                      <p className="font-mono font-bold text-slate-900">₹ {selectedInvoice.grand_total.toFixed(2)}</p>
                    </div>
                  </div>

                  {/* Select All / deselect */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Select items to return:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setReturnLines((prev) =>
                            prev.map((l) =>
                              l.max_returnable > 0
                                ? { ...l, selected: true, return_qty: l.max_returnable }
                                : l
                            )
                          )
                        }
                        className="text-[11px] font-semibold text-rose-600 hover:underline"
                      >
                        Select All
                      </button>
                      <span className="text-slate-300">|</span>
                      <button
                        onClick={() => setReturnLines((prev) => prev.map((l) => ({ ...l, selected: false, return_qty: 0 })))}
                        className="text-[11px] font-semibold text-slate-500 hover:underline"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Items table */}
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="border-b border-slate-200 bg-slate-100 text-slate-600">
                        <tr>
                          <th className="px-3 py-2 text-left w-6"></th>
                          <th className="px-3 py-2 text-left">Product</th>
                          <th className="px-3 py-2 text-center">Batch / Exp</th>
                          <th className="px-3 py-2 text-center">Sold Qty</th>
                          <th className="px-3 py-2 text-center">Max Return</th>
                          <th className="px-3 py-2 text-center">Return Qty</th>
                          <th className="px-3 py-2 text-left">Reason</th>
                          <th className="px-3 py-2 text-left">Condition</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {returnLines.map((line, idx) => (
                          <tr
                            key={idx}
                            className={`transition-colors ${
                              line.max_returnable === 0
                                ? "opacity-40 bg-slate-50"
                                : line.selected
                                ? "bg-rose-50"
                                : "hover:bg-slate-50"
                            }`}
                          >
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={line.selected}
                                disabled={line.max_returnable === 0}
                                onChange={() => toggleLine(idx)}
                                className="accent-rose-600"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{line.product_name}</div>
                              {line.hsn_code && (
                                <div className="text-[10px] text-slate-400">HSN: {line.hsn_code}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center font-mono text-slate-700">
                              <div>{line.batch_no || "—"}</div>
                              {line.expiry_date && (
                                <div className="text-[10px] text-slate-400">Exp: {line.expiry_date}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center font-mono">{line.sold_qty}</td>
                            <td className="px-3 py-2 text-center">
                              {line.max_returnable === 0 ? (
                                <span className="text-[10px] text-slate-400">Fully Returned</span>
                              ) : (
                                <span className="font-mono font-bold text-slate-800">{line.max_returnable}</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number"
                                min={0}
                                max={line.max_returnable}
                                value={line.return_qty}
                                disabled={line.max_returnable === 0}
                                onChange={(e) => updateLineField(idx, "return_qty", Number(e.target.value) as any)}
                                className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs font-mono focus:border-rose-400 focus:outline-none disabled:bg-slate-100"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={line.reason}
                                disabled={!line.selected}
                                onChange={(e) => updateLineField(idx, "reason", e.target.value as ReturnReason)}
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none disabled:bg-slate-100"
                              >
                                {RETURN_REASONS.map((r) => (
                                  <option key={r.value} value={r.value}>
                                    {r.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={line.condition}
                                disabled={!line.selected}
                                onChange={(e) => updateLineField(idx, "condition", e.target.value as ReturnCondition)}
                                className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none disabled:bg-slate-100"
                              >
                                <option value="restock">Restock to Inventory</option>
                                <option value="quarantine">Quarantine Shelf (Hold)</option>
                                <option value="damaged_discard">Damaged / Discard</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Running totals */}
                  {selectedLines.length > 0 && (
                    <div className="flex justify-end">
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs min-w-[220px]">
                        <div className="flex justify-between text-slate-600">
                          <span>Gross Return:</span>
                          <span className="font-mono">₹ {totals.subtotal.toFixed(2)}</span>
                        </div>
                        {totals.discountTotal > 0 && (
                          <div className="flex justify-between text-slate-500">
                            <span>Discount:</span>
                            <span className="font-mono">- ₹ {totals.discountTotal.toFixed(2)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-slate-600">
                          <span>GST Reversal:</span>
                          <span className="font-mono">₹ {totals.taxTotal.toFixed(2)}</span>
                        </div>
                        <div className="mt-1 flex justify-between border-t border-rose-200 pt-1 font-bold text-rose-700">
                          <span>Credit Amount:</span>
                          <span className="font-mono">₹ {totals.grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 3: Payment ───────────────────────────────────────────── */}
              {formStep === "payment" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Refund summary */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                      <h4 className="mb-2 font-bold text-slate-700">Return Summary</h4>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-slate-600">
                          <span>Items Returning:</span>
                          <span className="font-bold">{selectedLines.length}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Original Invoice:</span>
                          <span className="font-mono font-bold text-blue-700">{selectedInvoice?.invoice_number}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-1.5 text-rose-700 font-bold">
                          <span>Credit / Refund Amount:</span>
                          <span className="font-mono">₹ {totals.grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Refund mode */}
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Refund Mode</label>
                        <div className="grid grid-cols-1 gap-1.5">
                          {REFUND_MODES.map((mode) => (
                            <button
                              key={mode}
                              onClick={() => setRefundMode(mode)}
                              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold text-left transition-colors ${
                                refundMode === mode
                                  ? "border-rose-500 bg-rose-50 text-rose-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                              }`}
                            >
                              <div
                                className={`h-3 w-3 rounded-full border-2 ${
                                  refundMode === mode ? "border-rose-600 bg-rose-600" : "border-slate-300"
                                }`}
                              />
                              {mode}
                              {mode === "Credit Adjust" && (
                                <span className="text-[10px] text-slate-400 ml-auto">Adjust against outstanding</span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Notes (optional)</label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          placeholder="Return reason summary, manager approval, etc..."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-rose-400 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                onClick={() => {
                  if (formStep === "invoice_search") setIsFormOpen(false);
                  else if (formStep === "line_selection") setFormStep("invoice_search");
                  else if (formStep === "payment") setFormStep("line_selection");
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {formStep === "invoice_search" ? "Cancel" : "Back"}
              </button>

              <div className="flex items-center gap-2">
                {formStep === "line_selection" && (
                  <span className="text-xs text-slate-500">
                    {selectedLines.length} item(s) selected • ₹ {totals.grandTotal.toFixed(2)} credit
                  </span>
                )}
                {formStep === "line_selection" ? (
                  <button
                    onClick={() => {
                      if (selectedLines.length === 0) {
                        showToast("Select at least one item to return", "error");
                        return;
                      }
                      setFormStep("payment");
                    }}
                    className="flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-xs font-bold text-white hover:bg-rose-700"
                  >
                    Next: Payment →
                  </button>
                ) : formStep === "payment" ? (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-rose-600 px-5 py-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60"
                  >
                    {saving ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Printer className="h-4 w-4" />
                        Save & Print Credit Note
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal for Credit Notes */}
      {previewModalState.isOpen && previewModalState.data && (
        <PrintPreviewModal
          isOpen={previewModalState.isOpen}
          onClose={() => setPreviewModalState({ isOpen: false, data: null })}
          docType="credit_note"
          title={previewModalState.title || "Credit Note Preview"}
          data={previewModalState.data}
          initialFormat="a4"
          customerPhone={previewModalState.data.customer_phone}
        />
      )}
    </div>
  );
};
