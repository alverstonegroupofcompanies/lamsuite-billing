# LamSuite Billing — 33-item bug fix: findings & phased plan

Status: **awaiting approval — no code changed**
Date: 2026-11-14
Scope: `frontend/` (Tauri + React), `backend/` (Laravel), `admin-panel/`, `mcp-server/`

---

## 0. Cross-cutting root causes

These six defects explain most of the 33 symptoms and must be fixed once, in shared code.

| # | Root cause | Evidence |
|---|---|---|
| X1 | **Three competing timezone conventions.** Invoices store a UTC-derived date-only string; desktop dashboard compares it to the device-local date; backend dashboard uses Laravel `UTC`; `stores.timezone` (default `Asia/Kolkata`) is never read; `frontend/src/lib/dateTimeUtils.ts` is dead and its `parseStoreDate` is a stub. | `posCartService.ts:650`, `dashboardMetricsService.ts:80-85,190-198`, `salesMetrics.ts:147-152`, `AdminDashboardController.php:46-58`, `config/app.php:68`, `stores` migration `2026_11_05_150000...`, `dateTimeUtils.ts:32-71` |
| X2 | **Duplicate local documents.** Online/locally-created invoices are cached under both an external id and the numeric server id; sync re-inserts under another id; items are re-keyed with `Math.random()` on every pull. Dashboard de-dupes only by row `id`, so the same invoice number appears twice. | `onlineTransactionService.ts:742-763`, `BillsPage.tsx:284-331`, `remoteSyncManager.ts:238-253`, `dashboardMetricsService.ts:274-319` |
| X3 | **No central keyboard dispatcher.** `centralKeyMap.ts` is declared but imported by nobody; five+ competing `window.keydown` listeners fire in mount order, so global shortcuts beat screen shortcuts; `findConflicts()` is unused; every label is hardcoded. | `centralKeyMap.ts:42-62`, `Layout.tsx:125-243`, `PosBillingPage.tsx:832-1430`, `PurchaseEntryForm.tsx:795-801`, `PosShortcutHintBar.tsx:38-92` |
| X4 | **Modal stacking is accidental.** `CentralModalManager` is never mounted; Bills dialogs use `z-60`, which is not a Tailwind class (no generated rule), so they paint *under* the `z-50` invoice-preview modal. No focus trap and no focus restore exist anywhere. | `CentralModalManager.tsx:32-87` (unused), `BillsPage.tsx:1421,1753,1791,1846`, `tailwind.config.js:6`, `modalEscapeManager.ts` |
| X5 | **Validation and errors are duplicated and lossy.** Quantity parsing lives only in the React input; the server validates a different shape; Laravel 422 bodies are collapsed to “Transaction rejected by business rules”, hiding the rule, line and fix. Offline path silently coerces `qty 0 → 1`. | `SmartQtyInput.tsx:86-125,270-425`, `InvoiceController.php:202-204`, `onlineTransactionService.ts:423-430,495-497` |
| X6 | **Async local-first state is not scoped or reconciled.** Store ids are integer-cast (non-numeric ids become 0/null), heartbeat can create a counter-less session, released/revoked sessions are re-created by the next heartbeat, and the local device-list fallback fabricates a row, masking server absence. | `DeviceSessionController.php:220,236-254,480-503`, `deviceSessionService.ts:144-179,188-271`, `storeRegistryService.ts:528-532` |

Security-specific root causes:

- Default PIN `1234` is hard-coded in the client authorizer and shown in the UI (`invoiceManagementService.ts:917-919`, `BillsPage.tsx:884,911,1766,1819`); seeds contain `1234/2222/1111` and `admin123`.
- Offline staff verification supports only local PBKDF2 hashes; cloud sync sends **bcrypt** hashes, which fall into the legacy branch and always fail; a successful online login then overwrites the cached hashes with empty values.
- The “secure vault” is plain JSON, and the `manager_pin` fallback compares plaintext and fails open when unset.

---

## 1. Findings per item

### DASHBOARD

#### 1. Sale missing from statistics; dates shifted
- **Cause:** invoice `invoice_date` is written as a UTC date-only string (`posCartService.ts:650`), while the dashboard filters by device-local “today” (`dashboardMetricsService.ts:80-85,190-198`). A 00:00–05:29 IST sale is stamped with the previous UTC day and disappears. The backend admin dashboard uses `Carbon::today()` in UTC (`AdminDashboardController.php:46-58`). `stores.timezone` exists but is unused. Timestamp-shaped values (`2026-10-29T18:30:00Z`) also fail the raw string range because they sort lexicographically after the end date.
- **Files:** `frontend/src/lib/dashboard/*`, `frontend/src/lib/billing/*`, `frontend/src/lib/dateTimeUtils.ts`, `backend/app/Http/Controllers/Api/AdminDashboardController.php`, `backend/app/Models/Store.php`, `backend/config/app.php`, `companies/settings` timezone field.
- **Proposed:** one `StoreClock` contract on both sides. Persist `created_at` in UTC; treat `invoice_date` as a **date in the store timezone**; compute all period ranges as half-open `[start, end)` instants converted from the store timezone; expose the store timezone in the store registry; make dashboard, bills, reports and GST use the same helper. Add a one-off consistency check (dashboard totals vs invoice totals) rather than rewriting historic dates.

#### 2. Recent invoices/returns duplicated
- **Cause:** the same document is cached under two ids (external + numeric server id), and pulls re-insert under yet another id (`onlineTransactionService.ts:742-763`, `BillsPage.tsx:284-331`, `remoteSyncManager.ts:238-253`). The dashboard maps every row and de-dupes only by row `id` (`dashboardMetricsService.ts:274-319`). Returns are legitimate separate documents and already render with a tag and negative amount.
- **Files:** sync/caching services above, `dashboardMetricsService.ts`, `salesMetrics.ts`, `DashboardPage.tsx:382-411`.
- **Proposed:** add a canonical `document_key` (`store_id + invoice_number`, normalized) with a unique index in local SQLite and on the server; every ingest is an **upsert by document_key**. At read time, de-dupe by document_key with deterministic precedence (server row wins), exclude quotations/cancelled from “recent”, list returns as their own entries with `RET-`/`CN-` number, `Return` tag and negative amount. Add a reconciliation test that compares the sum of the list to invoice totals.

#### 3. Statutory GST Quick View empty
- **Cause:** slabs are accumulated only from `invoice_items`; the header fallback adds totals but never populates `slabMap`, so the widget reports “no taxable sales” while showing tax > 0 (`salesMetrics.ts:221-281`). Bills ingested from the server also drop CGST/SGST/taxable on item rows (`BillsPage.tsx:312-329`). Composition/no-tax stores have no dedicated message. Period scoping inherits X1.
- **Files:** `DashboardPage.tsx:436-479`, `dashboardMetricsService.ts:261-271`, `salesMetrics.ts`, `frontend/src/lib/tax-engine/taxEngine.ts`, `backend/app/Services/Tax/TaxEngine.php`, `ReportController.php:617,731`, `specs/gst_tax_test_vectors.json`.
- **Proposed:** compute the quick view from real documents through the shared tax engine (taxable per slab, CGST, SGST, IGST, total tax, returns negative). Pre-seed 0/5/12/18/28 slabs, compute composition/no-tax copy explicitly, and provide a helpful empty state. Reconcile against GSTR-1/HSN summaries in tests.

### POS BILLING

#### 4. Hold/Recall shortcuts
- **Cause:** `Alt+H` does hold, but Hold is labelled F8/Alt+H/Alt+8; Recall is bound to F9/Alt+J/Alt+9, conflicting with global F9 (Import/Export) and Print Preview. `centralKeyMap` declares Alt+L but is unused.
- **Files:** `PosBillingPage.tsx:1106-1119,2907-2915`, `PosShortcutHintBar.tsx:50-51`, `KeyboardShortcutsModal.tsx:46,78`, `Layout.tsx:231-234`.
- **Proposed:** Hold = `Alt+H` only; Recall = `Alt+L`; remove all POS F8/F9 aliases so global Counters/Import-Export are never shadowed. Labels, hint strip and Shortcuts panel render from the central map.

#### 5. Quantity accepts letters
- **Cause:** `SmartQtyInput` is `type="text"` with no sanitizer or paste handler; invalid text stays visible (`setPackText(val)`), `"2a"` parses as 2, and blur coerces to 0. Server accepts `numeric|min:0.01` but has no unit/pack rules.
- **Files:** `SmartQtyInput.tsx:86-125,165-170,246-305,348-425`, `PosGridRow.tsx:324-345`, `posCartService.ts:684-690`, `InvoiceController.php:195-209`.
- **Proposed:** shared quantity parser/normalizer used by POS, purchase, returns and grid cells: digits; one decimal point only when the unit allows decimals; pack+loose pattern (`2+5`, `0+5`); paste is sanitized; inline error shown; never emit `NaN`/text. Server mirrors the same rules and rejects with a structured error.

#### 6. Batch/expiry editing on F4
- **Cause:** handler accepts `Alt+F4/Ctrl+F4/Alt+E/Ctrl+M`; button says “Edit Alt+F4”; tooltips say “press F4”; plain F4 is global Reports, so the tooltip navigates away.
- **Files:** `PosBillingPage.tsx:1261-1276`, `PosGridRow.tsx:190-201,286,313`, `PosShortcutHintBar.tsx:68`, `KeyboardShortcutsModal.tsx:62`, `Layout.tsx:215-217`.
- **Proposed:** batch/expiry edit = `Alt+E` only on the selected line and the entry row. Remove Alt+F4/Ctrl+F4/Ctrl+M aliases and update button, pencil tooltips, hints. Plain F4 remains global Reports (documented).

#### 7. Alt+D / Alt+P scoping
- **Cause:** both are handled by the POS window listener without a pharmacy guard; the doctor/patient refs are never attached, so the shortcuts do nothing on POS. Because the listener is global, Alt+P also collides with Print Preview (printer) and Staff Login (PIN/password toggle).
- **Files:** `PosBillingPage.tsx:332-333,832,1085-1096,1430,2844-2869`, `PrintPreviewModal.tsx:677-679`, `StaffLoginPage.tsx:152-156`, `storeTypePresets.ts:199-204`.
- **Proposed:** attach the refs, gate on `route === /pos && storeType.supportsClinical && no overlay open`, and register these only in the POS scope. Print Preview and Staff Login keep their own Alt+P in higher scopes.

#### 8. Line-discount shortcut
- **Cause:** no dedicated focus shortcut. `Alt+F2` serves both bill and item discount depending on selection; the Disc cell has no id/ref.
- **Files:** `PosGridRow.tsx:459-490`, `PosBillingPage.tsx:1127-1149,1231-1249,3237-3242`, `QuickLineEditModal.tsx`.
- **Proposed:** `Alt+I` focuses the Disc cell of the selected line, falling back to the last line; accept `%` or amount; show it in the hint strip. Keep `Alt+F2` as the bill-discount shortcut when no line is selected and as a legacy alias for line discount otherwise.

#### 9. Loose-only quantity rejected
- **Cause:** loose-only entry stores `qty: 0` and sends `qty: 0`; Laravel rejects it with `qty min:0.01` (`InvoiceController.php:202`), and the client collapses the 422 to “Transaction rejected by business rules”. Additional defects: client stock compares **packs** against **base units**; offline path coerces `qty 0 → 1`; `allow_loose_sale` is not enforced server-side.
- **Files:** `SmartQtyInput.tsx:80-84,185-201`, `PosBillingPage.tsx:1833-1845`, `posCartService.ts:264-318,684-690`, `PosGridRow.tsx:260`, `onlineTransactionService.ts:423-430,495-497`, `InvoiceController.php:202-204,472-511`.
- **Proposed:** define one quantity contract in the smallest unit: `packs`, `loose_qty`, `units_per_pack`, total base units. Server allows `qty = 0` when `loose_qty > 0`, validates `total > 0`, loose permission and permissions/stock in base units. Return structured business-rule errors `{code, rule, line, field, message, fix}` and render them line-by-line. Fix offline coercion to compute total base units. Test packs of 1/10/15, decimals, returns and out-of-stock.

### INVOICES AND PAST BILLS

#### 10. Default pinned Period tab
- **Cause:** `useState("today")` every mount; no per-user preference store/API exists.
- **Files:** `BillsPage.tsx:88,560-562,1021-1041`, `companySettingsService.ts:779,1244,1298`, `routes/api.php` (admin/me).
- **Proposed:** add `user_preferences` (JSON) and `GET/PUT /api/me/preferences`. Pin icon on each Period tab: user pin wins; owner can set a store default (existing store settings). Opening the register resolves user pin → store default → Today.

#### 11. Next/previous period
- **Cause:** declared `Alt+Left/Alt+Right` in the dead central map; BillsPage has no handler.
- **Files:** `centralKeyMap.ts:54-55`, `BillsPage.tsx:573-625`.
- **Proposed:** `Alt+Right` / `Alt+Left` cycle Today → Yesterday → Last 7 Days → This Month → All Time and back; announced in hints. Add the period module to shared code.

#### 12. Payment/Status filter shortcuts
- **Cause:** controls are plain `<select>`s; no handlers; only dead declarations.
- **Files:** `BillsPage.tsx:1048-1071,1367-1371`, `centralKeyMap.ts:57-58`.
- **Proposed:** `Alt+Shift+P` cycles Payment (All/Cash/Card/UPI/Credit); `Alt+S` cycles Status (All/Paid/Partial/Unpaid/Cancelled). Hints and labels show the current value.

#### 13. Modal opens underneath preview
- **Cause:** `CentralModalManager` is never mounted; Bills overlays use invalid `z-60` and get `z-index:auto`, painting under the `z-50` preview. No focus trap/restore; Esc is handled twice.
- **Files:** `lib/modal/CentralModalManager.tsx`, `lib/ui/modalEscapeManager.ts`, `BillsPage.tsx:1421,1753,1791,1846,1949-1959`, `PurchaseDetailsDrawer.tsx:387`, `tailwind.config.js`.
- **Proposed:** mount one modal provider at app root; every modal renders through a portal layer with monotonically increasing z-index; focus trap in the top layer; Esc closes only the top layer; focus returns to the opener. Migrate `modalEscapeManager` consumers through an adapter so existing modals keep working. Replace `z-60`.

#### 14. Default PIN everywhere
- **Cause:** plaintext compare against `"1234"` in `invoiceManagementService.ts:917`; UI prints the default; seeds contain `1234/2222/1111` and `admin123`; device `manager_pin` fails open and compares plaintext.
- **Files:** `invoiceManagementService.ts`, `BillsPage.tsx`, `staffAuthService.ts:157-164`, `storeDeviceService.ts:33-35,849-851`, `DatabaseSeeder.php`, `User.php` (PIN policy), `CounterController.php:233`.
- **Proposed:** delete every default/hardcoded PIN/password found by a repo-wide scan; migrate seeds to env-driven/random credentials with forced change. Invoice edit/cancel requires the approving manager’s own credential (server-verified hash, store-scoped, permission-checked) or an admin-issued one-time PIN (item 15). Never ship a fallback; fail closed. Add a static test that greps for banned defaults.

#### 15. Admin allow-edit / one-time PIN
- **Cause:** no approval/OTP entity or endpoints exist; admin only views/cancels invoices; audit log infrastructure exists but is unused for this.
- **Files:** `routes/api.php:287-290`, `AdminTransactionController.php:241-372`, `AdminTransactionController.php`, `AuditLog.php:49-74`, `admin-panel/src/pages/TransactionsPage.tsx`, `admin-panel/src/services/api.ts`.
- **Proposed:** new `invoice_edit_grants` table (scope invoice/user/counter, expiry, mandatory reason, created_by, used_at, token hash, max uses) and `invoice_edit_otps` (invoice_id, requesting user, hash, expires, used_at). Admin endpoints to grant edit or issue a one-time PIN (shown once), both audited. Client checks unlock status online immediately and falls back to manager credentials offline. Add admin UI action + MCP tools mirroring the backend.

#### 16. Cancel edit shortcut
- **Cause:** edit screen has a button but no shortcut or dirty check; `cancelEditingMode` clears the cart immediately; `Ctrl+Q` is declared but unbound; hint strip has no edit-mode context.
- **Files:** `PosBillingPage.tsx:533-547,2926-2950`, `centralKeyMap.ts:61`, `PosShortcutHintBar.tsx`.
- **Proposed:** `Ctrl+Q` opens a keyboard-answerable confirmation (discard changes, release lock, return to bills). Warn only when dirty. Add an `edit` hint context.

### SALES RETURN

#### 17. Return must accept customer invoices
- **Cause:** only a single invoice search is implemented; it defaults to **today only** because no date range is passed (`invoiceManagementService.ts:190-209`), so older invoices are invisible. No customer-first invoice list; walk-in works only through this search. Remaining quantity counts only `sales_returns`, missing credit notes. GST fields are read from the original line correctly.
- **Files:** `SalesReturnPage.tsx:159-260,562-586`, `salesReturnService.ts:188-208,243-261`, `customerDebitNoteService.ts:352-457`, `invoiceManagementService.ts`.
- **Proposed:** customer-first step lists that customer’s invoices (any date) with status/amount; walk-in search by invoice number, mobile, date or product. Let users select invoice lines, quantities and reasons directly; debit note becomes an optional source with all fields optional. Remaining returnable = sold − sales returns − credit notes, in base units, using original invoice rates/tax. Keyboard-operable table (arrows/Enter/Space). Update backend return creation (currently POST `/returns/sales` only lists) and keep admin/MCP parity.

### PURCHASE — NEW INWARD PURCHASE

#### 18. Quick Add Supplier empty
- **Cause:** the typed query is never passed to the modal; `SupplierQuickAddModal` initializes all state once and retains it across opens.
- **Files:** `SupplierCombobox.tsx:83,206-209,246-257,408-437`, `SupplierQuickAddModal.tsx:7-28,106`.
- **Proposed:** pass the typed name as `initialName`, reset form on open, focus the next field (phone/GSTIN), and on create select the supplier and return focus to the purchase header.

#### 19. Alt+S opens Switch Store
- **Cause:** global Layout listener registers first and opens the switcher before the screen listener can `preventDefault`; no scope precedence.
- **Files:** `Layout.tsx:131-139,406-428`, `PurchaseEntryForm.tsx:795-801,922-923`, `StaffLoginPage.tsx:309`, `CommandPalette.tsx:118-123`.
- **Proposed:** move Switch Store to `Ctrl+Alt+S` everywhere (top-bar badge, sidebar, login, palette, docs); `Alt+S` focuses the supplier on this screen. Introduce explicit precedence modal/preview > screen > global and conflict detection.

### PURCHASE — LINE ITEMS

#### 20. Batch combobox from previous batches
- **Cause:** purchase grid uses a free-text input; the existing `BatchCombobox` is used only in Stock Ledger and already shows expiry/MRP/rates/stock/FEFO.
- **Files:** `PurchaseGridRow.tsx:264-298`, `BatchCombobox.tsx:66-580`, `productsStore.ts:219-230`, `ProductController.php:44,62-67`.
- **Proposed:** reuse/extend `BatchCombobox` in the purchase grid, scoped to the product; selecting an existing batch fills expiry/MRP/rates, or a new batch can be typed. Same component on draft and committed rows.

#### 21. Free quantity pack+loose
- **Cause:** free qty is a single number; the quantity field accepts “10+2” by accident and writes it to `free_qty` with different semantics.
- **Files:** `PurchaseGridRow.tsx:404-444,467-514`, `purchaseEntryUtils.ts:105-140`.
- **Proposed:** reuse `SmartQtyInput` for free quantity with the same pack+loose control when the product supports loose units; store `free_qty` in base units and display packs+loose.

#### 22. Percentage or amount discount
- **Cause:** line discount supports only percentage; amount and scheme are read-only. Bill discount is UI-only state, subtracted after tax and never persisted.
- **Files:** `PurchaseGridRow.tsx:676-725`, `PurchaseEntryForm.tsx:216,446,480,1753-1765`, `BillDiscountModal.tsx`, `purchaseService.ts:50-68,461`, `PurchaseController.php:36-67`, migrations.
- **Proposed:** store `{type: percent|amount, value}` on each line and on the document; accept `5%` or `50`; show the unit; toggle with `Alt+Y` per line (screen scope); apply identical logic to the bill-level discount and persist `discount_type/value` server-side.

#### 23. Batch/expiry optional by setting
- **Cause:** both are hard-required in the form and in the backend for every store; no `batch_required` setting; internal `NO_BATCH`/`BATCH-01` placeholders leak.
- **Files:** `PurchaseEntryForm.tsx:522-541`, `PurchaseController.php:53-54`, `storeTypePresets.ts`, `PosBillingPage.tsx:479-481`, `posCartService.ts:246,311,338`.
- **Proposed:** setting `batch_required` default **true only for pharmacy**, false elsewhere (preset-driven, editable). Store batchless stock as `NULL` internally and never render a placeholder. Handle in stock, sales and reports; migration backfills existing placeholders to `NULL`.

#### 24. Manufacturing date
- **Cause:** `mfg_date` exists in all schemas but has no UI.
- **Files:** `productsStore.ts:8`, `sqliteStorage.ts:116,225`, `ProductBatch.php:16,30`, `purchaseService.ts:16,113,357,416`, `companySettingsService.ts:390-413`, `PurchaseEntryForm.tsx:126-140`, `PurchaseGridRow.tsx`, `BillingColumnsModal.tsx`.
- **Proposed:** optional MM/YY column toggled in Columns; validated before expiry; stored on the batch/line; optional on labels and reports.

#### 25. Enter on unknown product
- **Cause:** `ProductQuickAddModal` is permanently mounted, so `useState(initialName)` captured `""` and never resyncs; other fields also persist across opens. No “+ Add new product” row in the dropdown.
- **Files:** `PurchaseEntryForm.tsx:628-661,1505-1517,1723-1731`, `ProductQuickAddModal.tsx:18,32`.
- **Proposed:** reset the modal on open with the typed query (key/effect), clear other fields, and add a `+ Add new product "<typed>"` row that is arrow-key reachable and opens the prefilled modal.

#### 26. Editable HSN/PTR/PTS/PTSS/Discount
- **Cause:** these cells are display-only; the editable-columns set excludes them; PTR/PTS/PTSS are synthetic calculations; `enable_pts`/`enable_ptss` settings are never read; HSN has no format/GST suggestion.
- **Files:** `PurchaseEntryForm.tsx:126-162,759-765`, `PurchaseGridRow.tsx:568-608,713-725,777-857`, `companySettingsService.ts:296-304,390-413`, `purchaseService.ts`.
- **Proposed:** add to the shared inline-edit/tab-order model on draft and committed rows; show PTR/PTS/PTSS only when settings enable them; validate HSN as 4/6/8 digits and suggest GST rates; persist on the server, admin and MCP.

### STOCK ADJUSTMENT

#### 27. Bulk stock adjustment
- **Cause:** the adjustment UI is single-line and local-only; `StockController::adjust` is a stub returning `adj_<time>`; real persistence is async via sync and allows negative stock; no audit log; CSV bulk import clamps at zero and never reaches the server.
- **Files:** `StockLedgerPage.tsx:448-564`, `inventoryService.ts:29-67`, `StockController.php:12-18`, `SyncController.php:672-750,936-960`, `DataExchangeController.php`, `definitions/stockEvents.ts`, `stock_adjustments`/`stock_ledger_entries` migrations.
- **Proposed:** one multi-line adjustment document (product, batch, system stock, counted/adjustment, reason, optional cost) in a keyboard-first grid with physical-count mode, Excel/CSV import + validation preview, and **one ledger entry per line in a single DB transaction** with an audit log. Implement a real server endpoint; local-first sync uses the same document id.

#### 28. Admin stock-adjustment controls
- **Cause:** only `reconcileStock` exists (no transaction, no caps, no locks, no approval, audit reads stale values); no adjustment POST; settings keys are inconsistent (`stock.allow_negative_stock`, `inventory_settings`, `Store::allow_negative_stock`); feature flags only hide menus.
- **Files:** `AdminInventoryController.php:245-285`, `admin-panel/src/pages/InventoryPage.tsx`, `routes/api.php:305-321`, `InvoiceController.php:325-328`, `SyncController.php:708-710`, `Store.php:51-68`, `SettingsPage.tsx:1239-1321`.
- **Proposed:** per-store policy (roles allowed, max qty/value per adjustment and per day, allowed reasons, approval threshold + approver role, block negative, required notes/attachments, period locks, time windows), enforced server-side in one policy service. Admin UI to configure and approve; app shows the exact blocking rule. MCP parity for read/approve.

### STAFF LOGIN

#### 29. Offline staff login
- **Cause:** cloud sync sends bcrypt hashes (`StaffAuthController.php:389-390`) but the client verifier only understands its own PBKDF2 format (`staffCryptoService.ts:81-87`), so offline verification always fails. Successful online login returns empty hashes (`:383-384,491-492`) which overwrite the cache (`staffAuthService.ts:826,871-897`). The vault is plain JSON; the grace period is only a type; local counters do not advance on server rejection; offline audit is never synced.
- **Files:** `staffAuthService.ts`, `staffCryptoService.ts`, `storeDeviceService.ts`, `StaffAuthController.php`, `AuthController.php:569-616`, `frontend/src-tauri/src/main.rs:694-742`, `users.offline_hash` migration.
- **Proposed:** one versioned hash format (Argon2id, bcrypt fallback) verified on both sides; never overwrite cached hashes with empty values; device-bound encryption using Tauri secure storage; configurable offline grace period checked locally; local lockout independent of network; online revocation/role changes applied on reconnect; enqueue offline login audit events. Store registration remains online-only.

#### 30. Store Switch screen reappears
- **Cause:** `validateDeviceSession` treats `valid:false` (including `pending_approval`) and any 401/403 as a hard lock (`storeDeviceService.ts:444-465`), and runs every 5 minutes. Registry change events blindly re-read active store; heartbeat can flip `store_active` and trigger the disabled screen; gateway force-switch bypasses the unsaved-cart guard and unmounts POS.
- **Files:** `App.tsx:123-128,172-194,231-242`, `storeDeviceService.ts:444-465`, `storeRegistryService.ts:528-560,621-623`, `StoreGatewayPage.tsx:72-86`, `Layout.tsx:87-95,257-278,347-372`.
- **Proposed:** silent access-token refresh; retry with backoff; only genuine invalidation (explicit revoke/expiry with failed refresh) clears the active store; registry events must not navigate away; unsaved work is preserved (block force-switch or persist draft); idle lock shows only the staff PIN overlay. Add tests for transient 401/network failure and sync state resets.

#### 31. Counter name unique per active device
- **Cause:** no uniqueness on `counter_name`; enrollment dedupes by device_uuid/counter_code only; names are overwritten on re-register; no stale-session expiry job; admin release is undone by the next heartbeat.
- **Files:** `counter` migration `2026_10_18_233917...`, `CounterController.php:69-73`, `AuthController.php:621-694`, `DeviceSessionController.php:279-306,424-457`, `storeRegistryService.ts:237-248`, `DevicesPage.tsx:225-237`.
- **Proposed:** store-scoped unique active counter name (DB constraint + transactional check), block with the holder device name and admin release; heartbeat refuses released/revoked rows; scheduled expiry of stale sessions; admin release persists.

#### 32. One active counter per user
- **Cause:** no rule; `recordLogin` expires prior sessions only on the same device; `user_sessions` is written but never consulted; admin force logout does not delete device sessions.
- **Files:** `StaffAuthController.php:22-358`, `DeviceSession.php:184-191`, `UserSession.php`, `AdminUserController.php:370-382`.
- **Proposed:** on login, detect an active session on another counter and block with device/counter/time; manager/owner can force it out (invalidates session + device row + tokens); setting allows multi-session for selected roles.

#### 33. Logged-in device missing from workstations
- **Cause:** heartbeat creates sessions with `counter_id = null`; `(int)` casting corrupts non-numeric store ids and falls back to `Store::first()`; index only bootstraps from counters when the store has zero session rows; names are not refreshed; local fallback fabricates a row. Counters tab reads `/counters`, not device sessions.
- **Files:** `DeviceSessionController.php:25-37,220-254,273-278,480-503`, `deviceSessionService.ts:144-179,188-271`, `LoggedInDevicesTable.tsx:69-74`, `CounterStatusPage.tsx`, `DevicesPage.tsx:162-170`.
- **Proposed:** register the full session on login/heartbeat (device name, counter, user, IP, status, store), keep ids as strings, resolve store strictly, never fall back to another store, refresh names, expire stale rows, and list device sessions (not raw counters) in both Counters screens with correct store scoping. Remove the fabricated offline row.

---

## 2. Proposed published key map

Central registry: one file, typed scopes, conflict detection at startup/test, generated `specs/keyboard-shortcuts.json`, used by buttons, hint strip, Shortcuts panel and QA.

| Action | Old | New | Scope | Notes |
|---|---|---|---|---|
| Switch Store | Alt+S, Alt+F3 | **Ctrl+Alt+S** | global | Frees Alt+S for screen actions; update badge/sidebar/login/palette/docs |
| Hold bill | F8, Alt+H, Alt+8 | **Alt+H** | POS | Removes F8 clash with Counters |
| Recall bill | F9, Alt+J, Alt+9 | **Alt+L** | POS | Removes F9 clash with Import/Export and Print Preview |
| Edit batch/expiry | Alt+F4, Ctrl+F4, Ctrl+M, “F4” | **Alt+E** | POS line/entry | Plain F4 stays global Reports; remove “F4” tooltips |
| Line discount focus | — | **Alt+I** | POS | Selected line, else last line; Alt+F2 remains bill discount when no line selected |
| Bill discount | Alt+F2 + aliases | **Alt+F2** | POS (no line selected) | Document the overload explicitly |
| Doctor / Patient | Alt+D / Alt+P (broken) | **Alt+D / Alt+P** | POS + pharmacy only | Higher scopes (preview, login) keep Alt+P |
| Round-off | Alt+R | **Alt+R** | POS | Keep |
| Next / previous period | declared only | **Alt+Right / Alt+Left** | Bills | Cycles the five periods |
| Payment filter | declared only | **Alt+Shift+P** | Bills | Cycles options |
| Status filter | declared only | **Alt+S** | Bills | Alt+S now free after Switch Store move |
| Cancel invoice edit | declared only | **Ctrl+Q** | POS edit mode | Confirmation: discard / keep editing |
| Purchase supplier focus | Alt+S (stolen) | **Alt+S** | Purchase | Screen scope wins over global |
| Purchase discount type | — | **Alt+Y** | Purchase line | Toggles % / amount |
| New bulk stock adjustment | — | **Alt+A** | Stock | Optional; grid remains fully keyboard-operable |

Rules enforced by the dispatcher: higher scope wins (`modal/preview > screen > global`); a lower handler never fires after a higher one; conflicts within the same scope are a startup/test failure; all labels are generated from the map.

---

## 3. Phased implementation plan

Each phase ends with its own tests green, a changelog entry per item and no regression in existing suites. Cross-phase parity is part of the definition of done.

### Phase 1 — Foundations (no user-visible behavior yet)
1. **Central keyboard dispatcher** (`lib/keyboard`): registry, scopes, precedence, conflict detection, display helpers; migrate `centralKeyMap`; generate `specs/keyboard-shortcuts.json`; remap hook (existing `keyBindings` setting wired).
2. **Modal stack v2**: mount provider, portal layers with incrementing z-index, focus trap, top-only Esc, focus restore; adapter over `modalEscapeManager`; remove invalid `z-60`.
3. **Store clock**: backend `StoreClock` service + frontend `dateTimeUtils` using `Intl` and the store timezone; registry exposes timezone; half-open range helpers; timezone vectors (23:30 / 00:30 IST, device tz different).
4. **Quantity/document contract**: shared TS parser + PHP rules; base-unit math; structured `BusinessRuleError` envelope; tax-engine parity vectors.
5. **Per-user preferences**: table/model/API + local cache.
6. **Test harness**: Vitest jsdom + Testing Library + user-event; keyboard-only helper; PHPUnit fixtures.

Tests: conflict detection, scope precedence, focus trap/restore/Esc order, tz vectors, parser vectors, preference persistence, Error envelope contract.

### Phase 2 — Dashboard truth (items 1, 2, 3)
- Apply store clock to dashboard, bills, reports, GST.
- Canonical `document_key` upsert + de-dup; returns as separate entries.
- Real GST quick view from documents; composition/no-tax copy; empty state.
- Tests: 11:30 PM/12:30 AM bills, device tz different, dashboard vs invoices reconciliation, split payments + multi-line + returns, slab totals vs GSTR-1, composition/no-tax.

### Phase 3 — POS billing (items 4–9)
- New Hold/Recall map; quantity sanitizer; Alt+E; scoped doctor/patient; line-discount focus; loose-only contract.
- Remove default labels/aliases; fix offline `qty 0 → 1`.
- Tests: keyboard-only hold/recall/edit/doctor/patient/discount; letters/paste/decimal/pack+loose; loose-only for upp 1/10/15, decimal, return, out-of-stock; 422 structured errors; no NaN to server.

### Phase 4 — Bills register & invoice edit (items 10–16)
- Period pin + preferences; period/filter shortcuts.
- Modal manager rollout on Bills and purchase drawers.
- Remove all default PINs; manager credential + admin grant/OTP (schema, endpoints, admin UI, MCP, audit).
- Cancel-edit shortcut + dirty confirmation + lock release.
- Tests: pin resolution, shortcut cycles, stacked modals/focus/Esc, PIN scan, grant/OTP expiry/one-use/audit, cancel-edit keyboard flow.

### Phase 5 — Sales return (items 17)
- Customer-first invoice list + walk-in multi-field search; direct line selection; optional debit note; unified remaining-returnable; backend creation endpoint.
- Tests: customer with/without debit note, walk-in, old invoices, over-return across returns + CNs, tax from original, keyboard-only.

### Phase 6 — Purchasing (items 18–26)
- Supplier prefill/focus/return; Alt+S scope + Ctrl+Alt+S global; batch combobox; free qty pack+loose; discount type/value at line and bill; batch-required setting; mfg date; quick-add product prefill + add row; editable HSN/PTR/PTS/PTSS/Discount with settings and validation.
- Tests: each item, tab order, inline edit, settings on/off, server parity, keyboard-only.

### Phase 7 — Stock adjustment (items 27–28)
- Multi-line adjustment document + grid + import preview + count mode + transactional ledger + audit.
- Server policy engine + admin configuration/approval UI + MCP parity + app block reasons.
- Tests: multi-line transaction rollback, CSV import, negative blocking, caps/limits/reasons/windows/locks, approval, audit, admin/store scoping.

### Phase 8 — Staff login/session (items 29–33)
- Hash-format unification + safe cache updates + device-bound encryption + grace + local lockout + revocation + offline audit sync.
- Gateway stability/refresh/backoff/unsaved work; counter-name uniqueness; single active user; presence/heartbeat/counter list.
- Tests: bcrypt/argon2 offline login, no hash wipe, grace/lockout, transient 401/network, registry churn, duplicate counter, second-counter login/force-out, presence within seconds and store scoping.

### Phase 9 — Parity, publication, regression
- Backend/admin/MCP parity sweep for items 1, 3, 10, 14–17, 22–28, 31–33.
- Publish `specs/keyboard-shortcuts.json` + docs key map.
- Add `CHANGELOG.md` with one entry per item (33).
- Run Vitest, PHPUnit, MCP tests, QA keyboard suite; update `tests/qa/10_ui_keyboard.cjs` to validate the published map.

---

## 4. Acceptance & test strategy

- **Frontend:** Vitest + jsdom + Testing Library for component/keyboard tests; pure logic tests for parsers, clock, tax and de-dup.
- **Keyboard-only:** every new/changed shortcut gets a test that dispatches only keys and asserts the resulting state/route/modal; QA suite presses every advertised key and compares against the generated map.
- **Backend:** PHPUnit feature tests for validation, authorization/store scoping, timezone boundaries, transactions, audit, OTP/grant lifecycle.
- **Parity:** shared golden vectors (`specs/gst_tax_test_vectors.json`) consumed by TS and PHP; contract tests for admin/MCP endpoints; MCP integration tests against the mock plus a live-parity smoke test.
- **Per item:** at least one automated test; keyboard test where the change is keyboard-facing; a changelog line.

## 5. Decisions needed before implementation

1. **Historic dates:** confirm we fix forward (no rewrite of existing `invoice_date`), with store-timezone interpretation going forward.
2. **Default PIN removal:** confirm a forced credential reset for users still on seeded PINs (`1234/2222/1111`) and removal of the seeded admin password.
3. **Offline crypto:** choose Argon2id (stronger) vs bcrypt (simpler, already in Laravel); both require bundling a verifier in the Tauri app.
4. **Single-session default:** confirm “one active counter per user” is the default, with a per-role allow-multi-session setting.
5. **Store default period:** confirm the owner sets it in store settings while each user’s pin overrides it.
6. **Batch/expiry default:** confirm “required only for pharmacy” and that existing non-pharmacy purchases with placeholders are migrated to `NULL`.

---

## 6. API / admin / MCP parity matrix (planned)

| Items | Backend | Admin panel | MCP server |
|---|---|---|---|
| 1, 3 | StoreClock, dashboard/GST endpoints | dashboard GST parity | read dashboard/tax tools |
| 10 | `/api/me/preferences` | — | — |
| 14, 15 | grants/OTP + audit + manager verification | Allow edit / issue OTP actions | grant/OTP tools |
| 17 | return creation from invoice lines | returns list parity | read/create return tools |
| 18–26 | purchase fields/validation/batches | — | purchase write tools |
| 27–28 | adjustment document + policy service | adjustment config/approval | adjust/approve tools |
| 31–33 | sessions/counters/release/force-out | Devices/Counters screens | session read/admin tools |

No implementation starts until this report and plan are approved.
