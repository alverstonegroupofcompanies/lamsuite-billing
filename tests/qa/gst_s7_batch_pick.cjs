/**
 * S7 — does the batch the cashier clicks survive into the bill?
 *
 * S1 billed a box of ORS from QA-A-NEAR-01 (Rs 12 a box) after the harness clicked
 * QAPB395693B (Rs 288 a box) in the picker, in both tax modes. Either the picker ignores the
 * click, or something re-resolves the batch afterwards. This walks the picker once, slowly, and
 * records every surface: the modal rows, what the cart line says, what the totals say, and what
 * the saved invoice line carries.
 */
const {
  storeByCode, fixture, login, shot, sleep, readMoney, invoiceNoShown, addLine, checkoutAndSave,
  serverInvoice, sql, saveEvidence, batchWithStock, batchRate,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const out = { scenarios: [], defects: [], notes: [] };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 2000));
};

const modalRows = (s) => s.page.evaluate(() => {
  const box = document.querySelector('#batch-listbox');
  if (!box) return null;
  return [...box.querySelectorAll('[role="option"]')].map((o, i) => ({
    idx: i, id: o.id, batch: (o.innerText || '').replace(/\s+/g, ' ').slice(0, 70),
    aria_selected: o.getAttribute('aria-selected'), aria_disabled: o.getAttribute('aria-disabled'),
  }));
});

const cartRows = (s) => s.page.evaluate(() => {
  const tr = [...document.querySelectorAll('tr')].filter(r => /Oral Rehydration/i.test(r.innerText || ''));
  return tr.map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 220));
});

const notice = (s) => s.page.evaluate(() => {
  const el = [...document.querySelectorAll('div,p,span')].find(x => x.offsetParent !== null
    && /cannot be billed|out of stock|expired/i.test(x.innerText || '') && (x.innerText || '').length < 120);
  return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null;
});

(async () => {
  const store = storeByCode('QA-A');
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S7' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 160));
  if (!ok) { saveEvidence('GST_S7_batch_pick.json', out); process.exit(1); }

  const ORS = fixture(store.id, 'QA Oral Rehydration');
  const priced = (ORS.batches || []).filter(b => Number(b.stock_qty) > 0 && Number(batchRate(ORS, b.batch_no)) !== Number(ORS.sel_rate));
  out.notes.push({ product: { id: ORS.id, name: ORS.name, sel_rate: ORS.sel_rate, units_per_pack: ORS.units_per_pack },
    batches: (ORS.batches || []).map(b => ({ batch: b.batch_no, expiry: b.expiry_date, stock: b.stock_qty, rate: b.selling_rate })) });
  console.log('batches:', JSON.stringify(out.notes[0].batches));
  const wanted = priced.length ? priced[priced.length - 1].batch_no : batchWithStock(ORS, 36);
  const wantedRate = batchRate(ORS, wanted);

  await s.key('F1'); await sleep(2200);
  const shown = await invoiceNoShown(s);

  // type the product in and open the picker the same way a cashier does
  await s.page.click('input[aria-label="Scan barcode or type product name"]');
  await s.page.keyboard.type(ORS.name, { delay: 40 });
  await sleep(1700);
  await s.key('Enter');
  await sleep(1500);
  const rowsBefore = await modalRows(s);
  out.notes.push({ step: 'picker as it opens', rows: rowsBefore, wanted });
  console.log('picker rows:', JSON.stringify(rowsBefore));

  if (!rowsBefore) {
    rec('S7.1', 'the batch picker opened', 'FAIL', { why: 'no #batch-listbox after Enter', cart: await cartRows(s), notice: await notice(s) });
  } else {
    // click the wanted row by its own coordinates, not by index
    const click = await s.page.evaluate((bn) => {
      const box = document.querySelector('#batch-listbox');
      const opt = [...box.querySelectorAll('[role="option"]')].find(o => (o.innerText || '').includes(bn));
      if (!opt) return { ok: false, why: 'row not in list' };
      const r = opt.getBoundingClientRect();
      opt.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      opt.click();
      return { ok: true, text: (opt.innerText || '').replace(/\s+/g, ' ').slice(0, 80), aria_disabled: opt.getAttribute('aria-disabled'), x: r.x, y: r.y };
    }, wanted);
    await sleep(1500);
    out.notes.push({ step: 'click on the wanted batch', click, notice_after: await notice(s), still_open: await modalRows(s) });
    console.log('click:', JSON.stringify(out.notes[out.notes.length - 1]));

    const rowsAfter = await modalRows(s);
    if (rowsAfter) {
      // the click was refused — record why, then take the FEFO default so the rest can run
      const msg = await notice(s);
      rec('S7.1', `clicking batch ${wanted} in the picker accepts it`, 'FAIL',
        { click, picker_still_open: rowsAfter, notification: msg });
      out.defects.push({ id: 'S7-PickerBlocked', severity: 'Medium',
        title: `the batch picker refuses or ignores the click on batch ${wanted}, so the bill falls back to another batch`,
        evidence: out.scenarios[out.scenarios.length - 1].evidence });
      await s.key('Enter'); await sleep(1200);
    } else {
      rec('S7.1', `clicking batch ${wanted} in the picker accepts it`, 'PASS', { click });
    }

    // now bill 1 pack + 12 loose and watch which batch the line keeps
    const r = await addLine(s, { search: ORS.name, batch: wanted, packs: 1, loose: 12 });
    out.notes.push({ step: 'addLine with the same batch requested', result: r, cart: await cartRows(s) });
    const money = await readMoney(s);
    out.notes.push({ step: 'totals before save', money, expected_pack_rate: wantedRate });
    await checkoutAndSave(s, { tender: 'Cash' });
    await sleep(5000);

    const inv = serverInvoice(shown, store.id);
    const lines = (inv && inv.items) || [];
    const ors = lines.find(i => /Oral Rehydration/i.test(i.product_name || ''));
    const billedBatch = ors && ors.batch_no;
    const billedRate = billedBatch && batchRate(ORS, billedBatch);
    const checks = [];
    checks.push({ check: 'the bill drew from the clicked batch', got: billedBatch, want: wanted, ok: billedBatch === wanted });
    checks.push({ check: 'the line is priced off that batch', got: ors && ors.unit_price, want: wantedRate, ok: Number(ors && ors.unit_price) === Number(wantedRate) });
    const bad = checks.filter(c => !c.ok);
    rec('S7.2', `the saved invoice line carries batch ${wanted} at its rate`, bad.length ? 'FAIL' : 'PASS',
      { wanted, wanted_rate: wantedRate, invoice: inv && { number: inv.invoice_number, taxable: inv.taxable_subtotal, tax: inv.tax_total, grand: inv.grand_total },
        line: ors && { batch_no: ors.batch_no, qty: ors.qty, loose_qty: ors.loose_qty, unit_price: ors.unit_price, taxable: ors.taxable_amount, total: ors.total_amount },
        cart_before_save: money, checks });
    if (bad.length) out.defects.push({ id: 'S7-BatchAttribution', severity: 'High',
      title: `the POS billed batch ${billedBatch} (rate ${ors && ors.unit_price}) after the cashier clicked ${wanted} (rate ${wantedRate})`,
      evidence: out.scenarios[out.scenarios.length - 1].evidence });

    await shot(s, 'S7_batch_pick');
  }
  await s.close();
  saveEvidence('GST_S7_batch_pick.json', out);
  console.log('saved GST_S7_batch_pick.json');
})().catch(e => {
  console.log('FATAL', e && e.message);
  out.fatal = String(e && (e.stack || e.message)).slice(0, 2000);
  saveEvidence('GST_S7_batch_pick.json', out);
  process.exit(1);
});
