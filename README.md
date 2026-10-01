# LamSuite Billing — Central Web Admin Panel & Backend API

[![Backend Tests](https://img.shields.io/badge/Backend%20Tests-13%2F13%20Passing-brightgreen)](backend/)
[![Frontend Tests](https://img.shields.io/badge/Desktop%20Tests-111%2F111%20Passing-brightgreen)](frontend/)
[![Admin Panel](https://img.shields.io/badge/Admin%20Panel-React%2019%20%2B%20Vite%206-blue)](admin-panel/)
[![License](https://img.shields.io/badge/License-Proprietary-red)](LICENSE)

The **LamSuite Central Web Admin Panel** provides enterprise store owners, administrators, managers, and accountants with a browser-based console to oversee multi-store retail pharmacy operations, manage hardware POS devices, enforce live feature gating, audit transactions, resolve sync conflicts, and examine statutory GST analytics — with zero requirement for the desktop application to be running.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |   LamSuite Web Admin Panel (Browser)  |
                      |    React 19 + TypeScript + Tailwind   |
                      +-------------------+-------------------+
                                          |
                                   REST / JSON (Bearer)
                                          |
                                          v
+------------------------+    +---------------------------+    +-----------------------+
| Desktop POS Apps       |--->| Laravel 11 Backend API    |<---| Hardware Counters     |
| (Tauri / SQLite Local) |    | - Multi-Tenant Isolation  |    | & Handheld Terminals  |
+------------------------+    | - Optimistic Locking      |    +-----------------------+
                              | - Statutory GST Rules     |
                              | - Tamper-Evident Audit    |
                              +-------------+-------------+
                                            |
                                            v
                                 +---------------------+
                                 | Cloud Database      |
                                 | SQLite / PostgreSQL |
                                 +---------------------+
```

- **Statutory Compliance:** Built-in Indian statutory formats (₹ Indian Rupee currency with Lakh/Crore grouping, `DD-MM-YYYY` dates, HSN/SAC codes, and GSTR-1 Tables 4, 7, 12 & 13).
- **Multi-Tenant Scoping:** Automatic tenant isolation enforced via `ScopeStore` middleware. Cross-store access without explicit privileges returns HTTP 403.
- **Optimistic Concurrency:** All entity updates check record `version` counters to prevent silent overwrites from offline synchronization cycles.

---

## Directory Structure

```
lamsuite-billing/
├── backend/                 # Laravel 11 API Backend
│   ├── app/
│   │   ├── Http/Controllers/Api/  # 14 Admin API Controllers
│   │   ├── Http/Middleware/       # RBAC, Tenant Scoping, IP Allowlist, Session Timeout
│   │   └── Models/                # Eloquent Models with Auditing & Locking
│   ├── database/
│   │   ├── migrations/            # 5 Consolidated Core Migrations
│   │   └── seeders/               # DatabaseSeeder with 3 Stores & 6 Users
│   └── tests/Feature/             # MultiTenant, RBAC & Key Flows PHPUnit Tests
├── admin-panel/             # Browser-based React 19 Admin Panel
│   ├── src/
│   │   ├── components/            # Header, Sidebar, ImpersonationBanner, Modals
│   │   ├── context/               # AuthContext, ThemeContext
│   │   ├── pages/                 # 13 Dedicated Modules (Dashboard, Stores, Sync, etc.)
│   │   ├── services/api.ts        # Axios-like fetch client with 401/409/423 interceptors
│   │   └── utils/formatters.ts    # Indian currency, number, and date formatters
│   ├── index.html
│   ├── vite.config.ts
│   └── tailwind.config.js
├── frontend/                # Desktop POS Client (Tauri/React)
└── SCREENS_PERMISSIONS_MATRIX.md # Detailed Access Control Matrix
```

---

## Quickstart & Installation

### Prerequisites
- **PHP 8.2+** with `pdo_sqlite`, `mbstring`, `openssl` extensions
- **Composer 2.x**
- **Node.js 18+** & **npm 9+**

### 1. Backend Setup
```bash
cd backend

# Copy environment variables
cp .env.example .env

# Generate application encryption key
php artisan key:generate

# Run database migrations and seed demo data
php artisan migrate:fresh --seed

# Start the Laravel development server (runs on port 8000)
php artisan serve
```

### 2. Admin Panel Setup
```bash
cd admin-panel

# Start Vite development server with API proxying (runs on port 5174)
npm run dev

# Or build for production
npm run build
```

Open your browser at **`http://localhost:5174`** to access the Admin Panel.

---

## Demo Credentials & Role Access

The database seeder pre-populates test credentials for all five administrative roles:

| Role | Email | Password | Default Scope | Key Capabilities |
| :--- | :--- | :--- | :--- | :--- |
| **Super Admin** | `admin@lamsuite.com` | `admin123` | Global (All Stores) | Killswitches, remote resets, user impersonation, system config |
| **Store Owner** | `owner@lamsuite.com` | `owner123` | Palakkad Main (#1) | Store configuration, device approvals, master data, staff, reports |
| **Manager** | `manager@lamsuite.com` | `manager123` | Palakkad Main (#1) | Day-to-day operations, stock adjustments, invoice cancels, sync retry |
| **Accountant** | `accountant@lamsuite.com` | `accountant123` | Palakkad Main (#1) | Strictly reports, GSTR-1 tax registers, customer aging, no write rights |
| **Support** | `support@lamsuite.com` | `support123` | Global (Read-only) | Diagnostics, device telemetry, immutable audit log view |
| **Branch Manager** | `kochi_manager@lamsuite.com` | `manager123` | Kochi Express (#2) | Branch store operations; blocked from accessing Palakkad (#1) |

---

## Core Features & Modules

### 1. Real-Time Dashboard
- Live sales, purchases, and outstanding receivables in Indian statutory notation (₹, Lakh/Crore).
- Top revenue-generating pharmaceutical items and fast movers.
- Store-by-store performance comparison and fleet-wide sync health indicators.

### 2. Multi-Store Fleet & Remote Killswitch
- Create and modify store profiles (GSTIN, State Code, Drug Licenses, FSSAI).
- **Instant Killswitch:** Disabling a store prevents connected desktop POS apps from processing further transactions upon their next sync pulse.
- **Remote Store Reset:** Requires explicit confirmation phrase typing (`RESET PALAKKAD MAIN`) and mandatory audit logging to prevent accidental triggers.

### 3. Device & Counter Management
- Track registered workstation terminals, app versions, IP addresses, and sync heartbeats.
- Approve or revoke terminal access with mandatory reason logs. Revoked terminals receive immediate rejection.
- Trigger expedited "Force Re-sync" pulses remotely.

### 4. Menu & Feature Gating
- Remotely enable or disable navigation modules (`Stock`, `Reports`, `Staff`, `Expenses`, `Tools`, `Returns`) per store.
- Changes propagate immediately without requiring client re-installation.

### 5. Identity & Impersonation
- Role-Based Access Control (RBAC) with granular backend enforcement.
- Super Admin can **"Impersonate Store User"** with a high-visibility amber banner and automatic immutable audit entries.
- Remote password reset, biometric credential toggle, and active session termination.

### 6. Master Data & Duplicate Resolution
- Manage products, batches, manufacturers, brands, and parties.
- Merge duplicate customer/supplier accounts with automatic balance consolidation.
- CSV import with preview and validation before committing to the database.

### 7. Transactions & Safe Invoicing
- Review sales invoices, purchases, stock adjustments, and customer vouchers.
- PDF receipt preview and reprint matching desktop printer layouts.
- **Protected Invoice Cancellation:**
  - Requires mandatory cancellation reason.
  - Automatically blocked if the transaction falls within a **Locked GST Period**.
  - Restores batch inventory, updates customer ledgers, and records audit trail atomically.

### 8. Inventory & Stock Transfers
- Real-time batch-level tracking with shelf/rack locations and expiry indicators.
- Inter-store stock transfer management (dispatch and receipt confirmation).
- Near-expiry (e.g. within 60 days) and low-stock alerts.

### 9. Statutory Reports & GSTR-1
- GSTR-1 Table summaries (B2B Table 4, B2C Table 7, HSN Table 12, Document Summary Table 13).
- Customer aging analysis (0-30, 31-60, 61-90, 90+ days).
- Scheduled automated email digests (daily/weekly/monthly).
- Export to Excel (CSV) and printable PDF.

### 10. Sync Center & 3-Way Conflict Resolver
- Visual sync event queue monitoring with conflict categorization.
- Side-by-side JSON diff inspection between local offline edits and cloud records.
- 3-Way conflict resolution:
  - `Keep Cloud` (Preserve server state)
  - `Keep Local` (Accept client version)
  - `Merge` (Intelligently combine field diffs)

### 11. Company Settings & Masked Secrets
- Number sequences and invoice prefixes per store.
- Masked credentials for SMTP and SMS gateways with a **Rotate Secret** dialog to eliminate plaintext exposure.
- Financial year setup and **GST Period Locking** to freeze historical tax returns.

### 12. Tamper-Evident Audit Trail
- Sequential, read-only audit log recording user actions, IP addresses, and user agents.
- Old vs. New state mutation diff inspection.
- Strictly tamper-evident: **No deletion or modification endpoint exists**.

---

## Test Suites & Verification

### Running Backend Unit & Feature Tests
```bash
cd backend
./vendor/bin/phpunit
```
**Tests Covered:**
- `MultiTenantIsolationTest`: Cross-store isolation, unauthorized store headers rejection, super-admin global scope.
- `RolePermissionTest`: Support user mutation prohibition, Accountant module restriction, Manager reset barrier.
- `AdminKeyFlowsTest`: Store creation/disablement, optimistic locking concurrency conflicts (HTTP 409), invoice cancellation with stock restoration and GST lock verification, sync conflict resolution.

### Running Desktop POS Frontend Tests
```bash
cd frontend
npm test
```
**Tests Covered:**
- 22 test suites with 111 tests validating POS cart, offline sync queue, tax computations, printing engine, and company settings killswitch handling.

---

## Production Deployment

### Option A: Static SPA Hosted via Nginx
Build the React production bundle:
```bash
cd admin-panel
npm run build
```
Copy `admin-panel/dist` to your Nginx root and configure fallback routing:
```nginx
server {
    listen 80;
    server_name admin.lamsuite.internal;
    root /var/www/lamsuite/admin-panel/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option B: Integrated Laravel Hosting
The compiled assets can be placed in `backend/public/admin/` and served through the Laravel route handler in `routes/web.php`.
