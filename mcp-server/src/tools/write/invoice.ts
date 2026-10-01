import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { selectBatchesFefo } from "../../utils/fefo.js";
import {
  calculateSingleLine,
  calculateInvoiceTotals,
  type LineCalculationInput,
} from "../../utils/calculations.js";
import { idempotencyStore } from "../../utils/idempotency.js";

const InvoiceLineSchema = z.object({
  product_id: z.string().optional().describe("Product ID (either product_id or barcode required)"),
  barcode: z.string().optional().describe("Product barcode"),
  item_name: z.string().optional().describe("Item name (for search fallback)"),
  batch_no: z.string().optional().describe("Batch number. If omitted, FEFO automatically selects the earliest valid batch"),
  qty: z.number().positive().describe("Quantity of packs/units to bill"),
  loose_qty: z.number().min(0).default(0).describe("Loose tablets or fractions"),
  unit_price: z.number().min(0).optional().describe("Custom selling rate override. If omitted, uses catalog selling rate"),
  discount_percent: z.number().min(0).max(100).default(0).describe("Item level percentage discount"),
});

export const createInvoiceTool: ToolDefinition = {
  name: "lamsuite_create_invoice",
  description:
    "Create a new POS sales bill/invoice. If batch_no is omitted for an item, FEFO (First Expiry, First Out) batch selection is automatically applied. Supports dry_run: true for a full preview (totals, taxes, stock impact) without saving. Uses idempotency_key to prevent duplicate invoices on retries.",
  inputSchema: z.object({
    customer_name: z.string().default("Walk-in Customer").describe("Customer name"),
    customer_phone: z.string().optional().describe("Customer phone number"),
    customer_id: z.string().optional().describe("Customer master ID if registered"),
    customer_gstin: z.string().optional().describe("Customer GSTIN for B2B invoice"),
    items: z.array(InvoiceLineSchema).min(1).describe("List of products to bill"),
    bill_discount_percent: z.number().min(0).max(100).default(0).describe("Overall bill discount %"),
    bill_discount_amount: z.number().min(0).default(0).describe("Overall bill discount in INR"),
    payment_mode: z
      .enum(["Cash", "UPI", "Card", "Credit", "Split"])
      .default("Cash")
      .describe("Tender payment mode"),
    patient_name: z.string().optional().describe("Patient name (for prescription records)"),
    doctor_name: z.string().optional().describe("Prescribing doctor name"),
    doctor_reg_no: z.string().optional().describe("Doctor registration number"),
    dry_run: z.boolean().default(false).describe("If true, returns a calculation and stock impact preview without saving"),
    idempotency_key: z.string().optional().describe("Unique client idempotency key to prevent duplicate bills on retry"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "invoices:create",
  isWriteTool: true,
  handler: async (args, { client, config }) => {
    // 1. Idempotency Check
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(
          `ℹ️ [IDEMPOTENT RETRY] Invoice already created with key \`${args.idempotency_key}\`.\nReturning existing invoice \`${cached.invoice_number}\`.`,
          {
            ...cached,
            idempotent_replay: true,
          }
        );
      }
    }

    // 2. Fetch Store Profile for tax mode and state code
    const store = await client.getStore();
    const storeState = store.state_code || "32";
    const taxMode = store.tax_mode || "inclusive";

    // 3. Resolve Items & Apply FEFO Batch Selection
    const preparedLines: Array<{
      product: any;
      batch_no: string;
      expiry_date: string;
      qty: number;
      loose_qty: number;
      unit_price: number;
      discount_percent: number;
      gst_percent: number;
      stock_before: number;
      stock_after: number;
    }> = [];

    for (const requested of args.items) {
      let product: any;
      if (requested.product_id) {
        product = await client.getProduct(requested.product_id);
      } else if (requested.barcode) {
        product = await client.getProduct(requested.barcode);
      } else if (requested.item_name) {
        const search = await client.getProducts({ query: requested.item_name, limit: 1 });
        if (search.data && search.data.length > 0) {
          product = await client.getProduct(search.data[0].id);
        }
      }

      if (!product) {
        throw new Error(
          `Product not found for: ${requested.product_id || requested.barcode || requested.item_name}`
        );
      }

      const unitPrice = requested.unit_price ?? product.sel_rate;
      const gstPercent = product.gst_percent ?? 12;
      const batches = product.batches || [];

      if (requested.batch_no) {
        // Specific batch specified by user
        const batch = batches.find((b: any) => b.batch_no === requested.batch_no);
        if (!batch) {
          throw new Error(
            `Batch '${requested.batch_no}' not found for product '${product.name}'.`
          );
        }
        if (batch.stock_qty < requested.qty) {
          throw new Error(
            `Insufficient stock in batch '${requested.batch_no}' for '${product.name}'. Available: ${batch.stock_qty}, Requested: ${requested.qty}.`
          );
        }
        preparedLines.push({
          product,
          batch_no: batch.batch_no,
          expiry_date: batch.expiry_date,
          qty: requested.qty,
          loose_qty: requested.loose_qty,
          unit_price: unitPrice,
          discount_percent: requested.discount_percent,
          gst_percent: gstPercent,
          stock_before: batch.stock_qty,
          stock_after: batch.stock_qty - requested.qty,
        });
      } else {
        // Automatic FEFO Selection
        const allocations = selectBatchesFefo(
          batches,
          requested.qty,
          product.name
        );
        for (const alloc of allocations) {
          preparedLines.push({
            product,
            batch_no: alloc.batch_no,
            expiry_date: alloc.expiry_date,
            qty: alloc.allocated_qty,
            loose_qty: requested.loose_qty,
            unit_price: unitPrice,
            discount_percent: requested.discount_percent,
            gst_percent: gstPercent,
            stock_before: alloc.stock_qty,
            stock_after: alloc.stock_qty - alloc.allocated_qty,
          });
        }
      }
    }

    // 4. Calculate Taxes and Invoice Totals
    const calculatedLines = preparedLines.map((line) => {
      const calcInput: LineCalculationInput = {
        qty: line.qty,
        loose_qty: line.loose_qty,
        units_per_pack: line.product.units_per_pack || 1,
        unit_price: line.unit_price,
        discount_percent: line.discount_percent,
        gst_percent: line.gst_percent,
      };
      return calculateSingleLine(calcInput, storeState, args.customer_gstin, taxMode);
    });

    const totals = calculateInvoiceTotals(
      calculatedLines,
      args.bill_discount_percent,
      args.bill_discount_amount
    );

    // 5. Handle Dry Run Preview
    if (args.dry_run) {
      let previewSummary = `🔍 **[DRY RUN PREVIEW - NO CHANGES SAVED]**\n\n`;
      previewSummary += `### Invoice Preview for ${args.customer_name}\n`;
      previewSummary += `- **Subtotal**: ${formatINR(totals.subtotal)}\n`;
      if (totals.line_discount_total + totals.bill_discount_amount > 0) {
        previewSummary += `- **Total Discount**: -${formatINR(totals.line_discount_total + totals.bill_discount_amount)}\n`;
      }
      previewSummary += `- **Taxable Amount**: ${formatINR(totals.taxable_subtotal)}\n`;
      previewSummary += `- **GST Total**: ${formatINR(totals.total_tax)} (CGST: ${formatINR(totals.cgst_total)}, SGST: ${formatINR(totals.sgst_total)}, IGST: ${formatINR(totals.igst_total)})\n`;
      previewSummary += `- **Round Off**: ${formatINR(totals.round_off)}\n`;
      previewSummary += `- **Grand Total**: **${formatINR(totals.grand_total)}**\n`;
      previewSummary += `- **Payment Mode**: ${args.payment_mode}\n\n`;

      previewSummary += `#### Line Allocations (FEFO Applied):\n`;
      previewSummary += "| Product | Batch | Expiry | Qty | Rate | Stock Before ➔ After |\n";
      previewSummary += "| --- | --- | --- | --- | --- | --- |\n";
      for (let i = 0; i < preparedLines.length; i++) {
        const pl = preparedLines[i];
        previewSummary += `| ${pl.product.name} | \`${pl.batch_no}\` | ${pl.expiry_date} | ${pl.qty} | ${formatINR(pl.unit_price)} | ${pl.stock_before} ➔ **${pl.stock_after}** |\n`;
      }

      return buildToolResponse(
        previewSummary,
        {
          dry_run: true,
          preview: {
            customer_name: args.customer_name,
            payment_mode: args.payment_mode,
            totals,
            lines: preparedLines.map((pl, idx) => ({
              product_id: pl.product.id,
              product_name: pl.product.name,
              batch_no: pl.batch_no,
              expiry_date: pl.expiry_date,
              qty: pl.qty,
              unit_price: pl.unit_price,
              line_totals: calculatedLines[idx],
              stock_before: pl.stock_before,
              stock_after: pl.stock_after,
            })),
          },
          currency: "INR",
        },
        true
      );
    }

    // 6. Real Invoice Creation via Backend API
    const idempotencyKey = args.idempotency_key || `mcp_inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const invoicePayload = {
      external_id: idempotencyKey,
      idempotency_key: idempotencyKey,
      invoice_date: new Date().toISOString().slice(0, 10),
      customer_id: args.customer_id,
      customer_name: args.customer_name,
      customer_phone: args.customer_phone,
      customer_gstin: args.customer_gstin,
      place_of_supply: args.customer_gstin ? args.customer_gstin.slice(0, 2) : storeState,
      subtotal: totals.taxable_subtotal,
      discount_total: totals.line_discount_total + totals.bill_discount_amount,
      tax_total: totals.total_tax,
      cgst_total: totals.cgst_total,
      sgst_total: totals.sgst_total,
      igst_total: totals.igst_total,
      round_off: totals.round_off,
      grand_total: totals.grand_total,
      paid_amount: totals.grand_total,
      payment_mode: args.payment_mode,
      patient_name: args.patient_name,
      doctor_name: args.doctor_name,
      doctor_reg_no: args.doctor_reg_no,
      lines: preparedLines.map((pl, idx) => ({
        product_id: pl.product.id,
        product_name: pl.product.name,
        batch_no: pl.batch_no,
        expiry_date: pl.expiry_date,
        qty: pl.qty,
        loose_qty: pl.loose_qty,
        unit_price: pl.unit_price,
        discount_percent: pl.discount_percent,
        gst_percent: pl.gst_percent,
        cgst_amount: calculatedLines[idx].cgst_amount,
        sgst_amount: calculatedLines[idx].sgst_amount,
        igst_amount: calculatedLines[idx].igst_amount,
        total_amount: calculatedLines[idx].total_amount,
      })),
    };

    const created = await client.createInvoice(invoicePayload);

    // Save in idempotency cache
    idempotencyStore.set(idempotencyKey, created);

    let summary = `✅ **Invoice Created Successfully: \`${created.invoice_number}\`**\n\n`;
    summary += `- **Customer**: ${created.customer_name}\n`;
    summary += `- **Grand Total**: **${formatINR(created.grand_total)}** (${created.payment_mode})\n`;
    summary += `- **Tax**: ${formatINR(created.tax_total)} (CGST: ${formatINR(created.cgst_total || 0)}, SGST: ${formatINR(created.sgst_total || 0)})\n\n`;

    summary += "#### Billed Items:\n";
    summary += "| Item | Batch | Qty | Rate | Stock Left |\n";
    summary += "| --- | --- | --- | --- | --- |\n";
    for (const pl of preparedLines) {
      summary += `| ${pl.product.name} | \`${pl.batch_no}\` | ${pl.qty} | ${formatINR(pl.unit_price)} | ${pl.stock_after} |\n`;
    }

    return buildToolResponse(summary, {
      invoice: created,
      idempotency_key: idempotencyKey,
      currency: "INR",
    });
  },
};
