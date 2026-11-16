/**
 * Group C — sales returns, credit notes, cancellation.
 * Builds a real bill at the counter, returns it through /returns/sales the way a manager would,
 * then checks the return on every surface: the credit-note row, its lines and tax, the batch
 * quantity and stock ledger, the number series, the link back to the original bill, and how much
 * a second return is still allowed to take.
 */
const fs = require('fs');
const path = require('path');
const { openCounter, sleep, navTo } = require('./pos_flow.cjs');
const { newBill, addProduct, setQty, readTotals, openCheckout } = require('./pos_ui.cjs');
const { sql, sqlOne, saveEvidence, POS_URL } = require('./driver.cjs');
const { computeInvoice } = require('./tax_oracle.cjs');
const manifest = require('./manifest.json');

const results = { scenarios: [], defects: [] };
function rec(id, title, status, evidence) {
  results.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1400));
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

/** Batch quantities keyed by batch id, for the products a bill touched. */
function batchState(storeId) {
  const rows = sql(`select id, product_id, batch_no, expiry_date, stock_qty from product_batches where store_id=${storeId}`);
  const map = {};
  for (const r of rows) map[r.id] = r;
  return map;
}

/** Build, tender and save one bill, then return its server-side rows. */
async function buildBill(s, storeCode, lines) {
  const store = manifest.stores[storeCode];
  const shownNumber = await newBill(s);
  const added = [];
  for (const l of lines) {
    const r = await addProduct(s, l.search, l.batch ? { batch: l.batch } : {});
    const id = r.ids[r.ids.length - 1];
    if (!id) return { ok: false, why: 'line not added', search: l.search };
    const q = await setQty(s, id, { packs: l.packs ?? 0, loose: l.loose ?? 0 });
    added.push({ ...l, lineId: id, qty: q, pickedBatch: r.pickedBatch });
  }
  const uiTotals = await readTotals(s);
  await openCheckout(s);
  const saved = await s.clickExact('Save (Ctrl+S)');
  if (!saved) { await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); }
  await sleep(7000);
  const inv = sql(`select * from invoices where store_id=${store.id} and invoice_number='${shownNumber}'`)[0] || null;
  return {
    ok: !!inv, shownNumber, added, uiTotals, inv,
    items: inv ? sql(`select * from invoice_items where invoice_id=${inv.id}`) : [],
    ledgerBefore: batchState(store.id),
    ledgerRowsBefore: inv ? sql(`select count(*) c from stock_ledger_entries where store_id=${store.id}`)[0].c : null,
  };
}

/** Drive the return screen for a given invoice; returns what the UI showed and the DB did. */
async function doReturn(s, invoiceNumber, { selectAll = false, qtyByIndex = null, refundMode = 'Cash', condition = null } = {}) {
  await s.key('Escape');            // close anything still floating over the counter
  await sleep(700);
  const nav = await navTo(s, '/returns/sales');
  await sleep(4000);
  const landed = (await s.text()).replace(/\n{3,}/g, '\n');
  if (!nav.ok || !/Sales Returns/i.test(landed)) return { ok: false, stage: 'navigate', nav, text: landed.slice(0, 400) };

  if (!(await s.clickExact('New Return (F7)'))) await s.key('F7');
  await sleep(1500);

  const searchSel = 'input[placeholder^="e.g. INV-001"]';
  try { await s.page.waitForSelector(searchSel, { visible: true, timeout: 10000 }); }
  catch { return { ok: false, stage: 'form', text: (await s.text()).slice(0, 400) }; }
  await s.page.click(searchSel);
  await s.page.keyboard.type(invoiceNumber, { delay: 30 });
  await sleep(2500);
  if (!(await s.clickExact(invoiceNumber))) return { ok: false, stage: 'invoice_pick', text: (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 600) };
  await sleep(2000);

  const lineTable = (await s.text()).replace(/\n{3,}/g, '\n');
  if (selectAll) { await s.clickText('Select All'); await sleep(1200); }
  if (Array.isArray(qtyByIndex)) {
    for (const [idx, val] of qtyByIndex.entries()) {
      if (val == null) continue;
      const sel = `input[type=number][max]:not([disabled])`;
      const handles = await s.page.$$(sel);
      if (!handles[idx]) { return { ok: false, stage: 'qty_input', why: `no qty input #${idx}`, visible: handles.length }; }
      await handles[idx].click();
      const id = await handles[idx].evaluate(el => { el.id = el.id || `qa-qty-${Math.random().toString(36).slice(2)}`; return el.id; });
      // number inputs reject setSelectionRange, so select() has to be the first attempt
      await s.page.evaluate((x) => { const el = document.getElementById(x); el.focus(); try { el.select(); } catch { try { el.setSelectionRange(0, el.value.length); } catch { /* nothing to clear */ } } }, id);
      await s.page.keyboard.type(String(val), { delay: 40 });
      await sleep(900);
    }
    // selecting a row is what enables its reason/condition controls
    if (!(await s.text()).includes('item(s) selected')) { /* still fine, totals below prove it */ }
  }
  if (condition) {
    await s.page.evaluate((cond) => {
      const sels = [...document.querySelectorAll('select')].filter(el => [...el.options].some(o => o.value === 'restock'));
      for (const el of sels) {
        el.value = cond;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, condition);
    await sleep(600);
  }
  const beforeSubmit = (await s.text()).replace(/\n{3,}/g, '\n');
  const creditShown = (beforeSubmit.match(/Credit Amount:\s*\n?\s*₹?\s*([\d,.]+)/i) || [])[1];
  const gstShown = (beforeSubmit.match(/GST Reversal:\s*\n?\s*₹?\s*([\d,.]+)/i) || [])[1];
  const grossShown = (beforeSubmit.match(/Gross Return:\s*\n?\s*₹?\s*([\d,.]+)/i) || [])[1];

  await s.clickText('Next: Payment');
  await sleep(1800);
  if (refundMode) { await s.clickText(refundMode); await sleep(800); }

  const saved = await s.clickExact('Save & Print Credit Note');
  if (!saved) return { ok: false, stage: 'save_button', text: (await s.text()).replace(/\n{3,}/g, '\n').slice(-600) };
  await sleep(8000);
  await s.page.keyboard.press('Escape');       // dismiss the credit-note print preview
  await sleep(1200);
  const after = (await s.text()).replace(/\n{3,}/g, '\n');
  return { ok: true, ui: { grossShown, gstShown, creditShown }, toast: (after.match(/Credit Note [A-Z0-9\-]+ created[^\n]*/i) || [])[0] || null, after: after.slice(-500) };
}

(async () => {
  const storeCode = 'QA-A';
  const store = manifest.stores[storeCode];
  const meta = storeMeta(store);

  const opened = await openCounter(store, store.users.cash, { counterName: 'QA A Returns Counter 1', sessionName: 'qaA_returns' });
  if (!opened.ok) { console.error('QA-A sign-in failed', JSON.stringify(opened.detail).slice(0, 300)); process.exit(1); }
  const s = opened.s;

  // ---------- C01: return everything on a two-line bill ----------
  const lines = [{ search: nm(storeCode, 'QA-DOLO650'), packs: 2, loose: 3 }, { search: nm(storeCode, 'QA-CROCIN'), packs: 1, loose: 5 }];
  const bill = await buildBill(s, storeCode, lines);
  if (!bill.ok) {
    rec('C01', 'Full sales return reverses money, tax and stock', 'BLOCKED', { why: 'the bill to be returned could not be created', bill });
  } else {
    const ret = await doReturn(s, bill.shownNumber, { selectAll: true });
    const cn = sql(`select * from invoices where store_id=${store.id} and module_key='credit_note' order by id desc limit 1`)[0] || null;
    const cnItems = cn ? sql(`select * from invoice_items where invoice_id=${cn.id}`) : [];
    const oracle = computeInvoice({
      store: { state_code: meta.state_code, tax_mode: meta.tax_mode, gst_type: meta.gst_type },
      price_basis: 'per_pack',
      // a full return must give back exactly what the bill charged: the same units valued the
      // same way (packs are 10-count strips, so the returned units are priced at rate/units)
      lines: lines.map(l => {
        const pr = Object.values(manifest.stores[storeCode].products).find(x => (x.search_name || x.name) === l.search);
        return { name: pr.name, packs: 0, loose_qty: (l.packs ?? 0) * pr.units_per_pack + (l.loose ?? 0), unit_price: pr.sel_rate, units_per_pack: pr.units_per_pack, gst_percent: pr.gst_percent };
      }),
    });
    const diffs = [];
    if (!ret.ok) diffs.push({ field: 'return UI', oracle: 'credit note created', actual: ret.stage });
    if (!cn) diffs.push({ field: 'credit note row', oracle: 'invoices row with module_key=credit_note', actual: 'none' });
    if (cn) {
      for (const [k, want] of [['taxable_subtotal', oracle.totals.taxable_subtotal], ['tax_total', oracle.totals.tax_total], ['grand_total', oracle.totals.grand_total]]) {
        if (!eq(cn[k], want)) diffs.push({ field: k, oracle: p(want), db: p(cn[k]) });
      }
      const split = Number(cn.cgst_total || 0) + Number(cn.sgst_total || 0) + Number(cn.igst_total || 0);
      if (!eq(split, cn.tax_total)) diffs.push({ field: 'cgst+sgst vs tax_total', oracle: p(split), db: p(cn.tax_total) });
      // the original bill's rates must survive into the reversal
      const rateWant = bill.items.map(i => `${i.gst_percent}`);
      const rateGot = cnItems.map(i => `${i.gst_percent}`);
      if (rateWant.join(',') !== rateGot.join(',')) diffs.push({ field: 'gst rates on the credit note', oracle: rateWant.join(','), db: rateGot.join(',') });
      // stock must go back to the batch the goods came out of
      const after = batchState(store.id);
      const restocked = Object.entries(after)
        .map(([id, b]) => ({ id, batch_no: b.batch_no, before: Number(bill.ledgerBefore[id] ? bill.ledgerBefore[id].stock_qty : 0), after: Number(b.stock_qty) }))
        .filter(x => x.before !== x.after);
      const unitsBack = restocked.reduce((a, x) => a + (x.after - x.before), 0);
      const unitsOut = Number(sqlOne(`select coalesce(sum(qty*units_per_pack + loose_qty),0) from invoice_items where invoice_id=${bill.inv.id}`));
      if (Math.abs(unitsBack - unitsOut) > 1e-6) diffs.push({ field: 'units restocked vs units sold', oracle: String(unitsOut), db: String(unitsBack) });
      const ledgers = sql(`select event_type, reference_type, reference_id, qty_delta, balance_after, batch_id from stock_ledger_entries where store_id=${store.id} and created_at >= datetime('${bill.inv.created_at}') order by id`);
      rec('C01', 'Full sales return reverses money, tax and stock', diffs.length ? 'FAIL' : 'PASS', {
        invoice: { number: bill.inv.invoice_number, taxable: p(bill.inv.taxable_subtotal), tax: p(bill.inv.tax_total), grand: p(bill.inv.grand_total) },
        return_ui: ret.ui, toast: ret.toast,
        credit_note: cn && { number: cn.invoice_number, module_key: cn.module_key, date: cn.invoice_date, taxable: p(cn.taxable_subtotal), tax: p(cn.tax_total), cgst: p(cn.cgst_total), sgst: p(cn.sgst_total), round: p(cn.round_off), grand: p(cn.grand_total), paid: p(cn.paid_amount), mode: cn.payment_mode, status: cn.status, counter_code: cn.counter_code },
        credit_note_items: cnItems.map(i => ({ name: i.product_name.slice(-3), qty: i.qty, loose: i.loose_qty, rate: i.unit_price, gst: i.gst_percent, taxable: i.taxable_amount, tax: i.tax_amount, total: i.total_amount, batch: i.batch_no })),
        oracle: { taxable: oracle.totals.taxable_subtotal, tax: oracle.totals.tax_total, grand: oracle.totals.grand_total },
        batches_moved: restocked,
        stock_ledger_after_sale: ledgers.slice(-6),
        credit_note_link_to_original: cn ? Object.keys(cn).filter(k => /original/i.test(k)) : null,
        diffs,
      });
      if (diffs.length) def({ id: 'RETURN-C01', severity: 'Critical', type: 'Logic', module: 'Sales Returns', title: 'Full sales return does not mirror the original bill', diffs, expected: oracle.totals, actual: cn });
    } else {
      rec('C01', 'Full sales return reverses money, tax and stock', 'FAIL', { ret, bill: bill.shownNumber });
    }

    // ---------- C02: how much is still returnable? ----------
    const ret2 = await doReturn(s, bill.shownNumber, {});
    const reopened = ret2.ok ? 'form reopened' : `blocked at ${ret2.stage}`;
    const txt = (await s.text()).replace(/\n{3,}/g, '\n');
    const fullyReturned = /Fully Returned/i.test(txt);
    rec('C02', 'A fully returned line cannot be returned again', fullyReturned ? 'PASS' : 'CHECK', {
      reopened, screen: txt.slice(-700), expectation: 'Max Return column shows 0 / "Fully Returned" and the row is disabled',
    });
  }

  // ---------- C03: over-return attempt ----------
  const bill2 = await buildBill(s, storeCode, [{ search: nm(storeCode, 'QA-BOX24'), packs: 1 }]);
  if (!bill2.ok) {
    rec('C03', 'Returning more than was sold is refused', 'BLOCKED', { why: 'no bill to over-return', bill2 });
  } else {
    const ret3 = await doReturn(s, bill2.shownNumber, { qtyByIndex: [999] });
    const cn2 = sql(`select * from invoices where store_id=${store.id} and module_key='credit_note' order by id desc limit 1`)[0] || null;
    const cn2i = cn2 ? sql(`select * from invoice_items where invoice_id=${cn2.id}`) : [];
    const overQty = cn2i.some(i => Number(i.qty) > 24);
    rec('C03', 'Returning more than was sold is refused', overQty ? 'FAIL' : (ret3.ok || ret3.stage ? 'CHECK' : 'CHECK'), {
      asked_qty: 999, sold: '1 box of 24', submit: ret3,
      credit_note: cn2 && { number: cn2.invoice_number, grand: p(cn2.grand_total) },
      credit_note_items: cn2i.map(i => ({ qty: i.qty, total: i.total_amount })),
      note: 'if a credit note exists with qty 999 the limit is not enforced anywhere',
    });
    if (overQty) def({ id: 'RETURN-C03', severity: 'Critical', type: 'Logic', module: 'Sales Returns', title: 'Returnable-qty limit is not enforced; 999 units were credited against a 24-unit sale', actual: cn2i });
  }

  // ---------- C04: cancel a bill ----------
  const bill3 = await buildBill(s, storeCode, [{ search: nm(storeCode, 'QA-SURG'), packs: 1 }]);
  if (!bill3.ok) {
    rec('C04', 'Cancelling a bill restores stock and keeps the number out of reports', 'BLOCKED', { why: 'no bill to cancel', bill3 });
  } else {
    const navBills = await navTo(s, '/bills');
    await sleep(4000);
    await s.typeByPlaceholder('Search', bill3.shownNumber).catch(() => {});
    await sleep(2000);
    const picked = await s.clickExact(bill3.shownNumber);
    await sleep(1500);
    const cancelClicked = await s.clickText('Cancel Bill');
    await sleep(1500);
    const modalText = (await s.text()).replace(/\n{3,}/g, '\n');
    let confirmed = false;
    if (cancelClicked) {
      await s.typeByPlaceholder('reason', 'QA damage in transit').catch(() => {});
      await sleep(600);
      confirmed = await s.clickText('Confirm Cancel') || await s.clickText('Cancel Bill') || await s.clickText('Confirm');
      await sleep(7000);
    }
    const after = sql(`select * from invoices where store_id=${store.id} and invoice_number='${bill3.shownNumber}'`)[0] || null;
    const afterBatches = batchState(store.id);
    const restored = Object.entries(afterBatches)
      .map(([id, b]) => ({ id, batch_no: b.batch_no, before: Number(bill3.ledgerBefore[id] ? bill3.ledgerBefore[id].stock_qty : 0), after: Number(b.stock_qty) }))
      .filter(x => x.before !== x.after);
    rec('C04', 'Cancelling a bill restores stock and marks the bill cancelled',
      after && /cancel/i.test(String(after.status)) && restored.length ? 'PASS' : 'CHECK', {
      clicked_cancel: !!cancelClicked, confirmed, modal_text: modalText.slice(-500),
      invoice_now: after && { status: after.status, grand: p(after.grand_total), cancel_reason: after.cancel_reason, cancelled_at: after.cancelled_at, cancelled_by: after.cancelled_by },
      batches_moved: restored,
    });
  }

  // ---------- C05: is the credit note linked to its original invoice on the server? ----------
  const cols = sql("pragma table_info(invoices)").map(c => c.name);
  const cnAny = sql(`select * from invoices where store_id=${store.id} and module_key='credit_note' order by id desc limit 1`)[0] || null;
  const orphan = cnAny && !cnAny.customer_phone && !cols.some(c => /original/i.test(c));
  rec('C05', 'A credit note can be traced back to the bill it reverses',
    cnAny ? (cols.some(c => /original/i.test(c)) ? 'PASS' : 'FAIL') : 'BLOCKED', {
    invoices_columns: cols, credit_note: cnAny && { number: cnAny.invoice_number, status: cnAny.status, mode: cnAny.payment_mode, counter: cnAny.counter_code },
    client_sends: 'salesReturnService writes original_invoice_number onto the credit-note record',
    note: 'the server table has no column for it, so the reference is dropped on sync',
  });
  if (cnAny && !cols.some(c => /original/i.test(c))) {
    def({ id: 'CN-ORPHAN', severity: 'High', type: 'Data', module: 'Sales Returns / Sync',
      title: 'Credit notes reach the server without any link to the invoice they reverse',
      expected: 'the original invoice number stored with the credit note',
      actual: 'invoices has no original_invoice_* column; the client field is discarded',
      suspected: 'frontend/src/lib/billing/salesReturnService.ts:429-456 mirror record vs backend/database/migrations invoices table' });
  }

  await s.close();
  saveEvidence('C_returns.json', results);
  console.log('\ncredit notes:', JSON.stringify(sql(`select invoice_number,module_key,status,taxable_subtotal,tax_total,grand_total,paid_amount,payment_mode,counter_code from invoices where store_id=${store.id} and module_key='credit_note'`)));
  fs.writeFileSync(path.join(__dirname, 'C_summary.json'), JSON.stringify(results.scenarios.map(x => ({ id: x.id, status: x.status })), null, 1));
})().catch(e => { console.error(e); saveEvidence('C_returns.json', results); process.exit(1); });
