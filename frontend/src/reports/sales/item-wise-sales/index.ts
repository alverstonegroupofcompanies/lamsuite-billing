import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface ItemWiseSalesRow {
  product_id: string;
  product_name: string;
  generic_name?: string;
  hsn_code: string;
  qty_sold: number;
  loose_qty_sold: number;
  discount_given: number;
  taxable_amount: number;
  total_tax: number;
  total_revenue: number;
  avg_rate: number;
}

export const itemWiseSalesColumns: ReportColumn<ItemWiseSalesRow>[] = [
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
    id: "hsn_code",
    header: "HSN / SAC",
    accessor: (r) => r.hsn_code,
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "qty_sold",
    header: "Pack Qty",
    accessor: (r) => r.qty_sold,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "loose_qty_sold",
    header: "Loose Units",
    accessor: (r) => r.loose_qty_sold,
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "avg_rate",
    header: "Avg Rate (₹)",
    accessor: (r) => r.avg_rate,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "discount_given",
    header: "Discount (₹)",
    accessor: (r) => r.discount_given,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "taxable_amount",
    header: "Taxable Value (₹)",
    accessor: (r) => r.taxable_amount,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "total_tax",
    header: "GST (₹)",
    accessor: (r) => r.total_tax,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_revenue",
    header: "Gross Revenue (₹)",
    accessor: (r) => r.total_revenue,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const itemWiseSalesFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const itemWiseSalesReport: ReportModule<any, ItemWiseSalesRow> = {
  id: "item-wise-sales",
  title: "Item-Wise Sales Analysis",
  description: "Comprehensive product-level sales breakdown tracking quantities, discounts, tax collections, and total turnover.",
  category: "sales",
  permission: "reports.sales.view",
  menuVisibilityKey: "reports",
  keywords: ["item", "product", "sku", "sales by item", "volume", "turnover"],
  defaultSort: { column: "total_revenue", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: itemWiseSalesFilters,
  columns: itemWiseSalesColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const validInvoicesMap = new Map<string, InvoiceRecord>();
    for (const inv of allInvoices) {
      if (
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
      ) {
        validInvoicesMap.set(inv.id, inv);
      }
    }

    const agg = new Map<string, {
      product_name: string;
      hsn_code: string;
      qty: number;
      loose_qty: number;
      discount: number;
      taxable: number;
      tax: number;
      revenue: number;
    }>();

    for (const it of allItems) {
      const inv = validInvoicesMap.get(it.invoice_id);
      if (!inv) continue;

      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const pId = it.product_id;
      const total = (Number(it.total_amount) || 0) * sign;
      const cgst = (Number(it.cgst_amount) || 0) * sign;
      const sgst = (Number(it.sgst_amount) || 0) * sign;
      const igst = (Number(it.igst_amount) || 0) * sign;
      const tax = cgst + sgst + igst;
      const taxable = total - tax;
      const disc = (Number(it.discount_amount) || 0) * sign;
      const qty = (Number(it.qty) || 0) * sign;
      const looseQty = (Number(it.loose_qty) || 0) * sign;

      if (!agg.has(pId)) {
        agg.set(pId, {
          product_name: it.product_name,
          hsn_code: it.hsn_code || "30049099",
          qty: 0,
          loose_qty: 0,
          discount: 0,
          taxable: 0,
          tax: 0,
          revenue: 0,
        });
      }

      const rec = agg.get(pId)!;
      rec.qty += qty;
      rec.loose_qty += looseQty;
      rec.discount += disc;
      rec.taxable += taxable;
      rec.tax += tax;
      rec.revenue += total;
    }

    const rows: ItemWiseSalesRow[] = Array.from(agg.entries()).map(([pId, v]) => {
      const totalUnits = v.qty + (v.loose_qty > 0 ? v.loose_qty : 0);
      const avgRate = totalUnits > 0 ? Math.round((v.revenue / totalUnits) * 100) / 100 : 0;

      return {
        product_id: pId,
        product_name: v.product_name,
        hsn_code: v.hsn_code,
        qty_sold: Math.round(v.qty * 100) / 100,
        loose_qty_sold: Math.round(v.loose_qty * 100) / 100,
        discount_given: Math.round(v.discount * 100) / 100,
        taxable_amount: Math.round(v.taxable * 100) / 100,
        total_tax: Math.round(v.tax * 100) / 100,
        total_revenue: Math.round(v.revenue * 100) / 100,
        avg_rate: avgRate,
      };
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) => r.product_name.toLowerCase().includes(q) || r.hsn_code.includes(q)
      );
      return { rows: filtered, totalCount: filtered.length, page: 1, pageSize: filtered.length, totalPages: 1 };
    }

    return { rows, totalCount: rows.length, page: 1, pageSize: rows.length, totalPages: 1 };
  },
};
