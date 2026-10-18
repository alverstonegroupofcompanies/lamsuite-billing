import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const listCountersTool: ToolDefinition = {
  name: "lamsuite_list_counters",
  description: "List all store counters (including remote home counters) with their online state, location, and sequence details.",
  inputSchema: z.object({
    store_id: z.string().optional().describe("Store ID"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await (client as any).get?.(`/api/counters?store_id=${args.store_id || 1}`) ?? { counters: [] };
    return buildToolResponse(`Retrieved counters`, res);
  },
};

export const getNegativeStockReportTool: ToolDefinition = {
  name: "lamsuite_negative_stock_report",
  description: "Retrieve negative-stock reconciliation report showing deficit batches caused by concurrent offline sales.",
  inputSchema: z.object({
    store_id: z.string().optional().describe("Store ID"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await (client as any).get?.(`/api/inventory/negative-stock-report?store_id=${args.store_id || 1}`) ?? { negative_batches: [] };
    return buildToolResponse(`Retrieved negative stock report`, res);
  },
};
