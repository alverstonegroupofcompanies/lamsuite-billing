import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  customerDebitNoteService,
  type CustomerDebitNoteRecord,
  type DebitNoteLine,
  type InvoiceAllocation,
  type DebitNoteStatus,
  type CreditNoteOption,
  type ReturnCondition,
  type ReturnReason,
  type VarianceAction,
  type LineStatus,
  type CreditNoteRecord,
  checkSec34TimeLimit,
} from "../lib/billing/customerDebitNoteService";
import { partiesStore, type Customer } from "../lib/masters/partiesStore";
import { productsStore, type ProductItem } from "../lib/masters/productsStore";
import { printingEngine } from "../lib/printing/printingEngine";
import {
  Undo2,
  Search,
  Plus,
  XCircle,
  CheckCircle,
  AlertCircle,
  Receipt,
  Printer,
  FileSpreadsheet,
  Building2,
  Split,
  Layers,
  ShieldCheck,
  Sparkles,
  Eye,
  Check,
  X,
  ChevronRight,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

export const CustomerDebitNotePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // --- List State ---
  const [debitNotes, setDebitNotes] = useState<CustomerDebitNoteRecord[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [varianceOnly, setVarianceOnly] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // --- Modal & Form State ---
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedDn, setSelectedDn] = useState<CustomerDebitNoteRecord | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState(0);

  // Form Fields
  const [debitNoteNumber, setDebitNoteNumber] = useState("");
  const [debitNoteDate, setDebitNoteDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [customerDnAmount, setCustomerDnAmount] = useState("");
  const [creditNoteOption, setCreditNoteOption] = useState<CreditNoteOption>("B");
  const [notes, setNotes] = useState("");
  const [attachmentName, setAttachmentName] = useState("");

  // Product Lines in Form
  const [formLines, setFormLines] = useState<
    Array<{
      product_id: string;
      product_name: string;
      hsn_code?: string;
      batch_no?: string;
      expiry_date?: string;
      customer_qty: number;
      customer_unit_price: number;
      customer_gst_percent: number;
      customer_line_total: number;
      allocations: InvoiceAllocation[];
      variance_action?: VarianceAction;
      variance_reason?: string;
      line_status: LineStatus;
    }>
  >([]);

  // Product Search for Adding Lines
  const [allProducts, setAllProducts] = useState<ProductItem[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [saving, setSaving] = useState(false);

  // Sub-Modals
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportData, setReportData] = useState<any>(null);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = async () => {
    setListLoading(true);
    try {
      const [dns, custs, prods] = await Promise.all([
        customerDebitNoteService.getDebitNotes({
          searchQuery: listSearch,
          status: statusFilter,
          varianceOnly,
        }),
        partiesStore.getAllCustomers(),
        productsStore.getAllProducts(),
      ]);
      setDebitNotes(dns);
      setCustomersList(custs);
      setAllProducts(prods);
    } catch (err: any) {
      showToast(err.message || "Failed to load debit notes", "error");
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [listSearch, statusFilter, varianceOnly]);

  const openNewForm = () => {
    setSelectedDn(null);
    setDebitNoteNumber("");
    setDebitNoteDate(new Date().toISOString().slice(0, 10));
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setCustomerId("");
    setCustomerSearch("");
    setCustomerDnAmount("");
    setCreditNoteOption("B");
    setNotes("");
    setAttachmentName("");
    setFormLines([]);
    setActiveLineIndex(0);
    setIsFormOpen(true);
  };

  const openDetail = (dn: CustomerDebitNoteRecord) => {
    setSelectedDn(dn);
    setDebitNoteNumber(dn.debit_note_number);
    setDebitNoteDate(dn.debit_note_date);
    setReceivedDate(dn.received_date);
    setCustomerId(dn.customer_id);
    setCustomerSearch(dn.customer_name);
    setCustomerDnAmount(String(dn.customer_dn_amount));
    setCreditNoteOption(dn.credit_note_option);
    setNotes(dn.notes || "");
    setAttachmentName(dn.attachment_name || "");
    setFormLines(
      dn.lines.map((l) => ({
        product_id: l.product_id,
        product_name: l.product_name,
        hsn_code: l.hsn_code,
        batch_no: l.batch_no,
        expiry_date: l.expiry_date,
        customer_qty: l.customer_qty,
        customer_unit_price: l.customer_unit_price,
        customer_gst_percent: l.customer_gst_percent,
        customer_line_total: l.customer_line_total,
        allocations: l.allocations || [],
        variance_action: l.variance_action,
        variance_reason: l.variance_reason,
        line_status: l.line_status || "pending",
      }))
    );
    setActiveLineIndex(0);
    setIsFormOpen(true);
  };

  const handleAddProductLine = (prod: ProductItem) => {
    const defaultUnitPrice = prod.sel_rate || 0;
    const gst = prod.gst_percent || 12;
    const defaultQty = 1;
    const taxable = defaultQty * defaultUnitPrice;
    const total = taxable + (taxable * gst) / 100;

    const newLine = {
      product_id: prod.id,
      product_name: prod.name,
      hsn_code: prod.hsn_sac_code || "300490",
      customer_qty: defaultQty,
      customer_unit_price: defaultUnitPrice,
      customer_gst_percent: gst,
      customer_line_total: Math.round(total * 100) / 100,
      allocations: [],
      line_status: "pending" as LineStatus,
    };

    setFormLines((prev) => [...prev, newLine]);
    setActiveLineIndex(formLines.length);
    setProductQuery("");

    if (customerId) {
      triggerAutoSuggest(formLines.length, prod.id, undefined, defaultQty);
    }
  };

  const triggerAutoSuggest = async (lineIdx: number, prodId: string, batch?: string, qty?: number) => {
    if (!customerId) {
      showToast("Please select a customer first to auto-match invoices", "error");
      return;
    }
    const targetQty = qty !== undefined ? qty : formLines[lineIdx]?.customer_qty || 1;
    try {
      const suggestions = await customerDebitNoteService.autoSuggestAllocationsForLine(
        customerId,
        prodId,
        batch,
        targetQty
      );

      setFormLines((prev) => {
        const updated = [...prev];
        if (updated[lineIdx]) {
          updated[lineIdx] = {
            ...updated[lineIdx],
            allocations: suggestions,
          };
        }
        return updated;
      });

      if (suggestions.length > 0) {
        showToast(`Auto-matched ${suggestions.length} invoice(s) for ${suggestions[0].product_name}`, "success");
      } else {
        showToast("No matching sales invoices found with returnable stock", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to auto-suggest allocations", "error");
    }
  };

  const handleSaveDebitNote = async () => {
    if (!debitNoteNumber.trim()) {
      showToast("Please enter Customer Debit Note Number", "error");
      return;
    }
    if (!customerId) {
      showToast("Please select a Customer", "error");
      return;
    }
    if (formLines.length === 0) {
      showToast("Please add at least one product line", "error");
      return;
    }

    setSaving(true);
    try {
      const parsedDnAmount = parseFloat(customerDnAmount) || 0;
      if (selectedDn) {
        await customerDebitNoteService.updateDebitNote(selectedDn.id, {
          customer_dn_amount: parsedDnAmount,
          credit_note_option: creditNoteOption,
          notes,
          attachment_name: attachmentName,
          lines: formLines,
        });
        showToast("Customer Debit Note updated successfully", "success");
      } else {
        const res = await customerDebitNoteService.createDebitNote({
          debit_note_number: debitNoteNumber,
          debit_note_date: debitNoteDate,
          received_date: receivedDate,
          customer_id: customerId,
          customer_dn_amount: parsedDnAmount,
          credit_note_option: creditNoteOption,
          notes,
          attachment_name: attachmentName,
          lines: formLines,
        });
        showToast(`Debit Note #${res.debitNoteNumber} registered successfully`, "success");
      }
      setIsFormOpen(false);
      loadData();
    } catch (err: any) {
      showToast(err.message || "Failed to save debit note", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleIssueCreditNotes = async () => {
    if (!selectedDn) return;
    try {
      const res = await customerDebitNoteService.issueCreditNotes(selectedDn.id, {
        creditNoteOption,
        creditNoteDate: new Date().toISOString().slice(0, 10),
      });

      showToast(
        `Generated ${res.creditNotes.length} Credit Note(s): ${res.creditNotes.map((c) => c.credit_note_number).join(", ")} for ₹${res.totalCreditAmount.toFixed(2)}`,
        "success"
      );

      setIsIssueModalOpen(false);
      setIsFormOpen(false);
      loadData();

      if (res.creditNotes.length > 0) {
        handlePrintCreditNote(res.creditNotes[0]);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to issue Credit Notes", "error");
    }
  };

  const handlePrintCreditNote = (cn: CreditNoteRecord) => {
    try {
      const html = printingEngine.generateCreditNoteA4Html({
        return_number: cn.credit_note_number,
        return_date: cn.credit_note_date,
        original_invoice_number: cn.original_invoice_numbers.join(", "),
        customer_debit_note_number: cn.source_debit_note_number,
        invoice_references: cn.invoice_references,
        store_name: "LamStone Pharmacy & Retail",
        store_address: "Main Road, Palakkad, Kerala - 678001",
        store_phone: "9876543210",
        store_gstin: "32AAAAA0000A1Z5",
        customer_name: cn.customer_name,
        customer_phone: cn.customer_phone,
        customer_gstin: cn.customer_gstin,
        lines: cn.lines.map((l) => ({
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
        subtotal: cn.subtotal,
        tax_total: cn.tax_total,
        cgst_total: cn.cgst_total,
        sgst_total: cn.sgst_total,
        round_off: cn.round_off,
        grand_total: cn.grand_total,
        refund_mode: cn.refund_mode,
        notes: cn.notes,
      });

      const win = window.open("", "_blank", "width=900,height=650");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.print();
      }
    } catch (err: any) {
      showToast("Print error: " + err.message, "error");
    }
  };

  const statusBadge = (status: DebitNoteStatus) => {
    switch (status) {
      case "approved":
      case "credit_note_issued":
      case "settled":
        return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{status.replace("_", " ")}</span>;
      case "partially_approved":
        return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">Partially Approved</span>;
      case "disputed":
        return <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">Disputed</span>;
      case "rejected":
      case "cancelled":
        return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{status}</span>;
      default:
        return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{status.replace("_", " ")}</span>;
    }
  };

  // Form Calculations
  const totalCustomerAmount = parseFloat(customerDnAmount) || 0;
  const ourCalculatedTotal = formLines.reduce((acc, line) => {
    const lineTotal = line.allocations.reduce((sum, a) => sum + a.total_amount, 0);
    return acc + lineTotal;
  }, 0);
  const totalVariance = Math.round((totalCustomerAmount - ourCalculatedTotal) * 100) / 100;
  const activeLine = formLines[activeLineIndex];

  return (
    <div className="space-y-4 font-sans">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] flex items-center gap-2 rounded-lg px-4 py-3 text-xs font-semibold text-white shadow-lg ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-slate-800">
            <Building2 className="h-5 w-5 text-indigo-600" />
            Customer Debit Notes (B2B Multi-Invoice Returns)
          </h2>
          <p className="text-xs text-slate-500">
            Reconcile debit notes received from customers, auto-match invoices across batches, and issue GST Credit Notes (Sec 34).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              const rep = await customerDebitNoteService.getDebitNotesReport();
              setReportData(rep);
              setIsReportModalOpen(true);
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            Debit Notes Report
          </button>
          <button
            onClick={openNewForm}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" />
            New Customer Debit Note
          </button>
        </div>
      </div>

      {/* Module Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => navigate("/returns/sales")}
          className="flex items-center gap-2 border-b-2 border-transparent pb-2 px-3 text-xs font-bold text-slate-500 hover:text-slate-800"
        >
          <Undo2 className="h-4 w-4" />
          Counter Returns (Walk-in)
        </button>
        <button
          className="flex items-center gap-2 border-b-2 border-indigo-600 pb-2 px-3 text-xs font-bold text-indigo-700"
        >
          <Building2 className="h-4 w-4" />
          Customer Debit Notes (B2B Multi-Invoice)
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder="Search DN no, customer, GSTIN, phone..."
            className="w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none"
        >
          <option value="all">All Statuses</option>
          <option value="received">Received</option>
          <option value="under_verification">Under Verification</option>
          <option value="approved">Approved</option>
          <option value="partially_approved">Partially Approved</option>
          <option value="disputed">Disputed</option>
          <option value="credit_note_issued">Credit Note Issued</option>
          <option value="settled">Settled</option>
          <option value="cancelled">Cancelled</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium">
          <input
            type="checkbox"
            checked={varianceOnly}
            onChange={(e) => setVarianceOnly(e.target.checked)}
            className="rounded text-indigo-600"
          />
          <span>Variance Only</span>
        </label>
      </div>

      {/* Debit Notes Table Card */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
          <h3 className="text-xs font-bold text-slate-800">Customer Debit Note Register</h3>
          <span className="text-[11px] text-slate-500">{debitNotes.length} Records</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-100/70 text-slate-600">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Debit Note No</th>
                <th className="px-4 py-2.5 font-semibold">Date</th>
                <th className="px-4 py-2.5 font-semibold">Customer</th>
                <th className="px-4 py-2.5 font-semibold text-right">Customer Stated</th>
                <th className="px-4 py-2.5 font-semibold text-right">Our Calc</th>
                <th className="px-4 py-2.5 font-semibold text-right">Variance</th>
                <th className="px-4 py-2.5 font-semibold text-center">Strategy</th>
                <th className="px-4 py-2.5 font-semibold text-center">Status</th>
                <th className="px-4 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {listLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Loading customer debit notes...
                  </td>
                </tr>
              ) : debitNotes.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    No customer debit notes found. Click "New Customer Debit Note" to create one.
                  </td>
                </tr>
              ) : (
                debitNotes.map((dn) => {
                  const hasVariance = Math.abs(dn.variance) > 0.01;
                  return (
                    <tr key={dn.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-2.5 font-mono font-bold text-indigo-700">
                        #{dn.debit_note_number}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{dn.debit_note_date}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-800">{dn.customer_name}</div>
                        {dn.customer_gstin && (
                          <div className="text-[10px] text-slate-400 font-mono">GSTIN: {dn.customer_gstin}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold text-slate-700">
                        ₹{dn.customer_dn_amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-indigo-700">
                        ₹{dn.our_calculated_amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className={`font-mono font-bold px-1.5 py-0.5 rounded text-[11px] ${
                            hasVariance
                              ? dn.variance > 0
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
                              : "bg-emerald-50 text-emerald-700"
                          }`}
                        >
                          {dn.variance > 0 ? "+" : ""}₹{dn.variance.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                          Option {dn.credit_note_option}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">{statusBadge(dn.status)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => openDetail(dn)}
                          className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors"
                        >
                          View / Reconcile
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New / Reconcile Form Modal ────────────────────────────────────────── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-indigo-50 px-5 py-3">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-indigo-600" />
                <div>
                  <h3 className="text-sm font-bold text-slate-800">
                    {selectedDn ? `Customer Debit Note #${selectedDn.debit_note_number}` : "New Customer Debit Note"}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Reconcile products against past invoices with batch-level FIFO matching.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form Top Fields */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 border-b border-slate-200 bg-slate-50/70 p-4 text-xs">
              <div>
                <label className="mb-1 block font-bold text-slate-700">Customer *</label>
                <select
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    const c = customersList.find((cust) => cust.id === e.target.value);
                    if (c) setCustomerSearch(c.name);
                  }}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                >
                  <option value="">-- Select Customer --</option>
                  {customersList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.gstin ? `(${c.gstin})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">Customer DN No. *</label>
                <input
                  type="text"
                  placeholder="e.g. DN-2026-99"
                  value={debitNoteNumber}
                  onChange={(e) => setDebitNoteNumber(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">Customer DN Date</label>
                <input
                  type="date"
                  value={debitNoteDate}
                  onChange={(e) => setDebitNoteDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">Customer Stated Amount (₹)</label>
                <input
                  type="number"
                  placeholder="0.00"
                  value={customerDnAmount}
                  onChange={(e) => setCustomerDnAmount(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block font-bold text-slate-700">Credit Note Strategy</label>
                <div className="flex items-center gap-1 mt-0.5">
                  <button
                    type="button"
                    onClick={() => setCreditNoteOption("B")}
                    className={`flex-1 rounded py-1 text-[11px] font-bold border transition-colors ${
                      creditNoteOption === "B"
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    Opt B (Per Inv)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreditNoteOption("A")}
                    className={`flex-1 rounded py-1 text-[11px] font-bold border transition-colors ${
                      creditNoteOption === "A"
                        ? "bg-indigo-600 text-white border-indigo-600"
                        : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    Opt A (Consol)
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body: Two-Pane Reconciler */}
            <div className="flex-1 flex overflow-hidden min-h-[380px]">
              {/* Left Pane: Customer Note Items */}
              <div className="w-[45%] border-r border-slate-200 flex flex-col bg-white overflow-hidden">
                <div className="p-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">
                    Debit Note Items ({formLines.length})
                  </span>

                  {/* Product Search Picker */}
                  <div className="relative w-48">
                    <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Add product line..."
                      value={productQuery}
                      onChange={(e) => setProductQuery(e.target.value)}
                      className="w-full pl-6 pr-2 py-1 border border-slate-200 rounded text-xs bg-white focus:outline-none focus:border-indigo-500"
                    />
                    {productQuery.trim() && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto z-30 divide-y divide-slate-100">
                        {allProducts
                          .filter((p) => p.name.toLowerCase().includes(productQuery.toLowerCase()))
                          .slice(0, 6)
                          .map((prod) => (
                            <div
                              key={prod.id}
                              onClick={() => handleAddProductLine(prod)}
                              className="p-2 hover:bg-indigo-50 cursor-pointer text-xs"
                            >
                              <div className="font-semibold text-slate-800">{prod.name}</div>
                              <div className="text-[10px] text-slate-400">
                                Rate: ₹{prod.sel_rate || 0} | GST: {prod.gst_percent || 12}%
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1.5">
                  {formLines.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400">
                      No product lines added yet. Use the search box above to add items from the customer's note.
                    </div>
                  ) : (
                    formLines.map((line, idx) => {
                      const isActive = activeLineIndex === idx;
                      const allocatedQty = line.allocations.reduce((s, a) => s + a.return_qty, 0);
                      const lineOurTotal = line.allocations.reduce((s, a) => s + a.total_amount, 0);
                      const varAmt = Math.round((line.customer_line_total - lineOurTotal) * 100) / 100;

                      return (
                        <div
                          key={idx}
                          onClick={() => setActiveLineIndex(idx)}
                          className={`p-2.5 rounded-lg cursor-pointer border transition-all ${
                            isActive
                              ? "bg-indigo-50/70 border-indigo-400 shadow-xs"
                              : "hover:bg-slate-50 border-slate-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 text-xs">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-800 truncate">{line.product_name}</span>
                                {allocatedQty === line.customer_qty ? (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                                    Full ({allocatedQty})
                                  </span>
                                ) : allocatedQty === 0 ? (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                    Unmatched
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                                    Part ({allocatedQty}/{line.customer_qty})
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1">
                                <span>
                                  Qty:{" "}
                                  <input
                                    type="number"
                                    min={1}
                                    value={line.customer_qty}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      const val = Math.max(1, parseInt(e.target.value) || 1);
                                      setFormLines((prev) => {
                                        const u = [...prev];
                                        u[idx].customer_qty = val;
                                        const tax = (val * u[idx].customer_unit_price * u[idx].customer_gst_percent) / 100;
                                        u[idx].customer_line_total = Math.round((val * u[idx].customer_unit_price + tax) * 100) / 100;
                                        return u;
                                      });
                                    }}
                                    className="w-12 px-1 py-0.2 border border-slate-300 rounded font-bold text-center"
                                  />
                                </span>
                                <span>Rate: ₹{line.customer_unit_price}</span>
                                <span>GST: {line.customer_gst_percent}%</span>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="text-slate-600">DN: ₹{line.customer_line_total.toFixed(2)}</div>
                              <div className="font-bold text-indigo-700">Our: ₹{lineOurTotal.toFixed(2)}</div>
                              {Math.abs(varAmt) > 0.01 && (
                                <div className={`text-[10px] font-mono font-bold ${varAmt > 0 ? "text-red-600" : "text-amber-600"}`}>
                                  {varAmt > 0 ? "+" : ""}₹{varAmt.toFixed(2)}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-2 flex items-center justify-between pt-1 border-t border-slate-100">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                triggerAutoSuggest(idx, line.product_id, line.batch_no, line.customer_qty);
                              }}
                              className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 flex items-center gap-1"
                            >
                              <Sparkles className="w-3 h-3" />
                              Auto-Match (FIFO)
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setFormLines((prev) => prev.filter((_, i) => i !== idx));
                                if (activeLineIndex >= formLines.length - 1) {
                                  setActiveLineIndex(Math.max(0, formLines.length - 2));
                                }
                              }}
                              className="text-red-500 hover:text-red-700 text-[11px]"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Pane: Matching Invoices & Allocations */}
              <div className="w-[55%] flex flex-col bg-slate-50 overflow-hidden">
                <div className="p-2.5 bg-white border-b border-slate-200 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">
                    Invoice Allocations {activeLine ? `(${activeLine.product_name})` : ""}
                  </span>
                  {activeLine && (
                    <span className="text-[11px] text-slate-500">
                      Req: <strong>{activeLine.customer_qty}</strong> | Matched:{" "}
                      <strong className="text-indigo-700">
                        {activeLine.allocations.reduce((s, a) => s + a.return_qty, 0)}
                      </strong>
                    </span>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {!activeLine ? (
                    <div className="py-12 text-center text-xs text-slate-400">
                      Select a product line on the left to inspect invoice allocations.
                    </div>
                  ) : activeLine.allocations.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center space-y-2">
                      <AlertCircle className="w-6 h-6 text-amber-500 mx-auto" />
                      <div className="text-xs font-bold text-slate-700">No Invoices Matched Yet</div>
                      <p className="text-[11px] text-slate-500">
                        Click "Auto-Match (FIFO)" to automatically match against past sales invoices.
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          triggerAutoSuggest(
                            activeLineIndex,
                            activeLine.product_id,
                            activeLine.batch_no,
                            activeLine.customer_qty
                          )
                        }
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-indigo-700"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Auto-Match Now
                      </button>
                    </div>
                  ) : (
                    activeLine.allocations.map((alloc, aIdx) => {
                      const sec34 = checkSec34TimeLimit(alloc.invoice_date);
                      return (
                        <div
                          key={alloc.id || aIdx}
                          className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs space-y-2 text-xs"
                        >
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono font-bold text-blue-700">#{alloc.invoice_number}</span>
                                <span className="text-[11px] text-slate-400">({alloc.invoice_date})</span>
                                {alloc.suggestion_method && (
                                  <span className="rounded bg-indigo-50 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700 border border-indigo-200">
                                    {alloc.suggestion_method === "exact_batch" ? "Exact Batch" : "FIFO"}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5">
                                Batch: <strong>{alloc.batch_no || "-"}</strong> | Exp: {alloc.expiry_date || "-"}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-bold font-mono text-indigo-700">
                                ₹{alloc.total_amount.toFixed(2)}
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Rate: ₹{alloc.unit_price} + {alloc.gst_percent}% GST
                              </div>
                            </div>
                          </div>

                          {sec34.isExpired && (
                            <div className="rounded bg-amber-50 border border-amber-200 p-1.5 text-[10px] text-amber-800 flex items-center gap-1 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              <span>{sec34.warning}</span>
                            </div>
                          )}

                          <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-[11px]">
                            <div>
                              <label className="block font-semibold text-slate-600">
                                Qty (Max: {alloc.remaining_returnable_qty})
                              </label>
                              <input
                                type="number"
                                min={1}
                                max={alloc.remaining_returnable_qty}
                                value={alloc.return_qty}
                                onChange={(e) => {
                                  const val = Math.min(
                                    alloc.remaining_returnable_qty,
                                    Math.max(1, parseInt(e.target.value) || 1)
                                  );
                                  setFormLines((prev) => {
                                    const u = [...prev];
                                    const cur = u[activeLineIndex].allocations[aIdx];
                                    const gross = val * cur.unit_price;
                                    const disc = (gross * (cur.discount_percent || 0)) / 100;
                                    const taxb = gross - disc;
                                    const tax = (taxb * cur.gst_percent) / 100;
                                    cur.return_qty = val;
                                    cur.taxable_amount = Math.round(taxb * 100) / 100;
                                    cur.cgst_amount = Math.round((tax / 2) * 100) / 100;
                                    cur.sgst_amount = Math.round((tax / 2) * 100) / 100;
                                    cur.total_amount = Math.round((taxb + tax) * 100) / 100;
                                    return u;
                                  });
                                }}
                                className="w-full rounded border border-slate-200 px-1.5 py-0.5 font-bold text-center"
                              />
                            </div>

                            <div>
                              <label className="block font-semibold text-slate-600">Condition</label>
                              <select
                                value={alloc.condition}
                                onChange={(e) => {
                                  const cond = e.target.value as ReturnCondition;
                                  setFormLines((prev) => {
                                    const u = [...prev];
                                    u[activeLineIndex].allocations[aIdx].condition = cond;
                                    return u;
                                  });
                                }}
                                className="w-full rounded border border-slate-200 px-1 py-0.5 bg-white text-[11px]"
                              >
                                <option value="restock">Restock</option>
                                <option value="damaged">Damaged</option>
                                <option value="discard">Discard</option>
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-slate-600">Reason</label>
                              <select
                                value={alloc.reason}
                                onChange={(e) => {
                                  const r = e.target.value as ReturnReason;
                                  setFormLines((prev) => {
                                    const u = [...prev];
                                    u[activeLineIndex].allocations[aIdx].reason = r;
                                    return u;
                                  });
                                }}
                                className="w-full rounded border border-slate-200 px-1 py-0.5 bg-white text-[11px]"
                              >
                                <option value="customer_return">Customer Return</option>
                                <option value="expired">Expired</option>
                                <option value="damaged">Damaged</option>
                                <option value="wrong_item">Wrong Item</option>
                                <option value="excess">Excess Supply</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer / Summary Bar */}
            <div className="border-t border-slate-200 bg-slate-50 px-5 py-3 flex items-center justify-between text-xs">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">Customer DN</span>
                  <span className="font-mono font-bold text-slate-800">₹{totalCustomerAmount.toFixed(2)}</span>
                </div>
                <div className="h-6 w-px bg-slate-200" />
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">Our Credit</span>
                  <span className="font-mono font-bold text-indigo-700">₹{ourCalculatedTotal.toFixed(2)}</span>
                </div>
                <div className="h-6 w-px bg-slate-200" />
                <div>
                  <span className="text-slate-500 block text-[10px] font-bold uppercase">Variance</span>
                  <span
                    className={`font-mono font-bold ${
                      Math.abs(totalVariance) > 0.01
                        ? totalVariance > 0
                          ? "text-red-600"
                          : "text-amber-600"
                        : "text-emerald-700"
                    }`}
                  >
                    {totalVariance > 0 ? "+" : ""}₹{totalVariance.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {selectedDn && (selectedDn.status === "received" || selectedDn.status === "under_verification") && (
                  <button
                    type="button"
                    onClick={() => setIsApprovalModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Verify & Approve
                  </button>
                )}

                {selectedDn && (selectedDn.status === "approved" || selectedDn.status === "partially_approved") && (
                  <button
                    type="button"
                    onClick={() => setIsIssueModalOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
                  >
                    <Split className="h-3.5 w-3.5" />
                    Issue Credit Note(s)
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Close
                </button>

                <button
                  type="button"
                  onClick={handleSaveDebitNote}
                  disabled={saving}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save Note"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Verify & Approve Sub-Modal ────────────────────────────────────────── */}
      {isApprovalModalOpen && selectedDn && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                Verify & Approve Debit Note
              </h4>
              <button onClick={() => setIsApprovalModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1.5 border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-600">Customer Stated:</span>
                <span className="font-mono font-bold">₹{selectedDn.customer_dn_amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Our Verified Amount:</span>
                <span className="font-mono font-bold text-indigo-700">
                  ₹{selectedDn.our_calculated_amount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5">
                <span className="font-bold text-slate-800">Net Variance:</span>
                <span className="font-mono font-bold text-red-600">
                  {selectedDn.variance > 0 ? "+" : ""}₹{selectedDn.variance.toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Approval Notes</label>
              <textarea
                placeholder="Remarks regarding rate verification or variance resolution..."
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full rounded-lg border border-slate-200 p-2 text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsApprovalModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    await customerDebitNoteService.approveDebitNote(selectedDn.id, {
                      notes,
                      approvedBy: "Store Manager",
                    });
                    showToast("Debit Note verified and approved", "success");
                    setIsApprovalModalOpen(false);
                    setIsFormOpen(false);
                    loadData();
                  } catch (err: any) {
                    showToast(err.message || "Failed to approve", "error");
                  }
                }}
                className="rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"
              >
                Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Issue Credit Note Sub-Modal ──────────────────────────────────────── */}
      {isIssueModalOpen && selectedDn && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Split className="h-4 w-4 text-indigo-600" />
                Issue Credit Note(s)
              </h4>
              <button onClick={() => setIsIssueModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Generates official GST Credit Note(s) (CN-26-27-XXXX), restores inventory to batch records, and updates customer balance.
            </p>

            <div className="rounded-lg bg-indigo-50/70 p-3 text-xs space-y-2 border border-indigo-200">
              <div className="font-bold text-indigo-900">Credit Note Strategy:</div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="opt-modal"
                  checked={creditNoteOption === "B"}
                  onChange={() => setCreditNoteOption("B")}
                  className="text-indigo-600"
                />
                <span>Option B: 1 Credit Note per Invoice (Portal Clean)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="opt-modal"
                  checked={creditNoteOption === "A"}
                  onChange={() => setCreditNoteOption("A")}
                  className="text-indigo-600"
                />
                <span>Option A: Consolidated Credit Note</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsIssueModalOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleIssueCreditNotes}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"
              >
                Issue & Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Debit Notes Report Sub-Modal ─────────────────────────────────────── */}
      {isReportModalOpen && reportData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                Debit Notes Received & Ageing Report
              </h3>
              <button onClick={() => setIsReportModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Metrics */}
            <div className="grid grid-cols-4 gap-3 text-xs">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-[10px] text-slate-500 font-bold uppercase">Total Stated Value</div>
                <div className="text-sm font-bold font-mono text-slate-800">
                  ₹{reportData.totals.total_dn_amount.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                <div className="text-[10px] text-emerald-700 font-bold uppercase">Verified Credit</div>
                <div className="text-sm font-bold font-mono text-emerald-800">
                  ₹{reportData.totals.total_our_amount.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <div className="text-[10px] text-amber-700 font-bold uppercase">Net Variance</div>
                <div className="text-sm font-bold font-mono text-amber-800">
                  ₹{reportData.totals.total_variance.toFixed(2)}
                </div>
              </div>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5">
                <div className="text-[10px] text-indigo-700 font-bold uppercase">Pending Verification</div>
                <div className="text-sm font-bold text-indigo-800">
                  {reportData.totals.pending_count} note(s)
                </div>
              </div>
            </div>

            {/* Report Table */}
            <div className="flex-1 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 font-semibold text-slate-600 sticky top-0 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2">DN No</th>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">Customer (₹)</th>
                    <th className="px-3 py-2 text-right">Verified (₹)</th>
                    <th className="px-3 py-2 text-right">Variance</th>
                    <th className="px-3 py-2 text-center">Ageing</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.entries.map((e: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-mono font-bold text-indigo-700">#{e.debit_note_number}</td>
                      <td className="px-3 py-2 text-slate-500">{e.debit_note_date}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{e.customer_name}</td>
                      <td className="px-3 py-2 text-right font-mono">₹{e.customer_dn_amount.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-indigo-700">
                        ₹{e.our_calculated_amount.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold">
                        {e.variance > 0 ? "+" : ""}₹{e.variance.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`rounded px-1.5 py-0.5 font-bold text-[11px] ${
                            e.is_delayed_verification
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {e.ageing_days}d
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">{statusBadge(e.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-900"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
