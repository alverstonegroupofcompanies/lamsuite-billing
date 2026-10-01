import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { DestructiveConfirmationError } from "../../client/errors.js";

export const cancelInvoiceTool: ToolDefinition = {
  name: "lamsuite_cancel_invoice",
  description:
    "⚠️ [DESTRUCTIVE] Cancel / void an issued sales invoice. Restores stock quantities and adjusts tax records. REQUIRES 'confirm: true' AND a non-empty 'reason'.",
  inputSchema: z.object({
    invoice_id: z.string().describe("Invoice ID or invoice number (e.g. 'INV-1000')"),
    reason: z.string().min(3).describe("Mandatory cancellation reason (e.g. 'Customer changed mind before payment')"),
    confirm: z.boolean().describe("Safety flag: MUST be explicitly set to true to execute this destructive cancellation"),
    dry_run: z.boolean().default(false).describe("Preview cancellation impact without executing"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
  requiredPermission: "invoices:cancel",
  isWriteTool: true,
  handler: async (args, { client }) => {
    // Safety check: confirm and reason must be present
    if (args.confirm !== true) {
      throw new DestructiveConfirmationError("invoice cancellation");
    }
    if (!args.reason || args.reason.trim() === "") {
      throw new Error("A non-empty reason must be provided to cancel an invoice.");
    }

    const inv = await client.getInvoice(args.invoice_id);
    if (inv.status === "cancelled") {
      throw new Error(`Invoice '${inv.invoice_number}' is already cancelled.`);
    }

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would cancel invoice \`${inv.invoice_number}\` (Amount: ${formatINR(inv.grand_total)}) and restore ${inv.items?.length || 0} line item(s) to stock.\n` +
          `- Reason: "${args.reason}"`,
        {
          dry_run: true,
          invoice_number: inv.invoice_number,
          grand_total: inv.grand_total,
          reason: args.reason,
        }
      );
    }

    const res = await client.cancelInvoice(String(inv.id), args.reason);

    let summary = `⚠️ **Invoice Cancelled: \`${inv.invoice_number}\`**\n`;
    summary += `- **Original Amount**: ${formatINR(inv.grand_total)}\n`;
    summary += `- **Reason**: ${args.reason}\n`;
    summary += `- **Stock**: Restored for all line items.\n`;

    return buildToolResponse(summary, {
      invoice_number: inv.invoice_number,
      cancellation: res,
      currency: "INR",
    });
  },
};
