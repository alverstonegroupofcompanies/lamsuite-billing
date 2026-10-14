import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { ProductBatch, ProductItem } from "../../../lib/masters/productsStore";

export interface NearExpiryRow {
  product_name: string;
  generic_name: string;
  batch_no: string;
  expiry_date: string;
  days_remaining: number;
  stock_qty: number;
  mrp: number;
  loss_risk_value: number;
  urgency: "expired" | "critical" | "warning" | "notice";
}

export const nearExpiryColumns: ReportColumn<NearExpiryRow>[] = [
  {
    id: "product_name",
    header: "Medicine / Product",
    accessor: (r) => r.product_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "batch_no",
    header: "Batch",
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
    width: 105,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "days_remaining",
    header: "Days Left",
    accessor: (r) => r.days_remaining,
    align: "center",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "urgency",
    header: "Alert Level",
    accessor: (r) => r.urgency.toUpperCase(),
    align: "center",
    width: 120,
    format: "badge",
    badgeStyle: (_, r) => {
      if (r.urgency === "expired") return "danger";
      if (r.urgency === "critical") return "danger";
      if (r.urgency === "warning") return "warning";
      return "info";
    },
    isDefaultVisible: true,
  },
  {
    id: "stock_qty",
    header: "Units at Risk",
    accessor: (r) => r.stock_qty,
    align: "right",
    width: 110,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
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
    id: "loss_risk_value",
    header: "Value at Risk (₹)",
    accessor: (r) => r.loss_risk_value,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
];

export const nearExpiryFilters: ReportFilterDef[] = [
  {
    id: "thresholdDays",
    label: "Expiry Window",
    type: "select",
    defaultValue: "60",
    options: [
      { label: "Critical: Expiring within 30 Days", value: "30" },
      { label: "Warning: Expiring within 60 Days", value: "60" },
      { label: "Notice: Expiring within 90 Days", value: "90" },
      { label: "Long Window: Within 180 Days", value: "180" },
      { label: "Already Expired Batches", value: "0" },
    ],
  },
];

export const nearExpiryReport: ReportModule<any, NearExpiryRow> = {
  id: "near-expiry",
  title: "Near-Expiry & FEFO Alert Register",
  description: "First-Expiry-First-Out (FEFO) audit identifying pharmaceutical batches nearing expiration to prevent financial loss.",
  category: "inventory",
  permission: "reports.inventory.view",
  menuVisibilityKey: "reports",
  keywords: ["expiry", "fefo", "near expiry", "short expiry", "loss prevention", "batch return"],
  defaultSort: { column: "days_remaining", direction: "asc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: nearExpiryFilters,
  columns: nearExpiryColumns,
  runQuery: async (params) => {
    const thresholdDays = Number(params.filters.thresholdDays ?? 60);
    const now = new Date();
    const todayTimestamp = now.getTime();

    const products = await sqliteStorage.findAll<ProductItem>("products");
    const batches = await sqliteStorage.findAll<ProductBatch>("product_batches");

    const prodMap = new Map<string, ProductItem>();
    for (const p of products) {
      prodMap.set(p.id, p);
    }

    const rows: NearExpiryRow[] = [];

    for (const b of batches) {
      const qty = Number(b.stock_qty) || 0;
      if (qty <= 0) continue; // Only track stock in physical inventory

      if (!b.expiry_date) continue;
      const expDate = new Date(b.expiry_date);
      const diffMs = expDate.getTime() - todayTimestamp;
      const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (thresholdDays === 0) {
        // Expired only
        if (daysRemaining > 0) continue;
      } else {
        if (daysRemaining > thresholdDays) continue;
      }

      let urgency: "expired" | "critical" | "warning" | "notice" = "notice";
      if (daysRemaining <= 0) urgency = "expired";
      else if (daysRemaining <= 30) urgency = "critical";
      else if (daysRemaining <= 60) urgency = "warning";

      const p = prodMap.get(b.product_id);
      const mrp = Number(b.mrp) || 0;
      const riskVal = Math.round(qty * mrp * 100) / 100;

      rows.push({
        product_name: p?.name || "Product Item",
        generic_name: p?.generic_name || "",
        batch_no: b.batch_no,
        expiry_date: b.expiry_date,
        days_remaining: daysRemaining,
        stock_qty: qty,
        mrp,
        loss_risk_value: riskVal,
        urgency,
      });
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
