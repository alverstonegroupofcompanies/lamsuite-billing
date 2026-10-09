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
    if (paymentStatusFilter !== "all" && p.payment_status !== paymentStatusFilter) return false;

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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/pos")}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            title="Return to POS Billing"
          >
            <span>Back to POS</span>
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600 border border-blue-100">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span>Purchase Operations & Inward Stock</span>
              </h1>
              <p className="text-[11px] text-slate-500">
                Inward bills, batch stocks, supplier double-entry ledger, POs, and ITC tracking.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setPoToConvert(null);
              setIsEntryFormOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span>New Inward Bill (F2)</span>
          </button>
        </div>
      </div>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">Total Inward Purchases</span>
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <Truck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-lg font-black text-slate-900">₹ {totalPurchasesAmount.toFixed(2)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">{purchasesList.length} Inward bills recorded</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">Outstanding Payables</span>
            <div className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <CreditCard className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-lg font-black text-amber-700">₹ {totalOutstanding.toFixed(2)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Across {suppliers.length} active suppliers</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">Input Tax Credit (ITC)</span>
            <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-lg font-black text-emerald-700">₹ {totalItc.toFixed(2)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Available for GSTR-3B offset</div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">Pending POs</span>
            <div className="rounded-lg bg-purple-50 p-2 text-purple-600">
              <ShoppingBag className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-lg font-black text-purple-700">
            {ordersList.filter((o) => o.status === "pending" || o.status === "partially_received").length} Active
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Purchase Orders awaiting inward receipt</div>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 text-xs font-bold bg-white px-2 rounded-t-lg">
        <button
          onClick={() => setActiveTab("bills")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all ${
            activeTab === "bills"
              ? "border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-md"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Receipt className="h-4 w-4" />
          <span>Inward Purchase Bills ({purchasesList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("orders")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all ${
            activeTab === "orders"
              ? "border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-md"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <ShoppingBag className="h-4 w-4" />
          <span>Purchase Orders & Requests ({ordersList.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("ledger")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all ${
            activeTab === "ledger"
              ? "border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-md"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>Supplier Ledger & Ageing</span>
        </button>

        <button
          onClick={() => setActiveTab("reports")}
          className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 transition-all ${
            activeTab === "reports"
              ? "border-blue-600 text-blue-600 bg-blue-50/50 rounded-t-md"
              : "border-transparent text-slate-500 hover:text-slate-800"
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-xs text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Bill #, Supplier, Inv #..."
                  className="w-56 rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none"
                />
              </div>

              <select
                value={selectedSupplierFilter}
                onChange={(e) => setSelectedSupplierFilter(e.target.value)}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:border-blue-600 focus:outline-none"
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
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs bg-white focus:border-blue-600 focus:outline-none"
              >
                <option value="all">All Payment Statuses</option>
                <option value="paid">Paid</option>
                <option value="partial">Partially Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </div>

            {/* Date Range Chips */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mr-1">Period:</span>
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
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    dateFilterPreset === chip.id
                      ? "bg-blue-600 text-white shadow-xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-100/80 text-slate-700 font-bold">
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
                <tbody className="divide-y divide-slate-100">
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-12 text-center text-slate-400">
                        <Truck className="mx-auto h-8 w-8 text-slate-300 mb-1" />
                        <p className="font-semibold text-xs">No purchase bills match the selected filters</p>
                        <p className="text-[11px] text-slate-400">Press "New Inward Bill" to record an invoice</p>
                      </td>
                    </tr>
                  ) : (
                    filteredPurchases.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                        <td
                          onClick={() => setSelectedPurchaseId(p.id)}
                          className="px-4 py-3 font-bold text-blue-600 cursor-pointer hover:underline"
                        >
                          {p.purchase_number}
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{p.supplier_name}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{p.supplier_invoice_no}</td>
                        <td className="px-4 py-3 text-slate-500">{p.purchase_date}</td>
                        <td className="px-4 py-3 text-right text-slate-600">₹ {Number(p.subtotal || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-slate-600">₹ {Number(p.tax_total || 0).toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-black text-slate-900">
                          ₹ {Number(p.grand_total || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              p.payment_status === "paid"
                                ? "bg-emerald-100 text-emerald-800"
                                : p.payment_status === "partial"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {(p.payment_status || "unpaid").toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              p.status === "received"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {(p.status || "received").toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => setSelectedPurchaseId(p.id)}
                              className="p-1 text-slate-500 hover:text-blue-600 rounded hover:bg-blue-50"
                              title="View full purchase details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => navigate(`/returns/purchases?purchaseId=${p.id}`)}
                              className="p-1 text-orange-600 hover:text-orange-800 rounded hover:bg-orange-50"
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
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-xs">
            <div className="text-xs text-slate-500">
              Track purchase requisitions (PR) and purchase orders (PO). Convert directly to inward bills when delivered.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setPoModalMode("pr");
                  setIsPoModalOpen(true);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                + New Request (PR)
              </button>
              <button
                onClick={() => {
                  setPoModalMode("po");
                  setIsPoModalOpen(true);
                }}
                className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700"
              >
                + New Purchase Order (PO)
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
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
              <tbody className="divide-y divide-slate-100">
                {ordersList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <ShoppingBag className="mx-auto h-8 w-8 text-slate-300 mb-1" />
                      <p className="font-semibold text-xs">No purchase orders created yet</p>
                    </td>
                  </tr>
                ) : (
                  ordersList.map((po) => (
                    <tr key={po.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-blue-600">{po.po_number}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{po.supplier_name}</td>
                      <td className="px-4 py-3 text-slate-500">{po.po_date}</td>
                      <td className="px-4 py-3 text-slate-500">{po.expected_delivery_date || "-"}</td>
                      <td className="px-4 py-3 text-center font-medium">{po.items?.length || 0}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-900">
                        ₹ {Number(po.total_amount || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                            po.status === "completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : po.status === "partially_received"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {po.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {po.status !== "completed" && po.status !== "cancelled" ? (
                          <button
                            onClick={() => handleConvertPO(po)}
                            className="rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-700"
                          >
                            Inward Bill
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Fulfilled</span>
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
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">Select Supplier</h3>
                <button
                  onClick={() => setIsQuickAddSupplierOpen(true)}
                  className="text-[11px] font-bold text-blue-600 hover:underline"
                >
                  + Add New
                </button>
              </div>

              <select
                value={selectedLedgerSupplierId}
                onChange={(e) => setSelectedLedgerSupplierId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 p-2 text-xs font-medium bg-white focus:border-blue-600 focus:outline-none"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Bal: ₹{Number(s.outstanding_balance || 0).toFixed(2)})
                  </option>
                ))}
              </select>

              {supplierStatement?.supplier && (
                <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-2 border border-slate-200">
                  <div className="font-bold text-slate-800 text-sm">{supplierStatement.supplier.name}</div>
                  {supplierStatement.supplier.phone && <div>Phone: {supplierStatement.supplier.phone}</div>}
                  {supplierStatement.supplier.gstin && <div>GSTIN: {supplierStatement.supplier.gstin}</div>}
                  <div>Credit Period: {supplierStatement.supplier.credit_period_days || 30} Days</div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between font-black text-sm">
                    <span>Closing Balance:</span>
                    <span className="text-blue-700">₹ {supplierStatement.summary.closingBalance.toFixed(2)}</span>
                  </div>
                </div>
              )}

              <button
                onClick={() => setIsPaymentModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
              >
                <CreditCard className="h-4 w-4" />
                <span>Record Supplier Payment</span>
              </button>
            </div>

            {/* Statement Ledger History */}
            <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-3">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                  Ledger Statement Entries
                </h3>
                <span className="text-[11px] text-slate-500">
                  {supplierStatement?.entries.length || 0} Transactions
                </span>
              </div>

              <div className="flex-1 overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Type / Ref</th>
                      <th className="px-3 py-2 text-right">Debit (₹)</th>
                      <th className="px-3 py-2 text-right">Credit (₹)</th>
                      <th className="px-3 py-2 text-right font-bold">Balance (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {supplierStatement?.entries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          No transactions recorded for this supplier
                        </td>
                      </tr>
                    ) : (
                      supplierStatement?.entries.map((e, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2 text-slate-600">{e.entry_date}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-slate-800">{e.reference_number}</span>
                            <div className="text-[10px] text-slate-400">{e.notes}</div>
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-700 font-medium">
                            {e.debit_amount > 0 ? `₹${e.debit_amount.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right text-red-700 font-medium">
                            {e.credit_amount > 0 ? `₹${e.credit_amount.toFixed(2)}` : "-"}
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-slate-900">
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
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide mb-3">
              Supplier Payables Ageing Analysis (Days Overdue)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2.5">Supplier Name</th>
                    <th className="px-3 py-2.5 text-center">Credit Days</th>
                    <th className="px-3 py-2.5 text-right">Current</th>
                    <th className="px-3 py-2.5 text-right">1 - 30 Days</th>
                    <th className="px-3 py-2.5 text-right">31 - 60 Days</th>
                    <th className="px-3 py-2.5 text-right">61 - 90 Days</th>
                    <th className="px-3 py-2.5 text-right text-red-700 font-bold">90+ Days</th>
                    <th className="px-3 py-2.5 text-right font-black">Total Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ageingList.map((a, idx) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-800">{a.supplier_name}</td>
                      <td className="px-3 py-2 text-center text-slate-500">{a.credit_period_days}d</td>
                      <td className="px-3 py-2 text-right text-slate-600">₹{a.current.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">₹{a.days_1_30.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-amber-700 font-medium">₹{a.days_31_60.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-orange-700 font-medium">₹{a.days_61_90.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-red-700 font-bold">₹{a.days_90_plus.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-black text-slate-900">
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
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4 text-xs">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800">Inward Tax Credit (ITC / GSTR-2) Summary</h3>
              <p className="text-[11px] text-slate-500">
                Breakdown of Input Tax Credit eligible for GST return filing
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-blue-50 p-3.5 border border-blue-200">
              <span className="text-[11px] font-bold text-blue-700 uppercase">CGST Input Credit</span>
              <div className="text-lg font-black text-blue-900 mt-1">
                ₹ {purchasesList.reduce((a, b) => a + (b.cgst_total || 0), 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3.5 border border-blue-200">
              <span className="text-[11px] font-bold text-blue-700 uppercase">SGST Input Credit</span>
              <div className="text-lg font-black text-blue-900 mt-1">
                ₹ {purchasesList.reduce((a, b) => a + (b.sgst_total || 0), 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded-lg bg-purple-50 p-3.5 border border-purple-200">
              <span className="text-[11px] font-bold text-purple-700 uppercase">IGST Input Credit</span>
              <div className="text-lg font-black text-purple-900 mt-1">
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
    </div>
  );
};
