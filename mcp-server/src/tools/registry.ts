import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition, ToolContext } from "./types.js";
import { assertPermission } from "../security/roles.js";
import { auditLogger } from "../security/audit.js";
import { RateLimiter } from "../security/rateLimiter.js";
import { McpToolError } from "../client/errors.js";

// Read tools
import {
  searchItemsTool,
  getItemTool,
  lowStockTool,
  nearExpiryTool,
  expiredStockTool,
} from "./read/items.js";
import {
  searchCustomersTool,
  getCustomerTool,
  searchSuppliersTool,
  getSupplierTool,
} from "./read/customers.js";
import {
  searchInvoicesTool,
  getInvoiceTool,
  searchPurchasesTool,
  getPurchaseTool,
  listReturnsTool,
} from "./read/invoices.js";
import {
  salesSummaryTool,
  topSellingItemsTool,
  cashBookTool,
  dailySummaryTool,
  profitReportTool,
} from "./read/reports.js";
import { gstReportTool, outstandingReportTool } from "./read/gst.js";
import { stockLedgerTool, stockBalanceTool } from "./read/stock.js";

// Write tools
import { createInvoiceTool } from "./write/invoice.js";
import {
  createCustomerTool,
  createItemTool,
  updateItemPriceTool,
} from "./write/masters.js";
import {
  recordCustomerPaymentTool,
  recordSupplierPaymentTool,
} from "./write/payments.js";
import {
  createSalesReturnTool,
  createPurchaseReturnTool,
} from "./write/returns.js";
import { createStockAdjustmentTool } from "./write/stock.js";
import { cancelInvoiceTool } from "./write/cancel.js";
import { createPurchaseTool } from "./write/purchase.js";
import { getImportTemplateTool, exportDataTool } from "./read/dataExchange.js";
import { importDataTool } from "./write/dataExchange.js";
import {
  migrationPrecheckTool,
  migrationStartTool,
  migrationReconcileTool,
  migrationRollbackTool,
  migrationCutoverTool,
} from "./write/migrationTools.js";

export const ALL_READ_TOOLS: ToolDefinition[] = [
  getImportTemplateTool,
  exportDataTool,
  searchItemsTool,
  getItemTool,
  lowStockTool,
  nearExpiryTool,
  expiredStockTool,
  searchCustomersTool,
  getCustomerTool,
  searchSuppliersTool,
  getSupplierTool,
  searchInvoicesTool,
  getInvoiceTool,
  searchPurchasesTool,
  getPurchaseTool,
  listReturnsTool,
  salesSummaryTool,
  topSellingItemsTool,
  cashBookTool,
  dailySummaryTool,
  profitReportTool,
  gstReportTool,
  outstandingReportTool,
  stockLedgerTool,
  stockBalanceTool,
  migrationPrecheckTool,
  migrationReconcileTool,
];

export const ALL_WRITE_TOOLS: ToolDefinition[] = [
  createInvoiceTool,
  createCustomerTool,
  createItemTool,
  updateItemPriceTool,
  recordCustomerPaymentTool,
  recordSupplierPaymentTool,
  createSalesReturnTool,
  createPurchaseReturnTool,
  createStockAdjustmentTool,
  cancelInvoiceTool,
  createPurchaseTool,
  importDataTool,
  migrationStartTool,
  migrationRollbackTool,
  migrationCutoverTool,
];

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private rateLimiter: RateLimiter;

  constructor(rateLimitRpm: number = 120) {
    this.rateLimiter = new RateLimiter(rateLimitRpm);
  }

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  init(readOnly: boolean): void {
    this.tools.clear();
    // Register all read tools unconditionally
    for (const tool of ALL_READ_TOOLS) {
      this.registerTool(tool);
    }

    // Only register write tools when read-only mode is DISABLED
    if (!readOnly) {
      for (const tool of ALL_WRITE_TOOLS) {
        this.registerTool(tool);
      }
    }
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): any[] {
    const list: any[] = [];
    for (const tool of this.tools.values()) {
      const jsonSchema = zodToJsonSchema(tool.inputSchema as any, {
        target: "jsonSchema7",
      }) as any;

      // Clean schema structure for standard MCP compatibility
      const { $schema, ...cleanInputSchema } = jsonSchema;

      list.push({
        name: tool.name,
        description: tool.description,
        inputSchema: cleanInputSchema,
        annotations: tool.annotations,
      });
    }
    return list;
  }

  async executeTool(name: string, rawArgs: any, ctx: ToolContext): Promise<any> {
    const tool = this.tools.get(name);
    const startTime = Date.now();

    if (!tool) {
      const isWriteTool = ALL_WRITE_TOOLS.some((t) => t.name === name);
      if (isWriteTool && ctx.config.readOnly) {
        const errorMsg = `Tool '${name}' is not available because the server is operating in READ-ONLY mode (LAMSUITE_READ_ONLY=true). To enable write operations, configure LAMSUITE_READ_ONLY=false.`;
        auditLogger.log({
          tool: name,
          args: rawArgs || {},
          user: { role: ctx.config.role, storeId: ctx.config.storeId },
          result: "error",
          durationMs: Date.now() - startTime,
          errorMessage: errorMsg,
        });
        return {
          content: [{ type: "text", text: `❌ ${errorMsg}` }],
          isError: true,
        };
      }

      throw new McpToolError(`Unknown tool: ${name}`, "TOOL_NOT_FOUND", 404);
    }

    // 1. Rate Limiting Check
    const rateCheck = this.rateLimiter.check(ctx.config.role);
    if (!rateCheck.allowed) {
      const errorMsg = `Rate limit exceeded. Maximum ${ctx.config.rateLimitRpm} requests per minute allowed. Please wait ${rateCheck.retryAfterSeconds}s before retrying.`;
      auditLogger.log({
        tool: name,
        args: rawArgs || {},
        user: { role: ctx.config.role, storeId: ctx.config.storeId },
        result: "error",
        durationMs: Date.now() - startTime,
        errorMessage: errorMsg,
      });
      return {
        content: [{ type: "text", text: `⏳ ${errorMsg}` }],
        isError: true,
      };
    }

    try {
      // 2. Role Permission Verification
      assertPermission(ctx.config.role, tool.requiredPermission, tool.name);

      // 3. Zod Input Schema Validation
      const parsedArgs = tool.inputSchema.parse(rawArgs || {});

      // 4. Handler Execution
      const result = await tool.handler(parsedArgs, ctx);

      // 5. Audit Logging (Success)
      auditLogger.log({
        tool: name,
        args: parsedArgs,
        user: { role: ctx.config.role, storeId: ctx.config.storeId },
        result: "success",
        durationMs: Date.now() - startTime,
      });

      return result;
    } catch (err: any) {
      const errorMsg = err.message || "An unexpected error occurred.";
      auditLogger.log({
        tool: name,
        args: rawArgs || {},
        user: { role: ctx.config.role, storeId: ctx.config.storeId },
        result: "error",
        durationMs: Date.now() - startTime,
        errorMessage: errorMsg,
      });

      return {
        content: [
          {
            type: "text",
            text: `❌ Error in ${name}: ${errorMsg}`,
          },
        ],
        isError: true,
      };
    }
  }
}
