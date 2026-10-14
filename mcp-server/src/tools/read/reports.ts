import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";

function getPeriodDates(period: string): { start: string; end: string } {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  if (period === "today") {
    return { start: todayStr, end: todayStr };
  } else if (period === "yesterday") {
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    const yestStr = yest.toISOString().slice(0, 10);
    return { start: yestStr, end: yestStr };
  } else if (period === "this_week") {
    const day = today.getDay();
    const diff = today.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    const monday = new Date(today.setDate(diff));
    return { start: monday.toISOString().slice(0, 10), end: todayStr };
  } else if (period === "this_month") {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: firstDay.toISOString().slice(0, 10), end: todayStr };
  } else if (period === "last_month") {
    const firstDay = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
    return { start: firstDay.toISOString().slice(0, 10), end: lastDay.toISOString().slice(0, 10) };
  }
  return { start: todayStr, end: todayStr };
}

export const salesSummaryTool: ToolDefinition = {
  name: "lamsuite_sales_summary",
  description:
    "Get sales overview and tender breakdown (Cash, UPI, Card, Credit) for a specific time period.",
  inputSchema: z.object({
    period: z
      .enum(["today", "yesterday", "this_week", "this_month", "last_month", "custom"])
      .default("today")
      .describe("Time period for the sales report"),
    start_date: z.string().optional().describe("Custom start date (YYYY-MM-DD) if period is custom"),
    end_date: z.string().optional().describe("Custom end date (YYYY-MM-DD) if period is custom"),
    counter_id: z.string().optional().describe("Optional counter ID to filter sales (e.g. C01, C02)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    let { start, end } = getPeriodDates(args.period);
    if (args.period === "custom") {
      if (!args.start_date || !args.end_date) {
        throw new Error("start_date and end_date are required when period='custom'.");
      }
      start = args.start_date;
      end = args.end_date;
    }

    const data = await client.getDailyCollection(start, end, args.counter_id);

    let summary = `### Sales Summary (${data.date_range.start_date} to ${data.date_range.end_date})${args.counter_id ? ` - Counter ${args.counter_id}` : ""}\n`;
    summary += `- **Total Invoices**: ${data.total_invoices_count}\n`;
    summary += `- **Gross Sales**: ${formatINR(data.gross_sales)}\n`;
    summary += `- **Total Returns**: ${formatINR(data.total_returns)}\n`;
    summary += `- **Net Sales**: **${formatINR(data.net_sales)}**\n`;
    summary += `- **Total Tax (GST)**: ${formatINR(data.total_tax)}\n\n`;

    summary += "#### Tender Breakdown:\n";
    for (const [tender, amt] of Object.entries(data.by_tender || {})) {
      summary += `- **${tender}**: ${formatINR(amt)}\n`;
    }

    return buildToolResponse(summary, {
      ...data,
      currency: "INR",
    });
  },
};

export const topSellingItemsTool: ToolDefinition = {
  name: "lamsuite_top_selling_items",
  description: "Get highest selling items ranked by volume and revenue.",
  inputSchema: z.object({
    period: z.enum(["today", "this_week", "this_month", "last_month"]).default("this_month"),
    limit: z.number().int().min(1).max(50).default(10).describe("Top N items (default 10)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const items = await client.getTopSellingItems(args.period, args.limit);

    let summary = `### Top ${items.length} Selling Items (${args.period}):\n\n`;
    summary += "| Item Name | Qty Sold | Total Revenue | Margin % |\n";
    summary += "| --- | --- | --- | --- |\n";
    for (const item of items) {
      summary += `| ${item.name} | ${item.qty_sold} | ${formatINR(item.revenue)} | ${item.margin_percent || 0}% |\n`;
    }

    return buildToolResponse(summary, {
      top_items: items,
      period: args.period,
      currency: "INR",
    });
  },
};

export const cashBookTool: ToolDefinition = {
  name: "lamsuite_cash_book",
  description: "Cash book ledger showing opening cash, daily cash collections, expenses, and closing balance.",
  inputSchema: z.object({
    date: z.string().optional().describe("Date (YYYY-MM-DD, defaults to today)"),
    payment_mode: z.enum(["All", "Cash", "UPI", "Card"]).default("All"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:financial",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const data = await client.getCashBook(args.date, args.payment_mode);

    let summary = `### Cash Book (${data.date})\n`;
    summary += `- **Opening Cash**: ${formatINR(data.opening_cash)}\n`;
    summary += `- **Cash Sales**: +${formatINR(data.cash_sales)}\n`;
    summary += `- **UPI / Digital Collections**: +${formatINR(data.upi_collections)}\n`;
    summary += `- **Expenses / Cash Paid Out**: -${formatINR(data.expenses)}\n`;
    summary += `- **Closing Cash on Hand**: **${formatINR(data.closing_cash)}**\n`;

    return buildToolResponse(summary, {
      cash_book: data,
      currency: "INR",
    });
  },
};

export const dailySummaryTool: ToolDefinition = {
  name: "lamsuite_daily_summary",
  description:
    "Comprehensive daily closing summary: total revenue, invoice counts, tender split, low stock warnings, and near expiry alerts.",
  inputSchema: z.object({
    date: z.string().optional().describe("Date for summary (YYYY-MM-DD, defaults to today)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const targetDate = args.date || new Date().toISOString().slice(0, 10);
    const summaryData = await client.getDailySummary(targetDate);

    let summary = `### Store Daily Closing Summary: ${targetDate}\n\n`;
    summary += `- **Total Sales Revenue**: **${formatINR(summaryData.total_sales)}**\n`;
    summary += `- **Bills Invoiced**: ${summaryData.invoice_count}\n`;
    summary += `- **Cash Collection**: ${formatINR(summaryData.cash_collection)}\n`;
    summary += `- **UPI Collection**: ${formatINR(summaryData.upi_collection)}\n`;
    summary += `- **Card Collection**: ${formatINR(summaryData.card_collection)}\n`;
    summary += `- **Credit Sales**: ${formatINR(summaryData.credit_collection)}\n\n`;
    summary += `#### Alerts & Inventory:\n`;
    summary += `- ⚠️ **Items Running Low**: ${summaryData.low_stock_count}\n`;
    summary += `- ⏳ **Batches Near Expiry (<60d)**: ${summaryData.near_expiry_count}\n`;

    return buildToolResponse(summary, {
      daily_summary: summaryData,
      date: targetDate,
      currency: "INR",
    });
  },
};

export const profitReportTool: ToolDefinition = {
  name: "lamsuite_profit_report",
  description: "Profit and margin report calculating revenue, cost of goods sold (COGS), and gross margins.",
  inputSchema: z.object({
    start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    group_by: z.enum(["invoice", "item", "category"]).default("item"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:financial",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const data = await client.getProfitReport(args.start_date, args.end_date, args.group_by);

    let summary = `### Gross Profit Report\n`;
    summary += `- **Total Revenue**: ${formatINR(data.total_revenue)}\n`;
    summary += `- **Cost of Goods Sold (COGS)**: ${formatINR(data.total_cogs)}\n`;
    summary += `- **Gross Profit**: **${formatINR(data.gross_profit)}**\n`;
    summary += `- **Gross Margin %**: **${data.gross_margin_percent}%**\n`;

    return buildToolResponse(summary, {
      profit_report: data,
      currency: "INR",
    });
  },
};
