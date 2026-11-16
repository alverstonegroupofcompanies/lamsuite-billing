import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";

const storeIdField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Store ID. Sent as the X-Store-Id header; defaults to the configured store");

export const getAdminDashboardTool: ToolDefinition = {
  name: "lamsuite_admin_dashboard",
  description:
    "Admin dashboard snapshot: today/week/month sales and purchases, receivables, low-stock and near-expiry alerts, and sync health. Includes the store timezone used to compute 'today'.",
  inputSchema: z.object({
    store_id: storeIdField,
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const data = await client.getAdminDashboard(args.store_id);
    const sales = data.sales || {};
    const purchases = data.purchases || {};
    const alerts = data.alerts || {};
    const receivables = data.receivables || {};

    let summary = `### Admin Dashboard\n`;
    summary += `- **Store Timezone**: ${data.timezone || "—"} (all day boundaries use this timezone)\n\n`;

    summary += `#### Sales\n`;
    summary += `| Period | Amount | Invoices |\n`;
    summary += `| --- | --- | --- |\n`;
    for (const period of ["today", "week", "month"]) {
      const bucket = sales[period] || {};
      summary += `| ${period} | ${formatINR(bucket.amount)} | ${bucket.count ?? 0} |\n`;
    }

    summary += `\n#### Purchases\n`;
    for (const period of ["today", "week", "month"]) {
      summary += `- **${period}**: ${formatINR(purchases[period])}\n`;
    }

    summary += `\n#### Balances & Alerts\n`;
    summary += `- **Outstanding Receivables**: ${formatINR(receivables.total_outstanding)}\n`;
    summary += `- **Low Stock Items**: ${alerts.low_stock_count ?? 0}\n`;
    summary += `- **Near Expiry Batches (<60d)**: ${alerts.near_expiry_count ?? 0}\n`;

    if (data.sync_health) {
      const sync = data.sync_health;
      summary += `\n#### Sync Health\n`;
      summary += `- **Status**: ${sync.status ?? "—"}\n`;
      summary += `- **Stores Online**: ${sync.stores_online ?? "—"} / ${sync.total_active_stores ?? "—"}\n`;
      summary += `- **Pending Queue**: ${sync.pending_queue ?? 0}\n`;
      summary += `- **Failed Syncs**: ${sync.failed_syncs ?? 0}\n`;
      summary += `- **Conflicts**: ${sync.conflicts_count ?? 0}\n`;
      summary += `- **Last Sync**: ${sync.last_sync_at ?? "—"}\n`;
    }

    return buildToolResponse(summary, data);
  },
};

export const getDashboardMetricsTool: ToolDefinition = {
  name: "lamsuite_dashboard_metrics",
  description:
    "Revenue dashboard metrics for a date range: gross/net sales, returns, average ticket, tender split, and GST slab-wise taxable value/tax. Returns the store timezone that governs default dates.",
  inputSchema: z.object({
    start_date: z
      .string()
      .optional()
      .describe("Start date (YYYY-MM-DD). Defaults to the store-local today"),
    end_date: z
      .string()
      .optional()
      .describe("End date (YYYY-MM-DD). Defaults to the store-local today"),
    store_id: storeIdField,
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const data = await client.getDashboardMetrics({
      start_date: args.start_date,
      end_date: args.end_date,
      storeId: args.store_id,
    });

    const range = data.date_range || {};
    const payments = data.payments || {};
    const gst = data.gst || {};

    let summary = `### Dashboard Metrics (${range.start_date ?? "—"} to ${range.end_date ?? "—"})\n`;
    summary += `- **Store Timezone**: ${data.timezone || "—"}\n`;
    summary += `- **Gross Sales**: ${formatINR(data.gross_sales)}\n`;
    summary += `- **Total Returns**: ${formatINR(data.total_returns)}\n`;
    summary += `- **Net Sales**: **${formatINR(data.net_sales)}**\n`;
    summary += `- **Bills**: ${data.bills_count ?? 0} | **Average Ticket**: ${formatINR(data.average_ticket)}\n\n`;

    summary += `#### Tender Split\n`;
    summary += `- **Cash**: ${formatINR(payments.cash)}\n`;
    summary += `- **UPI**: ${formatINR(payments.upi)}\n`;
    summary += `- **Card**: ${formatINR(payments.card)}\n`;
    summary += `- **Bank Transfer**: ${formatINR(payments.bank_transfer)}\n`;
    summary += `- **Credit**: ${formatINR(payments.credit)}\n`;
    summary += `- **Digital Share**: ${payments.digital_percent ?? 0}%\n\n`;

    summary += `#### GST Slabs\n`;
    summary += `| Rate | Taxable Value | CGST | SGST | IGST | Total Tax |\n`;
    summary += `|---|---|---|---|---|---|\n`;
    for (const slab of gst.slabs || []) {
      summary += `| ${slab.rate}% | ${formatINR(slab.taxable_value)} | ${formatINR(slab.cgst_amount)} | ${formatINR(slab.sgst_amount)} | ${formatINR(slab.igst_amount)} | ${formatINR(slab.total_tax)} |\n`;
    }
    summary += `\n- **Total Taxable**: ${formatINR(gst.total_taxable)}\n`;
    summary += `- **Total Tax Accrued**: ${formatINR(gst.total_tax_accrued)}\n`;

    return buildToolResponse(summary, data);
  },
};
