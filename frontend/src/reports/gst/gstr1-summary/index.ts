import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface Gstr1TableRow {
  section_table: string; // "Table 4: B2B Invoices" | "Table 5: B2C Large" | "Table 7: B2C Small" | "Table 9: Credit/Debit Notes"
  document_number: string;
  document_date: string;
  recipient_gstin: string;
  recipient_name: string;
  place_of_supply: string;
  rate: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  total_invoice_value: number;
}

export const gstr1Columns: ReportColumn<Gstr1TableRow>[] = [
  {
    id: "section_table",
    header: "GSTR-1 Table",
    accessor: (r) => r.section_table,
    align: "left",
    width: 170,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "document_number",
    header: "Invoice / Note No",
    accessor: (r) => r.document_number,
    align: "left",
    width: 130,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "document_date",
    header: "Date",
    accessor: (r) => r.document_date,
    align: "center",
    width: 95,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "recipient_gstin",
    header: "GSTIN",
    accessor: (r) => r.recipient_gstin,
    align: "center",
    width: 140,
    isDefaultVisible: true,
  },
  {
    id: "recipient_name",
    header: "Recipient / Trade Name",
    accessor: (r) => r.recipient_name,
    align: "left",
    width: 180,
    isDefaultVisible: true,
  },
  {
    id: "rate",
    header: "GST Rate (%)",
    accessor: (r) => `${r.rate}%`,
    align: "center",
    width: 100,
    isDefaultVisible: true,
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
    canSort: true,
  },
  {
    id: "cgst",
    header: "Central Tax (₹)",
    accessor: (r) => r.cgst,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "sgst",
    header: "State Tax (₹)",
    accessor: (r) => r.sgst,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "igst",
    header: "Integrated Tax (₹)",
    accessor: (r) => r.igst,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_invoice_value",
    header: "Total Value (₹)",
    accessor: (r) => r.total_invoice_value,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const gstr1Filters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Return Tax Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "section",
    label: "GSTR-1 Section",
    type: "select",
    defaultValue: "all",
    options: [
      { label: "All Sections (4, 5, 7, 9)", value: "all" },
      { label: "Table 4: B2B Invoices", value: "b2b" },
      { label: "Table 5: B2C Large (Interstate > ₹2.5L)", value: "b2c_large" },
      { label: "Table 7: B2C Small", value: "b2c_small" },
      { label: "Table 9: Credit / Debit Notes", value: "notes" },
    ],
  },
];

export const gstr1SummaryReport: ReportModule<any, Gstr1TableRow> = {
  id: "gstr1-summary",
  title: "GSTR-1 Statutory Tax Return",
  description: "Official GST return schedule categorized into Table 4 (B2B), Table 5 (B2CL), Table 7 (B2CS), and Table 9 (CDNR).",
  category: "gst",
  permission: "reports.gst.view",
  menuVisibilityKey: "reports",
  keywords: ["gstr1", "gst", "statutory", "b2b", "b2c", "tax return", "gstin", "table 4", "table 7"],
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: gstr1Filters,
  columns: gstr1Columns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const inRange = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );

    const storeStateCode = "32"; // Kerala default
    const rows: Gstr1TableRow[] = [];

    for (const inv of inRange) {
      const items = itemsByInvoice.get(inv.id) || [];
      const hasGstin = Boolean(inv.customer_gstin && inv.customer_gstin.trim().length >= 15);
      const isNote = inv.module_key === "credit_note" || inv.module_key === "sales_return";
      const posCode = inv.place_of_supply ? inv.place_of_supply.slice(0, 2) : storeStateCode;
      const isInterState = posCode !== storeStateCode;

      let section = "";
      if (isNote) {
        section = "Table 9: Credit/Debit Notes";
      } else if (hasGstin) {
        section = "Table 4: B2B Invoices";
      } else if (isInterState && inv.grand_total > 250000) {
        section = "Table 5: B2C Large";
      } else {
        section = "Table 7: B2C Small";
      }

      if (params.filters.section && params.filters.section !== "all") {
        const sec = params.filters.section;
        if (sec === "b2b" && !section.startsWith("Table 4")) continue;
        if (sec === "b2c_large" && !section.startsWith("Table 5")) continue;
        if (sec === "b2c_small" && !section.startsWith("Table 7")) continue;
        if (sec === "notes" && !section.startsWith("Table 9")) continue;
      }

      // Group items by rate
      const rateMap = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
      if (items.length > 0) {
        for (const it of items) {
          const r = Math.round(Number(it.gst_percent) || 0);
          const taxable = (Number(it.total_amount) || 0) - (Number(it.cgst_amount) || 0) - (Number(it.sgst_amount) || 0) - (Number(it.igst_amount) || 0);
          if (!rateMap.has(r)) {
            rateMap.set(r, { taxable: 0, cgst: 0, sgst: 0, igst: 0 });
          }
          const rec = rateMap.get(r)!;
          rec.taxable += taxable;
          rec.cgst += Number(it.cgst_amount) || 0;
          rec.sgst += Number(it.sgst_amount) || 0;
          rec.igst += Number(it.igst_amount) || 0;
        }
      } else {
        const taxTot = Number(inv.tax_total) || 0;
        const sub = Number(inv.subtotal) || (inv.grand_total - taxTot);
        rateMap.set(12, { taxable: sub, cgst: taxTot / 2, sgst: taxTot / 2, igst: 0 });
      }

      for (const [rate, vals] of rateMap.entries()) {
        rows.push({
          section_table: section,
          document_number: inv.invoice_number,
          document_date: inv.invoice_date,
          recipient_gstin: inv.customer_gstin || "-",
          recipient_name: inv.customer_name || "Consumer / Unregistered",
          place_of_supply: inv.place_of_supply || `${storeStateCode}-Kerala`,
          rate,
          taxable_value: Math.round(vals.taxable * 100) / 100,
          cgst: Math.round(vals.cgst * 100) / 100,
          sgst: Math.round(vals.sgst * 100) / 100,
          igst: Math.round(vals.igst * 100) / 100,
          total_invoice_value: Math.round(inv.grand_total * 100) / 100,
        });
      }
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.document_number.toLowerCase().includes(q) ||
          r.recipient_name.toLowerCase().includes(q) ||
          r.recipient_gstin.toLowerCase().includes(q)
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
