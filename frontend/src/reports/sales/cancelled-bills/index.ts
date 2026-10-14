import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { salesMetricsService, type CancelledBillRow } from "../../../lib/data-layer/financials/salesMetrics";

export const cancelledBillsColumns: ReportColumn<CancelledBillRow>[] = [
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
    header: "Bill Date",
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
    width: 180,
    isDefaultVisible: true,
  },
  {
    id: "customer_phone",
    header: "Mobile",
    accessor: (r) => r.customer_phone || "-",
    align: "center",
    width: 120,
    isDefaultVisible: false,
  },
  {
    id: "grand_total",
    header: "Cancelled Amount (₹)",
    accessor: (r) => r.grand_total,
    align: "right",
    width: 150,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "payment_mode",
    header: "Original Mode",
    accessor: (r) => r.payment_mode,
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "cancel_reason",
    header: "Reason for Cancellation",
    accessor: (r) => r.cancel_reason,
    align: "left",
    width: 220,
    isDefaultVisible: true,
  },
  {
    id: "cancelled_at",
    header: "Cancelled Time",
    accessor: (r) => new Date(r.cancelled_at).toLocaleTimeString(),
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "user_counter",
    header: "Counter / Terminal",
    accessor: (r) => r.user_counter || "Main Counter",
    align: "center",
    width: 130,
    isDefaultVisible: false,
  },
];

const today = new Date().toISOString().slice(0, 10);

export const cancelledBillsFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: today, endDate: today },
    required: true,
  },
];

export const cancelledBillsReport: ReportModule<any, CancelledBillRow> = {
  id: "cancelled-bills",
  title: "Cancelled Bills Audit",
  description: "Audit trail of voided transactions with operator reasons and restored stock quantities.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["cancel", "void", "audit", "fraud", "reasons", "deleted bills"],
  defaultSort: { column: "invoice_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: cancelledBillsFilters,
  columns: cancelledBillsColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: today, endDate: today };

    const result = await salesMetricsService.getCancelledBillsData({
      startDate: dates.startDate,
      endDate: dates.endDate,
      searchQuery: params.searchQuery,
      page: params.pagination?.page,
      pageSize: params.pagination?.pageSize,
    });

    return {
      rows: result.rows,
      totalCount: result.totalCount,
      summary: {
        grand_total: result.summary.totalAmount,
      },
      page: params.pagination?.page || 1,
      pageSize: params.pagination?.pageSize || 25,
      totalPages: params.pagination ? Math.ceil(result.totalCount / params.pagination.pageSize) : 1,
    };
  },
};
