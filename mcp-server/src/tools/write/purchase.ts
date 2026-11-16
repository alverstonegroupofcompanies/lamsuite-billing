import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { idempotencyStore } from "../../utils/idempotency.js";
import { calculateDocumentTaxes } from "../../utils/taxEngine.js";

const InwardBatchSchema = z.object({
  product_id: z.string().optional().describe("Product ID received (used to resolve name, HSN, MRP and pack size when omitted)"),
  product_name: z.string().optional().describe("Product name printed on the supplier bill"),
  hsn_code: z.string().optional().describe("HSN/SAC code (4, 6 or 8 digits)"),
  batch_no: z.string().optional().describe("Manufacturer batch number. Required only when the store enforces batch tracking (pharmacy)"),
  mfg_date: z.string().optional().describe("Manufacturing date (YYYY-MM-DD)"),
  expiry_date: z.string().optional().describe("Expiry date (YYYY-MM-DD). Required only when the store enforces batch tracking"),
  qty: z.number().positive().describe("Billed packs received"),
  loose_qty: z.number().min(0).default(0).describe("Billed loose units"),
  free_qty: z.number().min(0).default(0).describe("Free packs received"),
  free_loose_qty: z.number().min(0).default(0).describe("Free loose units received"),
  units_per_pack: z.number().int().positive().optional().describe("Units per pack. Defaults to the product master value"),
  purchase_rate: z.number().min(0).describe("Purchase rate per pack (tax-exclusive)"),
  mrp: z.number().min(0).optional().describe("MRP printed on the batch. Defaults to the product master value"),
  ptr: z.number().min(0).optional().describe("Price to retailer. Defaults to purchase_rate"),
  pts: z.number().min(0).optional().describe("Price to stockist"),
  ptss: z.number().min(0).optional().describe("Price to sub-stockist"),
  selling_rate: z.number().min(0).optional().describe("Updated selling rate for the product master"),
  discount_type: z.enum(["percent", "amount"]).default("percent").describe("Line discount interpretation"),
  discount_percent: z.number().min(0).max(100).default(0).describe("Line discount percentage (when discount_type=percent)"),
  discount_amount: z.number().min(0).default(0).describe("Line discount flat amount (when discount_type=amount)"),
  gst_percent: z.number().min(0).max(28).default(12).describe("GST tax slab"),
  cess_percent: z.number().min(0).default(0).describe("Compensation cess percentage"),
});

const PurchaseItemResultSchema = InwardBatchSchema.extend({
  resolved_product_name: z.string(),
  resolved_units_per_pack: z.number(),
});

export const createPurchaseTool: ToolDefinition = {
  name: "lamsuite_create_purchase",
  description:
    "Record an inward purchase bill from a supplier. Supports statutory bill discount (percent or flat), freight charges, round-off, per-line percent/flat discounts, free packs and free loose units, and optional batch/expiry for non-pharmacy stores.",
  inputSchema: z.object({
    supplier_id: z.string().describe("Supplier ID"),
    purchase_number: z.string().describe("Supplier invoice/bill number"),
    purchase_date: z.string().default(() => new Date().toISOString().slice(0, 10)).describe("Date of purchase bill"),
    is_interstate: z.boolean().default(false).describe("True when the supplier is in another state (IGST)"),
    freight_charges: z.number().min(0).default(0).describe("Freight/other charges added after tax"),
    bill_discount_type: z.enum(["percent", "amount"]).default("amount").describe("Bill-level discount interpretation"),
    bill_discount: z.number().min(0).default(0).describe("Bill-level discount value (percent or amount per bill_discount_type)"),
    round_off: z.number().optional().describe("Manual round-off amount. Omit for automatic rounding to the nearest rupee"),
    items: z.array(InwardBatchSchema).min(1).describe("Batches/lines received"),
    payment_terms: z.string().optional().describe("Credit terms or payment remarks"),
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Target store ID. Sent as the X-Store-Id header; defaults to the configured store"),
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
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Purchase bill already recorded: ${cached.invoice_number || cached.purchase_number}`, cached);
      }
    }

    const supplier = await client.getSupplier(args.supplier_id);

    const resolved: z.infer<typeof PurchaseItemResultSchema>[] = [];
    for (const item of args.items) {
      let product: Awaited<ReturnType<typeof client.getProduct>> | undefined;
      if (item.product_id) {
        try {
          product = await client.getProduct(item.product_id);
        } catch {
          product = undefined;
        }
      }
      resolved.push({
        ...item,
        resolved_product_name: item.product_name || product?.name || `Item ${item.product_id || ""}`.trim(),
        resolved_units_per_pack: item.units_per_pack || product?.units_per_pack || 1,
        hsn_code: item.hsn_code || product?.hsn_sac_code,
        mrp: item.mrp ?? product?.mrp,
        ptr: item.ptr ?? product?.ptr ?? item.purchase_rate,
        pts: item.pts ?? product?.pts,
      });
    }

    const storeProfile = await client.getStore();
    const storeState = storeProfile.state_code || "32";
    const placeOfSupply = args.is_interstate ? "XX" : storeState;

    const taxResult = calculateDocumentTaxes({
      store_state: storeState,
      place_of_supply: placeOfSupply,
      default_tax_mode: "exclusive",
      lines: resolved.map((item, idx) => ({
        line_id: String(idx + 1),
        product_id: item.product_id,
        product_name: item.resolved_product_name,
        hsn_code: item.hsn_code,
        qty: item.qty,
        loose_qty: item.loose_qty,
        free_qty: item.free_qty,
        free_loose_qty: item.free_loose_qty,
        units_per_pack: item.resolved_units_per_pack,
        unit_price: item.purchase_rate,
        mrp: item.mrp,
        rate_basis: "ptr",
        discount_percent: item.discount_type === "percent" ? item.discount_percent : 0,
        discount_amount: item.discount_type === "amount" ? item.discount_amount : 0,
        gst_percent: item.gst_percent,
        cess_percent: item.cess_percent,
        is_tax_inclusive: false,
      })),
      bill_discount: { type: args.bill_discount_type, value: args.bill_discount },
      auto_round_off: false,
    });

    const netBeforeRound = Math.round((taxResult.net_before_round + args.freight_charges) * 100) / 100;
    const roundOff =
      args.round_off !== undefined && args.round_off !== null
        ? Math.round(args.round_off * 100) / 100
        : Math.round((Math.round(netBeforeRound) - netBeforeRound) * 100) / 100;
    const grandTotal = Math.max(0, Math.round((netBeforeRound + roundOff) * 100) / 100);

    const payloadLines = resolved.map((item) => ({
      product_id: item.product_id,
      product_name: item.resolved_product_name,
      hsn_code: item.hsn_code,
      batch_no: item.batch_no,
      mfg_date: item.mfg_date,
      expiry_date: item.expiry_date,
      pack_qty: item.qty,
      qty: item.qty,
      loose_qty: item.loose_qty,
      free_qty: item.free_qty,
      free_loose_qty: item.free_loose_qty,
      units_per_pack: item.resolved_units_per_pack,
      purchase_rate: item.purchase_rate,
      ptr: item.ptr,
      pts: item.pts,
      ptss: item.ptss,
      selling_rate: item.selling_rate,
      discount_type: item.discount_type,
      discount_percent: item.discount_type === "percent" ? item.discount_percent : 0,
      discount_amount: item.discount_type === "amount" ? item.discount_amount : 0,
      mrp: item.mrp,
      gst_percent: item.gst_percent,
      cess_percent: item.cess_percent,
    }));

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would record purchase bill \`${args.purchase_number}\` from ${supplier.name} with ${resolved.length} line(s) totaling ${formatINR(grandTotal)}.`,
        {
          dry_run: true,
          supplier: supplier.name,
          purchase_number: args.purchase_number,
          items: payloadLines,
          totals: {
            taxable_subtotal: taxResult.taxable_subtotal,
            line_discount_total: taxResult.line_discount_total,
            bill_discount_total: taxResult.bill_discount_total,
            freight_charges: args.freight_charges,
            tax_total: taxResult.total_tax,
            cgst_total: taxResult.cgst_total,
            sgst_total: taxResult.sgst_total,
            igst_total: taxResult.igst_total,
            round_off: roundOff,
            grand_total: grandTotal,
          },
        }
      );
    }

    const created = await client.createPurchase({
      supplier_id: args.supplier_id,
      supplier_name: supplier.name,
      supplier_gstin: supplier.gstin,
      invoice_number: args.purchase_number,
      invoice_date: args.purchase_date,
      is_interstate: args.is_interstate,
      freight_charges: args.freight_charges,
      bill_discount_type: args.bill_discount_type,
      bill_discount: args.bill_discount,
      round_off: args.round_off,
      payment_terms: args.payment_terms,
      lines: payloadLines,
    }, args.store_id);

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, created);
    }

    const createdAny = created as unknown as { invoice_number?: string; purchase_number?: string; grand_total?: number };
    let summary = `✅ **Purchase Bill Recorded: \`${createdAny.invoice_number || createdAny.purchase_number || args.purchase_number}\`**\n`;
    summary += `- **Supplier**: ${supplier.name}\n`;
    summary += `- **Grand Total**: ${formatINR(createdAny.grand_total ?? grandTotal)}\n`;
    summary += `- **Inward Batches**: ${payloadLines.length} line(s) added to stock.\n`;

    return buildToolResponse(summary, {
      purchase: created,
      grand_total: createdAny.grand_total ?? grandTotal,
      currency: "INR",
    });
  },
};
