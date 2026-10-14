import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { PurchaseDocumentRecord, PurchaseItemRecord } from "../../../lib/purchases/purchaseService";

export interface StockMovementLedgerRow {
  date: string;
  product_id: string;
  product_name: string;
  batch_no: string;
  voucher_type: "SALE" | "PURCHASE" | "SALES RETURN" | "PURCHASE RETURN" | "ADJUSTMENT";
  voucher_no: string;
  party_name?: string;
  inward_qty: number;
  outward_qty: number;
  unit_rate: number;
  total_value: number;
}

export const stockMovementLedgerColumns: ReportColumn<StockMovementLedgerRow>[] = [
  {
    id: "date",
    header: "Date",
    accessor: (r) => r.date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "product_name",
    header: "Product / Medicine",
    accessor: (r) => r.product_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "batch_no",
    header: "Batch No",
    accessor: (r) => r.batch_no || "-",
    align: "center",
    width: 105,
    isDefaultVisible: true,
  },
  {
    id: "voucher_type",
    header: "Movement",
    accessor: (r) => r.voucher_type,
    align: "center",
    width: 130,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "PURCHASE" || val === "SALES RETURN") return "success";
      if (val === "SALE" || val === "PURCHASE RETURN") return "info";
      return "neutral";
    },
    isDefaultVisible: true,
  },
  {
    id: "voucher_no",
    header: "Doc / Bill No",
    accessor: (r) => r.voucher_no,
    align: "left",
    width: 125,
    isDefaultVisible: true,
  },
  {
    id: "party_name",
    header: "Customer / Supplier",
    accessor: (r) => r.party_name || "-",
    align: "left",
    width: 170,
    isDefaultVisible: true,
  },
  {
    id: "inward_qty",
    header: "Inward (+)",
    accessor: (r) => r.inward_qty || "",
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "outward_qty",
    header: "Outward (-)",
    accessor: (r) => r.outward_qty || "",
    align: "right",
    width: 95,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "unit_rate",
    header: "Rate (₹)",
    accessor: (r) => r.unit_rate,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
  },
  {
    id: "total_value",
    header: "Total Value (₹)",
    accessor: (r) => r.total_value,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const stockMovementLedgerFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Movement Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "movementType",
    label: "Movement Type",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Movements", value: "all" },
      { label: "Sales (Outward)", value: "SALE" },
      { label: "Purchases (Inward)", value: "PURCHASE" },
      { label: "Sales Returns (Inward)", value: "SALES RETURN" },
      { label: "Purchase Returns (Outward)", value: "PURCHASE RETURN" },
    ],
  },
];

export const stockMovementLedgerReport: ReportModule<any, StockMovementLedgerRow> = {
  id: "stock-movement-ledger",
  title: "Stock Movement & Inventory Transaction Audit",
  description: "Detailed chronological ledger tracking all inward, outward, and return inventory movements at batch and voucher level.",
  category: "inventory",
  permission: "reports.inventory.view",
  menuVisibilityKey: "reports",
  keywords: ["stock movement", "inventory ledger", "audit trail", "inward outward", "batch transactions"],
  defaultSort: { column: "date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: stockMovementLedgerFilters,
  columns: stockMovementLedgerColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allInvoices, allInvoiceItems, allPurchasesDocs, allPurchasesAlt, allPurchaseItems] = await Promise.all([
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
      sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<PurchaseItemRecord>("purchase_items").catch(() => []),
    ]);

    const purchaseDedupMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseDedupMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseDedupMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseDedupMap.values());

    const filteredInvoices = allInvoices.filter((inv) => {
      if (!inv || (inv.status || "").toLowerCase() === "cancelled") return false;
      const d = String(inv.invoice_date || "").trim().slice(0, 10);
      if (startDateStr && d < startDateStr) return false;
      if (endDateStr && d > endDateStr) return false;
      return true;
    });
    const invoiceMap = new Map(filteredInvoices.map((inv) => [inv.id, inv]));

    const filteredPurchases = allPurchases.filter((p) => {
      if (!p || (p.status || "").toLowerCase() === "cancelled") return false;
      const d = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && d < startDateStr) return false;
      if (endDateStr && d > endDateStr) return false;
      return true;
    });
    const purchaseMap = new Map(filteredPurchases.map((p) => [p.id, p]));

    const rows: StockMovementLedgerRow[] = [];

    // 1. Process Sales & Sales Returns
    for (const item of allInvoiceItems) {
      if (!invoiceMap.has(item.invoice_id)) continue;
      const inv = invoiceMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const qty = Number(item.qty || (item as any).quantity) || 0;
      const rate = Number(item.unit_price) || 0;
      const value = Number(item.total_amount) || 0;

      rows.push({
        date: inv.invoice_date,
        product_id: item.product_id,
        product_name: item.product_name,
        batch_no: item.batch_no || (item as any).batch_number || "",
        voucher_type: isReturn ? "SALES RETURN" : "SALE",
        voucher_no: inv.invoice_number,
        party_name: inv.customer_name || "Counter Customer",
        inward_qty: isReturn ? qty : 0,
        outward_qty: isReturn ? 0 : qty,
        unit_rate: rate,
        total_value: value,
      });
    }

    // 2. Process Purchases & Purchase Returns
    for (const pItem of allPurchaseItems) {
      if (!purchaseMap.has(pItem.purchase_id)) continue;
      const p = purchaseMap.get(pItem.purchase_id)!;
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      const qty = Number(pItem.total_units || pItem.pack_qty) || 0;
      const rate = Number(pItem.purchase_rate) || 0;
      const value = Math.round(qty * rate * 100) / 100;

      rows.push({
        date: p.purchase_date,
        product_id: pItem.product_id,
        product_name: pItem.product_name,
        batch_no: pItem.batch_no || "",
        voucher_type: isReturn ? "PURCHASE RETURN" : "PURCHASE",
        voucher_no: p.supplier_invoice_no || p.purchase_number,
        party_name: p.supplier_name,
        inward_qty: isReturn ? 0 : qty,
        outward_qty: isReturn ? qty : 0,
        unit_rate: rate,
        total_value: value,
      });
    }

    // Filter by movement type if selected
    let resultRows = rows;
    if (params.filters.movementType && params.filters.movementType !== "all") {
      resultRows = resultRows.filter((r) => r.voucher_type === params.filters.movementType);
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      resultRows = resultRows.filter(
        (r) =>
          r.product_name.toLowerCase().includes(q) ||
          r.batch_no.toLowerCase().includes(q) ||
          r.voucher_no.toLowerCase().includes(q) ||
          (r.party_name && r.party_name.toLowerCase().includes(q))
      );
    }

    // Sort descending by date
    resultRows.sort((a, b) => b.date.localeCompare(a.date));

    return {
      rows: resultRows,
      totalCount: resultRows.length,
      page: 1,
      pageSize: resultRows.length,
      totalPages: 1,
    };
  },
};
