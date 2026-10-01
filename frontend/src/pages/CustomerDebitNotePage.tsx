import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
  FileText,
  Search,
  Plus,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Printer,
  FileSpreadsheet,
  Split,
  Layers,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  Sparkles,
  Paperclip,
  Eye,
  Check,
  X,
  Share2,
  Send,
  CreditCard,
  Building2,
  Calendar,
  DollarSign,
  AlertCircle,
  HelpCircle,
} from "lucide-react";

export const CustomerDebitNotePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [debitNotes, setDebitNotes] = useState<CustomerDebitNoteRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [varianceOnly, setVarianceOnly] = useState<boolean>(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  // Form / Detail Modal State
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [selectedDn, setSelectedDn] = useState<CustomerDebitNoteRecord | null>(null);
  const [activeLineIndex, setActiveLineIndex] = useState<number>(0);

  // Form Fields for New / Edit
  const [debitNoteNumber, setDebitNoteNumber] = useState<string>("");
  const [debitNoteDate, setDebitNoteDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [receivedDate, setReceivedDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [customerId, setCustomerId] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [customersList, setCustomersList] = useState<Customer[]>([]);
  const [customerDnAmount, setCustomerDnAmount] = useState<string>("");
  const [creditNoteOption, setCreditNoteOption] = useState<CreditNoteOption>("B");
  const [notes, setNotes] = useState<string>("");
  const [attachmentName, setAttachmentName] = useState<string>("");

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

  // Product Search for adding lines
  const [allProducts, setAllProducts] = useState<ProductItem[]>([]);
  const [productQuery, setProductQuery] = useState<string>("");

  // Modals
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState<boolean>(false);
  const [isIssueModalOpen, setIsIssueModalOpen] = useState<boolean>(false);
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState<boolean>(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState<boolean>(false);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [isReportModalOpen, setIsReportModalOpen] = useState<boolean>(false);
  const [reportData, setReportData] = useState<any>(null);

  const showToast = (message: string, type: "success" | "error" | "info" = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [dns, custs, prods] = await Promise.all([
        customerDebitNoteService.getDebitNotes({
          searchQuery,
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
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [searchQuery, statusFilter, varianceOnly]);

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

  // Add line to form
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

    // Auto trigger suggestion if customer is selected
    if (customerId) {
      triggerAutoSuggest(formLines.length, prod.id, undefined, defaultQty);
    }
  };

  // Trigger FIFO auto-suggestion for a line
  const triggerAutoSuggest = async (lineIdx: number, prodId: string, batch?: string, qty?: number) => {
    if (!customerId) {
      showToast("Please select a customer first to auto-match invoices", "info");
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
        showToast("No matching sales invoices found with returnable stock", "info");
      }
    } catch (err: any) {
      showToast(err.message || "Failed to auto-suggest allocations", "error");
    }
  };

  // Save / Submit Debit Note
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

    try {
      const parsedDnAmount = parseFloat(customerDnAmount) || 0;
      if (selectedDn) {
        // Update
        await customerDebitNoteService.updateDebitNote(selectedDn.id, {
          customer_dn_amount: parsedDnAmount,
          credit_note_option: creditNoteOption,
          notes,
          attachment_name: attachmentName,
          lines: formLines,
        });
        showToast("Customer Debit Note updated successfully", "success");
      } else {
        // Create
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
    }
  };

  // Issue Credit Notes
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

      // Print first credit note preview
      if (res.creditNotes.length > 0) {
        handlePrintCreditNote(res.creditNotes[0]);
      }
    } catch (err: any) {
      showToast(err.message || "Failed to issue Credit Notes", "error");
    }
  };

  // Print Credit Note A4
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

  // Totals calculations for current form
  const totalCustomerAmount = parseFloat(customerDnAmount) || 0;
  const ourCalculatedTotal = formLines.reduce((acc, line) => {
    const lineTotal = line.allocations.reduce((sum, a) => sum + a.total_amount, 0);
    return acc + lineTotal;
  }, 0);
  const totalVariance = Math.round((totalCustomerAmount - ourCalculatedTotal) * 100) / 100;

  const activeLine = formLines[activeLineIndex];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm font-semibold flex items-center gap-2 transition-all ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-300 text-emerald-800"
              : toast.type === "error"
              ? "bg-rose-50 border-rose-300 text-rose-800"
              : "bg-blue-50 border-blue-300 text-blue-800"
          }`}
        >
          {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
          {toast.type === "error" && <AlertTriangle className="w-5 h-5 text-rose-600" />}
          {toast.type === "info" && <HelpCircle className="w-5 h-5 text-blue-600" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main List Screen */}
      {!isFormOpen && (
        <div className="p-6 max-w-7xl mx-auto w-full space-y-6">
          {/* Header Banner */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <Building2 className="w-6 h-6 text-indigo-600" />
                <h1 className="text-2xl font-bold text-slate-800">Customer Debit Notes (B2B Returns)</h1>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                Process returns received as customer debit notes, auto-match invoices across batches, reconcile variance, and issue Credit Notes (GST Sec 34).
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={async () => {
                  const rep = await customerDebitNoteService.getDebitNotesReport();
                  setReportData(rep);
                  setIsReportModalOpen(true);
                }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-sm flex items-center gap-2 transition-colors border border-slate-300"
              >
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                <span>Debit Notes Report</span>
              </button>

              <button
                onClick={openNewForm}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm flex items-center gap-2 shadow-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>New Customer Debit Note</span>
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-[280px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by DN #, customer, GSTIN, mobile..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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

              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none bg-slate-50 px-3 py-2 border border-slate-200 rounded-lg hover:bg-slate-100">
                <input
                  type="checkbox"
                  checked={varianceOnly}
                  onChange={(e) => setVarianceOnly(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                />
                <span className="font-medium">Variance Only</span>
              </label>
            </div>
          </div>

          {/* Debit Notes Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-100/75 border-b border-slate-200 text-slate-600 text-xs font-bold uppercase tracking-wider">
                    <th className="py-3 px-4">DN Number & Date</th>
                    <th className="py-3 px-4">Customer Details</th>
                    <th className="py-3 px-4 text-right">Customer Amount</th>
                    <th className="py-3 px-4 text-right">Our Calc</th>
                    <th className="py-3 px-4 text-right">Variance</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Option</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        Loading Debit Notes...
                      </td>
                    </tr>
                  ) : debitNotes.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        No customer debit notes found. Click "New Customer Debit Note" to register one.
                      </td>
                    </tr>
                  ) : (
                    debitNotes.map((dn) => {
                      const hasVariance = Math.abs(dn.variance) > 0.01;
                      return (
                        <tr key={dn.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-bold text-indigo-700">#{dn.debit_note_number}</div>
                            <div className="text-xs text-slate-500">Date: {dn.debit_note_date}</div>
                            {dn.received_date && (
                              <div className="text-[11px] text-slate-400">Rec: {dn.received_date}</div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-800">{dn.customer_name}</div>
                            {dn.customer_gstin && (
                              <div className="text-xs text-slate-500 font-mono">GST: {dn.customer_gstin}</div>
                            )}
                            {dn.customer_phone && (
                              <div className="text-xs text-slate-400">Ph: {dn.customer_phone}</div>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-slate-700">
                            ₹{dn.customer_dn_amount.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-indigo-700">
                            ₹{dn.our_calculated_amount.toFixed(2)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`font-mono font-bold text-xs px-2 py-0.5 rounded ${
                                hasVariance
                                  ? dn.variance > 0
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {dn.variance > 0 ? "+" : ""}₹{dn.variance.toFixed(2)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                                dn.status === "approved" || dn.status === "credit_note_issued" || dn.status === "settled"
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : dn.status === "partially_approved"
                                  ? "bg-blue-100 text-blue-800 border border-blue-200"
                                  : dn.status === "disputed"
                                  ? "bg-purple-100 text-purple-800 border border-purple-200"
                                  : dn.status === "rejected" || dn.status === "cancelled"
                                  ? "bg-rose-100 text-rose-800 border border-rose-200"
                                  : "bg-amber-100 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {dn.status.replace("_", " ")}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                              Option {dn.credit_note_option}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openDetail(dn)}
                                className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold flex items-center gap-1 border border-indigo-200 transition-colors"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>View / Reconcile</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Two-Pane Detailed Reconciler & Form */}
      {isFormOpen && (
        <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-100">
          {/* Top Bar */}
          <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsFormOpen(false)}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-800">
                    {selectedDn ? `Debit Note #${selectedDn.debit_note_number}` : "New Customer Debit Note"}
                  </h2>
                  {selectedDn && (
                    <span className="px-2 py-0.5 rounded text-xs font-bold uppercase bg-indigo-100 text-indigo-700">
                      {selectedDn.status.replace("_", " ")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {selectedDn?.customer_name || "Enter customer details and products to auto-match invoices"}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-3">
              {selectedDn && (selectedDn.status === "received" || selectedDn.status === "under_verification") && (
                <button
                  onClick={() => setIsApprovalModalOpen(true)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-sm flex items-center gap-2 shadow-sm transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify & Approve</span>
                </button>
              )}

              {selectedDn && (selectedDn.status === "approved" || selectedDn.status === "partially_approved") && (
                <button
                  onClick={() => setIsIssueModalOpen(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-sm flex items-center gap-2 shadow-sm transition-colors"
                >
                  <Split className="w-4 h-4" />
                  <span>Issue Credit Note(s)</span>
                </button>
              )}

              <button
                onClick={handleSaveDebitNote}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg text-sm flex items-center gap-2 shadow-sm transition-colors"
              >
                <Check className="w-4 h-4" />
                <span>Save Note</span>
              </button>
            </div>
          </div>

          {/* Form Meta Fields Section */}
          <div className="bg-white border-b border-slate-200 px-6 py-3 shrink-0 grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Customer *</label>
              <select
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  const c = customersList.find((cust) => cust.id === e.target.value);
                  if (c) setCustomerSearch(c.name);
                }}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
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
              <label className="block text-xs font-bold text-slate-600 mb-1">Customer DN No. *</label>
              <input
                type="text"
                placeholder="e.g. DN-2026-99"
                value={debitNoteNumber}
                onChange={(e) => setDebitNoteNumber(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none font-semibold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Customer DN Date</label>
              <input
                type="date"
                value={debitNoteDate}
                onChange={(e) => setDebitNoteDate(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Customer DN Amount (₹)</label>
              <input
                type="number"
                placeholder="Total stated by customer"
                value={customerDnAmount}
                onChange={(e) => setCustomerDnAmount(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1">Credit Note Generation</label>
              <div className="flex items-center gap-2 mt-0.5">
                <button
                  type="button"
                  onClick={() => setCreditNoteOption("B")}
                  className={`flex-1 py-1 px-2 rounded text-xs font-bold border transition-colors ${
                    creditNoteOption === "B"
                      ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                >
                  Opt B (Per Inv)
                </button>
                <button
                  type="button"
                  onClick={() => setCreditNoteOption("A")}
                  className={`flex-1 py-1 px-2 rounded text-xs font-bold border transition-colors ${
                    creditNoteOption === "A"
                      ? "bg-indigo-50 border-indigo-500 text-indigo-700"
                      : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}
                >
                  Opt A (Consol)
                </button>
              </div>
            </div>
          </div>

          {/* Two-Pane Body */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Pane: Customer Debit Note Lines */}
            <div className="w-1/2 border-r border-slate-200 bg-white flex flex-col overflow-hidden">
              <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-xs uppercase text-slate-600">
                    1. Customer Debit Note Lines ({formLines.length})
                  </span>
                </div>

                {/* Add Product Search Dropdown */}
                <div className="relative w-64">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Add product to note..."
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  {productQuery.trim() && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-xl max-h-48 overflow-y-auto z-30 divide-y divide-slate-100">
                      {allProducts
                        .filter((p) => p.name.toLowerCase().includes(productQuery.toLowerCase()))
                        .slice(0, 8)
                        .map((prod) => (
                          <div
                            key={prod.id}
                            onClick={() => handleAddProductLine(prod)}
                            className="p-2 hover:bg-indigo-50 cursor-pointer text-xs"
                          >
                            <div className="font-bold text-slate-800">{prod.name}</div>
                            <div className="text-[11px] text-slate-500">
                              Rate: ₹{prod.sel_rate || 0} | GST: {prod.gst_percent || 12}%
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Lines List */}
              <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                {formLines.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    No products added yet. Use the search box above to add items from the customer's debit note.
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
                        className={`p-3.5 cursor-pointer transition-colors border-l-4 ${
                          isActive
                            ? "bg-indigo-50/70 border-indigo-600"
                            : "hover:bg-slate-50 border-transparent"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-sm">{line.product_name}</span>
                              {allocatedQty === line.customer_qty ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                                  Full ({allocatedQty}/{line.customer_qty})
                                </span>
                              ) : allocatedQty === 0 ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                  Unmatched
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                  Partial ({allocatedQty}/{line.customer_qty})
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
                              <div>
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
                                  className="w-14 px-1 py-0.5 border border-slate-300 rounded font-semibold text-center"
                                />
                              </div>
                              <div>Rate: ₹{line.customer_unit_price}</div>
                              <div>GST: {line.customer_gst_percent}%</div>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-xs font-bold text-slate-700">
                              DN: ₹{line.customer_line_total.toFixed(2)}
                            </div>
                            <div className="text-xs font-bold text-indigo-700">
                              Our: ₹{lineOurTotal.toFixed(2)}
                            </div>
                            {Math.abs(varAmt) > 0.01 && (
                              <div
                                className={`text-[11px] font-mono font-bold ${
                                  varAmt > 0 ? "text-rose-600" : "text-amber-600"
                                }`}
                              >
                                Var: {varAmt > 0 ? "+" : ""}₹{varAmt.toFixed(2)}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Quick Auto Suggest Button */}
                        <div className="mt-2 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              triggerAutoSuggest(idx, line.product_id, line.batch_no, line.customer_qty);
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-xs font-semibold flex items-center gap-1.5 border border-indigo-200 transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Auto-Match Invoices (FIFO)</span>
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
                            className="text-rose-600 hover:text-rose-800 text-xs p-1"
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

            {/* Right Pane: Invoice Allocations for Active Line */}
            <div className="w-1/2 bg-slate-50 flex flex-col overflow-hidden">
              <div className="p-3 bg-white border-b border-slate-200 flex items-center justify-between">
                <span className="font-bold text-xs uppercase text-slate-600">
                  2. Invoice Allocations & Rates {activeLine ? `for "${activeLine.product_name}"` : ""}
                </span>
                {activeLine && (
                  <span className="text-xs text-slate-500 font-medium">
                    Requested: {activeLine.customer_qty} | Allocated:{" "}
                    {activeLine.allocations.reduce((s, a) => s + a.return_qty, 0)}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {!activeLine ? (
                  <div className="text-center text-slate-400 py-12 text-xs">
                    Select a product line on the left to view and configure invoice allocations.
                  </div>
                ) : activeLine.allocations.length === 0 ? (
                  <div className="bg-white p-6 rounded-xl border border-dashed border-slate-300 text-center space-y-3">
                    <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                    <div className="text-sm font-bold text-slate-700">No Invoices Matched Yet</div>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Click the "Auto-Match Invoices" button to find prior sales invoices for this customer by batch and FIFO order.
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
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-2"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>Run Auto-Suggest Now</span>
                    </button>
                  </div>
                ) : (
                  activeLine.allocations.map((alloc, aIdx) => {
                    const sec34 = checkSec34TimeLimit(alloc.invoice_date);
                    return (
                      <div
                        key={alloc.id || aIdx}
                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-sm">
                                Invoice #{alloc.invoice_number}
                              </span>
                              <span className="text-xs text-slate-500">Date: {alloc.invoice_date}</span>
                              {alloc.suggestion_method && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">
                                  {alloc.suggestion_method === "exact_batch" ? "Exact Batch" : "FIFO"}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              Batch: <strong>{alloc.batch_no || "N/A"}</strong> | Exp: {alloc.expiry_date || "-"}
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-sm font-bold text-indigo-700">
                              ₹{alloc.total_amount.toFixed(2)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Rate: ₹{alloc.unit_price} + {alloc.gst_percent}% GST
                            </div>
                          </div>
                        </div>

                        {/* Sec 34 Warning */}
                        {sec34.isExpired && (
                          <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-800 flex items-center gap-1.5 font-medium">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>{sec34.warning}</span>
                          </div>
                        )}

                        {/* Controls: Return Qty, Condition, Reason */}
                        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs">
                          <div>
                            <label className="block font-semibold text-slate-600 mb-1">
                              Return Qty (Max: {alloc.remaining_returnable_qty})
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
                                  const curAlloc = u[activeLineIndex].allocations[aIdx];
                                  const gross = val * curAlloc.unit_price;
                                  const disc = (gross * (curAlloc.discount_percent || 0)) / 100;
                                  const taxb = gross - disc;
                                  const tax = (taxb * curAlloc.gst_percent) / 100;
                                  curAlloc.return_qty = val;
                                  curAlloc.taxable_amount = Math.round(taxb * 100) / 100;
                                  curAlloc.cgst_amount = Math.round((tax / 2) * 100) / 100;
                                  curAlloc.sgst_amount = Math.round((tax / 2) * 100) / 100;
                                  curAlloc.total_amount = Math.round((taxb + tax) * 100) / 100;
                                  return u;
                                });
                              }}
                              className="w-full px-2 py-1 border border-slate-300 rounded font-bold text-center focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>

                          <div>
                            <label className="block font-semibold text-slate-600 mb-1">Condition</label>
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
                              className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                            >
                              <option value="restock">Restock (Add to Batch)</option>
                              <option value="damaged">Damaged (Quarantine)</option>
                              <option value="discard">Discard</option>
                            </select>
                          </div>

                          <div>
                            <label className="block font-semibold text-slate-600 mb-1">Reason</label>
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
                              className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                            >
                              <option value="customer_return">Customer Return</option>
                              <option value="expired">Expired</option>
                              <option value="damaged">Damaged</option>
                              <option value="near_expiry">Near Expiry</option>
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

          {/* Sticky Reconciliation Totals Bar */}
          <div className="bg-slate-900 text-white px-6 py-3 shrink-0 flex items-center justify-between text-xs">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Stated Customer Total</span>
                <span className="text-sm font-bold font-mono">₹{totalCustomerAmount.toFixed(2)}</span>
              </div>
              <div className="h-6 w-px bg-slate-700" />
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Our Verified Credit</span>
                <span className="text-sm font-bold font-mono text-emerald-400">
                  ₹{ourCalculatedTotal.toFixed(2)}
                </span>
              </div>
              <div className="h-6 w-px bg-slate-700" />
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Net Variance</span>
                <span
                  className={`text-sm font-bold font-mono ${
                    Math.abs(totalVariance) > 0.01
                      ? totalVariance > 0
                        ? "text-rose-400"
                        : "text-amber-400"
                      : "text-slate-300"
                  }`}
                >
                  {totalVariance > 0 ? "+" : ""}₹{totalVariance.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-slate-400 text-xs">
                {creditNoteOption === "B"
                  ? "Option B: Multi-Credit Notes (1 per original invoice)"
                  : "Option A: Consolidated Credit Note"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Verification & Approval Modal */}
      {isApprovalModalOpen && selectedDn && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-6 h-6 text-emerald-600" />
                <h3 className="text-lg font-bold text-slate-800">Verify & Approve Debit Note</h3>
              </div>
              <button onClick={() => setIsApprovalModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-600">Customer Stated Amount:</span>
                <span className="font-bold font-mono">₹{selectedDn.customer_dn_amount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Our Verified Credit Amount:</span>
                <span className="font-bold font-mono text-emerald-700">
                  ₹{selectedDn.our_calculated_amount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2">
                <span className="text-slate-800 font-bold">Variance:</span>
                <span
                  className={`font-bold font-mono ${
                    selectedDn.variance > 0 ? "text-rose-600" : "text-emerald-700"
                  }`}
                >
                  {selectedDn.variance > 0 ? "+" : ""}₹{selectedDn.variance.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700">Verification Notes</label>
              <textarea
                placeholder="Optional notes regarding rate verification or variance acceptance..."
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsApprovalModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
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
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs shadow-sm"
              >
                Confirm Approval
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Issue Credit Note Modal */}
      {isIssueModalOpen && selectedDn && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Split className="w-6 h-6 text-indigo-600" />
                <h3 className="text-lg font-bold text-slate-800">Issue Credit Note(s)</h3>
              </div>
              <button onClick={() => setIsIssueModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                Issuing Credit Notes will generate official GST Credit Notes (CN-26-27-XXXX), restore stock into original batches, and update customer ledger balance.
              </p>

              <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 space-y-2">
                <div className="font-bold text-indigo-900">Credit Note Strategy:</div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="opt"
                      checked={creditNoteOption === "B"}
                      onChange={() => setCreditNoteOption("B")}
                      className="text-indigo-600"
                    />
                    <span>Option B: 1 Credit Note per Invoice (Recommended for GST portal)</span>
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="opt"
                      checked={creditNoteOption === "A"}
                      onChange={() => setCreditNoteOption("A")}
                      className="text-indigo-600"
                    />
                    <span>Option A: 1 Consolidated Credit Note</span>
                  </label>
                </div>
              </div>

              {creditNoteOption === "A" && (
                <div className="p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>
                    Note: GST Portal requires single invoice reference per CDNR row. Option A will consolidate invoices internally.
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsIssueModalOpen(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleIssueCreditNotes}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs shadow-sm"
              >
                Issue & Generate PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Debit Notes Report Modal */}
      {isReportModalOpen && reportData && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
                <h3 className="text-lg font-bold text-slate-800">Debit Notes Received & Ageing Report</h3>
              </div>
              <button onClick={() => setIsReportModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Totals Summary Cards */}
            <div className="grid grid-cols-4 gap-4 shrink-0 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-slate-500 block">Total Stated Value</span>
                <span className="text-base font-bold text-slate-800 font-mono">
                  ₹{reportData.totals.total_dn_amount.toFixed(2)}
                </span>
              </div>
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                <span className="text-emerald-700 block">Total Verified Credit</span>
                <span className="text-base font-bold text-emerald-800 font-mono">
                  ₹{reportData.totals.total_our_amount.toFixed(2)}
                </span>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <span className="text-amber-700 block">Net Variance</span>
                <span className="text-base font-bold text-amber-800 font-mono">
                  ₹{reportData.totals.total_variance.toFixed(2)}
                </span>
              </div>
              <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
                <span className="text-indigo-700 block">Pending Verification</span>
                <span className="text-base font-bold text-indigo-800">
                  {reportData.totals.pending_count} note(s)
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 font-bold text-slate-600 sticky top-0">
                  <tr>
                    <th className="p-2.5">DN Number</th>
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Customer</th>
                    <th className="p-2.5 text-right">Customer (₹)</th>
                    <th className="p-2.5 text-right">Verified (₹)</th>
                    <th className="p-2.5 text-right">Variance</th>
                    <th className="p-2.5 text-center">Ageing</th>
                    <th className="p-2.5 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reportData.entries.map((e: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-2.5 font-bold text-indigo-700">#{e.debit_note_number}</td>
                      <td className="p-2.5 text-slate-500">{e.debit_note_date}</td>
                      <td className="p-2.5 font-medium text-slate-800">{e.customer_name}</td>
                      <td className="p-2.5 text-right font-mono">₹{e.customer_dn_amount.toFixed(2)}</td>
                      <td className="p-2.5 text-right font-mono font-bold text-emerald-700">
                        ₹{e.our_calculated_amount.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-right font-mono font-bold">
                        {e.variance > 0 ? "+" : ""}₹{e.variance.toFixed(2)}
                      </td>
                      <td className="p-2.5 text-center">
                        <span
                          className={`px-2 py-0.5 rounded font-bold ${
                            e.is_delayed_verification
                              ? "bg-rose-100 text-rose-700 font-bold"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {e.ageing_days}d
                        </span>
                      </td>
                      <td className="p-2.5 text-center">
                        <span className="px-2 py-0.5 rounded uppercase font-bold text-[10px] bg-slate-100 text-slate-700">
                          {e.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setIsReportModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold"
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
