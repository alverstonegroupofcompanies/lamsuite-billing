import { describe, it, expect } from "vitest";
import { searchItemsTool, getItemTool } from "../../src/tools/read/items.js";
import { createInvoiceTool } from "../../src/tools/write/invoice.js";
import { cancelInvoiceTool } from "../../src/tools/write/cancel.js";
import { createCustomerTool, createItemTool } from "../../src/tools/write/masters.js";
import { createStockAdjustmentTool } from "../../src/tools/write/stock.js";

describe("Tool Zod Schemas Validation", () => {
  it("validates search_items input schema with defaults", () => {
    const valid = searchItemsTool.inputSchema.parse({});
    expect(valid.limit).toBe(20);
    expect(valid.is_active).toBe(true);

    const withQuery = searchItemsTool.inputSchema.parse({
      query: "Dolo",
      limit: 10,
    });
    expect(withQuery.query).toBe("Dolo");
    expect(withQuery.limit).toBe(10);

    // Limit out of bounds
    expect(() => searchItemsTool.inputSchema.parse({ limit: 150 })).toThrow();
  });

  it("validates get_item requires at least an object", () => {
    const res = getItemTool.inputSchema.parse({ id: "prod_1" });
    expect(res.id).toBe("prod_1");
  });

  it("validates create_invoice requires at least 1 item", () => {
    expect(() =>
      createInvoiceTool.inputSchema.parse({
        customer_name: "Walk-in",
        items: [],
      })
    ).toThrow();

    const valid = createInvoiceTool.inputSchema.parse({
      customer_name: "Rahul",
      items: [{ product_id: "prod_1", qty: 2 }],
      payment_mode: "Cash",
    });
    expect(valid.customer_name).toBe("Rahul");
    expect(valid.items[0].qty).toBe(2);
    expect(valid.payment_mode).toBe("Cash");
  });

  it("validates cancel_invoice requires reason and confirm boolean", () => {
    expect(() =>
      cancelInvoiceTool.inputSchema.parse({
        invoice_id: "INV-1000",
      })
    ).toThrow();

    const parsed = cancelInvoiceTool.inputSchema.parse({
      invoice_id: "INV-1000",
      reason: "Wrong patient name entered",
      confirm: true,
    });
    expect(parsed.confirm).toBe(true);
    expect(parsed.reason).toBe("Wrong patient name entered");
  });

  it("validates create_stock_adjustment requires reason and confirm", () => {
    expect(() =>
      createStockAdjustmentTool.inputSchema.parse({
        product_id: "prod_1",
        adjustment_type: "reduce",
        qty: 5,
      })
    ).toThrow();

    const valid = createStockAdjustmentTool.inputSchema.parse({
      product_id: "prod_1",
      batch_no: "B1",
      adjustment_type: "reduce",
      qty: 2,
      reason: "Broken ampoule",
      confirm: true,
    });
    expect(valid.confirm).toBe(true);
    expect(valid.adjustment_type).toBe("reduce");
  });

  it("validates create_customer schema", () => {
    expect(() =>
      createCustomerTool.inputSchema.parse({
        name: "Test",
        phone: "123", // too short
      })
    ).toThrow();

    const valid = createCustomerTool.inputSchema.parse({
      name: "Suresh",
      phone: "9876543210",
      credit_limit: 5000,
    });
    expect(valid.name).toBe("Suresh");
    expect(valid.credit_limit).toBe(5000);
  });

  it("validates create_item schema pricing and GST", () => {
    expect(() =>
      createItemTool.inputSchema.parse({
        name: "Paracetamol",
        barcode: "12345",
        mrp: -10, // negative price
        sel_rate: 10,
      })
    ).toThrow();

    const valid = createItemTool.inputSchema.parse({
      name: "Paracetamol 500mg",
      barcode: "8901234567890",
      mrp: 20,
      sel_rate: 18,
      gst_percent: 12,
    });
    expect(valid.mrp).toBe(20);
    expect(valid.gst_percent).toBe(12);
  });
});
