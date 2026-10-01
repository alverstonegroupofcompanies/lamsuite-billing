import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";

export const stockLedgerTool: ToolDefinition = {
  name: "lamsuite_stock_ledger",
  description:
    "Audit trail of inventory movements (sales issues, inward purchases, adjustments, and returns).",
  inputSchema: z.object({
    product_id: z.string().optional().describe("Product ID filter"),
    batch_id: z.string().optional().describe("Batch ID filter"),
    start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
    end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max records (default 20)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const list = await client.getStockLedger(
      args.product_id,
      args.batch_id,
      args.start_date,
      args.end_date,
      args.limit
    );

    let summary = `### Stock Movement Ledger (${list.length} transactions):\n\n`;
    summary += "| Date | Product | Batch | Type | Delta Qty | Balance | Ref |\n";
    summary += "| --- | --- | --- | --- | --- | --- | --- |\n";
    for (const tx of list) {
      const deltaSign = tx.qty > 0 ? `+${tx.qty}` : String(tx.qty);
      summary += `| ${tx.date.slice(0, 10)} | ${tx.product_name} | \`${tx.batch_no || "N/A"}\` | ${tx.type} | ${deltaSign} | ${tx.balance} | \`${tx.reference || ""}\` |\n`;
    }

    return buildToolResponse(summary, {
      ledger: list,
    });
  },
};

export const stockBalanceTool: ToolDefinition = {
  name: "lamsuite_stock_balance",
  description: "Current on-hand stock balances across items with inventory valuation at cost and MRP.",
  inputSchema: z.object({
    query: z.string().optional().describe("Search item name or barcode"),
    category_id: z.string().optional().describe("Category ID filter"),
    location: z.string().optional().describe("Rack or shelf location filter"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max records (default 20)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const items = await client.getStockBalance(
      args.query,
      args.category_id,
      args.location,
      args.limit
    );

    const totalValuation = items.reduce(
      (sum: number, i: any) => sum + (i.stock_value_selling || 0),
      0
    );

    let summary = `### Stock Balance & Valuation\n`;
    summary += `- **Total Inventory Valuation (Selling Price)**: **${formatINR(totalValuation)}**\n\n`;
    summary += "| Item Name | On Hand | Sel Rate | MRP | Stock Value |\n";
    summary += "| --- | --- | --- | --- | --- |\n";
    for (const i of items) {
      summary += `| ${i.name} | ${i.current_stock} | ${formatINR(i.sel_rate)} | ${formatINR(i.mrp)} | ${formatINR(i.stock_value_selling)} |\n`;
    }

    return buildToolResponse(summary, {
      stock_balance: items,
      total_valuation: totalValuation,
      currency: "INR",
    });
  },
};
