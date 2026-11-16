/**
 * Which submit path does a workstation use, and does a single dropout change it for good?
 * A fresh counter, a healthy bill, one failed save, then a bill with the network fully restored.
 * The path each bill travels decides who computes the GST, so this pins down the blast radius of
 * one lost connection in the middle of a trading day.
 */
const fs = require('fs');
const path = require('path');
const { openCounter, sleep } = require('./pos_flow.cjs');
const { newBill, addProduct, setQty, readTotals, openCheckout } = require('./pos_ui.cjs');
const { sql, saveEvidence } = require('./driver.cjs');
const manifest = require('./manifest.json');

const results = { scenarios: [], defects: [] };
const p = (v) => Number(v ?? 0).toFixed(2);

function whichPath(s, number) {
  const posts = s.net.filter(n => n.method === 'POST' && (n.post_data || '').includes(number));
  const invoices = posts.filter(n => n.url.includes('/api/invoices'));
  const pushes = posts.filter(n => n.url.includes('/api/sync/push'));
  return { endpoints: posts.map(n => ({ u: n.url.replace(/https?:\/\/[^/]+/, ''), state: n.state, status: n.status })),
           authoritative: invoices.length, queued: pushes.length };
}

(async () => {
  const storeCode = 'QA-E';
  const store = manifest.stores[storeCode];
  const opened = await openCounter(store, store.users.cash, { counterName: 'QA E Path Counter 1', sessionName: 'qaE_path' });
  if (!opened.ok) { results.scenarios.push({ id: 'B15', title: 'submit path after a dropout', status: 'BLOCKED', evidence: opened.detail }); saveEvidence('B_submit_path.json', results); process.exit(0); }
  const s = opened.s;

  const bill = async (sku, packs, loose) => {
    const shownNumber = await newBill(s);
    const pr = manifest.stores[storeCode].products[sku];
    const search = pr.search_name || pr.name;
    const r = await addProduct(s, search, {});
    const id = r.ids[r.ids.length - 1];
    if (!id) return { ok: false, why: 'line not added', search };
    await setQty(s, id, { packs, loose });
    const ui = await readTotals(s);
    await openCheckout(s);
    await s.clickExact('Save (Ctrl+S)');
    await sleep(9000);
    const db = sql(`select * from invoices where store_id=${store.id} and invoice_number='${shownNumber}'`)[0] || null;
    const items = db ? sql(`select qty,loose_qty,units_per_pack,unit_price,gst_percent,taxable_amount,tax_amount,total_amount from invoice_items where invoice_id=${db.id}`) : [];
    return { ok: !!db, shownNumber, ui,
      path: whichPath(s, shownNumber),
      server: db && { taxable: p(db.taxable_subtotal), tax: p(db.tax_total), cgst: p(db.cgst_total), sgst: p(db.sgst_total), round: p(db.round_off), grand: p(db.grand_total) },
      items,
      payments: db ? sql(`select payment_mode,amount from invoice_payments where invoice_id=${db.id}`) : [] };
  };

  const out = {};
  // 1. healthy network
  out.normal = await bill('QA-SANIT', 1, 1);
  // 2. the authoritative endpoint dies for this one save
  s.dropUrl('/api/invoices');
  out.during_outage = await bill('QA-SANIT', 2, 0);
  s.stopDropping();
  await sleep(4000);
  // 3. network fully restored: which path does the next customer's bill take?
  out.after_restore = await bill('QA-SANIT', 1, 3);

  const rows = [out.normal, out.during_outage, out.after_restore];
  const labels = ['healthy network', 'POST /api/invoices blocked', 'network restored'];
  labels.forEach((l, i) => console.log(`\n--- ${l}: ${rows[i].shownNumber}`));
  console.log(JSON.stringify(rows.map((r, i) => ({ case: labels[i], number: r.shownNumber, screen: r.ui && { taxable: r.ui.subtotal, tax: r.ui.gst_tax, round: r.ui.round_off, payable: r.ui.net_payable }, path: r.path, server: r.server, items: r.items, payments: r.payments })), null, 1));

  const diffs = [];
  if (out.normal.path && out.normal.path.authoritative !== 1) diffs.push({ field: 'healthy save', oracle: '1 POST /api/invoices', db: JSON.stringify(out.normal.path) });
  if (out.after_restore.path && out.after_restore.path.authoritative < 1) diffs.push({ field: 'save after the line is restored', oracle: 'back on the authoritative POST /api/invoices path', db: `travelled ${JSON.stringify(out.after_restore.path.endpoints.map(e => e.u))} instead` });
  if (out.after_restore.server && out.after_restore.ui && p(out.after_restore.server.tax) !== p(Number(out.after_restore.ui.gst_tax || 0))) {
    diffs.push({ field: 'GST booked after restore', screen: out.after_restore.ui.gst_tax, db: out.after_restore.server.tax });
  }
  const status = diffs.length ? 'FAIL' : 'PASS';
  results.scenarios.push({ id: 'B15', title: 'One lost connection must not move a workstation off the authoritative submit path for the rest of the day',
    status, evidence: { cases: labels.map((l, i) => ({ case: l, ...rows[i] })), diffs } });
  console.log(`\n[${status}] B15 — one lost connection must not permanently change the submit path`);
  if (diffs.length) {
    console.log('     ' + JSON.stringify(diffs));
    results.defects.push({ id: 'STICKY-OFFLINE', severity: 'Critical', type: 'Logic', module: 'Billing/Sync',
      title: 'After a single failed save the workstation keeps submitting every later bill through the offline sync queue, where the server re-derives GST at a hardcoded 12%',
      expected: 'once the connection is back the counter must use POST /api/invoices again, the same path as a healthy workstation',
      actual: { after_restore_path: out.after_restore.path, screen_tax: out.after_restore.ui && out.after_restore.ui.gst_tax, booked_tax: out.after_restore.server && out.after_restore.server.tax },
      suspected: 'frontend/src/lib/sync/onlineTransactionService.ts:434 sets connectionState="offline" on any submit failure and only :378/:414 can put it back' });
  }
  saveEvidence('B_submit_path.json', results);
  fs.writeFileSync(path.join(__dirname, 'B_path_summary.json'), JSON.stringify(results.scenarios.map(x => ({ id: x.id, status: x.status })), null, 1));
  await s.close();
})().catch(e => { console.error(e); saveEvidence('B_submit_path.json', results); process.exit(1); });
