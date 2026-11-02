import React, { useEffect, useState } from "react";
import { Invoice, InvoiceItem } from "../types";
import { api, ApiError } from "../services/api";
import { formatINR, formatDate, formatDateTime, formatIndianNumber } from "../utils/formatters";
import { useAuth } from "../context/AuthContext";
import { ConfirmModal } from "../components/ConfirmModal";
import { ConflictModal } from "../components/ConflictModal";
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
} from "lucide-react";

export const TransactionsPage: React.FC = () => {
  const { hasPermission, activeStore } = useAuth();
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
  const [suppliersList, setSuppliersList] = useState<any[]>([]);

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
        const res = await api.get<{ data: any[] }>("/admin/expenses", storeParam);
        setExpenses(res.data || []);
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
    } catch (e) {
      console.error("Failed to load suppliers:", e);
    }
  };

  const handleCreateSupplierPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore || !supplierPaySupplierId || !supplierPayAmount) return;

    try {
      await api.post("/admin/supplier-payments", {
        store_id: activeStore.id,
        supplier_id: supplierPaySupplierId,
        amount: Number(supplierPayAmount),
        payment_mode: supplierPayMode,
        reference_no: supplierPayRef,
        notes: supplierPayNotes,
      });
      setIsSupplierPayModalOpen(false);
      setSupplierPayAmount("");
      setSupplierPayRef("");
      setSupplierPayNotes("");
      await fetchTransactions();
    } catch (err: any) {
      alert(err?.message || "Failed to record supplier payment.");
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
      </div>

      {/* Tabs Toolbar */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 sm:gap-2 text-xs font-semibold overflow-x-auto pb-px">
        {[
          { id: "invoices", label: "Sales Invoices", icon: Receipt },
          { id: "returns", label: "Sales Returns & Credit Notes", icon: Undo2 },
          { id: "quotations", label: "Quotations & Estimates", icon: FileText },
          { id: "purchases", label: "Inward Purchases", icon: ShoppingBag },
          { id: "purchase_returns", label: "Purchase Returns", icon: ArrowRightLeft },
          { id: "purchase_orders", label: "Purchase Orders", icon: FileCheck2 },
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
              <option value="issued">Issued / Converted</option>
              <option value="cancelled">Cancelled</option>
              <option value="paid">Paid</option>
              <option value="draft">Draft</option>
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

      {/* Invoices Table */}
      {activeTab === "invoices" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Invoice No & Date</th>
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
                    <td colSpan={isPharmacy ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
                      Loading invoices...
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={isPharmacy ? 8 : 7} className="px-4 py-8 text-center text-slate-400">
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
                          <button
                            onClick={() => setSelectedInvoice(inv)}
                            title="View / Reprint Invoice"
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {(inv.status === "issued" || inv.status === "paid") && hasPermission("transactions", "edit") && (
                            <button
                              onClick={() => setCancelModalInvoice(inv)}
                              title="Cancel Invoice (Restores Stock & Adjusts Ledger)"
                              className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </button>
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
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Tax Refunded</th>
                <th className="px-4 py-3 text-right">Credit Amount</th>
                <th className="px-4 py-3">Refund Mode</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {returnsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Taxable</th>
                <th className="px-4 py-3 text-right">Tax Total</th>
                <th className="px-4 py-3 text-right">Estimate Total</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {quotationsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
                    <td className="px-4 py-3 font-semibold">{q.customer_name}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(q.subtotal)}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(q.tax_total)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(q.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 capitalize">
                        {q.status || "draft"}
                      </span>
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
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3">Supplier GSTIN</th>
                <th className="px-4 py-3 text-right">Tax Total</th>
                <th className="px-4 py-3 text-right">Grand Total</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No inward purchase bills recorded.
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {p.invoice_number}
                      <div className="text-[10px] text-slate-400">{formatDate(p.invoice_date)}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold">{p.supplier_name}</td>
                    <td className="px-4 py-3 font-mono">{p.supplier_gstin || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(p.tax_total)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(p.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center capitalize font-semibold text-emerald-600">{p.status}</td>
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
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3 text-right">Debit Total</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchaseReturnsList.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
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
                    <td className="px-4 py-3 font-semibold">{pr.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                      {formatINR(pr.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center capitalize text-amber-600 font-semibold">{pr.status}</td>
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
                <th className="px-4 py-3">Supplier Name</th>
                <th className="px-4 py-3 text-right">Estimated Amount</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchaseOrdersList.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
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
                    <td className="px-4 py-3 font-semibold">{po.supplier_name}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      {formatINR(po.grand_total)}
                    </td>
                    <td className="px-4 py-3 text-center capitalize text-blue-600 font-semibold">{po.status}</td>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {heldBillsList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {shiftsList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {transfers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Expenses View */}
      {activeTab === "expenses" && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
          <table className="w-full text-xs text-left text-slate-600 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">Voucher Ref & Date</th>
                <th className="px-4 py-3">Expense Head</th>
                <th className="px-4 py-3">Payment Mode</th>
                <th className="px-4 py-3">Notes</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No expense vouchers recorded.
                  </td>
                </tr>
              ) : (
                expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 dark:text-white">
                      {e.reference_no}
                      <div className="text-[10px] text-slate-400">{formatDate(e.expense_date)}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">{e.expense_head}</td>
                    <td className="px-4 py-3">{e.payment_mode}</td>
                    <td className="px-4 py-3 text-slate-400">{e.notes || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-red-600 dark:text-red-400">
                      {formatINR(e.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {supplierPaymentsList.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Record Supplier Payment Modal */}
      {isSupplierPayModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4">
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
                  onChange={(e) => setSupplierPaySupplierId(e.target.value)}
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
    </div>
  );
};
