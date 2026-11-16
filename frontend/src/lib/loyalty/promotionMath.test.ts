import { describe, expect, it } from "vitest";
import {
  combineBillDiscount,
  computePointsDiscount,
  manualDiscountAmount,
  netBaseAmount,
} from "./promotionMath";

describe("promotion math", () => {
  it("computes net base after line discounts", () => {
    expect(netBaseAmount({ gross_subtotal: 1000, line_discount_total: 150 })).toBe(850);
    expect(netBaseAmount({ line_discount_total: 20 })).toBe(0);
  });

  it("converts percent manual discounts to amounts", () => {
    expect(manualDiscountAmount({ type: "percent", value: 10 }, 500)).toBe(50);
    expect(manualDiscountAmount({ type: "percent", value: 150 }, 500)).toBe(500);
    expect(manualDiscountAmount({ type: "amount", value: 75.555 }, 500)).toBe(75.56);
  });

  it("combines manual, coupon and point discounts", () => {
    expect(combineBillDiscount(1000, { type: "amount", value: 50 }, [100, 25])).toBe(175);
    expect(combineBillDiscount(1000, { type: "percent", value: 10 }, [50])).toBe(150);
  });

  it("caps the combined discount at the net base", () => {
    expect(combineBillDiscount(200, { type: "amount", value: 150 }, [100])).toBe(200);
  });

  it("ignores negative or invalid extras", () => {
    expect(combineBillDiscount(500, { type: "amount", value: 10 }, [-50, Number.NaN])).toBe(10);
  });

  it("computes point redemption value capped by bill base", () => {
    expect(computePointsDiscount(200, 0.5, 1000)).toBe(100);
    expect(computePointsDiscount(200, 0.5, 80)).toBe(80);
    expect(computePointsDiscount(0, 0.5, 100)).toBe(0);
    expect(computePointsDiscount(200, 0, 100)).toBe(0);
  });
});
