import type { ReportColumn, ReportFilterDef, ReportModule } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";
import type { PurchaseChargeRecord } from "../../../lib/reports/purchaseChargeRegister";
import {
  expenseRegister,
  SOURCE_CHARGE,
  type ExpenseRegisterRow,
  type ManualExpenseRecord,
} from "../../../lib/reports/expenseRegister";

/**
 * REP-008 — everything booked as expense for the period, manual entries and expense-treated bill
 * charges in one footing. The charge rows come from `purchase_charges`, not from the `expenses`
 * twins PUR-012 writes for them, so an edited bill cannot lose or double its own freight.
 */

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

const yesNo = (value: boolean) => (value ? "Yes" : "No");

export const expenseRegisterColumns: ReportColumn<ExpenseRegisterRow>[] = [
  {
    id: "date",
    header: "Date",
    accessor: (r) => r.date,
    align: "center",
    width: 100,
    format: "date",
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "source",
    header: "Source",
    accessor: (r) => (r.source === SOURCE_CHARGE ? "Bill Charge" : "Manual"),
    align: "center",
    width: 110,
    format: "badge",
    badgeStyle: (val) => (val === "Bill Charge" ? "info" : "neutral"),
    isDefaultVisible: true,
  },
  {
    id: "head",
    header: "Expense Head",
    accessor: (r) => r.head,
    align: "left",
    width: 180,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "head_code",
    header: "Head Code",
    accessor: (r) => r.head_code || "-",
    align: "center",
    width: 110,
    isDefaultVisible: false,
  },
  {
    id: "supplier_name",
    header: "Supplier",
    accessor: (r) => r.supplier_name || "-",
    align: "left",
    width: 170,
    isDefaultVisible: false,
  },
  {
    id: "purchase_number",
    header: "Supplier Bill No",
    // REP-008: a charge row points back at the bill it was billed on.
    accessor: (r) => r.purchase_number || "-",
    align: "left",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "expense_number",
    header: "Expense Voucher",
    accessor: (r) => r.expense_number || "-",
    align: "left",
    width: 150,
    isDefaultVisible: false,
  },
  {
    id: "taxable_amount",
    header: "Taxable (₹)",
    accessor: (r) => r.taxable_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "gst_percent",
    header: "GST %",
    accessor: (r) => r.gst_percent,
    align: "right",
    width: 80,
    format: "number",
    isDefaultVisible: false,
  },
  {
    id: "cgst_amount",
    header: "CGST (₹)",
    accessor: (r) => r.cgst_amount,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "sgst_amount",
    header: "SGST (₹)",
    accessor: (r) => r.sgst_amount,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "igst_amount",
    header: "IGST (₹)",
    accessor: (r) => r.igst_amount,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "tax_amount",
    header: "Tax (₹)",
    accessor: (r) => r.tax_amount,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "itc_eligibility",
    header: "ITC",
    accessor: (r) => r.itc_eligibility,
    align: "center",
    width: 100,
    format: "badge",
    badgeStyle: (val) => (val === "eligible" ? "success" : val === "partial" ? "warning" : "danger"),
    isDefaultVisible: true,
  },
  {
    id: "creditable_tax",
    header: "Creditable Tax (₹)",
    accessor: (r) => r.creditable_tax,
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "non_creditable_tax",
    header: "Non-Creditable Tax (₹)",
    accessor: (r) => r.non_creditable_tax,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "amount",
    header: "Expense Posted (₹)",
    accessor: (r) => r.amount,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "reversed_amount",
    header: "Reversed (₹)",
    accessor: (r) => r.reversed_amount,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "payment_mode",
    header: "Payment",
    accessor: (r) => r.payment_mode,
    align: "center",
    width: 120,
    isDefaultVisible: true,
  },
  {
    id: "in_payable",
    header: "In Supplier Payable",
    accessor: (r) => yesNo(r.in_payable),
    align: "center",
    width: 130,
    isDefaultVisible: false,
  },
  {
    id: "paid_to_label",
    header: "Paid To",
    accessor: (r) => r.paid_to_label || "-",
    align: "left",
    width: 150,
    isDefaultVisible: false,
  },
  {
    id: "is_rcm",
    header: "RCM",
    accessor: (r) => yesNo(r.is_rcm),
    align: "center",
    width: 80,
    isDefaultVisible: false,
  },
  {
    id: "note",
    header: "Note",
    accessor: (r) => r.note || "-",
    align: "left",
    width: 220,
    isDefaultVisible: false,
  },
];

export const expenseRegisterFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "source",
    label: "Source",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Postings", value: "all" },
      { label: "Bill Charges Only", value: "purchase_charge" },
      { label: "Manual Entries Only", value: "manual" },
    ],
  },
  {
    id: "head",
    label: "Expense Head",
    type: "text",
    placeholder: "Freight, Rent…",
    defaultValue: "",
  },
];

export const expenseRegisterReport: ReportModule<any, ExpenseRegisterRow> = {
  id: "expense-register",
  title: "Expense Register",
  description:
    "Every expense booked in the period — manual entries and expense-treated supplier bill charges — with tax, ITC eligibility, payment mode and the bill each charge came from.",
  category: "purchase",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["expense", "expenses", "charges", "freight", "posting", "itc", "rcm", "paid separately"],
  defaultSort: { column: "date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: expenseRegisterFilters,
  columns: expenseRegisterColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const [bills, charges, expenses] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseChargeRecord>("purchase_charges").catch(() => []),
      sqliteStorage.findAll<ManualExpenseRecord>("expenses").catch(() => []),
    ]);

    const result = expenseRegister(bills, charges, expenses, {
      startDate: String(dates.startDate || "").trim().slice(0, 10) || undefined,
      endDate: String(dates.endDate || "").trim().slice(0, 10) || undefined,
      head: String(params.filters.head || ""),
      source: (params.filters.source as "all" | "manual" | "purchase_charge") || "all",
    });

    let rows = result.rows;
    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      rows = rows.filter(
        (row) =>
          row.head.toLowerCase().includes(q) ||
          row.supplier_name.toLowerCase().includes(q) ||
          row.purchase_number.toLowerCase().includes(q) ||
          row.expense_number.toLowerCase().includes(q)
      );
    }

    return {
      // The register posts one rupee once, so the grid's own column totals are the footing;
      // `expenseRegister()` also returns a reconciliation block, which the release gate asserts.
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
