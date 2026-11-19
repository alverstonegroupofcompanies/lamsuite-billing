/**
 * S2 — sales return (credit note) and stock adjustment, driven through the POS web UI,
 * judged three ways: what the screen says, what the independent paisa oracle says, and what
 * the backend actually stored. Also answers "did the whole document reach the server".
 */
const {
  storeByCode, fixture, login, shot, sleep, readMoney, invoiceNoShown, addLine, checkoutAndSave,
  serverInvoice, serverBatchStock, computeInvoice, p2, eq, cmp, sql, saveEvidence, navTo,
  batchWithStock, batchRate, localTable, localQueue, setInput, selectOption, readLabeled, setAdjCell,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const STORE_CODE = 'QA-A';
const out = { store: null, scenarios: [], defects: [], notes: [] };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1200));
};
const def = (d) => { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); };

/** The wizard renders invoice results as cards; click the one naming this invoice. */
async function clickInvoiceCard(s, number) {
  const box = await s.page.evaluate((n) => {
    const els = [...document.querySelectorAll('button')]
      .filter(b => b.offsetParent !== null && (b.innerText || '').includes(n) && (b.innerText || '').length < 500);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120) };
  }, number);
  if (!box) return { ok: false, why: 'invoice card not found' };
  await s.page.mouse.click(box.x, box.y);
  await sleep(3000);
  return { ok: true, clicked: box.text, screen: (await s.text()).includes('Return Qty') };
}

/** Return lines are keyed by row index in the items table. */
async function readReturnLines(s) {
  return s.page.evaluate(() => [...document.querySelectorAll('[data-return-line]')].map(tr => {
    const td = [...tr.querySelectorAll('td')].map(x => (x.innerText || '').replace(/\s+/g, ' ').trim());
    const num = tr.querySelector('input[type=number]');
    return {
      idx: tr.getAttribute('data-return-line'), product: td[1], batch: td[2],
      sold: Number(td[3]), max_returnable: Number(td[4]),
      qty_value: num ? num.value : null, selected: tr.querySelector('input[type=checkbox]')?.checked,
    };
  }));
}

async function setReturnQty(s, idx, units, condition) {
  const row = `[data-return-line="${idx}"]`;
  const chk = await s.page.evaluate((r) => {
    const el = document.querySelector(`${r} input[type=checkbox]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, already: el.checked };
  }, row);
  if (!chk) return { ok: false, why: 'no checkbox' };
  if (!chk.already) { await s.page.mouse.click(chk.x, chk.y); await sleep(1200); }
  const sel = `${row} input[type=number]`;
  const before = await s.page.$eval(sel, e => e.value).catch(() => null);
  if (Number(before) !== Number(units)) {
    // number inputs reject setSelectionRange, and React ignores a bare .value write
    await s.page.click(sel);
    await sleep(200);
    await setInput(s, sel, units);
    await sleep(900);
    await s.key('Tab');
    await sleep(900);
  }
  const after = await s.page.$eval(sel, e => e.value).catch(() => null);
  let cond = null;
  if (condition) {
    const sels = await s.page.$$eval(`${row} select`, els => els.map(e => [...e.options].map(o => o.value).join(',')));
    cond = await s.page.evaluate((r, c) => {
      const el = document.querySelectorAll(`${r} select`)[1];
      if (!el) return null;
      const opt = [...el.options].find(o => o.value === c || (o.text || '').toLowerCase().includes(c.toLowerCase()));
      if (!opt) return 'no-option';
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    }, row, condition);
    await sleep(1000);
    return { ok: Number(after) === Number(units), qty: after, condition: cond, options_seen: sels };
  }
  return { ok: Number(after) === Number(units), qty: after };
}

/** Batch stock map on the server, in units. */
function serverBatchMap(productId) {
  const m = {};
  for (const b of serverBatchStock(productId)) m[b.batch_no] = Number(b.stock_qty);
  return m;
}
function localBatchMap(s, storeId, productId) {
  return localTable(s, 'product_batches', storeId).then(({ rows }) => {
    const m = {};
    for (const b of (rows || []).filter(b => String(b.product_id) === String(productId))) m[b.batch_no] = Number(b.stock_qty);
    return m;
  });
}

(async () => {
  const store = storeByCode(STORE_CODE);
  out.store = store;
  console.log('store', JSON.stringify(store));

  const { s, ok, stage, detail } = await login({ storeCode: STORE_CODE, key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S2' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 200));
  if (!ok) { saveEvidence('GST_S2_returns.json', out); process.exit(1); }

  // ── Step 0: a bill to return against, built in this session so the till can find it ──
  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  const ORS = fixture(store.id, 'QA Oral Rehydration');
  const EXE = fixture(store.id, 'QA Exempt Nutritional');
  const plan = [
    { prod: SYR, packs: 2, loose: 0 },
    { prod: ORS, packs: 1, loose: 12 },
    { prod: EXE, packs: 3, loose: 0 },
  ];
  await s.key('F1'); await sleep(2200);
  const shown = await invoiceNoShown(s);
  const added = [];
  for (const l of plan) {
    const units = l.packs * (Number(l.prod.units_per_pack) || 1) + l.loose;
    const batch = batchWithStock(l.prod, units);
    const r = await addLine(s, { search: l.prod.name, batch, packs: l.packs, loose: l.loose });
    if (!r.ok) { rec('S2.0', 'build the bill to return', 'FAIL', { why: r.why, detail: r }); saveEvidence('GST_S2_returns.json', out); process.exit(1); }
    added.push({ ...l, batch });
  }
  const billMoney = await readMoney(s);
  const save = await checkoutAndSave(s, { tender: 'Cash' });
  await sleep(4000);
  const inv = serverInvoice(shown, store.id);
  const localInv = (await localTable(s, 'invoices', store.id)).rows.find(i => i.invoice_number === shown);
  const localItems = (await localTable(s, 'invoice_items', store.id)).rows.filter(i => String(i.invoice_id) === String((localInv || {}).id));
  // the bill the return will reverse: judge it against the oracle on every surface first
  const billOracle = computeInvoice({
    store: { state_code: store.state_code, tax_mode: store.tax_mode, gst_type: store.gst_type },
    price_basis: 'per_pack',
    lines: added.map(l => ({
      name: l.prod.name, packs: l.packs, loose_qty: l.loose,
      // the POS quotes the selected batch's selling_rate, so the oracle has to price the same way
      unit_price: batchRate(l.prod, l.batch), units_per_pack: l.prod.units_per_pack, gst_percent: l.prod.gst_percent,
    })),
  });
  const bchecks = [];
  cmp('UI SUBTOTAL vs oracle taxable', billMoney.subtotal, billOracle.totals.taxable_subtotal, bchecks);
  cmp('UI GST TAX vs oracle tax', billMoney.gst_tax, billOracle.totals.tax_total, bchecks);
  cmp('UI NET PAYABLE vs oracle grand', billMoney.net_payable, billOracle.totals.grand_total, bchecks);
  cmp('till invoice taxable vs oracle', localInv && localInv.taxable_subtotal, billOracle.totals.taxable_subtotal, bchecks);
  cmp('till invoice grand vs oracle', localInv && localInv.grand_total, billOracle.totals.grand_total, bchecks);
  cmp('server invoice taxable vs oracle', inv && inv.taxable_subtotal, billOracle.totals.taxable_subtotal, bchecks);
  cmp('server invoice tax vs oracle', inv && inv.tax_total, billOracle.totals.tax_total, bchecks);
  cmp('server invoice grand vs oracle', inv && inv.grand_total, billOracle.totals.grand_total, bchecks);
  const bbad = bchecks.filter(c => !c.ok);
  rec('S2.0', `bill ${shown} money agrees with the oracle on UI, till and server`, bbad.length ? 'FAIL' : 'PASS',
    { mode: store.tax_mode, ui_money: billMoney, oracle: billOracle.totals,
      till: localInv && { taxable: localInv.taxable_subtotal, tax: localInv.tax_total, round: localInv.round_off, grand: localInv.grand_total },
      server: inv && { taxable: inv.taxable_subtotal, tax: inv.tax_total, round: inv.round_off, grand: inv.grand_total, paid: (inv.payments[0] || {}).amount },
      till_lines: localItems.map(i => ({ n: i.product_name, qty: i.qty, loose: i.loose_qty, rate: i.unit_price, gst: i.gst_percent, taxable: i.taxable_amount, tax: i.tax_amount, total: i.total_amount })),
      checks: bchecks, save_confirmed: save.confirmed });
  if (bbad.length) def({ id: 'S2.0-MONEY', severity: 'Critical', type: 'Logic', module: 'Billing/GST',
    title: `bill ${shown}: money on one or more surfaces disagrees with the independent oracle`,
    expected: billOracle.totals, actual: { ui: billMoney, till: localInv && { taxable: localInv.taxable_subtotal, tax: localInv.tax_total, grand: localInv.grand_total }, server: inv && { taxable: inv.taxable_subtotal, tax: inv.tax_total, grand: inv.grand_total, paid: (inv.payments[0] || {}).amount } },
    diffs: bbad });

  const stockBefore = {};
  for (const a of added) stockBefore[a.prod.id] = { server: serverBatchMap(a.prod.id), till: await localBatchMap(s, store.id, a.prod.id) };

  // ── S2.1 partial sales return, two conditions ──
  const RET = [
    { line: 0, prod: SYR, units: 1, condition: 'restock', note: '1 of 2 units, restocked' },
    { line: 1, prod: ORS, units: 24, condition: 'damaged_discard', note: 'one 24-sachet box, discarded (no restock)' },
  ];
  const navR = await navTo(s, '/returns/sales');
  await sleep(2000);
  await s.clickText('New Return (F7)');
  await sleep(2500);
  await s.page.click('#sales-return-invoice-search');
  await s.page.keyboard.type(shown, { delay: 45 });
  await sleep(3500);
  const card = await clickInvoiceCard(s, shown);
  await shot(s, 'S2.1_after_card');
  const linesOnScreen = await readReturnLines(s);
  const stepOk = /Return Qty/.test(await s.text());
  console.log('wizard step 2 reached:', stepOk, 'card:', JSON.stringify(card));
  console.log('return lines:', JSON.stringify(linesOnScreen));

  const setRes = [];
  for (const r of RET) {
    const res = await setReturnQty(s, r.line, r.units, r.condition);
    setRes.push({ ...r, ...res });
  }
  await sleep(1200);
  const screenTotals = await readLabeled(s, ['Gross Return', 'GST Reversal', 'Credit Amount']);
  await shot(s, 'S2.1_lines_set');

  // oracle: reverse each returned line at the till's own original rate and tax mode
  const oracle = computeInvoice({
    store: { state_code: store.state_code, tax_mode: store.tax_mode, gst_type: store.gst_type },
    price_basis: 'per_pack',
    lines: RET.map(r => {
      const it = localItems.find(x => String(x.product_id) === String(r.prod.id)) || {};
      return {
        name: r.prod.name, packs: 0, loose_qty: r.units,
        unit_price: it.unit_price ?? r.prod.sel_rate, units_per_pack: r.prod.units_per_pack,
        gst_percent: it.gst_percent ?? r.prod.gst_percent,
      };
    }),
  });

  await s.clickText('Next: Payment →');
  await sleep(2500);
  const payScreen = (await s.text()).replace(/\n{3,}/g, '\n');
  const saved = await s.clickText('Save & Print Credit Note');
  await sleep(6000);
  await shot(s, 'S2.1_after_save');
  // a print preview opens on success — close it so the next step is reachable
  if (/Preview|Print Format/i.test(await s.text())) {
    await s.clickText('Close'); await sleep(1500);
    try { await s.key('Escape'); } catch { /* modal already gone */ }
    await sleep(1500);
  }
  await sleep(4000);

  const retLocal = (await localTable(s, 'sales_returns', store.id)).rows.filter(r => r.original_invoice_number === shown);
  const mirrorLocal = (await localTable(s, 'invoices', store.id)).rows.filter(i => i.module_key === 'credit_note');
  const queue = await localQueue(s, store.id);
  const serverCredit = sql(`select * from invoices where store_id=${store.id} and (module_key='credit_note' or original_invoice_number='${shown}')`);
  const serverRetRows = sql(`select count(*) c from sqlite_master where name='sales_returns'`)[0].c;
  const stockAfter = {};
  for (const a of added) stockAfter[a.prod.id] = { server: serverBatchMap(a.prod.id), till: await localBatchMap(s, store.id, a.prod.id) };

  const checks = [];
  if (!stepOk) rec('S2.1', 'partial sales return', 'BLOCKED', { why: 'wizard never reached the items step', card, linesOnScreen });
  else if (!saved || !retLocal.length) rec('S2.1', 'partial sales return', 'FAIL', { why: 'no credit note in the till', saved, payScreen: payScreen.slice(-400), screenTotals, setRes });
  else {
    const cr = retLocal[retLocal.length - 1];
    const mirror = mirrorLocal[mirrorLocal.length - 1] || {};
    cmp('screen GST Reversal vs oracle tax', screenTotals['GST Reversal'], oracle.totals.tax_total, checks);
    cmp('till credit note grand vs oracle', cr.grand_total, oracle.totals.grand_total, checks);
    cmp('till credit note tax vs oracle', cr.tax_total, oracle.totals.tax_total, checks);
    cmp('till credit note base vs oracle taxable', cr.subtotal, oracle.totals.taxable_subtotal, checks);
    cmp('till mirror invoice taxable vs oracle', mirror.taxable_subtotal, oracle.totals.taxable_subtotal, checks);
    // The wizard prints "Credit Amount" before round-off while the note itself credits the rounded
    // figure, so the two must be reported together instead of compared to the oracle.
    const beforeRound = Number(oracle.totals.grand_total) + Number(oracle.totals.round_off);
    out.notes.push({
      id: 'S2.1-credit-display',
      screen_credit_amount: screenTotals['Credit Amount'],
      credit_note_grand: cr.grand_total,
      oracle_before_round: p2(beforeRound),
      difference: p2(Number(screenTotals['Credit Amount']) - Number(cr.grand_total)),
      reading: 'wizard shows the pre-round-off figure; the saved credit note is rounded to the rupee',
    });
    // stock: restock line returns 1 unit, discard line must not return anything
    cmp('till batch stock +1 (restocked syrup)', stockAfter[SYR.id].till[added[0].batch], stockBefore[SYR.id].till[added[0].batch] + 1, checks);
    cmp('till ORS batch unchanged (discarded)', stockAfter[ORS.id].till[added[1].batch], stockBefore[ORS.id].till[added[1].batch], checks);
    cmp('server batch stock +1 (restocked syrup)', stockAfter[SYR.id].server[added[0].batch], stockBefore[SYR.id].server[added[0].batch] + 1, checks);
    cmp('server ORS batch unchanged (discarded)', stockAfter[ORS.id].server[added[1].batch], stockBefore[ORS.id].server[added[1].batch], checks);
    const bad = checks.filter(c => !c.ok);
    rec('S2.1', 'partial sales return (1 unit restocked + 1 box discarded)', bad.length ? 'FAIL' : 'PASS',
      { credit_note_no: cr.return_number, money_till: { gross: cr.subtotal, taxable: cr.taxable_subtotal ?? null, tax: cr.tax_total, round: cr.round_off, grand: cr.grand_total }, money_screen: screenTotals, money_oracle: oracle.totals, lines_set: setRes, lines_on_screen: linesOnScreen, till_stock: stockAfter, server_stock: stockBefore });
    if (bad.length) def({ id: 'S2.1-MONEY/STOCK', severity: 'Critical', type: 'Logic', module: 'Sales Return', title: 'credit note money or stock does not match the oracle/till expectation', expected: checks, actual: bad, diffs: bad });

    // the "did it reach the backend" question, answered per surface
    const srvRow = serverCredit[0] || null;
    const srvItems = srvRow ? sql(`select * from invoice_items where invoice_id=${srvRow.id}`) : [];
    const persisted = {
      till_rows: { sales_returns: retLocal.length, credit_note_mirrors_in_invoices: mirrorLocal.length },
      server_row_found: !!srvRow,
      server_module_key: srvRow ? srvRow.module_key : null,
      server_status: srvRow ? srvRow.status : null,
      server_line_count: srvItems.length,
      server_links_original: srvRow ? (srvRow.original_invoice_number || null) : null,
      server_money: srvRow ? { taxable: p2(srvRow.taxable_subtotal), tax: p2(srvRow.tax_total), round: p2(srvRow.round_off), grand: p2(srvRow.grand_total), paid: p2(srvRow.paid_amount) } : null,
      till_money: { taxable: p2(cr.subtotal), tax: p2(cr.tax_total), round: p2(cr.round_off), grand: p2(cr.grand_total) },
      server_has_sales_returns_table: serverRetRows === 1,
      queue: queue.filter(q => q.entity !== 'settings').slice(-6),
      writes: s.apiLog().filter(w => w.u !== '/api/device-sessions/heartbeat' && w.m === 'POST').map(w => ({ u: w.u, s: w.s, req: w.body.slice(0, 300), res: w.resp.slice(0, 300) })).slice(-10),
    };
    out.notes.push({ id: 'S2.1-backend-persistence', ...persisted });

    const lost = [];
    if (!srvRow) lost.push('no row of any kind on the server for this credit note');
    else {
      if (srvRow.module_key !== 'credit_note') lost.push(`server stored it as module_key="${srvRow.module_key}" — it counts as a fresh SALE, not a reduction of sales`);
      if (!srvItems.length) lost.push('server stored the note with zero line items (no product, batch, HSN or per-line tax)');
      if (!srvRow.original_invoice_number) lost.push('server row is not linked to the original invoice');
      if (!eq(srvRow.tax_total, cr.tax_total)) lost.push(`server tax reversal ${p2(srvRow.tax_total)} vs till ${p2(cr.tax_total)}`);
    }
    rec('S2.1b', 'credit note reaches the backend intact', lost.length ? 'FAIL' : 'PASS', persisted);
    if (lost.length) {
      def({ id: 'S2.1-NOT-ON-SERVER', severity: 'Critical', type: 'Data loss', module: 'Sync/Backend',
        title: 'sales return is saved in the till but is mangled or missing on the server',
        expected: 'server holds a credit note: module_key=credit_note, its lines, its tax reversal, a link to the original bill, and the restock',
        actual: persisted, lost });
    }
  }

  // ── S2.2 stock adjustment document: one increase and one decrease ──
  // Batches are chosen from live server stock so the -2 line can actually pay,
  // and the reasons must be ones the modal's Reason dropdown offers.
  const pickBatchFor = (prod, units) => {
    const bs = serverBatchStock(prod.id).filter(b => Number(b.stock_qty) >= units);
    return bs.length ? bs[0].batch_no : null;
  };
  const ADJ = [];
  {
    const b1 = pickBatchFor(EXE, 0) || added[2].batch;
    ADJ.push({ prod: EXE, batch: b1, delta: 5, reason: 'Found Stock' });
    const b2 = pickBatchFor(SYR, 2);
    if (!b2) rec('S2.2', 'stock adjustment document', 'BLOCKED', { why: 'no syrup batch on the server holds 2 units to remove' });
    else ADJ.push({ prod: SYR, batch: b2, delta: -2, reason: 'Damaged' });
  }
  const stockAdjBefore = {};
  for (const a of ADJ) stockAdjBefore[a.prod.id] = { server: serverBatchMap(a.prod.id), till: await localBatchMap(s, store.id, a.prod.id) };

  const navS = await navTo(s, '/stock');
  await sleep(2000);
  const openAdj = await s.clickText('Stock Adjustment');
  await sleep(2500);
  const modalOpen = /Stock Adjustment Document/.test(await s.text());
  // Rows are entered through the modal's own "Import CSV" sheet-paste path: the grid
  // renders a cell editor only for the active cell, which makes per-cell fills brittle.
  const csvText = ADJ.map(a => `${a.prod.name},${a.batch},${a.delta},${a.reason},QA harness adjustment`).join('\n');
  const csvBtn = await s.clickText('Import CSV');
  await sleep(1800);
  const csvBoxOpen = /Import CSV \/ Spreadsheet Rows/.test(await s.text());
  const csvTyped = await setInput(s, 'textarea', csvText);
  await sleep(2500);
  const csvScreen = (await s.text()).replace(/\n{3,}/g, '\n');
  const csvSummary = {
    rows: (csvScreen.match(/Rows:\s*(\d+)/i) || [])[1] || null,
    valid: (csvScreen.match(/Valid:\s*(\d+)/i) || [])[1] || null,
    invalid: (csvScreen.match(/Invalid:\s*(\d+)/i) || [])[1] || null,
    rejected: (csvScreen.match(/Row \d+: [^\n]+/g) || []).slice(0, 6),
  };
  const applyBtn = await s.clickText('Apply');
  await sleep(2500);
  const gridRows = await s.page.evaluate(() => {
    const byRow = {};
    for (const el of [...document.querySelectorAll('[data-cell]')]) {
      const [i, ...rest] = el.getAttribute('data-cell').split('-');
      const col = rest.join('-');
      (byRow[i] = byRow[i] || {})[col] = (el.innerText || '').replace(/\s+/g, ' ').trim();
    }
    return Object.keys(byRow).sort().map(i => ({ row: Number(i) + 1, ...byRow[i] }));
  });
  const filled = ADJ.map((a, i) => {
    const g = gridRows[i] || {};
    return {
      want: { product: a.prod.name, batch: a.batch, delta: a.delta, reason: a.reason },
      on_screen: g,
      ok: g.product_name === a.prod.name && g.batch_no === a.batch && Number(g.adjustment_qty) === a.delta,
    };
  });
  const adjEntry = {
    open_clicked: !!openAdj, modal_open: modalOpen, csv_button_clicked: !!csvBtn, csv_box_open: csvBoxOpen,
    csv_pasted: csvTyped, csv_summary: csvSummary, apply_clicked: !!applyBtn, grid_rows: gridRows, filled,
  };
  await shot(s, 'S2.2_before_post');
  const previewTxt = ((await s.text()).match(/Adjustment Value[^\n]*\n?[^\n]*/i) || [null])[0];
  const post = await s.clickText('Post Adjustment');
  await sleep(7000);
  await shot(s, 'S2.2_after_post');
  const afterPost = (await s.text()).replace(/\n{3,}/g, '\n');
  const localDocs = (await localTable(s, 'stock_adjustment_documents', store.id)).rows;
  const localTx = (await localTable(s, 'stock_transactions', store.id)).rows
    .filter(t => /ADJUST/i.test(String(t.event_type || ''))).slice(-6);
  const srvDocs = sql(`select * from stock_adjustment_documents where store_id=${store.id} order by id desc limit 3`);
  const srvLines = srvDocs.length ? sql(`select * from stock_adjustment_lines where stock_adjustment_document_id in (${srvDocs.map(d => d.id).join(',')})`) : [];
  const srvLegacy = sql(`select * from stock_adjustments where store_id=${store.id} order by id desc limit 6`);
  const srvLedger = sql(`select id,event_type,qty_delta,batch_id,reference_type,reference_id,balance_after,created_at from stock_ledger_entries where store_id=${store.id} order by id desc limit 8`);
  const stockAdjAfter = {};
  for (const a of ADJ) stockAdjAfter[a.prod.id] = { server: serverBatchMap(a.prod.id), till: await localBatchMap(s, store.id, a.prod.id) };

  const ac = [];
  const fillBad = filled.map((f, i) => ({ line: i + 1, ok: !!f.ok, want: f.want, on_screen: f.on_screen })).filter(f => !f.ok);
  const adjEvidence = {
    post_clicked: !!post, preview_value: previewTxt, ...adjEntry,
    till_document_rows: localDocs.length, till_tx: localTx,
    server_documents: srvDocs, server_lines: srvLines, server_legacy_rows: srvLegacy, server_ledger: srvLedger,
    stock_before: stockAdjBefore, stock_after: stockAdjAfter, checks: ac, screen: afterPost.slice(-700),
    queue: (await localQueue(s, store.id)).filter(q => q.entity !== 'settings').slice(-6),
    writes: s.apiLog().filter(w => w.m === 'POST' && /sync|adjust|stock/.test(w.u)).map(w => ({ u: w.u, s: w.s, req: w.body.slice(0, 400), res: w.resp.slice(0, 300) })).slice(-8),
  };
  if (!modalOpen) rec('S2.2', 'stock adjustment document', 'BLOCKED', { why: 'modal did not open', afterPost: afterPost.slice(-400), ...adjEntry });
  else if (ADJ.length < 2) rec('S2.2', 'stock adjustment document', 'BLOCKED', { why: 'no syrup batch holds 2 units to remove', ADJ });
  else if (fillBad.length) rec('S2.2', 'stock adjustment document', 'BLOCKED', { why: 'harness could not get the lines onto the grid', fillBad, ...adjEvidence });
  else {
    for (const a of ADJ) {
      const label = a.delta > 0 ? 'increase' : 'decrease';
      cmp(`till batch stock ${a.delta} (${a.prod.name} ${a.batch}) ${label}`,
        stockAdjAfter[a.prod.id].till[a.batch], stockAdjBefore[a.prod.id].till[a.batch] + a.delta, ac);
      cmp(`server batch stock ${a.delta} (${a.prod.name} ${a.batch}) ${label}`,
        stockAdjAfter[a.prod.id].server[a.batch], stockAdjBefore[a.prod.id].server[a.batch] + a.delta, ac);
    }
    rec('S2.2', `stock adjustment document (+${ADJ[0].delta} and ${ADJ[1].delta})`,
      ac.some(x => !x.ok) ? 'FAIL' : (post && ac.length ? 'PASS' : 'FAIL'), adjEvidence);
    const abad = ac.filter(x => !x.ok);
    if (abad.length) def({ id: 'S2.2-STOCK', severity: 'Critical', type: 'Logic', module: 'Stock Adjustment', title: 'stock adjustment did not move stock the same way on both surfaces', expected: ac, actual: abad, diffs: abad });
    if (!srvDocs.length && !srvLegacy.length && localDocs.length) {
      def({ id: 'S2.2-NOT-ON-SERVER', severity: 'Critical', type: 'Data loss', module: 'Sync/Backend', title: 'stock adjustment document exists in the till but not on the server',
        expected: 'server holds the adjustment document and its lines', actual: { till_docs: localDocs.length, server_documents: srvDocs.length, server_legacy: srvLegacy.length, queue: (await localQueue(s, store.id)).slice(-4) } });
    }
  }

  console.log('\n=== final server state ===');
  console.log('invoices:', JSON.stringify(sql(`select id,invoice_number,module_key,status,taxable_subtotal,tax_total,round_off,grand_total from invoices where store_id=${store.id} order by id desc limit 6`)));
  console.log('batches:', JSON.stringify(sql(`select p.name,b.batch_no,b.stock_qty from product_batches b join products p on p.id=b.product_id where b.store_id=${store.id} and p.name like '%QA%' order by p.name, b.expiry_date`)));
  await s.close();
  saveEvidence('GST_S2_returns.json', out);
})().catch(e => { console.error(e); saveEvidence('GST_S2_returns.json', out); process.exit(1); });
