import { describe, it, expect } from "vitest";
import { reverseOriginalLine, type OriginalReturnLine } from "./salesReturnPricing";

const inclusiveLine: OriginalReturnLine = {
  qty: 1,
  loose_qty: 0,
  units_per_pack: 15,
  unit_price: 90,
  gst_percent: 12,
  discount_percent: 0,
  discount_amount: 0,
  taxable_amount: 80.36,
  cgst_amount: 4.82,
  sgst_amount: 4.82,
  igst_amount: 0,
  tax_amount: 9.64,
  total_amount: 90,
};

describe("reverseOriginalLine", () => {
  it("credits a part of an inclusive line without adding tax on top", () => {
    const credit = reverseOriginalLine(inclusiveLine, 15, 0, 5);

    expect(credit.total_amount).toBe(30);
    expect(credit.taxable_amount).toBe(26.79);
    expect(credit.tax_amount).toBe(3.21);
    expect(credit.cgst_amount).toBe(1.61);
    expect(credit.sgst_amount).toBe(1.6);
    expect(credit.igst_amount).toBe(0);
  });

  it("reverses a full return exactly", () => {
    const credit = reverseOriginalLine(inclusiveLine, 15, 0, 15);

    expect(credit.total_amount).toBe(90);
    expect(credit.taxable_amount).toBe(80.36);
    expect(credit.cgst_amount).toBe(4.82);
    expect(credit.sgst_amount).toBe(4.82);
  });

  it("gives the closing return the remainder so partials sum exactly", () => {
    const first = reverseOriginalLine(inclusiveLine, 15, 0, 5);
    const second = reverseOriginalLine(inclusiveLine, 15, 5, 10);

    expect(second.total_amount).toBe(60);
    expect(second.taxable_amount).toBe(53.57);
    expect(second.cgst_amount).toBe(3.21);
    expect(second.sgst_amount).toBe(3.22);

    expect(first.total_amount + second.total_amount).toBe(90);
    expect(Math.round((first.taxable_amount + second.taxable_amount) * 100) / 100).toBe(80.36);
    expect(Math.round((first.cgst_amount + second.cgst_amount) * 100) / 100).toBe(4.82);
    expect(Math.round((first.sgst_amount + second.sgst_amount) * 100) / 100).toBe(4.82);
  });

  it("splits the tax by state when an old line has no component columns", () => {
    const legacy: OriginalReturnLine = {
      ...inclusiveLine,
      taxable_amount: 300,
      cgst_amount: undefined,
      sgst_amount: undefined,
      total_amount: 336,
    };

    const intra = reverseOriginalLine(legacy, 30, 0, 30);
    expect(intra.tax_amount).toBe(36);
    expect(intra.cgst_amount).toBe(18);
    expect(intra.sgst_amount).toBe(18);

    const inter = reverseOriginalLine(legacy, 30, 0, 30, true);
    expect(inter.cgst_amount).toBe(0);
    expect(inter.sgst_amount).toBe(0);
    expect(inter.igst_amount).toBe(36);
  });

  it("credits the discounted value of a discounted line", () => {
    const credit = reverseOriginalLine(
      {
        ...inclusiveLine,
        discount_amount: 9,
        taxable_amount: 72.32,
        cgst_amount: 4.34,
        sgst_amount: 4.34,
        tax_amount: 8.68,
        total_amount: 81,
      },
      15,
      0,
      15
    );

    expect(credit.total_amount).toBe(81);
    expect(credit.taxable_amount).toBe(72.32);
    expect(credit.discount_amount).toBe(9);
  });
});
