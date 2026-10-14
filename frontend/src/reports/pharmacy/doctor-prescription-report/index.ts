import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { sqliteStorage } from "../../../lib/db/sqliteStorage";
import type { InvoiceRecord, InvoiceItemRecord } from "../../../lib/billing/invoiceManagementService";

export interface DoctorPrescriptionRow {
  doctor_name: string;
  doctor_reg_no?: string;
  prescription_count: number;
  patient_count: number;
  total_units_dispensed: number;
  total_value: number;
  avg_prescription_value: number;
}

export const doctorPrescriptionColumns: ReportColumn<DoctorPrescriptionRow>[] = [
  {
    id: "doctor_name",
    header: "Prescribing Doctor",
    accessor: (r) => r.doctor_name,
    align: "left",
    width: 220,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
  {
    id: "doctor_reg_no",
    header: "Medical Reg No",
    accessor: (r) => r.doctor_reg_no || "-",
    align: "center",
    width: 140,
    isDefaultVisible: true,
  },
  {
    id: "prescription_count",
    header: "Rx Count",
    accessor: (r) => r.prescription_count,
    align: "center",
    width: 100,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "patient_count",
    header: "Distinct Patients",
    accessor: (r) => r.patient_count,
    align: "center",
    width: 130,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_units_dispensed",
    header: "Units Dispensed",
    accessor: (r) => r.total_units_dispensed,
    align: "right",
    width: 125,
    format: "number",
    isDefaultVisible: true,
    totalType: "sum",
  },
  {
    id: "total_value",
    header: "Dispensed Value (₹)",
    accessor: (r) => r.total_value,
    align: "right",
    width: 140,
    format: "currency",
    isDefaultVisible: true,
    canHide: false,
    totalType: "sum",
    canSort: true,
  },
  {
    id: "avg_prescription_value",
    header: "Avg Rx Value (₹)",
    accessor: (r) => r.avg_prescription_value,
    align: "right",
    width: 130,
    format: "currency",
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = `${today.slice(0, 7)}-01`;

export const doctorPrescriptionFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Prescription Period",
    type: "date-range",
    defaultValue: { startDate: startOfMonth, endDate: today },
    required: true,
  },
];

export const doctorPrescriptionReport: ReportModule<any, DoctorPrescriptionRow> = {
  id: "doctor-prescription-report",
  title: "Doctor-Wise Prescription & Referral Analysis",
  description: "Tracks prescription volumes, patient counts, and medicine sales value dispensed per prescribing practitioner.",
  category: "pharmacy",
  permission: "reports.pharmacy.view",
  menuVisibilityKey: "reports",
  keywords: ["doctor", "prescription", "rx", "referral", "physician", "dispensed medicines"],
  defaultSort: { column: "total_value", direction: "desc" },
  supportedPrintLayouts: ["a4", "dot-matrix"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: doctorPrescriptionFilters,
  columns: doctorPrescriptionColumns,
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
        inv.invoice_date <= dates.endDate &&
        Boolean(inv.doctor_name || (inv as any).doctor_id)
    );
    const invoiceMap = new Map(activeInvoices.map((inv) => [inv.id, inv]));

    const docMap = new Map<
      string,
      {
        regNo?: string;
        invoices: Set<string>;
        patients: Set<string>;
        units: number;
        value: number;
      }
    >();

    for (const inv of activeInvoices) {
      const docName = (inv.doctor_name || "Self / OTC Prescribed").trim();
      const reg = inv.doctor_reg_no;
      const patient = (inv.patient_name || inv.customer_name || "Anonymous").trim();

      const cur = docMap.get(docName) || {
        regNo: reg,
        invoices: new Set<string>(),
        patients: new Set<string>(),
        units: 0,
        value: 0,
      };

      if (!cur.regNo && reg) cur.regNo = reg;
      cur.invoices.add(inv.id);
      cur.patients.add(patient);
      cur.value += Number(inv.grand_total) || 0;
      docMap.set(docName, cur);
    }

    for (const item of allInvoiceItems) {
      if (!invoiceMap.has(item.invoice_id)) continue;
      const inv = invoiceMap.get(item.invoice_id)!;
      const docName = (inv.doctor_name || "Self / OTC Prescribed").trim();
      const cur = docMap.get(docName);
      if (cur) {
        cur.units += Number(item.qty || (item as any).quantity) || 0;
      }
    }

    const round = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

    const rows: DoctorPrescriptionRow[] = Array.from(docMap.entries()).map(([name, data]) => {
      const rxCount = data.invoices.size;
      const avgVal = rxCount > 0 ? round(data.value / rxCount) : 0;
      return {
        doctor_name: name,
        doctor_reg_no: data.regNo,
        prescription_count: rxCount,
        patient_count: data.patients.size,
        total_units_dispensed: round(data.units),
        total_value: round(data.value),
        avg_prescription_value: avgVal,
      };
    });

    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      const filtered = rows.filter(
        (r) =>
          r.doctor_name.toLowerCase().includes(q) ||
          (r.doctor_reg_no && r.doctor_reg_no.toLowerCase().includes(q))
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
