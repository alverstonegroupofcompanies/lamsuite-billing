export type PermissionActions = string[];
export type UserPermissions = Record<string, string[]>;

export interface PermissionModuleMeta {
  id: string;
  label: string;
  description?: string;
  actions: PermissionActions;
}

export interface PermissionGroup {
  id: string;
  label: string;
  description: string;
  modules: PermissionModuleMeta[];
}

export const ALL_ACTIONS = ["view", "create", "edit", "delete", "export"];

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "pos",
    label: "POS Desktop",
    description: "Controls the billing terminal, menus, stock screens and local settings.",
    modules: [
      { id: "dashboard", label: "Dashboard", actions: ["view"] },
      { id: "billing", label: "POS Billing", actions: ["view", "create", "edit"] },
      { id: "sales", label: "Bills & Returns", actions: ["view", "create", "edit", "delete", "export"] },
      { id: "purchases", label: "Purchases", actions: ["view", "create", "edit", "delete", "export"] },
      { id: "inventory", label: "Inventory & Transfers", actions: ["view", "create", "edit", "delete", "export"] },
      { id: "masters", label: "Master Data", actions: ["view", "create", "edit", "delete", "export"] },
      { id: "reports", label: "Reports & GST", actions: ["view", "export"] },
      { id: "devices", label: "Counters & Devices", actions: ["view", "create", "edit", "delete"] },
      { id: "import_export", label: "Import / Export", actions: ["view", "create", "edit", "export"] },
      { id: "migration", label: "Legacy Data Migration", actions: ["view", "edit"] },
      { id: "settings", label: "Terminal Settings", actions: ["view", "edit"] },
    ],
  },
  {
    id: "admin",
    label: "Admin Panel",
    description: "Controls centralized web administration beyond the billing terminal.",
    modules: [
      { id: "stores", label: "Stores", actions: ["view", "create", "edit", "delete"] },
      { id: "users", label: "Users & Roles", actions: ["view", "create", "edit", "delete"] },
      { id: "features", label: "Feature Control", actions: ["view", "edit"] },
      { id: "transactions", label: "Bills, Returns & Day Close", actions: ["view", "create", "edit", "delete", "export"] },
      { id: "sales_orders", label: "Sales Orders & Challans", actions: ["view", "create", "edit", "delete"] },
      { id: "pricing", label: "Price Lists", actions: ["view", "edit"] },
      { id: "loyalty", label: "Loyalty & Coupons", actions: ["view", "create", "edit", "delete"] },
      { id: "compliance", label: "Compliance & e-Invoice", actions: ["view", "edit", "export"] },
      { id: "sync", label: "Sync Center", actions: ["view", "edit"] },
      { id: "audit", label: "Audit Logs", actions: ["view", "export"] },
      { id: "notifications", label: "Notifications", actions: ["view"] },
    ],
  },
];

export const PERMISSION_MODULES: PermissionModuleMeta[] = PERMISSION_GROUPS.flatMap((g) => g.modules);

const MODULE_ACTIONS = new Map(PERMISSION_MODULES.map((m) => [m.id, m.actions]));

/**
 * Converts any persisted permission shape (true, "*", string, array) into the
 * editor's allow-list format. Unknown modules/actions are dropped so the saved
 * matrix always matches a documented surface.
 */
export function normalizePermissions(raw: unknown): UserPermissions {
  if (!raw || Array.isArray(raw) || typeof raw !== "object") return {};
  const result: UserPermissions = {};
  for (const [moduleId, value] of Object.entries(raw as Record<string, unknown>)) {
    const allowed = MODULE_ACTIONS.get(moduleId);
    if (!allowed) continue;
    if (value === true || value === "*") {
      result[moduleId] = [...allowed];
      continue;
    }
    const list = typeof value === "string" ? [value] : Array.isArray(value) ? value : null;
    if (!list) continue;
    const filtered = Array.from(
      new Set(
        (list as unknown[])
          .map((v) => String(v).trim())
          .flatMap((v) => {
            if (v === "*") return allowed;
            if (v.startsWith(`${moduleId}.`)) return [v.slice(moduleId.length + 1)];
            return [v];
          })
          .filter((v) => allowed.includes(v))
      )
    );
    result[moduleId] = filtered;
  }
  return result;
}

export function permissionCount(permissions: UserPermissions): number {
  return Object.keys(permissions).length;
}

type ActionFilter = (action: string) => boolean;

const ALL: ActionFilter = () => true;
const NO_DELETE: ActionFilter = (a) => a !== "delete";
const READ: ActionFilter = (a) => a === "view";
const READ_EXPORT: ActionFilter = (a) => a === "view" || a === "export";

function baseline(spec: Record<string, ActionFilter>): UserPermissions {
  const result: UserPermissions = {};
  for (const [moduleId, filter] of Object.entries(spec)) {
    const actions = (MODULE_ACTIONS.get(moduleId) || []).filter(filter);
    if (actions.length) result[moduleId] = actions;
  }
  return result;
}

/**
 * Role baselines mirrored from backend User::hasPermission and the POS
 * accessControl role defaults. Admin roles bypass permission checks on both
 * sides, so they stay on Inherit (empty override set).
 */
export const ROLE_PERMISSION_BASELINE: Record<string, UserPermissions> = {
  super_admin: {},
  store_owner: {},
  admin: {},
  manager: baseline({
    dashboard: ALL,
    billing: ALL,
    sales: ALL,
    purchases: ALL,
    inventory: ALL,
    masters: ALL,
    reports: ALL,
    devices: ALL,
    import_export: ALL,
    migration: ALL,
    settings: ALL,
    stores: NO_DELETE,
    users: ALL,
    features: ALL,
    transactions: ALL,
    sales_orders: ALL,
    pricing: ALL,
    loyalty: ALL,
    compliance: ALL,
    sync: ALL,
    audit: ALL,
    notifications: ALL,
  }),
  accountant: baseline({
    dashboard: READ,
    reports: READ_EXPORT,
    compliance: READ_EXPORT,
  }),
  support: baseline({
    dashboard: READ,
    sales: READ,
    purchases: READ,
    inventory: READ,
    masters: READ,
    reports: READ_EXPORT,
  }),
  cashier: baseline({
    dashboard: READ,
    billing: ALL,
    sales: ALL,
    reports: ALL,
    settings: ALL,
    devices: ALL,
  }),
  operator: baseline({
    dashboard: READ,
    billing: ALL,
    sales: ALL,
    settings: ALL,
    devices: ALL,
  }),
  pharmacist: baseline({
    dashboard: NO_DELETE,
    billing: NO_DELETE,
    sales: NO_DELETE,
    reports: NO_DELETE,
    inventory: NO_DELETE,
    masters: NO_DELETE,
    settings: NO_DELETE,
    devices: NO_DELETE,
  }),
};

export function getRoleBaselinePermissions(role?: string | null): UserPermissions {
  const key = String(role || "").trim().toLowerCase();
  return { ...(ROLE_PERMISSION_BASELINE[key] || {}) };
}
