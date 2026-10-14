import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";

export interface Gstr3bRow {
  section_key: string;
  section_description: string;
  taxable_value: number;
  igst_amount: number;
  cgst_amount: number;
  sgst_amount: number;
  cess_amount: number;
  total_tax: number;
}

export const gstr3bColumns: ReportColumn<Gstr3bRow>[] = [
  {
    id: "section_key",
    header: "Table / Section",
    accessor: (r) => r.section_key,
    align: "left",
    width: 140,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "section_description",
    header: "Nature of Supplies / ITC",
    accessor: (r) => r.section_description,
    align: "left",
    width: 280,
    isDefaultVisible: true,
    canHide: false,
  },
  {
    id: "taxable_value",
    header: "Taxable Value (₹)",
    accessor: (r) => r.taxable_value,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "cgst_amount",
    header: "CGST (₹)",
    accessor: (r) => r.cgst_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst_amount",
    header: "SGST (₹)",
    accessor: (r) => r.sgst_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst_amount",
    header: "IGST (₹)",
    accessor: (r) => r.igst_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "cess_amount",
    header: "Cess (₹)",
    accessor: (r) => r.cess_amount,
    align: "right",
    width: 90,
    format: "currency",
    isDefaultVisible: false,
    totalType: "sum",
  },
  {
    id: "total_tax",
    header: "Total Tax (₹)",
    accessor: (r) => r.total_tax,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const gstr3bFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Return Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const gstr3bSummaryReport: ReportModule<any, Gstr3bRow> = {
  id: "gstr-3b-summary",
  title: "GSTR-3B Monthly Return Summary",
  description: "Statutory GSTR-3B monthly return computation comparing Table 3.1 Outward Tax liability against Table 4 Inward Eligible ITC.",
  category: "gst",
  permission: "reports.gst.view",
  menuVisibilityKey: "reports",
  keywords: ["gstr3b", "gst return", "itc", "tax liability", "statutory", "table 3.1", "table 4"],
  defaultSort: { column: "section_key", direction: "asc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: gstr3bFilters,
  columns: gstr3bColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const [allInvoices, allInvoiceItems, allPurchasesDocs, allPurchasesAlt] = await Promise.all([
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
      sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
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

    // Filter active sales in period
    const filteredInvoices = allInvoices.filter((inv) => {
      if (!inv || (inv.status || "").toLowerCase() === "cancelled") return false;
      const d = String(inv.invoice_date || "").trim().slice(0, 10);
      if (startDateStr && d < startDateStr) return false;
      if (endDateStr && d > endDateStr) return false;
      return true;
    });
    const activeInvMap = new Map(filteredInvoices.map((inv) => [inv.id, inv]));

    // Filter active purchases in period
    const filteredPurchases = allPurchases.filter((p) => {
      if (!p || (p.status || "").toLowerCase() === "cancelled") return false;
      const d = String(p.purchase_date || "").trim().slice(0, 10);
      if (startDateStr && d < startDateStr) return false;
      if (endDateStr && d > endDateStr) return false;
      return true;
    });

    // 1. Table 3.1(a) Outward Taxable Supplies (Net of sales returns)
    let outTaxable = 0;
    let outCgst = 0;
    let outSgst = 0;
    let outIgst = 0;

    // 2. Table 3.1(c) Nil rated / Exempted
    let exemptTaxable = 0;

    // 3. Table 3.1(d) Inward RCM
    let rcmTaxable = 0;
    let rcmCgst = 0;
    let rcmSgst = 0;
    let rcmIgst = 0;

    for (const item of allInvoiceItems) {
      if (!activeInvMap.has(item.invoice_id)) continue;
      const inv = activeInvMap.get(item.invoice_id)!;
      const isReturn = inv.module_key === "sales_return" || inv.module_key === "credit_note";
      const sign = isReturn ? -1 : 1;

      const cgst = (Number(item.cgst_amount) || 0) * sign;
      const sgst = (Number(item.sgst_amount) || 0) * sign;
      const igst = (Number(item.igst_amount) || 0) * sign;
      const taxable = ((Number(item.total_amount) || 0) - (Number(item.cgst_amount) || 0) - (Number(item.sgst_amount) || 0) - (Number(item.igst_amount) || 0)) * sign;

      if (cgst === 0 && sgst === 0 && igst === 0) {
        exemptTaxable += taxable;
      } else {
        outTaxable += taxable;
        outCgst += cgst;
        outSgst += sgst;
        outIgst += igst;
      }
    }

    // 4. Eligible ITC from purchases (Table 4(A)(5))
    let itcTaxable = 0;
    let itcCgst = 0;
    let itcSgst = 0;
    let itcIgst = 0;

    // 5. Ineligible / Blocked ITC (Table 4(D))
    let ineligTaxable = 0;
    let ineligCgst = 0;
    let ineligSgst = 0;
    let ineligIgst = 0;

    for (const p of filteredPurchases) {
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      const sign = isReturn ? -1 : 1;

      const taxable = (Number(p.subtotal) || 0) * sign;
      const cgst = (Number(p.cgst_total) || 0) * sign;
      const sgst = (Number(p.sgst_total) || 0) * sign;
      const igst = (Number(p.igst_total) || 0) * sign;

      if (p.is_rcm) {
        rcmTaxable += taxable;
        rcmCgst += cgst;
        rcmSgst += sgst;
        rcmIgst += igst;
      }

      if (p.itc_eligibility === "ineligible" || p.itc_eligibility === "blocked") {
        ineligTaxable += taxable;
        ineligCgst += cgst;
        ineligSgst += sgst;
        ineligIgst += igst;
      } else {
        itcTaxable += taxable;
        itcCgst += cgst;
        itcSgst += sgst;
        itcIgst += igst;
      }
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: Gstr3bRow[] = [
      {
        section_key: "3.1(a)",
        section_description: "Outward taxable supplies (other than zero/nil/exempt)",
        taxable_value: round(outTaxable),
        cgst_amount: round(outCgst),
        sgst_amount: round(outSgst),
        igst_amount: round(outIgst),
        cess_amount: 0,
        total_tax: round(outCgst + outSgst + outIgst),
      },
      {
        section_key: "3.1(c)",
        section_description: "Other outward supplies (Nil rated, exempted)",
        taxable_value: round(exemptTaxable),
        cgst_amount: 0,
        sgst_amount: 0,
        igst_amount: 0,
        cess_amount: 0,
        total_tax: 0,
      },
      {
        section_key: "3.1(d)",
        section_description: "Inward supplies liable to reverse charge (RCM)",
        taxable_value: round(rcmTaxable),
        cgst_amount: round(rcmCgst),
        sgst_amount: round(rcmSgst),
        igst_amount: round(rcmIgst),
        cess_amount: 0,
        total_tax: round(rcmCgst + rcmSgst + rcmIgst),
      },
      {
        section_key: "4(A)(5)",
        section_description: "Eligible ITC - All other inward supplies (Purchases)",
        taxable_value: round(itcTaxable),
        cgst_amount: round(itcCgst),
        sgst_amount: round(itcSgst),
        igst_amount: round(itcIgst),
        cess_amount: 0,
        total_tax: round(itcCgst + itcSgst + itcIgst),
      },
      {
        section_key: "4(D)",
        section_description: "Ineligible / Blocked ITC (Section 17(5) / others)",
        taxable_value: round(ineligTaxable),
        cgst_amount: round(ineligCgst),
        sgst_amount: round(ineligSgst),
        igst_amount: round(ineligIgst),
        cess_amount: 0,
        total_tax: round(ineligCgst + ineligSgst + ineligIgst),
      },
      {
        section_key: "Net Payable",
        section_description: "Net GST Payable in Cash (Output Liability - Eligible ITC)",
        taxable_value: round(outTaxable - itcTaxable),
        cgst_amount: round(Math.max(0, outCgst - itcCgst)),
        sgst_amount: round(Math.max(0, outSgst - itcSgst)),
        igst_amount: round(Math.max(0, outIgst - itcIgst)),
        cess_amount: 0,
        total_tax: round(
          Math.max(0, outCgst - itcCgst) +
          Math.max(0, outSgst - itcSgst) +
          Math.max(0, outIgst - itcIgst)
        ),
      },
    ];

    return {
      rows,
      totalCount: rows.length,
      page: 1,
      pageSize: rows.length,
      totalPages: 1,
    };
  },
};
