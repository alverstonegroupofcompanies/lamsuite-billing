import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { idempotencyStore } from "../../utils/idempotency.js";

export const recordCustomerPaymentTool: ToolDefinition = {
  name: "lamsuite_record_customer_payment",
  description: "Record a payment received from a customer against their pending credit ledger.",
  inputSchema: z.object({
    customer_id: z.string().describe("Customer ID"),
    amount: z.number().positive().describe("Payment amount in INR"),
    payment_mode: z.enum(["Cash", "UPI", "Card", "Bank Transfer", "Cheque"]).default("Cash"),
    reference_no: z.string().optional().describe("UPI / Cheque / Bank transaction reference number"),
    notes: z.string().optional().describe("Remarks or receipt notes"),
    dry_run: z.boolean().default(false).describe("Preview payment impact without posting"),
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
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Payment already recorded.`, cached);
      }
    }

    const customer = await client.getCustomer(args.customer_id);
    const balanceBefore = customer.outstanding_balance || 0;
    const balanceAfter = Math.max(0, balanceBefore - args.amount);

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would record receipt of ${formatINR(args.amount)} (${args.payment_mode}) from ${customer.name}.\n` +
          `- Balance Before: ${formatINR(balanceBefore)}\n` +
          `- Balance After: **${formatINR(balanceAfter)}**`,
        {
          dry_run: true,
          customer_id: args.customer_id,
          amount: args.amount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
        }
      );
    }

    const res = await client.recordCustomerPayment({
      customer_id: args.customer_id,
      amount: args.amount,
      payment_mode: args.payment_mode,
      reference_no: args.reference_no,
      notes: args.notes,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, res);
    }

    let summary = `✅ **Payment Recorded from ${customer.name}**\n`;
    summary += `- **Amount Received**: ${formatINR(args.amount)} via ${args.payment_mode}\n`;
    summary += `- **Remaining Outstanding**: **${formatINR(balanceAfter)}**\n`;

    return buildToolResponse(summary, {
      payment: res,
      balance_remaining: balanceAfter,
      currency: "INR",
    });
  },
};

export const recordSupplierPaymentTool: ToolDefinition = {
  name: "lamsuite_record_supplier_payment",
  description: "Record a payment disbursed to a supplier against inward purchase bills.",
  inputSchema: z.object({
    supplier_id: z.string().describe("Supplier ID"),
    amount: z.number().positive().describe("Payment amount in INR"),
    payment_mode: z.enum(["Bank Transfer", "UPI", "Cheque", "Cash"]).default("Bank Transfer"),
    reference_no: z.string().optional().describe("NEFT/RTGS/Cheque reference number"),
    notes: z.string().optional().describe("Payment narration"),
    dry_run: z.boolean().default(false).describe("Preview payment impact without posting"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "suppliers:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.idempotency_key && !args.dry_run) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Supplier payment already recorded.`, cached);
      }
    }

    const supplier = await client.getSupplier(args.supplier_id);
    const balanceBefore = supplier.outstanding_balance || 0;
    const balanceAfter = Math.max(0, balanceBefore - args.amount);

    if (args.dry_run) {
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Would record payout of ${formatINR(args.amount)} (${args.payment_mode}) to ${supplier.name}.\n` +
          `- Balance Before: ${formatINR(balanceBefore)}\n` +
          `- Balance After: **${formatINR(balanceAfter)}**`,
        {
          dry_run: true,
          supplier_id: args.supplier_id,
          amount: args.amount,
          balance_before: balanceBefore,
          balance_after: balanceAfter,
        }
      );
    }

    const res = await client.recordSupplierPayment({
      supplier_id: args.supplier_id,
      amount: args.amount,
      payment_mode: args.payment_mode,
      reference_no: args.reference_no,
      notes: args.notes,
    });

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, res);
    }

    let summary = `✅ **Payment Disbursed to ${supplier.name}**\n`;
    summary += `- **Amount Paid**: ${formatINR(args.amount)} via ${args.payment_mode}\n`;
    summary += `- **Remaining Payable**: **${formatINR(balanceAfter)}**\n`;

    return buildToolResponse(summary, {
      payment: res,
      balance_remaining: balanceAfter,
      currency: "INR",
    });
  },
};
