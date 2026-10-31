import { describe, it, expect } from "vitest";
import {
  parseExpiryInput,
  parseQuantityEntry,
  calculateLineMargin,
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
      // purchase rate 100, selling rate 150
      const res = calculateLineMargin(100, 150, 1);
      expect(res.effectiveUnitCost).toBe(100);
      expect(res.marginPercent).toBeCloseTo(33.3, 1);
      expect(res.isNegative).toBe(false);
    });

    it("calculates pack unit cost when units_per_pack > 1", () => {
      // pack rate 200, 10 units/pack -> unit cost 20. selling rate 25 per unit
      const res = calculateLineMargin(200, 25, 10);
      expect(res.effectiveUnitCost).toBe(20);
      expect(res.marginPercent).toBe(20);
      expect(res.isNegative).toBe(false);
    });

    it("flags negative margin when selling rate is below purchase cost", () => {
      // purchase rate 100, selling rate 80
      const res = calculateLineMargin(100, 80, 1);
      expect(res.isNegative).toBe(true);
      expect(res.marginPercent).toBe(-25);
    });
  });
});
