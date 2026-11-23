import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";
import type { PurchaseDocumentRecord } from "../../../lib/purchases/purchaseService";
import type { PurchaseChargeRecord } from "../../../lib/reports/purchaseChargeRegister";
import {
  addIntoItcMoney,
  documentItcBuckets,
  emptyItcMoney,
  type ItcChargeBill,
} from "../../../lib/reports/chargeItc";

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
  description: "Statutory GSTR-3B monthly return computation comparing Table 3.1 Outward Tax liability against Table 4 Inward Eligible ITC, with each supplier-bill charge placed in the section its own eligibility and reverse-charge flag decide.",
  category: "gst",
  permission: "reports.gst.view",
  menuVisibilityKey: "reports",
  keywords: ["gstr3b", "gst return", "itc", "tax liability", "statutory", "table 3.1", "table 4", "bill charges", "rcm"],
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

    const [allInvoices, allInvoiceItems, allPurchasesDocs, allPurchasesAlt, allCharges] =
      await Promise.all([
        sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
        sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
        sqliteStorage.findAll<PurchaseDocumentRecord>("purchase_documents").catch(() => []),
        sqliteStorage.findAll<PurchaseDocumentRecord>("purchases").catch(() => []),
        sqliteStorage.findAll<PurchaseChargeRecord>("purchase_charges").catch(() => []),
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

    // 3. Table 3.1(d) Inward RCM, 4. Eligible ITC (Table 4(A)(5)), 5. Blocked ITC (Table 4(D))
    const rcm = emptyItcMoney();
    const eligible = emptyItcMoney();
    const ineligible = emptyItcMoney();

    for (const p of filteredPurchases) {
      const isReturn = p.module_key === "purchase_return" || p.module_key === "debit_note";
      const sign = isReturn ? -1 : 1;

      // REP-009: the header already carries the supplier-borne charge GST (PUR-001), so the charge
      // rows decide which section that tax belongs to — ordinary ITC, 4(D), or reverse charge.
      const buckets = documentItcBuckets(p as unknown as ItcChargeBill, allCharges, sign);

      addIntoItcMoney(eligible, buckets.eligible);
      addIntoItcMoney(ineligible, buckets.ineligible);
      addIntoItcMoney(rcm, buckets.rcm);
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
        taxable_value: round(rcm.taxable),
        cgst_amount: round(rcm.cgst),
        sgst_amount: round(rcm.sgst),
        igst_amount: round(rcm.igst),
        cess_amount: round(rcm.cess),
        total_tax: round(rcm.tax),
      },
      {
        section_key: "4(A)(5)",
        section_description: "Eligible ITC - All other inward supplies (Purchases + bill charges)",
        taxable_value: round(eligible.taxable),
        cgst_amount: round(eligible.cgst),
        sgst_amount: round(eligible.sgst),
        igst_amount: round(eligible.igst),
        cess_amount: round(eligible.cess),
        total_tax: round(eligible.tax),
      },
      {
        section_key: "4(D)",
        section_description: "Ineligible / Blocked ITC (Section 17(5) / others)",
        taxable_value: round(ineligible.taxable),
        cgst_amount: round(ineligible.cgst),
        sgst_amount: round(ineligible.sgst),
        igst_amount: round(ineligible.igst),
        cess_amount: round(ineligible.cess),
        total_tax: round(ineligible.tax),
      },
      {
        section_key: "Net Payable",
        section_description: "Net GST Payable in Cash (Output Liability - Eligible ITC)",
        taxable_value: round(outTaxable - eligible.taxable),
        cgst_amount: round(Math.max(0, outCgst - eligible.cgst)),
        sgst_amount: round(Math.max(0, outSgst - eligible.sgst)),
        igst_amount: round(Math.max(0, outIgst - eligible.igst)),
        cess_amount: 0,
        total_tax: round(
          Math.max(0, outCgst - eligible.cgst) +
          Math.max(0, outSgst - eligible.sgst) +
          Math.max(0, outIgst - eligible.igst)
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
