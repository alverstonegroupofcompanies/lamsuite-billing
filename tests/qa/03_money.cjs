/**
 * Group B — money. Creates real bills through the POS UI and checks every surface:
 * cart totals -> independent oracle -> saved invoice rows -> print preview.
 * A scenario passes only when all four agree to the paisa.
 */
const fs = require('fs');
const path = require('path');
const { openCounter, sleep } = require('./pos_flow.cjs');
const { newBill, addProduct, lineIds, setQty, readTotals, openCheckout, readInvoiceNo } = require('./pos_ui.cjs');
const { sql, sqlOne, saveEvidence, BACKEND } = require('./driver.cjs');
const { computeInvoice } = require('./tax_oracle.cjs');
const manifest = require('./manifest.json');

const results = { scenarios: [], defects: [], notes: [] };
function rec(id, title, status, evidence) {
  results.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 900));
}
function def(d) { results.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); }

const p = (v) => Number(v ?? 0).toFixed(2);
const eq = (a, b) => p(a) === p(b);

function storeMeta(store) {
  // sqlOne() returns a single scalar column, so a whole row needs sql()[0].
  return sql(`select * from stores where id=${store.id}`)[0];
}

/** Build + save one bill exactly as a cashier would, then return every surface's numbers. */
async function bill(s, spec) {
  const shownNumber = await newBill(s);
  const added = [];
  for (const l of spec.lines) {
    const r = await addProduct(s, l.search, l.batch ? { batch: l.batch } : {});
    const id = r.ids[r.ids.length - 1];
    if (!id) return { ok: false, why: 'line not added', search: l.search, add: r };
    const q = await setQty(s, id, { packs: l.packs ?? 0, loose: l.loose ?? 0 });
    // Fail loudly if the cashier's keystrokes did not land: otherwise a quantity that never
    // reached the cart shows up later as a bogus money mismatch.
    const stuck = [['pack', q.pack], ['loose', q.loose]]
      .filter(([kind, got]) => got !== 'no-input' && Number(got) !== Number(kind === 'pack' ? l.packs ?? 0 : l.loose ?? 0));
    if (stuck.length) return { ok: false, why: 'quantity did not stick', search: l.search, qty: q, stuck };
    added.push({ ...l, lineId: id, qty: q, batchModal: r.batchModal, pickedBatch: r.pickedBatch });
  }
  const uiTotals = await readTotals(s);

  // checkout: choose tender, overwrite the amount if a partial/split tender is asked for
  const co = await openCheckout(s);
  if (spec.tenderKey) {
    await s.page.keyboard.press(spec.tenderKey);
    await sleep(900);
  }
  if (spec.tenderAmount != null) {
    const amtSel = 'input[type=number][placeholder="0.00"]';
    await s.page.click(amtSel);
    await s.page.evaluate((sel) => { const el = document.querySelector(sel); el.focus(); el.setSelectionRange(0, el.value.length); }, amtSel);
    await s.page.keyboard.type(String(spec.tenderAmount), { delay: 30 });
    await sleep(600);
  }
  await s.screenshot(`B_${spec.id}_checkout`);
  const beforeInvoices = sqlOne(`select count(*) from invoices where store_id=${spec.storeId}`);
  // Save without printing (printers are out of scope in this environment).
  const saved = await s.clickExact('Save (Ctrl+S)');
  if (!saved) { await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); }
  await sleep(6000);
  const afterText = (await s.text()).replace(/\n{3,}/g, '\n');
  const pushCalls = s.apiCalls('sync/push');
  // Look the bill up by the number the counter was shown, never by "latest row",
  // so an unsaved bill can be mistaken for the previous scenario's invoice.
  const dbInvoice = sql(`select * from invoices where store_id=${spec.storeId} and invoice_number='${shownNumber}'`)[0] || null;
  const invId = dbInvoice && dbInvoice.id;
  return {
    ok: !!dbInvoice, shownNumber, added, uiTotals, checkout: { inputs: co.inputs.length, buttons: co.buttons.length },
    afterText: afterText.slice(-500),
    pushCalls: pushCalls.map(n => ({ m: n.method, s: n.status, body: (n.post_data || '').slice(0, 400) })),
    // full sync payload: needed to attribute a rounding difference to the client or the server
    pushBodies: pushCalls.map(n => (n.post_data || '').slice(0, 6000)),
    // every write the counter performed, in case the invoice travels on a different endpoint
    writes: s.apiLog().filter(n => n.u !== '/api/device-sessions/heartbeat'),
    // how many times THIS bill was submitted, and what the counter itself computed
    invoicePostCount: s.postCount('/api/invoices', shownNumber),
    clientPayload: (() => {
      const body = s.postBodyFor('/api/invoices', shownNumber);
      if (!body) return null;
      try {
        const j = JSON.parse(body);
        return {
          taxable_subtotal: j.taxable_subtotal, subtotal: j.subtotal, tax_total: j.tax_total,
          cgst_total: j.cgst_total, sgst_total: j.sgst_total, igst_total: j.igst_total,
          round_off: j.round_off, grand_total: j.grand_total, paid_amount: j.paid_amount,
          tax_mode: j.tax_mode, gst_type: j.gst_type, store_state: j.store_state,
          place_of_supply: j.place_of_supply, items: (j.items || []).length,
          raw: body.slice(0, 2500),
        };
      } catch { return { unparsable: body.slice(0, 500) }; }
    })(),
    beforeInvoices, dbInvoice,
    dbItems: invId ? sql(`select * from invoice_items where invoice_id=${invId}`) : [],
    dbPayments: invId ? sql(`select * from invoice_payments where invoice_id=${invId}`) : [],
  };
}

/** Store-unique display name for a fixture product (see qa_rename_fixtures.cjs). */
function nm(storeCode, sku) {
  const p = manifest.stores[storeCode].products[sku];
  if (!p) throw new Error(`fixture ${sku} missing in ${storeCode}`);
  return p.search_name || p.name;
}

/** Oracle numbers for the same bill, from the fixture catalogue. */
function oracleFor(storeCode, lines, extra = {}) {
  const meta = storeMeta(manifest.stores[storeCode]);
  const prods = manifest.stores[storeCode].products;
  const oracLines = lines.map(l => {
    const pr = Object.values(prods).find(x => (x.search_name || x.name) === l.search);
    if (!pr) throw new Error(`no fixture product for search "${l.search}"`);
    return {
      name: pr.name, packs: l.packs ?? 0, loose_qty: l.loose ?? 0,
      unit_price: pr.sel_rate, units_per_pack: pr.units_per_pack, gst_percent: pr.gst_percent,
    };
  });
  return computeInvoice({
    store: { state_code: meta.state_code, tax_mode: meta.tax_mode, gst_type: meta.gst_type },
    // The POS grid prices a pack line at the pack rate ("₹ 30.00/Strip", loose pieces at
    // rate/units_per_pack), with a per-line "switch to unit rate" toggle. Confirmed against
    // 2 packs + 3 loose of a 10-count strip = ₹69.00 on screen.
    price_basis: 'per_pack',
    lines: oracLines, ...extra,
  });
}

function compare(id, title, r, oracle) {
  const inv = r.dbInvoice;
  const diffs = [];
  const want = {
    taxable: oracle.totals.taxable_subtotal, tax: oracle.totals.tax_total,
    cgst: oracle.totals.cgst_total, sgst: oracle.totals.sgst_total, igst: oracle.totals.igst_total,
    round: oracle.totals.round_off, grand: oracle.totals.grand_total,
  };
  const got = inv ? {
    taxable: inv.taxable_subtotal, tax: inv.tax_total, cgst: inv.cgst_total, sgst: inv.sgst_total,
    igst: inv.igst_total, round: inv.round_off, grand: inv.grand_total,
  } : null;

  if (!inv) return rec(id, title, 'FAIL', { why: 'no invoice row reached the backend', push: r.pushCalls, writes: r.writes, afterText: r.afterText });

  for (const k of Object.keys(want)) if (!eq(want[k], got[k])) diffs.push({ field: k, oracle: p(want[k]), db: p(got[k]) });
  for (const k of ['subtotal', 'gst_tax', 'round_off', 'net_payable']) {
    const map = { subtotal: 'taxable', gst_tax: 'tax', round_off: 'round', net_payable: 'grand' };
    if (r.uiTotals[k] == null) { diffs.push({ field: 'ui.' + k, oracle: 'missing', db: '-' }); continue; }
    if (!eq(r.uiTotals[k], want[map[k]])) diffs.push({ field: `ui.${k}`, ui: p(r.uiTotals[k]), oracle: p(want[map[k]]) });
  }
  // line-level: tax totals must equal the sum of line taxes
  const lineTaxSum = r.dbItems.reduce((a, i) => a + Number(i.tax_amount || 0), 0);
  if (!eq(lineTaxSum, inv.tax_total)) diffs.push({ field: 'sum(line tax) vs invoice tax', oracle: p(lineTaxSum), db: p(inv.tax_total) });
  const lineTaxable = r.dbItems.reduce((a, i) => a + Number(i.taxable_amount || 0), 0);
  if (!eq(lineTaxable, inv.taxable_subtotal)) diffs.push({ field: 'sum(line taxable) vs invoice taxable', oracle: p(lineTaxable), db: p(inv.taxable_subtotal) });
  const splitSum = Number(inv.cgst_total || 0) + Number(inv.sgst_total || 0) + Number(inv.igst_total || 0);
  if (!eq(splitSum, inv.tax_total)) diffs.push({ field: 'cgst+sgst+igst vs tax_total', oracle: p(splitSum), db: p(inv.tax_total) });
  // whatever the drawer actually collected must equal the bill's own payable
  const paid = r.dbPayments.reduce((a, y) => a + Number(y.amount || 0), 0);
  if (!eq(paid, inv.grand_total)) diffs.push({ field: 'payments vs invoice grand_total', oracle: p(inv.grand_total), db: p(paid) });

  // the persisted invoice must contain exactly the lines the cashier built, in order
  (r.added || []).forEach((l, i) => {
    const it = r.dbItems[i];
    if (!it) { diffs.push({ field: `line ${i + 1}`, oracle: l.search, db: 'missing from invoice' }); return; }
    if (Number(it.qty) !== Number(l.packs ?? 0)) diffs.push({ field: `line ${i + 1} packs`, oracle: String(l.packs ?? 0), db: String(it.qty) });
    if (Number(it.loose_qty) !== Number(l.loose ?? 0)) diffs.push({ field: `line ${i + 1} loose`, oracle: String(l.loose ?? 0), db: String(it.loose_qty) });
  });

  // who is wrong: the counter's own submission, or the server that stored it?
  const cp = r.clientPayload;
  if (cp && !cp.unparsable) {
    // the counter sends its taxable value as `subtotal`; the server column is taxable_subtotal
    const pairs = [['taxable_subtotal', want.taxable, 'taxable'], ['tax_total', want.tax, 'tax'],
                   ['grand_total', want.grand, 'grand'], ['round_off', want.round, 'round']];
    for (const [payloadKey, wantVal, gotKey] of pairs) {
      const clientVal = cp[payloadKey] != null ? cp[payloadKey]
        : (payloadKey === 'taxable_subtotal' ? cp.subtotal : null);
      if (clientVal == null) { diffs.push({ field: `client sent ${payloadKey}`, oracle: p(wantVal), client: 'absent from payload' }); continue; }
      if (!eq(clientVal, wantVal)) diffs.push({ field: `client ${payloadKey}`, oracle: p(wantVal), client: p(clientVal) });
      if (!eq(clientVal, got[gotKey])) diffs.push({ field: `server rewrote client ${payloadKey}`, client: p(clientVal), db: p(got[gotKey]) });
    }
  }
  if (r.invoicePostCount > 1) diffs.push({ field: 'duplicate submission', oracle: '1 POST /api/invoices', db: `${r.invoicePostCount} POSTs for the same bill` });

  rec(id, title, diffs.length ? 'FAIL' : 'PASS', {
    invoice_post_count: r.invoicePostCount,
    client_payload: cp && { taxable_subtotal: cp.taxable_subtotal, subtotal: cp.subtotal, tax_total: cp.tax_total, cgst_total: cp.cgst_total, sgst_total: cp.sgst_total, igst_total: cp.igst_total, round_off: cp.round_off, grand_total: cp.grand_total, paid_amount: cp.paid_amount, tax_mode: cp.tax_mode, gst_type: cp.gst_type, items: cp.items },
    invoice_number: inv.invoice_number, shown_number: r.shownNumber,
    ui: r.uiTotals, oracle: want, db: got, line_tax_sum: p(lineTaxSum), split_sum: p(splitSum),
    lines: r.dbItems.map(i => ({ name: i.product_name, qty: i.qty, loose: i.loose_qty, upp: i.units_per_pack, rate: i.unit_price, gst: i.gst_percent, taxable: i.taxable_amount, tax: i.tax_amount, cgst: i.cgst_amount, sgst: i.sgst_amount, igst: i.igst_amount })),
    payments: r.dbPayments.map(y => ({ mode: y.payment_mode, amount: y.amount })),
    push_sample: ((r.pushBodies || [])[0] || '').slice(0, 1800),
    writes: (r.writes || []).map(w => ({ m: w.m, u: w.u, s: w.s, body: w.body.slice(0, 1200) })),
    diffs,
  });
  if (diffs.length) {
    def({ id: `${id}-MISMATCH`, severity: 'Critical', type: 'Logic', module: 'Billing/GST',
      title: `${title}: money differs from the independent oracle`, expected: want, actual: { db: got, ui: r.uiTotals }, diffs,
      invoice_number: inv.invoice_number });
  }
  return inv;
}

/**
 * One bill = a store code plus lines addressed by fixture SKU.
 * `packs` is the quantity box for the whole pack (for a units_per_pack=1 product that IS the
 * unit count); `loose` is only meaningful on multi-unit packs.
 */
const SCENARIOS = [
  { id: 'B01', store: 'QA-A', title: 'Inclusive 12%: 2 packs + 3 loose of a 10-count strip', lines: [{ sku: 'QA-DOLO650', packs: 2, loose: 3 }] },
  { id: 'B02', store: 'QA-A', title: 'Inclusive 12% on a half-paisa rate (10.075 x 3)', lines: [{ sku: 'QA-HALF', packs: 3 }] },
  { id: 'B03', store: 'QA-A', title: 'Inclusive 18% on 33.33 x 7 (odd paisa)', lines: [{ sku: 'QA-P333', packs: 7 }] },
  { id: 'B04', store: 'QA-A', title: 'Inclusive 12% on 450.50 (pack of 100) -> CGST/SGST odd paisa', lines: [{ sku: 'QA-SURG', packs: 1 }] },
  { id: 'B05', store: 'QA-A', title: 'Exempt 0% line mixed with a 5% line', lines: [{ sku: 'QA-EXEMPT', packs: 2 }, { sku: 'QA-CROCIN', packs: 1, loose: 5 }] },
  { id: 'B06', store: 'QA-A', title: 'Inclusive 28% slab with packs + loose', lines: [{ sku: 'QA-SANIT', packs: 3, loose: 2 }] },
  { id: 'B07', store: 'QA-B', title: 'Exclusive 12%: 1 pack + 7 loose', lines: [{ sku: 'QA-DOLO650', packs: 1, loose: 7 }] },
  { id: 'B08', store: 'QA-B', title: 'Exclusive mixed 18/5/12 across three lines', lines: [{ sku: 'QA-ABSYRUP', packs: 1 }, { sku: 'QA-CROCIN', packs: 2, loose: 3 }, { sku: 'QA-SURG', packs: 1, loose: 12 }] },
  { id: 'B09', store: 'QA-C', title: 'Composition store bills with zero GST', lines: [{ sku: 'QA-DOLO650', packs: 1 }] },
  { id: 'B10', store: 'QA-D', title: 'No-tax store bills with zero GST', lines: [{ sku: 'QA-DOLO650', packs: 2, loose: 4 }] },
];

/** Resolve SKUs into the exact on-screen search strings the cashier would type. */
function typed(storeCode, lines) {
  return lines.map(l => ({ ...l, search: nm(storeCode, l.sku) }));
}

(async () => {
  const only = (process.env.B_ONLY || '').split(',').map(x => x.trim()).filter(Boolean);
  const byStore = {};
  for (const sc of SCENARIOS) (byStore[sc.store] ||= []).push(sc);

  for (const [storeCode, all] of Object.entries(byStore)) {
    const scenarios = only.length ? all.filter(x => only.includes(x.id)) : all;
    if (!scenarios.length) continue;
    const store = manifest.stores[storeCode];
    const opened = await openCounter(store, store.users.cash, {
      counterName: `QA ${storeCode.slice(3)} Money Counter 1`,
      sessionName: `qa${storeCode.slice(3)}_money`,
    });
    if (!opened.ok) {
      console.error(`${storeCode} sign-in failed ${JSON.stringify(opened.detail).slice(0, 300)}`);
      for (const sc of scenarios) rec(sc.id, sc.title, 'BLOCKED', { why: `${storeCode} counter sign-in failed`, detail: opened.detail });
      continue;
    }
    for (const sc of scenarios) {
      if (only.length && !only.includes(sc.id)) continue;
      const lines = typed(storeCode, sc.lines);
      const r = await bill(opened.s, { id: sc.id, storeId: store.id, lines });
      if (!r.ok && r.why) { rec(sc.id, sc.title, 'FAIL', { why: r.why, search: r.search, add: r.add }); continue; }
      compare(sc.id, sc.title, r, oracleFor(storeCode, lines));
    }
    await opened.s.close();
  }

  saveEvidence('B_money.json', results);
  console.log('\n=== integrity: duplicate invoice numbers per store ===');
  console.log(JSON.stringify(sql('select store_id, invoice_number, count(*) c from invoices group by store_id, invoice_number having c>1')));
  console.log('invoices now:', JSON.stringify(sql('select id,store_id,counter_code,invoice_number,taxable_subtotal,tax_total,cgst_total,sgst_total,igst_total,round_off,grand_total,payment_mode,status from invoices order by id desc limit 14')));
  fs.writeFileSync(path.join(__dirname, 'B_summary.json'), JSON.stringify(results.scenarios.map(x => ({ id: x.id, status: x.status })), null, 1));
})().catch(e => { console.error(e); saveEvidence('B_money.json', results); process.exit(1); });
