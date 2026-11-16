import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const listCountersTool: ToolDefinition = {
  name: "lamsuite_list_counters",
  description: "List all store counters (including remote home counters) with their online state, location, and sequence details.",
  inputSchema: z.object({
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID. Omit to use the store configured via LAMSUITE_STORE_ID / X-Store-Id."),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    // The store scope always travels on the X-Store-Id header; never default to 1.
    const res = await client.get("/admin/counters", { storeId: args.store_id });
    return buildToolResponse(`Retrieved counters`, res);
  },
};

export const getNegativeStockReportTool: ToolDefinition = {
  name: "lamsuite_negative_stock_report",
  description: "Retrieve negative-stock reconciliation report showing deficit batches caused by concurrent offline sales.",
  inputSchema: z.object({
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID. Omit to use the configured store."),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const q = args.store_id ? `?store_id=${args.store_id}` : "";
    const res = await client.get(`/inventory/negative-stock-report${q}`, {
      storeId: args.store_id,
    });
    return buildToolResponse(`Retrieved negative stock report`, res);
  },
};
