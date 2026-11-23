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

### [CFG-003] Per-Store Purchase Charge Policy
- **Story:** As a multi-store owner, I want each store to decide how supplier-bill charges behave.
- **Acceptance Criteria:**
  - **Given** the store's `billing` company settings,
  - **When** the charge policy is set — the settings API, the admin panel Settings page (Billing & Document
    Sequences tab, "Supplier bill charges") and the till's own stored copy,
  - **Then** these keys are persisted per store and served to the till with the store profile:
    `purchase_charges.reverse_on_return` (`proportional` default | `sunk`),
    `purchase_charges.separately_paid_in_payable` (boolean, default `false` — added by CR-C-11; on, a charge marked
    `paid_separately` is priced into `grand_total` and the supplier payable exactly like a supplier-borne one),
    `purchase_charges.allow_negative_charges` (boolean, default `true`; off, a negative charge line is refused even
    when its head's `allowed_sign` would permit it — the head answers "what kind of money is this", the store answers
    "what will this store accept"), and
    `purchase_charges.max_percent_of_goods` (optional cap on the charge total as a share of the goods value; `null`,
    absent or `0` means no cap — the engine's "no cap" test is `cap <= 0`, so an owner clearing the field and an
    owner typing 0 get the same store).
    The per-head defaults are **not** billing keys: `default_treatment`, `default_spread_method` and
    `default_itc_eligibility` live in each store's `charge_head` master rows
    ([PUR-008](purchase-management.md#pur-008-charge-head-master)).
  - **When** a legacy profile payload spells a boolean as `"1"` or `"true"`,
  - **Then** the till reads it as on, and any other spelling — `"0"`, `""`, `null`, a stray word — as off, so a value
    the settings screen never offered cannot silently reprice a bill. The settings API normalizes the stored block
    into those same shapes on read, so the panel shows a switch's honest position rather than the string that set it.
  - **When** a purchase document is validated server-side,
  - **Then** the same policy is enforced there, so a till cannot post what the API would reject. The check runs once,
    inside the bill's own transaction and before any charge row is written, on both write paths (HTTP `POST` and the
    till's sync push), so a refused bill leaves no header, rows, allocations or expense behind.
  - **Then** a refusal names the line that broke the sign rule (`charges.<n>.amount`) or the bill that broke the cap
    (`charges`), and quotes the allowance — the store's percent, the charge total, the goods total — so the owner can
    fix the entry or the policy without guessing.
  - **Then** policy reads never leak across stores, and a policy change alters future bills only: the payable
    membership each charge line was posted with is stored on that line (`purchase_charges.in_payable`), so a bill
    that already printed, its register reading and any debit note against it keep their answer ([PUR-013](purchase-management.md), [PUR-016](purchase-management.md)).

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
