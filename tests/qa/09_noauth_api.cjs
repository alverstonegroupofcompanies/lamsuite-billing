/**
 * Group H2 — the public API surface. Requests go out with no token at all, the way any
 * device on a shop's wifi could make them, and every write cleans up after itself so the
 * money and report groups stay unpolluted.
 */
const { sql, saveEvidence, BACKEND } = require('./driver.cjs');
const manifest = require('./manifest.json');

const MARK = 'QA-NOAUTH-PROBE';
async function hit(method, path, body) {
  const res = await fetch(BACKEND + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html error page */ }
  return { method, path, status: res.status, json, bytes: text.length };
}
function ownerSpread(rows) {
  const c = {};
  for (const r of rows || []) { const k = String(r.store_id); c[k] = (c[k] || 0) + 1; }
  return c;
}

(async () => {
  const out = { probes: [], defects: [] };
  const A = manifest.stores['QA-A'], B = manifest.stores['QA-B'];

  // --- 1. every other tenant's catalogue, no credentials ---
  const deltas = await hit('GET', '/api/sync/pull/deltas?store_id=' + A.id + '&since_watermark=0');
  out.probes.push({ probe: 'GET /api/sync/pull/deltas (no auth)', status: deltas.status,
    products_total: (deltas.json.products || []).length, product_store_ids: ownerSpread(deltas.json.products),
    batches_total: (deltas.json.batches || []).length, batch_store_ids: ownerSpread(deltas.json.batches),
    parties_total: (deltas.json.parties || []).length, party_store_ids: ownerSpread(deltas.json.parties),
    settings_keys: deltas.json.settings ? Object.keys(deltas.json.settings).slice(0, 25) : null,
    expected: 'only store ' + A.id + ' rows' });
  if (deltas.status === 200 && Object.keys(ownerSpread(deltas.json.products)).length > 1) {
    out.defects.push({ id: 'NOAUTH-MASTERDATA', severity: 'Critical', type: 'Security', module: 'Sync / Multi-tenancy',
      title: 'Master-data pull is unauthenticated and returns every tenant\'s products, batches, parties and settings',
      expected: 'only the requesting store\'s rows, behind a device token', actual: 'HTTP 200 with ' + (deltas.json.products || []).length + ' products spanning stores ' + Object.keys(ownerSpread(deltas.json.products)).join(','),
      suspected: 'backend/routes/api.php:68 (public group) + SyncController::pullDeltas lines 1009-1012 (no where store_id)' });
  }

  // --- 2. credential hashes for another tenant's staff ---
  const cache = await hit('GET', '/api/staff/offline-cache?store_id=' + B.id);
  const first = (cache.json.staff || [])[0] || {};
  out.probes.push({ probe: 'GET /api/staff/offline-cache (no auth)', status: cache.status,
    staff_returned: (cache.json.staff || []).length,
    sample: { username: first.username, role: first.role, password_hash: first.password_hash, pin_hash: first.pin_hash, permissions: first.permissions } });
  if (cache.status === 200 && first.password_hash) {
    out.defects.push({ id: 'NOAUTH-CREDENTIALS', severity: 'Critical', type: 'Security', module: 'Auth / Staff',
      title: 'Staff offline cache leaks bcrypt password and PIN hashes for any store to an unauthenticated caller',
      expected: 'device-bound, store-scoped response; hashes never leave the server', actual: 'HTTP 200 with password_hash + pin_hash for ' + (cache.json.staff || []).length + ' users of store ' + B.id,
      suspected: 'backend/routes/api.php:56 (public group) + StaffAuthController::offlineCache' });
  }

  // --- 3. another tenant's financial records and settings ---
  for (const [name, path] of [['invoices of store ' + A.id, '/api/invoices?store_id=' + A.id],
                              ['settings of store ' + B.id, '/api/settings?store_id=' + B.id],
                              ['counters of store ' + B.id, '/api/counters?store_id=' + B.id]]) {
    const r = await hit('GET', path);
    out.probes.push({ probe: 'GET ' + path + ' (no auth)', status: r.status, bytes: r.bytes,
      shape: Array.isArray(r.json) ? 'array n=' + r.json.length : (r.json.data ? 'paginated n=' + r.json.data.length : Object.keys(r.json || {}).slice(0, 12)) });
    if (r.status === 200) out.defects.push({ id: 'NOAUTH-READ-' + name.split(' ')[0].toUpperCase(), severity: 'Critical', type: 'Security', module: 'Multi-tenancy',
      title: name + ' readable with no credentials', expected: '401', actual: 'HTTP 200, ' + r.bytes + ' bytes', suspected: 'backend/routes/api.php public group' });
  }
  const guard = await hit('GET', '/api/admin/stores');
  out.probes.push({ probe: 'control: GET /api/admin/stores (no auth)', status: guard.status, note: 'admin group is correctly protected' });

  // --- 4. anonymous WRITE of a financial document, then cross-tenant rewrite ---
  // store 99 does not exist, so the row can only land somewhere by the server's own fallback.
  const victim = 99, thief = 7;
  const invPayload = { external_id: MARK + '-EXT', store_id: victim, invoice_number: MARK + '-INV-1',
    module_key: 'invoice', invoice_date: '2026-11-13', grand_total: 999.99, taxable_subtotal: 999.99,
    tax_total: 0, paid_amount: 999.99, payment_mode: 'Cash', status: 'completed' };
  const w1 = await hit('POST', '/api/sync/push/batch', { items: [{ id: MARK + '_1', entity_type: 'invoice', action: 'create', updated_at: '2026-11-13 00:00:00', payload: invPayload }] });
  const row1 = sql(`select id, store_id, external_id, invoice_number, grand_total, status from invoices where external_id='${MARK}-EXT'`)[0] || null;
  out.probes.push({ probe: 'POST /api/sync/push/batch invoice (no auth, store_id=99)', status: w1.status, response: w1.json, row_after_create: row1,
    expected: '401, or at most a row owned by an authenticated device' });
  out.defects.push({ id: 'NOAUTH-INVOICE-WRITE', severity: 'Critical', type: 'Security', module: 'Sync / Multi-tenancy',
    title: 'An unauthenticated caller can create a completed invoice, and it is silently re-owned to store ' + (row1 && row1.store_id),
    expected: '401 without a device token; the row must belong to the store it claims', actual: row1 ? `row id=${row1.id} store_id=${row1.store_id} grand_total=${row1.grand_total} status=${row1.status}` : 'no row',
    suspected: 'backend/routes/api.php:59 + SyncController::resolveStoreId fallback (lines 27-45)' });

  const w2 = await hit('POST', '/api/sync/push/batch', { items: [{ id: MARK + '_2', entity_type: 'invoice', action: 'update', updated_at: '2026-11-13 00:10:00',
    payload: { ...invPayload, store_id: thief, invoice_number: MARK + '-STOLEN', grand_total: 1.00, paid_amount: 1.00, status: 'cancelled' } }] });
  const row2 = sql(`select id, store_id, invoice_number, grand_total, status from invoices where external_id='${MARK}-EXT'`)[0] || null;
  out.probes.push({ probe: `same external_id re-pushed claiming store_id=${thief}`, status: w2.status, response: w2.json, row_after_rewrite: row2,
    expected: `the second push must not touch the first store's document` });
  if (row1 && row2 && row1.id === row2.id && Number(row2.store_id) === thief) {
    out.defects.push({ id: 'CROSS-TENANT-REWRITE', severity: 'Critical', type: 'Security', module: 'Sync / Multi-tenancy',
      title: 'A push that claims another store mutates and re-owns a different tenant\'s invoice by external_id',
      expected: 'a store-scoped lookup, so the second request creates nothing and changes nothing',
      actual: `invoice id=${row1.id} moved from store ${row1.store_id} to store ${row2.store_id}, number ${row1.invoice_number} -> ${row2.invoice_number}, total ${row1.grand_total} -> ${row2.grand_total}, status ${row1.status} -> ${row2.status}`,
      suspected: 'backend/app/Http/Controllers/Api/SyncController.php:228 "Also check by external_id across stores"' });
  }

  const prod = await hit('POST', '/api/sync/push/products', { store_id: victim, products: [{ id: 999001, barcode: MARK + '-SKU', name: MARK + ' PRODUCT', store_id: victim, sel_rate: 111.11, gst_percent: 12, units_per_pack: 1 }] });
  const prodRow = sql(`select id, store_id, name from products where barcode='${MARK}-SKU'`)[0] || null;
  out.probes.push({ probe: 'POST /api/sync/push/products (no auth, store_id=99)', status: prod.status, response: prod.json, row: prodRow });
  if (prod.status === 200 && prodRow) {
    out.defects.push({ id: 'NOAUTH-PRODUCT-WRITE', severity: 'Critical', type: 'Security', module: 'Sync / Multi-tenancy',
      title: 'Unauthenticated product ingest lands in a real tenant\'s catalogue', expected: '401', actual: `product id=${prodRow.id} store_id=${prodRow.store_id} named ${prodRow.name}`,
      suspected: 'backend/routes/api.php:64 + SyncController::resolveStoreId fallback' });
  }

  // leave the environment as found: remove only the rows this probe created
  sql(`delete from invoice_items where invoice_id in (select id from invoices where external_id='${MARK}-EXT')`);
  sql(`delete from invoice_payments where invoice_id in (select id from invoices where external_id='${MARK}-EXT')`);
  sql(`delete from invoices where external_id='${MARK}-EXT'`);
  sql(`delete from products where barcode='${MARK}-SKU'`);
  out.cleanup = { invoices_left: sqlOneCount(`select count(*) c from invoices where external_id='${MARK}-EXT'`), products_left: sqlOneCount(`select count(*) c from products where barcode='${MARK}-SKU'`) };

  console.log('\n=== DEFECTS ===');
  for (const d of out.defects) console.log(`${d.severity} ${d.id}: ${d.title}`);
  console.log('\ncleanup:', JSON.stringify(out.cleanup));
  saveEvidence('H2_noauth_api.json', out);
})().catch(e => { console.error(e); process.exit(1); });

function sqlOneCount(q) { const r = sql(q); return r.length ? Number(r[0].c) : -1; }
