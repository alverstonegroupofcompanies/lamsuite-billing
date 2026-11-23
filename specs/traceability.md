# Requirements Traceability Matrix

| Requirement ID | Module | Description | Implementation Task | Verification Test | Status |
|---|---|---|---|---|:---:|
| `POS-001` | POS Billing | Instant barcode scanning and sub-30ms product lookup | Task 3.1 | `posCartService.test.ts` | Verified |
| `POS-002` | POS Billing | Pharmacy batch and loose quantity unit conversion | Task 3.1 | `posCartService.test.ts` | Verified |
| `POS-003` | POS Billing | Indian multi-rate GST computation (inclusive & exclusive) | Task 3.2 | `billingCalculations.test.ts` | Verified |
| `POS-004` | POS Billing | Statutory whole-rupee auto round-off | Task 3.2 | `billingCalculations.test.ts` | Verified |
| `POS-005` | POS Billing | Multi-mode split payments (Cash, UPI, Card, Credit) | Task 3.3 | `billingTenderService.test.ts` | Verified |
| `POS-006` | POS Billing | Fast bill hold and recall drawer | Task 3.3 | `billingTenderService.test.ts` | Verified |
| `POS-007` | POS Billing | Doctor registration and patient prescription capture | Task 3.1 | `posCartService.test.ts` | Verified |
| `RET-001` | Sales Return | Sales returns traced to original invoice with restocking | Task 3.1 | `posSalesReturnService.test.ts` | Verified |
| `RET-002` | Quotations | Quotation issuance and one-click invoice conversion | Task 3.1 | `posSalesReturnService.test.ts` | Verified |
| `PUR-001` | Purchases | Inward supplier purchase bill entry with batch creation | Task 4.1 | `purchaseService.test.ts` | Verified |
| `PUR-002` | Purchases | Free goods / bonus scheme cost calculation | Task 4.1 | `purchaseService.test.ts` | Verified |
| `PUR-003` | Purchases | Purchase return debit note to supplier | Task 4.2 | `purchaseService.test.ts` | Verified |
| `PUR-004` | Purchases | Low-stock purchase request (indent) generation | Task 4.2 | `purchaseService.test.ts` | Verified |
| `PUR-005` | Purchases | Spreadsheet column mapping import wizard | Task 4.3 | `purchaseImportService.test.ts` | Verified |
| `PUR-006` | Purchases | OCR / AI supplier invoice parser with product matching | Task 4.3 | `purchaseImportService.test.ts` | Verified |
| `STK-001` | Inventory | Double-entry stock ledger with audit trail | Task 5.1 | `posCartService.test.ts`, `sqliteStorage.test.ts` | Verified |
| `STK-002` | Inventory | Stock write-off adjustments (damage, breakage, expiry) | Task 5.2 | `inventoryService.test.ts` | Verified |
| `STK-003` | Inventory | Physical inventory count reconciliation | Task 5.2 | `inventoryService.test.ts` | Verified |
| `STK-004` | Inventory | Inter-store stock transfer dispatch and receipt | Task 5.3 | `inventoryService.test.ts` | Verified |
| `STK-005` | Inventory | FEFO batch allocation and near-expiry alerts | Task 5.1 | `productsStore.test.ts`, `inventoryService.test.ts` | Verified |
| `MST-001` | Master Data | Products with multiple barcodes, HSN, pricing & FTS5 | Task 2.1 | `productsStore.test.ts` | Verified |
| `MST-002` | Master Data | Product categories, brands, manufacturers, and units | Task 2.2 | `partiesStore.test.ts` | Verified |
| `MST-003` | Master Data | Supplier directory with GSTIN validation | Task 2.2 | `partiesStore.test.ts` | Verified |
| `MST-004` | Master Data | Customer directory with ledger and credit balance | Task 2.3 | `partiesStore.test.ts` | Verified |
| `MST-005` | Master Data | Doctors and patients clinical registries | Task 2.3 | `partiesStore.test.ts` | Verified |
| `MST-006` | Master Data | Automated discount schema rule evaluation | Task 2.4 | `discountSchemaEngine.test.ts` | Verified |
| `MST-007` | Master Data | Excel/CSV catalog import wizard | Task 2.1 | `purchaseImportService.test.ts` | Verified |
| `REP-001` | Reports | Sales register and daily collection breakdown | Task 6.1 | `reportEngine.test.ts` | Verified |
| `REP-002` | Reports | Statutory GSTR-1 compliance tables (B2B, B2C) | Task 6.2 | `reportEngine.test.ts` | Verified |
| `REP-003` | Reports | HSN / SAC statutory tax summary aggregation | Task 6.2 | `reportEngine.test.ts` | Verified |
| `REP-004` | Reports | Near-expiry and low stock inventory health reports | Task 6.3 | `inventoryService.test.ts`, `reportEngine.test.ts` | Verified |
| `REP-005` | Reports | Customer receivables and supplier payables aging | Task 6.3 | `reportEngine.test.ts` | Verified |
| `REP-006` | Reports | Sub-500ms streaming export to Excel / CSV / PDF | Task 6.1 | `reportEngine.test.ts` | Verified |
| `PRN-001` | Printing | Native silent printing to thermal receipt printer | Task 3.4 | `printingEngine.test.ts` | Verified |
| `PRN-002` | Printing | Dynamic slip height for thermal roll optimization | Task 3.4 | `printingEngine.test.ts` | Verified |
| `PRN-003` | Printing | Pharmacy A4 / A5 tax invoice layout | Task 3.4 | `printingEngine.test.ts` | Verified |
| `PRN-004` | Printing | Store drug license numbers and statutory headers | Task 3.4 | `printingEngine.test.ts` | Verified |
| `PRN-005` | Printing | Dynamic UPI QR code generation on bill | Task 3.4 | `printingEngine.test.ts` | Verified |
| `PRN-006` | Printing | Headless vector PDF generation | Task 3.4 | `printingEngine.test.ts` | Verified |
| `SYNC-001` | Sync & Offline | Zero-latency offline operation with local SQLite | Task 1.2 | `sqliteStorage.test.ts` | Verified |
| `SYNC-002` | Sync & Offline | Asynchronous sync queue with idempotent retries | Task 1.3 | `syncQueueService.test.ts` | Verified |
| `SYNC-003` | Sync & Offline | Cloud delta pull using watermark timestamps | Task 1.3 | `syncLanBackup.test.ts` | Verified |
| `SYNC-004` | Sync & Offline | Sequential stock event audit streaming | Task 5.1 | `syncQueueService.test.ts` | Verified |
| `SYNC-005` | Sync & Offline | In-store UDP/mDNS discovery and LAN master pull | Task 7.1 | `syncLanBackup.test.ts` | Verified |
| `SYNC-006` | Sync & Offline | Automated daily encrypted SQLite backup and restore | Task 7.2 | `syncLanBackup.test.ts` | Verified |
| `SEC-001` | Security | 4-digit Cashier PIN with fast shift handover | Task 1.4 | `operatorAuthService.test.ts` | Verified |
| `SEC-002` | Security | Granular role-based action permissions matrix | Task 1.4 | `operatorAuthService.test.ts` | Verified |
| `SEC-003` | Security | Idle timeout auto-lock and failed attempt lockout | Task 1.4 | `operatorAuthService.test.ts` | Verified |
| `SEC-004` | Security | Device activation via hardware UUID fingerprint | Task 1.1 | `ipcBridge.test.ts` | Verified |
| `CFG-001` | Settings | Store profile, sequences, and GST tax mode config | Task 1.1 | `companySettingsService.test.ts` | Verified |
| `CFG-002` | Settings | Dynamic per-store menu visibility (`enabled_menu_items`)| Task 1.1 | `companySettingsService.test.ts` | Verified |

## Store-scope constitution (P-STORE-SCOPE) — added 2026-11-19

Change request: products belong to one store only; stores do not share products.
Rules are defined in [constitution.md](constitution.md) and enforced by CI in
`backend/tests/Feature/Constitution/`.

| Rule / Flow | Description | Implementation | Verification Test | Status |
|---|---|---|---|:---:|
| R1 | `products.store_id` NOT NULL — every product belongs to exactly one store | Migration `*_add_store_scope_to_catalog.php` | `ProductStoreScopeSchemaTest` | Verified |
| R2 | Barcode unique within a store; duplicate create/import/sync → HTTP 422 naming the existing product | Unique index `(store_id, barcode)` + `ProductController`/`AdminMasterController`/`DataExchangeController` checks | `ProductStoreScopingApiTest`, `ProductStoreScopeSchemaTest`, `DataExchangeStoreScopeTest` | Verified |
| R3 | A batch cannot exist in a different store than its product (composite FK at the data layer) | Migration composite FK + runtime insert guard | `ProductStoreScopeSchemaTest` | Verified |
| R4 | Stock ledger, transfer items and price lists are store-scoped | Migration store columns + scoped queries | `ProductStoreScopeSchemaTest`, `TransferReceiveMatchingTest` | Verified |
| R5 | No central catalogue: no family linkage, no publish flow; sync upserts keyed `(store_id, external_id)` | Publish flow removed (`CatalogPublishService` deleted); `SyncController` keyed upsert | `SyncPushStoreScopeTest`, `ProductQueryScopeTest` | Verified |
| R6 | Products visible/editable/deletable only within their store; admin cross-store views show a store column and are read-only aggregation | Scoped controllers + store columns in Masters/Transactions/Inventory admin tables + `?store=` URL scope in admin panel | `ProductQueryScopeTest`, `ProductStoreScopingApiTest`, `AdminMasterStoreScopeTest` | Verified |
| R7 | Archives/deletes are per-store and never leak | `AdminMasterController::deleteProduct` scoped | `AdminMasterStoreScopeTest` | Verified |
| R8 | Parties governed by their own spec (explicit scope note) | — | Scope note in constitution | N/A |
| R9 | Rate/tax revisions apply per store; multi-store change is N previewed jobs | `AdminMasterController::bulkEditProducts` store-scoped | `AdminMasterStoreScopeTest` | Verified |
| R10 | Imports target exactly one store; exports are store-filtered | `DataExchangeController::commit/export` require explicit store context; local-first entity definitions tag/filter rows | `DataExchangeStoreScopeTest`, `frontend storeScope.dom.test.ts` | Verified |
| Flow: Copy products to another store | One-time audited reversible copy — masters + rates only, never stock/batches/history | `AdminCatalogController::copy/revertCopyRun`, `/admin/catalog/copy*` routes, MastersPage modal | `CopyProductsToStoreTest` | Verified |
| Flow: Inter-store transfers | Receiver matches by barcode then item code; create-in-my-store or map-to-existing; ledger in both stores | `StockTransferController` receive matching | `TransferReceiveMatchingTest` | Verified |
| Flow: Consolidated reports | Admin-chosen matching key per run (barcode → item code → name+unit), unmatched listed separately, no merges stored | `AdminReportController::consolidatedSales`, ReportsPage "Consolidated Items" tab | `ConsolidatedReportMatchingTest` | Verified |
| Flow: Store-scope migration | One-time migration with reconciliation, dry run and rollback; NULL-store rows adopted by owner store | `php artisan stores:scope-catalog` command | `StoreScopeMigrationCommandTest` | Verified |
| Flow: Offline tills | POS keeps local `store_id` columns; per-store delta pull; no fabricated demo catalog in a real store | `frontend storeScope.ts`, `cloudDeltaSyncService`, `sqliteStorage.ensureCatalogReady` | `frontend storeScope.dom.test.ts`, `productsStore.storeScope.dom.test.ts` | Verified |
| Admin UX | Store scope carried in the URL (`?store=<id|all>`, URL wins over saved scope, invalid params fall back); cross-store lists carry store identity | `admin-panel AuthContext`, `AdminTransactionController` store eager-loads | Live browser verification + suites | Verified |

## Units store-scope reversal (R11) — added 2026-11-19

Change request: "instead unit share use store scope but i want default units should be
there on billing app start and i can add or remove units also can be reset. if delete a
unit and that unit assigned to anything ask to change the unit to another unit before
deleting." Reverses the units carve-out in the store-scope constitution.

| Rule / Flow | Description | Implementation | Verification Test | Status |
|---|---|---|---|:---:|
| R11: per-store seeding | Default unit set (17 units) seeded per store on store creation, billing app start and first units read | `UnitDefaultsService::seedDefaultsForStore` + `AdminStoreController::store` hook + `unitsStore.seedDefaultsIfEmpty` on App boot / `switchActiveStore` + lazy seed in `AdminMasterController::lookups` | `UnitStoreScopeTest` | Verified |
| R11: no shared units | Legacy NULL-store unit rows are removed; till pull-delta delivers only own-store units (other lookup types keep shared+own) | `units:seed-store-defaults` command; `SyncController::pullDeltas` unit split | `UnitStoreScopeTest` | Verified |
| R11: reset to defaults | Missing defaults re-seeded, unused custom units removed, assigned custom units kept | `UnitDefaultsService::resetForStore`, POST `/admin/lookups/reset-units`, `unitsStore.resetToDefaults` + POS "Reset to Defaults" | `UnitStoreScopeTest`, `unitsStore.storeScope.dom.test.ts` | Verified |
| R11: delete guard | Deleting an assigned unit → HTTP 409 with referencing products + candidate replacement units; reassign-then-delete completes | `AdminMasterController::deleteLookup` guard + `?reassign_to=`; POS reassign dialog; admin reassign modal | `UnitStoreScopeTest` | Verified |
| R11: data-exchange parity | Units import/export is store-tagged and store-filtered | `unitsDefinition` withStore + isForActiveStore | `storeScope.dom.test.ts` | Verified |

## Supplier bill charges (CR-C) — added 2026-11-19

Change request: supplier bill charges on purchase entry — a keyboard-driven charges section (Alt+F) with per-charge
GST, treatment (add to item cost / book as expense), spread method (value / quantity / weight), ITC eligibility and
notes, signed adjustments, separately-paid cost links, proportional reversal, registers, admin visibility and
paisa-exact reconciliation. Requirements live in
[purchase-management.md](modules/purchase-management.md) §2A; architecture and data model in
[02-plan.md](02-plan.md) §6; tasks in [03-tasks.md](03-tasks.md) Phase 4C.

**Status legend:** `Planned` = spec written, code not started. Rows move to `In progress` then `Verified` with live
evidence as Phase B/C/D land.

### C1d addendum — the paper a purchase bill leaves behind (2026-11-20)

Task 4.13's printing scope item is a requirement of its own now: [PRN-007](modules/printing-pdf.md) (spec) and the
row below. `PUR-009` and `PUR-013` gain the printed-document consequence of what they already decided — each head's
tax on the paper, and the separately-paid money outside the footings — so an auditor holding the printout reads the
same rupees the engines priced. `PurchaseDetailsDrawer` reprints through the invoice layout and now feeds it the
register's own charge rows (a pre-CR-C bill contributes its freight scalar), which is what keeps the printed grand
total and the posted payable identical to the paisa.

### CR-C-11 addendum — separately-paid charges in the payable (2026-11-20)

One store decision and one stored fact, so a policy change cannot restate a bill that already printed. Tasks
[4.17–4.20](03-tasks.md). Requirements whose *meaning* changed, all of them relaxed from "never" to "unless the
store's policy says so, read from the row":

- `PUR-001` — the invoice-total check and the supplier ledger follow the payable the engine priced, not a
  hard-coded exclusion of separately-paid money.
- `PUR-007` — the charges grid footer names the payable, the charge total, the money left outside it and the
  qualifier when the policy bills it in.
- `PUR-009` — payable membership is a document-level engine input with a per-charge override.
- `PUR-013` — separately-paid is no longer unconditionally outside the payable.
- `PUR-015` — a debit note inherits the membership of the bill it returns.
- `PUR-016` — new key `billing.purchase_charges.separately_paid_in_payable` (default `false`) and the stored
  per-row answer.
- `PUR-017` — the till stores the membership locally and never sends it; the server derives it.
- `REP-005`, `REP-007`, `REP-008`, `REP-009` — payables, both registers, exports and the Tally/Busy vouchers split
  on the stored `in_payable`.
- `CFG-003` — the settings screen and the profile payload carry the switch, with the legacy `"1"`/`"true"` spellings
  mapped.
- `SYNC-007` — the push payload keeps `paid_separately`/`paid_to_label` and omits `in_payable`.
- `NFR-DATA-01` — backend migration + till kv schema v11 add `purchase_charges.in_payable`, backfilled
  `paid_separately → false`.

### C2 addendum — the owner's half of CR-C (2026-11-20)

Task [4.14](03-tasks.md): the screens a multi-store owner uses, and the two policy keys the earlier phases only
declared. Requirements whose *text* changed, none of them about money:

- `CFG-003` — `allow_negative_charges` and `max_percent_of_goods` moved from "declared, not enforced" to enforced at
  `PurchaseChargeService::post()` (both write paths, inside the bill's transaction, before any row is written), the
  settings API normalizes the block on read, and the admin panel Settings page is now the switch surface. The spec
  also states the honest caveat: an offline till commits locally and is refused when the link returns.
- `PUR-016` — the same two keys, plus the shape of a refusal: `charges.<n>.amount` for the sign, `charges` for the
  cap, each quoting the allowance it broke.
- `PUR-008`, `MST-008` — a head's four enums are readable and editable in the panel, the seeded set is restorable
  per store, and a head a posted charge still references is undeletable until those charges move.
- `REP-007` — adds `GET /admin/purchase-charges` and the panel's Bill Charges tab: rows read from the stored
  `in_payable`, filterable and exportable, store identity on cross-store reads.
- `R6`, `R12` — no new rule; the charges endpoint, the heads master and the settings block inherit the caller's
  store scope rather than widening it.
- API contract only (`/settings` charge-policy block, `/purchase-charges`, `/lookups/{id}` answering 409 with the
  referrers and the candidates): no requirement ID moved, the contract caught up with what 4.4–4.14 shipped.
- `specs/data-exchange-templates.md` §2a — the purchase-charges template inherits the same policy check, because its
  post-import hook is the sync code path: a sheet that keys a negative or over-cap charge is refused when it syncs.
- One over-claim corrected while writing these deltas: three documents said a `max_percent_of_goods` of `0` is "a real
  cap that refuses every charge". The engine returns before measuring for any cap `<= 0`
  (`AdminSettingsTest::test_no_cap_is_set_when_the_key_is_absent_or_zero`), so `0` and blank both mean no cap; the
  panel still writes blank as `null` so the field reads back empty rather than showing a `0` that limits nothing.

### Phase D addendum — the four-way reconciliation gate (2026-11-20)

Task [4.15](03-tasks.md): `PurchaseChargeReconciliationTest` closes `02-plan.md` §6.6 to the paisa from four
independently written artifacts (allocation rows, batch `landed_cost_rate`, the expense register, the bill's own tax
columns) rather than restating the engine's arithmetic, over posted, edited, returned and cancelled documents in both
treatments — including the ₹11,554 worked example both ways. One vacuity control removes `0.01` from a spread row and
asserts the gate fails by exactly that paisa.

Requirements the gate touched, all from a defect it found rather than a change of intent:

- `PUR-012`, `PUR-015` — an expense-treated charge's *notional* per-line shares (derived only so the reversal totals)
  were reaching `reduceLandedCost()`, so returning a line valued a batch ₹157.33 below the supplier's own rate on a
  ₹236 blocked insurance row. `reversalMap()` now keeps the two maps apart: `charges` covers every charge line,
  `lines` only the add-to-cost ones. Fixed identically in the till's `chargeTotals()` ([frontend/src/lib/purchases/chargeReversal.ts](../frontend/src/lib/purchases/chargeReversal.ts));
  the backend test failed at `98.4267` before the guard, the till test fails the same paisa with the guard removed.
- `PUR-003`, `PUR-011` — same fix, asserted from the other side: a full return puts every batch back at exactly
  `purchase_rate`, and `PUR-011`'s "original purchase rate stays visible" is now proven against the spread rows
  instead of only against posting.

### Phase D addendum — what was driven live (2026-11-20)

Admin panel against the local server, database read back after each step; the automated gates in the same round are
backend `OK (792 tests, 7992 assertions)`, till `979 passed (124 files)`, panel `21 passed (4 files)`.

- `MST-008`, `PUR-008` — head created with all four defaults and a SAC, `Reset to Defaults` removed the unreferenced
  custom head (`audit_logs.reset_charge_heads`), the `409` on delete opened *Reassign bills before deleting* naming
  CRC-D-0001/2/3 at ₹278.48 each and offering only this store's heads, and reassigning to Insurance retagged all three
  rows with money and `in_payable` untouched.
- `CFG-003`, `PUR-016` — the Settings block saved `max_percent_of_goods: 5`, then a cleared cap as `null`; a bill at
  ₹1,236 of charges against ₹8,000 of goods was refused at `charges` naming the ₹400.00 allowance, and a −₹50 line at
  `charges.0.amount`. Flipping `separately_paid_in_payable` between two identical bills moved only the later one:
  ₹15,283.00 with the ₹590.00 courier row stored outside, ₹15,873.00 with the same row stored inside.
- `PUR-001`, `PUR-002`, `PUR-011`, `PUR-012`, `PUR-013` — one live bill booked freight ₹1,000 + ₹180 GST into stock cost
  (₹800 / ₹200 by value, batch at ₹90.00 with `purchase_rate` still ₹80.00), an expense-treated blocked-ITC row into the
  register at ₹278.48 (₹42.48 non-creditable tax riding along) and a separately-paid row at ₹500.00 ex-tax.
- `REP-005`, `REP-007`, `REP-008`, `REP-009` — Bill Charges tab rows, the `In payable = No` filter returning exactly the
  one stored-outside row and footing ₹0.00 against ₹590.00; the Inward Purchases `Charges` column showing
  `₹1,458.48 + ₹590.00 outside`; `GET /api/reports/expense-register` carrying `in_payable` per row; GSTR-3B's charge
  block at taxable ₹4,708, tax ₹717.44, creditable ₹590, non-creditable ₹127.44, `reconciles: true`; Tally vouchers with
  charge ledger lines and the separately-paid courier split into its own payment voucher; the data-exchange purchases
  export emitting `charges[]` plus billed-vs-landed cost per line.
- **Not driven live:** the till's own screens — `Alt+F` charges grid, offline posting, the purchase push and purchase
  printing (`PUR-007`, `SYNC-007`, `PRN-007`, and the return/edit/cancel reversal path `PUR-003`/`PUR-015` that only a
  synced document can exercise). The entry screen now opens behind a counter activation code, which is another change
  request's surface, so these stay covered by their suites alone until the till is activated on purpose.

| Requirement ID | Description | Spec | Implementation Task | Verification Test | Status |
|---|---|---|---|---|:---:|
| `PUR-001` *(changed)* | Totals computed in one engine pass including charges; invoice check includes supplier-borne charges; payable = charge-inclusive grand total | purchase-management.md | 4.5, 4.8, 4.9, 4.17 | `TC11`–`TC22`, `PurchaseEntryParityTest`, `PurchaseChargePostingTest`, `PurchaseChargePayablePolicyTest` | In progress |
| `PUR-002` *(changed)* | Effective/landed unit cost includes add-to-cost allocation, free units still counted | purchase-management.md | 4.6, 4.9 | `TC19`, `TC20`, `PurchaseChargePostingTest`, `chargePosting.test.ts` | In progress |
| `PUR-003` *(changed)* | Purchase return reverses the returned share of charges | purchase-management.md | 4.12 | `PurchaseChargeReversalTest`, `chargeReversal.test.ts`, `PurchaseChargeReconciliationTest` (a full return zeroes every charge term) | In progress |
| `PUR-007` | Charges section under the item grid, opened by Alt+F, fully keyboard-driven | purchase-management.md | 4.8 | `PurchaseChargesModal.test.tsx`, `chargesGrid.test.ts`, `centralKeyMap.test.ts`, `publishedKeyMap.test.ts`, `PurchaseEntryCharges.dom.test.tsx` (keyboard-only walkthrough on the bill itself: Alt+F, arrows, Space/Enter, Ctrl+Enter, F8/F12 alive over the grid, the F12 charge block) | In progress |
| `PUR-008` | Charge head master per store with per-head treatment/spread/ITC defaults | purchase-management.md | 4.4, 4.14 | `ChargeHeadStoreScopeTest`, `chargeHeadsStore.storeScope.dom.test.ts`, `MastersPageChargeHeads.dom.test.tsx` | In progress |
| `PUR-009` | Per-charge GST through the shared engine; supplier place of supply decides intra vs inter; payable membership is an engine input with a per-charge override | purchase-management.md | 4.5, 4.17 | `TC12`, `TC19`, `TC21`, `TC22`, `TaxEngineTest`, `taxEngine.test.ts`, `payablePolicy.test.ts`, `purchaseChargesPrint.test.ts` | In progress |
| `PUR-010` | Spread by value/quantity/weight, paise-exact, stated largest-remainder + grid-order tie-break, weight→value fallback | purchase-management.md | 4.6 | `TC13`, `TC14`, `TC15`, `TC19`, `TC20`, `TaxEngineTest`, `taxEngine.test.ts`, `chargesGrid.test.ts` | In progress |
| `PUR-011` | Landed cost stored per batch; original purchase rate stays visible | purchase-management.md | 4.7, 4.9 | `PurchaseChargeSchemaTest`, `PurchaseChargePostingTest`, `chargePosting.test.ts`, `PurchaseChargeReconciliationTest` (each batch's rate re-derived from its own bill's spread rows, `purchase_rate` untouched) | In progress |
| `PUR-012` | Expense-treated charges post to the expense register ex-tax; non-creditable tax rides along | purchase-management.md | 4.9 | `TC16`, `TC20`, `ExpenseManagementTest`, `PurchaseChargePostingTest`, `chargePosting.test.ts`, `PurchaseChargeReconciliationTest` (an expensed credit reverses to the register, never onto a batch) | In progress |
| `PUR-013` *(changed by CR-C-11)* | Separately-paid costs linked to a purchase; same spread; out of the payable and the invoice check unless the store's `separately_paid_in_payable` policy bills them in, and then only as the membership stored on the row | purchase-management.md | 4.9, 4.10, 4.13, 4.17, 4.18 | `TC18`, `TC20`, `TC21`, `TC22`, `PurchaseChargeSeparatePaymentTest`, `PurchaseChargePayablePolicyTest`, `chargePosting.test.ts`, `payablePolicy.test.ts`, `purchaseChargesPrint.test.ts` | In progress |
| `PUR-014` | Negative adjustments (cash discount, round-off, TCS) with signed tax | purchase-management.md | 4.6, 4.8 | `TC16`, `TC19`, `TaxEngineTest`, `taxEngine.test.ts`, `chargesGrid.test.ts` | In progress |
| `PUR-015` | Return/edit/cancel reverse and re-post charges, stock cost, payable and tax together; a note inherits the payable side of the bill it returns | purchase-management.md | 4.12, 4.18 | `PurchaseChargeReversalTest`, `chargeReversal.test.ts`, `PurchaseChargePayablePolicyTest`, `payablePolicy.test.ts`, `PurchaseChargeReconciliationTest` (posted / part-returned / fully-returned / cancelled / edited documents each close the identity) | In progress |
| `PUR-016` *(changed by CR-C-11)* | Proportional vs sunk-charge return policy; per-store charge policies incl. `separately_paid_in_payable`, with the payable membership stored per charge row | purchase-management.md | 4.4, 4.12, 4.13, 4.14, 4.17, 4.19 | `PurchaseChargeReversalTest`, `chargeReversal.test.ts`, `AdminSettingsTest` (policy persistence, read-model normalization, sign and cap refusals with their `charges.{i}.amount` / `charges` error keys), `PurchaseChargePayablePolicyTest`, `PurchaseChargeSchemaTest`, `sqliteStorage.test.ts`, `companySettingsService.test.ts`, `SettingsPageChargePolicy.dom.test.tsx` | In progress |
| `PUR-017` | Offline charge entry, aggregate idempotent sync, legacy freight migrated into the Freight head; on the entry screen the charge rows replace the freight scalar in both directions — a pre-CR-C bill opens its `freight_charges` as one 0% Freight row and a bill with rows sends `charges[]` and no scalar | purchase-management.md | 4.7, 4.8, 4.11 | `PurchaseChargeSchemaTest`, `sqliteStorage.test.ts`, `SyncPurchaseChargesIngestTest`, `AccountingExportChargesTest`, `PurchaseEntryCharges.dom.test.tsx` | In progress |
| `MST-008` | Charge heads master CRUD, per-store seeding, reset, delete guard with reassignment | master-data.md | 4.4, 4.14 | `ChargeHeadStoreScopeTest`, `chargeHeadsStore.storeScope.dom.test.ts`, `MastersPageChargeHeads.dom.test.tsx` (admin panel: head defaults column, create with treatment/spread/ITC/sign/SAC, reset, reassign-before-delete) | In progress |
| `REP-007` | Purchase register shows items and charges separately, splitting the payable on the membership stored with each charge row | reports-gst.md | 4.13, 4.14, 4.18 | `PurchaseChargeReportsTest`, `AccountingExportChargesTest`, `purchaseChargeRegister.test.ts`, `AdminPurchaseChargesTest` (`GET /admin/purchase-charges`: rows, filters, summary footing, export, store scoping, permissions), `PurchaseChargesPanel.dom.test.tsx` (admin panel Bill Charges tab; the Charges column added to the purchase register on the same screen still has no test of its own — seen live 2026-11-20, showing `₹1,458.48 + ₹590.00 outside`) | In progress |
| `REP-008` | Expense register report (net-new) including expense-treated charges, with an `In Payable` column read from the row | reports-gst.md | 4.13, 4.18 | `PurchaseChargeReportsTest`, `AccountingExportChargesTest`, `expenseRegister.test.ts` | In progress |
| `REP-009` | Margin follows treatment; GST input summaries follow ITC eligibility; RCM charges flagged for review | reports-gst.md | 4.13 | `GstWorkingPapersTest`, `PurchaseChargeReportsTest`, `AccountingExportTest`, `AccountingExportChargesTest` | In progress |
| `REP-005` *(changed)* | Supplier payables include supplier-borne charges in both treatments, exclude separately-paid | reports-gst.md | 4.9, 4.13 | `PurchaseChargePostingTest`, `PurchaseChargeSeparatePaymentTest`, `chargePosting.test.ts` | In progress |
| `PRN-007` *(new, C1d)* | Every printed purchase document names each charge head with taxable, GST and total; in-payable rows sit inside the footings, separately-paid rows print as a marked memo below the grand total; no rows prints no block; the footing equals the posted payable to the paisa | printing-pdf.md | 4.13 | `purchaseChargesPrint.test.ts` (A4 purchase, invoice reprint, 80- and 132-column dot matrix, sales document untouched), `PurchaseEntryPrint.dom.test.tsx` (the payload the entry screen hands the preview, keyed charge and legacy freight) | In progress |
| `CFG-003` | Per-store purchase charge policy persisted in `billing` settings, enforced server-side at the single posting choke point, settable from the admin panel — incl. `separately_paid_in_payable` (CR-C-11), `allow_negative_charges` and `max_percent_of_goods` | auth-security-settings.md | 4.4, 4.14, 4.17, 4.19 | `PurchaseChargePayablePolicyTest`, `companySettingsService.test.ts`, `payablePolicy.test.ts`, `AdminSettingsTest` (both keys enforced + normalized reads), `SettingsPageChargePolicy.dom.test.tsx` (switches, blank cap saves as no cap) — both switches and the cap refusal driven live in the dev panel on 2026-11-20 | In progress |
| `SYNC-007` | Charges ride inside the purchase push payload; no orphan child entity; server recompute equals till paisa; the payload never carries the payable membership | sync-offline-lan.md | 4.11, 4.12, 4.17 | `SyncPurchaseChargesIngestTest`, `chargePosting.test.ts`, `chargeReversal.test.ts`, `payablePolicy.test.ts` | In progress |
| `POS-004` *(annotated)* | Round-off now follows the charge stage; sales vectors `TC01`–`TC10` must not move | pos-billing.md | 4.5 | `TaxEngineTest`, `taxEngine.test.ts` | Planned |
| `R12` | Charge heads belong to one store and are never shared; till delta is own-store only | constitution.md | 4.4, 4.7, 4.11 | `ChargeHeadStoreScopeTest`, `PurchaseChargeSchemaTest`, `SyncPurchaseChargesIngestTest`, `chargePosting.test.ts` | In progress |
| Keyboard | `focusFreight` → `toggleCharges` on Alt+F; new `chargesGrid` modal-scope actions; purchase screen chords move to the dispatcher | keyboard-shortcuts.json | 4.8 | `publishedKeyMap.test.ts`, `centralKeyMap.test.ts` — the Alt+F rebind, modal-scope routing and both published artefacts are in, and the entry screen answers the chord from `centralKeyMap`; `shortcutDispatcher` itself is still only wired by tests, so the screen keeps its own window listener | In progress |
| API contract | charges[] in `PurchaseDocumentInput`, purchase edit/cancel, `/purchase-charges` (routed, `export=true` folds the planned separate export path), `/settings` charge-policy block, `/lookups/{id}` reassign-before-delete, `/sync/purchases`, expense link fields | api/openapi.yaml | 4.4–4.14 | contract tests per suite above | In progress |
| Data exchange (server) | `purchases` + `purchase_charges` templates, charge-aware `export/purchases` (charges, billed vs landed) and `export/purchase_charges` | data-exchange-templates.md §2.4(2)/(2a) | 4.13 | `AccountingExportChargesTest`, `DataExchangeStoreScopeTest` | In progress |
| Data exchange (till) | `charge_head` + `purchase_charges` entity definitions and purchase charge columns in the till registry | data-exchange-templates.md §2.4 | 4.13 | till registry tests | Planned |
| Release gate | Four-way paisa reconciliation (stock cost / supplier ledger / expense register / tax) on posted, edited, returned and cancelled bills | 02-plan.md §6.6 | 4.15 | `PurchaseChargeReconciliationTest` (11 tests: the ₹11,554 worked example in both treatments, blocked-ITC, separately-paid outside the payable, the policy flip, part/full return, cancel, edit, a whole-store aggregate, and a paisa vacuity control) | Verified |

## Counter-only POS (CR 2026-11-19, Part 1) — added 2026-11-20

Spec home until Wave F4 creates the module specs: `cr/2026-11-19-counter-only-pos/spec-delta.md`.

| Requirement ID | Description | Spec | Implementation Task | Verification Test | Status |
|---|---|---|---|---|:---:|
| `CNT-001` | `counters` is the identity scope: claim state, permission profile, idle/grace settings, unlock PIN, current device, retirement | cr/2026-11-19-counter-only-pos | A1 | `IdentityScopeSchemaTest` | In progress |
| `CNT-002` | Admin counter CRUD with naming rules | cr/2026-11-19-counter-only-pos | A2 | `CounterAdminCrudTest`, `CounterNameUniquenessTest` | In progress |
| `CNT-003`, `CNT-004` | Per-counter activation codes: hard single use, owner TTL, hash-only, shown once, QR payload | cr/2026-11-19-counter-only-pos | A3 | `ActivationCodeSingleUseTest` | In progress |
| `CNT-005`, `CNT-007` | Code issue/re-issue/revoke with rate-limit, lockout and owner alert; one active device per counter | cr/2026-11-19-counter-only-pos | A4 | `DeviceActivationSecurityTest`, `ActivationCodeLockoutTest` | In progress |
| `CNT-006` | `POST /api/counters/claim` binds device→counter and answers the whole tenancy; token into the OS vault | cr/2026-11-19-counter-only-pos | A5, A6 | `CounterClaimTest`, `CounterOneDeviceTest`, `PinSecrecyScanTest`, `storeDeviceService.claim.test.ts` | In progress |
| `CNT-013` | Setup screen is code/QR-only; store-key and owner-login tabs retired; keyboard-only | cr/2026-11-19-counter-only-pos | A7, A10 | `storeSetupClaim.dom.test.tsx`, `RetiredRegistrationPathsTest` | In progress |
| `CNT-011` | `GET /api/counter/context`: counter, profile, defaults, grace, cached-credential manifest | cr/2026-11-19-counter-only-pos | A8 | `CounterContextTest` | In progress |
| `CNT-011` | Offline grace is a server-set absolute deadline the till keeps as its own clock: grace spent locks billing locally (credential intact), a revoked or retired counter wipes the token on reconnect, a locked one pauses without losing its claim | cr/2026-11-19-counter-only-pos | A12 | `CounterGraceOfflineTest`, `counterGraceService.test.ts`, `storeDeviceService.grace.test.ts`, `posCartService.grace.test.ts` | In progress |
| `CNT-012` | `counters:migrate-from-devices` converts devices with names, series and history; rollback | cr/2026-11-19-counter-only-pos | A9 | `CounterMigrationTest` | In progress |
| `CNT-014` | The counter owns its numbers: seven document types per counter, lease by counter id, `TEMP-*` never filed as a final number, tills number from the server's count | cr/2026-11-19-counter-only-pos | A11 | `CounterSequenceLeaseTest`, `documentSequenceSync.test.ts`, `counterSequenceService.test.ts`, `storeDeviceService.seriesBoot.test.ts`, `syncRenumbering.test.ts`, `remoteCounterSync.test.ts` | In progress |
| `CNT-008` | One device holds one claimed counter per store: identity is `(store_id, device_uuid)`, a second counter in the same store is refused, and the till's token, profile and local database follow the store it stands in — a release hands them to the next store | cr/2026-11-19-counter-only-pos | A13 | `CounterMultiStoreDeviceTest`, `storeMultiCounterIsolation.dom.test.ts`, `storeRegistryService.test.ts` | In progress |
| `CNT-009` | Admin panel `CountersPage`: create (with the store it links the counter to picked in the dialog and the store's next free code filled in, blank only when that numbering is not on screen — and a blank code is numbered by the server), rename, lock/unlock, issue/re-issue/revoke codes with QR, delete-request that retires a counter holding documents, each card showing status, device, last activity, last salesperson and unsynced items — every action an audited API call that lands without a reload, and no per-counter write offered in all-store scope | cr/2026-11-19-counter-only-pos | A14, A15 | `CountersPage.dom.test.tsx`, `CounterAdminCrudTest` | In progress |
| API contract | `GET /api/counter/sequences`, `POST /api/counter/sequences/lease`, `sequences` in claim/context, `renumbered` in every push response | api/openapi.yaml | A8, A11 | `CounterSequenceLeaseTest`, `syncRenumbering.test.ts` | In progress |

## Counter-only POS (CR 2026-11-19, Part 2 — permission profile and locking) — added 2026-11-21

| Requirement ID | Description | Spec | Implementation Task | Verification Test | Status |
|---|---|---|---|---|:---:|
| `PRF-006` | One PIN policy for every credential the store issues: 6 digits with no repeated, sequential or trivial values in the counter/approver/salesperson/pharmacist domains (the legacy staff login keeps its 4-digit floor), the fifth wrong attempt locks for 15 minutes until an owner resets, and no API returns the PIN or its hash | cr/2026-11-19-counter-only-pos | B6 | `PinPolicyTest` (10 tests, 95 assertions) | In progress |
| `PRF-006` | The counter's own unlock credential: the owner sets it from the panel and only a bcrypt hash is stored, the till verifies it against the counter its device token belongs to (five wrong attempts lock it for 15 minutes until a reset), and the hash ships only through the counter-scoped offline-cache endpoint | cr/2026-11-19-counter-only-pos | B7 | `CounterUnlockPinTest` (13 tests) + `CountersPage.dom.test.tsx` (4 tests) | Done |
| `PRF-005` | The counter's idle lock at the till: the owner's minutes for that counter are counted on the till (its own five minutes only while no context has been read, and a new value takes effect without waiting for the next keystroke), the screen names the counter it locked, and what opens it is that counter's PIN — checked by the store server, or by the bcrypt hash cached for that counter alone while offline. A staff or approver PIN is refused with the server's reason and its attempt count, the fifth wrong attempt hands the counter to the owner, the screens behind stay mounted so the open work is still there, and the minutes and cached credential are store-keyed and purged when the counter is let go | cr/2026-11-19-counter-only-pos | B8a | `IdleLock.dom.test.tsx` (11 tests) + `storeDeviceService.test.ts` (IS9, 2 tests) | Done |
| `IS1`, `IS3` | The counter authorises the till's own routes: one device token opens the store operations that used to need a person's bearer token, the request is always scoped to the store that token was issued for, a header or body field naming another store is refused rather than followed, a local registry key never moves the tenant, a locked counter loses those routes with it, and an admin who names no store is refused instead of being pointed at whichever store is first. A person's preferences and password stay person-only | cr/2026-11-19-counter-only-pos | A16a | `CounterAuthorisesPosRoutesTest` (11 tests, 38 assertions) | Done |
| `IS1`, `IS3`, `IS5` | Staff management at the till is opened by the counter, not by a person: the claimed counter's device token lists, creates, edits, unlocks, resets the PIN of and deletes accounts in **its own branch only**; a body naming another branch is refused before anything is written; no counter creates or promotes a Super Admin or grants multi-branch access; another branch's accounts are out of reach for every verb; a bearer token with no device token gets 401 on these URIs while the admin panel's own door is untouched; a locked counter loses them with it; and the audit names the counter (`counter:C01 (Front Counter)`) with no person id, no email and no PIN or token in the payload | cr/2026-11-19-counter-only-pos | A16b | `TillStaffManagementTest` (10 tests, 66 assertions) + `signinRetired.test.ts` | Done |
| `SEC-001` | Retired at the till: no screen signs a person in, the cashier switcher and its keyboard chord are gone, and what decides the surface is the counter's own document — the nav, reports, palette, gates, staff panel, product delete, stock adjustment, invoices, shifts and presence heartbeat all key off the claimed counter. The sign-in machinery still inside `staffAuthService` has no production caller and is booked for deletion with its suites rewritten, not dropped | cr/2026-11-19-counter-only-pos | B8b-3 | `signinRetired.test.ts` (9 tests) | Done |
| `IS5`, `SEC-001` | No credential is kept in browser storage at the till: the staff bearer token and the cached-credentials record (which held PIN and password hashes) are written by nothing and read by nothing, and whatever an older build left is erased on boot and at logout; the six services that used to send that token now send the counter's device token, and the till's own preferences stay on the till keyed to the counter because `/api/me/preferences` answers only for a person. The constitution scan pins the booked-token list as **empty**, so a new token writer fails the build | cr/2026-11-19-counter-only-pos | B8b-4 | `PinSecrecyScanTest` (9 tests, 71 assertions) + `userPreferencesService.dom.test.ts` (5 tests) + `deviceSessionService.test.ts` (17 tests) | Done |

**Driven live (2026-11-21, A16b / B8b — dev API `127.0.0.1:8000`, till `localhost:5173`, throwaway tenant created and deleted):**

* A throwaway store + counter was claimed **through the till's own claim screen** in the browser; the app booted to `/dashboard` naming that store and counter with **no sign-in step**, and `/pos` opened with the counter's own invoice series. `localStorage` held no `staff_token` and no `active_staff_session` key at any point.
* Settings → Security & Cashiers → Staff panel listed the branch (only that branch), created a cashier (row appeared, `POST /api/till/staff` → **201**), reset its PIN and deleted it — and the network log contains **zero** `/api/admin/users` calls. Server side: the created row carried the counter's `store_id`, and `Hash::check` proved the PIN the UI set is the PIN stored.
* Both audit rows written by those UI actions read `actor=counter:C01 (B8b QA Counter)` with `user_id=NULL`; the trail contains no PIN and no device token.
* API probes on `/api/till/staff`: list **200** scoped to one row of that store; create **201**; create Super Admin **403**; multi-branch grant **422**; every verb on another branch's account **403**; person bearer with no device token **401**; locked counter **403**.
* Profile propagation: `GET /api/counter/context` read version 1 with all 15 modules, the owner saved a narrowed document (`PUT /api/admin/counters/{id}/profile` → **200**, `changed=version,modules,reports,settings_editable`), and the counter's own context then read version 2 with `modules=dashboard,pos,bills`, no reports and `settings_editable=theme`.
* **Not covered:** the till's nav was not re-driven against the narrowed document in a browser this round (that is B11), and QA tenants were torn down with their Sanctum token rows deleted explicitly — a first teardown attempt aborted on a `withTrashed()` call and was re-run scoped, leaving nothing behind (verified `survivors=0/0/0`).
* **Known gap this leaves:** `/api/till/staff` answers for the counter regardless of what its permission document says — removing the `settings` module hides the tab but does not refuse the call. That fail-closed gate is B2/B3's `counter.profile` middleware, not A16b, and is recorded as still open.

