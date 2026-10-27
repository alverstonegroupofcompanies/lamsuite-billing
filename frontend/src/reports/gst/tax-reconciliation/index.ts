import type { ReportModule, ReportColumn, ReportFilterDef } from "../../types";
import { taxReconciliationService, type TaxAnomaly } from "../../../lib/tax-engine/taxReconciliationService";

export const taxReconciliationColumns: ReportColumn<TaxAnomaly>[] = [
  {
    id: "invoice_number",
    header: "Invoice / Doc No",
    accessor: (r) => r.invoice_number,
    align: "left",
    width: 140,
    isDefaultVisible: true,
    canHide: false,
    canSort: true,
  },
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
    id: "anomaly_type",
    header: "Anomaly Type",
    accessor: (r) => r.anomaly_type,
    align: "left",
    width: 180,
    isDefaultVisible: true,
    canSort: true,
  },
  {
    id: "severity",
    header: "Severity",
    accessor: (r) => r.severity.toUpperCase(),
    align: "center",
    width: 90,
    format: "badge",
    badgeStyle: (val) => (val === "ERROR" ? "danger" : "warning"),
    isDefaultVisible: true,
  },
  {
    id: "description",
    header: "Audit Finding",
    accessor: (r) => r.description,
    align: "left",
    width: 320,
    isDefaultVisible: true,
  },
  {
    id: "expected",
    header: "Statutory / Expected",
    accessor: (r) => (r.expected !== undefined ? String(r.expected) : "—"),
    align: "left",
    width: 140,
    isDefaultVisible: true,
  },
  {
    id: "actual",
    header: "Actual Recorded",
    accessor: (r) => (r.actual !== undefined ? String(r.actual) : "—"),
    align: "left",
    width: 140,
    isDefaultVisible: true,
  },
];

const today = new Date().toISOString().slice(0, 10);
const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  .toISOString()
  .slice(0, 10);

export const taxReconciliationFilters: ReportFilterDef[] = [
  {
    id: "date_range",
    label: "Audit Period",
    type: "date-range",
    defaultValue: {
      startDate: startOfMonth,
      endDate: today,
    },
    required: true,
  },
];

export const taxReconciliationReport: ReportModule<
  { date_range?: { startDate: string; endDate: string }; startDate?: string; endDate?: string },
  TaxAnomaly
> = {
  id: "tax-reconciliation",
  title: "Tax Reconciliation & Diagnostic Audit",
  description: "Automated GST audit verifying place-of-supply, Luhn Mod-36 GSTIN checksums, HSN rates, and paise tie-outs",
  category: "gst",
  permission: "reports:view",
  menuVisibilityKey: "reports",
  keywords: ["gst audit", "reconciliation", "tax check", "gstin checksum", "luhn", "discrepancy", "tax diagnostic"],
  defaultSort: { column: "invoice_date", direction: "desc" },
  supportedPrintLayouts: ["a4"],
  exportFormats: ["csv", "excel", "pdf"],
  filters: taxReconciliationFilters,
  columns: taxReconciliationColumns,
  runQuery: async (params) => {
    const dates = params.filters.startDate && params.filters.endDate
      ? { startDate: params.filters.startDate, endDate: params.filters.endDate }
      : (params.filters as any).date_range || { startDate: startOfMonth, endDate: today };

    const startDateStr = String(dates.startDate || "").trim().slice(0, 10);
    const endDateStr = String(dates.endDate || "").trim().slice(0, 10);

    const report = await taxReconciliationService.runAudit(startDateStr, endDateStr);

    let rows = [...report.anomalies];

    // Optional Search Filtering
    if (params.searchQuery) {
      const q = params.searchQuery.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.invoice_number.toLowerCase().includes(q) ||
          r.anomaly_type.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q)
      );
    }

    return {
      rows,
      totalCount: rows.length,
      summary: {
        total_audited: report.total_invoices_audited,
        clean_invoices: report.clean_invoices_count,
        anomalies_count: report.anomalies_count,
        total_taxable: report.financial_summary.total_taxable,
        total_cgst: report.financial_summary.total_cgst,
        total_sgst: report.financial_summary.total_sgst,
        total_igst: report.financial_summary.total_igst,
        total_cess: report.financial_summary.total_cess,
        total_tax: report.financial_summary.total_tax,
        total_grand: report.financial_summary.total_grand,
      },
    };
  },
};
