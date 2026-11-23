import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const approveCounterTool: ToolDefinition = {
  name: "lamsuite_approve_counter",
  description:
    "Set a counter's status, or hand the workstation the one-time activation code that brings it online. " +
    "Pairing codes are retired (CNT-013): a counter is joined only by claiming its code.",
  inputSchema: z.object({
    counter_id: z.string().describe("Counter ID to update or to issue a code for"),
    activation_code: z.boolean().optional().describe("Issue a fresh one-time activation code instead of changing status"),
    reissue: z.boolean().optional().describe("Replace the workstation holding this counter, revoking its device"),
    status: z.enum(["active", "revoked", "locked"]).optional().describe("Target counter status"),
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
    const counterId = encodeURIComponent(args.counter_id);

    if (args.reissue) {
      const res = await client.post(`/admin/counters/${counterId}/reissue`, {});
      return buildToolResponse(`Counter ${args.counter_id} re-issued; the previous workstation is revoked`, res);
    }
    if (args.activation_code) {
      const res = await client.post(`/admin/counters/${counterId}/activation-code`, {});
      return buildToolResponse(`Activation code issued for counter ${args.counter_id} — show it once, it cannot be retrieved`, res);
    }
    if (!args.status) {
      throw new Error("Provide status, activation_code or reissue.");
    }

    const res = await client.post(`/admin/counters/${counterId}/status`, {
      status: args.status,
      revoke_reason: args.reason,
    });
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
    const res = await client.post(
      `/admin/counters/${encodeURIComponent(args.counter_id)}/lease-sequence`,
      args
    );
    return buildToolResponse(`Document sequence range leased`, res);
  },
};
