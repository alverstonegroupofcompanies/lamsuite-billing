import React, { useEffect, useState } from "react";
import { Invoice, InvoiceItem, type PaymentAllocationInput } from "../types";
import { api, ApiError } from "../services/api";
import { formatINR, formatDate, formatDateTime, formatIndianNumber } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { ConfirmModal } from "../components/ConfirmModal";
import { ConflictModal } from "../components/ConflictModal";
import { DocumentEditorModal, type DocumentKind } from "../components/transactions/DocumentEditorModal";
import { CustomerReceiptModal } from "../components/transactions/CustomerReceiptModal";
import { AllocationPicker } from "../components/transactions/AllocationPicker";
import { PurchaseChargesPanel } from "../components/transactions/PurchaseChargesPanel";
import { RowAction } from "../components/RowAction";
import { RecordInspector, type InspectorColumn } from "../components/RecordInspector";
import {
  Receipt,
  Search,
  Printer,
  Ban,
  FileText,
  Clock,
  CheckCircle2,
  Calendar,
  X,
  CreditCard,
  ShoppingBag,
  ArrowRightLeft,
  DollarSign,
  AlertTriangle,
  RefreshCw,
  Plus,
  Undo2,
  FileCheck2,
  Package,
  Layers,
  PauseCircle,
  KeyRound,
  Copy,
  ShieldCheck,
  Pencil,
  Trash2,
  ScrollText,
  Eye,
} from "lucide-react";

const todayInputValue = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

// Backend date casts serialize as UTC ISO (e.g. 2026-11-16T18:30:00Z for IST
// midnight on the 17th); slice(0, 10) would shift the day back.
const toDateInputValue = (value: unknown): string => {
  if (!value) return "";
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw.slice(0, 10);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

/**
 * Every list on this page is a document the till wrote and the server filed, so each row gets the
 * same affordance: read the record the panel has, without leaving the table. The inspector renders
 * from the row while `/admin/.../{id}` fills in the lines a list query does not carry.
 */
type InspectorRequest = Omit<React.ComponentProps<typeof RecordInspector>, "onClose">;

const SALE_LINES: InspectorColumn[] = [
  { label: "Item", render: (l) => l.product_name || l.product?.name },
  { label: "Batch", mono: true, render: (l) => l.batch_no },
  { label: "Qty", align: "right", mono: true, render: (l) => l.qty },
  { label: "Rate", align: "right", money: true, render: (l) => l.unit_price ?? l.rate },
  { label: "GST %", align: "right", mono: true, render: (l) => l.gst_percent },
  { label: "Tax", align: "right", money: true, render: (l) => l.tax_amount },
  { label: "Line Total", align: "right", money: true, render: (l) => l.total_amount },
];

const PURCHASE_LINES: InspectorColumn[] = [
  { label: "Item", render: (l) => l.product_name || l.product?.name },
  { label: "HSN", mono: true, render: (l) => l.hsn_code },
  { label: "Batch", mono: true, render: (l) => l.batch_no },
  { label: "Qty", align: "right", mono: true, render: (l) => l.qty },
  { label: "Free", align: "right", mono: true, render: (l) => l.free_qty },
  { label: "Rate", align: "right", money: true, render: (l) => l.purchase_rate },
  { label: "GST %", align: "right", mono: true, render: (l) => l.gst_percent },
  { label: "Total", align: "right", money: true, render: (l) => l.total_amount },
];

const CART_LINES: InspectorColumn[] = [
  { label: "Item", render: (l) => l.product_name || l.name || l.product?.name },
  { label: "Batch", mono: true, render: (l) => l.batch_no },
  { label: "Qty", align: "right", mono: true, render: (l) => l.qty },
  { label: "Rate", align: "right", money: true, render: (l) => l.rate ?? l.unit_price },
  { label: "Total", align: "right", money: true, render: (l) => l.total ?? l.total_amount },
];

const TRANSFER_LINES: InspectorColumn[] = [
  { label: "Item", render: (l) => l.product?.name || l.product_name },
  { label: "Batch", mono: true, render: (l) => l.batch_no },
  { label: "Dispatched", align: "right", mono: true, render: (l) => l.qty },
  { label: "Received", align: "right", mono: true, render: (l) => l.received_qty },
  { label: "Short", align: "right", mono: true, render: (l) => l.short_qty },
  { label: "Reason", render: (l) => l.shortage_reason },
];

const inspectInvoice = (inv: any): InspectorRequest => ({
  kind: "Sales Invoice",
  heading: inv.invoice_number,
  subheading: `${formatDate(inv.invoice_date)} • ${inv.store?.name || `Store #${inv.store_id}`}`,
  endpoint: `/admin/invoices/${inv.id}`,
  row: inv,
  columns: SALE_LINES,
  fields: (r) => [
    { label: "Customer", value: r.customer_name },
    { label: "Counter", value: r.counter_name || r.counter?.counter_name },
    { label: "Cashier", value: r.created_by?.name || r.cashier_name || r.user?.name },
    { label: "Payment Mode", value: (r.payments || []).map((p: any) => p.payment_mode).join(", ") || r.payment_mode },
    { label: "Place of Supply", value: r.place_of_supply, mono: true },
    { label: "Status", value: r.status },
  ],
  totals: (r) => [
    { label: "Taxable Value", value: r.taxable_amount ?? r.subtotal, money: true },
    { label: "Discount", value: r.discount_amount, money: true },
    { label: "Tax Total", value: r.tax_total, money: true },
    { label: "Grand Total", value: r.grand_total, money: true, strong: true },
  ],
});

const inspectCreditNote = (ret: any): InspectorRequest => ({
  kind: "Sales Return / Credit Note",
  heading: ret.invoice_number,
  subheading: `${formatDate(ret.invoice_date)} • ${ret.store?.name || `Store #${ret.store_id}`}`,
  endpoint: `/admin/invoices/${ret.id}`,
  row: ret,
  columns: SALE_LINES,
  fields: (r) => [
    { label: "Customer", value: r.customer_name },
    { label: "Against Invoice", value: r.reference_invoice_number || r.original_invoice_number, mono: true },
    { label: "Refund Mode", value: r.payment_mode || r.refund_mode || (r.payments || [])[0]?.payment_mode },
    { label: "Counter", value: r.counter_name || r.counter?.counter_name },
    { label: "Till Document No", value: r.document_number, mono: true },
    { label: "Status", value: r.status || "issued" },
  ],
  totals: (r) => [
    { label: "Taxable Value", value: r.taxable_amount ?? r.subtotal, money: true },
    { label: "Tax Refunded", value: r.tax_total, money: true, tone: "credit" },
    { label: "Credit Amount", value: r.grand_total, money: true, strong: true, tone: "credit" },
  ],
  note:
    "A credit note reverses a sale. Stock went back to the batch and the customer ledger was credited when it was " +
    "filed; correcting one means raising a fresh bill, not cancelling this — cancelling would move the stock a second time.",
});

const inspectPurchase = (p: any): InspectorRequest => ({
  kind: "Inward Purchase Bill",
  heading: p.supplier_invoice_no || p.invoice_number,
  subheading: `${formatDate(p.invoice_date)} • ${p.store?.name || `Store #${p.store_id}`}`,
  endpoint: `/admin/purchases/${p.id}`,
  row: p,
  columns: PURCHASE_LINES,
  fields: (r) => [
    { label: "Supplier", value: r.supplier_name || r.supplier?.name },
    { label: "Supplier GSTIN", value: r.supplier_gstin, mono: true },
    { label: "Server Doc No", value: r.invoice_number, mono: true },
    { label: "Till Doc No", value: r.document_number, mono: true },
    { label: "Payment Terms", value: r.payment_terms },
    { label: "Status", value: r.status },
  ],
  totals: (r) => [
    { label: "Taxable Value", value: r.taxable_amount ?? r.subtotal, money: true },
    { label: "Charges", value: r.charge_register?.charge_total ?? r.charge_total, money: true },
    { label: "Tax Total", value: r.tax_total, money: true },
    { label: "Payable", value: r.grand_total, money: true, strong: true },
  ],
});

const inspectDebitNote = (pr: any): InspectorRequest => ({
  kind: "Purchase Return / Debit Note",
  heading: pr.invoice_number,
  subheading: `${formatDate(pr.invoice_date)} • ${pr.store?.name || `Store #${pr.store_id}`}`,
  endpoint: `/admin/purchases/${pr.id}`,
  row: pr,
  lineKey: "items",
  columns: PURCHASE_LINES,
  fields: (r) => [
    { label: "Supplier", value: r.supplier_name || r.supplier?.name },
    { label: "Supplier GSTIN", value: r.supplier_gstin, mono: true },
    { label: "Till Doc No", value: r.document_number, mono: true },
    { label: "Against Bill", value: r.reference_invoice_number || r.original_invoice_number, mono: true },
    { label: "Reason", value: r.notes },
    { label: "Status", value: r.status },
  ],
  totals: (r) => [
    { label: "Taxable Value", value: r.taxable_amount ?? r.subtotal, money: true },
    { label: "Tax", value: r.tax_total, money: true, tone: "credit" },
    { label: "Debit Total", value: r.grand_total, money: true, strong: true, tone: "credit" },
  ],
});

const inspectQuotation = (q: any): InspectorRequest => ({
  kind: "Quotation / Estimate",
  heading: q.invoice_number,
  subheading: `${formatDate(q.invoice_date)} • ${q.store?.name || `Store #${q.store_id}`}`,
  row: q,
  columns: SALE_LINES,
  fields: (r) => [
    { label: "Customer", value: r.customer_name },
    { label: "Till Doc No", value: r.document_number, mono: true },
    { label: "Counter", value: r.counter_name || r.counter?.counter_name },
    { label: "Valid Till", value: r.valid_till ? formatDate(r.valid_till) : undefined },
    { label: "Status", value: r.status || "issued" },
  ],
  totals: (r) => [
    { label: "Taxable Value", value: r.taxable_amount ?? r.subtotal, money: true },
    { label: "Tax Total", value: r.tax_total, money: true },
    { label: "Estimate Total", value: r.grand_total, money: true, strong: true },
  ],
});

const inspectPurchaseOrder = (po: any): InspectorRequest => ({
  kind: "Purchase Order",
  heading: po.invoice_number,
  subheading: `${formatDate(po.invoice_date)} • ${po.store?.name || `Store #${po.store_id}`}`,
  row: po,
  columns: PURCHASE_LINES,
  fields: (r) => [
    { label: "Supplier", value: r.supplier_name || r.supplier?.name },
    { label: "Expected Delivery", value: r.expected_delivery_date ? formatDate(r.expected_delivery_date) : undefined },
    { label: "Till Doc No", value: r.document_number, mono: true },
    { label: "Notes", value: r.notes },
    { label: "Status", value: r.status },
  ],
  totals: (r) => [
    { label: "Taxable Value", value: r.taxable_amount ?? r.subtotal, money: true },
    { label: "Tax Total", value: r.tax_total, money: true },
    { label: "Estimated Amount", value: r.grand_total, money: true, strong: true },
  ],
});

// HeldBill parks held_at as an integer epoch the till wrote with Date.now(), so it is milliseconds;
// every other document on this page carries a real datetime, so the buffer row needs its own reader.
const formatHeldAt = (value: unknown): string => {
  const epoch = Number(value);
  if (Number.isFinite(epoch) && epoch > 0) {
    // Anything below a trillion is a second count, above it a millisecond count (2001-09-09 onward).
    const ms = epoch > 1e12 ? epoch : epoch * 1000;
    return formatDateTime(new Date(ms).toISOString());
  }
  return value ? formatDateTime(String(value)) : "—";
};

const inspectHeldBill = (hb: any): InspectorRequest => ({
  kind: "Held Bill",
  heading: String(hb.id),
  subheading: `Held ${formatHeldAt(hb.held_at)}`,
  endpoint: `/admin/held-bills/${hb.id}`,
  row: hb,
  lineKey: "cart_payload.items",
  columns: CART_LINES,
  linesEmpty: "This held cart was parked without a line breakdown.",
  fields: (r) => [
    { label: "Customer", value: r.customer_name },
    { label: "Counter", value: r.held_by_counter_name },
    { label: "Held By", value: r.held_by_user_name },
    { label: "Items", value: r.items_count, mono: true },
    { label: "Claimed By", value: r.claimed_by_counter_id ? `Counter #${r.claimed_by_counter_id}` : undefined },
    { label: "Status", value: r.status },
  ],
  totals: (r) => [{ label: "Cart Value", value: r.grand_total, money: true, strong: true }],
  note: "A held bill is a parked cart, not a posted transaction — no stock or ledger has moved for it.",
});

const inspectShift = (s: any): InspectorRequest => ({
  kind: "Counter Shift",
  heading: `Shift #${s.id}`,
  subheading: `${s.counter?.counter_code || "Counter"} • opened ${formatDateTime(s.opened_at)}`,
  row: s,
  fields: (r) => [
    { label: "Cashier", value: r.opened_by?.name },
    { label: "Opened Via", value: r.opened_via, mono: true },
    { label: "Closed By", value: r.closed_by?.name },
    { label: "Closed At", value: r.closed_at ? formatDateTime(r.closed_at) : undefined },
    { label: "Status", value: r.status },
  ],
  totals: (r) => [
    { label: "Opening Float", value: r.opening_float, money: true },
    { label: "Cash Sales", value: r.cash_sales, money: true },
    { label: "Cash Refunds", value: r.cash_refunds, money: true, tone: "credit" },
    { label: "Cash In / Drops", value: r.cash_in, money: true },
    { label: "Digital Sales", value: r.digital_sales, money: true },
    { label: "Expected Cash", value: r.expected_cash, money: true },
    { label: "Counted Cash", value: r.closing_cash_actual, money: true, strong: true },
    { label: "Discrepancy", value: r.closing_discrepancy, money: true, strong: true },
  ],
  note: "The drawer figures come from the till's own cash close. A day can only be reopened from Day Close.",
});

const inspectTransfer = (t: any): InspectorRequest => ({
  kind: "Stock Transfer",
  heading: t.transfer_number,
  subheading: `${formatDate(t.created_at)} • ${t.from_store?.name || `Store #${t.from_store_id}`} → ${
    t.to_store?.name || `Store #${t.to_store_id}`
  }`,
  row: t,
  columns: TRANSFER_LINES,
  linesEmpty: "This transfer has no batch lines recorded.",
  fields: (r) => [
    { label: "Dispatched By", value: r.creator?.name },
    { label: "Approved By", value: r.approved_by?.name },
    { label: "Received At", value: r.received_at ? formatDateTime(r.received_at) : undefined },
    { label: "Notes", value: r.notes },
    { label: "Status", value: r.status },
  ],
  note: "Stock moves on goods receipt, which is recorded under Inventory → Inter-Store Transfers.",
});

const inspectReceipt = (p: any): InspectorRequest => ({
  kind: "Customer Receipt",
  heading: p.reference_no || `REC-${p.id}`,
  subheading: `${formatDate(p.payment_date)} • ${p.store?.name || `Store #${p.store_id}`}`,
  row: p,
  fields: (r) => [
    { label: "Customer", value: r.customer?.name || `Customer #${r.customer_id}` },
    { label: "Phone", value: r.customer?.phone, mono: true },
    { label: "Payment Mode", value: r.payment_mode },
    { label: "Recorded By", value: r.creator?.name },
    { label: "Notes", value: r.notes },
  ],
  totals: (r) => [{ label: "Amount Received", value: r.amount, money: true, strong: true, tone: "received" }],
  note: "Money the customer paid in. What it settled against is listed in the customer ledger under Master Data.",
});

const inspectPayout = (sp: any): InspectorRequest => ({
  kind: "Supplier Disbursement",
  heading: sp.reference_no || `PAY-${sp.id}`,
  subheading: `${formatDate(sp.payment_date)} • ${sp.store?.name || `Store #${sp.store_id}`}`,
  row: sp,
  fields: (r) => [
    { label: "Supplier", value: r.supplier?.name || `Supplier #${r.supplier_id}` },
    { label: "GSTIN", value: r.supplier?.gstin, mono: true },
    { label: "Payment Mode", value: r.payment_mode },
    { label: "Recorded By", value: r.creator?.name },
    { label: "Notes", value: r.notes },
  ],
  totals: (r) => [{ label: "Amount Disbursed", value: r.amount, money: true, strong: true, tone: "credit" }],
});

const inspectExpense = (e: any): InspectorRequest => ({
  kind: "Expense Voucher",
  heading: e.expense_number || e.reference_no || `#${e.id}`,
  subheading: `${formatDate(e.expense_date)} • ${e.store?.name || `Store #${e.store_id}`}`,
  row: e,
  fields: (r) => [
    { label: "Expense Head", value: r.expense_head },
    { label: "Payment Mode", value: r.payment_mode },
    { label: "Reference", value: r.reference_no, mono: true },
    { label: "Recorded By", value: r.creator?.name },
    { label: "Notes", value: r.notes },
  ],
  totals: (r) => [{ label: "Amount", value: r.amount, money: true, strong: true, tone: "credit" }],
});

export const TransactionsPage: React.FC = () => {
  const { hasPermission, activeStore, role, isAllStores } = useAuth();
  const canIssueEditPin =
    hasPermission("transactions", "edit") &&
    ["super_admin", "store_owner", "admin"].includes(role || "");
  const [activeTab, setActiveTab] = useState<
    | "invoices"
    | "returns"
    | "quotations"
    | "purchases"
    | "purchase_returns"
    | "purchase_orders"
    | "transfers"
    | "expenses"
    | "payments"
    | "supplier_payments"
    | "held_bills"
    | "shifts"
    | "purchase_charges"
  >("invoices");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [returnsList, setReturnsList] = useState<any[]>([]);
  const [quotationsList, setQuotationsList] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [purchaseReturnsList, setPurchaseReturnsList] = useState<any[]>([]);
  const [purchaseOrdersList, setPurchaseOrdersList] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [supplierPaymentsList, setSupplierPaymentsList] = useState<any[]>([]);
  const [heldBillsList, setHeldBillsList] = useState<any[]>([]);
  const [shiftsList, setShiftsList] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Invoice Details & Print Modal
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  // Cancellation Modal state
  const [cancelModalInvoice, setCancelModalInvoice] = useState<Invoice | null>(null);

  // One-time edit/cancel approval state
  const [approvalInvoice, setApprovalInvoice] = useState<Invoice | null>(null);
  const [approvalAction, setApprovalAction] = useState<"edit" | "cancel">("edit");
  const [approvalStaff, setApprovalStaff] = useState<Array<{ id: number | string; name: string; username?: string; role?: string }>>([]);
  const [approvalUserId, setApprovalUserId] = useState("");
  const [approvalMinutes, setApprovalMinutes] = useState(10);
  const [approvalReason, setApprovalReason] = useState("");
  const [issuedApprovalPin, setIssuedApprovalPin] = useState("");
  const [isIssuingApproval, setIsIssuingApproval] = useState(false);
  const [approvalRows, setApprovalRows] = useState<Array<{ id: string; action: string; mode: string; status: string; approved_by_name?: string; expires_at?: string; used_at?: string }>>([]);
  const [isLoadingApprovals, setIsLoadingApprovals] = useState(false);

  // Conflict state
  const [conflictState, setConflictState] = useState<{
    isOpen: boolean;
    currentVersion?: number;
    clientVersion?: number;
  }>({ isOpen: false });

  // Supplier Payment Modal
  const [isSupplierPayModalOpen, setIsSupplierPayModalOpen] = useState(false);
  const [supplierPaySupplierId, setSupplierPaySupplierId] = useState("");
  const [supplierPayAmount, setSupplierPayAmount] = useState("");
  const [supplierPayMode, setSupplierPayMode] = useState("Bank Transfer");
  const [supplierPayRef, setSupplierPayRef] = useState("");
  const [supplierPayNotes, setSupplierPayNotes] = useState("");
  const [supplierPayAllocations, setSupplierPayAllocations] = useState<PaymentAllocationInput[] | undefined>(undefined);
  const [suppliersList, setSuppliersList] = useState<any[]>([]);

  // Expense Voucher Modal
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [expenseHead, setExpenseHead] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseMode, setExpenseMode] = useState("Cash");
  const [expenseRef, setExpenseRef] = useState("");
  const [expenseNotes, setExpenseNotes] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayInputValue());
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [expenseDeleteTarget, setExpenseDeleteTarget] = useState<any | null>(null);
  const [expenseFeedback, setExpenseFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  // Quotation / purchase-order editor + customer receipt
  const [docEditor, setDocEditor] = useState<{ kind: DocumentKind; doc: any | null } | null>(null);
  const [inspector, setInspector] = useState<InspectorRequest | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const isPharmacy = Boolean(activeStore && (activeStore.store_type || "pharmacy") === "pharmacy");

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      const storeParam = activeStore?.id ? { active_store_id: activeStore.id } : {};

      if (activeTab === "invoices") {
        const res = await api.get<{
          data: Invoice[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/invoices", {
          ...storeParam,
          search,
          status: statusFilter,
          page,
          per_page: perPage,
        });
        setInvoices(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "returns") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/returns", {
          ...storeParam,
          search,
          page,
          per_page: perPage,
        });
        setReturnsList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "quotations") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/quotations", {
          ...storeParam,
          search,
          status: statusFilter,
          page,
          per_page: perPage,
        });
        setQuotationsList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "purchases") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/purchases", {
          ...storeParam,
          search,
          page,
          per_page: perPage,
        });
        setPurchases(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "purchase_returns") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/purchase-returns", {
          ...storeParam,
          search,
          page,
          per_page: perPage,
        });
        setPurchaseReturnsList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "purchase_orders") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/purchase-orders", {
          ...storeParam,
          search,
          page,
          per_page: perPage,
        });
        setPurchaseOrdersList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "transfers") {
        const res = await api.get<{ data: any[] }>("/admin/stock/transfers", storeParam);
        setTransfers(res.data || []);
      } else if (activeTab === "expenses") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/expenses", {
          ...storeParam,
          search,
          page,
          per_page: perPage,
        });
        setExpenses(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "payments") {
        const res = await api.get<{ data: any[] }>("/admin/customer-payments", storeParam);
        setPayments(res.data || []);
      } else if (activeTab === "supplier_payments") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/supplier-payments", {
          ...storeParam,
          page,
          per_page: perPage,
        });
        setSupplierPaymentsList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "held_bills") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/held-bills", {
          ...storeParam,
          search,
          page,
          per_page: perPage,
        });
        setHeldBillsList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "shifts") {
        const res = await api.get<{
          data: any[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/shifts", {
          ...storeParam,
          page,
          per_page: perPage,
        });
        setShiftsList(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      }
    } catch (err) {
      console.error("Failed to load transactions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [activeTab, search, statusFilter, activeStore, page, perPage]);

  // Reset page when switching filters or tab
  useEffect(() => {
    setPage(1);
    setSearch("");
    setStatusFilter("");
  }, [activeTab]);

  const loadSuppliers = async () => {
    try {
      const res = await api.get<{ data: any[] }>("/admin/parties", {
        type: "supplier",
        per_page: 200,
        active_store_id: activeStore?.id,
      });
      setSuppliersList(res.data || []);
      return res.data || [];
    } catch (e) {
      console.error("Failed to load suppliers:", e);
      return [];
    }
  };

  // A purchase row pays the supplier it was billed under, so the row opens the same disbursement
  // modal the header button does with that supplier already selected.
  const openSupplierPaymentFor = async (supplierId: number | string, supplierName?: string) => {
    if (!activeStore) {
      setActionFeedback({ kind: "error", message: "Select a specific store before recording a supplier payment." });
      return;
    }
    const list = await loadSuppliers();
    if (!list.some((s) => String(s.id) === String(supplierId))) {
      setSuppliersList((prev) => [...prev, { id: supplierId, name: supplierName || `Supplier #${supplierId}` }]);
    }
    setSupplierPayAmount("");
    setSupplierPayAllocations(undefined);
    setSupplierPaySupplierId(String(supplierId));
    setIsSupplierPayModalOpen(true);
  };

  const handleCreateSupplierPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore || !supplierPaySupplierId || !supplierPayAmount) return;

    try {
      const res = await api.post<{ allocated_amount?: number; unallocated_amount?: number }>(
        "/admin/supplier-payments",
        {
          store_id: activeStore.id,
          supplier_id: supplierPaySupplierId,
          amount: Number(supplierPayAmount),
          payment_mode: supplierPayMode,
          reference_no: supplierPayRef,
          notes: supplierPayNotes,
          ...(supplierPayAllocations && supplierPayAllocations.length > 0
            ? { allocations: supplierPayAllocations }
            : {}),
        }
      );
      const paid = Number(supplierPayAmount);
      const settled = Number(res?.allocated_amount || 0);
      const onAccount = Number(res?.unallocated_amount || 0);
      setIsSupplierPayModalOpen(false);
      setSupplierPayAmount("");
      setSupplierPayRef("");
      setSupplierPayNotes("");
      setSupplierPayAllocations(undefined);
      setActionFeedback({
        kind: "success",
        message:
          settled > 0
            ? `Disbursed ${formatINR(paid)} — ${formatINR(settled)} settled against purchase bills` +
              (onAccount > 0 ? `, ${formatINR(onAccount)} left on account.` : ".")
            : `Disbursed ${formatINR(paid)} — no open purchase bills to settle.`,
      });
      await fetchTransactions();
    } catch (err: any) {
      alert(err?.message || "Failed to record supplier payment.");
    }
  };

  const handleConvertQuotation = async (quotation: any) => {
    if (
      !window.confirm(
        `Convert ${quotation.invoice_number} into a credit invoice for ${quotation.customer_name}? The customer ledger will be debited.`
      )
    ) {
      return;
    }
    try {
      const res = await api.post<{ invoice?: { invoice_number?: string } }>(
        `/admin/quotations/${quotation.id}/convert`
      );
      setActionFeedback({
        kind: "success",
        message: `Converted to invoice ${res.invoice?.invoice_number || ""}.`.trim(),
      });
      await fetchTransactions();
    } catch (err: any) {
      setActionFeedback({ kind: "error", message: err?.message || "Conversion failed." });
    }
  };

  const handleDeleteQuotation = async (quotation: any) => {
    if (!window.confirm(`Delete quotation ${quotation.invoice_number}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/quotations/${quotation.id}`);
      setActionFeedback({ kind: "success", message: "Quotation deleted." });
      await fetchTransactions();
    } catch (err: any) {
      setActionFeedback({ kind: "error", message: err?.message || "Delete failed." });
    }
  };

  const handleReceivePurchaseOrder = async (order: any) => {
    const invoiceNo = window.prompt(
      `Record goods receipt for ${order.invoice_number}?\n\nSupplier invoice / GRN reference (leave blank to auto-number):`,
      ""
    );
    if (invoiceNo === null) return;
    try {
      const res = await api.post<{ purchase?: { invoice_number?: string } }>(
        `/admin/purchase-orders/${order.id}/receive`,
        { supplier_invoice_no: invoiceNo.trim() || undefined }
      );
      setActionFeedback({
        kind: "success",
        message: `Goods receipt ${res.purchase?.invoice_number || ""} recorded; order completed.`.trim(),
      });
      await fetchTransactions();
    } catch (err: any) {
      setActionFeedback({ kind: "error", message: err?.message || "Goods receipt failed." });
    }
  };

  const handleDeletePurchaseOrder = async (order: any) => {
    if (!window.confirm(`Delete purchase order ${order.invoice_number}? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/purchase-orders/${order.id}`);
      setActionFeedback({ kind: "success", message: "Purchase order deleted." });
      await fetchTransactions();
    } catch (err: any) {
      setActionFeedback({ kind: "error", message: err?.message || "Delete failed." });
    }
  };

  const openExpenseModal = (expense?: any) => {    if (!activeStore) {
      setExpenseFeedback({ kind: "error", message: "Select a specific store before recording an expense." });
      return;
    }
    if (expense) {
      setEditingExpense(expense);
      setExpenseHead(expense.expense_head || "");
      setExpenseAmount(String(expense.amount ?? ""));
      setExpenseMode(expense.payment_mode || "Cash");
      setExpenseRef(expense.reference_no || "");
      setExpenseNotes(expense.notes || "");
      setExpenseDate(toDateInputValue(expense.expense_date) || todayInputValue());
    } else {
      setEditingExpense(null);
      setExpenseHead("");
      setExpenseAmount("");
      setExpenseMode("Cash");
      setExpenseRef("");
      setExpenseNotes("");
      setExpenseDate(todayInputValue());
    }
    setExpenseFeedback(null);
    setIsExpenseModalOpen(true);
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore) {
      setExpenseFeedback({ kind: "error", message: "Select a specific store before recording an expense." });
      return;
    }
    setIsSavingExpense(true);
    try {
      const payload = {
        store_id: activeStore.id,
        expense_head: expenseHead.trim(),
        amount: Number(expenseAmount),
        payment_mode: expenseMode,
        reference_no: expenseRef.trim() || undefined,
        notes: expenseNotes.trim() || undefined,
        expense_date: expenseDate,
      };
      if (editingExpense) {
        await api.put(`/admin/expenses/${editingExpense.id}`, payload);
      } else {
        await api.post("/admin/expenses", payload);
      }
      setIsExpenseModalOpen(false);
      setExpenseFeedback({ kind: "success", message: editingExpense ? "Expense updated." : "Expense recorded." });
      await fetchTransactions();
    } catch (err: any) {
      setExpenseFeedback({ kind: "error", message: err?.message || "Failed to save expense." });
    } finally {
      setIsSavingExpense(false);
    }
  };

  const handleDeleteExpense = async () => {
    if (!expenseDeleteTarget) return;
    try {
      await api.delete(`/admin/expenses/${expenseDeleteTarget.id}`);
      setExpenseDeleteTarget(null);
      setExpenseFeedback({ kind: "success", message: "Expense deleted." });
      await fetchTransactions();
    } catch (err: any) {
      setExpenseDeleteTarget(null);
      setExpenseFeedback({ kind: "error", message: err?.message || "Failed to delete expense." });
    }
  };

  const handleCancelInvoice = async (reason: string) => {
    if (!cancelModalInvoice) return;

    try {
      await api.post(`/admin/invoices/${cancelModalInvoice.id}/cancel`, { reason });
      setCancelModalInvoice(null);
      await fetchTransactions();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictState({
          isOpen: true,
          currentVersion: err.data?.current_version,
          clientVersion: cancelModalInvoice.version,
        });
      } else {
        alert(err.message || "Failed to cancel invoice.");
      }
    }
  };

  const loadApprovalRows = async (invoiceId: number) => {
    setIsLoadingApprovals(true);
    try {
      const res = await api.get<{ success: boolean; approvals: typeof approvalRows }>(
        `/admin/invoices/${invoiceId}/edit-approvals`
      );
      setApprovalRows(res.approvals || []);
    } catch {
      setApprovalRows([]);
    } finally {
      setIsLoadingApprovals(false);
    }
  };

  const openApprovalModal = async (invoice: Invoice) => {
    setApprovalInvoice(invoice);
    setApprovalAction("edit");
    setApprovalUserId("");
    setApprovalMinutes(10);
    setApprovalReason("");
    setIssuedApprovalPin("");
    setApprovalRows([]);
    void loadApprovalRows(invoice.id);
    try {
      const res = await api.get<{ data: Array<{ id: number; name: string; username?: string; role?: string }> }>(
        "/admin/users",
        { store_id: invoice.store_id }
      );
      setApprovalStaff(res.data || []);
    } catch {
      setApprovalStaff([]);
    }
  };

  const handleIssueApproval = async () => {
    if (!approvalInvoice) return;
    if (!approvalUserId) {
      alert("Select the staff member who will use the one-time PIN.");
      return;
    }
    setIsIssuingApproval(true);
    try {
      const res = await api.post<{ success: boolean; pin: string; message?: string }>(
        `/admin/invoices/${approvalInvoice.id}/edit-approvals`,
        {
          action: approvalAction,
          user_id: approvalUserId,
          minutes: approvalMinutes,
          reason: approvalReason.trim() || undefined,
        }
      );
      setIssuedApprovalPin(res.pin);
      await loadApprovalRows(approvalInvoice.id);
    } catch (err: any) {
      alert(err?.message || "Failed to issue one-time PIN.");
    } finally {
      setIsIssuingApproval(false);
    }
  };

  const handleRevokeApproval = async (approvalId: string) => {
    if (!approvalInvoice) return;
    try {
      await api.post(`/admin/invoices/${approvalInvoice.id}/edit-approvals/${approvalId}/revoke`, {});
      await loadApprovalRows(approvalInvoice.id);
    } catch (err: any) {
      alert(err?.message || "Failed to revoke approval.");
    }
  };

  const copyIssuedPin = async () => {
    try {
      await navigator.clipboard.writeText(issuedApprovalPin);
    } catch {
      // Clipboard access can be denied; the PIN remains visible for manual copy.
    }
  };

  return (
    <div className="space-y-6">
      {/* Title & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Transactions & Ledgers
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Immutable fiscal audit log, sales returns, purchase orders, held bills, counter shifts, and supplier disbursements.
          </p>
        </div>

        {activeTab === "expenses" && hasPermission("transactions", "create") && (
          <button
            onClick={() => openExpenseModal()}
            disabled={!activeStore}
            title={activeStore ? "Record a new expense voucher" : "Switch to a specific store to record expenses"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Record Expense</span>
          </button>
        )}

        {activeTab === "supplier_payments" && hasPermission("transactions", "create") && (
          <button
            onClick={() => {
              loadSuppliers();
              setIsSupplierPayModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Record Supplier Payout</span>
          </button>
        )}

        {activeTab === "quotations" && hasPermission("transactions", "create") && (
          <button
            onClick={() => setDocEditor({ kind: "quotation", doc: null })}
            disabled={!activeStore}
            title={activeStore ? "Create a quotation" : "Switch to a specific store first"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Quotation</span>
          </button>
        )}

        {activeTab === "purchase_orders" && hasPermission("transactions", "create") && (
          <button
            onClick={() => setDocEditor({ kind: "purchase_order", doc: null })}
            disabled={!activeStore}
            title={activeStore ? "Create a purchase order" : "Switch to a specific store first"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Purchase Order</span>
          </button>
        )}

        {activeTab === "payments" && hasPermission("transactions", "create") && (
          <button
            onClick={() => setIsReceiptModalOpen(true)}
            disabled={!activeStore}
            title={activeStore ? "Record a customer receipt" : "Switch to a specific store first"}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold rounded-xl shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Record Customer Receipt</span>
          </button>
        )}
      </div>

      {actionFeedback && (
        <div
          className={`flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium ${
            actionFeedback.kind === "success"
              ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-200"
              : "bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200"
          }`}
        >
          <span>{actionFeedback.message}</span>
          <button onClick={() => setActionFeedback(null)} className="opacity-60 hover:opacity-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Tabs Toolbar */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 sm:gap-2 text-xs font-semibold overflow-x-auto pb-px">
        {[
          { id: "invoices", label: "Sales Invoices", icon: Receipt },
          { id: "returns", label: "Sales Returns & Credit Notes", icon: Undo2 },
          { id: "quotations", label: "Quotations & Estimates", icon: FileText },
          { id: "purchases", label: "Inward Purchases", icon: ShoppingBag },
          { id: "purchase_returns", label: "Purchase Returns", icon: ArrowRightLeft },
          { id: "purchase_orders", label: "Purchase Orders", icon: FileCheck2 },
          { id: "purchase_charges", label: "Bill Charges", icon: ScrollText },
          { id: "held_bills", label: "Held Bills", icon: PauseCircle },
          { id: "shifts", label: "Shifts & Cash Close", icon: Layers },
          { id: "transfers", label: "Stock Transfers", icon: Package },
          { id: "expenses", label: "Expenses", icon: DollarSign },
          { id: "payments", label: "Customer Receipts", icon: CreditCard },
          { id: "supplier_payments", label: "Supplier Payments", icon: DollarSign },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 px-2 flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                isActive
                  ? "border-brand-600 text-brand-600 dark:text-brand-400 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Search & Filter Toolbar */}
      {/* The charges register owns its filters — head, treatment, payable membership and a bill-date
          range are not expressible in one search box, and a second box beside them reads as a bug. */}
      {activeTab !== "purchase_charges" && (
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeTab.replace("_", " ")}...`}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {(activeTab === "invoices" || activeTab === "quotations") && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-hidden"
            >
              <option value="">All Statuses</option>
              {activeTab === "quotations" ? (
                <>
                  <option value="issued">Open Quote</option>
                  <option value="converted">Converted</option>
                  <option value="cancelled">Cancelled</option>
                </>
              ) : (
                <>
                  <option value="issued">Issued</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="paid">Paid</option>
                  <option value="draft">Draft</option>
                </>
              )}
            </select>
          )}

          <button
            onClick={() => fetchTransactions()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-200 transition-colors"
            title="Refresh transactions list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-brand-600" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      )}

      {/* Bill Charges — CR-C: the freight, packing and courier of every supplier bill, as rows */}
      {activeTab === "purchase_charges" && <PurchaseChargesPanel />}

      {/* Invoices Table */}
      {activeTab === "invoices" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Invoice No & Date</th>
                  {isAllStores && <th className="px-4 py-3">Store</th>}
                  <th className="px-4 py-3">{isPharmacy ? "Customer / Patient" : "Customer"}</th>
                  {isPharmacy && <th className="px-4 py-3">Prescription Doctor</th>}
                  <th className="px-4 py-3 text-right">Taxable</th>
                  <th className="px-4 py-3 text-right">Tax Total</th>
                  <th className="px-4 py-3 text-right">Grand Total</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={(isPharmacy ? 8 : 7) + (isAllStores ? 1 : 0)} className="px-4 py-8 text-center text-slate-400">
                      Loading invoices...
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={(isPharmacy ? 8 : 7) + (isAllStores ? 1 : 0)} className="px-4 py-8 text-center text-slate-400">
                      No invoices found.
                    </td>
                  </tr>
                ) : (
                  invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-mono">
                        <div className="font-bold text-slate-900 dark:text-white">{inv.invoice_number}</div>
                        <div className="text-[10px] text-slate-400">{formatDate(inv.invoice_date)}</div>
                      </td>
                      {isAllStores && (
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-700 dark:text-slate-300">{inv.store?.name || `Store #${inv.store_id}`}</div>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">{inv.customer_name}</div>
                        {isPharmacy && inv.patient_name && (
                          <div className="text-[10px] text-slate-400">Pt: {inv.patient_name}</div>
                        )}
                      </td>
                      {isPharmacy && (
                        <td className="px-4 py-3">
                          {inv.doctor_name ? (
                            <div>
                              <div className="font-medium text-slate-700 dark:text-slate-300">{inv.doctor_name}</div>
                              {inv.doctor_reg_no && (
                                <div className="text-[10px] text-slate-400 font-mono">Reg: {inv.doctor_reg_no}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-mono">{formatINR(inv.subtotal)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(inv.tax_total)}</td>
                      <td className="px-4 py-3 text-right font-bold font-mono text-slate-900 dark:text-white">
                        {formatINR(inv.grand_total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            inv.status === "issued" || inv.status === "paid"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                              : "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <RowAction icon={Eye} title="View invoice details" onClick={() => setInspector(inspectInvoice(inv))} tone="brand" />
                          <RowAction icon={Printer} title="View / Reprint Invoice" onClick={() => setSelectedInvoice(inv)} />

                          {(inv.status === "issued" || inv.status === "paid") && canIssueEditPin && (
                            <>
                              <RowAction
                                icon={KeyRound}
                                title="Issue One-Time Edit/Cancel PIN"
                                onClick={() => openApprovalModal(inv)}
                                tone="amber"
                              />
                              <RowAction
                                icon={Ban}
                                title="Cancel Invoice (Restores Stock & Adjusts Ledger)"
                                onClick={() => setCancelModalInvoice(inv)}
                                tone="rose"
                              />
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <div>
              Showing page <strong className="text-slate-800 dark:text-slate-200 font-semibold">{page}</strong> of{" "}
              <strong className="text-slate-800 dark:text-slate-200 font-semibold">{totalPages}</strong> ({totalCount.toLocaleString()} total)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sales Returns Table */}
      {activeTab === "returns" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Return / Credit Note No</th>
                {isAllStores && <th className="px-4 py-3">Store</th>}
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Tax Refunded</th>
                <th className="px-4 py-3 text-right">Credit Amount</th>
                <th className="px-4 py-3">Refund Mode</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {returnsList.length === 0 ? (
                <tr>
                  <td colSpan={isAllStores ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                    No sales returns or credit notes recorded.
                  </td>
                </tr>
              ) : (
                returnsList.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {r.invoice_number}
                      <div className="text-[10px] text-slate-400 font-normal">{formatDate(r.invoice_date)}</div>
                    </td>
                    {isAllStores && (
                      <td className="px-4 py-3 font-semibold">{r.store?.name || `Store #${r.store_id}`}</td>
                    )}
                    <td className="px-4 py-3 font-semibold">{r.customer_name}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(r.tax_total)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                      {formatINR(r.grand_total)}
                    </td>
                    <td className="px-4 py-3">{r.payment_mode || "Cash"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700">
                        {r.status || "issued"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <RowAction icon={Eye} title="View credit note" onClick={() => setInspector(inspectCreditNote(r))} tone="brand" />
                        <RowAction icon={Printer} title="Print credit note voucher" onClick={() => setSelectedInvoice(r as Invoice)} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Quotations Table */}
      {activeTab === "quotations" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Quotation No & Date</th>
                {isAllStores && <th className="px-4 py-3">Store</th>}
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Taxable</th>
                <th className="px-4 py-3 text-right">Tax Total</th>
                <th className="px-4 py-3 text-right">Estimate Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {quotationsList.length === 0 ? (
                <tr>
                  <td colSpan={isAllStores ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                    No pro-forma quotations or estimates recorded.
                  </td>
                </tr>
              ) : (
                quotationsList.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {q.invoice_number}
                      <div className="text-[10px] text-slate-400 font-normal">{formatDate(q.invoice_date)}</div>
                    </td>
                    {isAllStores && (
                      <td className="px-4 py-3 font-semibold">{q.store?.name || `Store #${q.store_id}`}</td>
                    )}
                    <td className="px-4 py-3 font-semibold">{q.customer_name}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(q.subtotal)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(q.tax_total)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(q.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                          (q.status || "issued") === "converted"
                            ? "bg-emerald-100 text-emerald-700"
                            : q.status === "cancelled"
                            ? "bg-red-100 text-red-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {(q.status || "issued") === "issued" ? "open quote" : q.status || "issued"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <RowAction icon={Eye} title="View quotation" onClick={() => setInspector(inspectQuotation(q))} tone="brand" />
                        {hasPermission("transactions", "edit") && q.status !== "converted" && q.status !== "cancelled" && (
                          <>
                            <button
                              onClick={() => setDocEditor({ kind: "quotation", doc: q })}
                              title="Edit quotation"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleConvertQuotation(q)}
                              title="Convert to credit invoice"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteQuotation(q)}
                              title="Delete quotation"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Inward Purchases Table */}
      {activeTab === "purchases" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Bill No & Date</th>
                {isAllStores && <th className="px-4 py-3">Store</th>}
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3">Supplier GSTIN</th>
                <th className="px-4 py-3 text-right">Charges</th>
                <th className="px-4 py-3 text-right">Tax Total</th>
                <th className="px-4 py-3 text-right">Grand Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={(isAllStores ? 9 : 8)} className="px-4 py-8 text-center text-slate-400">
                    No inward purchase bills recorded.
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {p.supplier_invoice_no || p.invoice_number}
                      {p.document_number && p.document_number !== (p.supplier_invoice_no || p.invoice_number) && (
                        <div className="text-[10px] text-slate-500 font-normal">Till {p.document_number}</div>
                      )}
                      <div className="text-[10px] text-slate-400">{formatDate(p.invoice_date)}</div>
                    </td>
                    {isAllStores && (
                      <td className="px-4 py-3 font-semibold">{p.store?.name || `Store #${p.store_id}`}</td>
                    )}
                    <td className="px-4 py-3 font-semibold">{p.supplier_name}</td>
                    <td className="px-4 py-3 font-mono">{p.supplier_gstin || "—"}</td>
                    {/* REP-007: the goods total and the charge total are two blocks, so the row can be
                        footed against the payable instead of hiding freight inside a tax column. */}
                    <td className="px-4 py-3 text-right font-mono">
                      {formatINR(p.charge_register?.charge_total ?? 0)}
                      {Number(p.charge_register?.separately_paid?.total ?? 0) > 0 && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400">
                          + {formatINR(p.charge_register.separately_paid.total)} outside
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(p.tax_total)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(p.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center capitalize font-semibold text-emerald-600">{p.status}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <RowAction icon={Eye} title="View purchase bill" onClick={() => setInspector(inspectPurchase(p))} tone="brand" />
                        {p.supplier_id && activeStore && hasPermission("transactions", "create") && (
                          <RowAction
                            icon={CreditCard}
                            title="Record a payment to this supplier"
                            onClick={() => openSupplierPaymentFor(p.supplier_id, p.supplier_name)}
                            tone="emerald"
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchase Returns Table */}
      {activeTab === "purchase_returns" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Debit Note No & Date</th>
                {isAllStores && <th className="px-4 py-3">Store</th>}
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3 text-right">Debit Total</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchaseReturnsList.length === 0 ? (
                <tr>
                  <td colSpan={isAllStores ? 6 : 5} className="px-4 py-8 text-center text-slate-400">
                    No purchase return debit notes recorded.
                  </td>
                </tr>
              ) : (
                purchaseReturnsList.map((pr) => (
                  <tr key={pr.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {pr.invoice_number}
                      <div className="text-[10px] text-slate-400">{formatDate(pr.invoice_date)}</div>
                    </td>
                    {isAllStores && (
                      <td className="px-4 py-3 font-semibold">{pr.store?.name || `Store #${pr.store_id}`}</td>
                    )}
                    <td className="px-4 py-3 font-semibold">{pr.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                      {formatINR(pr.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center capitalize text-amber-600 font-semibold">{pr.status}</td>
                    <td className="px-4 py-3 text-right">
                      <RowAction icon={Eye} title="View debit note" onClick={() => setInspector(inspectDebitNote(pr))} tone="brand" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Purchase Orders Table */}
      {activeTab === "purchase_orders" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">PO Number & Date</th>
                {isAllStores && <th className="px-4 py-3">Store</th>}
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3 text-center">Lines</th>
                <th className="px-4 py-3">Expected Delivery</th>
                <th className="px-4 py-3 text-right">Estimated Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchaseOrdersList.length === 0 ? (
                <tr>
                  <td colSpan={isAllStores ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                    No purchase orders placed.
                  </td>
                </tr>
              ) : (
                purchaseOrdersList.map((po) => (
                  <tr key={po.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {po.invoice_number}
                      <div className="text-[10px] text-slate-400">{formatDate(po.invoice_date)}</div>
                    </td>
                    {isAllStores && (
                      <td className="px-4 py-3 font-semibold">{po.store?.name || `Store #${po.store_id}`}</td>
                    )}
                    <td className="px-4 py-3 font-semibold">{po.supplier_name}</td>
                    <td className="px-4 py-3 text-center font-mono">
                      {Array.isArray(po.items) ? po.items.length : 0}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {po.expected_delivery_date ? formatDate(po.expected_delivery_date) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(po.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                          po.status === "completed"
                            ? "bg-emerald-100 text-emerald-700"
                            : po.status === "cancelled"
                            ? "bg-red-100 text-red-700"
                            : po.status === "partially_received"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {String(po.status || "pending").replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <RowAction icon={Eye} title="View purchase order" onClick={() => setInspector(inspectPurchaseOrder(po))} tone="brand" />
                        {hasPermission("transactions", "edit") &&
                          !["completed", "received", "cancelled"].includes(po.status) && (
                            <>
                              <button
                                onClick={() => setDocEditor({ kind: "purchase_order", doc: po })}
                                title="Edit purchase order"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-900/30"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleReceivePurchaseOrder(po)}
                                title="Record goods receipt"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                              >
                                <Package className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeletePurchaseOrder(po)}
                                title="Delete purchase order"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Held Bills Table */}
      {activeTab === "held_bills" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Cart Token</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Counter / Held By</th>
                <th className="px-4 py-3 text-center">Items</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {heldBillsList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No held bills in parking buffer.
                  </td>
                </tr>
              ) : (
                heldBillsList.map((hb) => (
                  <tr key={hb.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">{hb.id}</td>
                    <td className="px-4 py-3 font-semibold">{hb.customer_name}</td>
                    <td className="px-4 py-3">
                      <div>{hb.held_by_counter_name || "POS"}</div>
                      <div className="text-[10px] text-slate-400">{hb.held_by_user_name}</div>
                    </td>
                    <td className="px-4 py-3 text-center font-mono">{hb.items_count}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(hb.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize bg-amber-100 text-amber-700">
                        {hb.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowAction icon={Eye} title="View held cart" onClick={() => setInspector(inspectHeldBill(hb))} tone="brand" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Counter Shifts & Cash Close Table */}
      {activeTab === "shifts" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Counter</th>
                <th className="px-4 py-3">Cashier</th>
                <th className="px-4 py-3 text-right">Opening Float</th>
                <th className="px-4 py-3 text-right">Cash Sales</th>
                <th className="px-4 py-3 text-right">Digital Sales</th>
                <th className="px-4 py-3 text-right">Closing Cash</th>
                <th className="px-4 py-3 text-center">Shift Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shiftsList.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No counter shifts recorded.
                  </td>
                </tr>
              ) : (
                shiftsList.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                      {s.counter?.counter_code} - {s.counter?.device_name || "Counter"}
                      <div className="text-[10px] text-slate-400">{formatDateTime(s.opened_at)}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">{s.opened_by?.name || "Cashier"}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(s.opening_float)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(s.cash_sales)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(s.digital_sales)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {s.closing_cash_actual ? formatINR(s.closing_cash_actual) : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                          s.status === "open" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowAction icon={Eye} title="View shift & cash close" onClick={() => setInspector(inspectShift(s))} tone="brand" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock Transfers View */}
      {activeTab === "transfers" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Transfer Ref</th>
                <th className="px-4 py-3">From Branch</th>
                <th className="px-4 py-3">To Branch</th>
                <th className="px-4 py-3 text-center">Items Count</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    No stock transfers recorded.
                  </td>
                </tr>
              ) : (
                transfers.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {t.transfer_number}
                      {t.notes && <div className="text-[10px] text-slate-400 font-normal">{t.notes}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium">{t.from_store?.name || `Store #${t.from_store_id}`}</td>
                    <td className="px-4 py-3 font-medium">{t.to_store?.name || `Store #${t.to_store_id}`}</td>
                    <td className="px-4 py-3 text-center font-mono font-semibold">{t.items?.length || 0}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-[10px]">{formatDate(t.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <RowAction icon={Eye} title="View transfer lines" onClick={() => setInspector(inspectTransfer(t))} tone="brand" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Expenses View */}
      {activeTab === "expenses" && (
        <div className="space-y-3">
          {expenseFeedback && (
            <div
              className={`px-4 py-2.5 rounded-xl text-xs font-semibold border ${
                expenseFeedback.kind === "success"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900"
                  : "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900"
              }`}
            >
              {expenseFeedback.message}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Voucher Ref & Date</th>
                    <th className="px-4 py-3">Expense Head</th>
                    <th className="px-4 py-3">Payment Mode</th>
                    <th className="px-4 py-3">Notes</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        Loading expense vouchers...
                      </td>
                    </tr>
                  ) : expenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                        No expense vouchers recorded.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                          {e.expense_number || e.reference_no || `#${e.id}`}
                          <div className="text-[10px] text-slate-400">{formatDate(e.expense_date)}</div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                          {e.expense_head}
                          {e.reference_no && (
                            <div className="text-[10px] text-slate-400 font-normal">Ref: {e.reference_no}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">{e.payment_mode}</td>
                        <td className="px-4 py-3 text-slate-400">
                          {e.notes || "—"}
                          {e.creator?.name && <div className="text-[10px] text-slate-400">By {e.creator.name}</div>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                          {formatINR(e.amount)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <RowAction icon={Eye} title="View expense voucher" onClick={() => setInspector(inspectExpense(e))} tone="brand" />
                            {activeStore && hasPermission("transactions", "edit") && (
                              <>
                                <RowAction icon={Pencil} title="Edit expense" onClick={() => openExpenseModal(e)} tone="brand" />
                                <RowAction icon={Trash2} title="Delete expense" onClick={() => setExpenseDeleteTarget(e)} tone="rose" />
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
              <div>
                Showing page <strong className="text-slate-800 dark:text-slate-200 font-semibold">{page}</strong> of{" "}
                <strong className="text-slate-800 dark:text-slate-200 font-semibold">{totalPages}</strong> ({totalCount.toLocaleString()} total)
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || isLoading}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages || isLoading}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customer Receipts View */}
      {activeTab === "payments" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Receipt Ref & Date</th>
                <th className="px-4 py-3">Customer Name</th>
                <th className="px-4 py-3">Payment Mode</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Amount Received</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No customer receipts recorded.
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {p.reference_no}
                      <div className="text-[10px] text-slate-400">{formatDate(p.payment_date)}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                      {p.customer?.name || `Customer #${p.customer_id}`}
                      {p.customer?.phone && <div className="text-[10px] text-slate-400">{p.customer.phone}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium">{p.payment_mode}</td>
                    <td className="px-4 py-3 text-slate-400">{p.notes || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {formatINR(p.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowAction icon={Eye} title="View receipt voucher" onClick={() => setInspector(inspectReceipt(p))} tone="brand" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Supplier Disbursements View */}
      {activeTab === "supplier_payments" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Payout Ref & Date</th>
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3">Payment Mode</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Disbursed Amount</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {supplierPaymentsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No supplier disbursements recorded.
                  </td>
                </tr>
              ) : (
                supplierPaymentsList.map((sp) => (
                  <tr key={sp.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {sp.reference_no || `PAY-${sp.id}`}
                      <div className="text-[10px] text-slate-400">{formatDate(sp.payment_date)}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">
                      {sp.supplier?.name || `Supplier #${sp.supplier_id}`}
                      {sp.supplier?.phone && <div className="text-[10px] text-slate-400">{sp.supplier.phone}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium">{sp.payment_mode}</td>
                    <td className="px-4 py-3 text-slate-400">{sp.notes || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                      {formatINR(sp.amount)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <RowAction icon={Eye} title="View disbursement voucher" onClick={() => setInspector(inspectPayout(sp))} tone="brand" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Supplier Payment Modal */}
      {/* Expense Voucher Modal */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-brand-600" />
                <span>{editingExpense ? "Edit Expense Voucher" : "Record Expense Voucher"}</span>
              </h3>
              <button onClick={() => setIsExpenseModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveExpense} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Expense Head *</label>
                <input
                  type="text"
                  required
                  list="expense-head-suggestions"
                  value={expenseHead}
                  onChange={(e) => setExpenseHead(e.target.value)}
                  placeholder="e.g. Shop Rent, Electricity, Staff Salary"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
                />
                <datalist id="expense-head-suggestions">
                  <option value="Shop Rent" />
                  <option value="Electricity & Power" />
                  <option value="Staff Salary & Wages" />
                  <option value="Freight & Courier Inward" />
                  <option value="Refreshments & Tea" />
                  <option value="Printing & Stationery" />
                  <option value="Housekeeping & Cleaning" />
                  <option value="Miscellaneous Expenses" />
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Amount (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Expense Date *</label>
                  <input
                    type="date"
                    required
                    value={expenseDate}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Mode</label>
                <select
                  value={expenseMode}
                  onChange={(e) => setExpenseMode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="Cash">Cash</option>
                  <option value="Bank Transfer">Bank Transfer (NEFT/RTGS)</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Voucher Ref / Bill No
                </label>
                <input
                  type="text"
                  value={expenseRef}
                  onChange={(e) => setExpenseRef(e.target.value)}
                  placeholder="e.g. Rent bill 2026-11 or UTR"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Narration / Notes</label>
                <textarea
                  value={expenseNotes}
                  onChange={(e) => setExpenseNotes(e.target.value)}
                  rows={2}
                  placeholder="What was this expense for?"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              {expenseFeedback?.kind === "error" && (
                <div className="text-[11px] font-medium text-red-600 dark:text-red-400">{expenseFeedback.message}</div>
              )}

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsExpenseModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingExpense}
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-60 text-white font-bold rounded-xl"
                >
                  {isSavingExpense ? "Saving..." : editingExpense ? "Save Changes" : "Record Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(expenseDeleteTarget)}
        onClose={() => setExpenseDeleteTarget(null)}
        onConfirm={handleDeleteExpense}
        title={`Delete Expense: ${expenseDeleteTarget?.expense_number || expenseDeleteTarget?.expense_head || ""}`}
        message="Deleting this expense voucher removes it from expense reports and day-close summaries. An immutable audit log entry will be recorded. This action cannot be undone."
        confirmText="Delete Expense"
        danger={true}
        requireReason={false}
      />

      {isSupplierPayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-brand-600" />
                <span>Record Supplier Payment Disbursement</span>
              </h3>
              <button onClick={() => setIsSupplierPayModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSupplierPayment} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Select Supplier *</label>
                <select
                  required
                  value={supplierPaySupplierId}
                  onChange={(e) => {
                    setSupplierPaySupplierId(e.target.value);
                    setSupplierPayAllocations(undefined);
                  }}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-medium"
                >
                  <option value="">-- Choose Supplier --</option>
                  {suppliersList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} (Balance: {formatINR(s.current_balance)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Amount (₹) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={supplierPayAmount}
                  onChange={(e) => setSupplierPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-sm"
                />
              </div>

              {supplierPaySupplierId && activeStore?.id && (
                <AllocationPicker
                  storeId={activeStore.id}
                  partyType="supplier"
                  partyId={String(supplierPaySupplierId)}
                  amount={supplierPayAmount}
                  onAllocationsChange={setSupplierPayAllocations}
                />
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Payment Mode</label>
                <select
                  value={supplierPayMode}
                  onChange={(e) => setSupplierPayMode(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                >
                  <option value="Bank Transfer">Bank Transfer (NEFT/RTGS)</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Reference No / UTR</label>
                <input
                  type="text"
                  value={supplierPayRef}
                  onChange={(e) => setSupplierPayRef(e.target.value)}
                  placeholder="e.g. UTR-9876543210"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Narration / Notes</label>
                <textarea
                  value={supplierPayNotes}
                  onChange={(e) => setSupplierPayNotes(e.target.value)}
                  rows={2}
                  placeholder="Payment notes..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsSupplierPayModalOpen(false)}
                  className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white font-bold rounded-xl"
                >
                  Disburse Payment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Row Inspector: the document behind any list row, read without leaving the table */}
      {inspector && <RecordInspector {...inspector} onClose={() => setInspector(null)} />}

      {/* Invoice Thermal Reprint Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Printer className="w-4 h-4 text-brand-600" />
                <span>Invoice Voucher: {selectedInvoice.invoice_number}</span>
              </h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Thermal Slip Preview Box */}
            {(() => {
              const storeInfo = (selectedInvoice as any).store || activeStore;
              return (
                <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-xs font-mono space-y-2">
                  <div className="text-center font-bold text-sm">
                    {storeInfo?.display_name || storeInfo?.name || "LamSuite Retail"}
                  </div>
                  {storeInfo?.address && (
                    <div className="text-center text-[10px] text-slate-500">{storeInfo.address}</div>
                  )}
                  {storeInfo?.gstin && (
                    <div className="text-center text-[10px] text-slate-500">GSTIN: {storeInfo.gstin}</div>
                  )}
                  <div className="border-b border-dashed border-slate-300 dark:border-slate-800 my-2" />
                  <div className="flex justify-between">
                    <span>Inv: {selectedInvoice.invoice_number}</span>
                    <span>Date: {formatDate(selectedInvoice.invoice_date)}</span>
                  </div>
                  <div className="text-[11px]">Customer: {selectedInvoice.customer_name}</div>
                  {isPharmacy && selectedInvoice.doctor_name && (
                    <div className="text-[10px] text-slate-500">Doctor: {selectedInvoice.doctor_name}</div>
                  )}
                  <div className="border-b border-dashed border-slate-300 dark:border-slate-800 my-2" />

                  {/* Items */}
                  <div className="space-y-1">
                    {selectedInvoice.items?.map((it) => (
                      <div key={it.id} className="flex justify-between">
                        <span className="truncate max-w-[180px]">
                          {it.product_name} x {it.qty}
                        </span>
                        <span>{formatINR(it.total_amount)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="border-b border-dashed border-slate-300 dark:border-slate-800 my-2" />
                  <div className="flex justify-between font-bold text-sm">
                    <span>NET TOTAL</span>
                    <span>{formatINR(selectedInvoice.grand_total)}</span>
                  </div>
                  <div className="text-center text-[10px] text-slate-400 pt-2">
                    {storeInfo?.footer_text || "Thank you for shopping with us!"}
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setSelectedInvoice(null)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Close
              </button>
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Document</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One-Time Edit / Cancel Approval Modal */}
      {approvalInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs"
            onClick={() => setApprovalInvoice(null)}
          />
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white">
                  <ShieldCheck className="w-4 h-4 text-amber-500" />
                  Issue One-Time PIN
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {approvalInvoice.invoice_number} • valid for one invoice change by one staff member
                </p>
              </div>
              <button
                onClick={() => setApprovalInvoice(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!issuedApprovalPin ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Authorized Action
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["edit", "cancel"] as const).map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setApprovalAction(action)}
                        className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${
                          approvalAction === action
                            ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {action === "edit" ? "Allow Edit" : "Allow Cancellation"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Staff Member
                  </label>
                  <select
                    value={approvalUserId}
                    onChange={(e) => setApprovalUserId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-white"
                  >
                    <option value="">Select staff member…</option>
                    {approvalStaff.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.name} {staff.username ? `(${staff.username})` : ""} — {staff.role || "staff"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Valid For
                    </label>
                    <select
                      value={approvalMinutes}
                      onChange={(e) => setApprovalMinutes(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-white"
                    >
                      {[5, 10, 15, 30].map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} minutes
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                      Reason
                    </label>
                    <input
                      value={approvalReason}
                      onChange={(e) => setApprovalReason(e.target.value)}
                      placeholder="e.g. billing correction"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-800 dark:text-white"
                    />
                  </div>
                </div>

                <button
                  onClick={handleIssueApproval}
                  disabled={isIssuingApproval || !approvalUserId}
                  className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-bold disabled:opacity-50"
                >
                  {isIssuingApproval ? "Issuing…" : "Generate One-Time PIN"}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 text-center">
                  <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Share this PIN with the selected staff member now. It is stored only as a hash and cannot be shown again.
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <span className="font-mono text-3xl font-black tracking-[0.3em] text-amber-900 dark:text-amber-200">
                      {issuedApprovalPin}
                    </span>
                    <button
                      onClick={copyIssuedPin}
                      className="p-2 rounded-lg bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200 hover:bg-amber-300"
                      title="Copy PIN"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setIssuedApprovalPin("");
                    setApprovalUserId("");
                  }}
                  className="w-full py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300"
                >
                  Issue Another PIN
                </button>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <h4 className="text-[11px] font-bold text-slate-600 dark:text-slate-300 mb-2">
                Recent Approvals
              </h4>
              {isLoadingApprovals ? (
                <p className="text-[11px] text-slate-400">Loading…</p>
              ) : approvalRows.length === 0 ? (
                <p className="text-[11px] text-slate-400">No approvals issued for this invoice.</p>
              ) : (
                <div className="space-y-1.5">
                  {approvalRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-100 dark:border-slate-800 px-2.5 py-1.5 text-[11px]"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-700 dark:text-slate-200 capitalize">
                          {row.action} • {row.mode.replace("_", " ")} • {row.status}
                        </div>
                        <div className="text-slate-400">
                          {row.approved_by_name || "System"}
                          {row.expires_at ? ` • expires ${formatDateTime(row.expires_at)}` : ""}
                          {row.used_at ? ` • used ${formatDateTime(row.used_at)}` : ""}
                        </div>
                      </div>
                      {row.status === "pending" && (
                        <button
                          onClick={() => handleRevokeApproval(row.id)}
                          className="shrink-0 px-2 py-1 rounded-lg text-red-600 bg-red-50 dark:bg-red-950/40 font-bold"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Invoice Cancellation Modal */}
      <ConfirmModal
        isOpen={Boolean(cancelModalInvoice)}
        onClose={() => setCancelModalInvoice(null)}
        onConfirm={handleCancelInvoice}
        title={`Cancel Invoice: ${cancelModalInvoice?.invoice_number}`}
        message="Cancelling this invoice will immediately restore product inventory batch quantities, reverse customer ledger balance dues, update statutory GSTR-1 summaries, and append an immutable audit log entry. This action cannot be undone."
        confirmText="Confirm Invoice Cancellation"
        danger={true}
        requireReason={true}
      />

      {docEditor && (
        <DocumentEditorModal
          kind={docEditor.kind}
          storeId={activeStore?.id}
          doc={docEditor.doc}
          onClose={() => setDocEditor(null)}
          onSaved={(message) => {
            setDocEditor(null);
            setActionFeedback({ kind: "success", message });
            fetchTransactions();
          }}
        />
      )}

      {isReceiptModalOpen && (
        <CustomerReceiptModal
          storeId={activeStore?.id}
          onClose={() => setIsReceiptModalOpen(false)}
          onSaved={(message) => {
            setIsReceiptModalOpen(false);
            setActionFeedback({ kind: "success", message });
            fetchTransactions();
          }}
        />
      )}
    </div>
  );
};
