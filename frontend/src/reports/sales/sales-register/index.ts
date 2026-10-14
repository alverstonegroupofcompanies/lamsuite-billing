import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { salesMetricsService, type SalesRegisterRow } from "../../../lib/data-layer/financials/salesMetrics";

export interface SalesRegisterFilter {
  startDate: string;
  endDate: string;
  paymentMode: string;
  status: string;
}

export const salesRegisterColumns: ReportColumn<SalesRegisterRow>[] = [
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
    header: "Customer Name",
    accessor: (r) => r.customer_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "customer_gstin",
    header: "Customer GSTIN",
    accessor: (r) => r.customer_gstin,
    align: "center",
    width: 140,
    isDefaultVisible: false,
  },
  {
    id: "payment_mode",
    header: "Payment",
    accessor: (r) => r.payment_mode,
    align: "center",
    width: 100,
    format: "badge",
    badgeStyle: (val) => {
      const lower = String(val).toLowerCase();
      if (lower === "cash") return "success";
      if (lower === "upi") return "info";
      if (lower === "card") return "warning";
      if (lower === "credit") return "danger";
      return "neutral";
    },
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "taxable_subtotal",
    header: "Taxable (₹)",
    accessor: (r) => r.taxable_subtotal,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "cgst_amount",
    header: "CGST (₹)",
    accessor: (r) => r.cgst_amount,
    align: "right",
    width: 90,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst_amount",
    header: "SGST (₹)",
    accessor: (r) => r.sgst_amount,
    align: "right",
    width: 90,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst_amount",
    header: "IGST (₹)",
    accessor: (r) => r.igst_amount,
    align: "right",
    width: 90,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "tax_total",
    header: "Total Tax (₹)",
    accessor: (r) => r.tax_total,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "round_off",
    header: "Round Off (₹)",
    accessor: (r) => r.round_off,
    align: "right",
    width: 85,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "grand_total",
    header: "Grand Total (₹)",
    accessor: (r) => r.grand_total,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);

export const salesRegisterFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: today, endDate: today },
    required: true,
  },
  {
    id: "paymentMode",
    label: "Payment Mode",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Modes", value: "all" },
      { label: "Cash", value: "cash" },
      { label: "UPI / QR", value: "upi" },
      { label: "Card", value: "card" },
      { label: "Credit (Udhari)", value: "credit" },
      { label: "Bank Transfer", value: "bank" },
    ],
  },
  {
    id: "status",
    label: "Invoice Status",
    type: "select",
    defaultValue: "issued",
    options: [
      { label: "Active Bills", value: "issued" },
      { label: "All Bills", value: "all" },
      { label: "Cancelled", value: "cancelled" },
    ],
  },
];

export const salesRegisterReport: ReportModule<SalesRegisterFilter, SalesRegisterRow> = {
  id: "sales-register",
  title: "Sales Register (Detailed)",
  description: "Comprehensive bill-by-bill sales tax register with taxable value, CGST/SGST split, and payment modes.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["sales", "bills", "invoices", "taxable", "cgst", "sgst", "register", "gst"],
  defaultSort: { column: "invoice_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "thermal", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: salesRegisterFilters,
  columns: salesRegisterColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: today, endDate: today };

    const result = await salesMetricsService.getSalesRegisterData({
      startDate: dates.startDate,
      endDate: dates.endDate,
      paymentMode: params.filters.paymentMode,
      status: params.filters.status,
      searchQuery: params.searchQuery,
      page: params.pagination?.page,
      pageSize: params.pagination?.pageSize,
      sortColumn: params.sort?.column,
      sortDirection: params.sort?.direction,
    });

    return {
      rows: result.rows,
      totalCount: result.totalCount,
      summary: {
        taxable_subtotal: result.summary.totalTaxable,
        cgst_amount: result.summary.totalCgst,
        sgst_amount: result.summary.totalSgst,
        igst_amount: result.summary.totalIgst,
        tax_total: result.summary.totalTax,
        grand_total: result.summary.totalGrand,
      },
      page: params.pagination?.page || 1,
      pageSize: params.pagination?.pageSize || 25,
      totalPages: params.pagination ? Math.ceil(result.totalCount / params.pagination.pageSize) : 1,
    };
  },
};
