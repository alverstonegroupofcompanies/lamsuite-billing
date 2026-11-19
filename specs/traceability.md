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
