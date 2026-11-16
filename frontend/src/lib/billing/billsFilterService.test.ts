import { describe, expect, it } from "vitest";
import {
  BILLS_PAYMENT_MODES,
  BILLS_PERIODS,
  BILLS_STATUSES,
  cycleValue,
  isBillsPeriod,
  resolveBillsPeriod,
} from "./billsFilterService";

describe("bills filters", () => {
  it("lets a user's pinned period override the store-owner default", () => {
    expect(resolveBillsPeriod("month", "all")).toBe("month");
  });

  it("falls back to the store-owner default when nothing is pinned", () => {
    expect(resolveBillsPeriod(undefined, "last7days")).toBe("last7days");
    expect(resolveBillsPeriod(null, "yesterday")).toBe("yesterday");
  });

  it("ignores invalid values and settles on today", () => {
    expect(resolveBillsPeriod("decade", "quarter")).toBe("today");
    expect(resolveBillsPeriod(42, false)).toBe("today");
  });

  it("recognises only supported periods", () => {
    expect(isBillsPeriod("last7days")).toBe(true);
    expect(isBillsPeriod("Last 7 Days")).toBe(false);
    expect(isBillsPeriod(null)).toBe(false);
  });

  it("cycles periods in both directions and wraps around", () => {
    expect(cycleValue(BILLS_PERIODS, "today", 1)).toBe("yesterday");
    expect(cycleValue(BILLS_PERIODS, "all", 1)).toBe("today");
    expect(cycleValue(BILLS_PERIODS, "today", -1)).toBe("all");
    expect(cycleValue(BILLS_PERIODS, "month", -1)).toBe("last7days");
  });

  it("cycles payment and status filters with a sane entry point", () => {
    expect(BILLS_PAYMENT_MODES).toContain("Credit");
    expect(cycleValue(BILLS_PAYMENT_MODES, "all", 1)).toBe("Cash");
    expect(cycleValue(BILLS_PAYMENT_MODES, "Bank Transfer", 1)).toBe("all");

    expect(BILLS_STATUSES).toEqual(["all", "issued", "cancelled"]);
    expect(cycleValue(BILLS_STATUSES, "cancelled", 1)).toBe("all");
  });

  it("keeps the documented shortcut cycle order", () => {
    expect(BILLS_PERIODS).toEqual(["today", "yesterday", "last7days", "month", "all"]);
  });
});
