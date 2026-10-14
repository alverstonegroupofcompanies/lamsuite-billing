import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { ProductItem, ProductBatch } from "../../../lib/masters/productsStore";

export interface LowStockReorderRow {
  product_id: string;
  product_name: string;
  generic_name?: string;
  rack_location?: string;
  current_stock: number;
  reorder_level: number;
  deficit_qty: number;
  suggested_order_qty: number;
  purchase_rate: number;
  estimated_order_value: number;
  stock_status: "CRITICAL OUT OF STOCK" | "LOW STOCK REORDER";
}

export const lowStockReorderColumns: ReportColumn<LowStockReorderRow>[] = [
  {
    id: "product_name",
    header: "Medicine / Product Name",
    accessor: (r) => r.product_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "generic_name",
    header: "Generic Composition",
    accessor: (r) => r.generic_name || "-",
    align: "left",
    width: 170,
    isDefaultVisible: true,
  },
  {
    id: "rack_location",
    header: "Rack / Shelf",
    accessor: (r) => r.rack_location || "-",
    align: "center",
    width: 110,
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
    canSort: true,
  },
  {
    id: "reorder_level",
    header: "Min Level",
    accessor: (r) => r.reorder_level,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "deficit_qty",
    header: "Deficit Qty",
    accessor: (r) => r.deficit_qty,
    align: "right",
    width: 100,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "suggested_order_qty",
    header: "Suggested PO Qty",
    accessor: (r) => r.suggested_order_qty,
    align: "right",
    width: 130,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "purchase_rate",
    header: "Cost Rate (₹)",
    accessor: (r) => r.purchase_rate,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "estimated_order_value",
    header: "Est PO Value (₹)",
    accessor: (r) => r.estimated_order_value,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "stock_status",
    header: "Status",
    accessor: (r) => r.stock_status,
    align: "center",
    width: 150,
    format: "badge",
    badgeStyle: (val) => (val === "CRITICAL OUT OF STOCK" ? "danger" : "warning"),
    isDefaultVisible: true,
  },
];

export const lowStockReorderFilters: ReportFilterDef[] = [
  {
    id: "urgency",
    label: "Filter Level",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Reorder Items (<= Min Level)", value: "all" },
      { label: "Critical Only (0 or Negative Stock)", value: "critical" },
      { label: "Low Stock Warning Only", value: "low" },
    ],
  },
];

export const lowStockReorderReport: ReportModule<any, LowStockReorderRow> = {
  id: "low-stock-reorder",
  title: "Low Stock & Reorder Suggestion Register",
  description: "Automated replenishment report flagging products whose stock is below minimum reorder thresholds with suggested purchase quantities.",
  category: "inventory",
  permission: "reports.inventory.view",
  menuVisibilityKey: "reports",
  keywords: ["low stock", "reorder", "purchase order", "replenishment", "shortage", "out of stock", "min level"],
  defaultSort: { column: "deficit_qty", direction: "desc" },
  supportedPrintLayouts: ["a4", "thermal", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: lowStockReorderFilters,
  columns: lowStockReorderColumns,
  runQuery: async (params) => {
    const [allProducts, allBatches] = await Promise.all([
      sqliteStorage.findAll<ProductItem>("products").catch(() => []),
      sqliteStorage.findAll<ProductBatch>("product_batches").catch(() => []),
    ]);

    // Aggregate batches by product
    const batchStockMap = new Map<string, { stock: number; latestRate: number }>();
    for (const b of allBatches) {
      const cur = batchStockMap.get(b.product_id) || { stock: 0, latestRate: 0 };
      cur.stock += Number(b.stock_qty) || 0;
      if (b.purchase_rate && b.purchase_rate > 0) {
        cur.latestRate = Number(b.purchase_rate);
      }
      batchStockMap.set(b.product_id, cur);
    }

    const rows: LowStockReorderRow[] = [];

    for (const prod of allProducts) {
      if (prod.is_active === false) continue;

      const batchInfo = batchStockMap.get(prod.id);
      const stock = batchInfo ? batchInfo.stock : Number(prod.current_stock) || 0;
      const reorderLevel = Number(prod.reorder_level) || 10; // default 10 if not set

      if (stock <= reorderLevel) {
        const isCritical = stock <= 0;
        const deficit = Math.max(0, reorderLevel - stock);
        // Standard formula: replenishment target = max(reorderLevel * 2 - stock, 10)
        const suggestedQty = Math.max(reorderLevel * 2 - Math.max(0, stock), 10);
        const rate = (batchInfo && batchInfo.latestRate > 0)
          ? batchInfo.latestRate
          : Number(prod.sel_rate || prod.mrp || 0) * 0.7; // 70% cost estimate if no purchase rate

        const estVal = Math.round(suggestedQty * rate * 100) / 100;

        if (params.filters.urgency === "critical" && !isCritical) continue;
        if (params.filters.urgency === "low" && isCritical) continue;

        rows.push({
          product_id: prod.id,
          product_name: prod.name,
          generic_name: prod.generic_name,
          rack_location: prod.rack_location || prod.shelf_location,
          current_stock: Math.round(stock * 100) / 100,
          reorder_level: reorderLevel,
          deficit_qty: Math.round(deficit * 100) / 100,
          suggested_order_qty: Math.round(suggestedQty),
          purchase_rate: Math.round(rate * 100) / 100,
          estimated_order_value: estVal,
          stock_status: isCritical ? "CRITICAL OUT OF STOCK" : "LOW STOCK REORDER",
        });
      }
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          (r.generic_name && r.generic_name.toLowerCase().includes(q)) ||
          (r.rack_location && r.rack_location.toLowerCase().includes(q))
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
