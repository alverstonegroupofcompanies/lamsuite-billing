import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { ProductBatch, ProductItem } from "../../../lib/masters/productsStore";

export interface GrossProfitRow {
  product_id: string;
  product_name: string;
  qty_sold: number;
  taxable_revenue: number;
  cost_of_goods_sold: number;
  gross_profit: number;
  profit_margin_percent: number;
  profit_status: "HIGH MARGIN (>30%)" | "NORMAL MARGIN" | "LOW MARGIN (<10%)" | "LOSS MAKING";
}

export const grossProfitColumns: ReportColumn<GrossProfitRow>[] = [
  {
    id: "product_name",
    header: "Product / Medicine Name",
    accessor: (r) => r.product_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "qty_sold",
    header: "Qty Sold",
    accessor: (r) => r.qty_sold,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "taxable_revenue",
    header: "Sales Value (₹)",
    accessor: (r) => r.taxable_revenue,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "cost_of_goods_sold",
    header: "COGS / Cost (₹)",
    accessor: (r) => r.cost_of_goods_sold,
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
    id: "profit_margin_percent",
    header: "Margin (%)",
    accessor: (r) => `${r.profit_margin_percent.toFixed(1)}%`,
    align: "right",
    width: 105,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "profit_status",
    header: "Profit Category",
    accessor: (r) => r.profit_status,
    align: "center",
    width: 155,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "LOSS MAKING") return "danger";
      if (val === "LOW MARGIN (<10%)") return "warning";
      if (val === "HIGH MARGIN (>30%)") return "success";
      return "info";
    },
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const grossProfitFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Sales Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const grossProfitReport: ReportModule<any, GrossProfitRow> = {
  id: "gross-profit-report",
  title: "Gross Profit & Product Margin Analysis",
  description: "Product-level profitability analysis comparing selling price vs landed cost to evaluate gross profits and margin percentages.",
  category: "profit",
  permission: "reports.financial.view",
  menuVisibilityKey: "reports",
  keywords: ["profit", "margin", "gross profit", "cogs", "cost of goods", "profitability", "loss making"],
  defaultSort: { column: "gross_profit", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: grossProfitFilters,
  columns: grossProfitColumns,
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

    // Build batch cost map and product fallback cost map
    const batchCostMap = new Map<string, number>();
    for (const b of allBatches) {
      if (b.purchase_rate && b.purchase_rate > 0) {
        batchCostMap.set(b.id, Number(b.purchase_rate));
        batchCostMap.set(`${b.product_id}_${b.batch_no}`, Number(b.purchase_rate));
      }
    }

    const prodCostMap = new Map<string, number>();
    for (const p of allProducts) {
      prodCostMap.set(p.id, Number(p.sel_rate || p.mrp || 0) * 0.7); // 70% default cost
    }

    const itemMap = new Map<
      string,
      { name: string; qty: number; revenue: number; cogs: number }
    >();

    for (const item of allInvoiceItems) {
      if (!invoiceMap.has(item.invoice_id)) continue;
      const inv = invoiceMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const qty = (Number(item.qty || (item as any).quantity) || 0) * sign;
      const revenue = (Number((item as any).taxable_amount) || Number(item.total_amount) || 0) * sign;

      // Determine unit cost
      const bKey = (item as any).batch_id || item.batch_no;
      const batchCost = bKey ? batchCostMap.get(bKey) : undefined;
      const unitCost = batchCost ?? prodCostMap.get(item.product_id) ?? 0;
      const cogs = Math.round(qty * unitCost * 100) / 100;

      const cur = itemMap.get(item.product_id) || {
        name: item.product_name,
        qty: 0,
        revenue: 0,
        cogs: 0,
      };

      cur.qty += qty;
      cur.revenue += revenue;
      cur.cogs += cogs;
      itemMap.set(item.product_id, cur);
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: GrossProfitRow[] = [];

    for (const [prodId, data] of itemMap.entries()) {
      const profit = round(data.revenue - data.cogs);
      const margin = data.revenue > 0 ? round((profit / data.revenue) * 100) : 0;

      let status: GrossProfitRow["profit_status"] = "NORMAL MARGIN";
      if (profit < 0) status = "LOSS MAKING";
      else if (margin < 10) status = "LOW MARGIN (<10%)";
      else if (margin >= 30) status = "HIGH MARGIN (>30%)";

      rows.push({
        product_id: prodId,
        product_name: data.name,
        qty_sold: round(data.qty),
        taxable_revenue: round(data.revenue),
        cost_of_goods_sold: round(data.cogs),
        gross_profit: profit,
        profit_margin_percent: margin,
        profit_status: status,
      });
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter((r) => r.product_name.toLowerCase().includes(q));
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
