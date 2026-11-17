import { describe, expect, it } from "vitest";
import {
  canAccessMenu,
  explicitModuleDecision,
  hasModulePermission,
  isAdminRole,
  normalizeRole,
  permissionOverrideCount,
} from "./accessControl";

describe("POS access control", () => {
  it("falls back to role baselines when no explicit permissions exist", () => {
    expect(hasModulePermission({ role: "cashier" }, "billing", "create")).toBe(true);
    expect(hasModulePermission({ role: "cashier" }, "sales", "view")).toBe(true);
    expect(hasModulePermission({ role: "cashier" }, "reports", "view")).toBe(true);
    expect(hasModulePermission({ role: "cashier" }, "purchases", "view")).toBe(false);
    expect(hasModulePermission({ role: "cashier" }, "masters", "view")).toBe(false);
    expect(hasModulePermission({ role: "cashier" }, "settings", "view")).toBe(true);
    expect(hasModulePermission({ role: "cashier" }, "devices", "view")).toBe(true);
    expect(hasModulePermission({ role: "operator" }, "sales", "view")).toBe(true);
    expect(hasModulePermission({ role: "operator" }, "reports", "view")).toBe(false);
  });

  it("treats a missing or unknown role as fully denied", () => {
    expect(hasModulePermission(null, "billing", "view")).toBe(false);
    expect(hasModulePermission({ role: null }, "billing", "view")).toBe(false);
    expect(hasModulePermission({ role: "intern" }, "billing", "view")).toBe(false);
  });

  it("lets explicit grants widen the role baseline", () => {
    const subject = { role: "cashier", permissions: { purchases: ["view", "create"] } };
    expect(hasModulePermission(subject, "purchases", "view")).toBe(true);
    expect(hasModulePermission(subject, "purchases", "create")).toBe(true);
    expect(hasModulePermission(subject, "purchases", "edit")).toBe(false);
  });

  it("lets an explicit empty allow-list revoke a module entirely", () => {
    const subject = { role: "cashier", permissions: { reports: [] } };
    expect(hasModulePermission(subject, "reports", "view")).toBe(false);
    expect(hasModulePermission(subject, "billing", "create")).toBe(true);
  });

  it("supports wildcard, boolean and dotted module permissions", () => {
    expect(hasModulePermission({ role: "cashier", permissions: ["*"] }, "purchases", "delete")).toBe(true);
    expect(hasModulePermission({ role: "cashier", permissions: { sales: true } }, "sales", "delete")).toBe(true);
    expect(hasModulePermission({ role: "cashier", permissions: { sales: false } }, "sales", "view")).toBe(false);
    expect(hasModulePermission({ role: "cashier", permissions: { sales: "sales.view" } }, "sales", "view")).toBe(true);
    expect(hasModulePermission({ role: "cashier", permissions: { sales: ["sales.edit"] } }, "sales", "edit")).toBe(true);
  });

  it("super admins bypass explicit overrides, matching the backend", () => {
    expect(
      hasModulePermission({ role: "super_admin", permissions: { purchases: [] } }, "purchases", "view")
    ).toBe(true);
  });

  it("maps menu ids to the correct module checks", () => {
    expect(canAccessMenu({ role: "cashier" }, "pos")).toBe(true);
    expect(canAccessMenu({ role: "cashier" }, "bills")).toBe(true);
    expect(canAccessMenu({ role: "cashier" }, "purchases")).toBe(false);
    expect(canAccessMenu({ role: "cashier" }, "migration")).toBe(false);
    expect(canAccessMenu({ role: "cashier" }, "not-a-real-menu")).toBe(true);
  });

  it("exposes helper predicates used by the UI", () => {
    expect(explicitModuleDecision({ reports: [] }, "reports", "view")).toBe(false);
    expect(explicitModuleDecision(null, "reports", "view")).toBeUndefined();
    expect(permissionOverrideCount({ reports: [], purchases: ["view"] })).toBe(2);
    expect(permissionOverrideCount(["*"])).toBe(0);
    expect(isAdminRole("store_owner")).toBe(true);
    expect(isAdminRole("cashier")).toBe(false);
    expect(normalizeRole("  Cashier ")).toBe("cashier");
  });
});
