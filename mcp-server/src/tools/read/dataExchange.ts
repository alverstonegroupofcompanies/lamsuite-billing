import { z } from "zod";
import type { ToolDefinition } from "../types.js";
import { buildToolResponse } from "../../utils/formatters.js";

export const getImportTemplateTool: ToolDefinition = {
  name: "lamsuite_get_import_template",
  description:
    "Retrieve statutory Excel/CSV template specifications and sample rows for LamSuite data exchange (items, customers, suppliers, opening stock, invoices).",
  inputSchema: z.object({
    entity_type: z
      .enum(["items", "customers", "suppliers", "batches", "sales_invoices", "purchases"])
      .describe("Target data type"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:read",
  isWriteTool: false,
  handler: async (args) => {
    const templates: Record<string, { fields: string[]; sample: Record<string, any> }> = {
      items: {
        fields: [
          "barcode",
          "name",
          "print_name",
          "generic_name",
          "hsn_sac_code",
          "gst_percent",
          "mrp",
          "sel_rate",
          "ptr",
          "units_per_pack",
          "rack_location",
          "category_name",
          "brand_name",
          "unit_name",
        ],
        sample: {
          barcode: "8901030012345",
          name: "Paracetamol 500mg Strip of 10",
          hsn_sac_code: "30049099",
          gst_percent: 12,
          mrp: 35.0,
          sel_rate: 32.0,
          ptr: 22.5,
          units_per_pack: 10,
          unit_name: "STRIP",
        },
      },
      customers: {
        fields: ["name", "phone", "gstin", "address", "place_of_supply", "credit_limit", "outstanding_balance"],
        sample: {
          name: "Rahul Sharma",
          phone: "9876543210",
          gstin: "32AAAAA0000A1Z5",
          place_of_supply: "Kerala",
          credit_limit: 10000,
        },
      },
      suppliers: {
        fields: ["name", "gstin", "phone", "address", "state_code", "credit_period_days", "opening_balance"],
        sample: {
          name: "Apex Pharma Distributors",
          gstin: "32ABCDE9999Z1Z4",
          phone: "9847000111",
          credit_period_days: 30,
        },
      },
      batches: {
        fields: ["product_barcode", "batch_no", "expiry_date", "mfg_date", "stock_qty", "purchase_rate", "mrp", "selling_rate"],
        sample: {
          product_barcode: "8901030012345",
          batch_no: "B-2026A",
          expiry_date: "31-12-2027",
          stock_qty: 100,
          purchase_rate: 22.5,
          mrp: 35.0,
          selling_rate: 32.0,
        },
      },
      sales_invoices: {
        fields: ["invoice_number", "invoice_date", "customer_name", "subtotal", "tax_total", "grand_total", "payment_mode"],
        sample: {
          invoice_number: "INV-2026-0001",
          invoice_date: "10-10-2026",
          customer_name: "Cash Customer",
          subtotal: 1000.0,
          tax_total: 120.0,
          grand_total: 1120.0,
          payment_mode: "cash",
        },
      },
      purchases: {
        fields: ["purchase_number", "supplier_name", "supplier_invoice_no", "purchase_date", "subtotal", "tax_total", "grand_total"],
        sample: {
          purchase_number: "PUR-2026-0001",
          supplier_name: "Apex Pharma Distributors",
          supplier_invoice_no: "APX-8849",
          purchase_date: "08-10-2026",
          subtotal: 15000.0,
          tax_total: 1800.0,
          grand_total: 16800.0,
        },
      },
    };

    const t = templates[args.entity_type];
    let summary = `📋 **Import Template Specification: ${args.entity_type}**\n\n`;
    summary += `**Header Fields:**\n\`${t.fields.join(", ")}\`\n\n`;
    summary += `**Sample Record:**\n\`\`\`json\n${JSON.stringify(t.sample, null, 2)}\n\`\`\``;

    return buildToolResponse(summary, {
      entity_type: args.entity_type,
      fields: t.fields,
      sample_record: t.sample,
    });
  },
};

export const exportDataTool: ToolDefinition = {
  name: "lamsuite_export_data",
  description:
    "Export LamSuite catalog, customer, supplier, invoice, or purchase data for round-trip analysis or backup.",
  inputSchema: z.object({
    entity_type: z
      .enum(["items", "customers", "suppliers", "invoices", "purchases"])
      .describe("Entity to export"),
    format: z.enum(["json", "csv"]).default("json").describe("Output format"),
    limit: z.number().int().min(1).max(500).default(50).describe("Maximum rows to return"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  requiredPermission: "items:read",
  isWriteTool: false,
  handler: async (args, { client }) => {
    let rows: any[] = [];
    if (args.entity_type === "items") {
      const res = await client.getProducts({ limit: args.limit });
      rows = res.data || [];
    } else if (args.entity_type === "customers") {
      const res = await client.getCustomers({ limit: args.limit });
      rows = res.data || [];
    } else if (args.entity_type === "suppliers") {
      const res = await client.getSuppliers({ limit: args.limit });
      rows = res.data || [];
    } else if (args.entity_type === "invoices") {
      const res = await client.getInvoices({ limit: args.limit });
      rows = res.data || [];
    } else if (args.entity_type === "purchases") {
      const res = await client.getPurchases({ limit: args.limit });
      rows = res.data || [];
    }

    if (args.format === "csv" && rows.length > 0) {
      const headers = Object.keys(rows[0]);
      const csvLines = [headers.join(",")];
      for (const row of rows) {
        csvLines.push(headers.map((h) => JSON.stringify(row[h] ?? "")).join(","));
      }
      return buildToolResponse(`Exported ${rows.length} ${args.entity_type} records in CSV format:\n\n\`\`\`csv\n${csvLines.join("\n")}\n\`\`\``, {
        entity_type: args.entity_type,
        format: "csv",
        count: rows.length,
        csv: csvLines.join("\n"),
      });
    }

    return buildToolResponse(`Exported ${rows.length} ${args.entity_type} records.`, {
      entity_type: args.entity_type,
      format: "json",
      count: rows.length,
      rows,
    });
  },
};
