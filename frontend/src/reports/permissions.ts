import type { ReportModule } from "./types";
import { explicitModuleDecision, type PermissionSet } from "../lib/auth/accessControl";

/**
 * Validates whether the current user session and store configuration
 * allows accessing the given report module.
 *
 * Rules:
 * 1. Store Menu Check: The store's enabled_menu_items MUST include 'reports' (or the report's menuVisibilityKey).
 * 2. Explicit per-user permissions override role defaults ('reports' module).
 * 3. Role Permission Check:
 *    - super_admin & store_owner: full access to all reports.
 *    - manager: full access to all operational & financial reports.
 *    - accountant: access to sales, purchase, GST, customer ageing, and supplier ledger.
 *    - cashier & pharmacist: limited to daily-collection and pharmacy reports only.
 */
export function canAccessReport(
  report: ReportModule,
  userRole: string = "cashier",
  enabledMenuItems: string[] = ["reports"],
  permissions?: PermissionSet
): boolean {
  // 1. Per-Store Menu Items Check
  const isReportsGloballyEnabled = enabledMenuItems.includes("reports");
  const isSpecificKeyEnabled = enabledMenuItems.includes(report.menuVisibilityKey);

  if (!isReportsGloballyEnabled && !isSpecificKeyEnabled) {
    return false;
  }

  // 2. Explicit per-user permission (grant or revoke) wins over role defaults
  const normalizedRole = userRole.toLowerCase().trim();

  // Super admins bypass overrides, matching backend User::hasPermission
  if (normalizedRole === "super_admin") {
    return true;
  }

  const explicit = explicitModuleDecision(permissions, "reports", "view");
  if (explicit !== undefined) {
    return explicit;
  }

  // 3. Role-Based Access Control (RBAC)

  // Admin and store owner have unrestricted access
  if (normalizedRole === "admin" || normalizedRole === "store_owner") {
    return true;
  }

  // Support is read-only across operational reports
  if (normalizedRole === "support") {
    return true;
  }

  // Manager has access to operational, financial, inventory, and GST reports
  if (normalizedRole === "manager") {
    return true;
  }

  // Accountant has access to financial and statutory reports
  if (normalizedRole === "accountant") {
    return ["sales", "purchase", "gst", "customer", "supplier"].includes(report.category);
  }

  // Pharmacist has access to pharmacy & inventory alerts
  if (normalizedRole === "pharmacist") {
    return ["pharmacy", "inventory"].includes(report.category) || report.id === "daily-collection";
  }

  // Cashier has access only to daily collection summary
  if (normalizedRole === "cashier") {
    return report.id === "daily-collection";
  }

  return false;
}
