import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";
import { DestructiveConfirmationError, ValidationError } from "../../client/errors.js";
import { idempotencyStore } from "../../utils/idempotency.js";

const lineSchema = z.object({
  product_id: z.string().describe("Product ID to adjust"),
  batch_id: z.string().optional().describe("Batch row ID (preferred when known)"),
  batch_no: z.string().optional().describe("Batch number when the row ID is not known"),
  adjustment_qty: z.number().optional().describe("Signed delta: negative writes off, positive adds stock"),
  counted_qty: z.number().optional().describe("Physical counted quantity (physical_count mode)"),
  unit_cost: z.number().optional().describe("Optional unit cost override for valuation"),
  reason: z.string().optional().describe("Line-level reason; defaults to the document reason"),
  notes: z.string().optional().describe("Line-level notes"),
});

export const createStockAdjustmentTool: ToolDefinition = {
  name: "lamsuite_create_stock_adjustment",
  description:
    "⚠️ [DESTRUCTIVE] Post a multi-line stock adjustment document (damage, expiry, breakage, physical count). One ledger entry is written per line and the store's stock-adjustment policy is enforced server-side. REQUIRES 'confirm: true' AND a non-empty 'reason'.",
  inputSchema: z.object({
    mode: z
      .enum(["adjustment", "physical_count"])
      .default("adjustment")
      .describe("'adjustment' posts explicit deltas; 'physical_count' sets stock to the counted quantity"),
    lines: z
      .array(lineSchema)
      .optional()
      .describe("Multi-line document. When omitted, the legacy single-line fields below are converted to one line."),
    product_id: z.string().optional().describe("Legacy single-line product ID (required when 'lines' is omitted)"),
    batch_no: z.string().optional().describe("Legacy single-line batch number"),
    batch_id: z.string().optional().describe("Legacy single-line batch row ID"),
    adjustment_type: z
      .enum(["add", "reduce", "set"])
      .optional()
      .describe("Legacy single-line action: 'add', 'reduce' or 'set' (set implies physical_count)"),
    qty: z.number().optional().describe("Legacy single-line quantity"),
    counted_qty: z.number().optional().describe("Single-line physical counted quantity"),
    document_id: z.string().optional().describe("Client document id for idempotent replay"),
    document_date: z.string().optional().describe("Document date YYYY-MM-DD (defaults to today)"),
    notes: z.string().optional().describe("Document-level notes"),
    reason: z.string().min(3).describe("Mandatory reason for the adjustment document"),
    confirm: z.boolean().describe("Safety flag: MUST be explicitly set to true to execute this destructive change"),
    dry_run: z.boolean().default(false).describe("Preview stock changes without applying"),
    idempotency_key: z.string().optional().describe("Idempotency key"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
  requiredPermission: "stock:adjust",
  isWriteTool: true,
  handler: async (args, { client }) => {
    if (args.confirm !== true) {
      throw new DestructiveConfirmationError("stock adjustment");
    }
    if (!args.reason || args.reason.trim() === "") {
      throw new Error("A valid reason must be specified for stock adjustment.");
    }

    const legacyLine = (): Record<string, unknown> | null => {
      if (!args.product_id) return null;
      const qty = args.qty;
      if (qty === undefined && args.counted_qty === undefined) {
        throw new ValidationError(
          "The legacy single-line form needs 'qty' (add/reduce/set) or 'counted_qty'.",
          { field: "qty" }
        );
      }
      const action = args.adjustment_type || (args.counted_qty !== undefined ? "set" : "add");
      const line: Record<string, unknown> = {
        product_id: args.product_id,
        batch_id: args.batch_id,
        batch_no: args.batch_no,
        reason: args.reason,
        notes: args.notes,
      };
      if (action === "set") {
        line.counted_qty = args.counted_qty ?? qty;
        return line;
      }
      const absolute = Math.abs(qty ?? 0);
      line.adjustment_qty = action === "reduce" ? -absolute : absolute;
      return line;
    };

    const hasLines = Array.isArray(args.lines) && args.lines.length > 0;
    const lines = hasLines
      ? args.lines.map((line: z.infer<typeof lineSchema>) => ({
          product_id: line.product_id,
          batch_id: line.batch_id,
          batch_no: line.batch_no,
          adjustment_qty: line.adjustment_qty,
          counted_qty: line.counted_qty,
          unit_cost: line.unit_cost,
          reason: line.reason || args.reason,
          notes: line.notes,
        }))
      : [legacyLine()].filter(Boolean);

    if (lines.length === 0) {
      throw new ValidationError(
        "Provide a multi-line 'lines' array or the legacy product_id with qty/counted_qty.",
        { field: "lines" }
      );
    }

    const legacyPhysicalCount =
      !hasLines && args.adjustment_type === undefined && args.counted_qty !== undefined;
    const mode =
      args.mode === "physical_count" || args.adjustment_type === "set" || legacyPhysicalCount
        ? "physical_count"
        : "adjustment";

    for (const line of lines) {
      const resolved = line as Record<string, unknown>;
      if (resolved.batch_id === undefined) delete resolved.batch_id;
      if (resolved.batch_no === undefined) delete resolved.batch_no;
      if (resolved.unit_cost === undefined) delete resolved.unit_cost;
      const requiresCounted = mode === "physical_count" || resolved.counted_qty !== undefined;
      if (requiresCounted && resolved.counted_qty === undefined) {
        throw new ValidationError(
          "Physical-count lines need 'counted_qty'.",
          { field: "lines" }
        );
      }
      if (!requiresCounted && resolved.adjustment_qty === undefined) {
        throw new ValidationError(
          "Each line needs either 'adjustment_qty' or 'counted_qty'.",
          { field: "lines" }
        );
      }
    }
    const documentId =
      args.document_id ||
      (args.idempotency_key ? `adj_mcp_${args.idempotency_key}` : `adj_mcp_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`);

    if (args.dry_run) {
      const preview = (lines as Array<Record<string, unknown>>)
        .map(
          (line, index) =>
            `${index + 1}. ${line.product_id}${line.batch_no ? ` / ${line.batch_no}` : ""}: ` +
            (mode === "physical_count"
              ? `counted ${line.counted_qty}`
              : `delta ${Number(line.adjustment_qty) >= 0 ? "+" : ""}${line.adjustment_qty}`)
        )
        .join("\n");
      return buildToolResponse(
        `🔍 **[DRY RUN PREVIEW]** Stock adjustment document (${mode}, ${lines.length} line${lines.length === 1 ? "" : "s"}):\n` +
          `${preview}\n- Reason: "${args.reason}"\n- No stock or ledger rows were written.`,
        {
          dry_run: true,
          document_id: documentId,
          mode,
          lines,
          reason: args.reason,
        }
      );
    }

    if (args.idempotency_key) {
      const cached = idempotencyStore.get(args.idempotency_key);
      if (cached) {
        return buildToolResponse(`ℹ️ [IDEMPOTENT RETRY] Stock adjustment already applied.`, cached);
      }
    }

    let res: any;
    try {
      res = await client.createStockAdjustment({
        document_id: documentId,
        mode,
        reason: args.reason,
        notes: args.notes,
        document_date: args.document_date,
        lines,
      });
    } catch (error: any) {
      if (error instanceof ValidationError) {
        const policy = error.details?.errors?.policy;
        const lineErrors = error.details?.errors?.lines;
        const details = Array.isArray(policy) ? policy.join(" ") : policy;
        throw new ValidationError(
          `Stock adjustment blocked by store policy. ${details || error.message}`.trim(),
          { ...(error.details || {}), line_errors: lineErrors }
        );
      }
      throw error;
    }

    if (args.idempotency_key) {
      idempotencyStore.set(args.idempotency_key, res);
    }

    const status = res?.status || "posted";
    const pending = status === "pending_approval";
    let summary = pending
      ? `🕒 **Stock Adjustment Submitted for Approval**\n`
      : `⚠️ **Stock Adjustment Posted**\n`;
    summary += `- **Document**: \`${res?.document_id || documentId}\` (${mode})\n`;
    summary += `- **Lines**: ${res?.lines_count ?? lines.length}\n`;
    if (!pending) {
      summary += `- **Ledger Entries**: ${res?.adjustments_posted ?? lines.length}\n`;
      summary += `- **Total Qty**: ${res?.total_qty ?? "n/a"}\n`;
      summary += `- **Total Value**: ${res?.total_value ?? "n/a"}\n`;
    } else {
      summary += `- Stock is unchanged until a permitted approver releases the document.\n`;
    }
    summary += `- **Reason**: ${args.reason}\n`;

    return buildToolResponse(summary, {
      adjustment: res,
      document_id: res?.document_id || documentId,
      status,
      mode,
      lines_count: res?.lines_count ?? lines.length,
    });
  },
};
