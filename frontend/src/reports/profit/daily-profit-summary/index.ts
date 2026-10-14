import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { ProductBatch, ProductItem } from "../../../lib/masters/productsStore";

export interface DailyProfitSummaryRow {
  date: string;
  bill_count: number;
  gross_sales: number;
  returns_amount: number;
  net_sales: number;
  cogs_amount: number;
  gross_profit: number;
  margin_percent: number;
}

export const dailyProfitColumns: ReportColumn<DailyProfitSummaryRow>[] = [
  {
    id: "date",
    header: "Date",
    accessor: (r) => r.date,
    align: "center",
    width: 110,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "bill_count",
    header: "Bills",
    accessor: (r) => r.bill_count,
    align: "center",
    width: 80,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "gross_sales",
    header: "Gross Sales (₹)",
    accessor: (r) => r.gross_sales,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "returns_amount",
    header: "Returns (₹)",
    accessor: (r) => r.returns_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "net_sales",
    header: "Net Sales (₹)",
    accessor: (r) => r.net_sales,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "cogs_amount",
    header: "COGS / Cost (₹)",
    accessor: (r) => r.cogs_amount,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "gross_profit",
    header: "Gross Profit (₹)",
    accessor: (r) => r.gross_profit,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "margin_percent",
    header: "Net Margin (%)",
    accessor: (r) => `${r.margin_percent.toFixed(1)}%`,
    align: "right",
    width: 110,
    isDefaultVisible: true,
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const dailyProfitFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Statement Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const dailyProfitSummaryReport: ReportModule<any, DailyProfitSummaryRow> = {
  id: "daily-profit-summary",
  title: "Daily Profitability & Margin Summary",
  description: "Day-by-day executive profitability audit tracking gross sales, customer returns, net revenue, cost of goods sold, and gross margins.",
  category: "profit",
  permission: "reports.financial.view",
  menuVisibilityKey: "reports",
  keywords: ["daily profit", "margin", "day wise profit", "cogs", "executive summary", "gross margin"],
  defaultSort: { column: "date", direction: "desc" },
  supportedPrintLayouts: ["a4", "thermal", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: dailyProfitFilters,
  columns: dailyProfitColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const [allInvoices, allInvoiceItems, allBatches, allProducts] = await Promise.all([
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
      sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
      sqliteStorage.findAll<ProductBatch>("product_batches").catch(() => []),
      sqliteStorage.findAll<ProductItem>("products").catch(() => []),
    ]);

    const activeInvoices = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );
    const invoiceMap = new Map(activeInvoices.map((inv) => [inv.id, inv]));

    const batchCostMap = new Map<string, number>();
    for (const b of allBatches) {
      if (b.purchase_rate && b.purchase_rate > 0) {
        batchCostMap.set(b.id, Number(b.purchase_rate));
        batchCostMap.set(b.batch_no, Number(b.purchase_rate));
      }
    }

    const prodCostMap = new Map<string, number>();
    for (const p of allProducts) {
      prodCostMap.set(p.id, Number(p.sel_rate || p.mrp || 0) * 0.7);
    }

    // Daily buckets
    const dailyMap = new Map<
      string,
      {
        billCount: number;
        gross: number;
        returns: number;
        cogs: number;
      }
    >();

    for (const inv of activeInvoices) {
      const cur = dailyMap.get(inv.invoice_date) || {
        billCount: 0,
        gross: 0,
        returns: 0,
        cogs: 0,
      };

      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const total = Number(inv.grand_total) || 0;

      if (isReturn) {
        cur.returns += total;
      } else {
        cur.gross += total;
        cur.billCount += 1;
      }

      dailyMap.set(inv.invoice_date, cur);
    }

    // Calculate COGS per day
    for (const item of allInvoiceItems) {
      if (!invoiceMap.has(item.invoice_id)) continue;
      const inv = invoiceMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const qty = (Number(item.qty || (item as any).quantity) || 0) * sign;
      const bKey = (item as any).batch_id || item.batch_no;
      const batchCost = bKey ? batchCostMap.get(bKey) : undefined;
      const unitCost = batchCost ?? prodCostMap.get(item.product_id) ?? 0;
      const cogs = Math.round(qty * unitCost * 100) / 100;

      const cur = dailyMap.get(inv.invoice_date);
      if (cur) {
        cur.cogs += cogs;
      }
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: DailyProfitSummaryRow[] = Array.from(dailyMap.entries()).map(([date, data]) => {
      const net = round(data.gross - data.returns);
      const cogs = round(data.cogs);
      const profit = round(net - cogs);
      const margin = net > 0 ? round((profit / net) * 100) : 0;

      return {
        date,
        bill_count: data.billCount,
        gross_sales: round(data.gross),
        returns_amount: round(data.returns),
        net_sales: net,
        cogs_amount: cogs,
        gross_profit: profit,
        margin_percent: margin,
      };
    });

    rows.sort((a, b) => b.date.localeCompare(a.date));

    return {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
