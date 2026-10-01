import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { formatINR, buildToolResponse } from "../../utils/formatters.js";
import { maskPhoneNumber } from "../../security/mask.js";

export const searchCustomersTool: ToolDefinition = {
  name: "lamsuite_search_customers",
  description: "Search customers by name or phone number. Returns compact directory summaries.",
  inputSchema: z.object({
    query: z.string().optional().describe("Customer name or phone number search query"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results (default 20)"),
    cursor: z.string().optional().describe("Pagination page or cursor"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "customers:read",
  isWriteTool: false,
  handler: async (args, { client, config }) => {
    const page = args.cursor ? parseInt(args.cursor, 10) : 1;
    const res = await client.getCustomers({
      query: args.query,
      page: isNaN(page) ? 1 : page,
      limit: args.limit,
    });

    const customers = res.data || [];
    let summary = `### Customer Directory (${customers.length} found):\n\n`;

    if (customers.length === 0) {
      summary += "No customers found matching the search query.";
    } else {
      summary += "| Customer ID | Name | Phone | Outstanding Balance | Credit Limit |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const c of customers) {
        const maskedPhone = maskPhoneNumber(c.phone, config.role);
        summary += `| \`${c.id}\` | ${c.name} | ${maskedPhone} | ${formatINR(c.outstanding_balance || 0)} | ${formatINR(c.credit_limit || 0)} |\n`;
      }
    }

    const sanitizedData = customers.map((c) => ({
      ...c,
      phone: maskPhoneNumber(c.phone, config.role),
    }));

    return buildToolResponse(summary, {
      customers: sanitizedData,
      count: customers.length,
      total: res.total,
    });
  },
};

export const getCustomerTool: ToolDefinition = {
  name: "lamsuite_get_customer",
  description: "Get detailed profile and credit balance for a customer by customer ID or phone.",
  inputSchema: z.object({
    customer_id: z.string().optional().describe("Customer ID (e.g. 'cust_1')"),
    phone: z.string().optional().describe("Customer 10-digit phone number"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "customers:read",
  isWriteTool: false,
  handler: async (args, { client, config }) => {
    const idOrPhone = args.customer_id || args.phone;
    if (!idOrPhone) {
      throw new Error("Either 'customer_id' or 'phone' must be provided.");
    }

    const c = await client.getCustomer(idOrPhone);
    const maskedPhone = maskPhoneNumber(c.phone, config.role);

    let summary = `### Customer Profile: ${c.name}\n`;
    summary += `- **Customer ID**: \`${c.id}\`\n`;
    summary += `- **Phone**: ${maskedPhone}\n`;
    if (c.gstin) summary += `- **GSTIN**: \`${c.gstin}\`\n`;
    if (c.address) summary += `- **Address**: ${c.address}\n`;
    summary += `- **Current Outstanding Balance**: **${formatINR(c.outstanding_balance || 0)}**\n`;
    summary += `- **Credit Limit**: ${formatINR(c.credit_limit || 0)}\n`;
    summary += `- **Account Status**: ${c.is_active ? "Active" : "Suspended"}\n`;

    const sanitizedCustomer = {
      ...c,
      phone: maskedPhone,
    };

    return buildToolResponse(summary, {
      customer: sanitizedCustomer,
      currency: "INR",
    });
  },
};

export const searchSuppliersTool: ToolDefinition = {
  name: "lamsuite_search_suppliers",
  description: "Search pharmaceutical distributors and suppliers by name or GSTIN.",
  inputSchema: z.object({
    query: z.string().optional().describe("Supplier name or GSTIN search query"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results (default 20)"),
    cursor: z.string().optional().describe("Pagination page or cursor"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "suppliers:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const page = args.cursor ? parseInt(args.cursor, 10) : 1;
    const res = await client.getSuppliers({
      query: args.query,
      page: isNaN(page) ? 1 : page,
      limit: args.limit,
    });

    const suppliers = res.data || [];
    let summary = `### Supplier Directory (${suppliers.length} found):\n\n`;

    if (suppliers.length === 0) {
      summary += "No suppliers found.";
    } else {
      summary += "| Supplier ID | Name | GSTIN | Credit Period | Outstanding Balance |\n";
      summary += "| --- | --- | --- | --- | --- |\n";
      for (const s of suppliers) {
        summary += `| \`${s.id}\` | ${s.name} | \`${s.gstin || "N/A"}\` | ${s.credit_period_days || 0} days | ${formatINR(s.outstanding_balance || 0)} |\n`;
      }
    }

    return buildToolResponse(summary, {
      suppliers,
      count: suppliers.length,
      total: res.total,
    });
  },
};

export const getSupplierTool: ToolDefinition = {
  name: "lamsuite_get_supplier",
  description: "Get full profile, credit terms, and payable balance for a supplier by ID.",
  inputSchema: z.object({
    supplier_id: z.string().describe("Supplier ID (e.g. 'sup_1')"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "suppliers:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    const s = await client.getSupplier(args.supplier_id);

    let summary = `### Supplier Profile: ${s.name}\n`;
    summary += `- **Supplier ID**: \`${s.id}\`\n`;
    summary += `- **GSTIN**: \`${s.gstin || "N/A"}\`\n`;
    if (s.phone) summary += `- **Contact**: ${s.phone}\n`;
    if (s.address) summary += `- **Address**: ${s.address}\n`;
    summary += `- **Credit Period**: ${s.credit_period_days || 0} days\n`;
    summary += `- **Outstanding Payable**: **${formatINR(s.outstanding_balance || 0)}**\n`;

    return buildToolResponse(summary, {
      supplier: s,
      currency: "INR",
    });
  },
};
