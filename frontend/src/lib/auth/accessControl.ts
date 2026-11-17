export type PermissionValue = boolean | string | string[];
export type PermissionSet =
  | string[]
  | Record<string, PermissionValue>
  | null
  | undefined;

export interface PermissionSubject {
  role?: string | null;
  permissions?: PermissionSet;
}

export const ADMIN_ROLES = ["admin", "super_admin", "store_owner"];

export interface MenuPermission {
  module: string;
  action: string;
}

/**
 * Menu id (as used by the store settings module toggles and TopNav) mapped to
 * the permission module/action that guards it.
 */
export const MENU_PERMISSIONS: Record<string, MenuPermission> = {
  dashboard: { module: "dashboard", action: "view" },
  pos: { module: "billing", action: "create" },
  bills: { module: "sales", action: "view" },
  sales_returns: { module: "sales", action: "edit" },
  customer_debit_notes: { module: "sales", action: "edit" },
  purchases: { module: "purchases", action: "view" },
  purchase_returns: { module: "purchases", action: "edit" },
  stock: { module: "inventory", action: "view" },
  stock_transfers: { module: "inventory", action: "edit" },
  reports: { module: "reports", action: "view" },
  masters: { module: "masters", action: "view" },
  counters: { module: "devices", action: "view" },
  import_export: { module: "import_export", action: "view" },
  migration: { module: "migration", action: "edit" },
  settings: { module: "settings", action: "view" },
};

const VIEW_ONLY_ROLES = ["support", "accountant"];

export function normalizeRole(role?: string | null): string {
  return String(role || "").trim().toLowerCase();
}

export function isAdminRole(role?: string | null): boolean {
  return ADMIN_ROLES.includes(normalizeRole(role));
}

/**
 * Evaluates explicit permission entries. Returns undefined when the permission
 * set carries no explicit instruction for the module, so callers can fall back
 * to role defaults (matching the backend User::hasPermission contract).
 */
export function explicitModuleDecision(
  permissions: PermissionSet,
  module: string,
  action: string
): boolean | undefined {
  if (!permissions) return undefined;

  if (Array.isArray(permissions)) {
    const entries = permissions.map((p) => String(p).trim());
    if (entries.length === 0) return undefined;
    if (entries.includes("*")) return true;
    if (entries.includes(`${module}.*`) || entries.includes(module)) return true;
    if (entries.includes(`${module}.${action}`)) return true;
    return undefined;
  }

  if (typeof permissions === "object") {
    if (!Object.prototype.hasOwnProperty.call(permissions, module)) return undefined;
    const value = permissions[module];
    if (value === true || value === "*") return true;
    if (value === false) return false;
    if (typeof value === "string") {
      return value === "*" || value === action || value === `${module}.${action}`;
    }
    if (Array.isArray(value)) {
      return value.includes("*") || value.includes(action) || value.includes(`${module}.${action}`);
    }
    return false;
  }

  return undefined;
}

function roleAllows(role: string, module: string, action: string): boolean {
  if (!role) return false;
  if (ADMIN_ROLES.includes(role) || role === "manager") return true;

  if (role === "accountant") {
    return (module === "reports" || module === "dashboard" || module === "gst") &&
      (action === "view" || action === "export");
  }

  if (role === "support") {
    return VIEW_ONLY_ROLES.includes(role) && action === "view" &&
      ["dashboard", "sales", "purchases", "inventory", "masters", "reports"].includes(module);
  }

  if (role === "cashier") {
    // Settings/counters stay available so cashiers can configure the printer
    // and open/close their cash shift; purchases and masters remain restricted.
    return ["dashboard", "billing", "sales", "reports", "settings", "devices"].includes(module);
  }

  if (role === "pharmacist") {
    return (
      ["dashboard", "billing", "sales", "reports", "inventory", "masters", "settings", "devices"].includes(
        module
      ) && action !== "delete"
    );
  }

  if (role === "operator") {
    return ["dashboard", "billing", "sales", "settings", "devices"].includes(module);
  }

  return false;
}

/**
 * Single source of truth for POS-side permission checks. Mirrors the backend
 * User::hasPermission semantics: explicit per-user permissions win, otherwise
 * the role baseline applies.
 */
export function hasModulePermission(
  subject: PermissionSubject | null | undefined,
  module: string,
  action = "view"
): boolean {
  if (!subject) return false;

  // Super admins bypass explicit overrides, matching backend User::hasPermission.
  if (normalizeRole(subject.role) === "super_admin") return true;

  const explicit = explicitModuleDecision(subject.permissions, module, action);
  if (explicit !== undefined) return explicit;

  return roleAllows(normalizeRole(subject.role), module, action);
}

export function canAccessMenu(
  subject: PermissionSubject | null | undefined,
  menuId: string
): boolean {
  const mapping = MENU_PERMISSIONS[menuId];
  if (!mapping) return true;
  return hasModulePermission(subject, mapping.module, mapping.action);
}

export function permissionOverrideCount(permissions: PermissionSet): number {
  if (!permissions || Array.isArray(permissions) || typeof permissions !== "object") return 0;
  return Object.keys(permissions).length;
}
