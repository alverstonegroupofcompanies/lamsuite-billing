import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

const storeIdField = z
  .number()
  .int()
  .positive()
  .optional()
  .describe("Store ID. Sent as the X-Store-Id header; defaults to the configured store");

export const approveStockAdjustmentTool: ToolDefinition = {
  name: "lamsuite_approve_stock_adjustment",
  description:
    "Approve a pending stock adjustment document and post its lines to the stock ledger: POST /admin/stock-adjustments/{id}/approve.",
  inputSchema: z.object({
    document_id: z.string().min(1).describe("Stock adjustment document id"),
    store_id: storeIdField,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:adjust",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.approveStockAdjustment(args.document_id, args.store_id);
    const doc = res?.document || {};
    const message = res?.message || "Stock adjustment approved and posted to the ledger.";

    return buildToolResponse(
      `✅ **Stock Adjustment Approved**\n- **Document**: \`${doc.document_id ?? args.document_id}\`\n- **Status**: ${doc.status ?? "approved"}\n- ${message}`,
      { document_id: doc.document_id ?? args.document_id, status: doc.status, result: res }
    );
  },
};

export const rejectStockAdjustmentTool: ToolDefinition = {
  name: "lamsuite_reject_stock_adjustment",
  description:
    "Reject a pending stock adjustment document with an optional reason: POST /admin/stock-adjustments/{id}/reject.",
  inputSchema: z.object({
    document_id: z.string().min(1).describe("Stock adjustment document id"),
    reason: z.string().max(500).optional().describe("Rejection reason recorded against the document"),
    store_id: storeIdField,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:adjust",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.rejectStockAdjustment(args.document_id, args.reason, args.store_id);
    const doc = res?.document || {};
    const message = res?.message || "Stock adjustment rejected.";

    return buildToolResponse(
      `✅ **Stock Adjustment Rejected**\n- **Document**: \`${doc.document_id ?? args.document_id}\`\n- **Reason**: ${args.reason ?? "—"}\n- ${message}`,
      { document_id: doc.document_id ?? args.document_id, status: doc.status, result: res }
    );
  },
};

export const updateStockAdjustmentPolicyTool: ToolDefinition = {
  name: "lamsuite_update_stock_adjustment_policy",
  description:
    "Update the store's stock-adjustment policy (negative-stock allowance, caps, notes requirement, approval threshold, locked period, role restrictions): PUT /admin/stock-adjustments/policy.",
  inputSchema: z.object({
    policy: z
      .record(z.any())
      .describe("Policy fields to save, e.g. {allow_negative_stock, max_qty_per_line, approval_threshold_qty}"),
    store_id: storeIdField,
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.updateStockAdjustmentPolicy(args.policy, args.store_id);
    const policy = res?.policy || {};

    return buildToolResponse(
      `✅ **Stock Adjustment Policy Updated**\n- **Store**: ${res?.store_id ?? args.store_id ?? "configured store"}\n- **Negative stock allowed**: ${policy.allow_negative_stock ? "Yes" : "No"}\n- **Max qty per line**: ${policy.max_qty_per_line ?? "Unlimited"}`,
      { policy, result: res }
    );
  },
};
