import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { salesMetricsService } from "../../../lib/data-layer/financials/salesMetrics";

export interface DailyCollectionRow {
  category: string;
  count: number;
  amount: number;
  sharePercent: number;
  note?: string;
}

export const dailyCollectionColumns: ReportColumn<DailyCollectionRow>[] = [
  {
    id: "category",
    header: "Collection / Tender Mode",
    accessor: (r) => r.category,
    align: "left",
    width: 260,
    isDefaultVisible: true,
    canHide: false,
    canSort: false,
  },
  {
    id: "count",
    header: "Transactions",
    accessor: (r) => r.count,
    align: "center",
    width: 120,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "amount",
    header: "Amount (₹)",
    accessor: (r) => r.amount,
    align: "right",
    width: 160,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
  },
  {
    id: "sharePercent",
    header: "Share (%)",
    accessor: (r) => r.sharePercent,
    align: "right",
    width: 120,
    format: "percentage",
    isDefaultVisible: true,
  },
  {
    id: "note",
    header: "Remarks / Accounting Impact",
    accessor: (r) => r.note || "-",
    align: "left",
    width: 220,
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);

export const dailyCollectionFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: today, endDate: today },
    required: true,
  },
];

export const dailyCollectionReport: ReportModule<any, DailyCollectionRow> = {
  id: "daily-collection",
  title: "Daily Collection Summary",
  description: "End-of-day counter reconciliation, cash drawer balance, digital payments, and gross vs net sales.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["daily", "collection", "tender", "cash", "upi", "drawer", "shift", "reconciliation"],
  supportedPrintLayouts: ["thermal", "a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: dailyCollectionFilters,
  columns: dailyCollectionColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: today, endDate: today };

    const metrics = await salesMetricsService.calculateFinancialMetrics({
      startDate: dates.startDate,
      endDate: dates.endDate,
    });

    const totalCollected = metrics.byTender.totalCollected || metrics.netSales || 1;

    const rows: DailyCollectionRow[] = [
      {
        category: "Gross Retail Sales",
        count: metrics.billsIssuedCount,
        amount: metrics.grossSales,
        sharePercent: 100,
        note: "Total bill value issued before returns",
      },
      {
        category: "Sales Returns & Refunds",
        count: metrics.returnsCount,
        amount: -metrics.totalReturns,
        sharePercent: metrics.grossSales > 0 ? -Math.round((metrics.totalReturns / metrics.grossSales) * 1000) / 10 : 0,
        note: "Customer return vouchers deducted",
      },
      {
        category: "NET SALES (Revenue)",
        count: metrics.billsIssuedCount,
        amount: metrics.netSales,
        sharePercent: 100,
        note: "True net sales for statutory GST reporting",
      },
      {
        category: "  ├─ Cash in Drawer",
        count: 0,
        amount: metrics.byTender.cash,
        sharePercent: Math.round((metrics.byTender.cash / totalCollected) * 1000) / 10,
        note: "Physical currency received in register",
      },
      {
        category: "  ├─ UPI / QR Scan (PhonePe, GPay)",
        count: 0,
        amount: metrics.byTender.upi,
        sharePercent: Math.round((metrics.byTender.upi / totalCollected) * 1000) / 10,
        note: "Bank account instant credit",
      },
      {
        category: "  ├─ Card (POS Terminal)",
        count: 0,
        amount: metrics.byTender.card,
        sharePercent: Math.round((metrics.byTender.card / totalCollected) * 1000) / 10,
        note: "Credit / Debit card swipes",
      },
      {
        category: "  ├─ Bank Transfer / NEFT / IMPS",
        count: 0,
        amount: metrics.byTender.bankTransfer,
        sharePercent: Math.round((metrics.byTender.bankTransfer / totalCollected) * 1000) / 10,
        note: "Direct bank inward transfers",
      },
      {
        category: "  ├─ Customer Credit (Udhari)",
        count: 0,
        amount: metrics.byTender.credit,
        sharePercent: Math.round((metrics.byTender.credit / totalCollected) * 1000) / 10,
        note: "Outstanding posted to customer ledger",
      },
      {
        category: "  └─ Other Modes / Cheque",
        count: 0,
        amount: metrics.byTender.other,
        sharePercent: Math.round((metrics.byTender.other / totalCollected) * 1000) / 10,
        note: "Vouchers or adjustments",
      },
      {
        category: "Total Tax Collected (CGST + SGST + IGST)",
        count: 0,
        amount: metrics.taxes.totalTax,
        sharePercent: metrics.netSales > 0 ? Math.round((metrics.taxes.totalTax / metrics.netSales) * 1000) / 10 : 0,
        note: "Statutory tax liability",
      },
      {
        category: "Round-Off Adjustments",
        count: 0,
        amount: metrics.taxes.totalRoundOff,
        sharePercent: 0,
        note: "Paisa fractional rounding",
      },
    ];

    return {
      rows,
      totalCount: rows.length,
      summary: {
        category: "TOTAL REVENUE",
        count: metrics.billsIssuedCount,
        amount: metrics.netSales,
        sharePercent: 100,
      },
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
