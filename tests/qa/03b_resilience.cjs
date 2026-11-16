/**
 * Group B (continued) — the save button under real shop conditions.
 * A cashier double-clicks, the network dies mid-save and the server errors out. What must never
 * happen is a duplicated bill, a lost bill, a skipped number or a stock deduction counted twice.
 */
const fs = require('fs');
const path = require('path');
const { openCounter, sleep } = require('./pos_flow.cjs');
const { newBill, addProduct, setQty, readTotals, openCheckout } = require('./pos_ui.cjs');
const { sql, sqlOne, saveEvidence, POS_URL } = require('./driver.cjs');
const { computeInvoice } = require('./tax_oracle.cjs');
const manifest = require('./manifest.json');

const results = { scenarios: [], defects: [] };
function rec(id, title, status, evidence) {
  results.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1600));
}
function def(d) { results.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); }
const p = (v) => Number(v ?? 0).toFixed(2);
const eq = (a, b) => p(a) === p(b);

function storeMeta(store) { return sql(`select * from stores where id=${store.id}`)[0]; }
function nm(storeCode, sku) {
  const pr = manifest.stores[storeCode].products[sku];
  if (!pr) throw new Error(`fixture ${sku} missing in ${storeCode}`);
  return pr.search_name || pr.name;
}
function batches(storeId) {
  const map = {};
  for (const r of sql(`select id, product_id, batch_no, stock_qty from product_batches where store_id=${storeId}`)) map[r.id] = Number(r.stock_qty);
  return map;
}
/** localStorage view of the device's own tables (the browser stand-in for on-device SQLite). */
async function localTable(s, storeId, table) {
  const raw = await s.page.evaluate((store, t) => {
    const exact = `lamsuite_tbl_${store}_${t}`;
    if (localStorage.getItem(exact) != null) return localStorage.getItem(exact);
    const key = Object.keys(localStorage).find(k => k.endsWith(`_${t}`) && k.startsWith('lamsuite_tbl_'));
    return key ? localStorage.getItem(key) : null;
  }, String(storeId), table);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { unparsable: String(raw).slice(0, 300) }; }
}

/** Cart up to (but not including) the save click. */
async function toCheckout(s, storeCode, lines) {
  for (const l of lines) {
    if ((l.loose ?? 0) > 0 && manifest.stores[storeCode].products[l.sku].units_per_pack === 1) {
      return { ok: false, why: 'scenario asks for loose units on a single-unit product', sku: l.sku };
    }
  }
  const shownNumber = await newBill(s);
  const added = [];
  for (const l of lines) {
    const r = await addProduct(s, nm(storeCode, l.sku), {});
    const id = r.ids[r.ids.length - 1];
    if (!id) return { ok: false, why: 'line not added', search: nm(storeCode, l.sku), add: r };
    const q = await setQty(s, id, { packs: l.packs ?? 0, loose: l.loose ?? 0 });
    const stuck = [['pack', q.pack], ['loose', q.loose]]
      .filter(([kind, got]) => got !== 'no-input' && Number(got) !== Number(kind === 'pack' ? l.packs ?? 0 : l.loose ?? 0));
    if (stuck.length) return { ok: false, why: 'quantity did not stick', search: l.sku, qty: q, stuck };
    added.push({ ...l, lineId: id });
  }
  const uiTotals = await readTotals(s);
  await openCheckout(s);
  return { ok: true, shownNumber, added, uiTotals };
}

/** The lines that reached the server must be the lines the cashier keyed in. */
function lineDiffs(added, items) {
  const out = [];
  added.forEach((l, i) => {
    const it = items[i];
    if (!it) { out.push({ field: `line ${i + 1}`, oracle: l.sku, db: 'missing from the server invoice' }); return; }
    if (Number(it.qty) !== Number(l.packs ?? 0)) out.push({ field: `line ${i + 1} packs`, keyed: String(l.packs ?? 0), db: String(it.qty) });
    if (Number(it.loose_qty) !== Number(l.loose ?? 0)) out.push({ field: `line ${i + 1} loose`, keyed: String(l.loose ?? 0), db: String(it.loose_qty) });
  });
  return out;
}

function oracleFor(storeCode, lines) {
  const meta = storeMeta(manifest.stores[storeCode]);
  const prods = manifest.stores[storeCode].products;
  return computeInvoice({
    store: { state_code: meta.state_code, tax_mode: meta.tax_mode, gst_type: meta.gst_type },
    price_basis: 'per_pack',
    lines: lines.map(l => {
      const pr = prods[l.sku];
      return { name: pr.name, packs: l.packs ?? 0, loose_qty: l.loose ?? 0, unit_price: pr.sel_rate, units_per_pack: pr.units_per_pack, gst_percent: pr.gst_percent };
    }),
  });
}

(async () => {
  // ---------- B11: an impatient cashier hits Save twice ----------
  {
    const storeCode = 'QA-A';
    const store = manifest.stores[storeCode];
    const opened = await openCounter(store, store.users.cash, { counterName: 'QA A Money Counter 1', sessionName: 'qaA_money' });
    if (!opened.ok) { rec('B11', 'Double-clicking Save cannot produce two bills', 'BLOCKED', { why: 'counter sign-in failed', detail: opened.detail }); }
    else {
      const s = opened.s;
      const lines = [{ sku: 'QA-DOLO650', packs: 1, loose: 2 }];
      const cart = await toCheckout(s, storeCode, lines);
      if (!cart.ok) { rec('B11', 'Double-clicking Save cannot produce two bills', 'FAIL', cart); await s.close(); }
      else {
        const beforeB = batches(store.id);
        const beforeInv = sqlOne(`select count(*) from invoices where store_id=${store.id}`);
        // two real mouse clicks, 80 ms apart — exactly what a double-click does
        const box = await s.page.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find(x => /Save \(Ctrl\+S\)/i.test((x.innerText || '').trim()));
          if (!b) return null;
          b.setAttribute('id', 'qa-save-btn');
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        if (!box) { rec('B11', 'Double-clicking Save cannot produce two bills', 'BLOCKED', { why: 'no Save button found in the checkout drawer' }); }
        else {
          await s.page.mouse.click(box.x, box.y);
          await sleep(80);
          await s.page.mouse.click(box.x, box.y);
          await sleep(9000);
          await s.screenshot('B11_after_double_save');
          const rows = sql(`select * from invoices where store_id=${store.id} and invoice_number='${cart.shownNumber}'`);
          const anyNew = sql(`select invoice_number from invoices where store_id=${store.id} order by id desc limit 4`);
          const posts = s.postCount('/api/invoices', cart.shownNumber);
          const inv = rows[0] || null;
          const pays = inv ? sql(`select * from invoice_payments where invoice_id=${inv.id}`) : [];
          const afterB = batches(store.id);
          const moved = Object.entries(afterB).filter(([id, q]) => q !== beforeB[id]);
          const units = 1 * manifest.stores[storeCode].products['QA-DOLO650'].units_per_pack + 2;
          const diffs = [];
          if (rows.length !== 1) diffs.push({ field: 'invoice rows for this number', oracle: '1', db: String(rows.length) });
          if (posts !== 1) diffs.push({ field: 'POST /api/invoices for this bill', oracle: '1', db: String(posts) });
          if (sqlOne(`select count(*) from invoices where store_id=${store.id}`) !== Number(beforeInv) + 1) {
            diffs.push({ field: 'total invoice count', oracle: String(Number(beforeInv) + 1), db: String(sqlOne(`select count(*) from invoices where store_id=${store.id}`)) });
          }
          if (pays.length > 1) diffs.push({ field: 'payment rows', oracle: '1 tender line', db: `${pays.length} rows totalling ${p(pays.reduce((a, y) => a + Number(y.amount), 0))}` });
          const droppedUnits = moved.reduce((a, [id, q]) => a + (beforeB[id] - q), 0);
          if (Math.abs(droppedUnits - units) > 1e-6) diffs.push({ field: 'stock units deducted', oracle: String(units), db: String(droppedUnits) });
          rec('B11', 'Double-clicking Save cannot produce two bills', diffs.length ? 'FAIL' : 'PASS', {
            shown_number: cart.shownNumber, rows_with_that_number: rows.length, invoice_posts: posts,
            new_numbers_on_server: anyNew.map(r => r.invoice_number),
            ui_after: (await s.text()).replace(/\n{3,}/g, '\n').slice(-400),
            stock_units_deducted: droppedUnits, oracle_units: units,
            payments: pays.map(y => ({ mode: y.payment_mode, amount: y.amount })),
            writes: (s.apiLog() || []).filter(w => w.m !== 'GET').slice(-6).map(w => ({ m: w.m, u: w.u, s: w.s, resp: (w.resp || '').slice(0, 200) })),
            diffs,
          });
          if (diffs.length) def({ id: 'DUP-SAVE', severity: 'Critical', type: 'Logic', module: 'Billing',
            title: 'A double-click on Save does not produce exactly one bill', diffs, invoice_number: cart.shownNumber });
        }
      }
      await s.close();
    }
  }

  // ---------- B12 / B13: the connection dies at the moment of saving ----------
  {
    const storeCode = 'QA-E';
    const store = manifest.stores[storeCode];
    const meta = storeMeta(store);
    const opened = await openCounter(store, store.users.cash, { counterName: 'QA E Resilience Counter 1', sessionName: 'qaE_resil' });
    if (!opened.ok) {
      for (const [id, t] of [['B12', 'A bill saved while the line drops is queued and later synced once'],
                             ['B13', 'A server error during save does not lose or duplicate the bill']]) {
        rec(id, t, 'BLOCKED', { why: 'counter sign-in failed', detail: opened.detail });
      }
    } else {
      const s = opened.s;

      // --- B12: offline at Save, then back online ---
      const lines12 = [{ sku: 'QA-SANIT', packs: 2, loose: 3 }];
      const cart12 = await toCheckout(s, storeCode, lines12);
      if (!cart12.ok) { rec('B12', 'A bill saved while the line drops is queued and later synced once', 'FAIL', cart12); }
      else {
        const oracle12 = oracleFor(storeCode, lines12).totals;
        const queueBefore = (await localTable(s, store.id, 'sync_queue') || []);
        const queueHolding = (arr, num) => (Array.isArray(arr) ? arr : []).filter(r => JSON.stringify(r).includes(num))
          .map(r => ({ id: r.id, entity_type: r.entity_type, action: r.action, status: r.status, attempts: r.attempt_count ?? r.attempts ?? r.retry_count, payload: JSON.stringify(r.payload || r).slice(0, 260) }));
        const beforeB = batches(store.id);
        s.goOffline();
        await s.clickExact('Save (Ctrl+S)');
        await sleep(8000);
        const offlineText = (await s.text()).replace(/\n{3,}/g, '\n');
        await s.screenshot('B12_saved_offline');
        const serverRowsNow = sql(`select id from invoices where store_id=${store.id} and invoice_number='${cart12.shownNumber}'`);
        const queueAfter = (await localTable(s, store.id, 'sync_queue') || []);
        const localInv = (await localTable(s, store.id, 'invoices') || []);
        const localRow = Array.isArray(localInv) ? localInv.find(r => r && r.invoice_number === cart12.shownNumber) : null;
        const afterBOffline = batches(store.id);
        const offlineDiffs = [];
        if (serverRowsNow.length) offlineDiffs.push({ field: 'server while offline', oracle: 'no row (the line is down)', db: `${serverRowsNow.length} row(s) already stored` });
        if (!queueHolding(queueAfter, cart12.shownNumber).length) offlineDiffs.push({ field: 'device sync queue', oracle: `an entry carrying ${cart12.shownNumber}`, db: `none (queue holds ${queueAfter.length} other items)` });
        if (!localRow) offlineDiffs.push({ field: 'bill visible to the cashier offline', oracle: 'invoice stored on the device', db: 'not in the device invoice table' });
        rec('B12a', 'Offline save: bill is kept on the device and nothing reaches the server',
          offlineDiffs.length ? 'FAIL' : 'PASS', {
          shown_number: cart12.shownNumber, server_rows_while_offline: serverRowsNow.length,
          queue_before: queueBefore.length, queue_after: queueAfter.length,
          local_invoice: localRow && { number: localRow.invoice_number, subtotal: localRow.subtotal, tax: localRow.tax_total, grand: localRow.grand_total, round: localRow.round_off },
          stock_delta_offline: Object.entries(afterBOffline).map(([id, q]) => beforeB[id] - q).filter(d => d !== 0),
          ui_message: (offlineText.match(/[^\n]*(offline|queued|saved|sync)[^\n]*/gi) || []).slice(0, 8),
          dropped: s.dropped().slice(0, 5),
          diffs: offlineDiffs,
        });

        // back online: the queue must push exactly once and the numbers must survive
        s.goOnline();
        await sleep(1500);
        const pill = await s.page.evaluate(() => {
          const el = document.querySelector('[title*="queued for sync"], [title*="Offline Mode"], [title*="Live connected"]');
          return el ? el.getAttribute('title') : null;
        });
        await s.page.evaluate(() => {
          const el = document.querySelector('[title*="queued for sync"]');
          if (el) el.click();
        });
        await sleep(12000);
        const synced = sql(`select * from invoices where store_id=${store.id} and invoice_number='${cart12.shownNumber}'`);
        const syncedItems = synced[0] ? sql(`select * from invoice_items where invoice_id=${synced[0].id}`) : [];
        const syncedPays = synced[0] ? sql(`select * from invoice_payments where invoice_id=${synced[0].id}`) : [];
        const queueEnd = (await localTable(s, store.id, 'sync_queue') || []);
        const diffs = [];
        if (!synced[0]) diffs.push({ field: 'bill reaches the server after reconnect', oracle: '1 row', db: 'never arrived' });
        if (synced.length > 1) diffs.push({ field: 'duplicate rows after reconnect', oracle: '1', db: String(synced.length) });
        const posts12 = s.net.filter(n => n.method === 'POST' && (n.url.includes('/api/invoices') || n.url.includes('/api/sync/push')) && (n.post_data || '').includes(cart12.shownNumber));
        const paidPosts = posts12.filter(n => n.status >= 200 && n.status < 300);
        if (paidPosts.length > 1) diffs.push({ field: 'successful submits of the same bill', oracle: '1', db: String(paidPosts.length) });
        if (synced[0]) {
          diffs.push(...lineDiffs(cart12.added, syncedItems));
          for (const [k, want] of [['taxable_subtotal', oracle12.taxable_subtotal], ['tax_total', oracle12.tax_total], ['round_off', oracle12.round_off], ['grand_total', oracle12.grand_total]]) {
            if (!eq(synced[0][k], want)) diffs.push({ field: `after-sync ${k}`, oracle: p(want), db: p(synced[0][k]) });
          }
          const paid = syncedPays.reduce((a, y) => a + Number(y.amount || 0), 0);
          if (!eq(paid, synced[0].grand_total)) diffs.push({ field: 'after-sync payments vs grand_total', oracle: p(synced[0].grand_total), db: p(paid) });
        }
        const stillQueued = queueHolding(queueEnd, cart12.shownNumber);
        if (stillQueued.length) diffs.push({ field: 'queue drains after a successful push', oracle: 'the bill is removed from the device queue once the server has it', db: `still queued: ${JSON.stringify(stillQueued)}` });
        rec('B12', 'A bill saved while the line drops is queued and later synced once',
          diffs.length ? 'FAIL' : 'PASS', {
          shown_number: cart12.shownNumber, cart_on_screen: cart12.uiTotals, store_tax_mode: meta.tax_mode,
          oracle: { taxable: p(oracle12.taxable_subtotal), tax: p(oracle12.tax_total), round: p(oracle12.round_off), grand: p(oracle12.grand_total) },
          local_offline_row: localRow && { number: localRow.invoice_number, subtotal: localRow.subtotal, tax: localRow.tax_total, grand: localRow.grand_total },
          server_after_sync: synced[0] && { number: synced[0].invoice_number, taxable: p(synced[0].taxable_subtotal), tax: p(synced[0].tax_total), cgst: p(synced[0].cgst_total), sgst: p(synced[0].sgst_total), round: p(synced[0].round_off), grand: p(synced[0].grand_total), status: synced[0].status },
          items: syncedItems.map(i => ({ qty: i.qty, loose: i.loose_qty, rate: i.unit_price, gst: i.gst_percent, taxable: i.taxable_amount, tax: i.tax_amount })),
          payments: syncedPays.map(y => ({ mode: y.payment_mode, amount: y.amount })),
          submit_attempts: posts12.map(n => ({ u: n.url.replace(/https?:\/\/[^/]+/, ''), state: n.state, s: n.status })),
          sync_pill_before_push: pill, queue_before: queueBefore.length, queue_at_offline_save: queueAfter.length, queue_after_reconnect: queueEnd.length,
          ui_message_offline: (offlineText.match(/[^\n]*(offline|queued|saved|sync)[^\n]*/gi) || []).slice(0, 6),
          store_tax_mode_on_server: meta.tax_mode, diffs,
        });
        if (diffs.length) def({ id: 'OFFLINE-SAVE', severity: 'Critical', type: 'Data', module: 'Sync/Billing',
          title: 'A bill written while the connection is lost does not reach the server unchanged', diffs, invoice_number: cart12.shownNumber });
      }

      // --- B13: the server refuses/errors during an online save ---
      const lines13 = [{ sku: 'QA-SANIT', packs: 1, loose: 1 }];
      const cart13 = await toCheckout(s, storeCode, lines13);
      if (!cart13.ok) { rec('B13', 'A server error during save does not lose or duplicate the bill', 'FAIL', cart13); }
      else {
        const beforeB = batches(store.id);
        s.dropUrl('/api/invoices');
        await s.clickExact('Save (Ctrl+S)');
        await sleep(8000);
        s.stopDropping();
        const failedText = (await s.text()).replace(/\n{3,}/g, '\n');
        await s.screenshot('B13_after_server_error');
        const during = sql(`select id from invoices where store_id=${store.id} and invoice_number='${cart13.shownNumber}'`);
        const queueNow = (await localTable(s, store.id, 'sync_queue') || []);
        await sleep(15000);   // give the retry loop a chance
        const after = sql(`select * from invoices where store_id=${store.id} and invoice_number='${cart13.shownNumber}'`);
        const afterB = batches(store.id);
        const units = manifest.stores[storeCode].products['QA-SANIT'].units_per_pack + 1;
        const moved = Object.entries(afterB).reduce((a, [id, q]) => a + (beforeB[id] - q), 0);
        const diffs = [];
        if (!after[0]) diffs.push({ field: 'bill eventually reaches the server', oracle: '1 row after the retry', db: 'absent — the sale is lost' });
        if (after.length > 1) diffs.push({ field: 'duplicate rows', oracle: '1', db: String(after.length) });
        const posts13 = s.net.filter(n => n.method === 'POST' && (n.post_data || '').includes(cart13.shownNumber));
        const ok13 = posts13.filter(n => n.status >= 200 && n.status < 300);
        if (ok13.length > 1) diffs.push({ field: 'successful submits', oracle: '1', db: String(ok13.length) });
        if (after[0]) {
          diffs.push(...lineDiffs(cart13.added, sql(`select * from invoice_items where invoice_id=${after[0].id}`)));
          const pays = sql(`select * from invoice_payments where invoice_id=${after[0].id}`);
          const paid = pays.reduce((a, y) => a + Number(y.amount || 0), 0);
          if (!eq(paid, after[0].grand_total)) diffs.push({ field: 'payments vs grand_total', oracle: p(after[0].grand_total), db: p(paid) });
        }
        if (Math.abs(moved - units) > 1e-6) diffs.push({ field: 'stock units deducted after retry', oracle: String(units), db: String(moved) });
        rec('B13', 'A server error during save does not lose or duplicate the bill', diffs.length ? 'FAIL' : 'PASS', {
          shown_number: cart13.shownNumber, attempts: posts13.map(n => ({ u: n.url.replace(/https?:\/\/[^/]+/, ''), state: n.state, s: n.status })),
          rows_during_failure: during.length, rows_after_retry: after.length, queue_at_failure: queueNow.length,
          cart_on_screen: cart13.uiTotals,
          server_row: after[0] && { number: after[0].invoice_number, taxable: p(after[0].taxable_subtotal), grand: p(after[0].grand_total), tax: p(after[0].tax_total), round: p(after[0].round_off), status: after[0].status },
          server_items: after[0] ? sql(`select product_name,qty,loose_qty,units_per_pack,unit_price,gst_percent,taxable_amount,tax_amount,total_amount from invoice_items where invoice_id=${after[0].id}`) : [],
          stock_units_deducted: moved, oracle_units: units,
          ui_message: (failedText.match(/[^\n]*(error|failed|offline|retry|queued)[^\n]*/gi) || []).slice(0, 8),
          diffs,
        });
        if (diffs.length) def({ id: 'SAVE-RETRY', severity: 'Critical', type: 'Data', module: 'Billing/Sync',
          title: 'A failed save does not recover into exactly one correct bill', diffs, invoice_number: cart13.shownNumber });
      }

      // number series across all three saves: gaps and TEMP numbers are user-visible integrity
      const series = sql(`select invoice_number from invoices where store_id=${store.id} order by id`);
      const nums = series.map(r => r.invoice_number);
      rec('B14', 'The invoice number series stays intact through offline and failed saves',
        nums.some(n => /^TEMP/i.test(n)) ? 'FAIL' : 'CHECK', {
        numbers_on_server: nums, temp_numbers: nums.filter(n => /^TEMP/i.test(n)),
        note: 'a TEMP-* number means the leased block ran out offline and the emergency series leaked into the ledger',
      });
      await s.close();
    }
  }

  saveEvidence('B_resilience.json', results);
  console.log('\nlast invoices:', JSON.stringify(sql('select id,store_id,counter_code,invoice_number,module_key,grand_total,paid_amount,status,created_at from invoices order by id desc limit 8')));
  fs.writeFileSync(path.join(__dirname, 'B_resil_summary.json'), JSON.stringify(results.scenarios.map(x => ({ id: x.id, status: x.status })), null, 1));
})().catch(e => { console.error(e); saveEvidence('B_resilience.json', results); process.exit(1); });
