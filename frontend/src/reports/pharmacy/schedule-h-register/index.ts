import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import { parseSerialNumber } from "../../../lib/billing/documentNumberFormat";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

/**
 * GAP-02 / PHR-007 — what the till writes into the prescription register.
 *
 * A scheduled line is one the shelf itself marks: the stamped `schedule_code`
 * the server sent, or the `schedule_type` a shelf cached before the stamp
 * existed. An ordinary pack never joins the book, a return is written as its
 * own entry with the quantity running backwards, and a line nobody vouched for
 * stays visible with the pharmacist column blank rather than being dropped.
 */

/** The schedules a drug inspector reads as prescription-only. */
const PRESCRIPTION_SCHEDULES = ["H", "H1", "X"];

const RETURN_MODULES = ["credit_note", "sales_return"];

function scheduleOf(product: { schedule_code?: string | null; schedule_type?: string | null }): string {
  const stamped = String(product.schedule_code || "").trim().toUpperCase();
  if (stamped) {
    return PRESCRIPTION_SCHEDULES.includes(stamped) ? stamped : "";
  }

  const legacy = String(product.schedule_type || "").trim().toUpperCase();

  return PRESCRIPTION_SCHEDULES.includes(legacy) ? legacy : "";
}

export interface ScheduleHRow {
  invoice_id: string;
  invoice_date: string;
  invoice_number: string;
  is_return: boolean;
  doctor_name: string;
  doctor_reg_no: string;
  patient_name: string;
  product_name: string;
  schedule_code: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
  total_amount: number;
  pharmacist_name: string;
  pharmacist_reg_no: string;
  pharmacist_confirmed_at: number;
  unconfirmed: boolean;
}

export const scheduleHColumns: ReportColumn<ScheduleHRow>[] = [
  {
    id: "invoice_date",
    header: "Date",
    accessor: (r) => r.invoice_date,
    align: "center",
    width: 100,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "invoice_number",
    header: "Bill No",
    accessor: (r) => r.invoice_number,
    align: "left",
    width: 120,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "patient_name",
    header: "Patient Name",
    accessor: (r) => r.patient_name || "-",
    align: "left",
    width: 170,
    isDefaultVisible: true,
  },
  {
    id: "doctor_name",
    header: "Prescribing Doctor",
    accessor: (r) => r.doctor_name || "-",
    align: "left",
    width: 170,
    isDefaultVisible: true,
  },
  {
    id: "doctor_reg_no",
    header: "Doctor Reg No",
    accessor: (r) => r.doctor_reg_no || "-",
    align: "center",
    width: 130,
    isDefaultVisible: true,
  },
  {
    id: "product_name",
    header: "Scheduled Drug",
    accessor: (r) => r.product_name,
    align: "left",
    width: 200,
    isDefaultVisible: true,
    canHide: false,
  },
  {
    id: "schedule_code",
    header: "Schedule",
    accessor: (r) => r.schedule_code,
    align: "center",
    width: 90,
    format: "badge",
    badgeStyle: (val) => (val === "H1" ? "danger" : "warning"),
    isDefaultVisible: true,
  },
  {
    id: "batch_no",
    header: "Batch No",
    accessor: (r) => r.batch_no || "-",
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "expiry_date",
    header: "Expiry",
    accessor: (r) => r.expiry_date || "-",
    align: "center",
    width: 95,
    isDefaultVisible: true,
  },
  {
    id: "qty",
    header: "Dispensed Units",
    accessor: (r) => r.qty,
    align: "right",
    width: 115,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_amount",
    header: "Value",
    accessor: (r) => r.total_amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "pharmacist_name",
    header: "Pharmacist",
    accessor: (r) => r.pharmacist_name,
    align: "left",
    width: 170,
    isDefaultVisible: true,
  },
  {
    id: "pharmacist_reg_no",
    header: "Registration No",
    accessor: (r) => r.pharmacist_reg_no,
    align: "center",
    width: 150,
    isDefaultVisible: true,
  },
  {
    id: "unconfirmed",
    header: "Confirmed",
    accessor: (r) => (r.unconfirmed ? "No" : "Yes"),
    align: "center",
    width: 100,
    format: "badge",
    badgeStyle: (_val, r) => (r.unconfirmed ? "danger" : "success"),
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const scheduleHFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Inspection Date Range",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const scheduleHReport: ReportModule<any, ScheduleHRow> = {
  id: "schedule-h-register",
  title: "Schedule H & H1 Prescription Register",
  description: "Statutory drug control register: every scheduled pack dispensed, with the batch, the prescribing doctor and patient, and the pharmacist who confirmed the bill.",
  category: "pharmacy",
  permission: "reports.pharmacy.view",
  menuVisibilityKey: "reports",
  keywords: ["schedule h", "schedule h1", "pharmacy", "prescription", "doctor reg", "drug inspector", "clinical"],
  defaultSort: { column: "invoice_date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: scheduleHFilters,
  columns: scheduleHColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const allInvoices = await sqliteStorage.findAll<InvoiceRecord>("invoices");
    const allItems = await sqliteStorage.findAll<InvoiceItemRecord>("invoice_items");

    const scheduledByProduct = new Map<string, string>();
    for (const product of await sqliteStorage.findAll<any>("products")) {
      const code = scheduleOf(product);
      if (code) {
        scheduledByProduct.set(String(product.id), code);
      }
    }

    const itemsByInvoice = new Map<string, InvoiceItemRecord[]>();
    for (const item of allItems) {
      if (!itemsByInvoice.has(item.invoice_id)) {
        itemsByInvoice.set(item.invoice_id, []);
      }
      itemsByInvoice.get(item.invoice_id)!.push(item);
    }

    const filtered = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );

    // Same serial, different spelling: `INV-273` and `INV-0273` are one book number, so the register
    // orders on the serial rather than the text, which would file 1000 before 999.
    filtered.sort(
      (a, b) =>
        a.invoice_date.localeCompare(b.invoice_date) ||
        (parseSerialNumber(a.invoice_number) ?? 0) - (parseSerialNumber(b.invoice_number) ?? 0) ||
        a.invoice_number.localeCompare(b.invoice_number)
    );

    const rows: ScheduleHRow[] = [];

    for (const inv of filtered) {
      const isReturn = RETURN_MODULES.includes(String(inv.module_key));
      const sign = isReturn ? -1 : 1;

      for (const item of itemsByInvoice.get(inv.id) || []) {
        const code = scheduledByProduct.get(String(item.product_id));
        if (!code) continue;

        const confirmedBy = String(inv.pharmacist_name || "").trim() || String(inv.pharmacist_id || "").trim();

        rows.push({
          invoice_id: inv.id,
          invoice_date: inv.invoice_date,
          invoice_number: inv.invoice_number,
          is_return: isReturn,
          doctor_name: inv.doctor_name || "-",
          doctor_reg_no: inv.doctor_reg_no || "-",
          patient_name: inv.patient_name || inv.customer_name || "-",
          product_name: item.product_name,
          schedule_code: code,
          batch_no: item.batch_no || "-",
          expiry_date: item.expiry_date || "-",
          qty: ((Number(item.qty) || 0) + (Number(item.loose_qty) || 0)) * sign,
          total_amount: (Number(item.total_amount) || 0) * sign,
          pharmacist_name: String(inv.pharmacist_name || ""),
          pharmacist_reg_no: String(inv.pharmacist_reg_no || ""),
          pharmacist_confirmed_at: Number(inv.pharmacist_confirmed_at) || 0,
          unconfirmed: confirmedBy === "",
        });
      }
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const searchFiltered = rows.filter(
        (r) =>
          r.doctor_name.toLowerCase().includes(q) ||
          r.patient_name.toLowerCase().includes(q) ||
          r.product_name.toLowerCase().includes(q) ||
          r.invoice_number.toLowerCase().includes(q) ||
          r.pharmacist_name.toLowerCase().includes(q) ||
          r.pharmacist_reg_no.toLowerCase().includes(q)
      );
      return {
        rows: searchFiltered,
        totalCount: searchFiltered.length,
        page: 1,
        pageSize: searchFiltered.length,
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
