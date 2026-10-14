import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";

export interface SupplierLedgerRow {
  entry_date: string;
  supplier_name: string;
  voucher_type: "PURCHASE" | "PAYMENT" | "DEBIT NOTE";
  voucher_no: string;
  debit_amount: number; // payments / debit notes
  credit_amount: number; // purchases
  running_balance: number; // net payable
  payment_mode?: string;
  notes?: string;
}

export const supplierLedgerColumns: ReportColumn<SupplierLedgerRow>[] = [
  {
    id: "entry_date",
    header: "Date",
    accessor: (r) => r.entry_date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "supplier_name",
    header: "Supplier Name",
    accessor: (r) => r.supplier_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "voucher_type",
    header: "Voucher Type",
    accessor: (r) => r.voucher_type,
    align: "center",
    width: 120,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "PURCHASE") return "warning";
      if (val === "PAYMENT") return "success";
      return "info";
    },
    isDefaultVisible: true,
  },
  {
    id: "voucher_no",
    header: "Voucher / Ref No",
    accessor: (r) => r.voucher_no,
    align: "left",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "debit_amount",
    header: "Debit / Paid (₹)",
    accessor: (r) => (r.debit_amount > 0 ? r.debit_amount : "-"),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "credit_amount",
    header: "Credit / Inward (₹)",
    accessor: (r) => (r.credit_amount > 0 ? r.credit_amount : "-"),
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "running_balance",
    header: "Balance Payable (₹)",
    accessor: (r) => r.running_balance,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
  },
  {
    id: "notes",
    header: "Remarks",
    accessor: (r) => r.notes || "-",
    align: "left",
    width: 150,
    isDefaultVisible: false,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const supplierLedgerFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Statement Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "supplierName",
    label: "Supplier Filter",
    type: "text",
    defaultValue: "",
    placeholder: "Filter by supplier name...",
  },
];

export const supplierLedgerReport: ReportModule<any, SupplierLedgerRow> = {
  id: "supplier-ledger",
  title: "Supplier Ledger & Statement of Accounts",
  description: "Complete chronological supplier statement tracking purchase bills, bank/cash payments, debit notes, and running balance payable.",
  category: "supplier",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["supplier ledger", "vendor ledger", "statement of account", "payables", "supplier balance", "credit statement"],
  defaultSort: { column: "entry_date", direction: "asc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: supplierLedgerFilters,
  columns: supplierLedgerColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    // Query party_ledger_entries if available, or build directly from purchase_documents and supplier_payments
    const [partyEntries, allPurchasesDocs, allPurchasesAlt, payments] = await Promise.all([
      sqliteStorage.findAll<any>("party_ledger_entries").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<any>("supplier_payments").catch(() => []),
    ]);

    const purchaseDedupMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseDedupMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseDedupMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseDedupMap.values());

    const rows: SupplierLedgerRow[] = [];

    if (partyEntries.length > 0) {
      const supplierEntries = partyEntries.filter(
        (e: any) =>
          e.party_type === "supplier" &&
          String(e.entry_date || "").trim().slice(0, 10) >= startDateStr &&
          String(e.entry_date || "").trim().slice(0, 10) <= endDateStr
      );

      for (const e of supplierEntries) {
        rows.push({
          entry_date: String(e.entry_date || "").trim().slice(0, 10),
          supplier_name: e.party_name || e.party_id,
          voucher_type: (e.reference_type === "purchase"
            ? "PURCHASE"
            : e.reference_type === "payment"
            ? "PAYMENT"
            : "DEBIT NOTE") as any,
          voucher_no: e.reference_number || e.reference_id,
          debit_amount: Number(e.debit_amount) || 0,
          credit_amount: Number(e.credit_amount) || 0,
          running_balance: Number(e.running_balance) || 0,
          payment_mode: e.payment_mode,
          notes: e.notes,
        });
      }
    } else {
      // Reconstruct ledger from purchases and payments
      for (const p of allPurchases) {
        if (!p || (p.status || "").toLowerCase() === "cancelled") continue;
        const pDate = String(p.purchase_date || "").trim().slice(0, 10);
        if (startDateStr && pDate < startDateStr) continue;
        if (endDateStr && pDate > endDateStr) continue;

        const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
        const grand = Number(p.grand_total) || 0;

        if (isReturn) {
          rows.push({
            entry_date: p.purchase_date,
            supplier_name: p.supplier_name,
            voucher_type: "DEBIT NOTE",
            voucher_no: p.purchase_number,
            debit_amount: grand,
            credit_amount: 0,
            running_balance: 0,
            notes: p.notes,
          });
        } else {
          rows.push({
            entry_date: p.purchase_date,
            supplier_name: p.supplier_name,
            voucher_type: "PURCHASE",
            voucher_no: p.supplier_invoice_no || p.purchase_number,
            debit_amount: 0,
            credit_amount: grand,
            running_balance: 0,
            notes: p.notes,
          });

          // If paid at purchase
          if (p.paid_amount && Number(p.paid_amount) > 0) {
            rows.push({
              entry_date: p.purchase_date,
              supplier_name: p.supplier_name,
              voucher_type: "PAYMENT",
              voucher_no: `PAY-${p.purchase_number}`,
              debit_amount: Number(p.paid_amount),
              credit_amount: 0,
              running_balance: 0,
              notes: "Paid on purchase",
            });
          }
        }
      }

      for (const pay of payments) {
        if (pay.payment_date < dates.startDate || pay.payment_date > dates.endDate) continue;
        rows.push({
          entry_date: pay.payment_date,
          supplier_name: pay.supplier_name,
          voucher_type: "PAYMENT",
          voucher_no: pay.payment_number || pay.reference_no || "PAY",
          debit_amount: Number(pay.amount) || 0,
          credit_amount: 0,
          running_balance: 0,
          payment_mode: pay.payment_mode,
          notes: pay.notes,
        });
      }
    }

    // Sort chronologically to compute running balance
    rows.sort((a, b) => a.entry_date.localeCompare(b.entry_date));

    let balance = 0;
    for (const r of rows) {
      balance = balance + r.credit_amount - r.debit_amount;
      r.running_balance = Math.round(balance * 100) / 100;
    }

    let filtered = rows;
    if (params.filters.supplierName) {
      const s = String(params.filters.supplierName).toLowerCase();
      filtered = filtered.filter((r) => r.supplier_name.toLowerCase().includes(s));
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.supplier_name.toLowerCase().includes(q) ||
          r.voucher_no.toLowerCase().includes(q)
      );
    }

    return {
      rows: filtered,
      totalCount: filtered.length,
      page: 1,
      pageSize: filtered.length,
      totalPages: 1,
    };
  },
};
