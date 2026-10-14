import type { EntityDefinition } from "../types";
import { reportRegistry } from "../../../../reports/registry";
import { ReportRunner } from "../../../../reports/engine/ReportRunner";
import type { ReportModule } from "../../../../reports/types";

export const reportsExportDefinition: EntityDefinition = {
  id: "reports",
  label: "Business & Statutory Reports",
  singularLabel: "Report",
  category: "reports",
  description: "Export any of the 24 statutory and management reports with user column selections and date filters.",
  targetTable: "reports",
  primaryKey: "id",
  requiredPermission: "reports:export",
  supportsRoundTrip: false,
  duplicateKeys: [],
  fields: {
    report_id: {
      key: "report_id",
      label: "Report Identifier",
      type: "select",
      required: true,
      example: "sales_register",
      description: "Target report module ID",
      options: reportRegistry.getAll().map((r: ReportModule) => ({ value: r.id, label: r.title })),
    },
    from_date: {
      key: "from_date",
      label: "Start Date (DD-MM-YYYY)",
      type: "date",
      required: false,
      example: "01-10-2026",
    },
    to_date: {
      key: "to_date",
      label: "End Date (DD-MM-YYYY)",
      type: "date",
      required: false,
      example: "31-10-2026",
    },
  },
  sampleRows: [],
  exportQuery: async (filters) => {
    const reportId = filters?.report_id || "sales_register";
    const reportMod = reportRegistry.getAll().find((r: ReportModule) => r.id === reportId);
    if (!reportMod) return [];

    const runner = new ReportRunner();
    const result = await runner.executeReport(reportMod, {
      filters: {
        dateRange: {
          from: filters?.from_date || new Date().toISOString().slice(0, 10),
          to: filters?.to_date || new Date().toISOString().slice(0, 10),
        },
      },
    });

    return result.rows;
  },
};
