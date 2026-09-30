# Module Spec: Auth, Security & Settings (SEC / CFG)

## 1. Overview
This module governs terminal provisioning, operator authentication, role-based screen and action security, and store configuration preferences (document sequences, taxation rules, drug license numbers, and dynamic per-store menu control).

---

## 2. Requirement Specifications & Acceptance Criteria

### [SEC-001] Cashier PIN & Rapid Operator Switching
- **Story:** As a cashier on a shared counter, I want to quickly sign in with a 4-digit PIN so counter handover between shifts is fast.
- **Acceptance Criteria:**
  - **Given** the locked terminal screen,
  - **When** the operator types their 4-digit PIN or selects their profile,
  - **Then** the operator is authenticated locally in $< 50\text{ms}$ and their name is attached as `salesman` / `created_by` on all subsequent bills.
  - **When** switching users,
  - **Then** the active draft bill remains safe, and the new operator's permissions apply immediately.

### [SEC-002] Role-Based Action & Screen Access Control
- **Story:** As a store owner, I want to restrict cashiers from giving excessive discounts, deleting bills, or viewing gross profit reports.
- **Acceptance Criteria:**
  - **Given** a user with role `Cashier`,
  - **When** the cashier attempts to access restricted screens (e.g. Profit per Product, Staff Salary, Master Reset),
  - **Then** the menu item is hidden or access is denied with a manager authorization prompt.
  - **When** the cashier applies a discount greater than maximum allowed cashier limit (e.g. 10%),
  - **Then** an admin PIN dialog appears requiring manager sign-off.

### [SEC-003] Idle Timeout & Security Lockout
- **Story:** As a store manager, I want the counter terminal to automatically lock after a period of inactivity to prevent unauthorized billing.
- **Acceptance Criteria:**
  - **Given** store preference `idle_timeout_minutes: 5`,
  - **When** no keyboard or mouse activity is detected for 5 minutes,
  - **Then** the screen locks into PIN sign-in mode without closing open bills or losing uncommitted items.
  - **When** 5 consecutive failed PIN attempts occur,
  - **Then** the account is locked for 15 minutes or requires admin master override.

### [SEC-004] Device Provisioning & Cloud Activation
- **Story:** As a store owner, I want to pair a new PC with our store cloud account using a one-time activation code.
- **Acceptance Criteria:**
  - **Given** a fresh desktop installation,
  - **When** the user enters Store Code and Activation Token,
  - **Then** the device hardware fingerprint (UUID, machine name, OS) is registered at `/api/devices/register`, a device token is stored securely in local SQLite, and store profile/master catalogs are downloaded.

### [CFG-001] Store Configuration, Tax & Sequence Settings
- **Story:** As a store administrator, I want to configure store header info, GSTIN, invoice prefixes, and default tax behaviors.
- **Acceptance Criteria:**
  - **Given** company settings,
  - **When** configuring document sequences,
  - **Then** custom prefixes and starting numbers can be configured per terminal:
    - Invoices: `INV-`
    - Sales Returns: `SRN-`
    - Quotations: `QUO-`
    - Purchase Bills: `PB-`
    - Stock Adjustments: `SA-`
  - **When** configuring tax preferences,
  - **Then** Store GSTIN, default HSN code, sales tax mode (`inclusive` vs `exclusive`), and auto round-off can be toggled.

### [CFG-002] Dynamic Cloud-Controlled Menu Visibility (`enabled_menu_items`)
- **Story:** As a franchise owner, I want certain modules (e.g. Stock, Expenses, Staff) enabled or disabled per store from the central cloud.
- **Acceptance Criteria:**
  - **Given** the store profile payload with `enabled_menu_items`,
  - **When** the desktop app starts or syncs,
  - **Then** the sidebar navigation dynamically reflects the permitted modules, keeping the interface uncluttered for simple retail stores while expanding for full medical facilities.

---

## 3. Permissions Matrix

| Permission Key | Cashier | Pharmacist | Store Manager | Store Owner / Admin |
|---|:---:|:---:|:---:|:---:|
| `pos.create` | ✅ | ✅ | ✅ | ✅ |
| `pos.discount_override` | ❌ | ❌ | ✅ | ✅ |
| `pos.cancel_bill` | ❌ | ❌ | ✅ | ✅ |
| `pos.clinical_edit` | ❌ | ✅ | ✅ | ✅ |
| `purchase.manage` | ❌ | ❌ | ✅ | ✅ |
| `stock.adjust` | ❌ | ❌ | ✅ | ✅ |
| `reports.view_sales` | ✅ (own) | ✅ (own) | ✅ (store) | ✅ (all) |
| `reports.view_profit` | ❌ | ❌ | ❌ | ✅ |
| `master.edit_price` | ❌ | ❌ | ✅ | ✅ |
| `settings.manage` | ❌ | ❌ | ❌ | ✅ |
