import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";

export interface Gstr2ItcRow {
  supplier_gstin: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string;
  invoice_type: "Regular" | "Debit Note" | "RCM";
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total_tax: number;
  total_invoice_value: number;
  itc_eligibility: "eligible" | "ineligible" | "blocked";
  rcm_applicable: boolean;
}

export const gstr2ItcColumns: ReportColumn<Gstr2ItcRow>[] = [
  {
    id: "supplier_gstin",
    header: "Supplier GSTIN",
    accessor: (r) => r.supplier_gstin || "URP (Unregistered)",
    align: "center",
    width: 140,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "supplier_name",
    header: "Supplier Trade Name",
    accessor: (r) => r.supplier_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "invoice_number",
    header: "Invoice / Bill No",
    accessor: (r) => r.invoice_number,
    align: "left",
    width: 125,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "invoice_date",
    header: "Date",
    accessor: (r) => r.invoice_date,
    align: "center",
    width: 95,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "invoice_type",
    header: "Doc Type",
    accessor: (r) => r.invoice_type,
    align: "center",
    width: 100,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "Regular") return "info";
      if (val === "Debit Note") return "warning";
      return "neutral";
    },
    isDefaultVisible: true,
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
  },
  {
    id: "cgst_amount",
    header: "CGST (₹)",
    accessor: (r) => r.cgst_amount,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst_amount",
    header: "SGST (₹)",
    accessor: (r) => r.sgst_amount,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst_amount",
    header: "IGST (₹)",
    accessor: (r) => r.igst_amount,
    align: "right",
    width: 100,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_tax",
    header: "Input Tax (₹)",
    accessor: (r) => r.total_tax,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_invoice_value",
    header: "Total Bill (₹)",
    accessor: (r) => r.total_invoice_value,
    align: "right",
    width: 125,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "itc_eligibility",
    header: "ITC Status",
    accessor: (r) => r.itc_eligibility.toUpperCase(),
    align: "center",
    width: 110,
    format: "badge",
    badgeStyle: (val) => {
      if (val === "ELIGIBLE") return "success";
      if (val === "BLOCKED") return "danger";
      return "warning";
    },
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const gstr2ItcFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Inward Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "itcStatus",
    label: "ITC Eligibility",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Purchases", value: "all" },
      { label: "Eligible ITC", value: "eligible" },
      { label: "Ineligible ITC", value: "ineligible" },
      { label: "Blocked ITC (Sec 17(5))", value: "blocked" },
    ],
  },
];

export const gstr2ItcReport: ReportModule<any, Gstr2ItcRow> = {
  id: "gstr-2-itc",
  title: "GSTR-2 Inward Input Tax Credit Register",
  description: "Comprehensive inward purchase tax register for ITC reconciliation, GSTIN matching, and Section 17(5) blocked credit reporting.",
  category: "gst",
  permission: "reports.gst.view",
  menuVisibilityKey: "reports",
  keywords: ["gstr2", "itc", "input tax credit", "supplier gstin", "purchase gst", "reconciliation"],
  defaultSort: { column: "invoice_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: gstr2ItcFilters,
  columns: gstr2ItcColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allPurchasesDocs, allPurchasesAlt] = await Promise.all([
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
      sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
    ]);

    const purchaseMap = new Map<string, PurchaseDocumentRecord>();
    for (const p of allPurchasesAlt) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    for (const p of allPurchasesDocs) {
      if (p && (p.id || p.purchase_number)) purchaseMap.set(p.id || p.purchase_number, p);
    }
    const allPurchases = Array.from(purchaseMap.values());

    let filtered = allPurchases.filter((p) => {
      if (!p) return false;
      const status = (p.status || "").toLowerCase();
      if (status === "cancelled") return false;

      const pDate = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && pDate < startDateStr) return false;
      if (endDateStr && pDate > endDateStr) return false;
      return true;
    });

    if (params.filters.itcStatus && params.filters.itcStatus !== "all") {
      filtered = filtered.filter(
        (p) => (p.itc_eligibility || "eligible") === params.filters.itcStatus
      );
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.supplier_name.toLowerCase().includes(q) ||
          (p.supplier_gstin && p.supplier_gstin.toLowerCase().includes(q)) ||
          p.supplier_invoice_no.toLowerCase().includes(q) ||
          p.purchase_number.toLowerCase().includes(q)
      );
    }

    const rows: Gstr2ItcRow[] = filtered.map((p) => {
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      const sign = isReturn ? -1 : 1;

      return {
        supplier_gstin: p.supplier_gstin || "",
        supplier_name: p.supplier_name,
        invoice_number: p.supplier_invoice_no || p.purchase_number,
        invoice_date: p.purchase_date,
        invoice_type: isReturn ? "Debit Note" : p.is_rcm ? "RCM" : "Regular",
        taxable_value: (Number(p.subtotal) || 0) * sign,
        cgst_amount: (Number(p.cgst_total) || 0) * sign,
        sgst_amount: (Number(p.sgst_total) || 0) * sign,
        igst_amount: (Number(p.igst_total) || 0) * sign,
        total_tax: (Number(p.tax_total) || 0) * sign,
        total_invoice_value: (Number(p.grand_total) || 0) * sign,
        itc_eligibility: (p.itc_eligibility as any) || "eligible",
        rcm_applicable: Boolean(p.is_rcm),
      };
    });

    return {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
