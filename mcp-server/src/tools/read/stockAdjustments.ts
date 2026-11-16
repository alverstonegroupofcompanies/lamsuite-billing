import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse, formatINR } from "../../utils/formatters.js";

export const listStockAdjustmentsTool: ToolDefinition = {
  name: "lamsuite_list_stock_adjustments",
  description:
    "List multi-line stock adjustment documents (damage, expiry, physical count) with their approval status. Use to review pending approvals or audit what was written off.",
  inputSchema: z.object({
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID (defaults to the configured store / X-Store-Id)"),
    status: z
      .enum(["draft", "pending_approval", "approved", "posted", "rejected"])
      .optional()
      .describe("Filter by document status"),
    per_page: z.number().int().min(1).max(100).default(20).describe("Page size"),
    page: z.number().int().min(1).default(1).describe("Page number"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const q = new URLSearchParams();
    if (args.status) q.set("status", args.status);
    q.set("per_page", String(args.per_page ?? 20));
    q.set("page", String(args.page ?? 1));

    const res = await client.get(`/admin/stock-adjustments?${q.toString()}`, {
      storeId: args.store_id,
    });
    const documents: any[] = res?.data ?? [];

    let summary = `### Stock Adjustment Documents (${res.total ?? documents.length})\n\n`;
    if (documents.length === 0) {
      summary += "No adjustment documents matched the filter.";
    } else {
      summary += "| Document | Mode | Lines | Qty | Value | Status | Submitted By |\n";
      summary += "|---|---|---|---|---|---|---|\n";
      for (const doc of documents) {
        summary += `| \`${doc.document_id}\` | ${doc.mode} | ${doc.lines_count ?? 0} | ${doc.total_qty ?? 0} | ${formatINR(doc.total_value)} | ${doc.status} | ${doc.creator?.name ?? "—"} |\n`;
      }
    }

    return buildToolResponse(summary, res);
  },
};

export const getStockAdjustmentPolicyTool: ToolDefinition = {
  name: "lamsuite_get_stock_adjustment_policy",
  description:
    "Read the store's stock-adjustment policy: negative-stock allowance, quantity/value caps, required notes, approval threshold, locked period, and role restrictions.",
  inputSchema: z.object({
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID (defaults to the configured store / X-Store-Id)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await client.get(`/admin/stock-adjustments/policy`, {
      storeId: args.store_id,
    });
    const p = res?.policy ?? {};

    const summary =
      `### Stock Adjustment Policy\n` +
      `- **Negative stock allowed**: ${p.allow_negative_stock ? "Yes" : "No"}\n` +
      `- **Require notes**: ${p.require_notes ? "Yes" : "No"}\n` +
      `- **Max qty per line**: ${p.max_qty_per_line ?? "Unlimited"}\n` +
      `- **Max value per document**: ${p.max_value_per_document ? formatINR(p.max_value_per_document) : "Unlimited"}\n` +
      `- **Approval threshold (qty)**: ${p.approval_threshold_qty ?? "None"}\n` +
      `- **Max documents per day**: ${p.max_documents_per_day ?? "Unlimited"}\n` +
      `- **Locked before**: ${p.locked_before_date ?? "—"}\n` +
      `- **Allowed roles**: ${(p.allowed_roles ?? []).join(", ") || "All"}\n` +
      `- **Approver roles**: ${(p.approver_roles ?? []).join(", ") || "Manager and above"}`;

    return buildToolResponse(summary, { policy: p, defaults: res.defaults });
  },
};

export const getStockAdjustmentTool: ToolDefinition = {
  name: "lamsuite_get_stock_adjustment",
  description:
    "Retrieve one stock adjustment document with every line (product, batch, counted/delta quantity, value) plus who submitted and approved it.",
  inputSchema: z.object({
    document_id: z.string().min(1).describe("Stock adjustment document id"),
    store_id: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Store ID (defaults to the configured store / X-Store-Id)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "stock:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const doc = await client.get(
      `/admin/stock-adjustments/${encodeURIComponent(args.document_id)}`,
      { storeId: args.store_id }
    );

    const lines: any[] = doc.lines || [];
    let summary = `### Stock Adjustment \`${doc.document_id}\`\n`;
    summary += `- **Status**: ${doc.status}\n`;
    summary += `- **Mode**: ${doc.mode}\n`;
    summary += `- **Document Date**: ${doc.document_date ?? "—"}\n`;
    summary += `- **Submitted By**: ${doc.creator?.name ?? "—"}\n`;
    summary += `- **Approved By**: ${doc.approver?.name ?? "—"}\n`;
    summary += `- **Total Qty**: ${doc.total_qty ?? 0} | **Value**: ${formatINR(doc.total_value)}\n\n`;

    if (lines.length === 0) {
      summary += "This document has no lines.";
    } else {
      summary += "| Product | Batch | Delta Qty | Counted Qty | Value | Reason |\n";
      summary += "|---|---|---|---|---|---|\n";
      for (const line of lines) {
        summary += `| ${line.product?.name ?? line.product_name ?? line.product_id} | \`${line.batch?.batch_no ?? line.batch_no ?? "—"}\` | ${line.adjustment_qty ?? 0} | ${line.counted_qty ?? "—"} | ${formatINR(line.total_value ?? line.value)} | ${line.reason ?? "—"} |\n`;
      }
    }

    return buildToolResponse(summary, doc);
  },
};

