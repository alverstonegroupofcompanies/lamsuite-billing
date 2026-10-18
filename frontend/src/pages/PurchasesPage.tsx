import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Truck,
  Plus,
  FileSpreadsheet,
  Trash2,
  CheckCircle,
  AlertCircle,
  X,
  FileText,
  RotateCcw,
  ArrowUpFromLine,
  Search,
  SlidersHorizontal,
  Calendar,
  Building2,
  CreditCard,
  Barcode,
  Layers,
  ShoppingBag,
  TrendingUp,
  Receipt,
  Download,
  Eye,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  purchaseService,
  type PurchaseDocumentRecord,
  type PurchaseLineItemInput,
} from "../lib/purchases/purchaseService";
import {
  supplierLedgerService,
  type SupplierMaster,
  type SupplierAgeingSummary,
  type SupplierLedgerEntry,
} from "../lib/purchases/supplierLedgerService";
import {
  purchaseOrderService,
  type PurchaseOrderRecord,
} from "../lib/purchases/purchaseOrderService";
import { sqliteStorage } from "../lib/db/sqliteStorage";
import { PurchaseEntryForm } from "../components/purchases/PurchaseEntryForm";
import { PurchaseDetailsDrawer } from "../components/purchases/PurchaseDetailsDrawer";
import { ImportWizardModal } from "../lib/data-exchange/ui/ImportWizardModal";
import { PurchaseOrderModal } from "../components/purchases/PurchaseOrderModal";
import { SupplierPaymentModal } from "../components/purchases/SupplierPaymentModal";
import { SupplierQuickAddModal } from "../components/purchases/SupplierQuickAddModal";

type ActiveTab = "bills" | "orders" | "ledger" | "reports";

export const PurchasesPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ActiveTab>("bills");

  // Inward Bills State
  const [purchasesList, setPurchasesList] = useState<PurchaseDocumentRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSupplierFilter, setSelectedSupplierFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [dateFilterPreset, setDateFilterPreset] = useState<"all" | "today" | "week" | "month">("all");

  // Detail Drawer & Entry Form
  const [isEntryFormOpen, setIsEntryFormOpen] = useState(false);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState<string | null>(null);
  const [poToConvert, setPoToConvert] = useState<any | null>(null);

  // Purchase Orders State
  const [ordersList, setOrdersList] = useState<PurchaseOrderRecord[]>([]);
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [poModalMode, setPoModalMode] = useState<"po" | "pr">("po");

  // Supplier Ledger & Ageing State
  const [suppliers, setSuppliers] = useState<SupplierMaster[]>([]);
  const [selectedLedgerSupplierId, setSelectedLedgerSupplierId] = useState<string>("");
  const [supplierStatement, setSupplierStatement] = useState<{
    supplier: SupplierMaster | null;
    entries: SupplierLedgerEntry[];
    summary: { openingBalance: number; totalPurchases: number; totalPayments: number; totalReturns: number; closingBalance: number };
  } | null>(null);
  const [ageingList, setAgeingList] = useState<SupplierAgeingSummary[]>([]);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isQuickAddSupplierOpen, setIsQuickAddSupplierOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Feedback Notification
  const [notification, setNotification] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    loadAllData();
  }, []);

  useEffect(() => {
    if (selectedLedgerSupplierId) {
      loadStatement(selectedLedgerSupplierId);
    }
  }, [selectedLedgerSupplierId]);

  const loadAllData = async () => {
    const docs = await sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents");
    setPurchasesList(docs.sort((a, b) => (b.created_at || 0) - (a.created_at || 0)));

    const sups = await supplierLedgerService.getAllSuppliers();
    setSuppliers(sups);
    if (sups.length > 0 && !selectedLedgerSupplierId) {
      setSelectedLedgerSupplierId(sups[0].id);
    }

    const pos = await purchaseOrderService.getAllOrders();
    setOrdersList(pos);

    const ageing = await supplierLedgerService.getSupplierAgeingAnalysis();
    setAgeingList(ageing);
  };

  const loadStatement = async (supId: string) => {
    const res = await supplierLedgerService.getSupplierStatement(supId);
    setSupplierStatement(res);
  };

  const showNotification = (message: string, type: "success" | "error" = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  // Convert PO to Inward Bill
  const handleConvertPO = (po: PurchaseOrderRecord) => {
    const lines: PurchaseLineItemInput[] = po.items
      .filter((it) => (it.ordered_qty || 0) > (it.received_qty || 0))
      .map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        hsn_code: it.hsn_code,
        batch_no: "",
        expiry_date: "",
        pack_qty: Math.max(1, (it.ordered_qty || 0) - (it.received_qty || 0)),
        units_per_pack: 1,
        purchase_rate: it.purchase_rate,
        gst_percent: it.gst_percent,
      }));

    setPoToConvert({
      po_id: po.id,
      supplier_id: po.supplier_id,
      supplier_name: po.supplier_name,
      lines,
    });
    setIsEntryFormOpen(true);
  };

  // Filter Inward Bills
  const filteredPurchases = purchasesList.filter((p) => {
    if (selectedSupplierFilter !== "all" && p.supplier_id !== selectedSupplierFilter) return false;
    const effectivePaymentStatus = p.payment_status || "unpaid";
    if (paymentStatusFilter !== "all" && effectivePaymentStatus !== paymentStatusFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchNo = p.purchase_number?.toLowerCase().includes(q);
      const matchInv = p.supplier_invoice_no?.toLowerCase().includes(q);
      const matchSup = p.supplier_name?.toLowerCase().includes(q);
      if (!matchNo && !matchInv && !matchSup) return false;
    }

    if (dateFilterPreset !== "all") {
      const todayStr = new Date().toISOString().slice(0, 10);
      if (dateFilterPreset === "today" && p.purchase_date !== todayStr) return false;
      if (dateFilterPreset === "week") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        if (p.purchase_date < d.toISOString().slice(0, 10)) return false;
      }
      if (dateFilterPreset === "month") {
        const d = new Date();
        d.setDate(d.getDate() - 30);
        if (p.purchase_date < d.toISOString().slice(0, 10)) return false;
      }
    }

    return true;
  });

  // Financial KPI Summaries
  const totalPurchasesAmount = purchasesList
    .filter((p) => p.status !== "cancelled")
    .reduce((a, b) => a + (b.grand_total || 0), 0);

  const totalOutstanding = ageingList.reduce((a, b) => a + (b.total_outstanding || 0), 0);

  const totalItc = purchasesList
    .filter((p) => p.status !== "cancelled")
    .reduce((a, b) => a + (b.tax_total || 0), 0);

  return (
    <div className="flex h-full flex-col gap-3 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center gap-2.5 rounded-xl p-3.5 text-xs font-semibold shadow-2xl transition-all max-w-lg border ${
            notification.type === "success"
              ? "bg-slate-900 text-slate-100 border-emerald-500/50"
              : "bg-red-800 text-white border-red-600"
          }`}
        >
          {notification.type === "success" ? (
            <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 text-red-200 shrink-0" />
          )}
          <span className="font-medium">{notification.message}</span>
          <button
            onClick={() => setNotification(null)}
            className="text-slate-400 hover:text-white p-0.5 cursor-pointer ml-auto"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Top Action & Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/pos")}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
            title="Return to POS Billing"
          >
            <span>Back to POS</span>
          </button>
          <div className="h-6 w-px bg-[var(--color-border)]" />
          <div className="flex items-center gap-2.5">
            <div className="rounded-[10px] bg-[var(--color-accent-soft)] p-2 text-[var(--color-accent)] border border-[var(--color-accent-soft)]">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-[var(--color-text)] flex items-center gap-2">
                <span>Purchase Operations & Inward Stock</span>
              </h1>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Inward bills, batch stocks, supplier double-entry ledger, POs, and ITC tracking.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-xs font-bold text-[var(--color-text)] shadow-2xs hover:bg-[var(--color-surface-hover)] transition-colors cursor-pointer"
          >
            <Upload className="h-4 w-4 text-[var(--color-accent)]" />
            <span>Import Invoices (Excel/CSV)</span>
          </button>
          <button
            onClick={() => {
              setPoToConvert(null);
              setIsEntryFormOpen(true);
            }}
            className="flex items-center gap-2 rounded-[10px] bg-[var(--color-accent)] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>New Inward Bill (F2)</span>
          </button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Total Inward Purchases</span>
            <div className="rounded-[8px] bg-[var(--color-accent-soft)] p-2 text-[var(--color-accent)]">
              <Truck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-[26px] font-bold font-mono text-[var(--color-text)] tabular-nums leading-tight">₹ {totalPurchasesAmount.toFixed(2)}</div>
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1 font-mono">{purchasesList.length} Inward bills recorded</div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Outstanding Payables</span>
            <div className="rounded-[8px] bg-[var(--color-warning-bg)] p-2 text-[var(--color-warning-text)]">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-[26px] font-bold font-mono text-[var(--color-warning-text)] tabular-nums leading-tight">₹ {totalOutstanding.toFixed(2)}</div>
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1 font-mono">Across {suppliers.length} active suppliers</div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Input Tax Credit (ITC)</span>
            <div className="rounded-[8px] bg-[var(--color-success-bg)] p-2 text-[var(--color-success-text)]">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-[26px] font-bold font-mono text-[var(--color-success-text)] tabular-nums leading-tight">₹ {totalItc.toFixed(2)}</div>
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Available for GSTR-3B offset</div>
        </div>

        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Pending POs</span>
            <div className="rounded-[8px] bg-[var(--color-surface-subtle)] p-2 text-[var(--color-text-muted)]">
              <ShoppingBag className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-[26px] font-bold font-mono text-[var(--color-text)] tabular-nums leading-tight">
            {ordersList.filter((o) => o.status === "pending" || o.status === "partially_received").length} Active
          </div>
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Purchase Orders awaiting inward receipt</div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] text-xs font-bold bg-[var(--color-surface)] px-2 rounded-t-[14px]">
        <button
          onClick={() => setActiveTab("bills")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all cursor-pointer ${
            activeTab === "bills"
              ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)] rounded-t-[10px]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <Receipt className="h-4 w-4" />
          <span>Inward Purchase Bills ({purchasesList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("orders")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all cursor-pointer ${
            activeTab === "orders"
              ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)] rounded-t-[10px]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <ShoppingBag className="h-4 w-4" />
          <span>Purchase Orders & Requests ({ordersList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("ledger")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all cursor-pointer ${
            activeTab === "ledger"
              ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)] rounded-t-[10px]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Supplier Ledger & Ageing</span>
        </button>

        <button
          onClick={() => setActiveTab("reports")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all cursor-pointer ${
            activeTab === "reports"
              ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-soft)] rounded-t-[10px]"
              : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Purchase & ITC Reports</span>
        </button>
      </div>

      {/* TAB 1: Inward Purchase Bills Table */}
      {activeTab === "bills" && (
        <div className="space-y-3">
          {/* Filters Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xs text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Bill #, Supplier, Inv #..."
                  className="w-56 rounded-[10px] border border-[var(--color-border)] pl-8 pr-3 py-1.5 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none bg-[var(--color-surface)]"
                />
              </div>

              <select
                value={selectedSupplierFilter}
                onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                className="rounded-[10px] border border-[var(--color-border)] px-2.5 py-1.5 text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                <option value="all">All Suppliers</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <select
                value={paymentStatusFilter}
                onChange={(e) => setPaymentStatusFilter(e.target.value)}
                className="rounded-[10px] border border-[var(--color-border)] px-2.5 py-1.5 text-xs bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                <option value="all">All Payment Statuses</option>
                <option value="paid">Paid</option>
                <option value="partial">Partially Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>

            {/* Date Range Chips */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mr-1">Period:</span>
              {(
                [
                  { id: "today", label: "Today" },
                  { id: "week", label: "Last 7 Days" },
                  { id: "month", label: "This Month" },
                  { id: "all", label: "All Time" },
                ] as const
              ).map((chip) => (
                <button
                  key={chip.id}
                  onClick={() => setDateFilterPreset(chip.id)}
                  className={`rounded-[8px] px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                    dateFilterPreset === chip.id
                      ? "bg-[var(--color-accent)] text-white shadow-2xs"
                      : "bg-[var(--color-canvas)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)]"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Bill Number</th>
                    <th className="px-4 py-3">Supplier Name</th>
                    <th className="px-4 py-3">Supplier Inv #</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Taxable</th>
                    <th className="px-4 py-3 text-right">GST Tax</th>
                    <th className="px-4 py-3 text-right">Grand Total</th>
                    <th className="px-4 py-3 text-center">Payment</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-[var(--color-text-muted)]">
                        <Truck className="mx-auto h-8 w-8 text-[var(--color-text-muted)] opacity-40 mb-1" />
                        <p className="font-semibold text-xs">No purchase bills match the selected filters</p>
                        <p className="text-[11px] text-[var(--color-text-muted)]">Press "New Inward Bill" to record an invoice</p>
                      </td>
                    </tr>
                  ) : (
                    filteredPurchases.map((p) => (
                      <tr key={p.id} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                        <td
                          onClick={() => setSelectedPurchaseId(p.id)}
                          className="px-4 py-3 font-bold font-mono text-[var(--color-accent)] cursor-pointer hover:underline"
                        >
                          {p.purchase_number}
                        </td>
                        <td className="px-4 py-3 font-semibold text-[var(--color-text)]">{p.supplier_name}</td>
                        <td className="px-4 py-3 font-mono text-[var(--color-text-muted)]">{p.supplier_invoice_no}</td>
                        <td className="px-4 py-3 text-[var(--color-text-muted)] font-mono">{p.purchase_date}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--color-text-muted)] tabular-nums">₹ {Number(p.subtotal || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono text-[var(--color-text-muted)] tabular-nums">₹ {Number(p.tax_total || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-black font-mono text-[var(--color-text)] tabular-nums">
                          ₹ {Number(p.grand_total || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              (p.payment_status || "unpaid") === "paid"
                                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                                : (p.payment_status || "unpaid") === "partial"
                                ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                                : "bg-[var(--color-canvas)] text-[var(--color-text-muted)] border border-[var(--color-border)]"
                            }`}
                          >
                            {(p.payment_status || "unpaid").toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              p.status === "received"
                                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                                : "bg-[var(--color-danger-bg)] text-[var(--color-danger-text)] border border-[var(--color-danger-border)]"
                            }`}
                          >
                            {(p.status || "received").toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setSelectedPurchaseId(p.id)}
                              className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent)] rounded-[6px] hover:bg-[var(--color-accent-soft)] transition-colors cursor-pointer"
                              title="View full purchase details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => navigate(`/returns/purchases?purchaseId=${p.id}`)}
                              className="p-1 text-[var(--color-warning-text)] hover:text-[var(--color-text)] rounded-[6px] hover:bg-[var(--color-warning-bg)] transition-colors cursor-pointer"
                              title="Return items / Debit Note"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Purchase Orders & Requisitions */}
      {activeTab === "orders" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-2xs">
            <div className="text-xs text-[var(--color-text-muted)]">
              Track purchase requisitions (PR) and purchase orders (PO). Convert directly to inward bills when delivered.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPoModalMode("pr");
                  setIsPoModalOpen(true);
                }}
                className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] cursor-pointer transition-colors"
              >
                + New Request (PR)
              </button>
              <button
                onClick={() => {
                  setPoModalMode("po");
                  setIsPoModalOpen(true);
                }}
                className="rounded-[10px] bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
              >
                + New Purchase Order (PO)
              </button>
            </div>
          </div>

          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px] border-b border-[var(--color-border)]">
                <tr>
                  <th className="px-4 py-3">PO Number</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">PO Date</th>
                  <th className="px-4 py-3">Expected Date</th>
                  <th className="px-4 py-3 text-center">Items</th>
                  <th className="px-4 py-3 text-right">Est. Total</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {ordersList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[var(--color-text-muted)]">
                      <ShoppingBag className="mx-auto h-8 w-8 text-[var(--color-text-muted)] opacity-40 mb-1" />
                      <p className="font-semibold text-xs">No purchase orders created yet</p>
                    </td>
                  </tr>
                ) : (
                  ordersList.map((po) => (
                    <tr key={po.id} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                      <td className="px-4 py-3 font-bold font-mono text-[var(--color-accent)]">{po.po_number}</td>
                      <td className="px-4 py-3 font-semibold text-[var(--color-text)]">{po.supplier_name}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)] font-mono">{po.po_date}</td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)] font-mono">{po.expected_delivery_date || "-"}</td>
                      <td className="px-4 py-3 text-center font-mono">{po.items?.length || 0}</td>
                      <td className="px-4 py-3 text-right font-bold font-mono text-[var(--color-text)] tabular-nums">
                        ₹ {Number(po.total_amount || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            po.status === "completed"
                              ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent-soft)]"
                              : po.status === "partially_received"
                              ? "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border border-[var(--color-warning-border)]"
                              : "bg-[var(--color-canvas)] text-[var(--color-text)] border border-[var(--color-border)]"
                          }`}
                        >
                          {po.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {po.status !== "completed" && po.status !== "cancelled" ? (
                          <button
                            onClick={() => handleConvertPO(po)}
                            className="rounded-[6px] bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
                          >
                            Inward Bill
                          </button>
                        ) : (
                          <span className="text-[var(--color-text-muted)] text-[11px]">Fulfilled</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Supplier Ledger & Ageing */}
      {activeTab === "ledger" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Supplier Picker & Balance Overview */}
            <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wide">Select Supplier</h3>
                <button
                  onClick={() => setIsQuickAddSupplierOpen(true)}
                  className="text-[11px] font-bold text-[var(--color-accent)] hover:underline cursor-pointer"
                >
                  + Add New
                </button>
              </div>

              <select
                value={selectedLedgerSupplierId}
                onChange={(e) => setSelectedLedgerSupplierId(e.target.value)}
                className="w-full rounded-[10px] border border-[var(--color-border)] p-2 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Bal: ₹{Number(s.outstanding_balance || 0).toFixed(2)})
                  </option>
                ))}
              </select>

              {supplierStatement?.supplier && (
                <div className="rounded-[10px] bg-[var(--color-canvas)] p-3 text-xs space-y-2 border border-[var(--color-border)]">
                  <div className="font-bold text-[var(--color-text)] text-sm">{supplierStatement.supplier.name}</div>
                  {supplierStatement.supplier.phone && <div>Phone: {supplierStatement.supplier.phone}</div>}
                  {supplierStatement.supplier.gstin && <div className="font-mono">GSTIN: {supplierStatement.supplier.gstin}</div>}
                  <div>Credit Period: {supplierStatement.supplier.credit_period_days || 30} Days</div>
                  <div className="border-t border-[var(--color-border)] pt-2 flex justify-between font-black text-sm">
                    <span>Closing Balance:</span>
                    <span className="text-[var(--color-accent)] font-mono tabular-nums">₹ {supplierStatement.summary.closingBalance.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsPaymentModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 rounded-[10px] bg-[var(--color-accent)] py-2 text-xs font-bold text-white shadow-2xs hover:bg-[var(--color-accent-hover)] cursor-pointer transition-colors"
              >
                <CreditCard className="h-4 w-4" />
                <span>Record Supplier Payment</span>
              </button>
            </div>

            {/* Statement Ledger History */}
            <div className="lg:col-span-2 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs flex flex-col">
              <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3 mb-3">
                <h3 className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wide">
                  Ledger Statement Entries
                </h3>
                <span className="text-[11px] text-[var(--color-text-muted)] font-mono">
                  {supplierStatement?.entries.length || 0} Transactions
                </span>
              </div>

              <div className="flex-1 overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px] border-b border-[var(--color-border)] sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type / Ref</th>
                      <th className="px-3 py-2 text-right">Debit (₹)</th>
                      <th className="px-3 py-2 text-right">Credit (₹)</th>
                      <th className="px-3 py-2 text-right font-bold">Balance (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {supplierStatement?.entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-[var(--color-text-muted)]">
                          No transactions recorded for this supplier
                        </td>
                      </tr>
                    ) : (
                      supplierStatement?.entries.map((e, idx) => (
                        <tr key={idx} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                          <td className="px-3 py-2 text-[var(--color-text-muted)] font-mono">{e.entry_date}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold font-mono text-[var(--color-text)]">{e.reference_number}</span>
                            <div className="text-[10px] text-[var(--color-text-muted)]">{e.notes}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--color-accent)] font-medium font-mono tabular-nums">
                            {e.debit_amount > 0 ? `₹${e.debit_amount.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--color-danger-text)] font-medium font-mono tabular-nums">
                            {e.credit_amount > 0 ? `₹${e.credit_amount.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-[var(--color-text)] font-mono tabular-nums">
                            ₹{e.running_balance.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Ageing Analysis Table */}
          <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-2xs">
            <h3 className="text-xs font-bold text-[var(--color-text)] uppercase tracking-wide mb-3">
              Supplier Payables Ageing Analysis (Days Overdue)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--color-canvas)] text-[var(--color-text-muted)] font-bold uppercase tracking-wider text-[11px] border-b border-[var(--color-border)]">
                  <tr>
                    <th className="px-3 py-2.5">Supplier Name</th>
                    <th className="px-3 py-2.5 text-center">Credit Days</th>
                    <th className="px-3 py-2.5 text-right">Current</th>
                    <th className="px-3 py-2.5 text-right">1 - 30 Days</th>
                    <th className="px-3 py-2.5 text-right">31 - 60 Days</th>
                    <th className="px-3 py-2.5 text-right">61 - 90 Days</th>
                    <th className="px-3 py-2.5 text-right text-[var(--color-danger-text)] font-bold">90+ Days</th>
                    <th className="px-3 py-2.5 text-right font-black">Total Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {ageingList.map((a, idx) => (
                    <tr key={idx} className="hover:bg-[var(--color-surface-hover)] transition-colors">
                      <td className="px-3 py-2 font-bold text-[var(--color-text)]">{a.supplier_name}</td>
                      <td className="px-3 py-2 text-center text-[var(--color-text-muted)] font-mono">{a.credit_period_days}d</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-muted)] font-mono tabular-nums">₹{a.current.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-text-muted)] font-mono tabular-nums">₹{a.days_1_30.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-warning-text)] font-medium font-mono tabular-nums">₹{a.days_31_60.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-warning-text)] font-medium font-mono tabular-nums">₹{a.days_61_90.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-[var(--color-danger-text)] font-bold font-mono tabular-nums">₹{a.days_90_plus.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-black text-[var(--color-text)] font-mono tabular-nums">
                        ₹{a.total_outstanding.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Reports View */}
      {activeTab === "reports" && (
        <div className="rounded-[14px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xs space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--color-text)]">Inward Tax Credit (ITC / GSTR-2) Summary</h3>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                Breakdown of Input Tax Credit eligible for GST return filing
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-3.5 border border-[var(--color-border)]">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">CGST Input Credit</span>
              <div className="text-lg font-bold font-mono text-[var(--color-text)] tabular-nums mt-1">
                ₹ {purchasesList.reduce((a, b) => a + (b.cgst_total || 0), 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-3.5 border border-[var(--color-border)]">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">SGST Input Credit</span>
              <div className="text-lg font-bold font-mono text-[var(--color-text)] tabular-nums mt-1">
                ₹ {purchasesList.reduce((a, b) => a + (b.sgst_total || 0), 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded-[10px] bg-[var(--color-canvas)] p-3.5 border border-[var(--color-border)]">
              <span className="text-[11px] font-bold text-[var(--color-text-muted)] uppercase tracking-wider">IGST Input Credit</span>
              <div className="text-lg font-bold font-mono text-[var(--color-accent)] tabular-nums mt-1">
                ₹ {purchasesList.reduce((a, b) => a + (b.igst_total || 0), 0).toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full Keyboard-first Purchase Entry Form Modal */}
      {isEntryFormOpen && (
        <PurchaseEntryForm
          onClose={() => {
            setIsEntryFormOpen(false);
            setPoToConvert(null);
          }}
          onSuccess={() => {
            loadAllData();
            showNotification("Purchase bill recorded successfully!");
          }}
          initialPoData={poToConvert}
        />
      )}

      {/* Purchase Details Drawer */}
      {selectedPurchaseId && (
        <PurchaseDetailsDrawer
          isOpen={Boolean(selectedPurchaseId)}
          onClose={() => setSelectedPurchaseId(null)}
          purchaseId={selectedPurchaseId}
          onPurchaseUpdated={() => loadAllData()}
        />
      )}

      {/* PO Modal */}
      {isPoModalOpen && (
        <PurchaseOrderModal
          isOpen={isPoModalOpen}
          onClose={() => setIsPoModalOpen(false)}
          moduleKey={poModalMode}
          onCreated={() => {
            loadAllData();
            showNotification(`${poModalMode.toUpperCase()} created successfully!`);
          }}
        />
      )}

      {/* Supplier Payment Modal */}
      {isPaymentModalOpen && (
        <SupplierPaymentModal
          isOpen={isPaymentModalOpen}
          onClose={() => setIsPaymentModalOpen(false)}
          defaultSupplierId={selectedLedgerSupplierId}
          onPaymentRecorded={() => {
            loadAllData();
            if (selectedLedgerSupplierId) loadStatement(selectedLedgerSupplierId);
            showNotification("Supplier payment recorded!");
          }}
        />
      )}

      {/* Quick Add Supplier Modal */}
      {isQuickAddSupplierOpen && (
        <SupplierQuickAddModal
          isOpen={isQuickAddSupplierOpen}
          onClose={() => setIsQuickAddSupplierOpen(false)}
          onSupplierCreated={(s) => {
            loadAllData();
            setSelectedLedgerSupplierId(s.id);
            showNotification(`Supplier ${s.name} added!`);
          }}
        />
      )}

      {/* Import Wizard Modal */}
      {isImportModalOpen && (
        <ImportWizardModal
          isOpen={isImportModalOpen}
          initialEntityId="purchases"
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            setIsImportModalOpen(false);
            loadAllData();
            showNotification("Purchases imported successfully!");
          }}
        />
      )}
    </div>
  );
};
