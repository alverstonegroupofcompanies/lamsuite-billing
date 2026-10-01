import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";

export const searchInvoicesTool: ToolDefinition = {
  name: "lamsuite_search_invoices",
  description:
    "Search sales invoices by date range, customer, tender payment mode, or status (issued, cancelled).",
  inputSchema: z.object({
    query: z.string().optional().describe("Invoice number or customer search query"),
    start_date: z.string().optional().describe("Filter start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("Filter end date (YYYY-MM-DD)"),
    payment_mode: z.enum(["Cash", "UPI", "Card", "Credit", "Split", "All"]).optional().describe("Filter by payment tender"),
    customer_id: z.string().optional().describe("Filter by customer ID"),
    status: z.enum(["issued", "cancelled", "all"]).default("issued").describe("Invoice status filter (default issued)"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results (default 20)"),
    cursor: z.string().optional().describe("Pagination page or cursor"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "invoices:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const page = args.cursor ? parseInt(args.cursor, 10) : 1;
    const res = await client.getInvoices({
      query: args.query,
      start_date: args.start_date,
      end_date: args.end_date,
      payment_mode: args.payment_mode === "All" ? undefined : args.payment_mode,
      customer_id: args.customer_id,
      status: args.status,
      page: isNaN(page) ? 1 : page,
      limit: args.limit,
    });

    const invoices = res.data || [];
    let summary = `### Invoices (${invoices.length} found):\n\n`;

    if (invoices.length === 0) {
      summary += "No invoices matched the search criteria.";
    } else {
      summary += "| Inv Number | Date | Customer | Mode | Grand Total | Status |\n";
      summary += "| --- | --- | --- | --- | --- | --- |\n";
      for (const inv of invoices) {
        const statusEmoji = inv.status === "cancelled" ? "❌ Cancelled" : "✅ Issued";
        summary += `| \`${inv.invoice_number}\` | ${inv.invoice_date} | ${inv.customer_name} | ${inv.payment_mode} | ${formatINR(inv.grand_total)} | ${statusEmoji} |\n`;
      }
    }

    return buildToolResponse(summary, {
      invoices,
      count: invoices.length,
      total: res.total,
      currency: "INR",
    });
  },
};

export const getInvoiceTool: ToolDefinition = {
  name: "lamsuite_get_invoice",
  description:
    "Retrieve complete invoice details including line items, batch numbers, tax breakdown, and payment details.",
  inputSchema: z.object({
    invoice_id: z.string().optional().describe("Invoice ID"),
    invoice_number: z.string().optional().describe("Invoice document number (e.g. 'INV-1000')"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "invoices:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const idOrNo = args.invoice_id || args.invoice_number;
    if (!idOrNo) {
      throw new Error("Either 'invoice_id' or 'invoice_number' must be specified.");
    }

    const inv = await client.getInvoice(idOrNo);
    const items = inv.items || [];

    let summary = `### Invoice: ${inv.invoice_number}\n`;
    summary += `- **Date**: ${inv.invoice_date}\n`;
    summary += `- **Customer**: ${inv.customer_name}\n`;
    summary += `- **Payment Mode**: ${inv.payment_mode}\n`;
    summary += `- **Status**: ${inv.status.toUpperCase()}`;
    if (inv.cancellation_reason) {
      summary += ` (Reason: ${inv.cancellation_reason})`;
    }
    summary += "\n\n";

    summary += "#### Line Items:\n";
    summary += "| Item | Batch | Qty | Rate | GST% | Total |\n";
    summary += "| --- | --- | --- | --- | --- | --- |\n";
    for (const line of items) {
      summary += `| ${line.product_name || line.product_id} | \`${line.batch_no || "N/A"}\` | ${line.qty} | ${formatINR(line.unit_price)} | ${line.gst_percent}% | ${formatINR(line.total_amount)} |\n`;
    }
    summary += "\n";

    summary += `- **Subtotal (Taxable)**: ${formatINR(inv.subtotal)}\n`;
    if (inv.discount_total) summary += `- **Discount**: -${formatINR(inv.discount_total)}\n`;
    summary += `- **GST Total**: ${formatINR(inv.tax_total)} (CGST: ${formatINR(inv.cgst_total || 0)}, SGST: ${formatINR(inv.sgst_total || 0)}, IGST: ${formatINR(inv.igst_total || 0)})\n`;
    if (inv.round_off) summary += `- **Round Off**: ${formatINR(inv.round_off)}\n`;
    summary += `- **Grand Total**: **${formatINR(inv.grand_total)}**\n`;

    return buildToolResponse(summary, {
      invoice: inv,
      currency: "INR",
    });
  },
};

export const searchPurchasesTool: ToolDefinition = {
  name: "lamsuite_search_purchases",
  description: "Search supplier purchase documents and inward stock bills.",
  inputSchema: z.object({
    query: z.string().optional().describe("Purchase bill number or supplier query"),
    supplier_id: z.string().optional().describe("Supplier ID filter"),
    start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results (default 20)"),
    cursor: z.string().optional().describe("Pagination cursor"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "purchases:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const page = args.cursor ? parseInt(args.cursor, 10) : 1;
    const res = await client.getPurchases({
      query: args.query,
      supplier_id: args.supplier_id,
      start_date: args.start_date,
      end_date: args.end_date,
      page: isNaN(page) ? 1 : page,
      limit: args.limit,
    });

    const purchases = res.data || [];
    let summary = `### Purchase Bills (${purchases.length} found):\n\n`;

    if (purchases.length === 0) {
      summary += "No purchase bills found.";
    } else {
      summary += "| Bill Number | Date | Supplier | Grand Total | Status |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const p of purchases) {
        summary += `| \`${p.purchase_number}\` | ${p.purchase_date} | ${p.supplier_name || p.supplier_id} | ${formatINR(p.grand_total)} | ${p.status || "Received"} |\n`;
      }
    }

    return buildToolResponse(summary, {
      purchases,
      count: purchases.length,
      currency: "INR",
    });
  },
};

export const getPurchaseTool: ToolDefinition = {
  name: "lamsuite_get_purchase",
  description: "Get detailed purchase bill with inward batches, purchase rates, and GST.",
  inputSchema: z.object({
    purchase_id: z.string().optional().describe("Purchase ID"),
    purchase_number: z.string().optional().describe("Purchase document number"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "purchases:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const idOrNo = args.purchase_id || args.purchase_number;
    if (!idOrNo) {
      throw new Error("Either 'purchase_id' or 'purchase_number' must be specified.");
    }

    const p = await client.getPurchase(idOrNo);
    let summary = `### Purchase Bill: ${p.purchase_number}\n`;
    summary += `- **Date**: ${p.purchase_date}\n`;
    summary += `- **Supplier**: ${p.supplier_name || p.supplier_id}\n`;
    summary += `- **Grand Total**: ${formatINR(p.grand_total)}\n\n`;

    summary += "#### Received Items:\n";
    summary += "| Product ID | Batch | Expiry | Qty | Rate | MRP | GST% |\n";
    summary += "| --- | --- | --- | --- | --- | --- | --- |\n";
    for (const line of p.items || []) {
      summary += `| ${line.product_id} | \`${line.batch_no}\` | ${line.expiry_date} | ${line.qty} | ${formatINR(line.purchase_rate)} | ${formatINR(line.mrp)} | ${line.gst_percent}% |\n`;
    }

    return buildToolResponse(summary, {
      purchase: p,
      currency: "INR",
    });
  },
};

export const listReturnsTool: ToolDefinition = {
  name: "lamsuite_list_returns",
  description: "List sales returns (credit notes) or purchase returns (debit notes) with refund amounts.",
  inputSchema: z.object({
    type: z.enum(["sales_return", "purchase_return"]).default("sales_return").describe("Return document type"),
    start_date: z.string().optional().describe("Filter start date"),
    end_date: z.string().optional().describe("Filter end date"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results (default 20)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "returns:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await client.getReturns(args);
    const returns = res.data || [];

    let summary = `### Returns (${args.type === "sales_return" ? "Credit Notes" : "Debit Notes"}):\n\n`;
    if (returns.length === 0) {
      summary += `No ${args.type} documents found for the given criteria.`;
    } else {
      summary += "| Doc No | Date | Party | Amount | Reason |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const r of returns) {
        summary += `| \`${r.number}\` | ${r.date} | ${r.party_name} | ${formatINR(r.amount)} | ${r.reason || "N/A"} |\n`;
      }
    }

    return buildToolResponse(summary, {
      returns,
      type: args.type,
      currency: "INR",
    });
  },
};
