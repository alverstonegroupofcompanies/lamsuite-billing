import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { idempotencyStore } from "../../utils/idempotency.js";

const InwardBatchSchema = z.object({
  product_id: z.string().describe("Product ID received"),
  batch_no: z.string().describe("Manufacturer batch number"),
  mfg_date: z.string().optional().describe("Manufacturing date (YYYY-MM-DD)"),
  expiry_date: z.string().describe("Expiry date (YYYY-MM-DD)"),
  qty: z.number().positive().describe("Quantity received"),
  purchase_rate: z.number().positive().describe("Inward purchase rate per unit"),
  mrp: z.number().positive().describe("MRP printed on batch"),
  gst_percent: z.number().min(0).max(28).default(12).describe("GST tax slab"),
});

export const createPurchaseTool: ToolDefinition = {
  name: "lamsuite_create_purchase",
  description:
    "Record an inward purchase bill from a supplier, adding new batch inventory with expiry dates and purchase rates.",
  inputSchema: z.object({
    supplier_id: z.string().describe("Supplier ID"),
    purchase_number: z.string().describe("Supplier invoice/bill number"),
    purchase_date: z.string().default(() => new Date().toISOString().slice(0, 10)).describe("Date of purchase bill"),
    items: z.array(InwardBatchSchema).min(1).describe("Batches received"),
    payment_terms: z.string().optional().describe("Credit terms or payment remarks"),
    dry_run: z.boolean().default(false).describe("Preview inward stock impact without saving"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "purchases:create",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Purchase bill already recorded: ${cached.purchase_number}`, cached);
      }
    }

    const supplier = await client.getSupplier(args.supplier_id);
    let grandTotal = 0;
    for (const item of args.items) {
      const lineCost = item.qty * item.purchase_rate;
      const tax = (lineCost * item.gst_percent) / 100;
      grandTotal += lineCost + tax;
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would record purchase bill \`${args.purchase_number}\` from ${supplier.name} with ${args.items.length} batch(es) totaling ${formatINR(grandTotal)}.`,
        {
          dry_run: true,
          supplier: supplier.name,
          purchase_number: args.purchase_number,
          items: args.items,
          grand_total: grandTotal,
        }
      );
    }

    const created = await client.createPurchase({
      supplier_id: args.supplier_id,
      purchase_number: args.purchase_number,
      purchase_date: args.purchase_date,
      grand_total: grandTotal,
      items: args.items,
      payment_terms: args.payment_terms,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, created);
    }

    let summary = `✅ **Purchase Bill Recorded: \`${created.purchase_number}\`**\n`;
    summary += `- **Supplier**: ${supplier.name}\n`;
    summary += `- **Grand Total**: ${formatINR(grandTotal)}\n`;
    summary += `- **Inward Batches**: ${args.items.length} batch(es) added to stock.\n`;

    return buildToolResponse(summary, {
      purchase: created,
      grand_total: grandTotal,
      currency: "INR",
    });
  },
};
