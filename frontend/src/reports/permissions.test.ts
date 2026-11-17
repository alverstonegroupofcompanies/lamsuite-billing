import { describe, expect, it } from "vitest";
import { canAccessReport } from "./permissions";
import { reportRegistry } from "./registry";

const dailyCollection = reportRegistry.get("daily-collection")!;
const salesRegister = reportRegistry.get("sales-register")!;

describe("Report access control", () => {
  it("denies every report when the store disables the reports menu", () => {
    expect(canAccessReport(dailyCollection, "manager", [])).toBe(false);
    expect(canAccessReport(salesRegister, "store_owner", ["pos", "bills"])).toBe(false);
  });

  it("limits cashiers to the daily collection report", () => {
    expect(canAccessReport(dailyCollection, "cashier", ["reports"])).toBe(true);
    expect(canAccessReport(salesRegister, "cashier", ["reports"])).toBe(false);
  });

  it("grants managers and owners full report access", () => {
    expect(canAccessReport(salesRegister, "manager", ["reports"])).toBe(true);
    expect(canAccessReport(salesRegister, "store_owner", ["reports"])).toBe(true);
    expect(canAccessReport(salesRegister, "support", ["reports"])).toBe(true);
  });

  it("honours explicit permission grants and revokes", () => {
    expect(canAccessReport(salesRegister, "cashier", ["reports"], { reports: ["view"] })).toBe(true);
    expect(canAccessReport(dailyCollection, "manager", ["reports"], { reports: [] })).toBe(false);
    expect(canAccessReport(dailyCollection, "cashier", ["reports"], { purchases: ["view"] })).toBe(true);
  });

  it("keeps super admins above explicit overrides", () => {
    expect(canAccessReport(salesRegister, "super_admin", ["reports"], { reports: [] })).toBe(true);
  });
});
