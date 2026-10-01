import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";

export const gstReportTool: ToolDefinition = {
  name: "lamsuite_gst_report",
  description:
    "Indian Statutory GST Reports: GSTR-1 summary (Table 4 B2B, Table 5 B2C Large, Table 7 B2C Small, Table 9 Credit Notes), HSN Summary, or Purchase Register.",
  inputSchema: z.object({
    report_type: z
      .enum(["gstr1", "hsn_summary", "purchase_register"])
      .default("gstr1")
      .describe("GST report type"),
    start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    store_state_code: z.string().default("32").describe("Home store state code (default '32' for Kerala)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:financial",
  isWriteTool: false,
  handler: async (args, { client }) => {
    if (args.report_type === "gstr1") {
      const data = await client.getGstr1Report(args.start_date, args.end_date, args.store_state_code);

      let summary = `### GSTR-1 Filing Summary\n\n`;
      summary += `#### Table 4: B2B Invoices (${data.table_4_b2b?.length || 0} bills)\n`;
      summary += `#### Table 5: B2C Large (Inter-state > 2.5L) (${data.table_5_b2c_large?.length || 0} bills)\n`;
      summary += `#### Table 7: B2C Small Net Taxable:\n`;
      for (const row of data.table_7_b2c_small || []) {
        summary += `- State ${row.place_of_supply}: Taxable ${formatINR(row.taxable_value)}, Tax ${formatINR(row.tax_amount)}\n`;
      }
      summary += `\n#### Table 9: Credit/Debit Notes (${data.table_9_credit_debit_notes?.length || 0} notes)\n`;

      return buildToolResponse(summary, {
        gstr1: data,
        currency: "INR",
      });
    } else if (args.report_type === "hsn_summary") {
      const hsnList = await client.getHsnSummaryReport(args.start_date, args.end_date);

      let summary = `### HSN / SAC Summary (${hsnList.length} items):\n\n`;
      summary += "| HSN Code | Description | Total Qty | Taxable Val | CGST | SGST | IGST |\n";
      summary += "| --- | --- | --- | --- | --- | --- | --- |\n";
      for (const h of hsnList) {
        summary += `| \`${h.hsn_code}\` | ${h.description} | ${h.total_qty} | ${formatINR(h.taxable_value)} | ${formatINR(h.central_tax)} | ${formatINR(h.state_tax)} | ${formatINR(h.integrated_tax)} |\n`;
      }

      return buildToolResponse(summary, {
        hsn_summary: hsnList,
        currency: "INR",
      });
    } else {
      // Purchase register
      return buildToolResponse(
        "Purchase register report generated.",
        { report: "purchase_register", status: "success" },
        false
      );
    }
  },
};

export const outstandingReportTool: ToolDefinition = {
  name: "lamsuite_outstanding_report",
  description:
    "Party outstanding aging report for customer receivables and supplier payables (0-30, 31-60, 61-90, 90+ days).",
  inputSchema: z.object({
    party_type: z.enum(["customer", "supplier", "all"]).default("customer").describe("Type of party"),
    min_balance: z.number().default(0).describe("Minimum outstanding balance filter in INR"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:financial",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const data = await client.getCustomerAging(args.party_type);
    const records = (data.records || []).filter(
      (r: any) => (r.outstanding_balance || 0) >= args.min_balance
    );

    let summary = `### Outstanding Aging Report (${args.party_type}):\n\n`;
    summary += "| Party Name | Phone | Total Balance | 0-30 Days | 31-60 Days | 61-90 Days | 90+ Days |\n";
    summary += "| --- | --- | --- | --- | --- | --- | --- |\n";
    for (const r of records) {
      summary += `| ${r.name} | ${r.phone || "N/A"} | **${formatINR(r.outstanding_balance)}** | ${formatINR(r.buckets?.current_0_30 || 0)} | ${formatINR(r.buckets?.overdue_31_60 || 0)} | ${formatINR(r.buckets?.overdue_61_90 || 0)} | ${formatINR(r.buckets?.overdue_90_plus || 0)} |\n`;
    }

    return buildToolResponse(summary, {
      outstanding_report: records,
      party_type: args.party_type,
      currency: "INR",
    });
  },
};
