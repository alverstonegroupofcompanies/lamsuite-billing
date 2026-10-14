import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface ScheduleHRow {
  invoice_id: string;
  invoice_date: string;
  invoice_number: string;
  doctor_name: string;
  doctor_reg_no: string;
  patient_name: string;
  product_name: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
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
  description: "Statutory drug control register recording doctor prescriptions, medical registration numbers, and patient details.",
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

    const rows: ScheduleHRow[] = [];

    for (const inv of filtered) {
      const items = itemsByInvoice.get(inv.id) || [];
      for (const item of items) {
        rows.push({
          invoice_id: inv.id,
          invoice_date: inv.invoice_date,
          invoice_number: inv.invoice_number,
          doctor_name: inv.doctor_name || "-",
          doctor_reg_no: inv.doctor_reg_no || "-",
          patient_name: inv.patient_name || inv.customer_name || "-",
          product_name: item.product_name,
          batch_no: item.batch_no || "-",
          expiry_date: item.expiry_date || "-",
          qty: (Number(item.qty) || 0) + (Number(item.loose_qty) || 0),
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
          r.invoice_number.toLowerCase().includes(q)
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
