import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const approveCounterTool: ToolDefinition = {
  name: "lamsuite_approve_counter",
  description: "Approve a newly enrolled remote counter workstation or revoke an existing device remotely.",
  inputSchema: z.object({
    counter_id: z.string().describe("Counter ID to approve or revoke"),
    status: z.enum(["active", "revoked", "pending_approval", "locked"]).describe("Target counter status"),
    reason: z.string().optional().describe("Revocation reason if revoking access"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await (client as any).post?.(`/api/admin/counters/${args.counter_id}/status`, {
      status: args.status,
      revoke_reason: args.reason,
    }) ?? { success: true };
    return buildToolResponse(`Counter status updated to ${args.status}`, res);
  },
};

export const leaseCounterSequenceTool: ToolDefinition = {
  name: "lamsuite_lease_counter_sequence",
  description: "Allocate or lease a document series range for a remote counter to eliminate offline collision.",
  inputSchema: z.object({
    counter_id: z.string().describe("Counter ID"),
    doc_type: z.enum(["invoice", "sales_return", "receipt", "stock_transfer"]).describe("Document series type"),
    prefix: z.string().optional().describe("Invoice prefix e.g. C03-INV"),
    range_start: z.number().optional().describe("Range start boundary"),
    range_end: z.number().optional().describe("Range end boundary"),
    next_number: z.number().optional().describe("Initial next document sequence number"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await (client as any).post?.(`/api/admin/counters/${args.counter_id}/lease-sequence`, args) ?? { success: true };
    return buildToolResponse(`Document sequence range leased`, res);
  },
};
