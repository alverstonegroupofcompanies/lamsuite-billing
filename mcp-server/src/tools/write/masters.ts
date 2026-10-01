import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { idempotencyStore } from "../../utils/idempotency.js";

export const createCustomerTool: ToolDefinition = {
  name: "lamsuite_create_customer",
  description:
    "Register a new customer profile with phone, address, optional GSTIN (for B2B billing), and credit limit. Supports dry_run.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Customer full name"),
    phone: z.string().min(10).describe("Primary 10-digit mobile number"),
    gstin: z.string().optional().describe("Optional 15-character GSTIN for B2B tax invoicing"),
    address: z.string().optional().describe("Customer address / clinic location"),
    credit_limit: z.number().min(0).default(0).describe("Allowed credit limit in INR (default 0)"),
    dry_run: z.boolean().default(false).describe("Preview action without saving"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "customers:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Customer already created: ${cached.name}`, cached);
      }
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would register customer "${args.name}" with phone "${args.phone}" and credit limit ${formatINR(args.credit_limit)}.`,
        { dry_run: true, customer: args }
      );
    }

    const created = await client.createCustomer({
      name: args.name,
      phone: args.phone,
      gstin: args.gstin,
      address: args.address,
      credit_limit: args.credit_limit,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, created);
    }

    let summary = `✅ **Customer Registered: ${created.name}**\n`;
    summary += `- **Customer ID**: \`${created.id}\`\n`;
    summary += `- **Phone**: ${created.phone}\n`;
    if (created.gstin) summary += `- **GSTIN**: \`${created.gstin}\`\n`;
    summary += `- **Credit Limit**: ${formatINR(created.credit_limit || 0)}\n`;

    return buildToolResponse(summary, {
      customer: created,
      currency: "INR",
    });
  },
};

export const createItemTool: ToolDefinition = {
  name: "lamsuite_create_item",
  description:
    "Add a new medicine or catalog product with barcode, pricing, GST slab, and pharmacy rack/shelf storage.",
  inputSchema: z.object({
    name: z.string().min(1).describe("Commercial / Brand item name"),
    barcode: z.string().min(1).describe("Primary barcode (EAN-13, UPC, or store barcode)"),
    mrp: z.number().positive().describe("Maximum Retail Price (MRP) in INR"),
    sel_rate: z.number().positive().describe("Default POS selling rate in INR"),
    ptr: z.number().min(0).optional().describe("Price to Retailer (PTR)"),
    pts: z.number().min(0).optional().describe("Price to Stockist (PTS)"),
    gst_percent: z.number().min(0).max(28).default(12).describe("GST tax percentage (0, 5, 12, 18, 28)"),
    hsn_sac_code: z.string().default("30049099").describe("HSN/SAC Code (pharma default 30049099)"),
    units_per_pack: z.number().int().positive().default(1).describe("Tablets/units per pack (e.g. 10 or 15)"),
    generic_name: z.string().optional().describe("Pharmacological generic name"),
    rack_location: z.string().optional().describe("Rack location in pharmacy"),
    shelf_location: z.string().optional().describe("Shelf location"),
    reorder_level: z.number().int().min(0).default(10).describe("Reorder threshold"),
    dry_run: z.boolean().default(false).describe("Preview item creation without saving"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Product already created: ${cached.name}`, cached);
      }
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would create item "${args.name}" (Barcode: \`${args.barcode}\`, MRP: ${formatINR(args.mrp)}, Selling Rate: ${formatINR(args.sel_rate)}, GST: ${args.gst_percent}%).`,
        { dry_run: true, item: args }
      );
    }

    const created = await client.createProduct({
      name: args.name,
      barcode: args.barcode,
      mrp: args.mrp,
      sel_rate: args.sel_rate,
      ptr: args.ptr,
      pts: args.pts,
      gst_percent: args.gst_percent,
      hsn_sac_code: args.hsn_sac_code,
      units_per_pack: args.units_per_pack,
      generic_name: args.generic_name,
      rack_location: args.rack_location,
      shelf_location: args.shelf_location,
      reorder_level: args.reorder_level,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, created);
    }

    let summary = `✅ **Item Created: ${created.name}**\n`;
    summary += `- **Product ID**: \`${created.id}\`\n`;
    summary += `- **Barcode**: \`${created.barcode}\`\n`;
    summary += `- **MRP**: ${formatINR(created.mrp)} | **Selling Rate**: ${formatINR(created.sel_rate)}\n`;
    summary += `- **GST Rate**: ${created.gst_percent}% (HSN: \`${created.hsn_sac_code}\`)\n`;

    return buildToolResponse(summary, {
      item: created,
      currency: "INR",
    });
  },
};

export const updateItemPriceTool: ToolDefinition = {
  name: "lamsuite_update_item_price",
  description: "Update the selling price, MRP, or wholesale rates for an existing catalog item.",
  inputSchema: z.object({
    product_id: z.string().describe("Product ID to update"),
    sel_rate: z.number().positive().optional().describe("New selling rate"),
    mrp: z.number().positive().optional().describe("New MRP"),
    ptr: z.number().positive().optional().describe("New PTR"),
    dry_run: z.boolean().default(false).describe("Preview price change without saving"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:update_price",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const existing = await client.getProduct(args.product_id);

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would update prices for "${existing.name}":\n` +
          `- Selling Rate: ${formatINR(existing.sel_rate)} ➔ **${formatINR(args.sel_rate ?? existing.sel_rate)}**\n` +
          `- MRP: ${formatINR(existing.mrp)} ➔ **${formatINR(args.mrp ?? existing.mrp)}**`,
        { dry_run: true, product_id: args.product_id, updates: args }
      );
    }

    const updated = await client.updateProduct(args.product_id, {
      sel_rate: args.sel_rate ?? existing.sel_rate,
      mrp: args.mrp ?? existing.mrp,
      ptr: args.ptr ?? existing.ptr,
    });

    let summary = `✅ **Price Updated for ${updated.name}**\n`;
    summary += `- **Selling Rate**: ${formatINR(updated.sel_rate)}\n`;
    summary += `- **MRP**: ${formatINR(updated.mrp)}\n`;

    return buildToolResponse(summary, {
      item: updated,
      currency: "INR",
    });
  },
};
