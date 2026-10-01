export type UserRole = "admin" | "manager" | "cashier" | "pharmacist" | "auditor";

export type Permission =
  | "items:read"
  | "items:write"
  | "items:update_price"
  | "customers:read"
  | "customers:write"
  | "customers:view_pii"
  | "suppliers:read"
  | "suppliers:write"
  | "invoices:read"
  | "invoices:create"
  | "invoices:cancel"
  | "purchases:read"
  | "purchases:create"
  | "returns:read"
  | "returns:create"
  | "stock:read"
  | "stock:adjust"
  | "reports:read"
  | "reports:financial"
  | "store:read"
  | "store:write";

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    "items:read",
    "items:write",
    "items:update_price",
    "customers:read",
    "customers:write",
    "customers:view_pii",
    "suppliers:read",
    "suppliers:write",
    "invoices:read",
    "invoices:create",
    "invoices:cancel",
    "purchases:read",
    "purchases:create",
    "returns:read",
    "returns:create",
    "stock:read",
    "stock:adjust",
    "reports:read",
    "reports:financial",
    "store:read",
    "store:write",
  ],
  manager: [
    "items:read",
    "items:write",
    "items:update_price",
    "customers:read",
    "customers:write",
    "customers:view_pii",
    "suppliers:read",
    "suppliers:write",
    "invoices:read",
    "invoices:create",
    "invoices:cancel",
    "purchases:read",
    "purchases:create",
    "returns:read",
    "returns:create",
    "stock:read",
    "stock:adjust",
    "reports:read",
    "reports:financial",
    "store:read",
  ],
  pharmacist: [
    "items:read",
    "items:write",
    "customers:read",
    "customers:write",
    "suppliers:read",
    "invoices:read",
    "invoices:create",
    "purchases:read",
    "purchases:create",
    "returns:read",
    "returns:create",
    "stock:read",
    "reports:read",
    "store:read",
  ],
  cashier: [
    "items:read",
    "customers:read",
    "customers:write",
    "suppliers:read",
    "invoices:read",
    "invoices:create",
    "returns:read",
    "returns:create",
    "stock:read",
    "reports:read",
    "store:read",
  ],
  auditor: [
    "items:read",
    "customers:read",
    "suppliers:read",
    "invoices:read",
    "purchases:read",
    "returns:read",
    "stock:read",
    "reports:read",
    "reports:financial",
    "store:read",
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.includes(permission) : false;
}

export function assertPermission(role: UserRole, permission: Permission, actionDescription: string): void {
  if (!hasPermission(role, permission)) {
    throw new Error(
      `Permission denied: Role '${role}' lacks permission '${permission}' required for ${actionDescription}.`
    );
  }
}
