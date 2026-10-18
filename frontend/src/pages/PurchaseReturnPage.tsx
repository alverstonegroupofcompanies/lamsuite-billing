import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpFromLine,
  Search,
  Plus,
  XCircle,
  CheckCircle,
  AlertCircle,
  Truck,
  RefreshCw,
  ChevronDown,
  Printer,
} from "lucide-react";
import {
  purchaseReturnService,
  type PurchaseReturnRecord,
  type PurchaseReturnInput,
  type PurchaseReturnLineInput,
  type PurchaseReturnReason,
  type PurchaseReturnSettlement,
} from "../lib/purchases/purchaseReturnService";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { printingEngine, type DebitNotePrintData } from "../lib/printing/printingEngine";
import { PrintPreviewModal } from "../components/PrintPreviewModal";
import { useModalEscape } from "../lib/ui/modalEscapeManager";

const RETURN_REASONS: { value: PurchaseReturnReason; label: string }[] = [
  { value: "expired", label: "Expired" },
  { value: "damaged", label: "Damaged" },
  { value: "near_expiry", label: "Near Expiry" },
  { value: "wrong_supply", label: "Wrong Supply" },
  { value: "excess", label: "Excess Stock" },
  { value: "other", label: "Other" },
];

interface PurchaseDoc {
  id: string;
  purchase_number: string;
  supplier_id?: string;
  supplier_name: string;
  supplier_gstin?: string;
  supplier_invoice_no?: string;
  purchase_date: string;
  grand_total?: number;
  subtotal?: number;
  tax_total?: number;
  lines?: any[];
}

interface ReturnLineState {
  product_id: string;
  product_name: string;
  hsn_code?: string;
  batch_id: string;
  batch_no: string;
  expiry_date?: string;
  purchased_qty: number;
  purchase_rate: number;
  gst_percent: number;
  reason: PurchaseReturnReason;
  return_qty: number;
  selected: boolean;
}

export const PurchaseReturnPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const prefilledPurchaseId = searchParams.get("purchaseId");

  // --- List state ---
  const [returns, setReturns] = useState<PurchaseReturnRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // --- Form state ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  useModalEscape(isFormOpen, () => setIsFormOpen(false));
  const [formStep, setFormStep] = useState<"purchase_search" | "line_selection" | "settlement">("purchase_search");

  // Step 1
  const [purchaseSearchQuery, setPurchaseSearchQuery] = useState("");
  const [purchaseSearchResults, setPurchaseSearchResults] = useState<PurchaseDoc[]>([]);
  const [allPurchases, setAllPurchases] = useState<PurchaseDoc[]>([]);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseDoc | null>(null);
  const [returnLines, setReturnLines] = useState<ReturnLineState[]>([]);

  // Step 3
  const [settlementType, setSettlementType] = useState<PurchaseReturnSettlement>("credit_adjust");
  const [refundMode, setRefundMode] = useState<"Cash" | "Bank Transfer" | "UPI">("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Print Preview Modal State
  const [previewModalState, setPreviewModalState] = useState<{
    isOpen: boolean;
    data: DebitNotePrintData | null;
    title?: string;
  }>({
    isOpen: false,
    data: null,
  });

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // ── Load data ─────────────────────────────────────────────────────────────────
  const loadList = async () => {
    setListLoading(true);
    try {
      const all = await purchaseReturnService.getPurchaseReturns();
      setReturns(all.sort((a, b) => b.created_at - a.created_at));
    } finally {
      setListLoading(false);
    }
  };

  const loadPurchases = async () => {
    const docs = await sqliteStorage.findAll<PurchaseDoc>("purchase_documents");
    setAllPurchases(docs);
  };

  useEffect(() => {
    loadList();
    loadPurchases();
  }, []);

  // Auto-open form if purchaseId passed via URL
  useEffect(() => {
    if (prefilledPurchaseId) {
      openFormForPurchaseId(prefilledPurchaseId);
    }
  }, [prefilledPurchaseId]);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Form helpers ──────────────────────────────────────────────────────────────
  const openForm = () => {
    setIsFormOpen(true);
    setFormStep("purchase_search");
    setPurchaseSearchQuery("");
    setPurchaseSearchResults([]);
    setSelectedPurchase(null);
    setReturnLines([]);
    setSettlementType("credit_adjust");
    setNotes("");
    setTimeout(() => searchRef.current?.focus(), 100);
  };

  const openFormForPurchaseId = async (purchaseId: string) => {
    openForm();
    const docs = await sqliteStorage.findAll<PurchaseDoc>("purchase_documents");
    const found = docs.find((d) => d.id === purchaseId);
    if (found) {
      await selectPurchase(found);
    }
  };

  // ── Purchase search ───────────────────────────────────────────────────────────
  const handlePurchaseSearch = (q: string) => {
    setPurchaseSearchQuery(q);
    if (q.trim().length < 2) {
      setPurchaseSearchResults([]);
      return;
    }
    const ql = q.toLowerCase();
    const results = allPurchases
      .filter(
        (p) =>
          p.purchase_number?.toLowerCase().includes(ql) ||
          p.supplier_name?.toLowerCase().includes(ql) ||
          p.supplier_invoice_no?.toLowerCase().includes(ql)
      )
      .slice(0, 8);
    setPurchaseSearchResults(results);
  };

  const selectPurchase = async (purchase: PurchaseDoc) => {
    setSelectedPurchase(purchase);
    setPurchaseSearchResults([]);
    setPurchaseSearchQuery(purchase.purchase_number);

    // Build return lines from purchase lines
    const lines: ReturnLineState[] = (purchase.lines || []).map((item: any, i: number) => ({
      product_id: item.product_id || `prod_${i}`,
      product_name: item.product_name || item.name || "Unknown",
      hsn_code: item.hsn_code,
      batch_id: item.batch_id || "",
      batch_no: item.batch_no || "",
      expiry_date: item.expiry_date,
      purchased_qty: item.qty || item.quantity || 0,
      purchase_rate: item.purchase_rate || item.rate || 0,
      gst_percent: item.gst_percent || item.gst || 12,
      reason: "expired",
      return_qty: 0,
      selected: false,
    }));
    setReturnLines(lines);
    setFormStep("line_selection");
  };

  // ── Line editing ──────────────────────────────────────────────────────────────
  const toggleLine = (idx: number) => {
    setReturnLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const newSelected = !l.selected;
        return { ...l, selected: newSelected, return_qty: newSelected ? 1 : 0 };
      })
    );
  };

  const updateLineField = <K extends keyof ReturnLineState>(idx: number, field: K, value: ReturnLineState[K]) => {
    setReturnLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        if (field === "return_qty") {
          const qty = Math.max(0, Math.min(Number(value), l.purchased_qty));
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
    let taxTotal = 0;
    let grandTotal = 0;
    for (const l of selectedLines) {
      const taxable = l.purchase_rate * l.return_qty;
      const gstAmt = (taxable * l.gst_percent) / 100;
      subtotal += taxable;
      taxTotal += gstAmt;
      grandTotal += taxable + gstAmt;
    }
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      taxTotal: Math.round(taxTotal * 100) / 100,
      grandTotal: Math.round(grandTotal * 100) / 100,
    };
  };

  const totals = calcTotals();

  const handlePrintDebitNote = (ret: any) => {
    const printData: DebitNotePrintData = {
      return_number: ret.return_number,
      return_date: ret.return_date,
      original_purchase_number: ret.original_purchase_number,
      supplier_invoice_no: ret.supplier_invoice_no,
      store_name: "LamStone Pharmacy & Retail",
      store_address: "Main Road, Palakkad, Kerala - 678001",
      store_phone: "9876543210",
      store_gstin: "32AAAAA0000A1Z5",
      supplier_name: ret.supplier_name,
      supplier_gstin: ret.supplier_gstin,
      lines: (ret.lines || []).map((l: any) => ({
        description: l.product_name,
        hsn_code: l.hsn_code,
        batch_no: l.batch_no,
        expiry_date: l.expiry_date,
        qty: l.return_qty,
        rate: l.purchase_rate,
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
      settlement_type: ret.settlement_type,
      notes: ret.notes,
    };

    setPreviewModalState({
      isOpen: true,
      data: printData,
      title: `Debit Note Preview - #${ret.return_number}`,
    });
  };

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (selectedLines.length === 0) {
      showToast("Select at least one item to return", "error");
      return;
    }
    if (!selectedPurchase) return;

    setSaving(true);
    try {
      const lines: PurchaseReturnLineInput[] = selectedLines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        hsn_code: l.hsn_code,
        batch_id: l.batch_id,
        batch_no: l.batch_no,
        expiry_date: l.expiry_date,
        purchased_qty: l.purchased_qty,
        return_qty: l.return_qty,
        purchase_rate: l.purchase_rate,
        gst_percent: l.gst_percent,
        reason: l.reason,
      }));

      const input: PurchaseReturnInput = {
        original_purchase_id: selectedPurchase.id,
        original_purchase_number: selectedPurchase.purchase_number,
        supplier_id: selectedPurchase.supplier_id || `sup_${Date.now()}`,
        supplier_name: selectedPurchase.supplier_name,
        supplier_gstin: selectedPurchase.supplier_gstin,
        supplier_invoice_no: selectedPurchase.supplier_invoice_no,
        lines,
        settlement_type: settlementType,
        refund_mode: settlementType === "refund" ? refundMode : undefined,
        notes,
      };

      const result = await purchaseReturnService.createPurchaseReturn(input);
      showToast(`Debit Note ${result.returnNumber} created — ₹${result.grandTotal.toFixed(2)} debit`, "success");
      setIsFormOpen(false);
      loadList();

      // Open Print Preview Modal
      try {
        const ret = await purchaseReturnService.getPurchaseReturnById(result.returnId);
        if (ret) {
          handlePrintDebitNote(ret);
        }
      } catch (_) {
        // print is non-fatal
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create debit note", "error");
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
      r.supplier_name?.toLowerCase().includes(q) ||
      r.original_purchase_number?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statusBadge = (status: string) => {
    if (status === "completed")
      return <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[10px] font-semibold text-accent">Completed</span>;
    if (status === "cancelled")
      return <span className="rounded-full bg-status-danger/10 text-status-danger px-2.5 py-0.5 text-[10px] font-semibold">Cancelled</span>;
    return <span className="rounded-full bg-status-warning/15 px-2.5 py-0.5 text-[10px] font-semibold text-status-warning">Draft</span>;
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4 font-sans">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] flex items-center gap-2 rounded-btn px-4 py-3 text-xs font-semibold shadow-modal transition-all ${
            toast.type === "success"
              ? "bg-accent-soft text-accent border border-accent/20"
              : "bg-status-danger/10 text-status-danger border border-status-danger/20"
          }`}
        >
          {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-[26px] font-bold text-text-main tracking-tight">
            <ArrowUpFromLine className="h-5 w-5 text-accent" />
            Purchase Returns (Debit Notes)
          </h2>
          <p className="text-xs text-text-muted mt-0.5">Return stock to supplier, issue debit notes, reverse input GST.</p>
        </div>
        <button
          onClick={openForm}
          className="flex items-center gap-2 rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-accent/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Purchase Return
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search return no, purchase no, supplier..."
            className="w-full rounded-btn border border-border-main bg-surface pl-8 pr-3 py-2 text-xs text-text-main placeholder-text-muted/60 focus:border-accent focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-btn border border-border-main bg-surface px-3 py-2 text-xs font-medium text-text-main focus:border-accent focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {/* List */}
      <div className="rounded-card border border-border-main bg-surface shadow-xs overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-main px-4 py-3 bg-canvas">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Debit Note Register</h3>
          <span className="text-[11px] text-text-muted font-mono tabular-nums">{filteredReturns.length} Records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border-main bg-canvas text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              <tr>
                <th className="px-4 py-3">Return No</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Purchase Bill</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3 text-right">Debit Amt</th>
                <th className="px-4 py-3">Settlement</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-main">
              {listLoading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-text-muted">
                    <RefreshCw className="mx-auto h-6 w-6 animate-spin text-accent mb-1" />
                    Loading...
                  </td>
                </tr>
              ) : filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-text-muted">
                    <ArrowUpFromLine className="mx-auto h-8 w-8 text-text-muted/40 mb-1" />
                    <p className="font-semibold text-text-main">No purchase returns yet</p>
                    <p className="text-[11px] text-text-muted">Click "New Purchase Return" to return stock to supplier</p>
                  </td>
                </tr>
              ) : (
                filteredReturns.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-accent tabular-nums">{r.return_number}</td>
                    <td className="px-4 py-3 text-text-muted font-mono tabular-nums">{r.return_date}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-accent tabular-nums">{r.original_purchase_number || "—"}</td>
                    <td className="px-4 py-3 font-semibold text-text-main">{r.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-text-main tabular-nums">
                      ₹ {r.grand_total.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      <span className="rounded-full bg-canvas border border-border-main px-2.5 py-0.5 text-[10px] font-medium text-text-muted">
                        {r.settlement_type === "credit_adjust" ? "Credit Adjust" : `Refund (${r.refund_mode || ""})`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">{statusBadge(r.status)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handlePrintDebitNote(r)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-orange-700 hover:text-white bg-orange-50 hover:bg-orange-600 border border-orange-200 rounded-lg transition"
                        title="Print Debit Note"
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

      {/* ── New Purchase Return Modal ─────────────────────────────────────────── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 font-sans">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-modal overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-3">
              <div className="flex items-center gap-3">
                <ArrowUpFromLine className="h-5 w-5 text-[var(--color-accent)]" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--color-text)]">New Purchase Return / Debit Note</h3>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    {formStep === "purchase_search"
                      ? "Step 1: Select the original purchase bill"
                      : formStep === "line_selection"
                      ? "Step 2: Select items and quantities to return"
                      : "Step 3: Choose settlement method"}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsFormOpen(false)} className="rounded-[6px] p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] cursor-pointer">
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Steps */}
            <div className="flex items-center gap-0 border-b border-[var(--color-border)] bg-[var(--color-canvas)] px-5 py-2">
              {["Purchase", "Items", "Settlement"].map((step, idx) => {
                const stepKeys = ["purchase_search", "line_selection", "settlement"];
                const isActive = stepKeys[idx] === formStep;
                const isPast = stepKeys.indexOf(formStep) > idx;
                return (
                  <React.Fragment key={step}>
                    <div
                      className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                        isActive
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                          : isPast
                          ? "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]"
                          : "text-[var(--color-text-muted)]"
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full text-center text-[10px] leading-4 font-bold ${
                          isActive ? "bg-[var(--color-accent)] text-white" : isPast ? "bg-[var(--color-text)] text-white" : "bg-[var(--color-border)] text-[var(--color-text-muted)]"
                        }`}
                      >
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
              {/* Step 1 */}
              {formStep === "purchase_search" && (
                <div className="space-y-4">
                  <div className="relative">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Search Purchase Bill by Bill No, Supplier Name, or Supplier Invoice No
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        ref={searchRef}
                        type="text"
                        value={purchaseSearchQuery}
                        onChange={(e) => handlePurchaseSearch(e.target.value)}
                        placeholder="e.g. PB-123456, Apex Pharma, SUP-INV-001..."
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs text-slate-800 focus:border-orange-400 focus:bg-white focus:outline-none"
                      />
                    </div>
                    {purchaseSearchResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
                        {purchaseSearchResults.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => selectPurchase(p)}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs hover:bg-orange-50"
                          >
                            <div>
                              <span className="font-mono font-bold text-blue-700">{p.purchase_number}</span>
                              <span className="mx-2 text-slate-300">•</span>
                              <span className="font-medium text-slate-800">{p.supplier_name}</span>
                              {p.supplier_invoice_no && (
                                <span className="ml-2 text-slate-500">({p.supplier_invoice_no})</span>
                              )}
                            </div>
                            <div className="text-right">
                              {p.grand_total != null && (
                                <div className="font-mono font-bold text-slate-900">₹ {p.grand_total.toFixed(2)}</div>
                              )}
                              <div className="text-[10px] text-slate-400">{p.purchase_date}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-xs text-slate-500">
                    <Truck className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                    <p className="font-medium">Search for a purchase bill to load its items</p>
                    <p className="text-[11px] mt-0.5">Type at least 2 characters to search</p>
                  </div>
                </div>
              )}

              {/* Step 2 */}
              {formStep === "line_selection" && selectedPurchase && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Purchase Bill</p>
                      <p className="font-mono font-bold text-blue-700">{selectedPurchase.purchase_number}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Date</p>
                      <p className="font-medium text-slate-800">{selectedPurchase.purchase_date}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Supplier</p>
                      <p className="font-medium text-slate-800">{selectedPurchase.supplier_name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase text-slate-400">Supplier Inv #</p>
                      <p className="font-mono text-slate-700">{selectedPurchase.supplier_invoice_no || "—"}</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">Select items to return to supplier:</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          setReturnLines((prev) =>
                            prev.map((l) => ({ ...l, selected: true, return_qty: l.purchased_qty }))
                          )
                        }
                        className="text-[11px] font-semibold text-orange-600 hover:underline"
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

                  {returnLines.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400">
                      This purchase bill has no line items recorded.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-xs">
                        <thead className="border-b border-slate-200 bg-slate-100 text-slate-600">
                          <tr>
                            <th className="px-3 py-2 w-6"></th>
                            <th className="px-3 py-2 text-left">Product</th>
                            <th className="px-3 py-2 text-center">Batch / Exp</th>
                            <th className="px-3 py-2 text-center">Purchased</th>
                            <th className="px-3 py-2 text-center">Return Qty</th>
                            <th className="px-3 py-2 text-right">Rate</th>
                            <th className="px-3 py-2 text-left">Reason</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {returnLines.map((line, idx) => (
                            <tr
                              key={idx}
                              className={`transition-colors ${
                                line.selected ? "bg-orange-50" : "hover:bg-slate-50"
                              }`}
                            >
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={line.selected}
                                  onChange={() => toggleLine(idx)}
                                  className="accent-orange-600"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-800">{line.product_name}</div>
                              </td>
                              <td className="px-3 py-2 text-center font-mono text-slate-700">
                                <div>{line.batch_no || "—"}</div>
                                {line.expiry_date && (
                                  <div className="text-[10px] text-slate-400">Exp: {line.expiry_date}</div>
                                )}
                              </td>
                              <td className="px-3 py-2 text-center font-mono">{line.purchased_qty}</td>
                              <td className="px-3 py-2 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={line.purchased_qty}
                                  value={line.return_qty}
                                  onChange={(e) => updateLineField(idx, "return_qty", Number(e.target.value) as any)}
                                  className="w-16 rounded border border-slate-200 px-2 py-1 text-center text-xs font-mono focus:border-orange-400 focus:outline-none"
                                />
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-slate-700">
                                ₹ {line.purchase_rate.toFixed(2)}
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={line.reason}
                                  disabled={!line.selected}
                                  onChange={(e) => updateLineField(idx, "reason", e.target.value as PurchaseReturnReason)}
                                  className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:outline-none disabled:bg-slate-100"
                                >
                                  {RETURN_REASONS.map((r) => (
                                    <option key={r.value} value={r.value}>
                                      {r.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {selectedLines.length > 0 && (
                    <div className="flex justify-end">
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs min-w-[220px]">
                        <div className="flex justify-between text-slate-600">
                          <span>Taxable Amount:</span>
                          <span className="font-mono">₹ {totals.subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>GST Reversal:</span>
                          <span className="font-mono">₹ {totals.taxTotal.toFixed(2)}</span>
                        </div>
                        <div className="mt-1 flex justify-between border-t border-orange-200 pt-1 font-bold text-orange-700">
                          <span>Debit Note Amount:</span>
                          <span className="font-mono">₹ {totals.grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3 */}
              {formStep === "settlement" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                      <h4 className="mb-2 font-bold text-slate-700">Return Summary</h4>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-slate-600">
                          <span>Items Returning:</span>
                          <span className="font-bold">{selectedLines.length}</span>
                        </div>
                        <div className="flex justify-between text-slate-600">
                          <span>Supplier:</span>
                          <span className="font-bold text-slate-800">{selectedPurchase?.supplier_name}</span>
                        </div>
                        <div className="flex justify-between border-t border-slate-200 pt-1.5 text-orange-700 font-bold">
                          <span>Debit Note Amount:</span>
                          <span className="font-mono">₹ {totals.grandTotal.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Settlement Method</label>
                        <div className="space-y-1.5">
                          {[
                            { value: "credit_adjust" as const, label: "Adjust Against Payable", desc: "Reduce supplier outstanding" },
                            { value: "refund" as const, label: "Refund from Supplier", desc: "Receive cash / bank transfer" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => setSettlementType(opt.value)}
                              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                                settlementType === opt.value
                                  ? "border-orange-500 bg-orange-50 text-orange-700"
                                  : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                              }`}
                            >
                              <div
                                className={`mt-0.5 h-3 w-3 flex-shrink-0 rounded-full border-2 ${
                                  settlementType === opt.value ? "border-orange-600 bg-orange-600" : "border-slate-300"
                                }`}
                              />
                              <div>
                                <div>{opt.label}</div>
                                <div className="text-[10px] font-normal text-slate-500">{opt.desc}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {settlementType === "refund" && (
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">Refund Method</label>
                          <select
                            value={refundMode}
                            onChange={(e) => setRefundMode(e.target.value as any)}
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-orange-400 focus:outline-none"
                          >
                            <option value="Cash">Cash</option>
                            <option value="Bank Transfer">Bank Transfer</option>
                            <option value="UPI">UPI</option>
                          </select>
                        </div>
                      )}

                      <div>
                        <label className="mb-1 block text-xs font-semibold text-slate-700">Notes (optional)</label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={2}
                          placeholder="Return reason summary, batch details, manager approval..."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs placeholder-slate-400 focus:border-orange-400 focus:outline-none"
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
                  if (formStep === "purchase_search") setIsFormOpen(false);
                  else if (formStep === "line_selection") setFormStep("purchase_search");
                  else if (formStep === "settlement") setFormStep("line_selection");
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {formStep === "purchase_search" ? "Cancel" : "Back"}
              </button>

              <div className="flex items-center gap-2">
                {formStep === "line_selection" ? (
                  <button
                    onClick={() => {
                      if (selectedLines.length === 0) {
                        showToast("Select at least one item to return", "error");
                        return;
                      }
                      setFormStep("settlement");
                    }}
                    className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2 text-xs font-bold text-white hover:bg-orange-700"
                  >
                    Next: Settlement →
                  </button>
                ) : formStep === "settlement" ? (
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60"
                  >
                    {saving ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Printer className="h-4 w-4" />
                        Save & Print Debit Note
                      </>
                    )}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {previewModalState.isOpen && previewModalState.data && (
        <PrintPreviewModal
          isOpen={previewModalState.isOpen}
          onClose={() => setPreviewModalState({ isOpen: false, data: null })}
          docType="debit_note"
          title={previewModalState.title || "Debit Note Preview"}
          data={previewModalState.data}
          initialFormat="a4"
        />
      )}
    </div>
  );
};
