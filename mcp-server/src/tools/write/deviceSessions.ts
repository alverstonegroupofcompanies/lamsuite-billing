import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

const ACTION_PERMISSION = "store:write" as const;

/**
 * Force a remote terminal session to log out, be revoked, or be locked/unlocked.
 * Routes verified in backend/routes/api.php (public device-session group):
 *   POST /device-sessions/{id}/force-logout
 *   POST /device-sessions/{id}/revoke
 *   POST /device-sessions/{id}/lock
 *   POST /device-sessions/{id}/unlock
 */
export const deviceSessionActionTool: ToolDefinition = {
  name: "lamsuite_device_session_action",
  description:
    "Remotely force-logout, revoke, lock or unlock a logged-in device/counter session. Use lamsuite_list_device_sessions first to obtain the session id.",
  inputSchema: z.object({
    session_id: z.string().min(1).describe("Device session id (from lamsuite_list_device_sessions)"),
    action: z
      .enum(["force-logout", "revoke", "lock", "unlock"])
      .describe("Action to apply to the session"),
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID. Sent as the X-Store-Id header; defaults to the configured store"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  requiredPermission: ACTION_PERMISSION,
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await client.deviceSessionAction(args.session_id, args.action, args.store_id);
    const message =
      res?.message ||
      `Device session ${args.session_id} ${args.action === "force-logout" ? "force-logged out" : args.action + "ed"}.`;

    return buildToolResponse(`### Device Session Updated\n- **Session**: \`${args.session_id}\`\n- **Action**: ${args.action}\n- **Result**: ${message}`, {
      session_id: args.session_id,
      action: args.action,
      result: res,
    });
  },
};
