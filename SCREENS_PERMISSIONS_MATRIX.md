# LamSuite Billing — Admin Panel Screens & Permissions Matrix

This document defines the access control policies, module visibility, operation permissions, and API endpoint enforcement across the 5 administrative roles in LamSuite Billing Central Admin.

---

## Roles Overview

| Role | Scope | Description |
| :--- | :--- | :--- |
| **Super Admin** (`super_admin`) | Enterprise-wide (All Stores) | Full administrative authority across all stores, global settings, killswitches, remote resets, and user impersonation. |
| **Store Owner** (`store_owner`) | Scoped to Owned Stores | Full store management including staff, master data, devices, transactions, inventory, settings, and GST locks. |
| **Manager** (`manager`) | Scoped to Assigned Store | Store operations, inventory adjustments, dispatch/receive transfers, billing transactions, and staff monitoring. |
| **Accountant** (`accountant`) | Scoped to Assigned Store | Read-only access dedicated strictly to financial reports, GSTR-1 statutory summaries, sales/purchase registers, and customer aging. |
| **Support** (`support`) | Global or Assigned Store | Read-only diagnostics and audit inspection for troubleshooting without any mutation capabilities. |

---

## Screens & Permissions Matrix

| # | Module / Screen | Path | Super Admin | Store Owner | Manager | Accountant | Support | Back-End Enforced Permissions |
|---|---|---|:---:|:---:|:---:|:---:|:---:|---|
| **1** | **Dashboard** | `/` | Full | Store | Store | Store | Store (Read) | `dashboard:view`, `dashboard:export` |
| **2** | **Stores** | `/stores` | Full CRUD + Reset | View / Edit Own | View Only | ❌ Forbidden | View Only | `stores:view`, `stores:create`, `stores:edit`, `stores:reset` |
| **3** | **Devices / Counters** | `/devices` | Full CRUD | Full CRUD | View + Resync | ❌ Forbidden | View Only | `devices:view`, `devices:approve`, `devices:revoke`, `devices:resync` |
| **4** | **Menu & Feature Control**| `/features`| Full (Live) | Full (Live) | View Only | ❌ Forbidden | View Only | `features:view`, `features:edit` |
| **5** | **Users & Staff** | `/users` | Full + Impersonate | Store Users CRUD | Staff CRUD | ❌ Forbidden | View Only | `users:view`, `users:create`, `users:edit`, `users:impersonate` |
| **6** | **Master Data** | `/masters` | Full CRUD + Merge | Store CRUD + Merge | Store CRUD | ❌ Forbidden | View + Export | `masters:view`, `masters:create`, `masters:edit`, `masters:merge`, `masters:export` |
| **7** | **Transactions** | `/transactions` | Full + Cancel | Full + Cancel | Full + Cancel | View + Reprint | View + Export | `transactions:view`, `transactions:reprint`, `transactions:cancel`, `transactions:export` |
| **8** | **Inventory & Stock** | `/inventory` | Full CRUD | Full CRUD | Adjust / Transfer | Valuation Only | View Only | `inventory:view`, `inventory:adjust`, `inventory:transfer`, `inventory:reconcile` |
| **9** | **Reports & GST** | `/reports` | Full Analytics | Full Analytics | Full Analytics | Full Analytics | View + Export | `reports:view`, `reports:export`, `reports:schedule` |
| **10**| **Sync Center** | `/sync` | Full + Resolve | Full + Resolve | Full + Retry | ❌ Forbidden | View Only | `sync:view`, `sync:resolve`, `sync:retry` |
| **11**| **Company Settings** | `/settings` | Full + Rotate | Full + Rotate | View Only | FY / Locks View | View Only | `settings:view`, `settings:edit`, `settings:lock_period` |
| **12**| **Audit Log** | `/audit` | Full Audit View | Store Audit View | Store Audit View | ❌ Forbidden | View Only | `audit:view`, `audit:export` *(Tamper-evident, zero delete)* |

---

## Detailed Operation Permissions by Role

### 1. Store Lifecycle & Killswitch Operations
- **Store Enable / Disable:** `Super Admin` only. When disabled, any connected desktop workstation receives `is_active: false` on the subsequent sync cycle and displays the blocking **Store Disabled** barrier screen immediately.
- **Remote Store Reset:** `Super Admin` only. Requires an explicit confirmation phrase (`RESET PALAKKAD MAIN`) and a mandatory audit reason. Clears store operational cache while preserving statutory audit logs.

### 2. Device & Workstation Management
- **Device Approval:** `Super Admin`, `Store Owner`.
- **Device Revocation:** `Super Admin`, `Store Owner`. Requires a mandatory revocation reason (e.g. `Lost hardware tablet`, `Unauthorized terminal access`). Revoked devices receive a 403 on API handshake.
- **Force Re-sync:** Triggers an expedited sync cycle on the targeted workstation.

### 3. Identity, Sessions & Impersonation
- **Impersonation:** `Super Admin` only. Allows logging into any store user session without knowing their password.
  - Renders a persistent high-visibility top banner: `Active Impersonation Session: logged in as [User] (Role)`.
  - Records the action with actor `user_id`, `impersonated_by_user_id`, IP address, and timestamp in the tamper-evident audit log.
- **Session Revocation / Force Logout:** Allows store admins to invalidate stale sessions remotely.
- **Biometric & TOTP Reset:** Can toggle or clear biometrics if hardware fingerprint readers fail.

### 4. Transactions & Invoice Cancellation Safeguards
- **Invoice Cancellation:** Permitted for `Super Admin`, `Store Owner`, and `Manager`.
  - **Prerequisite 1:** Reason is strictly required (`cancel_reason`).
  - **Prerequisite 2:** The invoice's month period must NOT be locked under **GST Period Locks**. If locked, the backend returns HTTP 422: `Cannot cancel invoice: GST period for YYYY-MM is locked`.
  - **Atomic Side Effects:**
    1. Invoices status transitions from `issued` to `cancelled`.
    2. Batch stock quantities and product stock levels are restored immediately.
    3. Customer balance and credit ledger are credited back.
    4. Immutable audit record is created with pre/post cancellation delta.

### 5. Sync Center & 3-Way Conflict Resolution
- When offline desktop edits conflict with newer cloud records, the conflict is placed into the Sync Center.
- Authorized users (`Super Admin`, `Store Owner`) can review the side-by-side JSON diff and choose:
  - `keep_cloud`: Retain cloud version as source of truth.
  - `keep_local`: Overwrite cloud version with client's offline version.
  - `merge`: Merge specific client attributes onto the cloud payload.

### 6. Masked Secrets & Credential Rotation
- Plaintext secrets (SMTP passwords, SMS gateways, payment keys) are never returned by the API (`"********"`).
- Admins can rotate secrets with the **Rotate Secret** dialog without exposing existing credentials.

---

## API Route Enforcement Reference

| API Endpoint | HTTP Method | Minimum Role / Middleware |
|---|---|---|
| `/api/admin/login` | `POST` | Public (Throttled: 5 attempts/min) |
| `/api/admin/me` | `GET` | Authenticated Bearer |
| `/api/admin/impersonate` | `POST` | `rbac:super_admin` |
| `/api/admin/stop-impersonate`| `POST` | Authenticated Bearer |
| `/api/admin/dashboard` | `GET` | `scope.store` |
| `/api/admin/stores` | `GET`, `POST` | `rbac:super_admin,store_owner` |
| `/api/admin/stores/{id}/toggle-status` | `POST` | `rbac:super_admin` |
| `/api/admin/stores/{id}/reset` | `POST` | `rbac:super_admin` (Requires confirmation phrase) |
| `/api/admin/devices/{id}/revoke` | `POST` | `rbac:super_admin,store_owner` (Requires reason) |
| `/api/admin/features` | `GET`, `PUT` | `rbac:super_admin,store_owner` |
| `/api/admin/users/{id}/password-reset` | `POST` | `rbac:super_admin,store_owner` |
| `/api/admin/masters/products` | `GET`, `POST`, `PUT` | `rbac:super_admin,store_owner,manager` |
| `/api/admin/masters/merge-parties` | `POST` | `rbac:super_admin,store_owner` |
| `/api/admin/transactions/invoices/{id}/cancel` | `POST` | `rbac:super_admin,store_owner,manager` (GST Lock Checked) |
| `/api/admin/sync/events/{id}/resolve` | `POST` | `rbac:super_admin,store_owner` |
| `/api/admin/settings/company` | `GET`, `PUT` | `rbac:super_admin,store_owner` |
| `/api/admin/settings/gst-locks` | `GET`, `POST` | `rbac:super_admin,store_owner` |
| `/api/admin/audit-logs` | `GET` | Authenticated (No DELETE route exists) |
