import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { isDateExpired } from "../../utils/fefo.js";

export const searchItemsTool: ToolDefinition = {
  name: "lamsuite_search_items",
  description:
    "Search catalog items in LamSuite store by name, barcode, generic name, or category. Returns compact summaries with pagination.",
  inputSchema: z.object({
    query: z.string().optional().describe("Search term matching item name, barcode, or generic name"),
    category_id: z.string().optional().describe("Filter by category ID"),
    brand_id: z.string().optional().describe("Filter by brand ID"),
    is_active: z.boolean().default(true).describe("Filter by active status (default true)"),
    limit: z.number().int().min(1).max(100).default(20).describe("Number of items to return (default 20, max 100)"),
    cursor: z.string().optional().describe("Pagination cursor or page number"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const page = args.cursor ? parseInt(args.cursor, 10) : 1;
    const res = await client.getProducts({
      query: args.query,
      category_id: args.category_id,
      brand_id: args.brand_id,
      is_active: args.is_active,
      page: isNaN(page) ? 1 : page,
      limit: args.limit,
    });

    const items = res.data || [];
    let summary = `Found ${items.length} item(s)`;
    if (args.query) summary += ` matching "${args.query}"`;
    summary += ":\n\n";

    if (items.length === 0) {
      summary += "No matching catalog items found.";
    } else {
      summary += "| Barcode | Item Name | MRP | Selling Rate | GST% | Current Stock |\n";
      summary += "| --- | --- | --- | --- | --- | --- |\n";
      for (const item of items) {
        summary += `| \`${item.barcode}\` | ${item.name} | ${formatINR(item.mrp)} | ${formatINR(item.sel_rate)} | ${item.gst_percent}% | ${item.current_stock ?? 0} |\n`;
      }
    }

    return buildToolResponse(summary, {
      items,
      count: items.length,
      total: res.total,
      currency: "INR",
    });
  },
};

export const getItemTool: ToolDefinition = {
  name: "lamsuite_get_item",
  description:
    "Get full details of a specific catalog product by its ID or barcode, including batch inventory, tax classification, and rates.",
  inputSchema: z.object({
    id: z.string().optional().describe("Internal product ID"),
    barcode: z.string().optional().describe("Product barcode (13-digit EAN/UPC or alphanumeric)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const identifier = args.id || args.barcode;
    if (!identifier) {
      throw new Error("Either 'id' or 'barcode' must be provided to get an item.");
    }

    const item = await client.getProduct(identifier);
    const batches = item.batches || [];

    let summary = `### ${item.name}\n`;
    summary += `- **Barcode**: \`${item.barcode}\`\n`;
    summary += `- **Generic Name**: ${item.generic_name || "N/A"}\n`;
    summary += `- **HSN Code**: ${item.hsn_sac_code || "3004"}\n`;
    summary += `- **GST Rate**: ${item.gst_percent}%\n`;
    summary += `- **MRP**: ${formatINR(item.mrp)} | **Selling Rate**: ${formatINR(item.sel_rate)}\n`;
    if (item.ptr) summary += `- **PTR**: ${formatINR(item.ptr)} | **PTS**: ${formatINR(item.pts || 0)}\n`;
    summary += `- **Current Stock**: ${item.current_stock ?? 0} (Reorder Level: ${item.reorder_level ?? 10})\n`;
    summary += `- **Location**: ${item.rack_location || "RACK-1"} / ${item.shelf_location || "SHELF-1"}\n\n`;

    summary += `#### Batches (${batches.length}):\n`;
    if (batches.length === 0) {
      summary += "No batches currently registered.\n";
    } else {
      summary += "| Batch No | Expiry Date | Stock | MRP | Status |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const b of batches) {
        const isExp = isDateExpired(b.expiry_date);
        const status = isExp ? "❌ Expired" : b.stock_qty <= 0 ? "⚠️ Out of Stock" : "✅ Available";
        summary += `| \`${b.batch_no}\` | ${b.expiry_date} | ${b.stock_qty} | ${formatINR(b.mrp ?? item.mrp)} | ${status} |\n`;
      }
    }

    return buildToolResponse(summary, {
      item,
      batches,
      currency: "INR",
    });
  },
};

export const lowStockTool: ToolDefinition = {
  name: "lamsuite_low_stock",
  description:
    "List products where current stock is at or below the reorder threshold. Use to prepare reorder purchase orders.",
  inputSchema: z.object({
    threshold: z.number().int().optional().describe("Custom stock threshold override. If omitted, uses each product's reorder level."),
    limit: z.number().int().min(1).max(100).default(20).describe("Max items to return (default 20)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const products = await client.getLowStock(args.threshold);
    const sliced = products.slice(0, args.limit);

    let summary = `### Low Stock Alert (${sliced.length} items):\n\n`;
    if (sliced.length === 0) {
      summary += "All stock levels are above reorder thresholds.";
    } else {
      summary += "| Product Name | Barcode | Current Stock | Reorder Level | Shortage |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const p of sliced) {
        const current = p.current_stock ?? 0;
        const reorder = p.reorder_level ?? 10;
        const shortage = Math.max(0, reorder - current);
        summary += `| ${p.name} | \`${p.barcode}\` | ${current} | ${reorder} | **-${shortage}** |\n`;
      }
    }

    return buildToolResponse(summary, {
      low_stock_items: sliced,
      total_count: products.length,
      threshold: args.threshold,
    });
  },
};

export const nearExpiryTool: ToolDefinition = {
  name: "lamsuite_near_expiry",
  description:
    "List medicine batches expiring within a specified number of days (default 60 days). Essential for pharmacy expiry audits.",
  inputSchema: z.object({
    threshold_days: z.number().int().min(1).max(365).default(60).describe("Days until expiration (default 60 days)"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max batches to return (default 20)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const batches = await client.getNearExpiry(args.threshold_days);
    const sliced = batches.slice(0, args.limit);

    let summary = `### Near Expiry Batches (< ${args.threshold_days} days):\n\n`;
    if (sliced.length === 0) {
      summary += `No batches found expiring within the next ${args.threshold_days} days.`;
    } else {
      summary += "| Batch No | Product | Expiry Date | Stock | MRP |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const b of sliced) {
        summary += `| \`${b.batch_no}\` | ${(b as any).product_name || b.product_id} | ${b.expiry_date} | ${b.stock_qty} | ${formatINR(b.mrp)} |\n`;
      }
    }

    return buildToolResponse(summary, {
      near_expiry_batches: sliced,
      threshold_days: args.threshold_days,
      currency: "INR",
    });
  },
};

export const expiredStockTool: ToolDefinition = {
  name: "lamsuite_expired_stock",
  description:
    "List all expired batches with remaining inventory. Use for expired stock return or write-off adjustment.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(20).describe("Max batches to return (default 20)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const batches = await client.getExpiredStock();
    const sliced = batches.slice(0, args.limit);

    let summary = `### Expired Stock Report (${sliced.length} batches):\n\n`;
    if (sliced.length === 0) {
      summary += "No expired batches with remaining stock found.";
    } else {
      summary += "| Batch No | Product | Expiry Date | Stock | Loss Value (MRP) |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const b of sliced) {
        const val = (b.stock_qty || 0) * (b.mrp || 0);
        summary += `| \`${b.batch_no}\` | ${(b as any).product_name || b.product_id} | ❌ ${b.expiry_date} | ${b.stock_qty} | ${formatINR(val)} |\n`;
      }
    }

    return buildToolResponse(summary, {
      expired_batches: sliced,
      total_count: batches.length,
      currency: "INR",
    });
  },
};
