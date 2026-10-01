import { describe, it, expect } from "vitest";
import {
  calculateSingleLine,
  calculateInvoiceTotals,
  calculateLineGross,
  calculateLineDiscount,
} from "../../src/utils/calculations.js";

describe("GST & Billing Calculations Engine", () => {
  it("calculates gross amount with pack and loose units", () => {
    // 2 packs @ 30 + 5 loose out of 10 upp @ 30 = 60 + 15 = 75
    const gross = calculateLineGross(2, 5, 10, 30);
    expect(gross).toBe(75.0);
  });

  it("calculates line discount as percentage and amount", () => {
    expect(calculateLineDiscount(100, 10)).toBe(10.0);
    expect(calculateLineDiscount(100, undefined, 15)).toBe(15.0);
  });

  it("calculates intra-state GST 50/50 CGST and SGST split (inclusive mode)", () => {
    const line = calculateSingleLine(
      {
        qty: 1,
        unit_price: 112.0, // Selling price is 112 inclusive of 12% GST
        gst_percent: 12,
      },
      "32", // Kerala store
      "32ABCDE1234F1Z5", // Kerala customer (Intra-state)
      "inclusive"
    );

    expect(line.gross_amount).toBe(112.0);
    expect(line.taxable_amount).toBe(100.0);
    expect(line.total_tax).toBe(12.0);
    expect(line.cgst_amount).toBe(6.0);
    expect(line.sgst_amount).toBe(6.0);
    expect(line.igst_amount).toBe(0.0);
    expect(line.total_amount).toBe(112.0);
  });

  it("calculates inter-state GST with 100% IGST", () => {
    const line = calculateSingleLine(
      {
        qty: 1,
        unit_price: 112.0,
        gst_percent: 12,
      },
      "32", // Kerala store
      "29ABCDE1234F1Z5", // Karnataka customer (Inter-state)
      "inclusive"
    );

    expect(line.cgst_amount).toBe(0.0);
    expect(line.sgst_amount).toBe(0.0);
    expect(line.igst_amount).toBe(12.0);
  });

  it("calculates invoice totals with round-off correctly", () => {
    const lines = [
      calculateSingleLine({ qty: 1, unit_price: 100.35, gst_percent: 0 }, "32", "32", "inclusive"),
    ];
    const totals = calculateInvoiceTotals(lines, 0, 0);

    expect(totals.net_before_round).toBe(100.35);
    expect(totals.grand_total).toBe(100);
    expect(totals.round_off).toBe(-0.35);
  });
});
