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
} from "lucide-react";

export const TransactionsPage: React.FC = () => {
  const { hasPermission, activeStore } = useAuth();
  const [activeTab, setActiveTab] = useState<"invoices" | "purchases" | "transfers" | "expenses" | "payments">("invoices");

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);

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

  const fetchTransactions = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "invoices") {
        const res = await api.get<{
          data: Invoice[];
          current_page?: number;
          last_page?: number;
          total?: number;
        }>("/admin/invoices", {
          search,
          status: statusFilter,
          page,
          per_page: perPage,
        });
        setInvoices(res.data || []);
        if (res.last_page !== undefined) setTotalPages(res.last_page);
        if (res.total !== undefined) setTotalCount(res.total);
      } else if (activeTab === "purchases") {
        const res = await api.get<{ data: any[] }>("/admin/purchases", { search, per_page: 200 });
        setPurchases(res.data || []);
      } else if (activeTab === "transfers") {
        const res = await api.get<{ data: any[] }>("/admin/stock/transfers");
        setTransfers(res.data || []);
      } else if (activeTab === "expenses") {
        const res = await api.get<{ data: any[] }>("/admin/expenses");
        setExpenses(res.data || []);
      } else if (activeTab === "payments") {
        const res = await api.get<{ data: any[] }>("/admin/customer-payments");
        setPayments(res.data || []);
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
  }, [activeTab, search, statusFilter, activeStore]);

  const handleCancelInvoice = async (reason: string) => {
    if (!cancelModalInvoice) return;
    try {
      await api.post(`/admin/invoices/${cancelModalInvoice.id}/cancel`, { reason });
      alert(`Invoice ${cancelModalInvoice.invoice_number} successfully cancelled. Stock restored and customer ledger updated.`);
      setCancelModalInvoice(null);
      await fetchTransactions();
    } catch (err: any) {
      alert(err?.message || "Invoice cancellation failed.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Title */}
      <div>
        <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
          Transaction Records & Document Control
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Sales invoices, inward purchase orders, stock transfers, petty cash expenses, and customer receipts.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-4 text-xs font-semibold overflow-x-auto pb-0.5">
        {[
          { id: "invoices", label: "Sales Invoices", icon: Receipt },
          { id: "purchases", label: "Purchase Bills", icon: ShoppingBag },
          { id: "transfers", label: "Stock Transfers", icon: ArrowRightLeft },
          { id: "expenses", label: "Expenses", icon: DollarSign },
          { id: "payments", label: "Customer Receipts", icon: CreditCard },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.id
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

      {/* Toolbar */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice number, customer, doctor..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {activeTab === "invoices" && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-700 dark:text-slate-300"
            >
              <option value="">All Status</option>
              <option value="issued">Issued Only</option>
              <option value="cancelled">Cancelled Only</option>
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
                  <th className="px-4 py-3">Customer / Patient</th>
                  <th className="px-4 py-3">Prescription Doctor</th>
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
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Loading invoices...
                    </td>
                  </tr>
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
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
                        {inv.patient_name && (
                          <div className="text-[10px] text-slate-400">Pt: {inv.patient_name}</div>
                        )}
                      </td>
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
                      <td className="px-4 py-3 text-right font-mono">{formatINR(inv.subtotal)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatINR(inv.tax_total)}</td>
                      <td className="px-4 py-3 text-right font-bold font-mono text-slate-900 dark:text-white">
                        {formatINR(inv.grand_total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold capitalize ${
                            inv.status === "issued"
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
                            title="View / Thermal Reprint Invoice"
                            className="p-1.5 text-slate-400 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 rounded-lg"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {inv.status === "issued" && hasPermission("transactions", "edit") && (
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
            <div className="flex items-center gap-2">
              <span>
                Showing page <strong className="text-slate-800 dark:text-slate-200 font-semibold">{page}</strong> of{" "}
                <strong className="text-slate-800 dark:text-slate-200 font-semibold">{totalPages}</strong> ({totalCount.toLocaleString()} total invoices)
              </span>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <div className="flex items-center gap-1.5">
                <span>Per page:</span>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value));
                    setPage(1);
                  }}
                  className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-300 font-medium"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-2xs"
              >
                Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, idx) => {
                  let pNum = page - 2 + idx;
                  if (page < 3) pNum = idx + 1;
                  if (page > totalPages - 2) pNum = totalPages - 4 + idx;
                  if (pNum < 1 || pNum > totalPages) return null;

                  return (
                    <button
                      key={pNum}
                      onClick={() => setPage(pNum)}
                      className={`w-7 h-7 rounded-lg text-xs font-semibold transition ${
                        page === pNum
                          ? "bg-brand-600 text-white shadow-2xs"
                          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {pNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 disabled:opacity-50 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700/60 transition shadow-2xs"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purchases View */}
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
                    No purchase bills recorded.
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id}>
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

      {/* Invoice Thermal Reprint Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full p-6 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <Printer className="w-4 h-4 text-brand-600" />
                <span>Thermal Invoice Voucher: {selectedInvoice.invoice_number}</span>
              </h3>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Thermal Slip Preview Box */}
            <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 text-xs font-mono space-y-2">
              <div className="text-center font-bold text-sm">LAMSTONE PHARMACY & RETAIL</div>
              <div className="text-center text-[10px] text-slate-500">Palakkad, Kerala | GSTIN: 32AAAAA0000A1Z5</div>
              <div className="border-b border-dashed border-slate-300 dark:border-slate-800 my-2" />
              <div className="flex justify-between">
                <span>Inv: {selectedInvoice.invoice_number}</span>
                <span>Date: {formatDate(selectedInvoice.invoice_date)}</span>
              </div>
              <div className="text-[11px]">Customer: {selectedInvoice.customer_name}</div>
              {selectedInvoice.doctor_name && (
                <div className="text-[10px] text-slate-500">Doctor: {selectedInvoice.doctor_name}</div>
              )}
              <div className="border-b border-dashed border-slate-300 dark:border-slate-800 my-2" />

              {/* Items */}
              <div className="space-y-1">
                {selectedInvoice.items?.map((it) => (
                  <div key={it.id} className="flex justify-between">
                    <span className="truncate max-w-[180px]">{it.product_name} x {it.qty}</span>
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
                Thank you for shopping with us! Get well soon.
              </div>
            </div>

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
