import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { PurchaseDocumentRecord, PurchaseItemRecord } from "../../../lib/purchases/purchaseService";

export interface GstSlabRow {
  rate_label: string; // "0% (Exempt)", "5%", "12%", "18%", "28%"
  tax_rate: number;
  outward_taxable: number;
  outward_cgst: number;
  outward_sgst: number;
  outward_igst: number;
  total_output_tax: number;
  inward_taxable: number;
  inward_cgst: number;
  inward_sgst: number;
  inward_igst: number;
  total_input_tax: number;
  net_tax_payable: number;
}

export const gstSlabColumns: ReportColumn<GstSlabRow>[] = [
  {
    id: "rate_label",
    header: "GST Slab Rate",
    accessor: (r) => r.rate_label,
    align: "center",
    width: 120,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "outward_taxable",
    header: "Sales Taxable (₹)",
    accessor: (r) => r.outward_taxable,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_output_tax",
    header: "Output Tax (₹)",
    accessor: (r) => r.total_output_tax,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "inward_taxable",
    header: "Purchase Taxable (₹)",
    accessor: (r) => r.inward_taxable,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_input_tax",
    header: "Input Tax (₹)",
    accessor: (r) => r.total_input_tax,
    align: "right",
    width: 120,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "net_tax_payable",
    header: "Net Tax Payable (₹)",
    accessor: (r) => r.net_tax_payable,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const gstSlabFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Accounting Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const gstSlabReport: ReportModule<any, GstSlabRow> = {
  id: "gst-slab-report",
  title: "GST Rate Slab-wise Tax Analysis",
  description: "Comparative GST slab breakdown (0%, 5%, 12%, 18%, 28%) analyzing Output tax collected against Input tax paid.",
  category: "gst",
  permission: "reports.gst.view",
  menuVisibilityKey: "reports",
  keywords: ["gst slabs", "tax rates", "5%", "12%", "18%", "output tax", "input tax", "tax analysis"],
  defaultSort: { column: "tax_rate", direction: "asc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: gstSlabFilters,
  columns: gstSlabColumns,
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
    const invoiceIdSet = new Set(filteredInvoices.map((inv) => inv.id));
    const invoiceMap = new Map(filteredInvoices.map((inv) => [inv.id, inv]));

    const filteredPurchases = allPurchases.filter((p) => {
      if (!p || (p.status || "").toLowerCase() === "cancelled") return false;
      const d = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && d < startDateStr) return false;
      if (endDateStr && d > endDateStr) return false;
      return true;
    });
    const purchaseIdSet = new Set(filteredPurchases.map((p) => p.id));
    const purchaseMap = new Map(filteredPurchases.map((p) => [p.id, p]));

    // Standard GST slabs
    const slabs = [0, 5, 12, 18, 28];
    const slabMap = new Map<number, GstSlabRow>();

    for (const rate of slabs) {
      slabMap.set(rate, {
        rate_label: rate === 0 ? "0% (Nil / Exempt)" : `${rate}%`,
        tax_rate: rate,
        outward_taxable: 0,
        outward_cgst: 0,
        outward_sgst: 0,
        outward_igst: 0,
        total_output_tax: 0,
        inward_taxable: 0,
        inward_cgst: 0,
        inward_sgst: 0,
        inward_igst: 0,
        total_input_tax: 0,
        net_tax_payable: 0,
      });
    }

    // Accumulate outward items
    for (const item of allInvoiceItems) {
      if (!invoiceIdSet.has(item.invoice_id)) continue;
      const inv = invoiceMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const rate = Math.round(Number(item.gst_percent) || 0);
      if (!slabMap.has(rate)) {
        slabMap.set(rate, {
          rate_label: `${rate}%`,
          tax_rate: rate,
          outward_taxable: 0,
          outward_cgst: 0,
          outward_sgst: 0,
          outward_igst: 0,
          total_output_tax: 0,
          inward_taxable: 0,
          inward_cgst: 0,
          inward_sgst: 0,
          inward_igst: 0,
          total_input_tax: 0,
          net_tax_payable: 0,
        });
      }

      const row = slabMap.get(rate)!;
      const cgst = (Number(item.cgst_amount) || 0) * sign;
      const sgst = (Number(item.sgst_amount) || 0) * sign;
      const igst = (Number(item.igst_amount) || 0) * sign;
      const taxable = ((Number(item.total_amount) || 0) - (Number(item.cgst_amount) || 0) - (Number(item.sgst_amount) || 0) - (Number(item.igst_amount) || 0)) * sign;

      row.outward_taxable += taxable;
      row.outward_cgst += cgst;
      row.outward_sgst += sgst;
      row.outward_igst += igst;
      row.total_output_tax += cgst + sgst + igst;
    }

    // Accumulate inward items
    for (const pItem of allPurchaseItems) {
      if (!purchaseIdSet.has(pItem.purchase_id)) continue;
      const p = purchaseMap.get(pItem.purchase_id)!;
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      const sign = isReturn ? -1 : 1;

      // Purchase item gst
      const rate = Math.round(
        Number((pItem as any).gst_percent || (pItem as any).gst_rate) || 0
      );
      if (!slabMap.has(rate)) {
        slabMap.set(rate, {
          rate_label: `${rate}%`,
          tax_rate: rate,
          outward_taxable: 0,
          outward_cgst: 0,
          outward_sgst: 0,
          outward_igst: 0,
          total_output_tax: 0,
          inward_taxable: 0,
          inward_cgst: 0,
          inward_sgst: 0,
          inward_igst: 0,
          total_input_tax: 0,
          net_tax_payable: 0,
        });
      }

      const row = slabMap.get(rate)!;
      const taxable = (Number((pItem as any).taxable_amount || ((pItem.total_units || 0) * (pItem.purchase_rate || 0))) || 0) * sign;
      const cgst = (Number((pItem as any).cgst_amount) || (p.is_interstate ? 0 : (taxable * rate) / 200)) * sign;
      const sgst = (Number((pItem as any).sgst_amount) || (p.is_interstate ? 0 : (taxable * rate) / 200)) * sign;
      const igst = (Number((pItem as any).igst_amount) || (p.is_interstate ? (taxable * rate) / 100 : 0)) * sign;

      row.inward_taxable += taxable;
      row.inward_cgst += cgst;
      row.inward_sgst += sgst;
      row.inward_igst += igst;
      row.total_input_tax += cgst + sgst + igst;
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: GstSlabRow[] = Array.from(slabMap.values())
      .map((r) => ({
        ...r,
        outward_taxable: round(r.outward_taxable),
        outward_cgst: round(r.outward_cgst),
        outward_sgst: round(r.outward_sgst),
        outward_igst: round(r.outward_igst),
        total_output_tax: round(r.total_output_tax),
        inward_taxable: round(r.inward_taxable),
        inward_cgst: round(r.inward_cgst),
        inward_sgst: round(r.inward_sgst),
        inward_igst: round(r.inward_igst),
        total_input_tax: round(r.total_input_tax),
        net_tax_payable: round(r.total_output_tax - r.total_input_tax),
      }))
      .sort((a, b) => a.tax_rate - b.tax_rate);

    return {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
