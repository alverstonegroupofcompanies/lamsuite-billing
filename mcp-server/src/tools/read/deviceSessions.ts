import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const listDeviceSessionsTool: ToolDefinition = {
  name: "lamsuite_list_device_sessions",
  description:
    "List every logged-in terminal/device session for a store: device name, counter, staff user, IP, last activity and lock/revoke status.",
  inputSchema: z.object({
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID. Omit to use the store configured via LAMSUITE_STORE_ID / X-Store-Id"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await client.getDeviceSessions(args.store_id);
    const sessions: any[] = res.sessions || res.data || (Array.isArray(res) ? res : []);

    let summary = `### Device Sessions (${sessions.length})\n\n`;
    if (sessions.length === 0) {
      summary += "No active device sessions were returned for this store.";
    } else {
      summary += "| Session | Device | Counter | User | Status | Last Active | IP |\n";
      summary += "|---|---|---|---|---|---|---|\n";
      for (const s of sessions) {
        summary += `| \`${s.id}\` | ${s.device_name ?? s.device_uuid ?? "—"} | ${s.counter_name ?? s.counter?.counter_code ?? "—"} | ${s.user_name ?? s.user?.name ?? "—"} | ${s.status ?? "—"} | ${s.last_active_at ?? "—"} | ${s.ip_address ?? "—"} |\n`;
      }
    }

    return buildToolResponse(summary, {
      device_sessions: sessions,
      count: sessions.length,
      store_id: args.store_id ?? res.store_id,
    });
  },
};
