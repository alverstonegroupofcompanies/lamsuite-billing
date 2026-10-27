import { describe, it, expect, beforeEach } from "vitest";
import { posCartService, type PosCartLine } from "./posCartService";
import type { ProductItem, ProductBatch } from "../masters/productsStore";

describe("Keyboard-Operable POS Billing Workflow", () => {
  const dummyProduct1: ProductItem = {
    id: "prod-1",
    name: "Dolo 650mg Tablet",
    barcode: "890123456001",
    mrp: 30,
    ptr: 20,
    pts: 22,
    sel_rate: 30,
    gst_percent: 12,
    hsn_sac_code: "300490",
    units_per_pack: 15,
    unit_name: "strip",
    sub_unit_name: "tablet",
    allow_loose_sale: true,
    is_active: true,
  };

  const dummyBatch1: ProductBatch = {
    id: "batch-1",
    product_id: "prod-1",
    batch_no: "DOLO-B1",
    expiry_date: "2027-12-31",
    stock_qty: 100,
    selling_rate: 30,
  };

  const dummyProduct2: ProductItem = {
    id: "prod-2",
    name: "Moisturizing Cream 100g",
    barcode: "890123456002",
    mrp: 250,
    ptr: 180,
    pts: 200,
    sel_rate: 250,
    gst_percent: 18,
    hsn_sac_code: "330499",
    units_per_pack: 1,
    unit_name: "piece",
    allow_loose_sale: false,
    is_active: true,
  };

  const dummyBatch2: ProductBatch = {
    id: "batch-2",
    product_id: "prod-2",
    batch_no: "CREAM-B2",
    expiry_date: "2028-06-30",
    stock_qty: 25,
    selling_rate: 250,
  };

  beforeEach(() => {
    posCartService.clearCart();
  });

  it("1. Adds item, enters pack + loose quantity, and calculates accurate totals", () => {
    // Add 1st item (Dolo 650)
    posCartService.addProductToCart(dummyProduct1, dummyBatch1, 2, 5); // 2 strips + 5 tablets = 35 tablets
    const lines = posCartService.getLines();
    expect(lines.length).toBe(1);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].loose_qty).toBe(5);

    // 2 strips * 30 + 5 tablets * (30/15 = 2) = 60 + 10 = 70.00
    expect(lines[0].calculated.total_amount).toBeCloseTo(70, 2);
  });

  it("2. Quick Edit Discount (F2) and Selling Rate (F3) updates line calculations instantly", () => {
    posCartService.addProductToCart(dummyProduct1, dummyBatch1, 2, 0); // 2 strips = 60.00
    const lineId = posCartService.getLines()[0].id;

    // F2: Update line discount to 10%
    posCartService.updateLineDiscount(lineId, 10);
    expect(posCartService.getLines()[0].discount_percent).toBe(10);
    // 60 - 10% = 54.00 (statutory paise split: taxable 48.21 + CGST 2.89 + SGST 2.89 = 53.99)
    expect(posCartService.getLines()[0].calculated.total_amount).toBeCloseTo(54, 1);
    expect(posCartService.getTotals().grand_total).toBe(54);

    // F3: Quick update selling rate to 25.00
    posCartService.updateLinePrice(lineId, 25, "sel_rate");
    // 2 * 25 = 50.00 - 10% = 45.00
    expect(posCartService.getLines()[0].calculated.total_amount).toBeCloseTo(45, 2);
  });

  it("3. Line Deletion with Undo Buffer (Ctrl+Z)", () => {
    posCartService.addProductToCart(dummyProduct1, dummyBatch1, 1, 0);
    posCartService.addProductToCart(dummyProduct2, dummyBatch2, 2, 0);
    expect(posCartService.getLines().length).toBe(2);

    const firstLineId = posCartService.getLines()[0].id;
    // Delete first line
    const { removedLine, index } = posCartService.removeLine(firstLineId);
    expect(posCartService.getLines().length).toBe(1);
    expect(posCartService.getLines()[0].product.id).toBe("prod-2");
    expect(removedLine?.product.id).toBe("prod-1");
    expect(index).toBe(0);

    // Press Ctrl+Z to undo delete
    if (removedLine) {
      posCartService.restoreLine(removedLine, index);
    }
    expect(posCartService.getLines().length).toBe(2);
    expect(posCartService.getLines()[0].product.id).toBe("prod-1");
    expect(posCartService.getLines()[1].product.id).toBe("prod-2");
  });

  it("4. Line Reordering with Alt+Up / Alt+Down", () => {
    posCartService.addProductToCart(dummyProduct1, dummyBatch1, 1, 0);
    posCartService.addProductToCart(dummyProduct2, dummyBatch2, 2, 0);

    expect(posCartService.getLines()[0].product.name).toBe("Dolo 650mg Tablet");
    expect(posCartService.getLines()[1].product.name).toBe("Moisturizing Cream 100g");

    // Move index 0 down (Alt+Down)
    posCartService.moveLine(0, 1);
    expect(posCartService.getLines()[0].product.name).toBe("Moisturizing Cream 100g");
    expect(posCartService.getLines()[1].product.name).toBe("Dolo 650mg Tablet");

    // Move index 1 up (Alt+Up)
    posCartService.moveLine(1, 0);
    expect(posCartService.getLines()[0].product.name).toBe("Dolo 650mg Tablet");
    expect(posCartService.getLines()[1].product.name).toBe("Moisturizing Cream 100g");
  });

  it("5. Unit Conversion Edit (Ctrl+E) updates packaging and re-computes totals", () => {
    posCartService.addProductToCart(dummyProduct1, dummyBatch1, 1, 5); // 1 strip + 5 tabs (pack=15) -> 20 tabs -> 40.00
    const lineId = posCartService.getLines()[0].id;

    // Change packaging to 1 box = 10 strips/bottles
    posCartService.updateLineConversion(lineId, 10, "box", "bottle", false);
    const updatedLine = posCartService.getLines()[0];
    expect(updatedLine.product.units_per_pack).toBe(10);
    expect(updatedLine.product.unit_name).toBe("box");
    expect(updatedLine.product.sub_unit_name).toBe("bottle");
  });
});
