/**
 * Builds test-reports/defects.csv and test-reports/fix-list.md from one defect register so the
 * two deliverables cannot drift apart. Severity: Critical = wrong money/stock/tax, data loss or
 * security; High; Medium.
 */
const fs = require('fs');
const path = require('path');

const GROUPS = [
  {
    id: 'G1', name: 'Tax & money correctness',
    root: 'The client and server each re-derive GST from different rules. The JS engine derives total tax from the inclusive base and splits it; the PHP engine rounds CGST and SGST independently and sums them. The server also ignores the store\'s tax mode (it reads a settings key nothing writes) and re-rates offline bills at a hardcoded 12%. Because the money fields are absent from the validation whitelist, the "safety net" can never fire and disagreements are stored silently.',
    ids: ['TX-01','TX-02','TX-03','TX-04','RPT-01'],
  },
  {
    id: 'G2', name: 'Offline save & sync reliability',
    root: 'One failed POST marks the workstation offline permanently, the queue never acks processed entries, and the offline fallback persists a header without line tax, payments or server-side stock. Every reconnect keeps compounding the divergence.',
    ids: ['OFF-01','OFF-02','OFF-03'],
  },
  {
    id: 'G3', name: 'Inventory & payables never reach the cloud',
    root: 'Purchases, transfers and offline sales only write local stock. The server\'s purchase/transfer sync handlers persist documents and lines but never touch product_batches, stock_ledger_entries, products.current_stock or the supplier payable. Server reports and every other counter therefore see a different world from the till.',
    ids: ['STK-01','STK-02','RPT-02'],
  },
  {
    id: 'G4', name: 'Security & tenant isolation',
    root: 'The whole /api block that devices use is declared public in routes/api.php and the handlers trust client-supplied store_id. There is no membership check, external_id is looked up across stores, and a local-environment backdoor rewrites PIN hashes. This is one authorisation model problem, not six independent bugs.',
    ids: ['SEC-01','SEC-02','SEC-03','SEC-04','SEC-05','SEC-06'],
  },
  {
    id: 'G5', name: 'Purchase & sales returns',
    root: 'The purchase-return screen reads header-only rows and expects embedded lines; the return is then queued under the wrong entity type. Sales credit notes carry an original invoice number the server schema does not store.',
    ids: ['PUR-01','PUR-02','SR-01'],
  },
  {
    id: 'G6', name: 'Devices, counters & licensing',
    root: 'Counter identity is inferred from free-text device names and the counter row is overwritten by whichever device registered last. Licensing failures are reported as invalid keys and rate-limited per IP.',
    ids: ['DEV-01','DEV-02','DEV-03'],
  },
  {
    id: 'G7', name: 'UI, shortcuts & release hygiene',
    root: 'Page and shell keyboard handlers fight over the same keys, the till toolbar is wider than a 1366 screen with no scroll, empty states contradict themselves, and the first paint talks to production hosts.',
    ids: ['UI-01','UI-02','UI-03','UI-04'],
  },
  {
    id: 'G8', name: 'Bootstrap & admin master-data APIs',
    root: 'Seeding and the admin master endpoints were never exercised end-to-end: a seed command writes a non-existent column and two admin POSTs drop required fields or tenant scope.',
    ids: ['ADM-01','ADM-02','ADM-03'],
  },
  {
    id: 'G9', name: 'Statutory reports & dashboard',
    root: 'Report queries aggregate the same inconsistent rows the write paths produced, and some tiles read the local multi-tenant cache without a store filter.',
    ids: ['RPT-04'],
  },
];

const D = [
  {
    id: 'TX-01', sev: 'Critical', type: 'Logic', module: 'Billing / GST', group: 'G1',
    title: 'Client and server round inclusive GST differently, so screen, invoice and reports disagree by paise',
    scenario: 'B1, B2, B4, B6, B10',
    repro: 'QA-A, inclusive 12%: bill 2 packs + 3 loose of DOLO650 (10/pack) and pay cash. Repeat with 33.33 x 7 @18%, 450.50 @12%, 28% packs+loose, and exempt+5%. Compare the till, invoices, invoice_items, invoice_payments and the printed copy.',
    expected: 'Till, invoice and print show the same numbers; tax_total equals CGST+SGST and the sum of line taxes; 69.00 bill = taxable 61.61 + tax 7.39 (3.69/3.70), round-off 0.00.',
    actual: 'Booked tax 7.40 (3.70/3.70) with round-off -0.01; 18% case booked 35.58 vs 35.59 and round -0.30 vs -0.31; 450.50 case books 450.00 while 451.00 was collected.',
    evidence: 'evidence/B_money.json (B01, B03, B04, B05, B06); evidence/M_integrity.json invoices_tax_ne_line_sum; FINDINGS F6, F20',
    cause: 'backend/app/Services/Tax/TaxEngine.php:246-250 rounds each half from taxable then sums; frontend/src/lib/tax-engine/taxEngine.ts:323-324 derives total from the inclusive base and splits; InvoiceController stores the recomputed values.',
    fix: 'Compute document tax once, from the taxable base, and allocate halves as cgst = floor(total/2), sgst = total - cgst (igst = total when inter-state). Make PHP the single source of truth and echo the persisted figures to the client; port the same vectors to the JS engine.',
    test: 'Golden vectors (69.00 @12 incl; 33.33x7 @18 incl; 450.50 @12 incl; 28% packs+loose; exempt+5%) asserting cgst+sgst == tax_total and tax_total == sum(line tax) in both test suites.',
  },
  {
    id: 'TX-02', sev: 'Critical', type: 'Logic', module: 'Billing / Sync', group: 'G1',
    title: 'Server ignores the store tax mode and re-rates offline bills at a hardcoded 12%',
    scenario: 'B3, B7, B8, B12, J1',
    repro: 'Post an exclusive-tax bill in QA-B (1 x 51.00) and compare the invoice with the till. Then save a 28% bill while the backend is blocked and reconnect.',
    expected: 'Booked taxable 51.00 / tax 6.12 / grand 57.00; the offline 28% bill keeps tax 66.50 and grand 304.00.',
    actual: 'QA-B invoices book taxable 45.54 / tax 5.46 / total 51.00 while 57.00 was collected (QAB-1001/1002/1003/1004). Offline QAE-1003 books tax 28.50 and round-off 38.00.',
    evidence: 'evidence/B_money.json B07/B08; evidence/B_resilience.json B12; FINDINGS F19, F22, F28',
    cause: 'backend/app/Http/Controllers/Api/InvoiceController.php:557 reads company_settings key "tax_settings", which nothing writes (real settings live under "billing" and stores.tax_mode); backend/app/Http/Controllers/Api/SyncController.php:287 defaults every missing tax field to 12%.',
    fix: 'Resolve tax mode from the store settings row (billing JSON + stores.tax_mode) and treat the request value as an override only when the store allows it. In the sync path, require per-line gst_percent and taxable values; never invent 12%.',
    test: 'Parametrised test posting exclusive, composition and no_tax bills plus 5/18/28% offline payloads, asserting booked totals equal the independent oracle.',
  },
  {
    id: 'TX-03', sev: 'Critical', type: 'Data', module: 'Billing', group: 'G1',
    title: 'Server overwrites client tax_total/round_off without validation, leaving paid_amount different from grand_total on 19 invoices',
    scenario: 'B1, B4, B12, K1',
    repro: 'Post the bills from TX-01, then query invoices against invoice_payments and the daily summary.',
    expected: 'Either the payload is rejected (409/422) or accepted as canonical; grand_total == paid_amount == sum(payments) on every invoice; the daily cash figure equals gross sales.',
    actual: 'Client 7.39/0.00 stored as 7.40/-0.01; QAA-1008/1014/1021/1027/1034/1037 have grand 450 paid 451; QAB-1001/1003 grand 51 paid 57; 7 invoices have paid_amount != payments; daily-summary cash 7055 vs gross 7049.',
    evidence: 'evidence/B_money.json; evidence/M_integrity.json; evidence/K_reports.json daily_summary',
    cause: 'backend/app/Http/Controllers/Api/InvoiceController.php:164-208 validates a whitelist that excludes grand_total, tax_total, taxable_subtotal, round_off, tax_mode, gst_type and items.*.rate_basis, so the guard at :610-615 compares null to null and can never fire.',
    fix: 'Add all money fields to validation, compare the payload with the recomputed document to the paisa and reject on mismatch; persist exactly one canonical total set and derive payments from it. Keep idempotency on external_id.',
    test: 'Tampered grand_total must return 422; an M1 invariant test asserts paid == grand == sum(payments) for every invoice after the suite.',
  },
  {
    id: 'TX-04', sev: 'Critical', type: 'Data', module: 'Sync / Billing', group: 'G1',
    title: 'Offline invoices book zero line tax and no payment rows',
    scenario: 'B12, F2',
    repro: 'Save a 28% bill while /api/invoices is blocked, restore connectivity, force sync, then inspect invoice_items and invoice_payments.',
    expected: 'Each line carries its tax (66.50 total) and the invoice has a payment row of 304.00; header tax equals the sum of line taxes.',
    actual: 'Line taxable/tax/total are 0, invoice_payments is empty, header tax is 28.50 (12% re-rate) while paid_amount is set. Six QAE invoices show tax_total with zero line tax.',
    evidence: 'evidence/B_resilience.json B12/B13; evidence/K_reports.json TAX-SPLIT-SUM; FINDINGS F27',
    cause: 'backend/app/Http/Controllers/Api/SyncController.php invoice ingestion writes the header only: it never inserts InvoicePayment rows and never recomputes line tax from the payload.',
    fix: 'Make the batch invoice handler call the same posting service as POST /api/invoices (lines, payments, stock, ledger) inside one transaction, keyed by external_id.',
    test: 'Offline 28% bill -> M1 invariants pass and day-book cash equals grand.',
  },
  {
    id: 'RPT-01', sev: 'Critical', type: 'Data', module: 'Reports', group: 'G1',
    title: 'Daily summary cash and invoice totals do not reconcile with the rows they summarise',
    scenario: 'K1, K4',
    repro: 'Open the daily summary for the test day at QA-A and compare with SQL aggregates over invoices and invoice_payments.',
    expected: 'cash_collection == sum(payments) == gross sales for the day; invoice_count matches; GST totals equal the sum of line taxes.',
    actual: 'gross 7049 / 37 invoices but cash_collection 7055; invoice grand totals sum to 7110 while payments sum to 7116; 8 invoices have tax_total != line-tax sum.',
    evidence: 'evidence/K_reports.json; evidence/M_integrity.json',
    cause: 'Same canonical-total problem as TX-03 (payments written from the till total, invoice stored with the re-derived total) plus report SQL summing both without a defined authority.',
    fix: 'After TX-03/TX-04, define invoice grand_total as the authority and derive payments and report aggregates from it; add a reconciliation check that fails the report if cash != grand.',
    test: 'Report test comparing each daily-summary field to SQL on a seeded day.',
  },
  {
    id: 'OFF-01', sev: 'Critical', type: 'Logic', module: 'Billing / Sync', group: 'G2',
    title: 'One failed save pushes the workstation onto the offline path for every later bill',
    scenario: 'B12, F2',
    repro: 'Block POST /api/invoices, save one bill, unblock, save a second bill, and capture the requests.',
    expected: 'The second bill attempts POST /api/invoices and succeeds online.',
    actual: 'No POST /api/invoices is attempted; the bill goes to /api/sync/push/batch while the header pill says "Live connected".',
    evidence: 'evidence/B_submit_path.json B15; evidence/B_resilience.json B13; FINDINGS F29',
    cause: 'frontend/src/lib/sync/onlineTransactionService.ts:428-437 sets connectionState = "offline" on any fetch error; the gate at :378 skips the live attempt until some other probe flips the flag back, and nothing re-probes inline.',
    fix: 'Treat connectivity as unknown at submit time: attempt the live POST with a short timeout and bounded retry; only use the offline fallback after a fresh probe fails, and show the actual mode.',
    test: 'Recovery test: fail one request, then assert the next bill hits /api/invoices and books correct tax.',
  },
  {
    id: 'OFF-02', sev: 'Critical', type: 'Data', module: 'Sync', group: 'G2',
    title: 'The device sync queue never drains after a successful push',
    scenario: 'B12, F1, F2',
    repro: 'Queue two bills, let the batch push return 200, then read the local queue table.',
    expected: 'Acknowledged entries are deleted (or marked synced and excluded from the count); the queued badge returns to 0.',
    actual: 'Queue grew 116 -> 118 and the successfully pushed invoice remained in the queue; the badge never clears.',
    evidence: 'evidence/B_resilience.json B12; FINDINGS F31',
    cause: 'frontend/src/lib/sync/syncQueueService.ts:260-360 and :397 mark items processed but never delete or advance a durable watermark; the header count reads the raw table.',
    fix: 'Delete/ack each entry in the same transaction that observes 2xx (per entity), keep a failed list with backoff, and derive the badge from pending rows only.',
    test: 'Queue length returns to 0 after a successful flush; a failed entry is retried and then removed.',
  },
  {
    id: 'OFF-03', sev: 'Critical', type: 'Data', module: 'Stock / Sync', group: 'G2',
    title: 'Offline-synced bills do not move server batch stock',
    scenario: 'B12, F2, M1',
    repro: 'Sell from a known batch while offline, sync, and compare product_batches/stock_ledger_entries before and after.',
    expected: 'Batch quantity falls by the billed units and a SALE ledger row is written, exactly as on the online path.',
    actual: 'Zero units moved and no ledger row; server stock diverges from the till until some other event corrects it.',
    evidence: 'evidence/B_resilience.json B13; FINDINGS F30',
    cause: 'backend/app/Http/Controllers/Api/SyncController.php invoice ingestion has no stock branch; only the online InvoiceController deducts batches.',
    fix: 'Route both paths through one invoice posting service that validates batch ownership, decrements stock and writes the ledger in a transaction.',
    test: 'M1 invariant: ledger sum == batch stock after an offline sale and after an online sale.',
  },
  {
    id: 'STK-01', sev: 'Critical', type: 'Data', module: 'Purchases / Stock', group: 'G3',
    title: 'A posted purchase inward bill creates no batch stock, stock ledger entry or supplier payable on the server',
    scenario: 'D1, K3, K4',
    repro: 'Post an inward bill (5 packs + 2 free @ 25, 12%) from the real UI and inspect product_batches, stock_ledger_entries, products.current_stock and parties.current_balance.',
    expected: '+70 units in a new batch, a PURCHASE_RECEIPT ledger row, current_stock +70, supplier payable +140, ITC 15.00. The success screen says "Batch stock credited & supplier ledger updated".',
    actual: 'Header and items land (subtotal 125, tax 15, grand 140) but there are 0 batches, 0 ledger rows and the supplier balance stays 0; across 17 purchases no supplier has a balance. Profit report shows COGS 0 / 100% margin.',
    evidence: 'evidence/D1_post_full.json, evidence/D1_local_effects.json, evidence/DE_purchases_stock.json D1, evidence/M_integrity.json; FINDINGS F37',
    cause: 'backend/app/Http/Controllers/Api/PurchaseController.php:34-190 and SyncController.php:580-700 persist Purchase + PurchaseItem only. Client-side frontend/src/lib/purchases/purchaseService.ts:320-500 calls upsertBatch without enqueueSync and inserts stock_transactions/party_ledger_entries that are never queued (frontend/src/lib/masters/productsStore.ts:207-214).',
    fix: 'Post purchases through one server service that upserts the batch (product + batch_no + expiry), writes the stock ledger, increments current_stock and the supplier payable in a transaction, idempotent on external_id. Queue the batch/ledger/payable intents from the client or drop them in favour of server-derived effects.',
    test: 'D1 end-to-end assertion on all four surfaces; M1 invariant ledger == batch; supplier ledger equals purchases total.',
  },
  {
    id: 'STK-02', sev: 'Critical', type: 'Data', module: 'Transfers / Stock', group: 'G3',
    title: 'A dispatched inter-store transfer reaches the cloud as a document but moves no stock at either store',
    scenario: 'E3',
    repro: 'Dispatch 24 units of QA-A-LONG-01 from QA-A to QA-B through the transfer screen, then inspect stock_transfers, product_batches and stock_ledger_entries.',
    expected: 'Transfer row + items, source batch -24 with a TRANSFER_OUT ledger row, and (on receipt) +24 at QA-B; both counters and reports agree.',
    actual: 'stock_transfers QA-TRF-608154 + item exist, but the source batch stays at 120 and there is no TRANSFER ledger row anywhere.',
    evidence: 'evidence/D3_transfer_probe.json; SQL: 0 rows reference_type like %TRANSFER%; FINDINGS F43',
    cause: 'frontend/src/lib/stock/interStoreTransferService.ts:575-645 decrements only the local batch and enqueues entity "transfer"; backend/app/Http/Controllers/Api/SyncController.php:763-800 writes header/items only.',
    fix: 'Apply stock movements server-side on dispatch (out of source, in-transit) and on receipt (into destination) with ledger rows; reject a transfer payload that does not carry line batch/qty.',
    test: 'Transfer 24 units -> source -24, destination +24 after receipt, M1 invariants on both stores.',
  },
  {
    id: 'RPT-02', sev: 'High', type: 'Data', module: 'Reports', group: 'G3',
    title: 'Profit report shows zero COGS and 100% margin because purchased stock never reaches the server',
    scenario: 'K4',
    repro: 'Open the profit/margin report for QA-A after the purchases in D1.',
    expected: 'COGS derived from purchase rates and sold quantities; margin plausible.',
    actual: 'COGS 0.00 and margin 100% because no purchase batch/rate exists server-side.',
    evidence: 'evidence/K_reports.json; FINDINGS F37',
    cause: 'Consequence of STK-01 (report reads empty purchase batches).',
    fix: 'Fix STK-01; add a report guard that flags COGS 0 when sales exist in a costed product.',
    test: 'Profit report with one purchase + one sale matches hand-computed COGS.',
  },
  {
    id: 'PUR-01', sev: 'High', type: 'Workflow', module: 'Purchase Returns', group: 'G5',
    title: 'Purchase return cannot load line items, so no purchase can be returned',
    scenario: 'D5',
    repro: 'Post an inward bill, open Purchase Returns -> New Purchase Return, search the bill number and select it.',
    expected: 'Step 2 lists the bill lines with batch and purchased qty, allowing a return quantity and a debit note.',
    actual: 'The bill is found (PUR-206) but step 2 says "This purchase bill has no line items recorded."; no qty input exists and Save & Print Debit Note is unreachable.',
    evidence: 'evidence/D5_return_probe.json; FINDINGS F41',
    cause: 'frontend/src/pages/PurchaseReturnPage.tsx:120-124 loads purchase_documents (header only); selectPurchase at :197-215 maps purchase.lines, which this app never stores there. purchaseService.getPurchaseBillById already joins purchase_items but is unused.',
    fix: 'Load purchases through getPurchaseBillById (or join purchase_items) and build return lines from items; keep the legacy doc.lines fallback.',
    test: 'Post a 4-pack bill, return 2 units, assert debit note + batch -2 + supplier debit.',
  },
  {
    id: 'PUR-02', sev: 'High', type: 'Data', module: 'Purchase Returns / Sync', group: 'G5',
    title: 'A purchase return would be synced as a product, creating junk catalogue rows instead of a debit note',
    scenario: 'D5',
    repro: 'Complete a purchase return once PUR-01 is fixed and inspect the server.',
    expected: 'A purchase_return/debit_note document with lines, supplier debit and reversed input GST; idempotent by external_id.',
    actual: 'Client enqueues entity "product" with the return record; server upsertSingleProduct writes name "Untitled Product", mrp/sel_rate 0, external_id = returnId. No purchase_returns table exists.',
    evidence: 'evidence/D5_return_probe.json; source: purchaseReturnService.ts:319, SyncController.php:430-460; schema query',
    cause: 'Wrong entity type in the queue and no server handler/schema for returns.',
    fix: 'Add a purchase_returns entity + table + handler mirroring the invoice posting service; queue as "purchase_return"; never accept a product payload that has no name.',
    test: 'Return posts a debit note; products count unchanged; supplier balance decreases.',
  },
  {
    id: 'SR-01', sev: 'High', type: 'Data', module: 'Sales Returns / Sync', group: 'G5',
    title: 'A sales credit note cannot be traced to the invoice it reverses on the server',
    scenario: 'C5',
    repro: 'Return part of a bill and inspect the stored credit note columns.',
    expected: 'original_invoice_number (and original invoice id) stored and used by GST reports.',
    actual: 'The client sends original_invoice_number but the invoices table has no such column; reports cannot link the credit note.',
    evidence: 'evidence/C_returns.json C05 (server invoice columns)',
    cause: 'Missing migration/ingest field; sync payload drops it.',
    fix: 'Add the columns, persist them in both posting paths, and surface the link in the credit-note view and GSTR-1 table 9.',
    test: 'Credit note row carries the original number; report nets the return against that invoice.',
  },
  {
    id: 'SEC-01', sev: 'Critical', type: 'Security', module: 'Auth / Staff', group: 'G4',
    title: 'Unauthenticated offline-cache endpoint returns password and PIN hashes for all staff, including super admins',
    scenario: 'I5',
    repro: 'GET /api/staff/offline-cache?store_id=4 with no Authorization header.',
    expected: '401 without a device/staff token; with a token, only the authenticated store and no hashes beyond what the terminal needs.',
    actual: '200 with 6 staff rows and password_hash/pin_hash values, plus global super_admin rows.',
    evidence: 'evidence/HI_auth_rbac.json; evidence/H2_noauth_api.json; FINDINGS F1',
    cause: 'backend/routes/api.php:57 declares the route public; StaffAuthController::offlineCache returns hash columns.',
    fix: 'Require device+staff authentication, scope to the caller store, return only a salted cache verifier (never raw hashes) and rotate affected credentials.',
    test: 'Unauthenticated and cross-store requests return 401/403 and no hash strings.',
  },
  {
    id: 'SEC-02', sev: 'Critical', type: 'Security', module: 'Sync / Tenancy', group: 'G4',
    title: 'Unauthenticated sync pull returns every tenant\'s products, batches and parties',
    scenario: 'F4, I5',
    repro: 'GET /api/sync/pull/deltas?store_id=4 with no token.',
    expected: '401; with a token, only store 4 rows.',
    actual: '200 with 1447 products, 1506 batches and 58 parties across stores 1,2,4,5,6,7,8.',
    evidence: 'evidence/H2_noauth_api.json; FINDINGS F2',
    cause: 'backend/routes/api.php:68 public; SyncController::pullDeltas does not scope by store.',
    fix: 'Authenticate and authorise the route, scope every query by the resolved store, and add tests for cross-store deltas.',
    test: 'No-token pull 401; store-A token sees only store-A ids.',
  },
  {
    id: 'SEC-03', sev: 'Critical', type: 'Security', module: 'API / Sync', group: 'G4',
    title: 'Anonymous API can read invoices/settings/counters and write invoices; sync push re-owns data to store 1 and rewrites another tenant\'s row',
    scenario: 'I5, H2',
    repro: 'With no token: GET /api/invoices, GET/POST /api/settings, GET /api/counters, GET /api/branches; POST /api/sync/push/batch with store_id 99; re-push the same external_id claiming store_id 7.',
    expected: '401/403 everywhere; writes only inside the authenticated tenant.',
    actual: 'All return 200. The anonymous invoice is stored as a completed 999.99 invoice re-owned to store 1; re-pushing the same external_id with store_id 7 mutates that row (number, total, status, store_id). Products can also be injected into store 1.',
    evidence: 'evidence/H2_noauth_api.json; FINDINGS F3, F33, F34',
    cause: 'backend/routes/api.php:38-100 declares the terminal API public; SyncController.php:228 looks up external_id across stores and resolveStoreId falls back to a real store.',
    fix: 'Put the whole terminal API behind device/staff auth, ignore client store_id in favour of the token scope, make (store_id, external_id) unique, and never retenant an existing row.',
    test: 'Anonymous writes 401; cross-store external_id push 409/403; DB row unchanged.',
  },
  {
    id: 'SEC-04', sev: 'Critical', type: 'Security', module: 'Tenancy', group: 'G4',
    title: 'A store-A cashier token can read and write other stores and read 10 statutory reports by changing store_id',
    scenario: 'I3, I4, K1',
    repro: 'With a QA-A cashier token call /api/settings?store_id=5, /api/counters?store_id=5, /api/invoices?store_id=5, /api/products?store_id=5 and /api/reports/daily-summary?store_id=5.',
    expected: '403 for any store other than the token\'s; report endpoints scoped server-side.',
    actual: '200 with the other store\'s rows; POST /api/settings store_id=5 returns "saved successfully"; reports return full other-store figures.',
    evidence: 'evidence/HI_auth_rbac.json ISO probes; evidence/K_reports.json REPORT-ISO; FINDINGS F24',
    cause: 'Controllers trust request store_id and there is no membership middleware on the POS/report routes.',
    fix: 'Add a ScopeStore middleware that resolves the store from the token/device and rejects mismatches on every route (reads included); make report handlers ignore client store_id.',
    test: 'Cross-store matrix test (read+write) for each endpoint; reports 403.',
  },
  {
    id: 'SEC-05', sev: 'Critical', type: 'Security', module: 'Auth', group: 'G4',
    title: 'Development backdoor PINs and passwords are accepted and silently rewrite the stored credential hash',
    scenario: 'H4',
    repro: 'POST /api/staff/login {store_id:4,user_id:7,pin:"1234"} for a user whose real PIN is 9101.',
    expected: '401; no bypass in any build.',
    actual: '200 with a valid token; the stored PIN hash is rewritten to the backdoor value. The same pattern exists for admin passwords.',
    evidence: 'evidence/HI_auth_rbac.json H2 probe; FINDINGS F16, F25',
    cause: 'backend/app/Http/Controllers/Api/StaffAuthController.php:199-228 and AdminAuthController.php:69-73 branch on environment(local,testing) || app.debug and update the hash.',
    fix: 'Delete the backdoor branches entirely (not env-gated), fail closed, rotate credentials of affected users, and add a test that known backdoor values are rejected.',
    test: 'PIN 1234/0000/1111 and the legacy passwords return 401 in every environment.',
  },
  {
    id: 'SEC-06', sev: 'Medium', type: 'Security', module: 'API', group: 'G4',
    title: 'Unauthenticated API calls without an Accept: application/json header return an HTML 500 instead of 401',
    scenario: 'I5',
    repro: 'curl -i http://127.0.0.1:8000/api/admin/stores without Accept: application/json.',
    expected: '401 JSON.',
    actual: '500 HTML "Route [login] not defined." and a laravel.log entry per request.',
    evidence: 'evidence/SEC_unauthenticated_html.json; FINDINGS F39; backend/storage/logs/laravel.log',
    cause: 'Laravel\'s unauthenticated handler redirects to route("login"), which does not exist for API routes.',
    fix: 'In bootstrap/app.php, force JSON responses for /api/* (or register a JSON exception renderer) and return 401 uniformly.',
    test: 'HTML-accept request to a protected API returns 401 JSON and logs no exception.',
  },
  {
    id: 'DEV-01', sev: 'High', type: 'Data', module: 'Devices / Counters', group: 'G6',
    title: 'Counter identity collides across devices and the counter row is overwritten by the newest device',
    scenario: 'A5, G1',
    repro: 'Onboard two workstations with the same counter name (or names without digits) and inspect counters/device_sessions.',
    expected: 'Each device keeps its own counter binding or the duplicate is rejected; each counter has one active device and its own number series.',
    actual: 'Both devices resolve to one counter_code C01; the else-branch overwrites counter_name/device_uuid/device_token, the first workstation loses its binding, and 48 active devices end up on one counter id while counters store only the newest device_uuid.',
    evidence: 'evidence/A_onboard.json A5; evidence/FG_sync_devices.json G1c; FINDINGS F7',
    cause: 'backend/app/Http/Controllers/Api/AuthController.php:156-157 derives counter_code from digits in the free-text name; :677-687 updates the existing counter row instead of binding a device.',
    fix: 'Make (store_id, counter_code) stable per physical till, keep a device->counter mapping table, reject duplicate names or append a suffix, and never overwrite an existing binding.',
    test: 'Two enrolments with the same name produce two device bindings (or a clear rejection) and distinct number series.',
  },
  {
    id: 'DEV-02', sev: 'High', type: 'Workflow', module: 'Licensing', group: 'G6',
    title: 'A valid key at the device limit is reported as invalid/expired/revoked; no owner notification; activation failures lock out the whole shop IP',
    scenario: 'A2, A4, A5',
    repro: 'Use a valid activation key that has reached max_devices, and trigger five activation failures from different devices behind one IP.',
    expected: 'A specific "device limit reached" message with a remediation path, an owner notification, and per-key/device throttling.',
    actual: '"Invalid, expired, or revoked activation key." with no hint; no notifications row is created despite the 429 promising an alert; failures are counted by IP OR device_uuid, so a new valid key is locked (429).',
    evidence: 'evidence/A0_activation_lockout.json (failure_reason limit_reached); evidence/A_onboard.json A2; FINDINGS F9, F10, F38',
    cause: 'backend/app/Http/Controllers/Api/AuthController.php activation error mapping; DeviceActivationAttempt::countRecentFailures keyed on ip_address OR device_uuid.',
    fix: 'Return distinct error codes for limit/expired/revoked, create the promised notification, and throttle per key + device fingerprint with an operator override.',
    test: 'Limit case returns a specific message; no global 429 after failures from unrelated devices.',
  },
  {
    id: 'DEV-03', sev: 'Medium', type: 'Data', module: 'Release / Devices', group: 'G6',
    title: 'Version drift: heartbeats and admin Device rows report older versions than the build',
    scenario: 'G1',
    repro: 'Read package/tauri/Cargo versions, then inspect a heartbeat payload and the admin Devices row.',
    expected: 'All report 2.0.36.',
    actual: 'deviceSessionService hardcodes 2.0.35; admin shows app_version 2.0.0 for devices; admin-panel package is 2.0.35 while the POS is 2.0.36.',
    evidence: 'evidence/FG_sync_devices.json G1c; FINDINGS F11',
    cause: 'frontend/src/lib/auth/deviceSessionService.ts:172 and :226 hardcode the string; admin-panel/package.json not bumped.',
    fix: 'Inject the version at build time from one source and consume it in heartbeats, admin and updater.',
    test: 'Build assertion that every reported version equals package.json.',
  },
  {
    id: 'UI-01', sev: 'High', type: 'Workflow', module: 'Keyboard shortcuts', group: 'G7',
    title: 'F12 on /purchases opens Switch Cashier and F3 on /pos does nothing, despite the on-screen promises',
    scenario: 'L3, D1',
    repro: 'At /purchases press F12 (button reads "Post Purchase (F12)"); at /pos press F3 (help says Inventory).',
    expected: 'F12 opens the post-purchase summary; F3 navigates to Inventory.',
    actual: 'F12 opens the account switcher; F3 is silently consumed by Quick Edit Selling Price and nothing happens.',
    evidence: 'evidence/L_ui_keyboard.json mismatches; FINDINGS F40',
    cause: 'frontend/src/components/Layout.tsx:148-149 binds F12 shell-wide on non-POS pages; frontend/src/pages/PosBillingPage.tsx:1237 consumes F3 before the shell handler.',
    fix: 'Give page-level handlers precedence with explicit stopPropagation and a documented key map; remove or re-map the conflicting F3 action and align the help sheet.',
    test: 'Keyboard-only test pressing every advertised shortcut asserts the documented destination.',
  },
  {
    id: 'UI-02', sev: 'Medium', type: 'UI', module: 'Layout', group: 'G7',
    title: 'The POS toolbar overflows a 1366x768 screen with no horizontal scroll',
    scenario: 'L1',
    repro: 'Set the window to 1366x768, open /pos and measure controls past the right edge.',
    expected: 'All controls visible or reachable by wrapping/scrolling; no clipped buttons.',
    actual: 'F9 Recall (right 1391), Ctrl+N New Bill (1505) and Ctrl+Shift+C Columns (1662) sit outside the viewport while overflow-x is 0; /purchases, /stock and /bills are clean.',
    evidence: 'evidence/L_layout_1366.json; FINDINGS F45',
    cause: 'POS header/toolbar fixed widths with overflow hidden on a 1366 target.',
    fix: 'Wrap or collapse the secondary actions into a menu at <=1440, or allow horizontal scrolling on that bar.',
    test: 'Layout test at 1366/1920 asserts zero elements beyond the viewport on every route.',
  },
  {
    id: 'UI-03', sev: 'Medium', type: 'UI', module: 'Bills / Empty states', group: 'G7',
    title: 'Bills page shows contradictory counts and blames the cloud for an empty local cache',
    scenario: 'C4, C6',
    repro: 'Open Sales & Bills at QA-A in a fresh browser session.',
    expected: 'One truthful count and an empty state that explains the actual reason.',
    actual: '"0 matching bills (37 in store)" above an empty table, and a panel saying "This store currently has 0 invoices on the cloud server ... Switch to STORE-01".',
    evidence: 'evidence/C_returns.json C04; FINDINGS F46',
    cause: 'frontend/src/lib/billing/invoiceManagementService.ts listInvoices reads local SQLite only while the header/count and cloud panel use different sources.',
    fix: 'Derive count and list from one query; when the source is local and empty, say so (or fall back to the server list), and never suggest switching store.',
    test: 'Empty-local and populated-server states render consistent copy; no contradictory numbers.',
  },
  {
    id: 'UI-04', sev: 'Medium', type: 'Performance', module: 'Network / Privacy', group: 'G7',
    title: 'First paint contacts production hosts; duplicate requests and license polling inflate the network',
    scenario: 'L5',
    repro: 'Capture requests during a cold start with the test backend configured.',
    expected: 'Only the configured backend is contacted; one request per resource.',
    actual: 'Calls to api.lamstonehealthcare.com update feed, GitHub releases latest.json and api.ipify.org; /api/branches and heartbeat duplicated; /api/license/check 8-10x per screen; every API call prefixed by OPTIONS; each invoice save also POSTs /api/settings.',
    evidence: 'FINDINGS F12, F17, F23; evidence/B_money.json write log',
    cause: 'frontend/src/lib/updater/autoUpdateService.ts and env defaults hardcode public hosts; no request de-duplication/throttle.',
    fix: 'Gate all update/geo calls on the configured environment, dedupe in-flight GETs, throttle license checks, and stop writing settings on every invoice.',
    test: 'Cold-start request log contains no non-configured host and no duplicate GET.',
  },
  {
    id: 'ADM-01', sev: 'High', type: 'Data', module: 'Bootstrap', group: 'G8',
    title: 'A fresh install cannot be seeded: db:seed aborts writing purchases.notes',
    scenario: '— (admin bootstrap, outside the POS catalogue)',
    repro: 'Run php artisan db:seed against an empty database.',
    expected: 'Seed completes and creates master data.',
    actual: 'Aborts: the sync-actual command writes a notes column that does not exist on purchases.',
    evidence: 'tests/qa/FINDINGS_NOTES.md F13; backend/app/Console/Commands/SyncActualDataCommand.php:387',
    cause: 'Schema drift between the seeder and the purchases table.',
    fix: 'Map notes to the correct column (or add a migration) and add a CI seed smoke test.',
    test: 'Fresh migrate + seed exits 0 and row counts match the fixture.',
  },
  {
    id: 'ADM-02', sev: 'Medium', type: 'Data', module: 'Admin master data', group: 'G8',
    title: 'Creating a party with a null credit_limit returns a 500 constraint error',
    scenario: 'J1–J3, K3 (master-data setup for settings/report scenarios)',
    repro: 'POST /api/admin/parties with credit_limit: null from the customer combobox.',
    expected: '201 with credit_limit 0 (or validation error).',
    actual: '500 NOT NULL constraint failed: parties.credit_limit.',
    evidence: 'tests/qa/FINDINGS_NOTES.md F14; AdminMasterController.php:525-547; CustomerCombobox.tsx:401',
    cause: 'No default coalesce on the server; client sends undefined.',
    fix: 'Default to 0 server-side and send a number from the client.',
    test: 'Create party without credit limit returns 201.',
  },
  {
    id: 'ADM-03', sev: 'High', type: 'Data', module: 'Admin products', group: 'G8',
    title: 'Creating a product returns a 500 for missing store_id; updating uses request->all() with no tenant check',
    scenario: 'J1–J3, K3 (master-data setup for settings/report scenarios)',
    repro: 'POST /api/products without store_id; PUT another store\'s product id.',
    expected: 'Store taken from the token scope; cross-store update rejected.',
    actual: '500 NOT NULL constraint failed: products.store_id; update accepts arbitrary fields.',
    evidence: 'tests/qa/FINDINGS_NOTES.md F15; ProductController.php:27-53',
    cause: 'store_id absent from validation; update bypasses fillable/tenant scope.',
    fix: 'Resolve store from the authenticated scope, validate fields explicitly and scope the update query.',
    test: 'Create without store_id succeeds in own store; cross-store update 403/404.',
  },
  {
    id: 'RPT-04', sev: 'High', type: 'Security', module: 'Dashboard', group: 'G9',
    title: 'Dashboard near-expiry tile counts other stores\' batches',
    scenario: 'K4',
    repro: 'Compare the NEAR EXPIRY (60D) tile at QA-A with its own batch count.',
    expected: 'Tile equals the store\'s own near-expiry batches (9).',
    actual: 'Shows 46 because the metric reads the whole local product_batches table with no store filter (and the local DB really contains other tenants\' rows via SEC-02).',
    evidence: 'evidence/HI_auth_rbac.json (DELTAS-SCOPE: 1506 batches across store_ids 1,2,4,5,6,7,8); FINDINGS F8; frontend/src/lib/dashboard/dashboardMetricsService.ts:249',
    cause: 'Missing store filter in the local aggregation.',
    fix: 'Filter by active store id and, once SEC-02 is closed, the local table cannot contain foreign rows anyway.',
    test: 'Dashboard metrics test with two stores\' rows in the local cache.',
  },
];

const csvHeader = ['ID','Severity','Type','Module','Group','Title','Scenario_IDs','Repro','Expected','Actual','Evidence','Suspected_Cause','Suggested_Fix','Test_To_Add'];
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const csv = [csvHeader.map(esc).join(','), ...D.map((d) => [d.id,d.sev,d.type,d.module,d.group,d.title,d.scenario,d.repro,d.expected,d.actual,d.evidence,`${d.cause} ${d.fix}`,d.fix,d.test].map(esc).join(','))].join('\n') + '\n';
fs.writeFileSync(path.resolve(__dirname, '../../test-reports/defects.csv'), csv);

const byId = Object.fromEntries(D.map((d) => [d.id, d]));
const sevRank = { Critical: 0, High: 1, Medium: 2 };
const md = [];
md.push('# Fix list — LamSuite Billing QA (throwaway environment)');
md.push('');
md.push(`Generated ${new Date().toISOString().slice(0, 10)} from the running defect register (${D.length} defects in ${GROUPS.length} root-cause groups). Every item was reproduced in this environment; evidence files live under \`test-reports/evidence/\`. No application source was modified during testing.`);
md.push('');
md.push('**Severity**: Critical = wrong money, tax or stock, data loss, or security. High = broken workflow, reporting or onboarding. Medium = friction or misleading UI.');
md.push('');
md.push('**Recommended fixing order**: G1 money/tax -> G2 offline save/queue -> G3 stock & payables -> G4 security/tenancy -> G5 returns -> G6 devices/licensing -> G7 UI -> G8 bootstrap/admin -> G9 dashboard. Do not ship G1/G2/G3 until each group’s M1 integrity check passes.');
md.push('');
md.push('## Summary by severity');
md.push('');
const counts = D.reduce((a, d) => ((a[d.sev] = (a[d.sev] || 0) + 1), a), {});
md.push(`| Severity | Count |`);
md.push(`|---|---|`);
for (const s of ['Critical','High','Medium']) md.push(`| ${s} | ${counts[s] || 0} |`);
md.push(`| **Total** | **${D.length}** |`);
md.push('');
md.push('## Summary by module');
md.push('');
md.push('| Module | Defects |');
md.push('|---|---|');
const mods = D.reduce((a, d) => ((a[d.module] = (a[d.module] || []).concat(d.id)), a), {});
for (const [m, ids] of Object.entries(mods)) md.push(`| ${m} | ${ids.join(', ')} |`);
md.push('');

for (const g of GROUPS) {
  md.push(`## ${g.id} — ${g.name}`);
  md.push('');
  md.push(`**Root cause shared by ${g.ids.length} defect(s).** ${g.root}`);
  md.push('');
  md.push('| ID | Sev | Title |');
  md.push('|---|---|---|');
  for (const id of g.ids) { const d = byId[id]; md.push(`| ${d.id} | ${d.sev} | ${d.title} |`); }
  md.push('');
  for (const id of g.ids) {
    const d = byId[id];
    md.push(`### ${d.id} — ${d.title}`);
    md.push('');
    md.push(`- **Severity / type / module**: ${d.sev} / ${d.type} / ${d.module}`);
    md.push(`- **Scenarios**: ${d.scenario}`);
    md.push(`- **Repro**: ${d.repro}`);
    md.push(`- **Expected**: ${d.expected}`);
    md.push(`- **Actual**: ${d.actual}`);
    md.push(`- **Evidence**: ${d.evidence}`);
    md.push(`- **Suspected cause**: ${d.cause}`);
    md.push(`- **Suggested fix**: ${d.fix}`);
    md.push(`- **Test to add**: ${d.test}`);
    md.push('');
  }
  md.push(`### Fix prompt for ${g.id} (plan first)`);
  md.push('');
  md.push('```text');
  md.push(`Plan first, do not edit yet. We are fixing ${g.name} in the LamSuite Billing repo.`);
  md.push(`Defects in scope: ${g.ids.join(', ')}.`);
  md.push(`Root cause: ${g.root}`);
  md.push(`Produce: (1) the exact write path(s) and files you will change, with function names; (2) the invariant that must hold after the fix (e.g. cgst+sgst==tax_total, paid==grand==sum(payments), ledger==batch, no cross-store row); (3) the migration/backfill needed for existing bad rows; (4) the regression tests you will add and the M1 integrity query that must return zero mismatches; (5) risks and rollout order. Wait for approval before editing. Constraints: keep offline-first behaviour, no production URLs or real payment/SMS/email calls, no silent data rewrite without an audit trail.`);
  md.push('```');
  md.push('');
}
fs.writeFileSync(path.resolve(__dirname, '../../test-reports/fix-list.md'), md.join('\n'));
console.log('wrote', D.length, 'defects;', counts);
