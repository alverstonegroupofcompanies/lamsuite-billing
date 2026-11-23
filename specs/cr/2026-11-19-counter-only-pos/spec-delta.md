# Spec Delta — Counter-only POS, Salespeople, Approvals, Pharmacist rule

**Baseline:** v2.1.1 (`a87cc0d`) · **Date:** 2026-11-19 · **Status:** PROPOSED, awaiting owner approval.
Read [impact-analysis.md](impact-analysis.md) first for the evidence behind each item.

---

## 1. Taxonomy delta — [specs/01-overview.md §3](../../01-overview.md#3-requirement-id-taxonomy)

Six new prefixes, one per CR part (IDs remain unique and immutable; retired IDs keep their number).

| Prefix | Module | Scope | Files that will own it |
|---|---|---|---|
| `CNT-xxx` | Counters & Provisioning | Counter master, activation codes, claiming, device binding, lifecycle, migration, offline grace | new `specs/modules/counters-provisioning.md` |
| `PRF-xxx` | Counter Permission Profile & Locking | Profile contents/templates, server-side enforcement, idle lock, counter PIN | new `specs/modules/counter-profile-locking.md` |
| `APR-xxx` | Approvals | Approver list, approval rules, three methods, audit, inbox, alerts | new `specs/modules/approvals.md` |
| `SPR-xxx` | Salespeople & Incentives | Salesperson master, bill assignment, returns, printing, incentives, reports | new `specs/modules/salespeople-incentives.md` |
| `PHR-xxx` | Pharmacist & Restricted Drugs | Schedule list, pharmacist records, PIN gate, registers, offline confirmations (pharmacy stores only) | new `specs/modules/pharmacist-restricted-drugs.md` |
| `MON-xxx` | Admin Monitoring (counter-centric) | Live view, session-policy retirement | new `specs/modules/monitoring.md` |

## 2. Added requirements

### 2.1 CNT — Counters and registration (CR Part 1)

| ID | Requirement | Acceptance criterion (testable) |
|---|---|---|
| `CNT-001` | Counter master per store: store, unique name, status `unclaimed\|active\|locked\|revoked`, permission profile, defaults (printer profile, paper sizes, payment modes, cash drawer on/off), number series, current device, unlock PIN hash | Creating a counter with a name already live in the store is rejected with the holder's name; `unclaimed` is the only state in which a code can be issued |
| `CNT-002` | Owner pre-creates counters in the admin panel; **a till can never create a counter** | `POST /api/counters/enroll` (auto-create path, [CounterController.php:124-147](../../../backend/app/Http/Controllers/Api/CounterController.php#L124)) returns 410; a claim against an unknown counter is refused |
| `CNT-003` | One-time activation code per counter: server-generated, ≥128-bit entropy, shown once, stored hashed, single-use, owner-set expiry, default 24 h | Two devices using the same code: second is refused; code never appears in any API response after issuance; hash-only at rest |
| `CNT-004` | Code is rendered as a QR the till can scan, with the text alongside | Scan and manual entry produce the identical claim result |
| `CNT-005` | Code attempts are rate-limited with lockout and an owner alert; wrong, expired, reused, revoked or random input never activates anything | ≥ N failures (default 5/15 min, reusing [AuthController.php:58-79](../../../backend/app/Http/Controllers/Api/AuthController.php#L58)) ⇒ claim endpoint locked + `audit_logs` alert row; response text is identical for all failure reasons |
| `CNT-006` | A valid code binds device→counter, issues a per-device token kept in OS secure storage, loads the store data and marks the counter active | Token is never stored in a plaintext file or DB column; a fresh install with the code reaches the billing screen with no owner credentials |
| `CNT-007` | One active device per counter; claiming an active counter is refused unless the owner re-issues, and re-issue revokes the previous device | Second claim ⇒ `counter_already_claimed`; after re-issue, the old device's next request is rejected and it locks |
| `CNT-008` | One device holds one claimed counter **per store**; the existing store switcher and per-store isolated local data stay | Two stores on one machine keep separate SQLite files, tokens and profiles; signing out of store A cannot expose store B's counter |
| `CNT-009` | Admin panel: create/edit/delete-request, generate/re-issue/revoke codes, lock/unlock/revoke/rename, and see status, active device, last activity, last salesperson, unsynced items | Each action is an audited API call and is reflected on the counter card without a page reload |
| `CNT-010` | Delete is a *delete-request*: counters with documents are retired, not erased | Deleting a counter that owns invoices is refused unless confirmed as retire; history and series remain queryable |
| `CNT-011` | Offline: an active counter keeps working within the owner-set grace period; a revoked counter locks on its next connection | Grace expiry (local clock + last-seen watermark) locks the till; revocation observed on reconnect wipes the token and locks |
| `CNT-012` | Migration converts existing registered devices into counters, keeping names, number series and history | `php artisan counters:migrate-from-devices --dry-run` then run, JSON manifest + `--rollback`; per-counter series continue without reuse of issued numbers |
| `CNT-013` | Old paths are removed: shared store key, owner-login registration, public enroll/approve/status; existing tokens keep working until the next connection | Any unauthenticated call to a retired route returns no token; `stores.activation_key` column is dropped; till shows an "ask the owner for a counter code" message |
| `CNT-014` | Per-counter number series are authoritative: one doc-type set, leased by counter id, offline fallback reconciled | `invoice/sales_return/quotation/purchase_bill/receipt/stock_adjustment/stock_transfer` all present per counter; no `TEMP-*` number is ever persisted as a final document number |

### 2.2 PRF — Permission profile and locking (CR Part 2)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| `PRF-001` | Profile contents: visible modules/screens, cash drawer, discount limits, price override, selling beyond stock, edits, cancellations, returns, purchase entry, stock adjustments, transfers, reports, counter-changeable settings, printers | The profile is one canonical JSON document, versioned, with a documented key per control |
| `PRF-002` | Templates + "copy from counter" | Applying a template or copying a peer counter produces a new profile version and an audit row |
| `PRF-003` | **The server refuses any action outside the profile** — screens only hide | For every gated action key there is an API test that calls the endpoint directly with a compliant payload and asserts 403 `counter_action_not_permitted`; no client code is involved |
| `PRF-004` | Profile changes reach open counters within seconds; offline counters use the last saved profile and refresh on reconnect | Admin saves profile ⇒ attached counter sees the new version ≤ 5 s (heartbeat/SSE) and its next gated call fails |
| `PRF-005` | Idle lock per counter using the owner's idle minutes, unlocked with the counter PIN | No input for N minutes ⇒ lock; correct counter PIN resumes the open cart; a staff PIN is not accepted |
| `PRF-006` | Counter PIN policy (min length, no trivial values, lockout), reset only from the admin panel, never displayed | `0000`/`1234`/repeated-digit PINs rejected; 5 wrong attempts lock the counter until owner reset; no API returns the PIN or its hash in plaintext |
| `PRF-007` | Shift open and close authenticate with the same counter PIN | Shift rows are keyed to the counter (no `user_id`), and closing reconciles to the paisa |
| `PRF-008` | Profile change history is auditable | Every save records before/after diff, actor, counter, time in the tamper-evident audit log |

### 2.3 APR — Approvals (CR Part 3)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| `APR-001` | Approver list per store (managers and owners), each with a personal PIN | Approvers are visible/selectable only inside their own store; cross-store approver id ⇒ 404 |
| `APR-002` | Approver PIN: hashed, policy-checked, lockout, reset only from admin panel, never displayed | Same tests as `PRF-006` applied to approvers |
| `APR-003` | Approval rules per store **and** per counter: bill discount above %, price override, cancellation, edit, return above value, stock adjustment above limit, large refund, selling beyond stock | Rules editable per counter with a store default; each trigger has a threshold test showing "below ⇒ no approval, above ⇒ approval required" |
| `APR-004` | Method 1 — approver PIN entered at the counter | Correct PIN verifies online or from the cached vault offline; audit records approver, counter, action, document, reason, time |
| `APR-005` | Method 2 — one-time PIN minted in the admin panel for a specific document and action | Single use, minutes TTL, shown once, hashed; the PIN fails on any other document or action |
| `APR-006` | Method 3 — the salesperson's own PIN for low-risk actions the owner selects | Owner picks the action set per store/counter; a salesperson PIN is refused for actions not in that set |
| `APR-007` | Every approval records approver, counter, action, document, reason and time | The approvals register renders all six fields for both online and offline approvals |
| `APR-008` | Approvals inbox in the admin panel for remote approval | A till request appears in the inbox ≤ 5 s, approval returns a grant the till redeems once; timeout expires the request |
| `APR-009` | Alerts for unusual approval activity | Configurable thresholds (same approver many bills, out-of-hours, repeat overrides) raise owner alerts + audit rows |
| `APR-010` | Approval-required documents cannot be persisted without a consumed approval — **server-side** | Direct API save of a discount-above-limit bill without a grant returns 422 `approval_required` (closes today's client-only bypass, [invoiceApprovalService.ts:78-107](../../../frontend/src/lib/billing/invoiceApprovalService.ts#L78)) |

### 2.4 SPR — Salespeople (CR Part 4)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| `SPR-001` | Per-store master: name, code (unique in store), phone, optional photo, active/inactive, joining/leaving dates, allowed counters, incentive rule, optional target, optional personal PIN | Duplicate code in-store ⇒ 422; the same code in another store is allowed; a PIN-holding salesperson's PIN is hashed and policy-checked |
| `SPR-002` | Allowed counters restrict where a salesperson may be selected | A salesperson not permitted on counter C02 is absent from C02's type-ahead and rejected by the server |
| `SPR-003` | Archive instead of delete when there is history | Deleting a salesperson with bills retires (`archived_at`) and keeps history; archived people are hidden from the type-ahead but kept in reports |
| `SPR-004` | Spreadsheet import and export | Import targets exactly one store (R10 parity), rejects duplicate codes and cross-store counter ids, exports store-filtered |
| `SPR-005` | Everything audited and versioned | Optimistic `version` conflicts return 409; before/after diffs in the audit log |
| `SPR-006` | Store setting `salesperson_on_bill = off\|optional\|required`, default **required** | With `required` an empty salesperson blocks save; with `off` no field, no column, no print line |
| `SPR-007` | Optional per-line salesperson (default off) | When enabled, a line cell appears in the entry row and persists; when disabled nothing is stored |
| `SPR-008` | Default choice = last used or none | "Last used" pre-fills the previous bill's salesperson per counter; "none" leaves blank |
| `SPR-009` | Changing the salesperson on a saved bill requires approval + audit note | Edit without a grant is refused server-side; the audit note names old and new salesperson |
| `SPR-010` | Bill-header type-ahead with its own shortcut, hint-strip entry, remembered value, blocks save when required, works offline from the cached list, stores id + name-at-the-time | Keyboard-only path: shortcut → type → Enter → save; the snapshot name survives later renaming; offline bills use the cached list |
| `SPR-011` | Per-line salesperson cell in the entry row | Line-level id+name snapshot persisted and reported |
| `SPR-012` | Returns follow the original bill's salesperson and reverse incentive proportionally; cancellations reverse fully; edits keep history | Half-quantity return reverses half the incentive; cancel reverses 100 %; edit history lists each change |
| `SPR-013` | Salesperson printable via the print-preview field panel, off by default | Toggling the existing dead `salesman` field ([companySettingsService.ts:387](../../../frontend/src/lib/settings/companySettingsService.ts#L387)) renders it on thermal/A4/dot-matrix; default bills unchanged |
| `SPR-014` | Incentives (first release): % of net sales before tax, % by item group, % by brand, targets — each with effective dates; monthly statement per salesperson with export | Statement equals Σ(net taxable value × rate) to the paisa against raw invoice lines; group/brand rules beat the base rule; effective dates respected |
| `SPR-015` | Reports: sales, returns, discounts, average bill, items and incentive by salesperson; target vs achievement | Every figure reconciles to the independent integer-paisa oracle used in QA |
| `SPR-016` | Live monitoring shows sales per salesperson today + anomaly flags (unusual discounts, cancellations, returns) | Dashboard numbers equal the report numbers for the same window |
| `SPR-017` | Everything is per-store only, with consolidated views grouped by store | No salesperson appears in a store they do not belong to; consolidated rows carry a store column |
| `SPR-018` | Salespeople are managed in the admin panel (full control) and at the counter where the profile allows | Counter-side create/edit is gated by `PRF-001` and enforced server-side |

### 2.5 PHR — Pharmacist rule for restricted drugs (CR Part 5, pharmacy stores only)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| `PHR-001` | Items carry a drug-schedule category from an owner-editable list in the item master; the list marks which schedules are restricted and which require prescription details | Editing the list changes what is treated as restricted on new bills; today's dead `schedule_type` ([productsStore.ts:127](../../../frontend/src/lib/masters/productsStore.ts#L127), [PosGridRow.tsx:226-244](../../../frontend/src/components/PosGridRow.tsx#L226)) becomes real, persisted and validated |
| `PHR-002` | Pharmacist records live in the salesperson master with a `pharmacist` flag: registration number, validity dates, personal PIN, active status | A salesperson can be pharmacist and approver-free; a pharmacist is not a login |
| `PHR-003` | Expired or inactive registrations cannot confirm | A bill with a restricted drug + an expired pharmacist ⇒ refused with a named reason; re-activating allows it |
| `PHR-004` | A bill (and its return/cancellation) containing a restricted drug cannot be saved until a pharmacist is identified and confirms with **their own** PIN; the dialog lists the restricted items | Save blocked client-side and 422 server-side without a confirmation; the dialog enumerates the restricted lines; the original bill's pharmacist is required again for its return |
| `PHR-005` | The bill stores pharmacist id, name snapshot, registration number and confirmation time | Visible in the bill, register, admin detail and exports; snapshot survives later edits |
| `PHR-006` | Prescription details (doctor + patient) are required for the schedules that need them, and restricted-drug registers are written from the same data | Missing doctor on a prescription-requiring schedule blocks save; registers filter on the actual schedule instead of listing every invoice ([schedule-h-register/index.ts:140-165](../../../frontend/src/reports/pharmacy/schedule-h-register/index.ts#L140), [AdminReportController.php:375-402](../../../backend/app/Http/Controllers/Api/AdminReportController.php#L375)) |
| `PHR-007` | Wrong PIN is refused with lockout after repeated failures and an alert; only the admin panel can unlock | 5 wrong attempts ⇒ pharmacist locked + owner alert; unlock path exists only in admin panel |
| `PHR-008` | A pharmacist PIN is never the same value as an approver PIN or a counter PIN | Set/rotate validates against the other domains per store; the same hash is never accepted in two domains |
| `PHR-009` | Offline: verify against cached hashed credentials with local lockout; the confirmation queues with the bill; revocations apply on reconnect; admin panel shows offline-confirmed bills | Offline save succeeds and the queued confirmation syncs with the bill; a revoked pharmacist's offline confirmation is flagged in the exceptions report |
| `PHR-010` | Admin panel: pharmacist list, registration expiry alerts, restricted-drug bills by pharmacist/counter/day, exceptions report | Expiry alerts fire inside a configurable window; exceptions list shows offline confirmations and post-hoc revocations |
| `PHR-011` | Non-pharmacy stores show none of this anywhere — screens, API payloads, reports, print | For `store_type != pharmacy` the schedule list, pharmacist fields and registers are absent; automated leak test over API + print preview + exports |

### 2.6 MON — Monitoring (CR Part 6)

| ID | Requirement | Acceptance criterion |
|---|---|---|
| `MON-001` | Live view per counter: status, salesperson of the last bill, bills per salesperson, approvals used, restricted-drug confirmations, offline periods, unsynced items | Replaces `user_name`/`user_role` columns in [DevicesPage.tsx:33-39,306-308,378](../../../admin-panel/src/pages/DevicesPage.tsx#L33) with counter-centric fields |
| `MON-002` | "Signed-in user" and "one active session per user" no longer apply to the POS; they remain for admin-panel users | Delete the till-side one-session rule ([StaffAuthController.php:292-361](../../../backend/app/Http/Controllers/Api/StaffAuthController.php#L292)); admin-panel session policy and impersonation tests stay green |

## 3. Changed requirements (existing IDs amended, not renumbered)

| ID | Where | Change |
|---|---|---|
| `SEC-002` | [auth-security-settings.md:19-26](../../modules/auth-security-settings.md#L19) | "role-based action & screen access" at the till becomes **counter-profile-based** (superseded by `PRF-001..003`); role language survives only for admin-panel users |
| `SEC-003` | [auth-security-settings.md:28-35](../../modules/auth-security-settings.md#L28) | Idle lock is a **counter** lock with a **counter PIN**, not a staff account lock with account lockout (`PRF-005..006`) |
| `CFG-002` | [auth-security-settings.md:58-63](../../modules/auth-security-settings.md#L58) | `enabled_menu_items` stays a store-level switch; per-counter visibility moves into the profile (`PRF-001`), and per-user `enabled_menus` stops applying at the till |
| `MST-001` | [master-data.md:10-21](../../modules/master-data.md#L10) | Pharmacy fields gain `drug schedule`, `restricted`, `requires prescription` (persisted, validated, synced, importable) — `PHR-001` |
| `MST-005` | [master-data.md:46-53](../../modules/master-data.md#L46) | Pharmacists are **salespeople with a flag**, not `parties`; doctors keep `reg_no`, and prescription validity comes from the pharmacist record — `PHR-002` |
| `POS-007` | [pos-billing.md:67-72](../../modules/pos-billing.md#L67) | Clinical metadata additionally persists `prescription_no`, `doctor_id`, `patient_id` and the pharmacist confirmation block — `PHR-005..006` |
| `RET-001` | [pos-billing.md:74-81](../../modules/pos-billing.md#L74) | Returns inherit the original bill's salesperson and pharmacist and reverse incentive proportionally — `SPR-012`, `PHR-004` |
| `REP-001` | [reports-gst.md:10-17](../../modules/reports-gst.md#L10) | Register gains counter and salesperson columns; new salesperson and restricted-drug registers — `SPR-015`, `PHR-006` |
| `SEC-004` | [auth-security-settings.md:37-42](../../modules/auth-security-settings.md#L37) | Device provisioning by hardware fingerprint + store code/token is replaced by counter claiming — see retirement below |

## 4. Retired / superseded IDs (kept in the matrix, status changed)

| ID | Status after this CR | Superseded by | Code deleted |
|---|---|---|---|
| `SEC-001` (Cashier PIN & rapid operator switching) | **Retired** — there is no individual sign-in at the POS (decision 2) | `CNT-006`, `PRF-005..007`, `SPR-010` | `StaffLoginPage.tsx`, `staffAuthService` login path, `AccountSwitcherModal` at the till, `POST /api/staff/login` |
| `SEC-004` (Device activation via hardware UUID) | **Retired** — replaced by counter claiming | `CNT-003..007` | `POST /api/devices/register`, `POST /api/devices/register-owner`, public `/counters/enroll`, `/counters/approve-pairing`, `/counters/{id}/status` |
| `CFG-002` per-user menu variant | **Narrowed** (store-level menu gating survives) | `PRF-001` | `users.enabled_menus` consumption at the till |
| `stores.activation_key` (shared store key) | **Removed** (decision 1) | `CNT-003` | column + `ActivationKey::generateKey` plaintext mirror ([ActivationKey.php:89-92](../../../backend/app/Models/ActivationKey.php#L89)) |

## 5. Constitution delta — [specs/constitution.md](../../constitution.md)

Line 50 currently exempts this data ("Users, devices, counters — Per existing IAM spec"). CR decision 6 makes that untenable, so a second governed principle is added and the reference table updated.

**New section: `P-IDENTITY-SCOPE` — counter, staff-adjacent and approval data belong to one store.**

| # | Rule | Enforcement |
|---|---|---|
| IS1 | `counters`, `activation_keys`, `salespeople`, approver credentials, `approvals`, `pharmacist_confirmations`, profile templates and drug-schedule lists carry `store_id NOT NULL`; cross-store ids are 404 for till endpoints | Schema test + API tests |
| IS2 | An activation code belongs to exactly one counter in exactly one store; a code issued in store A can never bind a device to store B; codes are single-use | Claim tests (`wrong store`, reuse, expired) |
| IS3 | A device token's `(store, counter)` pair is immutable for its lifetime; no header, body field or `external_id` may re-tenant a request | Device-auth middleware tests (`NormalizeStoreContext` preserved) |
| IS4 | A bill may reference only salespeople, approvers and pharmacists of its own store; violations are 422 at write time, online or via sync | API + sync-push tests |
| IS5 | No PIN (counter, approver, salesperson, pharmacist) is ever stored plaintext, returned by an API, written into audit payloads, printed, or included in import/export. Only hashes needed for offline verification cross the wire, and only over an authenticated counter-scoped endpoint | Static scan + response-shape tests |
| IS6 | PIN domains are disjoint: a hash usable as a pharmacist PIN can never authenticate an approver or a counter | Credential-domain tests |
| IS7 | Profile, approval and pharmacist gates are enforced on the server; UI hiding is never the control | Direct-call refusal tests |
| IS8 | Pharmacy-only constructs are absent from POS screens, API payloads, reports and print output when `store_type != pharmacy` | Leak tests per surface |
| IS9 | Till-local caches (salespeople, approvers, profile, series) are store-keyed and purged when a store is disconnected from the device | Store-switch + disconnect tests |
| IS10 | Salesperson incentives/reports are per-store; consolidated admin views are read-only aggregation with a store column (parity with R6/R10) | Report tests |

**CI guards added:** `IdentityScopeSchemaTest`, `CounterClaimIsolationTest`, `PinSecrecyScanTest`, `PharmacyOnlyLeakTest`, `SalespersonStoreScopeTest` — placed in `backend/tests/Feature/Constitution/` so the existing constitution CI gate picks them up.
**CI guards changed:** none of R1–R11 is weakened; `ProductQueryScopeTest` gains a `@store-scope-ok` allowance only if a pharmacist/approval admin aggregation queries products cross-store.

## 6. Documents to update (and the ID change log)

| Document | Update | IDs added | IDs changed | IDs retired |
|---|---|---|---|---|
| [specs/constitution.md](../../constitution.md) | New `P-IDENTITY-SCOPE` (IS1–IS10); shared-vs-scoped table row for users/devices/counters re-pointed at this CR | — | R6/R10 notes (staff-adjacent scope) | — |
| [specs/01-overview.md](../../01-overview.md) | Taxonomy table gains 6 prefixes; personas updated (Cashier → Counter + Salesperson; Pharmacist becomes a credential, not a login) | — | — | — |
| `specs/modules/counters-provisioning.md` (new) | Full CNT spec | CNT-001…014 | — | — |
| `specs/modules/counter-profile-locking.md` (new) | Full PRF spec | PRF-001…008 | — | — |
| `specs/modules/approvals.md` (new) | Full APR spec | APR-001…010 | — | — |
| `specs/modules/salespeople-incentives.md` (new) | Full SPR spec | SPR-001…018 | — | — |
| `specs/modules/pharmacist-restricted-drugs.md` (new) | Full PHR spec | PHR-001…011 | — | — |
| `specs/modules/monitoring.md` (new) | Full MON spec | MON-001…002 | — | MON-000 (none) |
| [specs/modules/auth-security-settings.md](../../modules/auth-security-settings.md) | SEC-001/004 retired, SEC-002/003 amended, CFG-002 narrowed; permissions matrix re-labelled to admin-panel roles only | — | SEC-002, SEC-003, CFG-002 | SEC-001, SEC-004 |
| [specs/modules/master-data.md](../../modules/master-data.md) | MST-001 pharmacy fields; MST-005 pharmacist placement | — | MST-001, MST-005 | — |
| [specs/modules/pos-billing.md](../../modules/pos-billing.md) | POS-007 persistence; RET-001 inheritance | — | POS-007, RET-001 | — |
| [specs/modules/reports-gst.md](../../modules/reports-gst.md) | REP-001 counter/salesperson columns | — | REP-001 | — |
| [specs/02-plan.md](../../02-plan.md) | §3 local SQLite schema and §5 security section rewritten (counter-scoped sessions) | — | — | — |
| [specs/03-tasks.md](../../03-tasks.md) | Phase 1.4 replaced; new phases appended | — | — | — |
| [specs/traceability.md](../../traceability.md) | New `## Counter-only access (2026-11-19)` section: all 63 new IDs + changed/retired rows | all above | all above | SEC-001, SEC-004 |
| [specs/api/openapi.yaml](../../api/openapi.yaml) | ~40 new routes documented (today: 15 paths, `devices/register` only); 6 retired routes removed | — | — | 6 |
| [specs/keyboard-shortcuts.json](../../keyboard-shortcuts.json) + [docs/KEYBOARD_SHORTCUTS.md](../../../docs/KEYBOARD_SHORTCUTS.md) | New POS actions: salesperson picker, pharmacist confirmation, approval entry | — | — | account-switch shortcut at the till |
| [SCREENS_PERMISSIONS_MATRIX.md](../../../SCREENS_PERMISSIONS_MATRIX.md) | `/devices` → `/counters`; new `/salespeople`, `/approvers`, `/approvals`, `/pharmacists` screens; till-side access re-keyed to profile | — | — | — |
| [docs/REMOTE_COUNTER_SETUP_GUIDE.md](../../../docs/REMOTE_COUNTER_SETUP_GUIDE.md) | §3 rewritten: owner creates counter → code/QR → till enters code; pairing-code and hub-approval language removed | — | — | — |
| [CHANGELOG.md](../../../CHANGELOG.md) | Unreleased entry listing every added/changed/retired ID per §2–§4 | — | — | — |

Not found in this repo, needs an owner answer (**Q11**): the CR's "central admin spec (STR, DEV, USR, REP and TAX modules)", "master build prompt" and a standalone "data model" document. Only `STR`-free QA defect ids (`DEV-01…03`) appear in [test-reports/summary.md:56](../../../test-reports/summary.md#L56). Closest in-repo equivalents are `specs/modules/*`, `specs/02-plan.md` §3 (data model) and `specs/api/openapi.yaml` (API contract).

## 7. Clarifications — Q1–Q4 ANSWERED by the owner on 2026-11-19 and now fixed

Q5–Q12 stand on the recorded defaults unless the owner overrides them. **Q11 still needs an answer** — it changes what "documents updated" means in the verification report.

| # | Question | Decision |
|---|---|---|
| **Q1** | How does the server treat documents created **offline** under an older profile that would now violate the profile, an approval rule or the pharmacist rule? | **ANSWERED: accept + flag.** Queued offline documents are never rejected or lost; ingest stamps the profile version in force and files a violation row in an exceptions register with an owner alert. Hard refusal applies only to live/direct calls (`PRF-003`, `APR-010`, `PHR-004`). Task **B4** |
| **Q2** | Per-device token storage — today the Tauri "secure store" is a plaintext-at-rest file (`.lamsuite_secure_vault.dat`, [main.rs:694-733](../../../frontend/src-tauri/src/main.rs#L694)). | **ANSWERED: move to the OS credential store** — Windows Credential Manager/DPAPI, macOS Keychain, with a documented fallback for the QA browser mock build. Server keeps SHA-256 hashes only, which also retires the plaintext `devices.device_token` / `counters.device_token` columns. Task **A6** |
| **Q3** | Migration cut-over for tills already registered today (owner-login devices, shared store keys, staff accounts)? | **ANSWERED: grace window.** Existing tokens keep working until the next connection (CR 1.6); retired registration routes stay callable for one release returning `410` + "ask the owner for a counter code"; the migration ships `--dry-run`, a JSON manifest and `--rollback`. Tasks **A9**, **A10** |
| **Q4** | Release shape — all six parts in one release, or phased? | **ANSWERED: three releases.** v2.2.0 = Part 1+2 (waves A,B); v2.3.0 = Part 3+4 (C,D); v2.4.0 = Part 5+6 (E,F). Each phase ships its own green constitution guards |
| **Q5** | Activation code format and knobs. | (a) `LAM-C01-XXXXXXXX-XXXXXXXX` (current generator style), TTL owner-set default 24 h, 5-fail/15-min lockout (b) shorter 8-char code for typing | **(a)** with a QR always shown; 128+ bit entropy beats typing convenience, and the CR demands high randomness |
| **Q6** | Where approvers come from. | (a) existing admin-panel `users` (managers/owners) flagged `is_approver`, reusing `users.pin_hash` + policy + lockout (b) a standalone `approvers` table | **(a)** — decision 2 says roles exist only for admin-panel users, and the PIN machinery already exists ([StaffAuthController.php:206-228](../../../backend/app/Http/Controllers/Api/StaffAuthController.php#L206)) |
| **Q7** | Salesperson storage. | (a) new `salespeople` table (b) extend `parties` with `type='salesperson'` | **(a)** — salespeople need PINs, registrations, incentive rules, counter allow-lists and versioning; `parties` is money-ledger-shaped and governed by a different spec |
| **Q8** | Discount-limit semantics: a hard ceiling the counter can never cross, or a threshold above which approval is required? | (a) hard block (b) block unless approved (c) both, owner-configurable | **(c)** — profile carries `max_discount_pct` (hard) and `approval_discount_pct` (needs a grant); same shape reused for price override, returns and stock adjustments |
| **Q9** | Does remote approval (APR-008) ever block a bill from saving while it waits? | (a) till may hold the bill, nothing saves until the grant lands (b) allow save with `pending_approval` status | **(a)** — a bill saved without approval is exactly the bypass this CR removes; the request expires (default 5 min) and the till keeps the cart |
| **Q10** | Which schedules are "restricted" in the seeded list, and is `H` restricted? | (a) seed `H1`, `X`, `CCRB/controlled` as restricted + `H` as prescription-required-only (b) owner defines from scratch | **(a)** as owner-editable defaults, since the CR calls the list owner-editable and Indian practice separates H from H1/X |
| **Q11** | Confirm the document targets — the CR names a central admin spec (STR/DEV/USR/REP/TAX), a master build prompt and a data-model doc that are not in this repo. Are they external (I cannot edit them) or do you want them created here? | (a) update in-repo docs only, list external ones as pending (b) create in-repo equivalents | **(a)**, with `specs/02-plan.md §3` treated as the data model and `specs/api/openapi.yaml` as the API contract |
| **Q12** | i18n: new screens in EN + ML both, or EN first? Existing dictionaries are one file ([frontend/src/lib/i18n/dictionaries.ts](../../../frontend/src/lib/i18n/dictionaries.ts)). | (a) both from the start (b) EN now | **(a)** — every existing screen is bilingual; EN-only would drift |

**Assumptions I will proceed under** (silence = agreement): all 6 CR decisions are fixed; `invoices.user_id` stays for admin-panel-originated documents while `salesperson_id`/`salesperson_name` are added for till documents; cash shifts become counter-keyed; salesperson snapshots are stored as id + name-at-time on every document; nothing in this CR changes GST computation, printing layout defaults or the product store-scope rules R1–R11.
