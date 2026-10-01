import { describe, it, expect } from "vitest";
import {
  hasPermission,
  assertPermission,
  ROLE_PERMISSIONS,
} from "../../src/security/roles.js";

describe("Role & Permissions Matrix", () => {
  it("verifies admin has all permissions", () => {
    const adminPermissions = ROLE_PERMISSIONS["admin"];
    expect(adminPermissions).toContain("invoices:cancel");
    expect(adminPermissions).toContain("stock:adjust");
    expect(adminPermissions).toContain("items:update_price");
    expect(adminPermissions).toContain("customers:view_pii");
    expect(hasPermission("admin", "invoices:cancel")).toBe(true);
  });

  it("verifies cashier cannot cancel invoice or adjust stock", () => {
    expect(hasPermission("cashier", "invoices:create")).toBe(true);
    expect(hasPermission("cashier", "items:read")).toBe(true);
    expect(hasPermission("cashier", "invoices:cancel")).toBe(false);
    expect(hasPermission("cashier", "stock:adjust")).toBe(false);
    expect(hasPermission("cashier", "items:update_price")).toBe(false);
    expect(hasPermission("cashier", "customers:view_pii")).toBe(false);

    expect(() =>
      assertPermission("cashier", "invoices:cancel", "cancel invoice")
    ).toThrow(/Permission denied/);
  });

  it("verifies auditor is strictly read-only", () => {
    const auditorPerms = ROLE_PERMISSIONS["auditor"];
    for (const p of auditorPerms) {
      expect(p.endsWith(":read") || p === "reports:financial").toBe(true);
      expect(p.endsWith(":write")).toBe(false);
      expect(p.endsWith(":create")).toBe(false);
      expect(p.endsWith(":cancel")).toBe(false);
      expect(p.endsWith(":adjust")).toBe(false);
    }
  });

  it("verifies pharmacist can create invoices, purchases, but cannot adjust stock without manager/admin", () => {
    expect(hasPermission("pharmacist", "invoices:create")).toBe(true);
    expect(hasPermission("pharmacist", "purchases:create")).toBe(true);
    expect(hasPermission("pharmacist", "stock:adjust")).toBe(false);
  });
});
