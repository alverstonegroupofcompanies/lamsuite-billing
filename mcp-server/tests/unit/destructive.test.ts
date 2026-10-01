import { describe, it, expect } from "vitest";
import { cancelInvoiceTool } from "../../src/tools/write/cancel.js";
import { createStockAdjustmentTool } from "../../src/tools/write/stock.js";

describe("Destructive Operations Safety Enforcement", () => {
  const dummyCtx: any = {
    client: {},
    config: { role: "admin", storeId: 1, readOnly: false },
  };

  it("cancel_invoice rejects when confirm is false or omitted", async () => {
    await expect(
      cancelInvoiceTool.handler(
        {
          invoice_id: "INV-1000",
          reason: "Customer returned medicines",
          confirm: false as any,
          dry_run: false,
        },
        dummyCtx
      )
    ).rejects.toThrow(/Destructive operation safety block/);
  });

  it("cancel_invoice rejects when reason is whitespace", async () => {
    await expect(
      cancelInvoiceTool.handler(
        {
          invoice_id: "INV-1000",
          reason: "   ",
          confirm: true,
          dry_run: false,
        },
        dummyCtx
      )
    ).rejects.toThrow(/reason/);
  });

  it("create_stock_adjustment rejects when confirm is false", async () => {
    await expect(
      createStockAdjustmentTool.handler(
        {
          product_id: "prod_1",
          adjustment_type: "reduce",
          qty: 2,
          reason: "Expired stock disposal",
          confirm: false as any,
          dry_run: false,
        },
        dummyCtx
      )
    ).rejects.toThrow(/Destructive operation safety block/);
  });
});
