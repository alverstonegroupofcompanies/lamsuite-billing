import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const migrationPrecheckTool: ToolDefinition = {
  name: "lamsuite_migration_precheck",
  description:
    "Run comprehensive pre-flight diagnostics on a store data migration source (API, file bundle, or device recovery payload). Detects duplicate barcodes, missing HSN/GSTIN, negative stock, and orphan records.",
  inputSchema: z.object({
    store_id: z.number().int().describe("Target store ID in the new LamSuite backend"),
    source_type: z.enum(["api", "file", "device"]).describe("Migration source type"),
    config: z
      .record(z.any())
      .describe("Source configuration: {url, token, username, password} for API or {file_path} for file or {payload} for device"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await (client as any).post("/admin/migrations/precheck", args);
    const data = res.data || res;
    const canProceed = data.can_proceed ? "✅ Ready to migrate" : "⚠️ Pre-check blockers found";

    let text = `### 🔍 Migration Pre-Check Results: ${canProceed}\n\n`;
    text += `- **Total Records Detected:** ${data.summary?.total_records || 0}\n`;
    text += `- **Warnings:** ${data.summary?.warnings_count || 0}\n`;
    text += `- **Errors:** ${data.summary?.errors_count || 0}\n\n`;

    if (data.issues && data.issues.length > 0) {
      text += `#### Diagnostic Findings:\n`;
      for (const issue of data.issues) {
        text += `- **[${issue.type.toUpperCase()}]** (${issue.category}): ${issue.message}\n`;
      }
    }

    return buildToolResponse(text, data);
  },
};

export const migrationStartTool: ToolDefinition = {
  name: "lamsuite_migration_start",
  description:
    "Launch a store data migration run or simulated dry-run from the source into the new LamSuite backend in strict dependency order.",
  inputSchema: z.object({
    store_id: z.number().int().describe("Target store ID"),
    source_type: z.enum(["api", "file", "device"]).describe("Migration source type"),
    config: z.record(z.any()).describe("Source credentials or file path / payload"),
    is_dry_run: z.boolean().default(false).describe("If true, simulates execution and rolls back all writes"),
    mapping_config: z.record(z.any()).optional().describe("Custom entity / status field mapping overrides"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "store:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await (client as any).post("/admin/migrations/start", args);
    const data = res.data || res;
    const isDry = args.is_dry_run ? "[DRY-RUN]" : "[LIVE]";
    const stats = data.stats || {};

    let text = `### 🚀 Migration Run Initiated ${isDry}\n\n`;
    text += `- **Run UUID:** \`${data.run?.run_uuid}\`\n`;
    text += `- **Status:** ${data.run?.status}\n\n`;
    text += `#### Migrated Entity Summary:\n`;
    text += `- **Lookups / Masters:** ${stats.lookups || 0}\n`;
    text += `- **Parties (Customers/Suppliers):** ${stats.parties || 0}\n`;
    text += `- **Users & Staff:** ${stats.users || 0}\n`;
    text += `- **Products Catalog:** ${stats.products || 0}\n`;
    text += `- **Batches & Stock:** ${stats.batches || 0}\n`;
    text += `- **Invoices:** ${stats.invoices || 0}\n`;
    text += `- **Purchases:** ${stats.purchases || 0}\n`;
    text += `- **Expenses & Payments:** ${(stats.expenses || 0) + (stats.payments || 0)}\n`;
    text += `- **Held Bills Recovered:** ${stats.held_bills || 0}\n\n`;

    if (data.reconciliation) {
      const rec = data.reconciliation;
      text += `#### Immediate Reconciliation Check:\n`;
      text += `- **Status:** ${rec.is_passed ? "PASSED (Totals match to the paisa)" : "DISCREPANCIES DETECTED"}\n`;
    }

    return buildToolResponse(text, data);
  },
};

export const migrationReconcileTool: ToolDefinition = {
  name: "lamsuite_migration_reconcile",
  description:
    "Run automated side-by-side reconciliation for a migration run: compare counts, sales, purchases, GST by tax slab, inventory, and ledger balances to the paisa.",
  inputSchema: z.object({
    uuid: z.string().describe("Migration run UUID"),
    source_type: z.enum(["api", "file", "device"]).describe("Source type to re-verify against"),
    config: z.record(z.any()).describe("Source credentials or file path"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "reports:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const res = await (client as any).post(`/admin/migrations/${args.uuid}/reconcile`, {
      source_type: args.source_type,
      config: args.config,
    });
    const data = res.data || res;
    const passed = data.is_passed ? "✅ PASSED" : "❌ DISCREPANCIES DETECTED";

    let text = `### 📊 Migration Reconciliation Report: ${passed}\n\n`;
    const fin = data.financial_comparison || {};
    if (fin.sales) {
      text += `- **Sales Total:** Source ₹${fin.sales.source} vs Migrated ₹${fin.sales.target} (Diff: ₹${fin.sales.diff})\n`;
    }
    if (fin.purchases) {
      text += `- **Purchases Total:** Source ₹${fin.purchases.source} vs Migrated ₹${fin.purchases.target} (Diff: ₹${fin.purchases.diff})\n`;
    }
    const stock = data.stock_comparison || {};
    text += `- **Total Migrated Stock Qty:** ${stock.total_stock_qty || 0}\n`;
    text += `- **Stock Inventory Valuation:** ₹${stock.valuation || 0}\n\n`;

    if (data.discrepancies && data.discrepancies.length > 0) {
      text += `#### Discrepancies to Resolve:\n`;
      for (const d of data.discrepancies) {
        text += `- [${d.category}] ${d.message}\n`;
      }
    }

    return buildToolResponse(text, data);
  },
};

export const migrationRollbackTool: ToolDefinition = {
  name: "lamsuite_migration_rollback",
  description:
    "Roll back a completed or failed migration run atomically, restoring the database to its pre-migration state using the migration ID map.",
  inputSchema: z.object({
    uuid: z.string().describe("Migration run UUID to roll back"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  requiredPermission: "store:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await (client as any).post(`/admin/migrations/${args.uuid}/rollback`, {});
    const data = res.data || res;

    let text = `### ⏪ Migration Run Rolled Back Successfully\n\n`;
    const d = data.data || {};
    text += `- Invoices Removed: ${d.invoices_deleted || 0}\n`;
    text += `- Purchases Removed: ${d.purchases_deleted || 0}\n`;
    text += `- Products Removed: ${d.products_deleted || 0}\n`;
    text += `- Batches Removed: ${d.batches_deleted || 0}\n`;
    text += `- Parties Removed: ${d.parties_deleted || 0}\n`;
    text += `- Lookups Removed: ${d.lookups_deleted || 0}\n`;

    return buildToolResponse(text, data);
  },
};

export const migrationCutoverTool: ToolDefinition = {
  name: "lamsuite_migration_cutover",
  description:
    "Perform final cutover for a store after verifying reconciliation. Requires exact confirmation phrase (e.g. CUTOVER-<STORE_CODE>).",
  inputSchema: z.object({
    uuid: z.string().describe("Migration run UUID"),
    confirmation_phrase: z.string().describe("Store cutover confirmation phrase e.g. CUTOVER-STR001"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  requiredPermission: "store:write",
  isWriteTool: true,
  handler: async (args, { client }) => {
    const res = await (client as any).post(`/admin/migrations/${args.uuid}/cutover`, {
      confirmation_phrase: args.confirmation_phrase,
    });
    const data = res.data || res;

    return buildToolResponse(`🎉 **Cutover Completed Successfully!**\n\n${data.message}`, data);
  },
};
