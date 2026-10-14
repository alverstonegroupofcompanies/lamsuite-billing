import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord } from "../../../lib/billing/invoiceManagementService";

export interface DiscountAnalysisRow {
  invoice_number: string;
  invoice_date: string;
  customer_name: string;
  gross_subtotal: number;
  discount_amount: number;
  discount_percent: number;
  grand_total: number;
  payment_mode: string;
}

export const discountColumns: ReportColumn<DiscountAnalysisRow>[] = [
  {
    id: "invoice_number",
    header: "Bill No",
    accessor: (r) => r.invoice_number,
    align: "left",
    width: 130,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "invoice_date",
    header: "Date",
    accessor: (r) => r.invoice_date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "customer_name",
    header: "Customer",
    accessor: (r) => r.customer_name,
    align: "left",
    width: 190,
    isDefaultVisible: true,
  },
  {
    id: "gross_subtotal",
    header: "Gross Value (₹)",
    accessor: (r) => r.gross_subtotal,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "discount_amount",
    header: "Discount (₹)",
    accessor: (r) => r.discount_amount,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "discount_percent",
    header: "Effective Disc %",
    accessor: (r) => r.discount_percent,
    align: "right",
    width: 120,
    format: "percentage",
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "grand_total",
    header: "Billed Total (₹)",
    accessor: (r) => r.grand_total,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "payment_mode",
    header: "Payment",
    accessor: (r) => r.payment_mode,
    align: "center",
    width: 100,
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const discountFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const discountReport: ReportModule<any, DiscountAnalysisRow> = {
  id: "discount-report",
  title: "Discounts & Scheme Concessions",
  description: "Audit trail of price markdowns, trade discounts, and promotional schemes given to customers.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["discount", "concession", "markdown", "scheme", "margin loss"],
  defaultSort: { column: "discount_amount", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: discountFilters,
  columns: discountColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");

    const filtered = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.module_key === "invoice" &&
        Number(inv.discount_total || 0) > 0 &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );

    const rows: DiscountAnalysisRow[] = filtered.map((inv) => {
      const disc = Number(inv.discount_total) || 0;
      const grand = Number(inv.grand_total) || 0;
      const gross = grand + disc;
      const pct = gross > 0 ? Math.round((disc / gross) * 1000) / 10 : 0;

      return {
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        customer_name: inv.customer_name || "Walk-in Customer",
        gross_subtotal: Math.round(gross * 100) / 100,
        discount_amount: Math.round(disc * 100) / 100,
        discount_percent: pct,
        grand_total: Math.round(grand * 100) / 100,
        payment_mode: inv.payment_mode || "Cash",
      };
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const searchFiltered = rows.filter(
        (r) => r.invoice_number.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q)
      );
      return { rows: searchFiltered, totalCount: searchFiltered.length, page: 1, pageSize: searchFiltered.length, totalPages: 1 };
    }

    return { rows, totalCount: rows.length, page: 1, pageSize: rows.length, totalPages: 1 };
  },
};
