import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { DestructiveConfirmationError } from "../../client/errors.js";
import { idempotencyStore } from "../../utils/idempotency.js";

export const createStockAdjustmentTool: ToolDefinition = {
  name: "lamsuite_create_stock_adjustment",
  description:
    "⚠️ [DESTRUCTIVE] Manually adjust stock counts for audit variance, damage, breakage, or expiry disposal. REQUIRES 'confirm: true' AND a non-empty 'reason'.",
  inputSchema: z.object({
    product_id: z.string().describe("Product ID to adjust"),
    batch_no: z.string().optional().describe("Batch number to adjust (optional for single-batch items)"),
    adjustment_type: z.enum(["add", "reduce", "set"]).describe("'add' to increase, 'reduce' to decrease, 'set' to overwrite count"),
    qty: z.number().describe("Quantity value"),
    reason: z.string().min(3).describe("Mandatory reason for manual stock correction (e.g. 'Broken bottle during cleaning')"),
    confirm: z.boolean().describe("Safety flag: MUST be explicitly set to true to execute this destructive change"),
    dry_run: z.boolean().default(false).describe("Preview stock changes without applying"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
  requiredPermission: "stock:adjust",
  isWriteTool: true,
  handler: async (args, { client }) => {
    // Safety check: confirm and reason must be present
    if (args.confirm !== true) {
      throw new DestructiveConfirmationError("stock adjustment");
    }
    if (!args.reason || args.reason.trim() === "") {
      throw new Error("A valid reason must be specified for stock adjustment.");
    }

    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Stock adjustment already applied.`, cached);
      }
    }

    const prod = await client.getProduct(args.product_id);
    const currentStock = prod.current_stock ?? 0;
    let newStock = currentStock;

    if (args.adjustment_type === "add") {
      newStock += args.qty;
    } else if (args.adjustment_type === "reduce") {
      newStock = Math.max(0, currentStock - args.qty);
    } else if (args.adjustment_type === "set") {
      newStock = args.qty;
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would adjust stock for "${prod.name}":\n` +
          `- Current Stock: ${currentStock}\n` +
          `- Action: ${args.adjustment_type.toUpperCase()} ${args.qty}\n` +
          `- Projected Stock: **${newStock}**\n` +
          `- Reason: "${args.reason}"`,
        {
          dry_run: true,
          product_id: args.product_id,
          current_stock: currentStock,
          projected_stock: newStock,
          reason: args.reason,
        }
      );
    }

    const res = await client.createStockAdjustment({
      product_id: args.product_id,
      batch_no: args.batch_no,
      adjustment_type: args.adjustment_type,
      qty: args.qty,
      reason: args.reason,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, res);
    }

    let summary = `⚠️ **Stock Adjusted for ${prod.name}**\n`;
    summary += `- **Adjustment**: ${args.adjustment_type.toUpperCase()} ${args.qty} (${args.reason})\n`;
    summary += `- **New Stock Balance**: **${newStock}**\n`;

    return buildToolResponse(summary, {
      adjustment: res,
      new_stock: newStock,
    });
  },
};
