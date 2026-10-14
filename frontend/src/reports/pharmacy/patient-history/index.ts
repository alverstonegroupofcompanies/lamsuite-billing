import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface PatientHistoryRow {
  date: string;
  patient_name: string;
  phone: string;
  product_name: string;
  batch_no: string;
  expiry_date: string;
  qty: number;
  doctor_name: string;
  invoice_number: string;
  amount: number;
}

export const patientHistoryColumns: ReportColumn<PatientHistoryRow>[] = [
  {
    id: "date",
    header: "Date",
    accessor: (r) => r.date,
    align: "center",
    width: 95,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "patient_name",
    header: "Patient Name",
    accessor: (r) => r.patient_name,
    align: "left",
    width: 170,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "phone",
    header: "Mobile",
    accessor: (r) => r.phone || "-",
    align: "center",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "product_name",
    header: "Medicine Dispensed",
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
    width: 100,
    isDefaultVisible: true,
  },
  {
    id: "expiry_date",
    header: "Exp Date",
    accessor: (r) => r.expiry_date || "-",
    align: "center",
    width: 90,
    isDefaultVisible: true,
  },
  {
    id: "qty",
    header: "Units",
    accessor: (r) => r.qty,
    align: "right",
    width: 80,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "doctor_name",
    header: "Prescribed By",
    accessor: (r) => r.doctor_name || "-",
    align: "left",
    width: 160,
    isDefaultVisible: true,
  },
  {
    id: "invoice_number",
    header: "Bill No",
    accessor: (r) => r.invoice_number,
    align: "left",
    width: 110,
    isDefaultVisible: true,
  },
  {
    id: "amount",
    header: "Total (₹)",
    accessor: (r) => r.amount,
    align: "right",
    width: 110,
    format: "currency",
    isDefaultVisible: true,
    totalType: "sum",
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const patientHistoryFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Dispensing Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
  {
    id: "patientSearch",
    label: "Patient Search",
    type: "text",
    defaultValue: "",
    placeholder: "Search patient name or mobile...",
  },
];

export const patientHistoryReport: ReportModule<any, PatientHistoryRow> = {
  id: "patient-history",
  title: "Patient Medication History & Chronic Refill Log",
  description: "Detailed chronological clinical dispensing audit tracking patient medications, batch numbers, dosage quantities, and prescribing doctors.",
  category: "pharmacy",
  permission: "reports.pharmacy.view",
  menuVisibilityKey: "reports",
  keywords: ["patient history", "chronic refill", "medication history", "patient record", "dispensing log", "clinical"],
  defaultSort: { column: "date", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: patientHistoryFilters,
  columns: patientHistoryColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const [allInvoices, allInvoiceItems] = await Promise.all([
      sqliteStorage.findAll<InvoiceRecord>("invoices").catch(() => []),
      sqliteStorage.findAll<InvoiceItemRecord>("invoice_items").catch(() => []),
    ]);

    const activeInvoices = allInvoices.filter(
      (inv) =>
        inv.status !== "cancelled" &&
        inv.invoice_date >= dates.startDate &&
        inv.invoice_date <= dates.endDate
    );
    const invoiceMap = new Map(activeInvoices.map((inv) => [inv.id, inv]));

    const rows: PatientHistoryRow[] = [];

    for (const item of allInvoiceItems) {
      if (!invoiceMap.has(item.invoice_id)) continue;
      const inv = invoiceMap.get(item.invoice_id)!;

      rows.push({
        date: inv.invoice_date,
        patient_name: inv.patient_name || inv.customer_name || "Counter Customer",
        phone: inv.customer_phone || "",
        product_name: item.product_name,
        batch_no: item.batch_no || (item as any).batch_number || "",
        expiry_date: item.expiry_date || "",
        qty: Number(item.qty || (item as any).quantity) || 0,
        doctor_name: inv.doctor_name || "-",
        invoice_number: inv.invoice_number,
        amount: Number(item.total_amount) || 0,
      });
    }

    rows.sort((a, b) => b.date.localeCompare(a.date));

    let filtered = rows;
    if (params.filters.patientSearch) {
      const q = String(params.filters.patientSearch).toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.patient_name.toLowerCase().includes(q) ||
          r.phone.toLowerCase().includes(q)
      );
    }

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.patient_name.toLowerCase().includes(q) ||
          r.phone.toLowerCase().includes(q) ||
          r.product_name.toLowerCase().includes(q) ||
          r.doctor_name.toLowerCase().includes(q) ||
          r.invoice_number.toLowerCase().includes(q)
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
