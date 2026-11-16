import { describe, expect, it } from "vitest";
import { formatQuantityInput, parseQuantityInput, sanitizeQuantityText } from "./quantityInput";

const strip15 = { units_per_pack: 15, pack_unit_name: "strip", loose_unit_name: "tab" };
const strip10 = { units_per_pack: 10, pack_unit_name: "strip", loose_unit_name: "tab" };
const piece = { units_per_pack: 1, loose_unit_name: "pc" };
const tablet = { units_per_pack: 1, loose_unit_name: "tab", allowDecimal: false };

describe("parseQuantityInput", () => {
  it("accepts whole packs when units_per_pack > 1", () => {
    expect(parseQuantityInput("2", strip15)).toEqual({
      ok: true,
      packs: 2,
      loose: 0,
      totalBaseUnits: 30,
    });
  });

  it("accepts pack + loose input", () => {
    expect(parseQuantityInput("2+5", strip15)).toEqual({
      ok: true,
      packs: 2,
      loose: 5,
      totalBaseUnits: 35,
    });
  });

  it("accepts loose-only input", () => {
    expect(parseQuantityInput("0+5", strip15)).toEqual({
      ok: true,
      packs: 0,
      loose: 5,
      totalBaseUnits: 5,
    });
  });

  it("normalises loose overflow into packs", () => {
    expect(parseQuantityInput("20", strip15)).toEqual({
      ok: true,
      packs: 20,
      loose: 0,
      totalBaseUnits: 300,
    });
    expect(parseQuantityInput("0+20", strip15)).toEqual({
      ok: true,
      packs: 1,
      loose: 5,
      totalBaseUnits: 20,
    });
  });

  it("handles different pack sizes", () => {
    expect(parseQuantityInput("2+5", strip10).totalBaseUnits).toBe(25);
    expect(parseQuantityInput("2+9", strip10).packs).toBe(2);
    expect(parseQuantityInput("2+10", strip10)).toEqual({
      ok: true,
      packs: 3,
      loose: 0,
      totalBaseUnits: 30,
    });
  });

  it("rejects letters and text", () => {
    for (const raw of ["abc", "2a", "2 tab", "two", "1e3"]) {
      const result = parseQuantityInput(raw, strip15);
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    }
  });

  it("rejects negative and zero totals", () => {
    for (const raw of ["-1", "-2+5", "0", "0+0", ""]) {
      expect(parseQuantityInput(raw, strip15).ok).toBe(false);
    }
  });

  it("rejects multiple separators and malformed numbers", () => {
    expect(parseQuantityInput("2+3+4", strip15).ok).toBe(false);
    expect(parseQuantityInput("2..5", strip15).ok).toBe(false);
    expect(parseQuantityInput(".", strip15).ok).toBe(false);
  });

  it("rejects fractional packs when units_per_pack > 1", () => {
    const result = parseQuantityInput("2.5", strip15);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("whole number");
  });

  it("allows decimals only for unit-based products", () => {
    expect(parseQuantityInput("1.5", piece)).toEqual({
      ok: true,
      packs: 1.5,
      loose: 0,
      totalBaseUnits: 1.5,
    });
    expect(parseQuantityInput("1.5", tablet).ok).toBe(false);
  });

  it("rejects pack+loose syntax for products without a pack size", () => {
    const result = parseQuantityInput("2+3", piece);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no pack size");
  });

  it("rejects loose units when the product disallows loose sale", () => {
    const sealed = { units_per_pack: 15, allow_loose_sale: false };
    expect(parseQuantityInput("1", sealed).ok).toBe(true);
    expect(parseQuantityInput("0+5", sealed).ok).toBe(false);
  });

  it("accepts numeric input", () => {
    expect(parseQuantityInput(3, strip15)).toEqual({
      ok: true,
      packs: 3,
      loose: 0,
      totalBaseUnits: 45,
    });
  });
});

describe("sanitizeQuantityText", () => {
  it("strips letters and symbols from pasted text", () => {
    expect(sanitizeQuantityText("2packs+5tabs", strip15)).toBe("2+5");
    expect(sanitizeQuantityText("2 strips", strip15)).toBe("2");
  });

  it("keeps a single plus and a single decimal point", () => {
    expect(sanitizeQuantityText("2++5", strip15)).toBe("2+5");
    expect(sanitizeQuantityText("1..5", piece)).toBe("1.5");
  });

  it("removes the plus for products without a pack size", () => {
    expect(sanitizeQuantityText("2+3", piece)).toBe("2");
  });

  it("clamps decimal precision", () => {
    expect(sanitizeQuantityText("1.234", { units_per_pack: 1, precision: 2 })).toBe("1.23");
  });

  it("keeps the decimal point on whole-pack fields so validation can reject it", () => {
    // Dropping the dot would silently turn 1.2 packs into 12 packs.
    expect(sanitizeQuantityText("1.2", { units_per_pack: 15 })).toBe("1.2");
    expect(parseQuantityInput("1.2", { units_per_pack: 15 }).ok).toBe(false);
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeQuantityText("", strip15)).toBe("");
  });
});

describe("formatQuantityInput", () => {
  it("formats pack products", () => {
    expect(formatQuantityInput(2, 5, 15)).toBe("2+5");
    expect(formatQuantityInput(1, 0, 15)).toBe("1");
  });

  it("formats unit products", () => {
    expect(formatQuantityInput(10, 0, 1)).toBe("10");
  });
});
