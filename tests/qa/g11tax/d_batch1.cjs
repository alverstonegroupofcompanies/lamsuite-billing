const { add } = require('./defects.cjs');
add({ id: 'SEC-01', group: 'G1-SEC', title: 'Invoice routes accept anonymous callers: list, read, create (any store, any number) and cancel any invoice', severity: 'Critical', type: 'Security', journey: 'J1',
  steps: '1) No token: GET /api/invoices?store_id=2 ; GET /api/invoices/1. 2) POST /api/invoices {store_id:2, invoice_number:"QA-NOAUTH-1", items:[...]}. 3) POST /api/invoices/1/cancel {reason:"probe"}',
  expected: '401 for every call; cancel needs approval and store scope',
  actual: '200 list/read; 201 invoice id 3 created in store 2 with client number QA-NOAUTH-1 and counter_id 1; 200 cancel of INV-PKD-1001 ("batch stock restored") with no user',
  evidence: 'tests/qa/r3/evidence/SEC_noauth_probe.json, tests/qa/r3/evidence/SEC_noauth_probe2.json',
  cause: 'backend/routes/api.php:173-178 register /invoices, /invoices/{id}, /invoices/{id}/cancel and /invoices/{id}/lock outside any auth middleware (counter.profile only). InvoiceController::resolveStoreId() trusts body/header/query store_id and falls back to Store::first(); InvoiceController::cancel() does Invoice::findOrFail($id) with no store or role check.',
  fix: 'Move these routes inside [counter.auth, counter.profile] (till) or auth:sanctum + scope.store (panel). Derive the store only from the token, scope every findOrFail by store, require approval for cancel.',
  test: 'Feature test that walks Route::getRoutes() and fails for any /api route without an auth middleware unless on an explicit allowlist (claim, login, health, update manifest); anonymous POST /invoices and /invoices/{id}/cancel return 401.' });
add({ id: 'SEC-02', group: 'G1-SEC', title: 'Anonymous POST /api/settings overwrites store settings; GET /api/settings and /api/sync/pull/deltas return any store\'s settings and full catalogue', severity: 'Critical', type: 'Security', journey: 'J11',
  steps: 'No token: GET /api/settings?store_id=2 ; GET /api/sync/pull/deltas?store_id=2 ; POST /api/settings {}',
  expected: '401', actual: '200 with store 2 settings and store 2 products/batches; POST answers "Store settings saved successfully."',
  evidence: 'tests/qa/r3/evidence/SEC_noauth_probe.json, tests/qa/r3/evidence/SEC_noauth_probe2.json',
  cause: 'backend/routes/api.php:89 (/sync/pull/deltas) and :137-139 (/settings) are public; AdminSettingController::update and SyncController::pullDeltas resolve the store from the request.',
  fix: 'Require the device token or an admin token and resolve the store from it.', test: 'Anonymous GET/POST /api/settings and GET /api/sync/pull/deltas return 401.' });
add({ id: 'SEC-03', group: 'G1-SEC', title: 'Anonymous callers can unlock workstations, take invoice locks and read held bills, negative-stock report, WhatsApp config and licence', severity: 'High', type: 'Security', journey: 'J1',
  steps: 'No token: POST /api/device-sessions/1/unlock ; POST /api/invoices/1/lock ; GET /api/held-bills ; GET /api/inventory/negative-stock-report ; GET /api/whatsapp/config',
  expected: '401', actual: '200 "Workstation \'Admin Console\' unlocked."; "Invoice lock acquired by counter C01"; the rest 200 with data. WhatsApp config also exposes a production host (wa-api.alverstone.in).',
  evidence: 'tests/qa/r3/evidence/SEC_noauth_probe.json',
  cause: 'backend/routes/api.php:154-204: device-session, held-bill, whatsapp, negative-stock and lock routes sit outside every auth group; DeviceSessionController::unlock() has no caller check.',
  fix: 'Put them under device.auth or auth:sanctum with store scope.', test: 'Same route-allowlist test as SEC-01.' });
add({ id: 'SET-01', group: 'G6-SETUP', title: 'Store state code and code accept any text (e.g. "3232", "STORE-04QA-PH"); GSTIN state prefix not checked against state code', severity: 'High', type: 'Data', journey: 'J1',
  steps: 'Admin panel > Stores > Add Store Branch: keep the prefilled 32 and type 32 (field shows 3232); save. Or PUT /api/admin/stores/4 {state_code:"32332"}.',
  expected: 'state_code must be a valid 2-digit GST state code (01-38, 97) matching the GSTIN prefix; store code format validated',
  actual: 'Saved state_code 3232 / 32332 and code STORE-04QA-PQA-PH (201/200). Place-of-supply (CGST+SGST vs IGST) is decided from this value.',
  evidence: 'tests/qa/r3/evidence/J1_01_stores.json, tests/qa/r3/evidence/J1_01b_store_edit.json',
  cause: 'backend/app/Http/Controllers/Api/AdminStoreController.php:86 and :147 validate state_code as "required|string|max:10" only.',
  fix: 'Validate state_code with a regex/in-list of GST state codes, require GSTIN[0..1] == state_code when GSTIN is present, validate store code charset.',
  test: 'Feature test: POST /api/admin/stores with state_code 3232 or GSTIN prefix mismatch returns 422.' });
add({ id: 'UI-01', group: 'G8-UI', title: 'Store form State Code field cannot be cleared: it snaps back to "32", so typing a new code appends to it', severity: 'Medium', type: 'UI', journey: 'J1',
  steps: 'Admin panel > Stores > Edit a store; select the State Code text, press Backspace, type 29.',
  expected: 'Field shows 29', actual: 'Field shows 3229 (empty value is replaced by "32" on every render).',
  evidence: 'tests/qa/r3/evidence/J1_01b_store_edit.json', cause: 'admin-panel/src/pages/StoresPage.tsx:450 value={editingStore.state_code || "32"}',
  fix: 'Bind value={editingStore.state_code ?? ""} and apply the default only when the form opens.', test: 'DOM test: clear State Code then type 29 -> value is 29.' });
add({ id: 'SET-02', group: 'G6-SETUP', title: 'Fresh install seed fails: DatabaseSeeder calls data:sync-actual, which imports ../lamsuite_desktop.sqlite and hits UNIQUE(products.store_id, barcode)', severity: 'Low', type: 'Data', journey: 'J1',
  steps: 'cd backend; DB_DATABASE=<new file> php artisan migrate:fresh --seed', expected: 'Seed completes with fake demo data only',
  actual: 'SQLSTATE[23000] UNIQUE constraint failed: products.store_id, products.barcode; the seeder also pulls rows from a local desktop database into the server.',
  evidence: 'tests/qa/r3/seed_fake_only.php (workaround used for this run)', cause: 'backend/database/seeders/DatabaseSeeder.php:616 Artisan::call(\'data:sync-actual\'); backend/app/Console/Commands/SyncActualDataCommand.php:91 reads base_path(\'../lamsuite_desktop.sqlite\').',
  fix: 'Remove the data:sync-actual call from the seeder (make it an explicit opt-in command) and make the import idempotent per (store_id, barcode).', test: 'CI job runs migrate:fresh --seed on an empty sqlite file.' });
console.log('ok');
