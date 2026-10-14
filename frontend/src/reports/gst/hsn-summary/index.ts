import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { salesMetricsService, type HsnSummaryRow } from "../../../lib/data-layer/financials/salesMetrics";

export const hsnColumns: ReportColumn<HsnSummaryRow>[] = [
  {
    id: "hsn_code",
    header: "HSN / SAC Code",
    accessor: (r) => r.hsn_code,
    align: "center",
    width: 130,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "description",
    header: "Description of Goods",
    accessor: (r) => r.description,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "gst_rate",
    header: "GST Rate (%)",
    accessor: (r) => `${r.gst_rate}%`,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "uqc",
    header: "UQC",
    accessor: (r) => r.uqc,
    align: "center",
    width: 80,
    isDefaultVisible: true,
  },
  {
    id: "total_qty",
    header: "Total Qty",
    accessor: (r) => r.total_qty,
    align: "right",
    width: 100,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "taxable_value",
    header: "Taxable Value (₹)",
    accessor: (r) => r.taxable_value,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "central_tax",
    header: "CGST (₹)",
    accessor: (r) => r.central_tax,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "state_tax",
    header: "SGST (₹)",
    accessor: (r) => r.state_tax,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "integrated_tax",
    header: "IGST (₹)",
    accessor: (r) => r.integrated_tax,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "total_value",
    header: "Total Value (₹)",
    accessor: (r) => r.total_value,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const hsnFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Return Tax Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const hsnSummaryReport: ReportModule<any, HsnSummaryRow> = {
  id: "hsn-summary",
  title: "HSN / SAC Tax Summary (Table 12)",
  description: "Commodity-wise and HSN code breakdown of outwards supplies, quantities, and applicable GST rates.",
  category: "gst",
  permission: "reports.gst.view",
  menuVisibilityKey: "reports",
  keywords: ["hsn", "sac", "table 12", "commodity", "tax slabs", "gst summary"],
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: hsnFilters,
  columns: hsnColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const rows = await salesMetricsService.getHsnSummaryData({
      startDate: dates.startDate,
      endDate: dates.endDate,
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) => r.hsn_code.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)
      );
      return {
        rows: filtered,
        totalCount: filtered.length,
        page: 1,
        pageSize: filtered.length,
        totalPages: 1,
      };
    }

    return {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
