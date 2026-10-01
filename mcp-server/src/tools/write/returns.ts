import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { idempotencyStore } from "../../utils/idempotency.js";

const ReturnItemSchema = z.object({
  product_id: z.string().describe("Product ID returned"),
  batch_no: z.string().optional().describe("Batch number"),
  qty: z.number().positive().describe("Quantity returned"),
  rate: z.number().min(0).optional().describe("Return unit rate"),
  reason: z.string().describe("Reason for return"),
});

export const createSalesReturnTool: ToolDefinition = {
  name: "lamsuite_create_sales_return",
  description:
    "Issue a sales return (Credit Note) for returned items against an existing invoice. Stock is returned to active inventory.",
  inputSchema: z.object({
    original_invoice_id: z.string().optional().describe("Original invoice ID"),
    original_invoice_number: z.string().optional().describe("Original invoice number (e.g. 'INV-1000')"),
    items: z.array(ReturnItemSchema).min(1).describe("Items returned"),
    refund_mode: z.enum(["Cash", "UPI", "Credit Note", "Store Credit"]).default("Cash"),
    dry_run: z.boolean().default(false).describe("Preview return without issuing"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "returns:create",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Sales return already recorded.`, cached);
      }
    }

    let estimatedRefund = 0;
    for (const item of args.items) {
      const prod = await client.getProduct(item.product_id);
      const rate = item.rate ?? prod.sel_rate;
      estimatedRefund += item.qty * rate;
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would issue sales return for ${args.items.length} item(s) with refund of ${formatINR(estimatedRefund)} via ${args.refund_mode}.`,
        { dry_run: true, items: args.items, estimated_refund: estimatedRefund }
      );
    }

    const res = await client.createSalesReturn({
      original_invoice_id: args.original_invoice_id,
      original_invoice_number: args.original_invoice_number,
      items: args.items,
      refund_mode: args.refund_mode,
      refund_amount: estimatedRefund,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, res);
    }

    let summary = `✅ **Sales Return Issued: \`${res.credit_note_number || "CN-OK"}\`**\n`;
    summary += `- **Refund Amount**: ${formatINR(estimatedRefund)} (${args.refund_mode})\n`;

    return buildToolResponse(summary, {
      sales_return: res,
      refund_amount: estimatedRefund,
      currency: "INR",
    });
  },
};

export const createPurchaseReturnTool: ToolDefinition = {
  name: "lamsuite_create_purchase_return",
  description:
    "Issue a purchase return (Debit Note) to supplier for damaged, expired, or rejected inward stock.",
  inputSchema: z.object({
    supplier_id: z.string().describe("Supplier ID"),
    original_purchase_number: z.string().optional().describe("Original purchase invoice number"),
    items: z.array(ReturnItemSchema).min(1).describe("Items returned to supplier"),
    dry_run: z.boolean().default(false).describe("Preview debit note without posting"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "returns:create",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Purchase return already recorded.`, cached);
      }
    }

    const supplier = await client.getSupplier(args.supplier_id);
    let totalVal = 0;
    for (const item of args.items) {
      totalVal += item.qty * (item.rate || 0);
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would issue debit note to ${supplier.name} for ${args.items.length} item(s) worth ${formatINR(totalVal)}.`,
        { dry_run: true, items: args.items, total_value: totalVal }
      );
    }

    const res = await client.createPurchaseReturn({
      supplier_id: args.supplier_id,
      original_purchase_number: args.original_purchase_number,
      items: args.items,
      total_amount: totalVal,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, res);
    }

    let summary = `✅ **Purchase Return Issued: \`${res.debit_note_number || "DN-OK"}\`**\n`;
    summary += `- **Supplier**: ${supplier.name}\n`;
    summary += `- **Debit Amount**: ${formatINR(totalVal)}\n`;

    return buildToolResponse(summary, {
      purchase_return: res,
      total_amount: totalVal,
      currency: "INR",
    });
  },
};
