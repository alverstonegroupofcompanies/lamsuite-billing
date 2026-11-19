/**
 * S4 — bill revision and bill cancellation through the POS, with the manager-approval dialog,
 * judged on the till and on the server: money, line rows, status and batch stock.
 */
const {
  storeByCode, fixture, login, shot, sleep, readMoney, invoiceNoShown, addLine, checkoutAndSave,
  serverInvoice, computeInvoice, p2, eq, cmp, sql, saveEvidence, navTo, batchWithStock,
  localTable, localQueue, setInput,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const out = { scenarios: [], defects: [], notes: [] };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1500));
};
const def = (d) => { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); };

function batchStock(productId, storeId) {
  const m = {};
  for (const b of sql(`select batch_no, stock_qty from product_batches where product_id=${productId} and store_id=${storeId}`)) m[b.batch_no] = Number(b.stock_qty);
  return m;
}

/** The till's own batch stock, per product id. */
async function tillBatchStock(s, storeId) {
  const rows = (await localTable(s, 'product_batches', storeId)).rows;
  const m = {};
  for (const b of rows) {
    m[b.product_id] = m[b.product_id] || {};
    m[b.product_id][b.batch_no] = Number(b.stock_qty);
  }
  return m;
}

/**
 * Whole sync-queue payloads for one entity type, so a wrong server row can be traced back to the
 * exact bytes the till sent. Secrets are redacted because these rows are kept as evidence.
 */
async function queuePayloads(s, storeId, entity, limit = 3) {
  const { rows } = await localTable(s, 'sync_queue', storeId);
  return (rows || [])
    .filter(e => e && (e.entity_type || e.entity) === entity)
    .slice(-limit)
    .map(e => ({
      op: e.action || e.operation,
      status: e.status,
      id: e.entity_id,
      payload: String(e.payload_json || '')
        .replace(/"(device_token|refresh_token|access_token|token|api_key)"\s*:\s*"[^"]*"/g, '"$1":"[redacted]"')
        .slice(0, 6000),
    }));
}

/** Units a built line took from its batch. */
function unitsOf(a) {
  return Number(a.packs || 0) * (Number(a.prod.units_per_pack) || 1) + Number(a.loose || 0);
}

/**
 * Every row the till keeps for one invoice number, with the line rows hanging off each of them.
 * A bill the register stores twice shows the cashier whichever copy the code happened to read
 * last, so "one row per bill" is a check in its own right, not a cosmetic detail.
 */
async function tillCopies(s, storeId, number) {
  const inv = await localTable(s, 'invoices', storeId);
  const items = await localTable(s, 'invoice_items', storeId);
  const rows = (inv.rows || []).filter(r => r.invoice_number === number);
  return rows.map(r => ({
    id: r.id,
    external_id: r.external_id,
    sync: r.sync_state,
    status: r.status,
    taxable: r.taxable_subtotal,
    tax: r.tax_total,
    grand: r.grand_total,
    paid: r.paid_amount,
    lines: (items.rows || [])
      .filter(i => String(i.invoice_id) === String(r.id))
      .map(i => ({ id: i.id, qty: Number(i.qty), taxable: i.taxable_amount, tax: i.tax_amount })),
  }));
}

/** Fold the copies into one verdict: exactly one row, and its lines keyed to that row. */
function copyChecks(label, copies, ec) {
  cmp(`${label}: till keeps one row`, (copies || []).length, 1, ec);
  if (copies && copies.length === 1 && copies[0].lines.length === 0) {
    ec.push({ check: `${label}: till line rows keyed to that row`, got: 0, want: '>0', ok: false });
  }
  return {
    ok: (copies || []).length === 1 && copies[0].lines.length > 0,
    got: copies,
  };
}

/**
 * Click one register period chip and report the bills that window actually returns.
 *
 * "Today" used to send invoice_date BETWEEN '... 00:00:00' and '... 23:59:59' while the column
 * holds a bare 'YYYY-MM-DD' string — on SQLite that matched nothing, so a bill raised seconds
 * ago was unopenable and the cashier saw an empty list. The register also remembers the last
 * chip clicked, so any window under test has to be clicked explicitly.
 */
async function showPeriod(s, chip) {
  const clicked = await s.page.evaluate((label) => {
    const el = [...document.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && (b.innerText || '').trim() === label);
    if (!el) return null;
    el.click();
    return label;
  }, chip);
  await sleep(5000);
  const rows = await s.page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find(x => [...x.querySelectorAll('thead th')].some(th => /BILL|INVOICE/i.test(th.innerText || '')));
    return t ? [...t.querySelectorAll('tbody tr')].map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 60)) : [];
  });
  const shown = rows.filter(r => !/No invoices found/i.test(r));
  const empty = await s.page.evaluate(() => document.body.innerText.includes('No invoices found'));
  return { chip: clicked, n: shown.length, rows: shown, empty, sample: shown.slice(0, 3) };
}

async function openBill(s, number) {
  const box = await s.page.evaluate((n) => {
    const els = [...document.querySelectorAll('tr,button,[role="row"]')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(n) && (el.innerText || '').length < 900);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120) };
  }, number);
  if (!box) return { ok: false, why: 'row not found in register', screen: (await s.text()).slice(-400) };
  await s.page.mouse.click(box.x, box.y);
  await sleep(3000);
  return { ok: true, clicked: box.text, has_edit: /Edit Bill/.test(await s.text()), has_cancel: /Cancel Bill/.test(await s.text()) };
}

/** Fill the manager-approval dialog and authorise. */
async function approve(s, { action, username, pin, reason }) {
  const idf = await setInput(s, '#invoice-approval-identifier', username);
  await sleep(400);
  const sec = await setInput(s, '#invoice-approval-secret', pin);
  await sleep(400);
  const rsn = reason === null ? null : await setInput(s, '#invoice-approval-reason', reason);
  await sleep(600);
  const label = action === 'cancel' ? 'Authorize Cancellation' : 'Authorize Edit';
  const clicked = await s.clickText(label);
  await sleep(6000);
  return { idf, sec, reason_set: rsn, clicked_label: label, authorised: !!clicked, screen: (await s.text()).replace(/\n{3,}/g, '\n').slice(-500) };
}

(async () => {
  const store = storeByCode('QA-A');
  console.log('store', JSON.stringify(store));
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S4' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 160));
  if (!ok) { saveEvidence('GST_S4_edit_cancel.json', out); process.exit(1); }

  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  const EXE = fixture(store.id, 'QA Exempt Nutritional');

  // ── build two identical bills: one to revise, one to cancel ──
  const built = [];
  for (let i = 0; i < 2; i++) {
    await s.key('F1'); await sleep(2200);
    const shown = await invoiceNoShown(s);
    const added = [];
    for (const l of [{ prod: SYR, packs: 2, loose: 0 }, { prod: EXE, packs: 1, loose: 0 }]) {
      const units = l.packs * (Number(l.prod.units_per_pack) || 1) + l.loose;
      const batch = batchWithStock(l.prod, units);
      const r = await addLine(s, { search: l.prod.name, batch, packs: l.packs, loose: l.loose });
      if (!r.ok) { rec('S4.0', `build bill ${i + 1}`, 'FAIL', { why: r.why, detail: r }); saveEvidence('GST_S4_edit_cancel.json', out); process.exit(1); }
      added.push({ ...l, batch });
    }
    const money = await readMoney(s);
    await checkoutAndSave(s, { tender: 'Cash' });
    await sleep(4000);
    const inv = serverInvoice(shown, store.id);
    built.push({ shown, added, money, inv });
    console.log(`bill ${i + 1}: ${shown} ui=${JSON.stringify(money)} server_grand=${inv && inv.grand_total}`);
  }
  if (!built[0].inv) { rec('S4.0', 'bills reached the server', 'FAIL', { built }); saveEvidence('GST_S4_edit_cancel.json', out); process.exit(1); }

  const stockBefore = { [SYR.id]: batchStock(SYR.id, store.id), [EXE.id]: batchStock(EXE.id, store.id) };
  const tillInv = (await localTable(s, 'invoices', store.id)).rows;
  const editTarget = tillInv.find(r => r.invoice_number === built[0].shown);
  const cancelTarget = tillInv.find(r => r.invoice_number === built[1].shown);

  // Right after checkout: the bill is on the server, so the till must hold it once, under the
  // server's id, with its lines hanging off that same id.
  const raised = [];
  for (const b of built) copyChecks(`at checkout for ${b.shown}`, await tillCopies(s, store.id, b.shown), raised);
  const raisedBad = raised.filter(x => !x.ok);
  rec('S4.0b', 'the till keeps one row per bill straight after checkout',
    !raisedBad.length ? 'PASS' : 'FAIL',
    { copies: { [built[0].shown]: await tillCopies(s, store.id, built[0].shown), [built[1].shown]: await tillCopies(s, store.id, built[1].shown) }, checks: raised });
  if (raisedBad.length) def({ id: 'S4-DupRow', severity: 'High', type: 'Logic', module: 'Invoice Cache',
    title: 'the till stores a bill under two primary keys (idempotency id and server id)', expected: raised, actual: raisedBad, diffs: raisedBad });

  // ── S4.1 revise the first bill: 2 packs -> 5 packs of the syrup line ──
  const navB = await navTo(s, '/bills');
  await sleep(4000);
  const today = await showPeriod(s, 'Today');
  const missingFromToday = built.filter(b => !today.rows.some(r => r.includes(b.shown)));
  rec('S4.1a', `Past Bills "Today" window lists the ${built.length} bills raised minutes ago`,
    !missingFromToday.length && today.n > 0 ? 'PASS' : 'FAIL',
    { chip: today.chip, rows: today.n, empty: today.empty,
      missing: missingFromToday.map(b => b.shown), sample: today.sample });
  out.notes.push({ step: 'register date filter', today });
  console.log('register today:', JSON.stringify({ n: today.n, empty: today.empty, missing: missingFromToday.map(b => b.shown) }));
  let view = today;
  if (missingFromToday.length) {
    const allTime = await showPeriod(s, 'All Time');
    def({ id: 'S4-Filter', severity: 'High',
      title: 'Past Bills "Today" window returns no rows, so a just-raised bill cannot be opened to edit or cancel',
      evidence: { today_empty: today.empty, today_rows: today.n,
        missing: missingFromToday.map(b => b.shown), all_time_rows: allTime.n, sample: allTime.sample } });
    if (allTime.n > today.n) view = allTime; // keep the rest of the run going
  }
  const opened = await openBill(s, built[0].shown);
  const clickedEdit = opened.has_edit ? await s.clickText('Edit Bill') : false;
  await sleep(3000);
  const dialogUp = await s.page.$('#invoice-approval-identifier');
  const ap1 = dialogUp ? await approve(s, { action: 'edit', username: 'qaa_owner', pin: '9101', reason: 'QA S4 revision: quantity corrected' })
    : { authorised: false, why: 'approval dialog never appeared', screen: (await s.text()).slice(-400) };
  await shot(s, 'S4.1_after_authorise');
  const editMode = /Editing Invoice/i.test(await s.text());
  const path = await s.page.evaluate(() => location.pathname + location.search);

  let revision = { attempted: false };
  if (editMode) {
    const ids = await s.page.evaluate(() => [...document.querySelectorAll('input[id^="qty-input-"]')]
      .map(i => i.id.replace(/^qty-input-/, '').replace(/-(pack|loose)$/, '')).filter((v, x, a) => a.indexOf(v) === x));
    const lineSel = `#qty-input-${ids[0]}-pack`;
    const cur = await s.page.$eval(lineSel, e => e.value).catch(() => null);
    await s.page.click(lineSel);
    await sleep(200);
    await s.page.keyboard.type('3', { delay: 60 });
    await sleep(800);
    await s.key('Enter');
    await sleep(1500);
    const moneyAfterQty = await readMoney(s);
    const qtyFields = await s.page.evaluate(() => [...document.querySelectorAll('input[id^="qty-input-"]')]
      .map(i => ({ id: i.id.replace(/^qty-input-/, ''), value: i.value })));
    revision = { attempted: true, line_ids: ids, qty_before: cur, qty_fields: qtyFields, money_after_qty: moneyAfterQty };
    await shot(s, 'S4.1_qty_changed');
    // open the revision confirm dialog: checkout shortcut, then Ctrl+S fallback
    await s.key('F12'); await sleep(3500);
    let diffUp = /Confirm Revision/i.test(await s.text());
    if (!diffUp) {
      await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control');
      await sleep(3500);
      diffUp = /Confirm Revision/i.test(await s.text());
    }
    revision.diff_modal = diffUp;
    if (diffUp) {
      await setInput(s, 'input[placeholder="e.g., Customer altered quantity, corrected item..."]', 'QA S4 revision reason');
      await sleep(500);
      revision.confirmed = await s.clickText('Confirm & Save Revision') || await s.key('Enter');
      await sleep(9000);
    }
    await shot(s, 'S4.1_after_confirm');
  }
  const afterEditScreen = (await s.text()).replace(/\n{3,}/g, '\n').slice(-500);
  const tillRowsEdit = (await localTable(s, 'invoices', store.id)).rows.filter(r => r.invoice_number === built[0].shown);
  const tillAfterEdit = tillRowsEdit.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
  const tillItemsEdit = (await localTable(s, 'invoice_items', store.id)).rows.filter(i => String(i.invoice_id) === String((tillAfterEdit || {}).id));
  const srvAfterEdit = serverInvoice(built[0].shown, store.id);
  const stockAfterEdit = { [SYR.id]: batchStock(SYR.id, store.id), [EXE.id]: batchStock(EXE.id, store.id) };

  // The POS screen is the surface the cashier charged from, so it — not a quantity this harness
  // guessed at — is the oracle a revision has to reproduce on the till row, on the server
  // header, across the server's lines and in batch stock.
  const wantEdit = revision.money_after_qty
    ? {
        taxable_subtotal: p2(revision.money_after_qty.subtotal),
        tax_total: p2(revision.money_after_qty.gst_tax),
        round_off: p2(revision.money_after_qty.round_off),
        grand_total: p2(revision.money_after_qty.net_payable),
      }
    : null;
  const screenPackQty = (revision.qty_fields || [])
    .filter(f => f.id.endsWith('-pack'))
    .map(f => Number(f.value));
  const revisedSyrupUnits = (screenPackQty[0] || 0) * (Number(SYR.units_per_pack) || 1);
  const ec = [];
  if (!wantEdit) ec.push({ check: 'money readable on the edit screen', got: null, want: 'numbers', ok: false });
  const editCopies = await tillCopies(s, store.id, built[0].shown);
  copyChecks('after revision', editCopies, ec);
  cmp('till revised taxable vs screen', tillAfterEdit && tillAfterEdit.taxable_subtotal, wantEdit && wantEdit.taxable_subtotal, ec);
  cmp('till revised tax vs screen', tillAfterEdit && tillAfterEdit.tax_total, wantEdit && wantEdit.tax_total, ec);
  cmp('till revised grand vs screen', tillAfterEdit && tillAfterEdit.grand_total, wantEdit && wantEdit.grand_total, ec);
  cmp('server revised taxable vs screen', srvAfterEdit && srvAfterEdit.taxable_subtotal, wantEdit && wantEdit.taxable_subtotal, ec);
  cmp('server revised tax vs screen', srvAfterEdit && srvAfterEdit.tax_total, wantEdit && wantEdit.tax_total, ec);
  cmp('server revised grand vs screen', srvAfterEdit && srvAfterEdit.grand_total, wantEdit && wantEdit.grand_total, ec);
  cmp('server header = sum of its line taxable',
    srvAfterEdit && p2(srvAfterEdit.items.reduce((a, i) => a + Number(i.taxable_amount || 0), 0)), wantEdit && wantEdit.taxable_subtotal, ec);
  cmp('server header = sum of its line tax',
    srvAfterEdit && p2(srvAfterEdit.items.reduce((a, i) => a + Number(i.tax_amount || 0), 0)), wantEdit && wantEdit.tax_total, ec);
  const qtyMatch = (srvAfterEdit ? srvAfterEdit.items.map(i => Number(i.qty)).sort((x, y) => x - y).join(',') : '')
    === screenPackQty.slice().sort((x, y) => x - y).join(',');
  ec.push({ check: 'server lines carry the quantities shown on screen',
    got: srvAfterEdit && srvAfterEdit.items.map(i => Number(i.qty)), want: screenPackQty, ok: !!qtyMatch && screenPackQty.length > 0 });
  cmp('till items survived the revision', (tillItemsEdit || []).length,
    srvAfterEdit ? srvAfterEdit.items.length : 0, ec);
  cmp('server syrup stock tracks the revised quantity', stockAfterEdit[SYR.id][built[0].added[0].batch],
    stockBefore[SYR.id][built[0].added[0].batch] + unitsOf(built[0].added[0]) - revisedSyrupUnits, ec);
  const ecbad = ec.filter(x => !x.ok);
  rec('S4.1', 'revise a bill with manager approval and land it on till, server and stock',
    revision.attempted && revision.diff_modal && !ecbad.length ? 'PASS' : (revision.attempted ? 'FAIL' : 'BLOCKED'),
    { edit_mode: editMode, path, approve: ap1, revision, want: wantEdit,
      till_copies: editCopies,
      till: tillAfterEdit && { taxable: tillAfterEdit.taxable_subtotal, tax: tillAfterEdit.tax_total, round: tillAfterEdit.round_off, grand: tillAfterEdit.grand_total, status: tillAfterEdit.status },
      till_items: tillItemsEdit.map(i => ({ n: i.product_name, qty: i.qty, rate: i.unit_price, taxable: i.taxable_amount, tax: i.tax_amount })),
      server: srvAfterEdit && { taxable: srvAfterEdit.taxable_subtotal, tax: srvAfterEdit.tax_total, round: srvAfterEdit.round_off, grand: srvAfterEdit.grand_total, status: srvAfterEdit.status, paid_amount: srvAfterEdit.paid_amount, payments: srvAfterEdit.payments.map(p => ({ mode: p.payment_mode, amount: p.amount, status: p.status })) },
      server_items: srvAfterEdit && srvAfterEdit.items.map(i => ({ n: i.product_name, qty: i.qty, taxable: i.taxable_amount, tax: i.tax_amount })),
      stock_before: stockBefore, stock_after: stockAfterEdit, checks: ec, screen: afterEditScreen,
      sent: await queuePayloads(s, store.id, 'invoice'),
      queue: (await localQueue(s, store.id)).filter(q => q.entity !== 'settings').slice(-6) });
  if (ecbad.length) def({ id: 'S4.1-REVISE', severity: 'Critical', type: 'Logic', module: 'Bill Edit',
    title: 'bill revision did not land the same way on the till, the server and stock', expected: ec, actual: ecbad, diffs: ecbad });

  // ── S4.2 cancel the second bill ──
  const stockBeforeCancel = { [SYR.id]: batchStock(SYR.id, store.id), [EXE.id]: batchStock(EXE.id, store.id) };
  const tillStockBeforeCancel = await tillBatchStock(s, store.id);
  const navB2 = await navTo(s, '/bills');
  await sleep(4000);
  const allTime2 = await showPeriod(s, 'Today');
  console.log('register before cancel:', JSON.stringify(allTime2));
  if (!allTime2.rows.some(r => r.includes(built[1].shown))) {
    const wide = await showPeriod(s, 'All Time');
    def({ id: 'S4-Filter-2', severity: 'High',
      title: 'a revised bill drops out of the "Today" register window and cannot be cancelled',
      evidence: { today_rows: allTime2.n, missing: built[1].shown, all_time_rows: wide.n } });
  }
  const opened2 = await openBill(s, built[1].shown);
  const clickedCancel = opened2.has_cancel ? await s.clickText('Cancel Bill') : false;
  await sleep(3000);
  const dialogUp2 = await s.page.$('#invoice-approval-identifier');
  const ap2 = dialogUp2 ? await approve(s, { action: 'cancel', username: 'qaa_owner', pin: '9101', reason: 'QA S4 cancellation test' })
    : { authorised: false, why: 'approval dialog never appeared', screen: (await s.text()).slice(-400) };
  await sleep(6000);
  await shot(s, 'S4.2_after_cancel');
  const tillRowsCancel = (await localTable(s, 'invoices', store.id)).rows.filter(r => r.invoice_number === built[1].shown);
  const tillAfterCancel = tillRowsCancel.sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))[0];
  const cancelCopies = await tillCopies(s, store.id, built[1].shown);
  const srvAfterCancel = serverInvoice(built[1].shown, store.id);
  const stockAfterCancel = { [SYR.id]: batchStock(SYR.id, store.id), [EXE.id]: batchStock(EXE.id, store.id) };
  const tillStockAfterCancel = await tillBatchStock(s, store.id);

  const cc = [];
  cmp('after cancellation: till keeps one row', cancelCopies.length, 1, cc);
  const statusCheck = (label, got) => { const ok = String(got).toLowerCase() === 'cancelled'; cc.push({ check: label, got: String(got), want: 'cancelled', ok }); return ok; };
  statusCheck('till status cancelled', (tillAfterCancel || {}).status);
  statusCheck('server status cancelled', (srvAfterCancel || {}).status);
  for (const a of built[1].added) {
    const u = unitsOf(a);
    cmp(`till stock restored +${u} (${a.prod.name})`, tillStockAfterCancel[a.prod.id][a.batch], tillStockBeforeCancel[a.prod.id][a.batch] + u, cc);
    cmp(`server stock restored +${u} (${a.prod.name})`, stockAfterCancel[a.prod.id][a.batch], stockBeforeCancel[a.prod.id][a.batch] + u, cc);
  }
  const ccbad = cc.filter(x => !x.ok);
  rec('S4.2', 'cancel a bill with manager approval and restore stock',
    ap2.authorised && !ccbad.length ? 'PASS' : 'FAIL',
    { approve: ap2, till_copies: cancelCopies, till: tillAfterCancel && { status: tillAfterCancel.status, grand: tillAfterCancel.grand_total, paid: tillAfterCancel.paid_amount },
      server: srvAfterCancel && { status: srvAfterCancel.status, grand: srvAfterCancel.grand_total, paid: (srvAfterCancel.payments[0] || {}).amount },
      server_payments: srvAfterCancel ? srvAfterCancel.payments.map(p => ({ mode: p.payment_mode, amount: p.amount, status: p.status })) : [],
      stock_before: stockBeforeCancel, stock_after_server: stockAfterCancel, stock_after_till: tillStockAfterCancel,
      checks: cc, screen: (await s.text()).replace(/\n{3,}/g, '\n').slice(-500),
      queue: (await localQueue(s, store.id)).filter(q => q.entity !== 'settings').slice(-6) });
  if (ccbad.length) def({ id: 'S4.2-CANCEL', severity: 'Critical', type: 'Logic', module: 'Bill Cancel',
    title: 'cancelling a bill did not cancel it (or did not restore stock) on every surface', expected: cc, actual: ccbad, diffs: ccbad });

  console.log('\n=== final server state ===');
  console.log(JSON.stringify(sql(`select id,invoice_number,status,taxable_subtotal,tax_total,grand_total,paid_amount from invoices where store_id=${store.id} order by id desc limit 5`)));
  await s.close();
  saveEvidence('GST_S4_edit_cancel.json', out);
})().catch(e => { console.error(e); saveEvidence('GST_S4_edit_cancel.json', out); process.exit(1); });
