import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { ProductItem, ProductBatch } from "../../../lib/masters/productsStore";

export interface FastMovingStockRow {
  product_id: string;
  product_name: string;
  generic_name?: string;
  total_units_sold: number;
  sales_frequency: number; // number of invoices containing this item
  total_revenue: number;
  current_stock: number;
  daily_velocity: number; // units sold per day
  days_of_stock_cover: number; // runway in days
  velocity_rank: "VERY FAST (A)" | "MODERATE (B)" | "REGULAR (C)";
}

export const fastMovingStockColumns: ReportColumn<FastMovingStockRow>[] = [
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
    id: "total_units_sold",
    header: "Units Sold",
    accessor: (r) => r.total_units_sold,
    align: "right",
    width: 105,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "sales_frequency",
    header: "Bill Count",
    accessor: (r) => r.sales_frequency,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_revenue",
    header: "Revenue (₹)",
    accessor: (r) => r.total_revenue,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "daily_velocity",
    header: "Daily Run-rate",
    accessor: (r) => r.daily_velocity,
    align: "right",
    width: 110,
    format: "number",
    isDefaultVisible: true,
  },
  {
    id: "current_stock",
    header: "Current Stock",
    accessor: (r) => r.current_stock,
    align: "right",
    width: 110,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "days_of_stock_cover",
    header: "Stock Cover (Days)",
    accessor: (r) => (r.days_of_stock_cover > 999 ? ">999 d" : `${r.days_of_stock_cover} d`),
    align: "center",
    width: 130,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "velocity_rank",
    header: "ABC Class",
    accessor: (r) => r.velocity_rank,
    align: "center",
    width: 140,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "VERY FAST (A)") return "success";
      if (val === "MODERATE (B)") return "info";
      return "neutral";
    },
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const fastMovingStockFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Sales Period",
    type: "date-range",
    defaultValue: { startDate: thirtyDaysAgo, endDate: today },
    required: true,
  },
];

export const fastMovingStockReport: ReportModule<any, FastMovingStockRow> = {
  id: "fast-moving-stock",
  title: "Fast-Moving Velocity & ABC Stock Turnover",
  description: "High-velocity sales analysis calculating item turnover rates, average daily sales velocity, and inventory days of cover.",
  category: "inventory",
  permission: "reports.inventory.view",
  menuVisibilityKey: "reports",
  keywords: ["fast moving", "sales velocity", "turnover", "abc analysis", "runway", "high demand", "top selling"],
  defaultSort: { column: "total_units_sold", direction: "desc" },
  supportedPrintLayouts: ["a4", "thermal", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: fastMovingStockFilters,
  columns: fastMovingStockColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: thirtyDaysAgo, endDate: today };

    const start = new Date(dates.startDate);
    const end = new Date(dates.endDate);
    const dayCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const [allInvoices, allInvoiceItems, allProducts, allBatches] = await Promise.all([
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
      sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
      sqliteStorage.findAll<ProductItem>("products").catch(() => []),
      sqliteStorage.findAll<ProductBatch>("product_batches").catch(() => []),
    ]);

    const activeInvoices = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );
    const activeInvMap = new Map(activeInvoices.map((inv) => [inv.id, inv]));

    // Aggregate current stock per product
    const stockMap = new Map<string, number>();
    for (const b of allBatches) {
      stockMap.set(b.product_id, (stockMap.get(b.product_id) || 0) + (Number(b.stock_qty) || 0));
    }

    const prodMap = new Map(allProducts.map((p) => [p.id, p]));

    // Aggregate sales per product
    const salesMap = new Map<
      string,
      { units: number; bills: Set<string>; revenue: number; name: string }
    >();

    for (const item of allInvoiceItems) {
      if (!activeInvMap.has(item.invoice_id)) continue;
      const inv = activeInvMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const cur = salesMap.get(item.product_id) || {
        units: 0,
        bills: new Set<string>(),
        revenue: 0,
        name: item.product_name,
      };

      const units = (Number(item.qty || (item as any).quantity) || 0) * sign;
      const amount = (Number(item.total_amount) || 0) * sign;

      cur.units += units;
      cur.bills.add(item.invoice_id);
      cur.revenue += amount;
      salesMap.set(item.product_id, cur);
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: FastMovingStockRow[] = [];

    for (const [prodId, data] of salesMap.entries()) {
      if (data.units <= 0) continue; // Only positive movement

      const prod = prodMap.get(prodId);
      const stock = stockMap.get(prodId) ?? Number(prod?.current_stock || 0);
      const dailyVel = round(data.units / dayCount);
      const daysCover = dailyVel > 0 ? Math.round(stock / dailyVel) : 999;

      let rank: FastMovingStockRow["velocity_rank"] = "REGULAR (C)";
      if (data.units >= 50 || dailyVel >= 2) rank = "VERY FAST (A)";
      else if (data.units >= 15 || dailyVel >= 0.5) rank = "MODERATE (B)";

      rows.push({
        product_id: prodId,
        product_name: data.name,
        generic_name: prod?.generic_name,
        total_units_sold: round(data.units),
        sales_frequency: data.bills.size,
        total_revenue: round(data.revenue),
        current_stock: round(stock),
        daily_velocity: dailyVel,
        days_of_stock_cover: daysCover,
        velocity_rank: rank,
      });
    }

    rows.sort((a, b) => b.total_units_sold - a.total_units_sold);

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          (r.generic_name && r.generic_name.toLowerCase().includes(q))
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
