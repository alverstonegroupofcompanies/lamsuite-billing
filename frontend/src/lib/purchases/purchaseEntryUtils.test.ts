import { describe, it, expect } from "vitest";
import {
  parseExpiryInput,
  parseQuantityEntry,
  calculateLineMargin,
  isValidHsn,
  suggestGstForHsn,
} from "./purchaseEntryUtils";

describe("Purchase Entry Utils (Expiry, Quantity Shorthand & Margins)", () => {
  describe("parseExpiryInput", () => {
    const referenceDate = new Date("2026-10-31T00:00:00Z");

    it("parses 4-digit MMYY format e.g. 0528 to last day of month ISO", () => {
      const res = parseExpiryInput("0528", referenceDate);
      expect(res.isValid).toBe(true);
      expect(res.isoDate).toBe("2028-05-31");
      expect(res.display).toBe("05/28");
      expect(res.isExpired).toBe(false);
      expect(res.isNearExpiry).toBe(false);
    });

    it("parses slash format MM/YY e.g. 12/27", () => {
      const res = parseExpiryInput("12/27", referenceDate);
      expect(res.isValid).toBe(true);
      expect(res.isoDate).toBe("2027-12-31");
      expect(res.display).toBe("12/27");
      expect(res.isExpired).toBe(false);
    });

    it("detects expired date in the past", () => {
      const res = parseExpiryInput("0124", referenceDate); // Jan 2024
      expect(res.isValid).toBe(true);
      expect(res.isExpired).toBe(true);
    });

    it("detects near-expiry date within 90 days", () => {
      const res = parseExpiryInput("1126", referenceDate); // Nov 2026 (approx 30 days ahead of Oct 31, 2026)
      expect(res.isValid).toBe(true);
      expect(res.isExpired).toBe(false);
      expect(res.isNearExpiry).toBe(true);
    });

    it("flags invalid month > 12", () => {
      const res = parseExpiryInput("1528", referenceDate);
      expect(res.isValid).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe("parseQuantityEntry", () => {
    it("parses standard integer quantity", () => {
      const res = parseQuantityEntry("25");
      expect(res.packs).toBe(25);
      expect(res.loose).toBe(0);
      expect(res.free).toBe(0);
    });

    it("parses pack + loose quantity e.g. 2+5", () => {
      const res = parseQuantityEntry("2+5", true);
      expect(res.packs).toBe(2);
      expect(res.loose).toBe(5);
      expect(res.free).toBe(0);
    });

    it("parses billed + free scheme quantity e.g. 10+2", () => {
      const res = parseQuantityEntry("10+2", false);
      expect(res.packs).toBe(10);
      expect(res.free).toBe(2);
      expect(res.loose).toBe(0);
    });
  });

  describe("calculateLineMargin", () => {
    it("calculates positive healthy margin", () => {
      // purchase rate 100, selling rate 150, same unit, no tax
      const res = calculateLineMargin(100, 150);
      expect(res.effectiveUnitCost).toBe(100);
      expect(res.marginPercent).toBeCloseTo(33.3, 1);
      expect(res.isNegative).toBe(false);
    });

    it("compares a pack's cost with its selling price instead of dividing only the cost (PUR-04)", () => {
      // A strip bought at 200 and sold at 250 is a 20% margin, whatever the pack holds.
      const res = calculateLineMargin(200, 250);
      expect(res.effectiveUnitCost).toBe(200);
      expect(res.marginPercent).toBe(20);
      expect(res.isNegative).toBe(false);
    });

    it("takes GST out of the selling price before comparing (PUR-04)", () => {
      // Pack of 15, cost 60, sell 90 incl 12% -> ex-tax 80.36 -> 25.3%
      const res = calculateLineMargin(60, 90, 12);
      expect(res.effectiveUnitCost).toBe(60);
      expect(res.marginPercent).toBeCloseTo(25.33, 1);
      expect(res.isNegative).toBe(false);
    });

    it("flags negative margin when selling rate is below purchase cost", () => {
      // purchase rate 100, selling rate 80
      const res = calculateLineMargin(100, 80);
      expect(res.isNegative).toBe(true);
      expect(res.marginPercent).toBe(-25);
    });

    it("flags negative margin once GST is removed from a near-cost price", () => {
      // 90 incl 12% is 80.36 ex-tax against an 85 cost
      const res = calculateLineMargin(85, 90, 12);
      expect(res.isNegative).toBe(true);
    });

    it("does not de-gross a GST-exclusive selling rate (PUR-04, exclusive-mode store)", () => {
      // ₹90 ex-tax against a ₹60 ex-tax cost: (90 - 60) / 90 = 33.3%.
      const res = calculateLineMargin(60, 90, 12, false);
      expect(res.marginPercent).toBeCloseTo(33.3, 1);
      expect(res.isNegative).toBe(false);
    });
  });

  describe("isValidHsn (item 26)", () => {
    it("accepts 4, 6 and 8 digit codes and ignores separators", () => {
      expect(isValidHsn("3004")).toBe(true);
      expect(isValidHsn("300490")).toBe(true);
      expect(isValidHsn("3004 90 99")).toBe(true);
    });

    it("rejects empty, short and long codes", () => {
      expect(isValidHsn("")).toBe(false);
      expect(isValidHsn("30")).toBe(false);
      expect(isValidHsn("30045")).toBe(false);
      expect(isValidHsn("300490999")).toBe(false);
    });
  });

  describe("suggestGstForHsn (item 26)", () => {
    it("suggests 12% for pharma chapters 3003/3004", () => {
      expect(suggestGstForHsn("30049099")).toBe(12);
      expect(suggestGstForHsn("3003")).toBe(12);
    });

    it("suggests 5% for food and textiles chapters", () => {
      expect(suggestGstForHsn("0401")).toBe(5);
      expect(suggestGstForHsn("1006")).toBe(5);
      expect(suggestGstForHsn("5208")).toBe(5);
    });

    it("suggests 18% for machinery and 28% for automobiles", () => {
      expect(suggestGstForHsn("8471")).toBe(18);
      expect(suggestGstForHsn("8703")).toBe(28);
    });

    it("returns null when the code is too short or chapter is unknown", () => {
      expect(suggestGstForHsn("30")).toBeNull();
      expect(suggestGstForHsn("9999")).toBeNull();
    });
  });
});
