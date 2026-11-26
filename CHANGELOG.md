# Changelog

## 2.1.10 — 2026-11-26

The stock adjustment document made a pharmacist find one product inside a native `<select>` holding the whole
stocked catalog — 105 options on the migrated store, no way to type what they were looking for, and a second
batch list that ignored expiry order. Both cells now use the searchable combobox the purchase and transfer
screens already use.

1. **Product and batch cells search** — `BatchCombobox` matches product name, batch number, primary and
   secondary barcodes, generic name and HSN, ranks name-prefix hits first, and shows batch, expiry and stock
   on every row. The product cell searches the whole stocked catalog and files the batch it lands on, so one
   choice fills product, batch, system quantity and unit cost; the batch cell lists only the chosen product's
   batches, earliest expiry first.
2. **Enter belongs to the picker** — the grid engine commits an edit on Enter and so does a combobox
   selection, and both firing dropped the cursor into the next cell mid-selection. Enter now stops at the
   cell and the combobox hands the grid over through `onEnter`. Escape closes the dropdown first and cancels
   only the edit on the next press, which is what it did with the old `<select>`.

Verification: `StockAdjustmentDocumentModal.test.tsx` (10 tests) drives the real modal and the real combobox —
narrowing by name, batch scoping with FEFO order, and a keyboard pick reaching the posted payload — plus the
full frontend suite and `tsc --noEmit`. One unrelated purchases-print test failed in the full run and passed
on its own, which is contention in a shared tree rather than this change. Not clicked through in the built
desktop app.

No schema, setting or endpoint changed, and nothing is re-imported: the adjustment document posts the same
lines it always did.

## 2.1.9 — 2026-11-26

The corrected wizard was run against the running legacy panel, and its pre-check came back:
Products 105 · **Batches & Stocks 0** · Sales Invoices 88 · **Purchases 0** · Customers 40 · Held Bills 0,
**Blockers Detected** — *"2 documents carry no bill number"* — under it warnings for 2 total variances,
12 lines priced from the product catalog, 91 lines filed at the bill's own average slab, 2 placeholder HSN
codes, and a note that the source states no tax mode. Every one of those was a field the importer still
read under a different name, or a decision nobody had asked the operator to make.

1. **A product carries its own batches** — the legacy pull has no batches entity at all: it loads each
   product's batches into `products[].batches`, and those rows state no quantity column, only `packs`,
   `units_per_pack` and `loose_qty`. `batchesOf()` now collects batch rows under every spelling — a
   top-level `product_batches`/`batches`/`batch_stocks`/`stocks` list and the rows nested in the product
   that owns them — deduped by external id, row id and product+batch_no, and `batchStock()` totals the
   pack pair. The total had a bug of its own: a row with no quantity column hit the `null` sentinel and
   returned `-1` instead of doing the pack arithmetic, which is a shelf of negative stock.
2. **A purchase bill is a `purchase_documents` row** — numbered `reference_no` (or `purchase_number`),
   dated `date`, with `gst_pct` as a *percent* and never a rupee tax figure, and the item's name in
   `description` — which is why a migrated purchase line read "Item". Purchases now count, import, and
   reconcile instead of reporting zero.
3. **An unnumbered document gets a number rather than being deleted** — a bill with no number under any
   key but a readable row identity is filed as `MIGBILL-`/`MIGPUR-` plus the tail of that identity, its
   money, stock and party balances kept, counted in the new `renumbered` stat, and left on the review list
   as a `document_number` item naming the number it was given. The pre-check *warns* and lists those
   numbers; only a row with neither a number nor an identity still blocks, because nothing can be traced
   back to it after cutover.
4. **A placeholder HSN is not an HSN** — `hsnCode()` treats `''`, `00000000`, `NA`, `NIL`, `NONE` and `-`
   as absent, so the GST print layer falls back to the product master instead of filing a zero as a code.
5. **The wizard asks how the old system priced a bill** — the v1 panel stores that switch nowhere in its
   pull, so "the source does not state a tax mode" is a true sentence with no answer attached. Step 1 now
   offers the three answers (*read it from the source* / *shown price includes GST* / *GST added on the
   rate*), sends the choice as `config.tax_mode` to both the scan and the run, keeps it on the run's
   `mapping_config` so a replay reads prices the same way, and writes it into the `billing` company
   setting the till actually consults — including for a bundle that carries no store profile at all.
   `StoreTaxPolicy::statedModeForStore()` stopped treating the `stores.tax_mode` column as an operator
   statement (its non-null default is `inclusive`, on a store nobody ever configured), so an unset till is
   now blocked at pre-check with instructions instead of re-pricing a year silently while the totals still
   reconciled.
6. **Counts that describe the run** — `record_counts` gained `sales_invoices`, `credit_bills` and
   `purchases`, read the way the importer files documents rather than by which key a row arrived under (a
   return kept inside the invoice table tagged `sales_module_key: credit-note` *is* a credit bill), the
   wizard's tiles show them, and `total_records` no longer counts a bill twice — once as the table it came
   in on and once as the document it is filed as. Held Bills showing 0 now carries an explanation beside
   it: those rows live on each till, not in a panel database.
7. **`config` survives its own validation rule** — adding a rule for `config.tax_mode` made Laravel's
   `validated()` prune the array down to the children its rules name, so `bundle_ref`, `url` and `since`
   disappeared and every till scan died on *Undefined array key "config"*. The reader is handed the
   request's own copy after the rules have checked it.

Verified in `MigrationLegacyShapesTest` (20 tests) and `TillMigrationPipelineTest` (16): a payload shaped
exactly as the panel answers — nested batches, a `credit-note` inside `invoices`, a `purchase_documents`
row numbered `reference_no` with `gst_pct` lines — pre-checks as Batches 1, Purchases 1, Sales Invoices 2,
Credit Bills 1, and imports 34 units onto the shelf (3 × 10 + 4), the reversal as `module_key credit_note`,
and the purchase line at ₹88.00 under the 12% slab. An unnumbered bill is named at pre-check and survives
the run; the same row with its identity removed blocks. A store that never stated a pricing mode cannot be
scanned until the operator states one, and the mode stated at the till is the mode the run saves — on the
`billing` setting, the store row and the run row. Backend 1283 tests, frontend 1240, both `tsc` clean.
Not covered: a live pull from the panel (minting its migration token is a manual screen) and a built
installer. The 88 invoices already migrated on the production store keep the figures written before this
build — roll that run back and re-run it on this build before filing anything from it.

After pulling: no `migrate --force` and no artisan step — this release adds no schema. Re-import the
batches and purchase bills from the same bundle (the id maps make a second run update the rows it stamped
rather than duplicating them), then set the till's Billing tab to how the shop actually billed and check the
`document_number` entries in Migration Center's review list for the bills that had no number.

## 2.1.8 — 2026-11-25

A store finished the wizard, and its reconciliation report read: Products 105, Batches 124, Invoices 88,
**Purchases 0**, Sales turnover ₹750730.68 matched, Purchases source ₹307865 against target ₹0, Migrated
Stock Valuation **₹0 / 0 units on-hand**, and under it a list of every bill in the financial year saying
*`tax_engine_variance` — Invoice #ADH-CN26-27-0040: stored ₹14.43 vs authoritative TaxEngine ₹0.00`*.
`is_passed` was false, so cutover was refused on a migration that had in fact landed. Both systems bill
tax-exclusive; the till still showed **Prices include tax**.

The rows were there because v2.1.7 made the pipeline real. The numbers were wrong because the pipeline
reads one spelling per field, and the legacy panel exports several:

1. **A normalizer now owns the spelling** — `LegacyRecordNormalizer` maps each v2 column to the key list
   a v1 export actually uses (`bill_no`/`invoice_no`/`document_number`, `bill_amount`/`grand_total`/
   `total`, `basic_amount`/`taxable_value`/`subtotal`, `bill_date`/`date`/`voucher_date`, day-first
   `11/05/2026` dates, `sale_type`/`invoice_type` status) and separates *rate* spellings from *amount*
   spellings, which is what turned a taxed year into 0%: a line carrying `tax_percent` was read as
   nothing, so `gst_percent` arrived 0 and the engine recomputed the bill at ₹0 tax. A line that states
   no rate falls back to its own tax-over-taxable, then the product master, then the bill's average
   slab — and each fallback is counted and reported instead of silently applied.
2. **Credit bills exist** — `sales_returns`, `returns` and `credit_notes` were never read at all, so
   ₹107552.50 of reversals simply was not in the new system. They now land as `invoices` rows with
   `module_key = 'credit_note'`, positive money, and `original_invoice_number` pointing at the bill they
   reverse — the sign convention this schema already uses when it nets turnover. Reconciliation nets them
   on both sides, so a year of returns no longer counts as a year of extra sales.
3. **A bill that cannot be filed is listed, not lost** — the purchase importer skipped any row without an
   `invoice_number`, which is how a branch's entire purchase history and its `debit_note` returns vanished
   without a trace. An unmatchable row now becomes a `migration_unresolved_items` record naming the
   document and why, `is_importable` false, and the pre-check blocks the run before it starts.
4. **Stock opens with units in it** — batch rows spell on-hand `stock`, `quantity`, `balance`, `in_stock`
   or `available_qty`, and cost `ptr`/`purchase_rate`; both were read as absent, giving 124 batches at
   0 units and ₹0 valuation. A source whose batches name no quantity column at all is a pre-check error,
   because after import it is indistinguishable from an empty shelf. `product_batches.expiry_date` is
   NOT NULL, so a batch the export leaves undated is filed with an assumed date and recorded as a
   `batch_expiry` review item naming it — an undated shelf is a correction to make, not a row to drop.
5. **The tax mode is saved where the till reads it** — the pipeline wrote `stores.tax_mode`, but
   `StoreTaxPolicy` consults the `billing` company setting first, so the write never reached the counter.
   The migration now writes `billing.tax_mode` and mirrors the store column, reads the legacy mode under
   `tax_type`/`gst_tax_type`/`price_includes_gst` (including the misspelling `price_incines_gst` the v1
   settings row uses), and leaves the store's own mode alone when the source states none. The reconciler
   stopped reading `invoices.is_tax_inclusive` — a column this schema has never had, so it always saw
   `null` and pinned every recomputation to one mode.
6. **A variance is a warning, a missing record is a block** — the migrated rupees are kept exactly as the
   legacy system reported them, so a recomputation difference against the engine is advisory and cutover
   stays open; only counts and totals that do not reconcile hold it. An export that mixes slabs and
   states tax only on the bill is reported as such rather than filed at 0%.
7. **The wizard says what it had to work around** — the summary tiles gained Credit Bills, Purchase
   Returns, Rates From Master/Bill, Unlinked References and Listed For Review, and pre-check issues carry
   the offending document numbers, so the next report is not a table of zeros to be read afterwards.

Verified against the shapes the legacy panel emits, in `MigrationLegacyShapesTest` (18 tests) and
`LegacyRecordNormalizerTest` (16): a bundle whose invoice header says `bill_no`/`bill_amount`, whose line
says `tax_percent`, whose batch says `stock`/`ptr`/`exp` and whose returns sit in `sales_returns` imports
at the right rate, quantity and valuation; `billing.tax_mode` + the store column + `StoreTaxPolicy` all
answer exclusive afterwards; an unnumbered bill, a quantity-less batch table and an unrateable taxed line
each block pre-check; a note listed under two tables imports once; a rounding difference passes while a
missing document does not. Backend 1279 tests, frontend 1237, admin panel 110, both `tsc` clean, and the
`ProductQueryScopeTest` constitution gate is satisfied by the new catalog lookup. Not covered: this was
built from the v1 column names, not from the store's own bundle — the 88 invoices already on
v2.lamstonehealthcare.com keep the tax figures the old importer wrote. **Roll that run back and re-run it
on this build** before filing anything from it. Not covered: a built installer, and a live pull from the
real legacy panel (the `SyncController::pull` lookup gap from v2.1.7 is unchanged, so bundle export is
still the way to bring brands, units and categories).

After pulling: no `migrate --force` and no artisan step — this release adds no schema; the fixes are all
in how the existing columns are filled. Then open the store's migration history, roll the completed run
back (this removes the products, batches, parties, invoices and purchase rows its id maps stamped, and
nothing else), and start it again from the same bundle. The till's Billing tab should then read **Prices
exclude tax**; if the legacy source never stated a mode the branch keeps the one it had, and the pre-check
says so. The new summary tiles need this build, so a till on an older version still reports the old six
counts — the server-side import is correct either way, and Migration Center in the panel shows it.

## 2.1.7 — 2026-11-25

Both sources of the Store Data Migration Wizard — exported bundle upload and Direct Laravel API —
walked six green steps, printed a reconciliation table, reported *Migration Completed* and left the
branch's database empty. Admin Panel → Migration Center showed nothing either, because there was
nothing to show.

The wizard never touched the server. `clientMigrationEngine.ts` read the source into browser memory,
wrote the rows into **that workstation's SQLite** with `sync_state: "synced"` stamped on them, and
reported on its own handiwork: `can_proceed` was hardcoded `true`, reconciliation compared the
payload to itself, the cutover step only changed button state, and `store_id` was a literal `1`.
"Synced" rows are the ones the sync queue never pushes, so the store's real database — the one the
admin panel reads — stayed empty while the till displayed the imported products. A run that moved
zero rows and a run that moved 40,000 looked identical, and there was no run record to compare.

1. **The wizard drives the server pipeline** — every step is now an HTTP call
   (`POST /api/till/migrations/bundle` → `precheck` → `start` → `cutover`) and the work happens in
   `MigrationPipelineRunner` inside one transaction against the branch's database. The screen shows
   the server's run UUID, the server's per-entity counts and the server's reconciliation verdict, so
   what a step claims and what it did are the same object. The client engine is deleted;
   `tillMigrationService.ts` is a thin caller with no write path of its own.
2. **A file cannot be named, only referenced** — the upload endpoint accepts a real multipart file,
   checks it is JSON carrying at least one entity the pipeline knows, stores it under a UUID and
   hands back a `bundle_ref`. The reader accepts that UUID and nothing else, so the
   `config.file_path` that used to be read straight off the request body is gone — that field was an
   arbitrary-file-read on the server, and a till could aim a migration at any path on disk.
3. **Silence became an error** — a source with no rows now fails pre-check with a blocking
   `source`-category issue instead of passing, a dry run writes nothing and its cutover is refused
   because there is nothing to cut over, and cutover demands `CUTOVER-{store code}` against a run
   whose reconciliation actually passed. `store_id` in the body is rejected as a tenant violation
   rather than trusted; the device token decides the branch, so a stale local registry key
   (`store_main`) migrates the counter's own store instead of nothing.
4. **Migration Center is a real client** — rewritten on the panel's own `api` service with an
   explicit branch picker, file upload, pre-check, dry run, live run, and a history table carrying
   each run's server counts, cutover phrase and rollback. It previously posted to endpoints it
   derived by string guesswork, so its own success panels could not be believed either.
5. **The branch's Data Migration switch** — `Menu & Feature Control` gains a
   **Branch Data Ownership → Legacy Data Migration** toggle backed by the store's
   `allow_data_migration` flag (default on, so a branch that never saved one keeps working). It is
   enforced server-side on upload, pre-check, start and cutover — not only by hiding the tab — while
   history, reconciliation detail and rollback stay reachable, because a switch that stops future
   imports must not strand what already landed. `/api/settings` now ships the store's flags, and the
   till hides the nav tab, the hub link and the wizard body when it is off.
   A flag rather than a menu row on purpose: the wizard shipped open on every till before this
   switch existed, and a `enabled_menu_items` list saved by an older build is indistinguishable from
   an owner having deliberately unchecked the row. An unset flag means "as it was".

Verified on a scratch store end to end, twice: through the API with the till's device token, and
through the browser as a store owner. Rows are proven in the database the panel reads — 1 product,
2 parties, 1 batch, 1 invoice, 1 invoice item, 3 `master_lookups` and 8 `migration_id_maps` for an
8-row bundle, with `migration_runs` completed and reconciliation passed — then rollback returns every
count to 0. Flipping the switch in the panel bumped `stores.version`, appeared in the till's
`/api/settings`, and turned the till's `start` into `403 data_migration_disabled` while its history
list stayed readable; flipping it back opened the pipeline again. `config.file_path` answers 422, a
wrong cutover phrase answers 422 and writes nothing. Backend 1245 tests, frontend 1236, admin panel
110, both `tsc` clean. Not covered: a built installer — the till half is source-only until this
build ships, and the previous release's host-default fix is in the same position. Not covered: a
live pull from the real legacy panel through the new wizard, which has one known gap carried over
from v1 — `SyncController::pull` omits the lookup rows this pipeline maps, so an API-only migration
drops brand, unit and category and needs a bundle export for those. Not covered: a till noticing a
flipped switch on its own — tills still do not poll `stores.version`, so the UI updates on the next
settings load while the server gate applies immediately.

After pulling: no `migrate --force` and no artisan step — this release adds no schema. The flag lives
in the `feature_flags` JSON the stores table already has. Tills pick this up through the updater;
`min_version` stays at 2.0.21, and a till on an older build still runs the old client engine, so
migrations should be run from the panel or from a till on v2.1.7.

## 2.1.6 — 2026-11-25

The Store Data Migration Wizard's "Direct Laravel API" source could not be made to work, from any
machine, with any token. It was aimed at the wrong host by default — and its error text sent
everyone checking the network.

The Legacy Server URL field opens with `ADMIN_PORTAL_URL`, which is `PANEL_PORTAL_URL`, which comes
from `VITE_ADMIN_PORTAL_URL` = `https://app.lamstonehealthcare.com`. That host is the v2 portal SPA.
It has no `/api/sync/pull`; nginx's SPA fallback answers the path with `index.html`, and it sends no
`Access-Control-Allow-Origin` doing so. So `fetch()` rejected inside the webview as `TypeError: Load
failed`, and the engine reported it as *"Could not connect to https://app.lamstonehealthcare.com:
Load failed. If the server is offline or CORS blocked…"*. A valid token could not change the outcome
because the token was never sent to a host that reads it. The legacy install lives on a third host,
`https://admin.lamstonehealthcare.com`, which serves `/api/sync/pull` and answers the preflight with
`Access-Control-Allow-Origin: *`.

1. **`LEGACY_API_URL` is its own setting** — resolved from `VITE_LEGACY_API_URL` (runtime `__ENV__`
   first, then build-time), defaulting to the v1 panel, and set in all three env files. It is
   deliberately *not* derived from `window.location.hostname` the way the portal URL is: the wizard
   runs on the panel's host and has to reach a different one.
2. **Each failure now names its own cause** — HTTP 401/403 report a rejected token and point at
   `/admin/migration-token`; 404 reports that the host is not the legacy panel; a body that is not
   JSON reports that the host is serving the portal. Only a request that never got a reply is
   described as unreachable, and that message says which host to expect.
3. **The token is no longer labelled optional** — `/api/sync/pull` answers `401 Unauthenticated`
   without it, and the hint under the field now says where the token is minted.

Verified against the live hosts: `admin.` returns `401` with a CORS header on an untokened pull,
`app.` returns `200` HTML for the same path. The token-and-endpoint half is covered by the legacy
panel's own `AdminMigrationTokenTest` ("issued token serves the wizard pull endpoint"). Not covered:
a click-through in a built installer — this fix is a compiled default, so it only reaches tills
through this build.

After pulling: no `migrate --force` and no artisan step. Tills pick this up through the updater;
`min_version` stays at 2.0.21. Until a till is on v2.1.6, the workaround is to retype the Legacy
Server URL as `https://admin.lamstonehealthcare.com` — the field's default is the bug.

## 2.1.5 — 2026-11-25

A till that could not reach its server threw the operator out of their own store, and the two
grids that still hand-rolled a free-quantity cell disagreed about what could be typed into it.
Nothing here changes what a bill contains, so there is no migration and no backfill.

`storeDeviceService.validateDeviceSession()` reports `locked` for three different things: a
credential the server actually revoked, an offline grace window that ran out, and an empty read
from the local vault. The boot path and the five-minute heartbeat treated all three as retirement
— they rebuilt the store list with `filter(s => s.is_active)` and cleared the active store. So a
network blip past the offline window, and a store the owner suspended while this machine still
held it, both landed the operator on Select Store mid-bill. Suspended stores were the worse half:
Layout has a dedicated "store disabled" screen for them, and clearing the selection was what
stepped over it.

1. **Retirement is the only exit** — `isRetiredFromThisTill()` keys on `sync_status: "revoked"`,
   the one state the registry writes when a counter is retired from this machine. A held store
   stays open, a suspended store stays selected so its disabled screen renders, and an
   unreachable server stops looking like a retirement.
2. **The rule is stated once** — `shellSelection()` is now called identically from boot, the
   heartbeat and `onRegistryChange`; the three places previously repeated the filter with three
   slightly different predicates. SYNC-02's original fix stands: a retired counter still leaves
   the list and deselects, which is what stopped a retired till drawing the POS under the
   fallback "C01" header. The reason `validateDeviceSession()` locked is logged either way.
3. **Free quantity uses the shared input in both grids** — `SmartQtyInput` already owned pack +
   loose entry for billed quantity in these same rows, with the product's own unit names and
   `allow_loose_sale`. The free-qty cell was the last hand-rolled pair of number inputs. The two
   copies had drifted: the POS row floored both fields, the purchase row accepted a fractional
   pack and an integer loose, and neither showed strip/tabl. Both now pass the same props their
   billed-qty cell passes; Enter still blurs out of the POS cell and still advances a purchase row
   to MRP.
4. **The return fixtures match the cast** — `taxable_amount`, `cgst_amount` and `sgst_amount` are
   `decimal:2`, so a hydrated line gives the pricing service `"80.36"`, not `80.36`. The fixtures
   asserted the arithmetic while leaving the decimal-string path untested.

After pulling: no `migrate --force`, no artisan commands. Desktop installs v2.1.5 through the
normal updater — `min_version` stays at 2.0.21, so nothing is forced and older tills keep working.

## 2.1.4 — 2026-11-23

A migration that v2.1.2 shipped — and that v2.1.3 depends on — could never finish on MySQL, and a
server that looked fully deployed was answering 500 on the Counters screen. This release exists to
make v2.1.3 deployable; it carries no other change.

`2026_11_21_100002_create_counter_profile_exceptions_table.php` builds two indexes, both unnamed.
Laravel compiles the table and each index as separate statements, and it generates an index name as
`table_columns_index`. The first came to 60 characters; the second,
`counter_profile_exceptions_counter_id_document_type_document_id_index`, came to 69 — past MySQL's
64-character limit. So the table and its first index were created, the second `alter table` died,
and the migration was never recorded. Every migration dated after it (`counter_presence_spans`,
`devices.revoked_at`) was therefore never reached, and each retry of `php artisan migrate --force`
failed earlier still, on a table that already existed. `GET /api/admin/counters` — which reads the
exception register and the presence spans — answered 500 on a server that looked deployed.

1. **The index is named** — `cpe_counter_document_index`, 26 characters.
2. **`up()` clears a leftover table before building it** — it only runs while the migration is
   unrecorded, so any `counter_profile_exceptions` it finds is exactly the half-built remnant of the
   run that died on that index. A host where the migration is already recorded is untouched by this
   change.
3. **No other migration carries the trap** — every unnamed `index` / `unique` across
   `backend/database/migrations` was measured against the 64-character limit and none exceeds it;
   the chain now runs from an empty database to the current head in one pass.

After pulling: `php artisan migrate --force`, then the three dry-run-by-default commands v2.1.3
adds (`payments:adopt-g10-defaults`, `devices:backfill-revoked-at`, `lamsuite:expiry-date-repair`).

## 2.1.3 — 2026-11-23

A till the owner retired while it was sitting offline kept the bills it had saved and then lost
them for good: its credential stopped opening anything, the queue rows said `sent`, and a fresh
claim started a different counter. The first half of this release is that door. The second half is
the drift QA found between what a bill says at the counter, what the panel reports and what the
GSTR-1 files — the MRP ceiling, the place of supply and the batch expiry date.

### Existing stores catch up with the 2.1.2 defaults (G10 follow-up)

v2.1.2 made UPI and Card references required by default and put Expenses on the till, but only
for stores set up after it. Every older store already had the till's previous payment rules saved
for it automatically ("optional" for UPI and Card). The server keeps a saved setting, so those stores
went on accepting UPI with no reference (PAY-04). Their menus and counter profiles had also been
written before Expenses existed, so the till refused the new route (EXP-01).

1. **`php artisan payments:adopt-g10-defaults`** (`AdoptG10DefaultsCommand`) — a dry run by
   default; it lists every change and writes only with `--apply`. Use `--store=<id>` for one
   store, and `--saved-before="<upgrade date-time>"` so a value saved after the upgrade, which
   could be a deliberate choice, is left alone. Each change writes a `g10_defaults_adopted` audit
   entry. A second run finds nothing.
   - **Payment rules:** only a store whose reference rules are still exactly the old shipped
     ones gets UPI and Card set to `required`. If any rule was changed by hand, the owner
     chose those rules and they are left alone. Everything else in the setting is kept, and the
     store's settings version is bumped so a till still holding the old copy is refused on its
     next save (SET-03) and re-reads instead of writing "optional" back.
   - **Expenses:** a store menu gains `expenses` after `purchases`. A counter profile gains it
     after `purchase_returns` only if it still has every pre-2.1.2 module (a trimmed profile was
     curated) and its cash drawer is on. Its profile version is bumped so the till picks it up.
   - **QA database copy:** 28 changes (2 stores' payment rules, 9 store menus, 17 counters).
     Afterwards UPI and Card without a reference returned 422, and counter C02 booked a cash
     expense that came off the drawer, with no manual edit.
   - Tests: `backend/tests/Feature/AdoptG10DefaultsCommandTest.php` (6).

### A till retired while it was offline no longer loses its bills (SYNC-01, SYNC-02)

2. **Every revocation records when it happened** — `devices.revoked_at`
   (`2026_11_23_090001_add_revoked_at_to_devices_table.php`) is stamped by `Device::saving`,
   whichever screen or command revoked the device, and cleared again when one is reinstated. The
   devices-console query update skips model hooks, so it stamps the moment itself and leaves a row
   already revoked at the time it was first retired.
   `php artisan devices:backfill-revoked-at` fills devices retired before the column existed from
   the row's last update — dry run by default, `--apply` to write (2 tests).
3. **One door, and only one** — the `retired.device` middleware (`AuthenticateRetiredDevice`)
   accepts a revoked device token for `POST /api/sync/push/stranded` alone, and only while the
   revocation is under 7 days old. An active, unknown or out-of-window token is turned away, and
   the request is pinned to the store the device belonged to, so a retired token cannot file into
   another tenant. Throttled to 30 a minute.
4. **What may still come through** — only new `invoice`, `purchase`, `payment` and `expense`
   documents saved before the revocation. Masters, settings and edits are refused, as is any
   document with no save time. Accepted rows go through the ordinary batch ingest, so numbering,
   stock, tax and idempotency are exactly what a live till gets, and each is filed as
   `filed_by_retired_device` in that counter's exception register for the owner to review.
   Tests: `SyncStrandedDocumentsTest` (9).
5. **The till keeps just enough to deliver them** — resetting a till with bills still queued sets
   the old credential aside instead of deleting it, and the store record stays `revoked`: the
   store's own licence answering "active" no longer reopens a counter this machine no longer holds
   — only a fresh claim does. A fresh claim drops the old credential and sends the ordinary way.
   Waiting bills go out in the order they were saved; one the server refuses stays on the till with
   the reason and is not resent; when the door has already closed the credential is dropped and
   every bill kept. The waiting-bills banner on the claim screen now says which of the two happens
   to a bill. Tests: `storeRevokedShell` (3), `syncStranded` (6).
6. **Bills an older build marked sent are found again (SYNC-01)** — a queue row stamped `synced`
   that the server never took used to hide its document forever. `requeueOrphanedDocuments()` now
   compares the local documents against the queue's own rows, reports the orphans on a dry run, and
   requeues them with the payload and save time they had. The till runs the report at boot, so an
   owner sees the count instead of discovering it months later (2 tests).

### The ceiling and the place of supply are one answer in three places (TAX-02, TAX-03)

7. **A till refuses above-MRP rates while it is offline** — the store's `enforce_mrp_capping` flag
   now travels in the settings document a till caches (a store flag, never a billing setting a
   device may write back), and `lib/billing/mrpCeiling.ts` mirrors `Services/Tax/MrpCeiling.php`:
   the batch's MRP, the product's when the batch carries none, and a loose rate capped at the pack
   MRP split over the pack. The counter now stops the bill at the first breach (a paisa of
   tolerance) instead of letting the server refuse it after the customer has left. Unset means on.
   Tests: `posCartService.mrp` (5), `G11TillMrpFlagTest` (2).
8. **Place of supply is derived in one function** — `documentPlaceOfSupply()`
   (`lib/gst/stateCodes.ts`) takes the place a document states, else the buyer's GSTIN state, else
   the store's own, and the GSTR-1 export, customer debit notes and the bill headers now all call
   it. The printed headers used to fall back to a hard-coded `32-Kerala`, so a Karnataka store's
   walk-in sale filed as inter-state. Tests: `gstExporter.pos` (3),
   `customerDebitNoteService.pos` (5).
9. **B2C (Summary) stops splitting one state in two** — tills store both `32` and `32-Kerala` in
   `place_of_supply`; the report now compares the first two digits, so a state makes one row and a
   home-state bill is not read as inter-state.

### Reports, the dashboard and the ledger agree (RPT-01…04, PAY-01, AUD-01, AUD-02)

10. **Only outward supplies count as outward sales** — `OutwardSalesService` drops quotations (and
    anything else sharing the `invoices` table) once, in its constructor, so no report has to
    remember to. The unpaid remainder of a bill now lands in the `credit` bucket, which makes the
    tender buckets sum to net sales to the paisa, and "Collected" on the daily summary means money
    received — cash, UPI, card, transfer, other — without it.
11. **Receivables count only what is still owed** — the dashboard's credit figure is
    `grand_total - paid_amount` on return documents, so a note settled in cash at the counter no
    longer shrinks what other customers owe. Top items rank sale and return modules only, and the
    store-comparison tile reads month sales, net of returns, through the same window as the tiles
    above it.
12. **A report day is the store's day** — `StoreClock` replaces `date('Y-m-d')` in the daily
    summary and daily-collection defaults (the server clock is UTC), one-day callers may send
    `date`, and the admin GSTR-1 honours `from`/`to` instead of silently answering month-to-date.
13. **A till's re-push no longer restates a supplier's balance (PAY-01)** — the server posts
    supplier balances from bills, returns and payments, but the running figure the till carries on
    its own party record won on every sync and reset the payable. A new supplier starts at its
    opening balance, an existing one keeps its balance, and only a changed `opening_balance` moves
    it — by the difference, through `SupplierBalanceService::shift()` (3 tests).
14. **`parties:rebuild-supplier-balances` will not erase an imported debt** — a supplier whose
    balance no bill or payment explains is reported and left alone; `--include-undocumented` resets
    it deliberately. Every applied write is audited as `supplier_balance_recomputed` (2 tests).
15. **A purchase posted by a counter names that counter (AUD-01)** — `POST /api/purchases` is
    opened by a claimed till, so the bill, the shelf movements it causes and its audit row now
    carry `counter_id` / `counter_code`, as a bill pushed through the sync queue already did.
16. **Negative stock alerts from every road (AUD-02)** — the stock-event stream of an offline till
    and a write-off posted through `StockAdjustmentService` both raise
    `OperationalAlertService::negativeStockFromLedger()`: one notification per product per day,
    naming the counter and the units left, so a run of sales off an empty shelf does not bury the
    inbox (2 tests). Tests: `LedgerGapsTest` (8), `ReportParityTest` (9).

### A batch expiry is a calendar day, not an instant (UI-03, G8)

17. **The `date` cast was moving expiries a day early on every round trip** — Laravel serialised
    31-03-2027 as `2027-03-30T18:30:00Z` (midnight IST in UTC); a return posted that string back
    and each trip dropped another day. `App\Casts\CalendarDate` stores and serialises `Y-m-d`,
    reads a timestamp in the store's timezone before taking its day, and still returns a Carbon, so
    every caller keeps `->toDateString()` and its comparisons. Applied to `invoice_items.expiry_date`
    and `purchase_items.mfg_date` / `expiry_date` (4 tests).
18. **`php artisan lamsuite:expiry-date-repair` fixes what already drifted** — a return line earlier
    than the line or batch it came from is set back to that source date, and any line still holding
    a time of day becomes the store's calendar day for it. Anything else that disagrees is reported
    and never rewritten. Dry run by default, `--apply` writes, every change is journalled to
    `storage/app/expiry-date-repair.json` and reversible with `--rollback` (4 tests).
19. **Return slips print the expiry the way the shelf shows it** — credit and debit notes on 80 mm
    and 58 mm, and the purchase-return grid, print `MM/YY` instead of a raw timestamp (5 tests).

### Till and panel

20. **The update prompt shows wherever the till is** — the setup/claim screen and the store gateway
    draw it as well as the signed-in shell, so a till sitting on the login screen still learns a
    release is out.
21. **The claim screen says less and shows its version** — "Enter your counter activation code", the
    build's version where the endpoint used to sit, and a quieter `Server settings` disclosure.
22. **Settlement keys keep the tender split as typed (KB-03)** — the listener re-reads the tender
    lines when the modal opens, so Option+2 after typing cash 50 adds a UPI line instead of topping
    the lone cash line to the bill total.
23. **The WhatsApp gateway field can be emptied** — neither the panel nor the till pre-fills
    `https://wa-api.alverstone.in` as a value any more, which made the field impossible to clear
    and the address impossible to remove; the till keeps it as a placeholder only (1 test).

### Tests

24. Backend 1,231 passing (44 of them new in this wave); till and panel 1,213 across 168 files
    (31 new). Every claim above is covered by the file named beside it.

## 2.1.2 — 2026-11-23

Store reset now really resets the till. QA'ing a reset of Test Store (store 4) showed the Masters
screen refilling to **Products 1514 / Batches 1525 / Parties 62** — none of them the store's own:
they were Store 1's rows, pulled by requests that carried no store context, plus 50 demo products
the catalogue bootstrap seeded over a deliberate reset.

### Server

1. **A delta pull without a store is refused, not guessed** — `GET /api/sync/pull/deltas` no longer
   falls back to the first store in the database; with no `X-Store-Id` / `Store-Id` header, no
   `store_id` and no authenticated user's store it answers an empty delta carrying
   `error: STORE_CONTEXT_REQUIRED`. Products, batches, parties and lookups delivered by the route
   are scoped to the resolved store, and the payload carries `last_reset_options` so a till can
   tell a deliberate reset from an empty catalogue.

### POS (till)

2. **One apply-once path for remote resets** — `storeRegistryService.applyRemoteResetOnce()` is now
   the only place a remote reset is applied: boot license check, device heartbeat, health check,
   delta pull and the SSE stream. It records both the reset timestamp and the sync-event id, so the
   server's replay of the last five events on reconnect cannot wipe the till a second time, and a
   marker written by one path is honoured by every other.
3. **Every master pull names its store** — the SSE stream, the delta pull, the catalogue bootstrap
   and the party bootstrap send the active store id (query parameter plus `X-Store-Id`/`Store-Id`),
   so a till can no longer load another branch's products, batches or parties into its local
   SQLite.
4. **No demo catalogue over a reset** — when the server reports `reset_products`, `ensureCatalogReady`
   marks the store `catalog_wiped_<id>` and returns `deliberately_empty` instead of seeding the 50
   test products and batches.
5. **Pulled masters are not re-pushed** — `partiesStore.upsertParty(party, enqueueSync)` skips the
   sync queue for server-pulled rows, which previously queued another branch's parties and pushed
   them back to the server.

### Tests

6. `Sync` and `AdminStoreReset` suites (28 tests) lock the store-context guard, the scoped delta
   payload and reset-option delivery; the POS `storeResetAndDisable`, `remoteCounterSync` and
   `onlineFirstArchitecture` suites (18 tests) cover apply-once semantics and the scoped pulls.

## 2.1.2 — G5-COUNTER (activation lockout, counter monitoring)

Round-3 defects `ACT-01` and `CNT-01` ([fix-list](test-reports/fix-list.md) §12).

1. **Wrong codes lock the till that typed them, not the shop (ACT-01)** — the activation lockout
   counts failures per workstation (`device_uuid`, 5 in 15 minutes) instead of per IP, so a valid
   code on another till behind the same router still claims. A network-wide lock remains only as a
   ceiling of 30 failures in 15 minutes from one address (a caller rotating device ids). The 429
   carries `scope: "device" | "network"` and says which; the owner gets one alert per locked
   workstation (or network) per window, naming it.
2. **The counter list says what each counter has been doing (CNT-01)** — `GET /api/admin/counters`
   adds `last_bill_at`, `last_bill_number`, `last_salesperson_*` (from the salesperson stamped on
   the counter's latest bill, GAP-01), `last_operator_*` (the signed-in user, reported apart),
   `last_activity_at`, `unsynced_items_count`, `offline_since` and `offline_periods` (last 24 h).
   Offline periods come from a new presence history written by the till heartbeat
   (`2026_11_22_130001_create_counter_presence_spans_table.php`); there is no history before this
   release, so older gaps are not shown. The admin Counters card shows the bill number, who is
   signed in and the day's offline periods.

## 2.1.2 — G7-ENV (updater feed, update manifest, error traces)

Round-3 defects `UPD-01`, `UPD-02` and `SEC-06` ([fix-list](test-reports/fix-list.md) §14).

1. **A till only talks to the server it is configured against (UPD-01)** — the update feed is
   `<configured server>/api/app/update/latest.json` (or `latest-legacy-win7.json`); the
   hard-coded production and GitHub feeds are gone, and `tauri.conf.json` ships with no updater
   endpoints. The desktop build checks and installs through new `updater_check` /
   `updater_install` commands that take the configured feed; packages are still verified against
   the bundled public key. Before a counter is claimed the health monitor probes `/up` instead of
   `license/check?store_id=1`, and the third-party IP echo (`api.ipify.org`) fallback is removed.
   A LAN or test-server till now updates from that server only.
2. **No update without a signed package that exists (UPD-02)** — the backend no longer
   synthesizes a manifest with a hard-coded signature (it belonged to the 2.0.23 package).
   Update endpoints return 204 unless a published `latest*.json` names a signed package present
   on the server; platforms missing either are dropped. The deploy health check accepts 200 or
   204 from the manifest. A till may still show a cached "update available" from before; the next
   check replaces it.
3. **API errors never carry traces (SEC-06)** — `api/*` JSON errors drop `exception`, `file`,
   `line` and `trace` even with debug on; staging compose and `backend/.env.example` default
   `APP_DEBUG=false`, and the API container refuses to start in production/staging with debug on.

## 2.1.2 — G15-GAPS (three features the QA round said were missing)

The round-3 defects said the same thing three times: a screen accepted the entry, the server
never checked it, and the document went through anyway — a 100% discount needed no one's
agreement, no bill recorded who sold it, and a Schedule H1 pack sold with nobody qualified in
the room. The defects are
[test-reports/fix-list.md](test-reports/fix-list.md) §15 (`GAP-03`, `GAP-01`, `GAP-02`),
planned as Waves C–E and delivered here as three slices, each with its failing test first.

1. **An approval is a credential, not a tick box (GAP-03)** — `ApprovalService::issue` mints a
   single-use opaque grant (5 minutes, `invoice_approvals` keeps only its hash) and
   `InvoiceApprovalService::settle` redeems it inside the transaction that writes the document,
   so a save that fails leaves the grant usable and a save that succeeds can never be replayed.
   `CounterProfilePolicy` is re-run on `POST /api/invoices`, the sync ingest and the document
   saves, so a client that skips the prompt is refused server-side rather than trusted. New
   counters get a 20% ceiling with a grant required above 10%; price changes above 10% need the
   same grant. The till asks the approver for their own PIN, then for the one-time PIN
   (`InvoiceApprovalDialog`).
2. **Who sold it, on the bill (GAP-01)** — a per-store `salespeople` master
   (`2026_11_22_160001_create_salespeople_table.php`), a `salesperson_on_bill` setting with
   `off` / `optional` / `required` modes (`SalespersonBillRule`), and
   `SalespersonAttribution::resolve`, which stamps the name the owner chose — not a name a client
   invented — on the invoice, return and cancellation. New stores start on `required`; an upgraded
   store stays on `optional` until it actually has staff, so no existing till stops mid-shift. The
   panel gets a Salespeople page and a salesperson panel in the sales report; the till has a
   keyboard shortcut for the field.
3. **A restricted drug needs a pharmacist (GAP-02)** — each pharmacy keeps its own drug-schedule
   list as `master_lookups` rows of type `drug_schedule` (`App\Support\DrugSchedule`,
   `restricted` and `prescription_required` as the only marks), and a product carries
   `drug_schedule_id` plus the `schedule_code` the server stamped from it
   (`2026_11_22_170001_add_drug_schedule_to_products_table.php`). Staff have a registration number
   and a validity window (`2026_11_22_180001_add_pharmacist_fields_to_salespeople_table.php`), and
   `PharmacistGate` refuses a bill, return or cancellation containing a restricted line unless a
   pharmacist whose registration is live confirms it with their own PIN —
   `pharmacist_confirmations` then names the pharmacist, the registration and each restricted line
   (`PharmacistRule`, `RestrictedDrugResolver`). The till prompts at the moment of the save
   (`PharmacistConfirmationDialog`), and the pharmacy report's H1 register is built from those
   rows instead of from a schedule code a product once had.
4. **A pharmacist's PIN is never kept anywhere** — it is judged against `salespeople.pin_hash`
   and then dropped: not in `pharmacist_confirmations`, not in `audit_logs` (which record the
   name and registration, not the number), not in the till's offline queue, and not in the till's
   own schema, where the v15 migration is asserted to add no `pin` column.
5. **The pharmacy-only screens are held by the server, not by the screen** — a store that sells no
   medicines gets no schedule list, no product field, no pharmacist fields and no register.
   Verification found this leaking: `/api/admin/me` left `store_type` out of the store rows it
   hands the panel, so every `isPharmacy` check —
   [MastersPage.tsx:64](admin-panel/src/pages/MastersPage.tsx#L64),
   [SalespeoplePage.tsx:108](admin-panel/src/pages/SalespeoplePage.tsx#L108),
   [TransactionsPage.tsx:153](admin-panel/src/pages/TransactionsPage.tsx#L153),
   [ReportsPage.tsx:211](admin-panel/src/pages/ReportsPage.tsx#L211) — read a kirana as a chemist
   and showed its owner the drug screens. `AdminAuthController::me` now returns the column, and
   `PharmacyOnlyLeakTest` asserts a `kirana_general` row arrives typed as one.
6. **What was already written** — nothing is marked automatically: which pack is Schedule H1 is the
   owner's decision, taken in the panel, and bills already sold keep what was on them.
   `php artisan counters:tighten-approval-defaults` reports first and writes only with `--apply`,
   and moves only the exact legacy signature (100% discount with no grant), so an owner who
   deliberately chose a ceiling is left alone.
7. **Deliberately not in this slice** — offline verification against a cached pharmacist hash,
   wrong-PIN lockout and its alert, and admin pages for pharmacist records and expiry warnings
   (E7, E8, E10); the `SPR-*` staff-journey items deferred from GAP-01.

## 2.1.2 — G10-PAYMENTS (the money a bill actually took)

Six defects around one idea: what a bill records as paid. A ₹500 note came off a ₹210 bill as
₹500 of takings, a walk-in bill could go out half paid, a receipt moved a balance without
touching the invoice it paid, shift close crashed and otherwise trusted the till's own figures,
the till had no expense screen at all, and UPI was accepted with nothing to trace it to. The
defects are [test-reports/fix-list.md](test-reports/fix-list.md) §3 (`PAY-02`, `PAY-03`,
`PAY-05`, `SHF-01`, `EXP-01`, `PAY-04`).

1. **A tender is settled, not stored (PAY-02)** — `backend/app/Services/Payments/TenderSettlementService.php`
   is now what a payment line *means*: a non-cash line applies in full, a cash line applies only
   what the bill still owes and the rest is recorded as change. `invoice_payments` carries
   `tendered_amount`, `change_amount` and `reference_no`
   (`2026_11_22_100001_add_tender_columns_to_invoice_payments_table.php`), and `invoices.paid_amount`
   is the sum of what was applied. Both ingest paths use it — `POST /api/invoices` and the till's
   `sync/push/invoices` — so an over-collection cannot arrive online or offline. The till has the
   same arithmetic as its own twin, `settleTenders()` in `frontend/src/lib/billing/billingTenderService.ts`,
   so the payload and the printed bill agree: ₹500 on a ₹210 bill is now row `amount 210,
   tendered 500, change 290` and `paid_amount 210`. Before this the cash book counted ₹290 of
   change as collected, on every bill that gave change.
2. **A walk-in bill has to settle (PAY-03)** — an unsettled balance for a walk-in customer is
   refused with `Walk-in bills must be settled in full. Add a payment line or select a registered
   customer for credit.` (HTTP 422) instead of writing a `partially_paid` bill whose ₹50 is owed by
   nobody. Credit is still refused on its own terms; this is the other half of the same rule.
3. **A receipt settles the bills it names (PAY-05)** — `PaymentAllocationService` +
   `payment_allocations` (`2026_11_22_100002_create_payment_allocations_table.php`). A customer
   receipt (`POST /api/admin/payments/customer`) and a supplier payment
   (`POST /api/admin/supplier-payments`) accept `allocations[]`; without them they clear the oldest
   open documents by FIFO. Either way the document's `paid_amount` and status move, and the party
   balance moves **once** for the receipt rather than once per allocation. The panel gets
   `admin-panel/src/components/transactions/AllocationPicker.tsx` inside the receipt modal and the
   supplier payout form: the open bills, their outstanding amounts, and a tick box per bill, with
   "Fill oldest first" and an explicit line that unchecked boxes mean the server decides.
   `GET /api/admin/outstanding-documents` feeds it.
4. **A digital tender carries its reference (PAY-04)** — `backend/app/Support/Payments/PaymentModePolicy.php`
   defaults UPI, Card, Cheque and Gift Voucher to `referenceRequirement: required`. A store that has
   already saved its own `payments` setting keeps its choice — the new default applies to stores
   that never picked one, and does not silently overwrite a configured counter. The till blocks the
   save before it posts and the server refuses the line if a client sends it anyway.
   - **A bill rung up offline is booked and flagged, not refused.** The walk-in, credit-limit and
     reference rules refuse a live `POST /api/invoices`. Through `sync/push` they no longer drop
     the bill: its goods and money already moved, and an owner who turns on "reference required"
     while a till is offline would otherwise leave that till's earlier UPI bills stuck in the
     queue forever. Such a bill is stored as it happened, and the owner gets an
     `offline_payment_policy` notification plus an `offline_bill_policy_exception` audit entry
     (`OperationalAlertService::offlinePaymentPolicyException`). Arithmetic that cannot be true
     (change on a non-cash tender, non-cash above the bill, credit to a walk-in) is still refused
     on both paths.
5. **Shifts open, close and count on the server's numbers (SHF-01)** — `CounterShiftService::openShift()`
   and `closeShift()` no longer read an `opened_at` key nobody passed (the 500 `Undefined array key
   opened_at`), and stamp the timestamps themselves. Close now derives cash from the counter's own
   documents through `serverTally()`, windowed by that shift's `opened_at → closing instant` instead
   of a fixed number of days, and stores both sides in `reconciliation_json`
   (`authority: server`, `drawer`, `server`, `ignored_client_totals`, `matches_server`). The till's
   `cash_sales` / `digital_sales` / `cash_expenses` are recorded but never decide the expected cash:
   a close that sent zeros still reports the ₹200 of cash sales, ₹300 of UPI and ₹90 of expenses the
   counter actually did.
6. **Expenses at the counter (EXP-01)** — `POST /api/expenses` (`TillExpenseController`) books an
   expense against the counter that sent it, numbered `EXP-00001` per store
   (`2026_11_22_100003_add_counter_id_to_expenses_table.php`), idempotent on a replayed offline
   queue entry, and held to the same reference policy as a tender. The till screen is
   `frontend/src/pages/ExpensesPage.tsx` on `/expenses`, gated behind the `expenses` counter-profile
   module, and its cash expenses are the figure the shift reconciliation deducts from the drawer.
   - **A reused till number no longer overwrites another expense.** A till numbers its
     expenses from its own local row count, so a second till, or one whose local book was reset,
     sends an `EXP-0000N` the server already holds for a *different* expense. The replay key is now
     the till's own document id (`expenses.external_id`,
     `2026_11_22_200001_add_external_id_to_expenses_table.php`). The printed number is kept when it
     is free and re-minted when it is taken. `App\Services\Expenses\ExpenseIngest` is the one path
     for `POST /api/expenses` and the sync queue. A till too old to send its id is still replay-safe:
     the same number with the same head, amount and date is one expense, and anything else is a new row.
7. **A cancelled bill frees the receipt that paid it (PAY-05)**: both cancel paths (the shared
   `InvoiceCancellationService` and the panel's `cancelInvoice`) call
   `PaymentAllocationService::releaseForDocument()`. The allocation rows go, a
   `payment_allocation_released` audit entry records what was freed, and
   `payments:allocate-outstanding` can apply the money to the party's next open bill.
8. **Existing damage, repaired by hand** — `php artisan invoices:reconcile-tenders` and
   `php artisan payments:allocate-outstanding` report first and write only with `--apply`; both are
   safe to re-run. On the QA database the dry run found ₹335.00 of change booked as cash collected
   on 31 bills, and ₹5,090 of receipts and payouts that had been taken but never tied to a bill
   (₹90 customer receipt, ₹5,000 supplier payment). Already-closed shifts keep the totals they were
   signed off with; the corrected tenders are what the next close and the server tally read.

## 2.1.2 — G4-NUMBERING (document number series)

A brand-new counter showed `C01-INV-1351`, and consecutive bills came out as 8301, 8651, 8751…
The till was leasing a fresh block of 50 numbers every few seconds and the online bill route filed
whatever number the till sent. The defects are [test-reports/fix-list.md](test-reports/fix-list.md)
§9 (`NUM-01`, `NUM-02`).

1. **The till finds its own block (NUM-01)** — `onlineTransactionService` looked the lease up under
   `Number("cntr_2")`, i.e. `NaN`, so it never found one and asked for another on every health tick.
   It now uses the server counter id (`counterSequenceKey`), asks only when the block is spent, and
   allows one lease request at a time. The offline path uses the same id, so an offline bill takes a
   leased number instead of a `TEMP-` one.
2. **A lease is repeatable (NUM-01)** — `CounterSequenceService::lease` returns the block the counter
   still holds instead of opening the next one. The till reports how far it got (`used_through`), and
   a report past the block it was given cannot push the series forward. Both lease routes
   (`/counter/sequences/lease`, `/counters/{id}/lease-sequence`) share this.
3. **The counter, not the request, decides the number (NUM-02)** — `POST /api/invoices` files a
   number through `numberLiveDocument`: a number from this counter's series that has not been used yet
   is kept, and anything else is replaced with the counter's next number. That covers a stale number,
   one already filed, or another counter's number. The till prints, notifies and steps its series from
   the number the server returned. If that differs from the preview, the cashier is told
   (`DocumentNumberBadge`).
4. **What was already written** — printed bills keep their numbers; nothing is renumbered or rewound.
   `php artisan billing:audit-g4-numbering [--store=] [--out=file.csv]` is a read-only survey of the
   gaps, duplicate numbers and run-ahead each series was left with.

## 2.1.2 — G3-PURCHASE-SYNC (purchase posting on the server)

Four Critical defects with one shared root: a purchase could be **saved and still not be real**.
The server had two write paths that did different things, nothing refused a supplier bill filed
twice, and a return pushed by a till was kept as a header and answered `processed`. The defects
are [test-reports/fix-list.md](test-reports/fix-list.md) §4 (`PUR-01`, `PUR-05`, `PUR-06`, `PUR-07`).

1. **One posting path for every purchase (PUR-05)** — `backend/app/Services/Purchase/PurchasePostingService.php`
   is now what a purchase document *becomes*: `postInward`, `postReturn` and `reverse` create or
   top up the batch, write the `stock_ledger_entries` row, keep `products.current_stock` equal to
   the sum of its batches, and move the supplier's `current_balance` through
   `SupplierBalanceService` — all inside the bill's own transaction. The till's sync push,
   `POST /api/purchases` and a goods receipt against a purchase order all end there, so a bill
   keyed on the server and a bill pushed from a till put the same tablets on the same shelf. The
   service also owns the one quantity definition everything else in the group depended on:
   `purchase_items.qty` is billed **packs**, base units are `(packs + free) × units_per_pack +
   loose + free loose`, and a return line is unit-denominated (`units_per_pack` 1). Before this,
   `POST /api/purchases` answered `201` for a ₹11,554 bill that created no batch, no ledger row
   and left the supplier at ₹0.
2. **A charge is judged against its own bill's place of supply (PUR-01)** —
   `PurchaseChargeService::resolveForStore()` normalises the document's place of supply with the
   same `cleanPos()` it already applied to each charge row, and both callers
   (`SyncController::upsertSinglePurchase()`, `PurchaseController::store()`) hand it the header
   value. A till that writes `32-Kerala` on the bill and `32` on the freight used to be refused
   on every push with "A charge is taxed by the place of supply of its supplier bill, not its
   own" — the comparison was a printed label against a state code, so it could never match.
3. **The till reports what the server answered (PUR-01, second half)** —
   `purchaseService.recordInwardPurchaseBill()` and `updatePurchaseBill()` now return `syncState`
   (`synced` / `pending`) and, when the server has refused, `syncMessage`; the entry screen says
   *"Purchase bill PB-9 posted to the server"*, *"Saved on this till, but the server has not
   accepted it yet: …"* or *"Saved on this till — it will be posted when the server is reachable"*
   instead of claiming a posting nobody accepted. The bill is still saved locally, so the
   post-summary modal, the voucher and the hotkeys are unchanged — what changed is that an
   unaccepted bill is no longer announced as posted. `syncQueueService.processQueue()` settles a
   batch push **item by item** from `results.processed_ids` and `results.errors[].id` rather than
   marking the whole queue synced because HTTP 200 came back, so a refused document stays
   `failed` with the server's own error and a backoff retry, and only the documents the server
   actually took are stamped as synced.
4. **One supplier bill, once (PUR-06)** — `assertUniqueBill()` refuses a second non-cancelled
   document carrying the same (store, module, supplier, bill number) on both write paths, naming
   the bill it collides with (`"Supplier bill QA-PB-003 from … is already recorded as …"`), and
   the refusal lands before anything is written — no batch, no ledger row, no payable.
   `purchases.bill_key` holds that identity under a unique index
   (`2026_11_22_120001_add_purchase_identity_and_unique_bill`) and `purchases.external_id` holds
   the till's own document id, so a replay of the same id is idempotent while a retry that picks
   a new id but the same supplier number is **failed**, not filed twice. An inward bill is
   identified by the supplier's number; a debit note is identified by its **own** note number, so
   several partial returns against one bill are not mistaken for a duplicate of each other.
5. **A return moves stock, money and ITC (PUR-07)** — a return or debit note pushed by a till
   posts through the same service *with its lines*: the goods go back to the batch they came
   from, the supplier's payable drops by the returned money, and
   `GstWorkingPaperService::gstr9()` now nets a return's tax **out** of the ITC block instead of
   treating it as more money claimed. Returning more than the batch holds is refused with the
   on-hand figure in the message ("Only 20 units of … are on hand; 40 cannot go back to the
   supplier") and leaves the store exactly as it was; a second return past what the first left is
   refused the same way. The header-only `PR-4-<timestamp>` rows that overwrote each other on a
   replay are gone.
6. **What the existing bad data says, and how it is put right** — the QA database still holds the
   damage: two bills filed under one supplier number, and purchases saved with no stock movement
   at all. `php artisan purchases:dedupe-bills` (dry run unless `--apply`) lists each duplicate
   group, keeps the earliest row, cancels the rest and takes back only the stock a cancelled row
   can *prove* it moved; `php artisan purchases:repair-postings` posts exactly the documents that
   have no stock-ledger evidence and then rebuilds every supplier balance from the documents
   themselves. Both are safe to re-run, and the migration refuses to install the unique index
   while duplicates exist, telling the operator to run the dedupe first instead of failing on an
   index with a MySQL error code. Run against the QA data: `dedupe-bills` finds nothing left to
   merge (the two offenders were already cancelled), and `repair-postings` reports purchases #3
   (₹11,554.00 over 3 lines) and #6 (₹11.00 over 1 line) as having no stock movement. Applied to
   a **copy** of that database it wrote the missing `PURCHASE_RECEIPT` rows, made
   `products.current_stock` equal the sum of the batches again (35,268 = 35,268 and 58 = 58), and
   settled supplier #4 from ₹74,500.00 to the ₹27,440.00 its documents and payments add up to.
7. **Tests** — `backend/tests/Feature/PurchasePostingGuardsTest.php` (8 tests, 55 assertions)
   drives the real surfaces: a charged push whose header says `32-Kerala` and whose freight says
   `32`; a server-entered bill whose batch, ledger row and payable are read back; a second
   identical `POST /api/purchases` refused with the row count staying at 1 and stock unchanged; a
   replayed push failed by queue id rather than duplicated; an over-return refused with nothing
   moved; a valid return taking stock back and crediting the supplier; a second return past what
   was left refused; and the debit note's −₹24.00 effect on the working paper's ITC.
   `PurchaseChargeReversalTest` had pinned the old over-return behaviour and now proves the new
   one (80 units accepted, a further 40 refused, 20 left to claim). The purchase, supplier-ledger
   and GST suites together are `OK (207 tests, 3300 assertions)`. Frontend:
   `syncQueueService.test.ts` (12 tests) covers the item-by-item settlement and `tsc --noEmit` is
   clean.
8. **Not driven live:** the Tauri till was not operated for this group. The three post-result
   toasts, the offline queue retry and the keyboard path from `F12` to a server-accepted bill are
   covered by the unit/DOM suites and by the backend feature tests over real HTTP, not by a
   cashier at a counter, and the admin panel's purchase screens were not re-walked. The shared QA
   database was left exactly as found — the repair was applied only to a copy — so the two
   stock-less purchases are still there for the next QA run, and `--apply` against production
   stays the owner's decision.

## 2.1.2 — Counter-only POS (CR 2026-11-19, B8 + A16)

The till no longer signs anybody in. A claimed counter is the account that works at the
counter: it authorises the till's own calls, it is what the idle lock locks and the PIN opens,
and no credential of any person is kept on the machine. Verification for every item below is
recorded in [specs/traceability.md](specs/traceability.md) §"Counter-only POS (Part 2)", and the
decisions behind it in [specs/cr/2026-11-19-counter-only-pos/](specs/cr/2026-11-19-counter-only-pos/).

1. **The counter authorises the till's routes (A16a)** — `/store`, `/customers`, `/products`,
   `/purchases`, `/sales-orders`, `/loyalty/*`, `/coupons/*`, `/stock/*`, `/reports/*` and
   `/data-exchange/*` now open for the workstation's device token through
   `AuthenticateCounterOrUser`, always scoped to the store that token was issued for. A header
   or body field naming another store is refused rather than followed, an old local registry key
   (`store_main`) never moves the tenant, a locked counter loses the routes with it, and a
   Super Admin who names no store is refused instead of being pointed at whichever store sorts
   first. A person's preferences and password stay person-only.
   `backend/tests/Feature/CounterAuthorisesPosRoutesTest.php` (11 tests).
2. **Staff management is counter-authorised too (A16b)** — the till's Staff panel called
   `/api/admin/users*`, which answers only for a person, so with no sign-in it was a dead
   screen. Six counter-authorised twins now sit under `device.auth`
   (`GET/POST /api/till/staff`, `PUT/DELETE /api/till/staff/{id}`,
   `…/unlock`, `…/reset-pin`) on the same `AdminUserController`, which has been made safe with
   nobody authenticated: the branch comes from the device token, a counter cannot create or
   promote a Super Admin or grant multi-branch access, another branch's accounts are unreachable
   for every verb, and the audit records `counter:C01 (Front Counter)` instead of an email with
   no person id on the row. The admin panel's own routes are unchanged, and a bearer token with
   no device token is refused at the till URIs.
   `backend/tests/Feature/TillStaffManagementTest.php` (10 tests).
3. **No sign-in screen at the POS (B8b, `SEC-001` retired)** — `StaffLoginPage`,
   `AccountSwitcherModal` and the switch-account keyboard chord are gone; the nav, reports,
   command palette, access gates, staff panel, product delete, stock adjustment, invoices,
   shifts and the presence heartbeat all key off the counter's own document. Presence belongs
   to the claimed counter, and a 409 from the heartbeat locks the counter rather than ending a
   person's session. `frontend/src/signinRetired.test.ts` (9 tests) is the guard that keeps them
   retired.
4. **No credential in browser storage (B8b)** — the staff bearer token and the cached-credentials
   record (which held PIN and password hashes) are written by nothing and read by nothing, and
   whatever an older build left behind is erased on boot and at logout. The six services that
   used to attach that token now attach the counter's device token; the till's own preferences
   stay on the till, keyed to the counter, because the server keeps that route person-only. The
   constitution scan that used to pin one tolerated token writer now pins the list as **empty**,
   so a new one fails the build. `PinSecrecyScanTest` (9 tests, 71 assertions),
   `userPreferencesService.dom.test.ts` (5 tests, deliberately rewritten as local-only),
   `deviceSessionService.test.ts` (17 tests).
5. **Still open:** the dead sign-in machinery inside `staffAuthService` has no production caller
   and is booked for deletion with its four suites rewritten, not dropped; and
   `/api/till/staff` does not yet consult the counter's permission document — narrowing the
   profile hides the tab but does not refuse the call, which is B2/B3's fail-closed
   `counter.profile` middleware.

## 2.1.2 — CR-C "Supplier bill charges" (CR-C-11 included)

Supplier bill charges: freight, loading, insurance, turnover and similar money on a purchase bill
is now a set of first-class charge lines instead of one freight number on the header. Requirements
are in [specs/modules/purchase-management.md](specs/modules/purchase-management.md) §2A
(`PUR-007`…`PUR-017`); CR-C-11 extends the payable policy to separately-paid charges.

**Delivered:** the whole change request — server, tax engines, sync ingest, reports/exports,
settings, the till's charges library, modal, purchase-screen mount and printing, the admin panel
screens, and the four-way paisa reconciliation gate. Live verification is recorded in item 12; the
till's own screens have not been driven in a browser in this round (see what it says was not
covered).

### Server

1. **Charge rows with their own heads** — `purchase_charges` and `purchase_charge_allocations` hold
   each line's taxable amount, GST rate, treatment (add to item cost / book as expense), spread
   method (value / quantity / weight), ITC eligibility, RCM flag and paid-separately flag. Heads are
   a store-scoped `charge_head` master (Freight, Packing, Loading/Unloading, Insurance, Other —
   seeded at store creation or on first read, resettable through
   `POST /api/admin/lookups/reset-charge-heads`), each carrying its SAC code plus default rate
   treatment, spread, ITC eligibility and allowed sign, and a head referenced by posted charges
   cannot be deleted until those charges are reassigned. Constitution rule **R12** makes a charge
   reference a cross-store insert, not a controller check.
2. **Charge stage in the tax engine** — `backend/app/Services/Tax/TaxEngine.php` totals charges,
   splits each into taxable / CGST / SGST / IGST / cess and spreads an add-to-cost charge (its
   taxable amount plus any tax that can never be claimed back) over the bill lines by value,
   quantity (free units included) or weight, falling back to value with a surfaced notice when any
   line lacks a weight — a mixed basis is forbidden. Largest-remainder keeps every share in whole
   paise and leftover paisa go to the largest fractions, ties broken by grid order; negative
   charges spread as signed reductions.
3. **Landed cost, expense register and payable from one bill** — postings write
   `product_batches.landed_cost_rate` while keeping `purchase_rate` intact, book the expense-side
   charges (ex-tax, non-creditable tax added) linked to the bill, and put supplier-borne charges —
   both treatments — inside what the supplier is owed. `specs/gst_tax_test_vectors.json` case `TC11`
   pins the ₹11,554 worked example.
4. **Returns, edits and cancellations reverse charges** — `PurchaseChargeReversalService` reverses
   spread, stock cost, expense postings, payable and tax in one transaction, per line and
   proportionally (or fully sunk, whichever way the store's `reverse_on_return` policy points), and
   re-posts on edit. A debit note inherits the charge rows it returns, so a retry cannot
   double-reverse.
5. **Old bills still read as charges** — a bill keyed before CR-C carries one freight scalar, so
   `PurchaseChargeService::legacyFreight()` presents it as a single Freight charge row through the
   same head master (`source: legacy_freight`, 0% GST so a legacy amount is never re-taxed or
   restated). Registers, exports and the payable take the charges path for old and new bills alike
   (`PUR-017`).
6. **Payable membership policy (CR-C-11)** — `billing.purchase_charges.separately_paid_in_payable`
   (default off) decides whether money paid to a courier or insurer also counts as money owed to the
   supplier. The answer is **stored per charge row** (`purchase_charges.in_payable`) and backfilled
   on migration, so flipping the policy later cannot restate a bill that has already printed. A
   reversal line carries the original row's stored value, and a client-pushed `in_payable` is never
   trusted — the server derives it from its own settings read. `paid_separately` still decides the
   payment column, expense attribution and GSTR-2B side; registers, Tally/Busy payment vouchers and
   the `In Payable` export column all read membership from the row. Vector `TC21`/`TC22` pin both
   policies on the same bill: payable ₹1,120.00 off vs ₹1,396.50 on, with landed cost, expense
   postings and creditable ITC identical.

### Reports, exports and the till

7. **Charge-aware statutory output** — the purchase register splits items vs charges, the new
   expense-register report (`GET /api/admin/reports/expense-register` for the console,
   `GET /api/reports/expense-register` for a till) lists every posted charge with its head, ITC
   eligibility and payment side, margin is computed on landed cost, ITC summaries split creditable
   by charge eligibility, RCM charges are flagged for review, and Tally/Busy/CSV/gst-export columns
   carry the charge fields. The till's own report modules mirror the same splits offline.
8. **Till charges library and modal** — `frontend/src/lib/purchases/chargesGrid.ts` (row state,
   spread basis, the legacy-freight ghost row), `chargePosting.ts` and `chargeReversal.ts` form a
   pure keyboard engine in the pattern of the stock-adjustment grid, and
   `frontend/src/components/purchases/PurchaseChargesModal.tsx` renders it: type-to-filter head
   picker, cycling selects for treatment / spread / ITC, per-line weight column, signed
   adjustments, inline totals bar and post-summary checks — the tests walk it with no pointer
   event. `Alt+F` is rebound from "focus the Freight field" to `toggleCharges` in the central key
   map, and `specs/keyboard-shortcuts.json` + `docs/KEYBOARD_SHORTCUTS.md` publish it; the grid's
   plain keys are routed only while the grid is open, and `PurchaseEntryForm.tsx` mounts it under
   `Alt+F` so a bill can be keyed end to end without a pointer. Purchase documents print the charge
   block (`PRN-007`): each head with taxable, GST and total, in-payable rows inside the footings and
   separately-paid rows as a marked memo below the grand total, on A4 and both dot-matrix widths.
   The mirror engine in `frontend/src/lib/tax-engine/taxEngine.ts` stays in
   agreement with PHP on all 22 vectors, and the footer names the two facts apart when a charge is
   both paid separately and billed into the payable.

### Tests

9. Engine parity across both harnesses — `backend/tests/Unit/TaxEngineTest.php` and
   `frontend/src/lib/tax-engine/taxEngine.test.ts` over vectors `TC11`–`TC22`. Backend features:
   `PurchaseChargeSchemaTest`, `PurchaseChargePostingTest`, `PurchaseChargePayablePolicyTest`,
   `PurchaseChargeReversalTest`, `PurchaseChargeSeparatePaymentTest`, `PurchaseChargeReportsTest`,
   `SyncPurchaseChargesIngestTest`, `AccountingExportChargesTest`, `PurchaseEntryParityTest` and
   the `Constitution/ChargeHeadStoreScopeTest` rule. Till: `chargesGrid`, `chargePosting`,
   `chargeReversal`, `payablePolicy`, `purchaseChargeRegister`, `expenseRegister`, `chargeItc`,
   `companySettingsService`, `sqliteStorage` and `PurchaseChargesModal` tests, plus the release gate
   `PurchaseChargeReconciliationTest`.

### The owner's screens and the release gate

10. **Charge heads, policies and the charges register in the panel** — Masters has a **Charge Heads**
    tab listing each head's treatment / spread / ITC / allowed-sign defaults with create, edit,
    **Reset to Defaults** and a delete that refuses while posted charges reference the head (it names
    the bills and amounts, offers the store's own heads as the replacement and moves the references in
    one audited step). Settings has the **Supplier bill charges** block: reversal treatment, the cap
    as a percent of goods value, `separately_paid_in_payable` and `allow_negative_charges`. A new
    **Bill Charges** tab in Transactions reads `GET /api/admin/purchase-charges` — every charge line
    in a filtered date range, head, bill, supplier, treatment, amount / GST / total and the
    **Payable** side taken from the stored row, with a footing and a CSV export.
11. **Two policy keys the engine now enforces** — `allow_negative_charges` and
    `max_percent_of_goods` are checked at posting inside the bill's own transaction, before any
    charge row is written, on both write paths. A refusal names the money: `charges.<n>.amount` for a
    sign the store disallows, `charges` for a bill whose charges exceed the cap, quoting the
    allowance it broke. A blank cap saves as `null`, and `null` or `0` both mean no cap. An offline
    till commits locally and the bill is refused when the link returns — never half-written.
12. **Four-way paisa reconciliation gate** — `PurchaseChargeReconciliationTest` proves stock cost,
    the supplier ledger, the expense register and tax close to the paisa for posted, edited,
    returned and cancelled bills, in both charge treatments, including the ₹11,554 worked example.
    It reads four independently written artefacts rather than repeating the engine's arithmetic, and
    one control removes a single paisa from a spread row to prove the gate fails when it should. The
    gate found and fixed one defect: an expense-treated charge's notional per-line shares were
    reaching the landed-cost reducer, so returning a line could drop a batch ₹157.33 below the
    supplier's own rate (`PUR-012`, `PUR-015`) — reversal maps now keep charge totals apart from the
    money that actually landed on a goods line, in PHP and in the till's mirror.

### Live verification on the dev stack (2026-11-20)

13. Driven through the real admin panel against the local server, with the database read back after
    each step: a charge head created with all four defaults, `Reset to Defaults` removing an
    unreferenced head, the `409` delete guard opening "Reassign bills before deleting" over three
    posted bills at ₹278.48 each and moving them to Insurance with the money untouched; the Settings
    block saving a 5% cap, a cleared cap as `null` and both payable switches; `POST /api/purchases`
    then refusing an over-cap bill at `charges` ("…allows ₹400.00") and a negative line at
    `charges.0.amount`; two identical bills posted either side of the payable switch keeping their
    own stored answer (₹15,283.00 with the courier ₹590.00 outside, ₹15,873.00 with it inside);
    freight landing a batch at ₹90.00 while the supplier's ₹80.00 rate stayed visible; the Bill
    Charges tab filtering on the stored payable side and footing ₹0.00 in-payable against ₹590.00;
    and the expense register, GSTR-3B charge block (`reconciles: true`, ₹590.00 creditable against
    ₹127.44 blocked) and Tally vouchers splitting the separately-paid courier into its own payment.
    **Not driven live:** the till's own screens — the `Alt+F` charges grid, offline posting, sync
    ingest of a pushed bill and purchase printing. They are covered by their dom/unit suites
    (`PurchaseEntryCharges.dom.test.tsx`, `PurchaseChargesModal.test.tsx`,
    `SyncPurchaseChargesIngestTest`, `purchaseChargesPrint.test.ts`), and the current entry screen
    now opens behind a counter activation code, which belongs to a different change request.

## 2.1.1 — 2026-11-19

Units join store scope (R11): **the shared-units carve-out is reversed — every store owns its
own units of measure**, seeded with defaults at start, resettable, and protected from deletes
that would orphan products.

### Server

1. **Units are store-scoped everywhere** — `master_lookups` of type `unit` are always
   store-owned; the sync delta pull delivers only the active store's units (other shared
   lookups keep the legacy rule), and the catalog copy tool copies units as per-store rows.
2. **Defaults seed themselves** — creating a store through the admin API, first listing units
   for a store that has none, or running `php artisan units:seed-store-defaults`
   (`--store=`, `--dry-run`) seeds the 17 default units (Strip, Tablet, Capsule, Bottle, Box,
   Kilogram/Gram at 3-decimal precision, Litre/Millilitre at 2, …); the same command purges
   legacy shared unit rows.
3. **Delete guard with reassignment** — deleting a unit that products reference answers
   `409 reassignment_required` with the referencing products and candidate replacements;
   `?reassign_to=<unit>` repoints those products (version bumped) and deletes the unit in one
   audited step. A store cannot update or delete another store's unit.
4. **Reset to defaults** — `POST /api/admin/lookups/reset-units` restores missing defaults and
   removes only unused custom units; units assigned to products are kept, matching the delete
   rule.

### POS (till)

5. **Local units follow the store** — units seed locally at app start and on store switch, are
   tagged with the store id, and listings show only the active store's set; reset, add and
   remove run locally with the same delete guard (an assigned unit asks for a replacement and
   moves the products before deletion).

### Admin panel

6. **Units tab is per-store** — the Units of Measure tab lists the active store's units with a
   Reset to Defaults action; deleting an assigned unit opens a "Reassign products before
   deleting" dialog that names the referencing products and moves them to the chosen
   replacement.

### Tests

7. `UnitStoreScopeTest` (constitution suite) locks seeding, scoping, cross-store 404s, the 409
   guard, reassign-then-delete, reset semantics and delta isolation; the POS local store's
   units are covered by 8 dom tests.

## 2.1.0 — 2026-11-19

Store-scope constitution (P-STORE-SCOPE): **products belong to one store only; stores do not
share products.** The change request reversed the centralized-catalogue design after a till
showed products with stock that did not belong to its store. Rules live in
`specs/constitution.md` and are enforced by CI (`backend/tests/Feature/Constitution/`, 10 suites).

### Data layer

1. **Per-store identity at the schema level** — `products.store_id` is NOT NULL with a unique
   index on `(store_id, barcode)` and composite foreign keys so a batch, ledger entry or
   price-list row cannot point across stores. Cross-store inserts are impossible, not merely
   blocked by controllers.
2. **One-time scope migration with reconciliation** — `php artisan stores:scope-catalog`
   adopts legacy NULL-store rows (POS-created products), supports `--dry-run` and rollback, and
   prints a before/after reconciliation.

### Server

3. **Per-store scoping everywhere products flow** — POS/staff product endpoints 404 across
   stores; admin masters endpoints scope by the active store; duplicate barcodes on
   create/import/sync answer `422` naming the existing product in that store.
4. **Sync can never hijack another store's product** — push upserts are keyed
   `(store_id, external_id)`; conflicts route to the sync centre.
5. **The publish-to-stores flow is gone** — `CatalogPublishService` and catalog publications
   were removed with the centralized catalogue they served.
6. **Copy products to another store** replaces publishing: a one-time, audited, reversible
   admin tool (`/admin/catalog/copy*`) that carries masters and rates — never stock, batches or
   history — and leaves the copies fully independent.
7. **Data exchange honours store scope** — imports target exactly one store and commit/export
   without a specific store context answer `422`; exports are store-filtered; the local-first
   import engine tags and filters rows per store (units stay shared, per the carve-out).
8. **Inter-store transfers** — the receiver matches lines by barcode then item code, offers
   create-in-my-store or map-to-existing (mapping remembered per store pair), and writes ledger
   entries in both stores.
9. **Consolidated reports** — a new admin report groups lines by an admin-chosen matching key
   per run (barcode → item code → name+unit), lists unmatched lines separately, and stores no
   merges.

### Admin panel

10. **Store scope lives in the URL** — `?store=<id|all>`; the URL wins over the saved scope so
    a shared or bookmarked link opens exactly the store it names, invalid params fall back
    safely, and switching stores keeps the URL in step.
11. **Cross-store views show a store column** — Masters products, inventory batches and the six
    transaction tables (invoices, returns, quotations, purchases, debit notes, purchase orders)
    display store identity under All Stores scope, matching read-only aggregation.
12. **No fabricated demo catalog** — a fresh store with no products and no backend catalog
    simply has no products until the owner imports or copies them; the 50-product seed remains
    available to unit tests only.

## 2.0.42 — 2026-11-19

Follow-up to the server-side GST parity release. The whole GST and stock QA pass was re-run
against the live POS web build and came back clean, and it turned up one keyboard defect that
could silently strip the supplier from a purchase bill mid-entry.

### Purchase entry keyboard

1. **Escape no longer wipes the inward supplier** — a `useModalEscape` registration now lives
   with its component instead of being consumed by the first Escape press. The inward form holds
   the Escape key for as long as it is open, so its handler was popped on press one and press two
   fell through to `ModalEscapeManager`'s DOM fallback, which clicks the first
   "X/Cancel/Close" button it finds in the overlay — the supplier combobox's clear button. The
   selected supplier vanished, the header chips went with it, and Post answered
   "Please select a supplier (Alt+S)" while the typed lines stayed on screen.
2. **Escape dismisses the entry row first** — the form's capture-phase listener reached the
   discard confirm before the draft row's own handler could run, so Escape now clears a half-typed
   product or draft line and only offers "Close purchase bill entry?" when the row is empty.

### QA harness

3. **Credit notes are compared per note** — the sales-return suite matched any
   `module_key='credit_note'` row on the store and so checked a fresh note against the oldest one;
   it now selects by return number or original invoice.
4. **The report-window suite survives a settling frame** — `/api/invoices` calls issued straight
   after checkout retry on a detached frame instead of ending the run, and the day and month
   windows now pass over HTTP as well as out of process.

### Testing

5. **POS** — 98 files / 764 tests pass and `tsc --noEmit` is clean, including a new
   `useModalEscape` suite and a manager case that a handler reporting "still open" stays
   registered.
6. **Backend** — 483 tests / 2,934 assertions pass.
7. **Live** — S1 68/68 GST and stock checks in both tax modes, S2 returns and credit notes,
   S3 inward bill and debit note, S4 bill revise and cancel, S5 purchase cancel and edit,
   S6 date windows, S7 batch picker. Still open: F12 on "Post Purchase (F12)" opens the
   Switch Account modal (Medium), and the server purchase row does not retain the till's own
   document number (Low).

Bump desktop app, updater and admin panel versions to 2.0.42.

## 2.0.41 — 2026-11-19

Centralised-billing release: the server now calculates every document a till sends the
way the till itself calculated it. GST mode and paisa rounding agree across both engines,
offline bills, purchases, returns, credit notes, edits and cancels land on the server with
their lines, batches, payments and stock effects intact, and the day-window filters that
silently hid today's bills are gone.

### GST mode and totals

1. **The store's tax mode is honoured server-side** — a new `StoreTaxPolicy` reads the billing setting the POS and admin panel actually write, falls back to the legacy key, and only then to the stores columns, so an exclusive store no longer gets inclusive math from `/api/sync`.
2. **One paisa law in both engines** — a line's GST amount is rounded once and then split `cgst = round(gst/2)`, `sgst = gst - cgst`. Rounding each half off the taxable base lost a paisa whenever both halves rounded down, so the server reported up to 2 paise less tax than the receipt printed and pushed the difference into round-off. Inclusive lines now satisfy `taxable + tax == the amount charged`.
3. **Golden vectors corrected** — `specs/gst_tax_test_vectors.json` carries the rounding convention in words, and TC04, TC07 and TC10 were fixed where they encoded the double-rounded paisa (₹81 at 5% is ₹4.05, not ₹4.06; a ₹100 MRP line at 12%+2% carries ₹12.28 of tax; the ₹100.35 net that TC10 names is now the net it asserts).

### Offline documents reaching the server intact

4. **Purchase inward sync** — a queued purchase creates its batches, keeps its line links and its own bill number, and is marked synced, so ITC, supplier ledger and stock all survive the replay.
5. **Returns and credit notes stay themselves** — a sales return arrives as a credit note against the original invoice with its lines and links, and cancelled documents keep their booked money instead of being rewritten.
6. **One canonical cancel path** — `InvoiceCancellationService` is the single place a sale is reversed, used by both `POST /api/invoices/{id}/cancel` and the sync queue, so stock returns exactly once and the ledger entry matches.
7. **Stock action per line** — `invoice_items.stock_action` lets a credit-note line marked discard or quarantine stay non-restocking, instead of the server adding returned-then-destroyed stock back.
8. **No duplicate rows on pull** — invoices and returns are identified by a canonical document key across the queue, the ingest and the local cache.

### POS and Past Bills

9. **"Today" shows today's bills** — every invoice date window compares on `whereDate` instead of string ranges, so the bare `YYYY-MM-DD` dates the till syncs and the stamped `YYYY-MM-DD HH:MM:SS` dates both match. Reports used the same broken bounds and had been summarising an empty day.
10. **Purchase cancel dialog is usable** — the Confirm button in the purchase details drawer is reachable and clickable again.
11. **Debit notes load their purchase** — a purchase return now pulls the original inward lines instead of opening empty.

### Testing

12. **Backend** — 483 tests / 2,934 assertions pass, including new `StoreTaxModeTest`, `SyncPurchaseIngestTest`, `SyncPurchaseReturnIngestTest`, `SyncCreditNoteIngestTest`, `SyncDocumentStockTest`, `SyncInvoiceEditCancelTest` and `InvoiceDateWindowFilterTest`.
13. **POS** — 97 files / 761 tests pass and `tsc --noEmit` is clean, including the shared tax-engine vectors, `invoiceCacheIdentity` and the sales/purchase return services.
14. **Live** — the GST QA harness (`tests/qa/gst_s1…s7`) drives the real POS web build against a running API and checks the money the till printed against the rows the server stored, plus batch stock before and after.

Bump desktop app, updater and admin panel versions to 2.0.41.

## 2.0.40 — 2026-11-18

Branch-scoped staff management release: staff CRUD now runs from the POS terminal
itself, every terminal-created account is pinned to the signed-in branch, legacy
local store keys stop breaking paired workstations, and the admin panel gains a
multi-branch access picker.

### Staff management in POS

1. **Staff & Access panel** — create, edit, delete, unlock and reset the PIN of operator accounts from POS → Settings → Security. Accounts are written on the server and mirrored into the terminal's offline cache; the panel requires an online sign-in.
2. **Branch-pinned accounts** — the panel shows the terminal's branch and offers no store selector. The server enforces it for `staff_session_token` callers: create and update force the branch, and multi-branch grants are rejected. Global and multi-branch accounts stay admin-panel-only.
3. **Cross-branch writes blocked** — edit, delete, unlock, lock, reset-PIN, biometric toggle and force-logout now refuse any account outside the signed-in branch, including global (unassigned) accounts. Previously the PIN, unlock and session routes had no store check at all.
4. **Roster matches authority** — Super Admin accounts are no longer listed in the POS panel, since the server refuses every write to them from a terminal.

### Legacy store-key compatibility

5. **`store_main` resolved, not rejected** — a new normalization middleware converts local registry store keys and codes into server store ids before controllers run, so public terminal endpoints can no longer fall back to the first store.
6. **Device token as tenant authority** — the logged-in device roster, staff sign-in and offline-cache sync now resolve the store from the paired device token instead of failing or returning empty when the client sends a key the server has never seen.
7. **Roster errors surfaced** — Logged-In Devices reports a fetch failure rather than showing an empty list that looks like "no devices".

### Access grants

8. **Multi-branch picker** — Admin → Users now grants additional branches with a checkbox list on create and edit, prunes the assigned branch automatically, and summarizes extra branches in the users table.
9. **No self-escalation** — a caller cannot grant a branch outside its own access scope; attempts are refused with 403. Super admins are unaffected.
10. **Global admin hashes stay server-side** — Super Admin credentials are excluded from the offline staff cache and remain an online-only sign-in option.

### Testing

11. **Backend** — new `PosStaffCrudStorePinTest` (terminal pinning, cross-branch denial, admin-panel parity) and `PosStoreKeyCompatibilityTest`. 423 tests pass.
12. **POS** — staff service, device session and offline-cache coverage updated. 749 tests pass.

Bump desktop app, updater and admin panel versions to 2.0.40.

## 2.0.39 — 2026-11-17

Roles, permissions and counter-workflow release: granular RBAC across backend,
admin panel and POS, a per-user permission matrix, free quantity end to end,
staff directory, batch label printing and sales-order recall.

### Permissions and roles

1. **Granular RBAC** — backend, admin panel and POS share one permission model. Per-user overrides take precedence over the role baseline, a present module key is a complete allow-list, wildcards and legacy list forms are accepted, and super admins bypass overrides.
2. **Wildcard leak fixed** — staff login and the offline cache no longer default to `["*"]`; legacy wildcard sessions are migrated on load. Previously every role effectively held every permission.
3. **POS enforcement** — menu visibility, command palette, route access and report listings all honor the session's permissions, so cashiers no longer see all reports or restricted screens.
4. **Permission matrix** — tri-state per-module editor in Admin → Users for creating and editing custom access, with backend normalization and privilege guards that stop non-super-admins creating or modifying super-admin accounts.

### Billing

5. **Free quantity end to end** — editable free packs/loose on the POS grid and entry row, correct stock deduction, invoice persistence, cloud sync (including the admin API and a `free_qty` column on invoice items), printing and sales reports.
6. **Batch label printing** — print barcode/label sheets for any batch from Masters.

### Counter workflow

7. **Staff directory** — read-only list of the store's staff and permission overrides in POS Settings → Security; accounts stay managed in Admin.
8. **Sales-order recall** — recall open sales orders into the POS cart from the billing screen, with search, status labels and a replacement confirmation. The order itself stays open until fulfilled or cancelled in Admin.

## 2.0.38 — 2026-11-17

Centralized-billing completion release: payments and settlement, GST compliance,
price lists, sales orders, loyalty, accounting exports, B2B portal, Malayalam
i18n, central backup/restore, day close, shared catalog, GST working papers and
password reset — plus critical route and authentication hardening.

### Security and authentication

1. **Device-authenticated sync** — every sync push endpoint requires the paired workstation token (`X-Device-Token`); revoked, locked and pending devices and suspended stores are rejected, and writes are pinned to the device's own store. Cross-store payloads fail with a tenant-isolation 403.
2. **Offline staff cache** — requires device authentication, derives the store from the device instead of the request, excludes global super-admins, and is served `Cache-Control: no-store, private`.
3. **Admin unlock** — scoped to the device's store, rate-limited to six attempts per minute, audited on failure, and free of account-enumeration differences.
4. **Staff login throttling** — 30 attempts per minute with a dedicated limiter key.
5. **Biometric no-op removed** — the desk login no longer offers a flag-only biometric session without a real credential.
6. **Store switching** — clears the previous store's legacy device token so a push never carries another pharmacy's credential.

### Payments and settlement

7. **Provider-agnostic payment config** with UPI intent QR generation on the POS tender screen.
8. **Settlement import and reconciliation** — batch import, line matching and admin review.
9. **Gift cards and store credit** — ledger-backed issuance, redemption and balance enquiry at tender.

### GST compliance

10. **Compliance data model and service** — e-invoice/e-way bill metadata captured per document, surfaced in POS, print and admin.
11. **Compliance API** — backfill, import/export and admin dashboard.
12. **GST working papers** — GSTR-3B, 2B reconciliation and annual 9/9C summaries.

### Sales

13. **Price lists** — customer- and channel-scoped pricing resolved in the POS cart.
14. **Sales orders and delivery challans** — draft-to-dispatch workflow with Rule 55 challans.
15. **Loyalty points and coupons** — earn/burn ledger, coupon validation and POS redemption.

### Exports and portal

16. **Accounting exports** — Tally, Busy and CSV exports with admin download.
17. **B2B customer portal** — token-scoped portal access with statement and invoice views.
18. **Malayalam i18n groundwork** and staff password reset.

### Operations

19. **Central backup and restore** — scheduled and manual database backups with in-app restore.
20. **Store day close** — cash reconciliation, variance reporting and admin day-close review.
21. **Shared central catalog** — publish catalog snapshots from admin and pull them at the store.
22. **Signed webhook outbox** — retried, signed webhook delivery with an admin log.

## 2.0.37 — 2026-11-16

33-item billing correctness, security and keyboard release, followed by a
desktop QA verification pass. Findings and root causes:
`docs/BUGFIX_2026-11_FINDINGS_AND_PLAN.md`. Published shortcut map:
`docs/KEYBOARD_SHORTCUTS.md` and `specs/keyboard-shortcuts.json`.

### Dashboard

1. **Sales missing / dates shifted** — invoice dates are treated as store-local calendar dates; dashboard "today/week/month" is computed in the store's configured timezone on desktop and in the admin API, and the admin dashboard now returns `timezone`.
2. **Duplicate recent invoices / returns** — all dashboard, bills and report reads de-duplicate with the shared `documentIdentity.dedupeDocuments` helper, so a document cached under local and server ids appears once; returns stay separate entries with negative amounts.
3. **Empty GST Quick View** — slabs are accumulated from document lines through the shared tax engine, with header-level fallback for server-ingested bills, 0/5/12/18/28 slabs pre-seeded and explicit composition / no-tax copy.

### POS billing

4. **Hold / Recall shortcuts** — Hold is `Alt+H`, Recall is `Alt+L`; every POS `F8`/`F9` alias was removed so global Counters (`F8`) and Import/Export (`F9`) are never shadowed.
5. **Quantity accepted letters** — the shared `SmartQtyInput` parser rejects non-numeric and multi-decimal input inline, sanitises paste, never emits text/NaN and mirrors the server quantity contract.
6. **Batch edit shortcut** — `Alt+E` opens the batch/expiry editor for the active line.
7. **Scoped `Alt+D` / `Alt+P`** — doctor and patient shortcuts only fire on pharmacy POS; purchase reuses `Alt+D` for bill date and `Alt+P` is inert elsewhere.
8. **Line discount shortcut** — `Alt+I` opens the line discount editor through the central key map.
9. **Loose-only quantity rejection** — products whose unit does not allow loose sale reject pack+loose quantities in POS, returns and purchase with a structured error instead of silently rounding.

### Invoices and edit approval

10. **Pinned default period** — Past Bills opens on the owner-configured store period (`workspace.billsDefaultPeriod`); a staff-chosen pin overrides it for that user.
11. **Next / previous period keys** — `Alt+→` and `Alt+←` move the register period.
12. **Payment and status filter keys** — `Alt+Shift+P` cycles the payment filter and `Alt+S` cycles the status filter.
13. **Modal stacking** — dialogs render through the shared `ModalStackProvider / ModalLayer`, get correct stacking order, focus trap, focus restore and `Escape` handling; the invalid `z-60` class is gone.
14. **Default PINs removed** — no default or hardcoded PIN/password remains in invoice edit authorization, settings, seeds or database defaults. Seeded accounts must reset; client authorization fails closed.
15. **Admin allow-edit / one-time PIN** — administrators issue a single-use, invoice- and user-bound PIN that expires in minutes, is shown once, stored only as a salted hash and audited on issue, use, failure and revoke. Managers may also approve with their own credentials and permission.
16. **Cancel-edit shortcut** — `Ctrl+Q` cancels the current invoice edit session from edit scope only.

### Sales return

17. **Customer invoices and walk-in search, optional debit note** — returns search the selected customer's invoices and walk-in bills, and a return can produce an optional debit note without forcing one.

### Purchase

18. **Supplier quick-add prefill** — the typed supplier name pre-fills the quick-add form, focus moves to phone/GSTIN, and the new supplier is selected with focus returned to the header.
19. **`Alt+S` supplier vs Switch Store** — Switch Store moved to `Ctrl+Alt+S` everywhere; `Alt+S` focuses the supplier on purchase and cycles status on bills.
20. **Batch combobox** — the purchase grid reuses `BatchCombobox`, scoped to the product, and selecting a batch fills expiry and rates or allows typing a new batch.
21. **Free quantity pack + loose** — free quantity uses the shared pack/loose input and is stored in base units with the same validation as paid quantity.
22. **Percent / amount discount** — line and bill discounts accept `5%` or a flat amount, persist `{type, value}` and toggle with `Alt+Y` per line.
23. **Optional batch/expiry by store type** — `batch_required` defaults to true only for pharmacy, is editable in admin settings, and batchless stock is stored and rendered as `NULL` instead of placeholders.
24. **Manufacturing date** — an optional MM/YY manufacturing date column is captured on purchase lines, validated against expiry and persisted.
25. **Quick-add product prefill + add row** — opening quick-add resets the form with the typed query and exposes an arrow-key-reachable “+ Add new product” row that opens the prefilled modal.
26. **Editable HSN / PTR / PTS / PTSS / discount** — these fields are editable inline on draft and committed rows, PTR/PTS/PTSS follow the store setting, HSN is validated as 4/6/8 digits and all values persist on server, admin and MCP paths.

### Stock

27. **Bulk adjustment** — the stock adjustment document supports multi-line entry and tab/comma paste of product, batch and quantity rows, then posts as one document.
28. **Admin restrictions enforced server-side** — adjustment policy (who may adjust and whether approval is required) is enforced by the backend, not only hidden in the UI, and every policy change is audited.

### Staff login, counters and devices

29. **Offline login** — the offline staff directory verifies Argon2id with a bcrypt fallback, stores only device-bound encrypted hashes in the OS-backed vault, fails closed, locks out local guessing, and queues offline audit events for sync.
30. **Store Switch reappearing** — the store gateway is shown only when the registry is empty, the operator asks for it, or no active store exists; it no longer reappears after a successful sign-in.
31. **Counter-name uniqueness** — counter names are unique per store, case- and whitespace-insensitive, across active, locked and pending counters; enrolment and rename return `422 COUNTER_NAME_TAKEN` with the holder, and auto-registration suffixes duplicates.
32. **One active counter per user** — a second sign-in returns `409 ACTIVE_SESSION_ELSEWHERE` with the active session. Privileged roles may force the old session out; `allow_multi_counter_roles` exempts configured roles. Stale sessions expire after 30 minutes and forced-out sessions lose their tokens.
33. **Device presence in workstations** — heartbeats refresh device, counter, user, version and sync identity, never fabricate or resurrect a session, revoked devices return `403 lock_and_reset`, and the Counters screen plus admin Devices page show live presence with lock, unlock, force-logout and revoke.

### Cross-cutting

- **Keyboard map** — every shortcut lives in `frontend/src/lib/keyboard/centralKeyMap.ts`; buttons, POS hint strip and the Shortcuts panel read from it. Same-scope conflicts fail the test suite; intentional screen-over-global overrides are published. Current map: 71 bindings, 0 conflicts.
- **API parity** — admin panel gains store timezone, security/offline and multi-counter settings, pharmacy batch requirement, RBAC-scoped device-session routes, correct audit action filters and role-gated edit-PIN issuance. MCP tools were aligned to the real API paths, with dashboard, stock-adjustment, device-session and counter tools added.
- **Tests** — new feature tests for counter uniqueness, staff session policy, security-audit sync, admin timezone/access, plus frontend tests for key-map drift, shortcut dispatch, quantity validation, modal stacking, approval PIN, offline login, device heartbeat side effects and session conflicts.

### QA verification pass

- **Navigation at 1280 px** — items compact at `xl`, F-key and version hints collapse below `2xl`; all 11 destinations stay visible without horizontal scroll at 1280×800 and 1440×900.
- **Bill detail integrity** — taxable subtotal, CGST/SGST/IGST, grand total and payment tenders are read from the invoice snapshot; server tender lines are normalized and persisted, and an unpaid balance is never fabricated when no tender exists.
- **GSTR-1** — duplicate documents are de-duplicated and taxable values come from invoice lines, with correct B2B/B2CS classification.
- **Customer GSTIN** — the POS header validates the 15-character format live, the state code flips the cart between CGST/SGST and IGST, and checkout blocks an invalid GSTIN instead of issuing a malformed B2B invoice.
- **Masters** — empty product/batch saves surface their validation toast above the modal, batch expiry accepts `YYYY-MM` and `YYYY-MM-DD`, and expired, expiring-soon and negative-stock rows are visually flagged.
- **Sign-out and device honesty** — forced sign-out clears the credential form, session-conflict and heartbeat noise is reduced, and devices report the real app version (`Version unknown` when absent) instead of a fabricated default.
- **Sync integrity** — product pushes skip rows without an external id or name rather than creating placeholder products.
