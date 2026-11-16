import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

const ApprovalAction = z.enum(["edit", "cancel"]);

export const issueInvoiceApprovalTool: ToolDefinition = {
  name: "lamsuite_issue_invoice_approval",
  description:
    "Issue a single-use approval PIN that lets one named staff member edit or cancel one invoice. The PIN is returned exactly once, stored only as a hash, and expires after the requested minutes. Requires an administrator or store owner.",
  inputSchema: z.object({
    invoice_id: z.string().describe("Invoice ID or invoice number"),
    action: ApprovalAction.describe("What the staff member is authorised to do"),
    user_id: z.string().describe("ID of the staff member who will use the PIN"),
    minutes: z.number().int().min(1).max(60).default(10).describe("Validity window in minutes"),
    reason: z.string().optional().describe("Audit reason for issuing the approval"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  requiredPermission: "invoices:approve",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.issueInvoiceApproval(args.invoice_id, {
      action: args.action,
      user_id: args.user_id,
      minutes: args.minutes,
      reason: args.reason,
    });

    const summary =
      `🔐 **One-Time ${args.action} PIN Issued**\n\n` +
      `- **Invoice**: ${args.invoice_id}\n` +
      `- **Staff User ID**: ${args.user_id}\n` +
      `- **PIN**: \`${res.pin}\`\n` +
      `- **Expires In**: ${args.minutes} minute(s)\n\n` +
      `This PIN is shown only once and can be used only for this invoice, action and staff member.`;

    return buildToolResponse(summary, {
      pin: res.pin,
      approval: res.approval,
      message: res.message,
    });
  },
};

export const verifyInvoiceApprovalTool: ToolDefinition = {
  name: "lamsuite_verify_invoice_approval",
  description:
    "Verify a manager credential or a one-time PIN before editing or cancelling an invoice. Returns a short-lived approval token. One-time PINs are consumed on success.",
  inputSchema: z.object({
    invoice_id: z.string().describe("Invoice ID or invoice number"),
    action: ApprovalAction.describe("Requested action"),
    mode: z.enum(["manager", "one_time_pin"]).describe("Approval source"),
    identifier: z.string().optional().describe("Manager username or email (manager mode)"),
    secret: z.string().optional().describe("Manager password or PIN (manager mode)"),
    pin: z.string().length(6).optional().describe("Six-digit one-time PIN (one_time_pin mode)"),
    user_id: z.string().optional().describe("Staff user ID using the one-time PIN"),
    requested_by: z.string().optional().describe("Display name of the requesting operator"),
    counter_code: z.string().optional().describe("Counter code where the request originated"),
    reason: z.string().max(1000).optional().describe("Reason for the edit/cancel"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  requiredPermission: "invoices:approve",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.verifyInvoiceApproval(args.invoice_id, {
      action: args.action,
      mode: args.mode,
      identifier: args.identifier,
      secret: args.secret,
      pin: args.pin,
      user_id: args.user_id,
      requested_by: args.requested_by,
      counter_code: args.counter_code,
      reason: args.reason,
    });

    return buildToolResponse(
      `✅ **Approval Granted** for ${args.action} on invoice ${args.invoice_id}. ` +
        `The token expires shortly and is bound to this invoice.`,
      res
    );
  },
};

export const revokeInvoiceApprovalTool: ToolDefinition = {
  name: "lamsuite_revoke_invoice_approval",
  description:
    "Revoke a pending one-time invoice approval so its PIN can no longer be used.",
  inputSchema: z.object({
    invoice_id: z.string().describe("Invoice ID or invoice number"),
    approval_id: z.string().describe("Approval ID returned when the PIN was issued"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  requiredPermission: "invoices:approve",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.revokeInvoiceApproval(args.invoice_id, args.approval_id);
    return buildToolResponse(
      `🗑️ **Approval Revoked** for invoice ${args.invoice_id}.`,
      res
    );
  },
};
