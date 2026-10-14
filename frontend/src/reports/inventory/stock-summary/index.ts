import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { ProductBatch, ProductItem } from "../../../lib/masters/productsStore";

export interface StockSummaryRow {
  product_id: string;
  product_name: string;
  generic_name: string;
  barcode: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
  loose_qty: number;
  purchase_rate: number;
  sale_rate: number;
  mrp: number;
  purchase_valuation: number;
  mrp_valuation: number;
}

export const stockSummaryColumns: ReportColumn<StockSummaryRow>[] = [
  {
    id: "product_name",
    header: "Product / Medicine",
    accessor: (r) => r.product_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "generic_name",
    header: "Generic Formulation",
    accessor: (r) => r.generic_name || "-",
    align: "left",
    width: 180,
    isDefaultVisible: false,
  },
  {
    id: "barcode",
    header: "Barcode",
    accessor: (r) => r.barcode,
    align: "center",
    width: 120,
    isDefaultVisible: false,
  },
  {
    id: "batch_no",
    header: "Batch No",
    accessor: (r) => r.batch_no,
    align: "center",
    width: 110,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "expiry_date",
    header: "Expiry",
    accessor: (r) => r.expiry_date,
    align: "center",
    width: 95,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "qty",
    header: "Pack Stock",
    accessor: (r) => r.qty,
    align: "right",
    width: 100,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "loose_qty",
    header: "Loose Units",
    accessor: (r) => r.loose_qty,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "purchase_rate",
    header: "Cost Price (₹)",
    accessor: (r) => r.purchase_rate,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "sale_rate",
    header: "Sale Rate (₹)",
    accessor: (r) => r.sale_rate,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "mrp",
    header: "MRP (₹)",
    accessor: (r) => r.mrp,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "purchase_valuation",
    header: "Cost Valuation (₹)",
    accessor: (r) => r.purchase_valuation,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "mrp_valuation",
    header: "MRP Valuation (₹)",
    accessor: (r) => r.mrp_valuation,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
];

export const stockSummaryFilters: ReportFilterDef[] = [
  {
    id: "stockFilter",
    label: "Stock Filter",
    type: "select",
    defaultValue: "positive",
    options: [
      { label: "Positive Stock Only (> 0)", value: "positive" },
      { label: "All Batches (Including Zero)", value: "all" },
      { label: "Zero Stock Only", value: "zero" },
    ],
  },
];

export const stockSummaryReport: ReportModule<any, StockSummaryRow> = {
  id: "stock-summary",
  title: "Batch Stock Valuation",
  description: "Live batch-level stock valuation report comparing cost investment against maximum retail value.",
  category: "inventory",
  permission: "reports.inventory.view",
  menuVisibilityKey: "reports",
  keywords: ["stock", "inventory", "valuation", "cost", "mrp", "batch", "fefo", "warehouse"],
  defaultSort: { column: "purchase_valuation", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: stockSummaryFilters,
  columns: stockSummaryColumns,
  runQuery: async (params) => {
    const products = await sqliteStorage.findAll<ProductItem>("products");
    const batches = await sqliteStorage.findAll<ProductBatch>("product_batches");

    const prodMap = new Map<string, ProductItem>();
    for (const p of products) {
      prodMap.set(p.id, p);
    }

    const rows: StockSummaryRow[] = [];

    for (const b of batches) {
      const p = prodMap.get(b.product_id);
      const qty = Number(b.stock_qty) || 0;
      const looseQty = Number((b as any).loose_quantity || (b as any).loose_qty) || 0;

      if (params.filters.stockFilter === "positive" && qty <= 0 && looseQty <= 0) {
        continue;
      }
      if (params.filters.stockFilter === "zero" && (qty > 0 || looseQty > 0)) {
        continue;
      }

      const cost = Number(b.purchase_rate) || 0;
      const mrp = Number(b.mrp) || 0;
      const saleRate = Number(b.selling_rate) || mrp;
      const costVal = Math.round(qty * cost * 100) / 100;
      const mrpVal = Math.round(qty * mrp * 100) / 100;

      rows.push({
        product_id: b.product_id,
        product_name: p?.name || "Product Item",
        generic_name: p?.generic_name || "",
        barcode: p?.barcode || "",
        batch_no: b.batch_no,
        expiry_date: b.expiry_date,
        qty,
        loose_qty: looseQty,
        purchase_rate: cost,
        sale_rate: saleRate,
        mrp,
        purchase_valuation: costVal,
        mrp_valuation: mrpVal,
      });
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          r.batch_no.toLowerCase().includes(q) ||
          r.generic_name.toLowerCase().includes(q)
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
