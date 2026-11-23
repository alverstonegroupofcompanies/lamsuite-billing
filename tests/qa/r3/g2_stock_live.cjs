/**
 * G2-STOCK live verification: opening stock, transfer identity and short
 * receipts, counter adjustment limits, and the three repair commands. Nothing
 * here is a unit test — every check reads the row the server actually wrote.
 *
 * Run it against its own copy of the throwaway r3 database, never the shared
 * :8000 environment:
 *
 *   cp tests/qa/r3/r3.sqlite /tmp/g2r3.sqlite
 *   (cd backend && DB_DATABASE=/tmp/g2r3.sqlite php artisan migrate --force)
 *   (cd backend/public && DB_DATABASE=/tmp/g2r3.sqlite MAIL_MAILER=log \
 *       PHP_CLI_SERVER_WORKERS=4 php -S 127.0.0.1:8020 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php &)
 *   QA_G2_DB=/tmp/g2r3.sqlite node tests/qa/r3/g2_stock_live.cjs
 *
 * The script stages damage (drift, a phantom batch, a bad mapping) so the
 * repair commands have something to find; that is why it must not run on a
 * database anyone else is using.
 */
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BACKEND = process.env.QA_BACKEND || 'http://127.0.0.1:8020';
const DB = path.resolve(process.env.QA_G2_DB || '/tmp/g2r3.sqlite');
const BACKEND_DIR = path.resolve(__dirname, '../../../backend');

const sql = (q) => {
  const out = execFileSync('sqlite3', ['-json', '-readonly', DB, q], { encoding: 'utf8' }).trim();
  return out ? JSON.parse(out) : [];
};
const write = (q) => execFileSync('sqlite3', [DB, q], { encoding: 'utf8' });
const one = (q) => { const r = sql(q); return r.length ? r[0] : null; };

async function api(method, url, body, o = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  if (o.device) headers['X-Device-Token'] = o.device;
  if (o.store) headers['X-Store-Id'] = String(o.store);
  const res = await fetch(BACKEND + '/api' + url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text };
}

const artisan = (...args) => spawnSync('php', ['artisan', ...args], {
  cwd: BACKEND_DIR,
  encoding: 'utf8',
  env: { ...process.env, DB_DATABASE: DB },
}).stdout;

let pass = 0, fail = 0;
const check = (label, ok, detail) => {
  if (ok) { pass++; console.log('PASS  ' + label + (detail ? '  · ' + detail : '')); }
  else { fail++; console.log('FAIL  ' + label + '  · ' + detail); }
};

(async () => {
  const login = await api('POST', '/login', { email: 'admin@lamstone.in', password: process.env.QA_ADMIN_PASS || 'Qa-Throwaway-2026!' });
  if (!login.json?.token) throw new Error('admin login ' + login.status + ' ' + login.text.slice(0, 200));
  const admin = login.json.token;
  const A = { token: admin };

  // --- fresh counter tokens on the copy ------------------------------------
  const till = async (counterId, storeId, uuid) => {
    let r = await api('POST', `/admin/counters/${counterId}/activation-code`, {}, { token: admin, store: storeId });
    if (r.status !== 200) r = await api('POST', `/admin/counters/${counterId}/reissue`, {}, { token: admin, store: storeId });
    if (r.status !== 200) throw new Error('code issue ' + r.status + ' ' + r.text.slice(0, 200));
    const cl = await api('POST', '/counters/claim', { code: r.json.code, device_uuid: uuid, device_name: 'G2 live verify' });
    if (cl.status !== 200) throw new Error('claim ' + cl.status + ' ' + cl.text.slice(0, 200));
    return { token: cl.json.device_token };
  };
  const PH1 = await till(2, 4, 'g2-live-ph-c01');
  const PH2 = await till(3, 4, 'g2-live-ph-c02');
  const CS1 = await till(4, 5, 'g2-live-cs-c01');
  console.log('counter tokens claimed for QA-PH C01/C02 and QA-CS C01');

  // ============ STK-01 / PRD-01: opening stock through the ledger ==========
  const mk = (name, extra) => api('POST', '/admin/products', {
    store_id: 4, name, barcode: extra.barcode, hsn_sac_code: '30049099', mrp: 40, sel_rate: 36,
    ptr: 28, gst_percent: 12, units_per_pack: 10, allow_loose_sale: true, ...extra.body,
  }, A);

  const opened = await mk('G2 Opening Syrup', {
    barcode: '8909777000011',
    body: { initial_batch: { batch_no: 'G2-A1', expiry_date: '2029-06-30', stock_qty: 40 } },
  });
  const openedId = opened.json?.id;
  check('STK-01 admin product with opening stock returns 201', opened.status === 201, 'HTTP ' + opened.status);
  const pRow = one(`select current_stock from products where id=${openedId}`);
  const bRow = one(`select id,stock_qty,batch_no,expiry_date from product_batches where product_id=${openedId}`);
  const led = sql(`select event_type,qty_delta,balance_after from stock_ledger_entries where product_id=${openedId}`);
  check('STK-01 products.current_stock follows the batch', pRow && Number(pRow.current_stock) === 40, 'product=' + JSON.stringify(pRow));
  check('STK-01 batch holds the 40 units', bRow && Number(bRow.stock_qty) === 40, JSON.stringify(bRow));
  check('STK-01 exactly one OPENING_STOCK ledger row', led.length === 1 && led[0].event_type === 'OPENING_STOCK' && Number(led[0].qty_delta) === 40, JSON.stringify(led));
  check('STK-01 ledger agrees with the batch balance', led.length === 1 && Number(led[0].balance_after) === Number(bRow?.stock_qty), JSON.stringify(led[0] || {}));

  const bare = await mk('G2 Zero Stock Tabs', { barcode: '8909777000028', body: {} });
  const bareBatches = one(`select count(*) n from product_batches where product_id=${bare.json?.id}`);
  check('PRD-01 product created with no stock gets no batch', bare.status === 201 && Number(bareBatches.n) === 0, JSON.stringify(bareBatches));
  const zeroBatch = await mk('G2 Zero Initial', { barcode: '8909777000035', body: { initial_batch: { batch_no: '', expiry_date: '', stock_qty: 0 } } });
  const zeroBatches = one(`select count(*) n from product_batches where product_id=${zeroBatch.json?.id}`);
  check('PRD-01 a zero-quantity initial_batch is ignored', Number(zeroBatches.n) === 0, JSON.stringify(zeroBatches));
  const noExpiry = await mk('G2 Missing Expiry', { barcode: '8909777000042', body: { initial_batch: { stock_qty: 10 } } });
  check('PRD-01 opening stock without batch no/expiry is refused', noExpiry.status === 422, 'HTTP ' + noExpiry.status + ' ' + noExpiry.text.slice(0, 120));

  // ============ STK-02: a barcode is not an identity =======================
  const staleMap = one(`select id from transfer_product_mappings where source_product_id=5 and dest_product_id=8`);
  const dispatch1 = await api('POST', '/stock/transfers', {
    store_id: 4, to_store_id: 5, notes: 'G2 identity probe',
    lines: [{ product_id: 5, batch_no: 'PA-NEW', qty: 10 }],
  }, { token: PH1.token, device: PH1.token });
  const tr1 = dispatch1.json?.transfer || dispatch1.json?.data || dispatch1.json;
  const tr1Id = tr1 && (tr1.id || tr1.transfer_id);
  check('STK-02 dispatch from QA-PH succeeds', dispatch1.status === 201 && !!tr1Id, 'HTTP ' + dispatch1.status + ' ' + dispatch1.text.slice(0, 160));
  const faceBefore = Number(one(`select coalesce(sum(stock_qty),0) s from product_batches where product_id=8`).s);
  const naiveReceive = await api('POST', `/stock/transfers/${tr1Id}/receive`, { store_id: 5, lines: [] }, { token: CS1.token, device: CS1.token });
  check('STK-02 receive refuses to reuse the barcode mapping QA left behind', naiveReceive.status === 422, 'HTTP ' + naiveReceive.status + ' (stale mapping id ' + (staleMap && staleMap.id) + ')');
  check('STK-02 the refusal names both products and the disagreeing facts',
    /QA Glow Face Cream/.test(naiveReceive.text) && /QA Paracet/.test(naiveReceive.text) && /HSN/.test(naiveReceive.text),
    naiveReceive.text.slice(0, 260).replace(/\s+/g, ' '));
  // A refused receipt rolls back as a whole, so the stale row is still there; it just
  // never wins again. stock:audit-transfer-mappings (below) is what deletes it.
  check('STK-02 the bad memory loses its vote and waits for the mapping audit',
    naiveReceive.status === 422 && /attributes_differ/.test(naiveReceive.text), naiveReceive.text.slice(0, 200).replace(/\s+/g, ' '));
  const faceAfter = Number(one(`select coalesce(sum(stock_qty),0) s from product_batches where product_id=8`).s);
  check('STK-02 no stock was credited to the wrong product', faceBefore === faceAfter, `${faceBefore} -> ${faceAfter}`);

  const csParacet = await mk('G2 Paracet CS', { barcode: '8909777000073', body: { store_id: 5 } });
  const chosen = csParacet.json?.id;
  const items1 = sql(`select id,qty from stock_transfer_items where stock_transfer_id=${tr1Id}`);
  const manualReceive = await api('POST', `/stock/transfers/${tr1Id}/receive`, {
    store_id: 5, lines: [{ item_id: items1[0].id, dest_product_id: chosen }],
  }, { token: CS1.token, device: CS1.token });
  const chosenStock = Number(one(`select coalesce(current_stock,0) s from products where id=${chosen}`).s);
  check('STK-02 the receiver can pick the right product', manualReceive.status === 200 && chosenStock === 10, 'HTTP ' + manualReceive.status + ' stock ' + chosenStock + ' ' + manualReceive.text.slice(0, 160));
  const map1 = one(`select matched_by,dest_product_id from transfer_product_mappings where source_product_id=5`);
  check('STK-02 the chosen pair is what gets remembered', map1 && map1.matched_by === 'manual' && Number(map1.dest_product_id) === chosen, JSON.stringify(map1));

  const dispatchAuto = await api('POST', '/stock/transfers', {
    store_id: 4, to_store_id: 5, notes: 'G2 auto-create probe',
    lines: [{ product_id: 6, batch_no: 'CS-A1', qty: 12 }],
  }, { token: PH1.token, device: PH1.token });
  const trAuto = dispatchAuto.json?.transfer || dispatchAuto.json?.data || dispatchAuto.json;
  const autoReceive = await api('POST', `/stock/transfers/${trAuto?.id || trAuto?.transfer_id}/receive`, { store_id: 5, auto_create: true }, { token: CS1.token, device: CS1.token });
  check('STK-02 auto-create works when the barcode is free in the destination', autoReceive.status === 200, 'HTTP ' + autoReceive.status + ' ' + autoReceive.text.slice(0, 200));
  const copied = sql(`select id,name,barcode,hsn_sac_code,units_per_pack,current_stock from products where store_id=5 and barcode='8909000000028'`);
  check('STK-02 the copy carries the sending product facts',
    copied.length === 1 && copied[0].hsn_sac_code === '30049011' && Number(copied[0].current_stock) === 12, JSON.stringify(copied));

  // ============ STK-03: short receipt ======================================
  const dispatch2 = await api('POST', '/stock/transfers', {
    store_id: 4, to_store_id: 5, notes: 'G2 short receipt probe',
    lines: [{ product_id: 6, batch_no: 'CS-A1', qty: 12 }],
  }, { token: PH1.token, device: PH1.token });
  const tr2 = dispatch2.json?.transfer || dispatch2.json?.data || dispatch2.json;
  const tr2Id = tr2 && (tr2.id || tr2.transfer_id);
  const items2 = sql(`select id,qty from stock_transfer_items where stock_transfer_id=${tr2Id}`);
  const csBefore = Number(one(`select coalesce(sum(b.stock_qty),0) s from product_batches b join products p on p.id=b.product_id where p.store_id=5 and p.barcode='8909000000028'`).s);
  const shortReceive = await api('POST', `/stock/transfers/${tr2Id}/receive`, {
    store_id: 5,
    lines: [{ item_id: items2[0].id, received_qty: 7, shortage_reason: 'G2: five bottles crushed in transit' }],
  }, { token: CS1.token, device: CS1.token });
  check('STK-03 short receipt is accepted', shortReceive.status === 200, 'HTTP ' + shortReceive.status + ' ' + shortReceive.text.slice(0, 200));
  const csAfter = Number(one(`select coalesce(sum(b.stock_qty),0) s from product_batches b join products p on p.id=b.product_id where p.store_id=5 and p.barcode='8909000000028'`).s);
  check('STK-03 only the 7 received units land at the destination', csAfter - csBefore === 7, `${csBefore} -> ${csAfter}`);
  const itemRow = one(`select qty,received_qty,short_qty,shortage_reason from stock_transfer_items where id=${items2[0].id}`);
  check('STK-03 the shortage is recorded on the line', itemRow && Number(itemRow.received_qty) === 7 && Number(itemRow.short_qty) === 5, JSON.stringify(itemRow));
  const inLedger = sql(`select product_id,qty_delta,event_type from stock_ledger_entries where event_type='TRANSFER_IN' and reference_id=(select transfer_number from stock_transfers where id=${tr2Id})`);
  check('STK-03 the ledger movement is +7 not +12', inLedger.length === 1 && Number(inLedger[0].qty_delta) === 7, JSON.stringify(inLedger));

  // ============ ADJ-01: the limits bind the counter, not a person ==========
  const docFrom = Number(one(`select coalesce(max(id),0) m from stock_adjustment_documents`).m);
  const pol1 = await api('PUT', '/admin/stock-adjustments/policy', {
    store_id: 4, approval_threshold_qty: 100, max_documents_per_day: 2, max_units_per_day: null, require_notes: true, allow_negative_stock: false,
  }, A);
  check('ADJ-01 policy with a 2-document day is saved', pol1.status === 200, 'HTTP ' + pol1.status + ' ' + pol1.text.slice(0, 160));
  const adj = (tillCreds, qty, notes) => api('POST', '/stock/adjustments', {
    store_id: 4, mode: 'adjustment', reason: 'Damage', notes: notes || 'G2 probe',
    lines: [{ product_id: 5, batch_id: 11, batch_no: 'PA-NEW', adjustment_qty: qty, unit_cost: 4 }],
  }, { token: tillCreds.token, device: tillCreds.token });
  const d1 = await adj(PH1, -1), d2 = await adj(PH1, -1), d3 = await adj(PH1, -1);
  check('ADJ-01 the first two documents on C01 post', d1.status === 201 && d2.status === 201, `${d1.status}/${d2.status}`);
  check('ADJ-01 the third document on the same counter is refused', d3.status === 422 && /Daily stock adjustment limit reached \(2 of 2/.test(d3.text), d3.status + ' ' + d3.text.slice(0, 200));
  const other = await adj(PH2, -1);
  check('ADJ-01 the limit is per counter, so C02 still gets its two', other.status === 201, other.status + ' ' + other.text.slice(0, 200));

  const pol2 = await api('PUT', '/admin/stock-adjustments/policy', {
    store_id: 5, approval_threshold_qty: 100, max_documents_per_day: null, max_units_per_day: 10, require_notes: true, allow_negative_stock: false,
  }, A);
  check('ADJ-01 policy accepts a units-per-day cap', pol2.status === 200, 'HTTP ' + pol2.status + ' ' + pol2.text.slice(0, 160));
  const csAdj = (qty) => api('POST', '/stock/adjustments', {
    store_id: 5, mode: 'adjustment', reason: 'Damage', notes: 'G2 units probe',
    lines: [{ product_id: 9, batch_id: 10, batch_no: 'LP-01', adjustment_qty: qty, unit_cost: 4 }],
  }, { token: CS1.token, device: CS1.token });
  const u1 = await csAdj(-6), u2 = await csAdj(-6);
  check('ADJ-01 the first 6-unit document posts under a 10-unit day', u1.status === 201, u1.status + ' ' + u1.text.slice(0, 160));
  check('ADJ-01 the document that would reach 12 units is refused', u2.status === 422 && /units/.test(u2.text), u2.status + ' ' + u2.text.slice(0, 220));
  const docCols = sql('select id,store_id,counter_id,created_by,total_qty,status from stock_adjustment_documents where id>' + docFrom + ' order by id');
  check('ADJ-01 the posting counter is stored on the document', docCols.length >= 4 && docCols.every((d) => d.counter_id !== null), JSON.stringify(docCols));

  // ============ backfills against the damage still in this database =======
  // stage STK-01 damage on the product the API just created
  write(`update products set current_stock=0 where id=${openedId}; delete from stock_ledger_entries where product_id=${openedId};`);
  let out = artisan('stock:backfill-opening');
  check('BACKFILL opening dry run finds the drift and writes nothing',
    /Dry run: \d+ product\(s\) would change/.test(out) && /G2 Opening Syrup/.test(out)
    && Number(one(`select current_stock from products where id=${openedId}`).current_stock) === 0
    && Number(one(`select count(*) n from stock_ledger_entries where product_id=${openedId}`).n) === 0,
    out.split('\n').filter((l) => /Dry run|G2 Opening/.test(l)).join(' | ').slice(0, 220));
  out = artisan('stock:backfill-opening', '--apply');
  const fixed = one(`select current_stock from products where id=${openedId}`);
  const fixedLedger = sql(`select event_type,qty_delta,balance_after,idempotency_key from stock_ledger_entries where product_id=${openedId}`);
  check('BACKFILL opening --apply restores stock and posts the missing row',
    /Reconciled \d+ product/.test(out) && Number(fixed.current_stock) === 40 && fixedLedger.length === 1 && fixedLedger[0].event_type === 'OPENING_STOCK',
    JSON.stringify(fixed) + ' ' + JSON.stringify(fixedLedger));
  out = artisan('stock:backfill-opening', '--apply');
  check('BACKFILL opening is idempotent', /Nothing to backfill/.test(out) && Number(one(`select count(*) n from stock_ledger_entries where product_id=${openedId}`).n) === 1, out.split('\n')[0]);

  // stage PRD-01 phantom: B1, zero stock, expiry = today + 1 year
  const phantomHost = await mk('G2 Phantom Host', { barcode: '8909777000059', body: {} });
  write(`insert into product_batches (store_id,product_id,batch_no,expiry_date,stock_qty,mrp,selling_rate,version,created_at,updated_at)
         values (4,${phantomHost.json.id},'B1',date('now','+1 year'),0,40,36,1,datetime('now'),datetime('now'));`);
  // a B1 the owner typed with a real expiry, and a B1 that still holds stock
  write(`insert into product_batches (store_id,product_id,batch_no,expiry_date,stock_qty,mrp,selling_rate,version,created_at,updated_at)
         values (5,8,'B1','2029-06-30',0,40,36,1,datetime('now'),datetime('now'));`);
  const typedSurvivor = one(`select id from product_batches where product_id=8 and batch_no='B1' and expiry_date='2029-06-30'`);
  out = artisan('stock:prune-phantom-batches');
  check('BACKFILL prune dry run lists the phantoms and deletes nothing',
    /Dry run: \d+ phantom batch\(es\) would be deleted/.test(out) && /\| 6 /.test(out) && /\| 9 /.test(out)
    && Number(one(`select count(*) n from product_batches where product_id=${phantomHost.json.id}`).n) === 1,
    out.split('\n').filter((l) => /Dry run|B1/.test(l)).join(' | ').slice(0, 300));
  out = artisan('stock:prune-phantom-batches', '--apply');
  check('BACKFILL prune --apply removes the phantoms PRD-01 wrote',
    Number(one(`select count(*) n from product_batches where product_id=${phantomHost.json.id}`).n) === 0
    && !one(`select id from product_batches where id in (6,9)`),
    out.split('\n').filter((l) => /Deleted/.test(l)).join(' | ').slice(0, 200));
  check('BACKFILL prune leaves a B1 whose expiry an owner typed',
    !!one(`select id from product_batches where id=${typedSurvivor.id}`), 'batch ' + typedSurvivor.id);
  check('BACKFILL prune leaves a B1 that holds stock and history',
    !!one(`select id from product_batches where id=8`), JSON.stringify(one(`select id,batch_no,stock_qty from product_batches where id=8`)));

  // stage an STK-02 mapping that pairs two different articles
  write(`insert into transfer_product_mappings (from_store_id,to_store_id,source_product_id,dest_product_id,matched_by,created_at,updated_at)
         values (4,5,7,8,'barcode',datetime('now'),datetime('now'));`);
  const faceLedgerBefore = Number(one(`select count(*) n from stock_ledger_entries where product_id=8`).n);
  out = artisan('stock:audit-transfer-mappings');
  check('AUDIT mappings reports the barcode pair that disagrees',
    /QA Glow Face Cream/.test(out) && /HSN\/SAC 30049099 vs 33049910/.test(out) && /Dry run/.test(out),
    out.split('\n').filter((l) => /Face Cream|Dry run/.test(l)).join(' | ').slice(0, 300));
  out = artisan('stock:audit-transfer-mappings', '--delete-mappings');
  const faceLedgerAfter = Number(one(`select count(*) n from stock_ledger_entries where product_id=8`).n);
  check('AUDIT mappings --delete-mappings forgets it and keeps the stock where it is',
    !one(`select id from transfer_product_mappings where dest_product_id=8`) && faceLedgerAfter === faceLedgerBefore,
    'mappings to product 8: ' + (one(`select count(*) n from transfer_product_mappings where dest_product_id=8`) || {}).n + ', ledger rows ' + faceLedgerBefore + ' -> ' + faceLedgerAfter);  const goodMap = sql('select id,source_product_id,dest_product_id,matched_by from transfer_product_mappings');
  check('AUDIT mappings leaves the mappings that agree', goodMap.every((m) => Number(m.dest_product_id) !== 8), JSON.stringify(goodMap));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
