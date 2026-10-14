import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";

export interface PurchaseReturnRow {
  debit_note_no: string;
  return_date: string;
  supplier_name: string;
  supplier_gstin?: string;
  original_bill_no: string;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  grand_total: number;
  return_reason?: string;
  settlement_status: "pending" | "adjusted" | "refunded";
}

export const purchaseReturnColumns: ReportColumn<PurchaseReturnRow>[] = [
  {
    id: "debit_note_no",
    header: "Debit Note No",
    accessor: (r) => r.debit_note_no,
    align: "left",
    width: 130,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "return_date",
    header: "Date",
    accessor: (r) => r.return_date,
    align: "center",
    width: 95,
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
    id: "original_bill_no",
    header: "Original Bill No",
    accessor: (r) => r.original_bill_no || "-",
    align: "left",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "supplier_gstin",
    header: "Supplier GSTIN",
    accessor: (r) => r.supplier_gstin || "-",
    align: "center",
    width: 140,
    isDefaultVisible: false,
  },
  {
    id: "taxable_value",
    header: "Taxable Value (₹)",
    accessor: (r) => r.taxable_value,
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "cgst_amount",
    header: "CGST (₹)",
    accessor: (r) => r.cgst_amount,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst_amount",
    header: "SGST (₹)",
    accessor: (r) => r.sgst_amount,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst_amount",
    header: "IGST (₹)",
    accessor: (r) => r.igst_amount,
    align: "right",
    width: 95,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "total_tax",
    header: "Tax Reversal (₹)",
    accessor: (r) => r.total_tax,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "grand_total",
    header: "Debit Total (₹)",
    accessor: (r) => r.grand_total,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "settlement_status",
    header: "Status",
    accessor: (r) => r.settlement_status.toUpperCase(),
    align: "center",
    width: 110,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "ADJUSTED") return "success";
      if (val === "REFUNDED") return "info";
      return "warning";
    },
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const purchaseReturnFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Return Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const purchaseReturnRegisterReport: ReportModule<any, PurchaseReturnRow> = {
  id: "purchase-return-register",
  title: "Purchase Return & Debit Note Register",
  description: "Record of goods returned to suppliers, debit notes issued, ITC reversals, and pending ledger balance adjustments.",
  category: "purchase",
  permission: "reports.purchase.view",
  menuVisibilityKey: "reports",
  keywords: ["purchase return", "debit note", "supplier return", "stock return", "damaged return", "expiry return"],
  defaultSort: { column: "return_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: purchaseReturnFilters,
  columns: purchaseReturnColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allPurchasesDocs, allPurchasesAlt, allPurchaseReturns] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
      sqliteStorage.findAll<any>("purchase_returns").catch(() => []),
    ]);

    const returnMap = new Map<string, PurchaseReturnRow>();

    // 1. Process purchase_returns table records
    for (const ret of allPurchaseReturns) {
      if (!ret) continue;
      const status = (ret.status || "").toLowerCase();
      if (status === "cancelled") continue;

      const rDate = String(ret.return_date || "").trim().slice(0, 10);
      if (startDateStr && rDate < startDateStr) continue;
      if (endDateStr && rDate > endDateStr) continue;

      const num = ret.return_number || ret.id;
      returnMap.set(num, {
        debit_note_no: num,
        return_date: rDate,
        supplier_name: ret.supplier_name,
        supplier_gstin: ret.supplier_gstin,
        original_bill_no: ret.supplier_invoice_no || ret.original_purchase_number || "-",
        taxable_value: Number(ret.subtotal) || 0,
        cgst_amount: Number(ret.cgst_total) || 0,
        sgst_amount: Number(ret.sgst_total) || 0,
        igst_amount: Number(ret.igst_total) || 0,
        total_tax: Number(ret.tax_total) || 0,
        grand_total: Number(ret.grand_total) || 0,
        return_reason: ret.notes || ret.reason,
        settlement_status: (ret.settlement_type === "refund" ? "refunded" : "adjusted") as any,
      });
    }

    // 2. Process debit notes from purchase_documents / purchases
    const allPurchases = [...allPurchasesDocs, ...allPurchasesAlt];
    for (const p of allPurchases) {
      if (!p) continue;
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      if (!isReturn) continue;

      const status = (p.status || "").toLowerCase();
      if (status === "cancelled") continue;

      const pDate = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && pDate < startDateStr) continue;
      if (endDateStr && pDate > endDateStr) continue;

      const num = p.purchase_number || p.id;
      if (!returnMap.has(num)) {
        returnMap.set(num, {
          debit_note_no: num,
          return_date: pDate,
          supplier_name: p.supplier_name,
          supplier_gstin: p.supplier_gstin,
          original_bill_no: p.supplier_invoice_no || "-",
          taxable_value: Number(p.subtotal) || 0,
          cgst_amount: Number(p.cgst_total) || 0,
          sgst_amount: Number(p.sgst_total) || 0,
          igst_amount: Number(p.igst_total) || 0,
          total_tax: Number(p.tax_total) || 0,
          grand_total: Number(p.grand_total) || 0,
          return_reason: p.notes,
          settlement_status: (p.payment_status === "paid" ? "adjusted" : "pending") as any,
        });
      }
    }

    const rows: PurchaseReturnRow[] = Array.from(returnMap.values());

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.debit_note_no.toLowerCase().includes(q) ||
          r.supplier_name.toLowerCase().includes(q) ||
          r.original_bill_no.toLowerCase().includes(q)
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
