import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";

export const purchaseRegisterColumns: ReportColumn<PurchaseDocumentRecord>[] = [
  {
    id: "purchase_number",
    header: "Voucher No",
    accessor: (r) => r.purchase_number,
    align: "left",
    width: 120,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "purchase_date",
    header: "Date",
    accessor: (r) => r.purchase_date,
    align: "center",
    width: 100,
    format: "date",
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "supplier_name",
    header: "Supplier Name",
    accessor: (r) => r.supplier_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "supplier_invoice_no",
    header: "Supplier Bill No",
    accessor: (r) => r.supplier_invoice_no,
    align: "left",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "items_summary",
    header: "Items Purchased",
    accessor: (r) => (r as any).items_summary || "-",
    align: "left",
    width: 220,
    isDefaultVisible: false,
  },
  {
    id: "supplier_gstin",
    header: "GSTIN",
    accessor: (r) => r.supplier_gstin || "-",
    align: "center",
    width: 140,
    isDefaultVisible: false,
  },
  {
    id: "subtotal",
    header: "Taxable Value (₹)",
    accessor: (r) => r.subtotal,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "cgst_total",
    header: "CGST (₹)",
    accessor: (r) => {
      const v = Number(r.cgst_total);
      if (!isNaN(v) && v > 0) return v;
      if (r.is_interstate) return 0;
      const tax = Number(r.tax_total);
      if (!isNaN(tax) && tax > 0 && (!r.igst_total || Number(r.igst_total) === 0)) {
        return Math.round((tax / 2 + Number.EPSILON) * 100) / 100;
      }
      return 0;
    },
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst_total",
    header: "SGST (₹)",
    accessor: (r) => {
      const v = Number(r.sgst_total);
      if (!isNaN(v) && v > 0) return v;
      if (r.is_interstate) return 0;
      const tax = Number(r.tax_total);
      if (!isNaN(tax) && tax > 0 && (!r.igst_total || Number(r.igst_total) === 0)) {
        return Math.round((tax / 2 + Number.EPSILON) * 100) / 100;
      }
      return 0;
    },
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst_total",
    header: "IGST (₹)",
    accessor: (r) => {
      const v = Number(r.igst_total);
      if (!isNaN(v) && v > 0) return v;
      if (r.is_interstate && r.tax_total) return Number(r.tax_total);
      return 0;
    },
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "tax_total",
    header: "Tax Total (₹)",
    accessor: (r) => r.tax_total,
    align: "right",
    width: 105,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "grand_total",
    header: "Invoice Value (₹)",
    accessor: (r) => r.grand_total,
    align: "right",
    width: 135,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "payment_status",
    header: "Payment",
    accessor: (r) => (r.payment_status || "unpaid").toUpperCase(),
    align: "center",
    width: 100,
    format: "badge",
    badgeStyle: (_, r) => {
      const status = r.payment_status || "unpaid";
      if (status === "paid") return "success";
      if (status === "partial") return "warning";
      return "danger";
    },
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const purchaseRegisterFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "paymentStatus",
    label: "Payment Status",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Purchases", value: "all" },
      { label: "Unpaid / Due", value: "unpaid" },
      { label: "Partially Paid", value: "partial" },
      { label: "Fully Paid", value: "paid" },
    ],
  },
];

export const purchaseRegisterReport: ReportModule<any, PurchaseDocumentRecord> = {
  id: "purchase-register",
  title: "Purchase Inward Register",
  description: "Detailed inward inventory tax register with supplier invoices, taxable input credits, and payment statuses.",
  category: "purchase",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["purchase", "inward", "supplier bills", "itc", "gstr2", "procurement"],
  defaultSort: { column: "purchase_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: purchaseRegisterFilters,
  columns: purchaseRegisterColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allPurchasesDocs, allPurchasesAlt, allPurchaseItems] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<any>("purchase_items").catch(() => []),
    ]);

    const itemsByPurchaseId = new Map<string, string[]>();
    for (const item of allPurchaseItems) {
      if (item && item.purchase_id && item.product_name) {
        const list = itemsByPurchaseId.get(item.purchase_id) || [];
        const qtyStr = item.pack_qty ? ` (${item.pack_qty})` : "";
        list.push(`${item.product_name}${qtyStr}`);
        itemsByPurchaseId.set(item.purchase_id, list);
      }
    }

    const purchaseMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseMap.values());

    for (const p of allPurchases) {
      let itemsList = itemsByPurchaseId.get(p.id) || itemsByPurchaseId.get(p.purchase_number);
      if ((!itemsList || itemsList.length === 0) && (p as any).lines && Array.isArray((p as any).lines)) {
        itemsList = (p as any).lines.map((l: any) => `${l.product_name || "Item"}${l.pack_qty ? ` (${l.pack_qty})` : ""}`);
      }
      (p as any).items_summary = itemsList && itemsList.length > 0 ? itemsList.join(", ") : "";
    }

    let filtered = allPurchases.filter((p) => {
      if (!p) return false;
      const status = (p.status || "").toLowerCase();
      if (status === "cancelled") return false;

      const pDate = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && pDate < startDateStr) return false;
      if (endDateStr && pDate > endDateStr) return false;
      return true;
    });

    if (params.filters.paymentStatus && params.filters.paymentStatus !== "all") {
      const targetStatus = String(params.filters.paymentStatus).toLowerCase();
      filtered = filtered.filter(
        (p) => (p.payment_status || "unpaid").toLowerCase() === targetStatus
      );
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          (p.purchase_number && p.purchase_number.toLowerCase().includes(q)) ||
          (p.supplier_name && p.supplier_name.toLowerCase().includes(q)) ||
          (p.supplier_invoice_no && p.supplier_invoice_no.toLowerCase().includes(q))
      );
    }

    return {
      rows: filtered,
      totalCount: filtered.length,
      page: 1,
      pageSize: filtered.length,
      totalPages: 1,
    };
  },
};
