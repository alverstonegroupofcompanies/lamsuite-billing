import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { ProductItem, ProductBatch } from "../../../lib/masters/productsStore";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface SlowDeadStockRow {
  product_id: string;
  product_name: string;
  batch_no: string;
  expiry_date: string;
  stock_qty: number;
  purchase_rate: number;
  locked_capital: number;
  last_sale_date: string;
  days_dormant: number;
  dormancy_status: "SLOW MOVING (30D+)" | "NON-MOVING (60D+)" | "DEAD STOCK (90D+)";
}

export const slowDeadStockColumns: ReportColumn<SlowDeadStockRow>[] = [
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
    id: "batch_no",
    header: "Batch No",
    accessor: (r) => r.batch_no,
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "expiry_date",
    header: "Expiry Date",
    accessor: (r) => r.expiry_date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
  },
  {
    id: "stock_qty",
    header: "Dormant Qty",
    accessor: (r) => r.stock_qty,
    align: "right",
    width: 110,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "purchase_rate",
    header: "Unit Cost (₹)",
    accessor: (r) => r.purchase_rate,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "locked_capital",
    header: "Trapped Capital (₹)",
    accessor: (r) => r.locked_capital,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "last_sale_date",
    header: "Last Sale Date",
    accessor: (r) => r.last_sale_date,
    align: "center",
    width: 120,
    isDefaultVisible: true,
  },
  {
    id: "days_dormant",
    header: "Days Idle",
    accessor: (r) => `${r.days_dormant} d`,
    align: "center",
    width: 95,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "dormancy_status",
    header: "Category",
    accessor: (r) => r.dormancy_status,
    align: "center",
    width: 155,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "DEAD STOCK (90D+)") return "danger";
      if (val === "NON-MOVING (60D+)") return "warning";
      return "info";
    },
    isDefaultVisible: true,
  },
];

export const slowDeadStockFilters: ReportFilterDef[] = [
  {
    id: "dormancyPeriod",
    label: "Inactivity Period",
    type: "select",
    defaultValue: "30",
    options: [
      { label: "30+ Days Inactive (Slow Moving)", value: "30" },
      { label: "60+ Days Inactive (Non-Moving)", value: "60" },
      { label: "90+ Days Inactive (Dead Stock)", value: "90" },
    ],
  },
];

export const slowDeadStockReport: ReportModule<any, SlowDeadStockRow> = {
  id: "slow-dead-stock",
  title: "Slow & Non-Moving Dead Stock Register",
  description: "Identifies trapped capital in stagnant and dormant inventory batches with zero sales over 30, 60, or 90+ days.",
  category: "inventory",
  permission: "reports.inventory.view",
  menuVisibilityKey: "reports",
  keywords: ["dead stock", "slow moving", "non moving", "trapped capital", "stagnant inventory", "dormant batches"],
  defaultSort: { column: "locked_capital", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: slowDeadStockFilters,
  columns: slowDeadStockColumns,
  runQuery: async (params) => {
    const thresholdDays = Number(params.filters.dormancyPeriod) || 30;
    const now = new Date();

    const [allProducts, allBatches, allInvoiceItems, allInvoices] = await Promise.all([
      sqliteStorage.findAll<ProductItem>("products").catch(() => []),
      sqliteStorage.findAll<ProductBatch>("product_batches").catch(() => []),
      sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
    ]);

    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    const invoiceDateMap = new Map(allInvoices.map((inv) => [inv.id, inv.invoice_date]));

    // Find latest sale date per product
    const latestSaleMap = new Map<string, string>();
    for (const item of allInvoiceItems) {
      const dateStr = invoiceDateMap.get(item.invoice_id);
      if (!dateStr) continue;

      const existing = latestSaleMap.get(item.product_id);
      if (!existing || dateStr > existing) {
        latestSaleMap.set(item.product_id, dateStr);
      }
    }

    const rows: SlowDeadStockRow[] = [];

    for (const batch of allBatches) {
      const stock = Number(batch.stock_qty) || 0;
      if (stock <= 0) continue; // Only positive stock items can be dead stock

      const prod = productMap.get(batch.product_id);
      const lastSoldStr = latestSaleMap.get(batch.product_id);

      let daysIdle = 999;
      if (lastSoldStr) {
        const lastSoldDate = new Date(lastSoldStr);
        const diffMs = now.getTime() - lastSoldDate.getTime();
        daysIdle = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }

      if (daysIdle >= thresholdDays) {
        const rate = Number(batch.purchase_rate) || Number(prod?.sel_rate || 0) * 0.7;
        const capital = Math.round(stock * rate * 100) / 100;

        let status: SlowDeadStockRow["dormancy_status"] = "SLOW MOVING (30D+)";
        if (daysIdle >= 90) status = "DEAD STOCK (90D+)";
        else if (daysIdle >= 60) status = "NON-MOVING (60D+)";

        rows.push({
          product_id: batch.product_id,
          product_name: prod?.name || `Product #${batch.product_id}`,
          batch_no: batch.batch_no || "-",
          expiry_date: batch.expiry_date || "-",
          stock_qty: stock,
          purchase_rate: Math.round(rate * 100) / 100,
          locked_capital: capital,
          last_sale_date: lastSoldStr || "Never Sold",
          days_dormant: daysIdle === 999 ? 999 : daysIdle,
          dormancy_status: status,
        });
      }
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          r.batch_no.toLowerCase().includes(q)
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
