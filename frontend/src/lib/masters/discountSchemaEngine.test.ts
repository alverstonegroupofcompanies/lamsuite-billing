import { describe, it, expect } from "vitest";
import { discountSchemaEngine, type DiscountSchema, type CartLineItem } from "./discountSchemaEngine";

describe("Discount Schema Rule Engine (MST-006)", () => {
  it("applies automated percentage discount to matching product", () => {
    const schemas: DiscountSchema[] = [
      {
        id: "sch_dolo_10",
        name: "10% off on Dolo",
        isActive: true,
        discountType: "percent",
        value: 10,
        productId: "prod_dolo",
      },
    ];

    const line: CartLineItem = {
      productId: "prod_dolo",
      qty: 2,
      unitPrice: 30, // gross: 60
      discountPercent: 0,
      discountAmount: 0,
    };

    const res = discountSchemaEngine.evaluateLineDiscount(line, schemas);
    expect(res.discountPercent).toBe(10);
    expect(res.discountAmount).toBe(6.0);
    expect(res.appliedSchemaId).toBe("sch_dolo_10");
  });

  it("calculates Buy 3 Get 1 Free discount accurately", () => {
    const schemas: DiscountSchema[] = [
      {
        id: "b3g1",
        name: "Buy 3 Get 1 Free",
        isActive: true,
        discountType: "buy_x_get_y",
        value: 0,
        buyQty: 3,
        getQty: 1,
        productId: "prod_soap",
      },
    ];

    // Buying 4 items at ₹50 each (gross ₹200). 1 is free = ₹50 discount.
    const line: CartLineItem = {
      productId: "prod_soap",
      qty: 4,
      unitPrice: 50,
      discountPercent: 0,
      discountAmount: 0,
    };

    const res = discountSchemaEngine.evaluateLineDiscount(line, schemas);
    expect(res.discountAmount).toBe(50);
    expect(res.discountPercent).toBe(25); // 50 / 200 = 25%
  });

  it("does not overwrite cashier manual discount when discountManual is true", () => {
    const schemas: DiscountSchema[] = [
      {
        id: "auto_5",
        name: "5% Promo",
        isActive: true,
        discountType: "percent",
        value: 5,
        productId: "prod_1",
      },
    ];

    const line: CartLineItem = {
      productId: "prod_1",
      qty: 1,
      unitPrice: 100,
      discountPercent: 15,
      discountAmount: 15,
      discountManual: true, // Cashier manually gave 15%
    };

    const res = discountSchemaEngine.evaluateLineDiscount(line, schemas);
    expect(res.discountPercent).toBe(15);
    expect(res.discountAmount).toBe(15);
    expect(res.appliedSchemaId).toBeUndefined();
  });

  it("ignores promotions that are expired or not yet active", () => {
    const schemas: DiscountSchema[] = [
      {
        id: "promo_expired",
        name: "Past Promo",
        isActive: true,
        discountType: "percent",
        value: 20,
        productId: "prod_1",
        startDate: "2026-01-01",
        endDate: "2026-06-30", // Expired
      },
    ];

    const line: CartLineItem = {
      productId: "prod_1",
      qty: 1,
      unitPrice: 100,
      discountPercent: 0,
      discountAmount: 0,
    };

    const res = discountSchemaEngine.evaluateLineDiscount(line, schemas, "2026-09-30");
    expect(res.discountPercent).toBe(0);
    expect(res.discountAmount).toBe(0);
  });
});
