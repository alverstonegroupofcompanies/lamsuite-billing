import { describe, it, expect } from "vitest";
import {
  parseSmartQty,
  normalizePackLoose,
  formatQuantityDisplay,
  calculateDerivedLooseRate,
  baseUnitsToPackLoose,
  packLooseToBaseUnits,
} from "./unitConversion";

describe("Unit Conversion & Smart Quantity Engine", () => {
  const doloConfig = {
    units_per_pack: 15,
    pack_unit_name: "strip",
    loose_unit_name: "tab",
    allow_loose_sale: true,
  };

  it("handles basic integer pack inputs ('2')", () => {
    const res = parseSmartQty("2", doloConfig);
    expect(res.packs).toBe(2);
    expect(res.loose).toBe(0);
    expect(res.totalBaseUnits).toBe(30);
    expect(res.isNormalized).toBe(false);
  });

  it("handles pack + loose input ('2+5') correctly yielding 35 tablets for Dolo 650 (15s)", () => {
    const res = parseSmartQty("2+5", doloConfig);
    expect(res.packs).toBe(2);
    expect(res.loose).toBe(5);
    expect(res.totalBaseUnits).toBe(35);
    expect(res.isNormalized).toBe(false);
  });

  it("handles standalone loose entry ('0+5' or '+5')", () => {
    const res1 = parseSmartQty("0+5", doloConfig);
    expect(res1.packs).toBe(0);
    expect(res1.loose).toBe(5);
    expect(res1.totalBaseUnits).toBe(5);

    const res2 = parseSmartQty("+5", doloConfig);
    expect(res2.packs).toBe(0);
    expect(res2.loose).toBe(5);
    expect(res2.totalBaseUnits).toBe(5);
  });

  it("auto-normalizes overflow loose quantities ('0+20' -> 1 strip + 5 tabs)", () => {
    const res = parseSmartQty("0+20", doloConfig);
    expect(res.packs).toBe(1);
    expect(res.loose).toBe(5);
    expect(res.totalBaseUnits).toBe(20);
    expect(res.isNormalized).toBe(true);
    expect(res.rawNormalizedText).toBe("1+5");
  });

  it("handles unit suffixes ('10t' and '3s')", () => {
    const res1 = parseSmartQty("10t", doloConfig);
    expect(res1.packs).toBe(0);
    expect(res1.loose).toBe(10);
    expect(res1.totalBaseUnits).toBe(10);
    expect(res1.displaySummary).toContain("10 tabs");

    const res2 = parseSmartQty("3s", doloConfig);
    expect(res2.packs).toBe(3);
    expect(res2.loose).toBe(0);
    expect(res2.totalBaseUnits).toBe(45);
  });

  it("handles decimal strip inputs ('2.5' with 10 units/pack -> 25 tablets)", () => {
    const config10 = { units_per_pack: 10, allow_loose_sale: true };
    const res = parseSmartQty("2.5", config10);
    expect(res.packs).toBe(2);
    expect(res.loose).toBe(5);
    expect(res.totalBaseUnits).toBe(25);
  });

  it("disallows loose entry when allow_loose_sale is false", () => {
    const noLooseConfig = {
      units_per_pack: 15,
      allow_loose_sale: false,
    };
    const res = parseSmartQty("2+5", noLooseConfig);
    expect(res.packs).toBe(2);
    expect(res.loose).toBe(0);
    expect(res.totalBaseUnits).toBe(30);
  });

  it("handles pack size 1 edge cases gracefully", () => {
    const packSize1Config = {
      units_per_pack: 1,
      pack_unit_name: "bottle",
      loose_unit_name: "bottle",
      allow_loose_sale: false,
    };
    const res = parseSmartQty("3", packSize1Config);
    expect(res.packs).toBe(3);
    expect(res.loose).toBe(0);
    expect(res.totalBaseUnits).toBe(3);
  });

  it("derives loose rates accurately with override support", () => {
    // ₹150 for strip of 15 => ₹10.00 / tab
    expect(calculateDerivedLooseRate(150, 15)).toBe(10);

    // ₹30 for strip of 10 => ₹3.00 / tab
    expect(calculateDerivedLooseRate(30, 10)).toBe(3);

    // ₹25 for strip of 10 => ₹2.50 / tab
    expect(calculateDerivedLooseRate(25, 10)).toBe(2.5);

    // Explicit override (e.g. ₹4.00 / tab)
    expect(calculateDerivedLooseRate(30, 10, 4)).toBe(4);
  });

  it("converts between base units and pack/loose breakdowns", () => {
    const breakdown = baseUnitsToPackLoose(47, 10);
    expect(breakdown.packs).toBe(4);
    expect(breakdown.loose).toBe(7);

    const baseUnits = packLooseToBaseUnits(4, 7, 10);
    expect(baseUnits).toBe(47);
  });

  it("formats quantity display strings across full, short, and label modes", () => {
    expect(formatQuantityDisplay(2, 5, 15, "strip", "tab", "full")).toBe(
      "2 strips + 5 tabs (= 35 tabs)"
    );
    expect(formatQuantityDisplay(2, 5, 15, "strip", "tab", "short")).toBe("2s + 5t");
    expect(formatQuantityDisplay(1, 0, 15, "strip", "tab", "label_only")).toBe("1 strip");
  });
});
