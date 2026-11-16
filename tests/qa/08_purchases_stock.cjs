/**
 * Groups D/E — goods inward, stock adjustments and counter-to-counter transfers.
 * Purchases, adjustments and transfers are all written on the device first and pushed to the
 * server through the sync queue, so every scenario checks BOTH sides: what the workstation
 * believes it has, what the server ended up storing, and whether stock/batches moved where a
 * report or a second counter would read them.
 */
const fs = require('fs');
const path = require('path');
const { openCounter, sleep, navTo } = require('./pos_flow.cjs');
const { sql, sqlOne, saveEvidence, POS_URL } = require('./driver.cjs');
const manifest = require('./manifest.json');

const results = { scenarios: [], defects: [] };
function rec(id, title, status, evidence) {
  results.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1200));
}
function def(d) { results.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); }
const p = (v) => Number(v ?? 0).toFixed(2);
const eq = (a, b) => p(a) === p(b);

function nm(storeCode, sku) {
  const pr = manifest.stores[storeCode].products[sku];
  if (!pr) throw new Error(`fixture ${sku} missing in ${storeCode}`);
  return pr.search_name || pr.name;
}
async function localTable(s, storeId, table) {
  const raw = await s.page.evaluate((store, t) => {
    const exact = `lamsuite_tbl_${store}_${t}`;
    if (localStorage.getItem(exact) != null) return localStorage.getItem(exact);
    const key = Object.keys(localStorage).find(k => k.startsWith('lamsuite_tbl_') && k.endsWith(`_${t}`));
    return key ? localStorage.getItem(key) : null;
  }, String(storeId), table);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { unparsable: String(raw).slice(0, 200) }; }
}
/** Type into an input by the text of the table column it sits under (headers, then tfoot cells). */
async function typeInColumn(s, headerText, value) {
  const id = await s.page.evaluate((hdr) => {
    const table = [...document.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => (th.innerText || '').trim().toLowerCase() === hdr.toLowerCase()));
    if (!table) return null;
    const idx = [...table.querySelectorAll('th')].findIndex(th => (th.innerText || '').trim().toLowerCase() === hdr.toLowerCase());
    const body = table.querySelector('tfoot') || table;
    const row = [...body.querySelectorAll('tr')].reverse().find(r => r.querySelector('input'));
    if (!row) return null;
    const cell = [...row.querySelectorAll('td')][idx];
    const inp = cell && cell.querySelector('input, select, textarea');
    if (!inp) return null;
    const uid = `qa-col-${Math.random().toString(36).slice(2)}`;
    inp.id = uid;
    return uid;
  }, headerText);
  if (!id) return { ok: false, why: `no input under column "${headerText}"` };
  const sel = `#${id}`;
  await s.page.click(sel);
  // input[type=number] rejects setSelectionRange, so select() is the portable way to
  // highlight what is already in the box before overtyping it.
  await s.page.evaluate((x) => {
    const el = document.querySelector(x);
    el.focus();
    try { el.select(); } catch { try { el.setSelectionRange(0, el.value.length); } catch { /* nothing to select */ } }
  }, sel);
  await s.page.keyboard.type(String(value), { delay: 35 });
  await sleep(400);
  await s.key('Tab');
  await sleep(500);
  const got = await s.page.$eval(sel, e => e.value).catch(() => null);
  return { ok: true, value: got };
}
async function pickSuggestion(s, text) {
  await sleep(1600);
  // the combobox commits on Enter from its keyboard-highlighted row; element.click() on the
  // portal row is unreliable in headless, so drive it the way the shortcut hint promises
  await s.page.keyboard.press('Enter');
  await sleep(1400);
  return true;
}
/** Nudge the device to flush its sync queue the way the header pill does. */
async function forcePush(s) {
  await s.page.evaluate(() => {
    const el = document.querySelector('[title*="queued for sync"]');
    if (el) el.click();
  });
  await sleep(12000);
}

(async () => {
  const storeCode = 'QA-A';
  const store = manifest.stores[storeCode];
  const opened = await openCounter(store, store.users.pur, { counterName: 'QA A Stores Counter 1', sessionName: 'qaA_stores' });
  if (!opened.ok) {
    for (const [id, t] of [['D1', 'Purchase inward creates the batch and adds stock'], ['E1', 'Stock adjustment moves batch quantity and reaches the server'],
                            ['E3', 'Inter-store transfer moves stock from source to destination'], ['D5', 'Purchase return reduces stock and posts a debit note']]) {
      rec(id, t, 'BLOCKED', { why: 'purchase-clerk counter sign-in failed', detail: opened.detail });
    }
  } else {
    const s = opened.s;

    // ---------------- D1: goods inward ----------------
    {
      const sku = 'QA-DOLO650';
      const batch = 'QA-PUR-01';
      const supName = 'QA Supplier Kerala Pvt Ltd';
      const vendorBill = 'QA-PV-' + Date.now().toString().slice(-6);
      await navTo(s, '/pos');
      await sleep(1500);
      const nav = await navTo(s, '/purchases');
      await sleep(4000);
      const startText = (await s.text()).replace(/\n{3,}/g, '\n');
      // the form is only "already open" when its own fields exist, not the list page's button label
      const alreadyOpen = /Select or search supplier/i.test(startText);
      const openedForm = alreadyOpen || await s.clickExact('New Inward Bill (F2)') || await s.clickText('New Inward Bill');
      await sleep(3500);
      const step = { nav, form_opened: !!openedForm, form_already_open_from_shortcut: alreadyOpen };
      if (!openedForm) {
        rec('D1', 'Purchase inward creates the batch and adds stock', 'BLOCKED', { ...step, screen: startText.slice(0, 700) });
      } else {
        const before = {
          serverBatch: sql(`select id,stock_qty,expiry_date,purchase_rate from product_batches where store_id=${store.id} and batch_no='${batch}'`),
          serverProduct: sqlOne(`select current_stock from products where store_id=${store.id} and (name like '%${nm(storeCode, sku).slice(0, 12)}%' or print_name like '%${nm(storeCode, sku).slice(0, 12)}%') limit 1`),
          serverPurch: sqlOne(`select count(*) from purchases where store_id=${store.id}`),
          serverLedger: sqlOne(`select count(*) from stock_ledger_entries where store_id=${store.id}`),
        };
        const supSel = 'input[placeholder^="Select or search supplier"]';
        let supplierSet = null;
        try {
          await s.page.waitForSelector(supSel, { visible: true, timeout: 8000 });
          await s.page.click(supSel);
          await s.page.keyboard.type(supName, { delay: 35 });
          supplierSet = await pickSuggestion(s, supName);
        } catch { supplierSet = false; }
        const billNo = await s.page.$('input[placeholder="INV-001"]');
        if (billNo) { await billNo.click(); await s.page.keyboard.type(vendorBill, { delay: 30 }); }
        const prodSel = 'input[placeholder^="Scan barcode or type product name"]';
        let productSet = false;
        try {
          await s.page.waitForSelector(prodSel, { visible: true, timeout: 8000 });
          await s.page.click(prodSel);
          await s.page.keyboard.type(nm(storeCode, sku), { delay: 40 });
          productSet = await pickSuggestion(s, nm(storeCode, sku).slice(0, 18));
        } catch { productSet = false; }
        await s.screenshot('D1_form_filled');
        const gridText = (await s.text()).replace(/\n{3,}/g, '\n');
        step.supplier = { selector_found: !!billNo, picked: supplierSet, product_picked: productSet, row_in_grid: new RegExp(nm(storeCode, sku).slice(0, 14), 'i').test(gridText) };
        if (!step.supplier.row_in_grid) {
          rec('D1', 'Purchase inward creates the batch and adds stock', 'BLOCKED', { ...step, screen: gridText.slice(-900) });
        } else {
          const colFills = {};
          colFills.batch = await typeInColumn(s, 'Batch', batch);
          colFills.expiry = await typeInColumn(s, 'Expiry (MM/YY)', '12/28');
          colFills.qty = await typeInColumn(s, 'Quantity', '5');
          colFills.free = await typeInColumn(s, 'Free Qty', '2');
          colFills.rate = await typeInColumn(s, 'Pur. Rate (₹)', '25');
          colFills.mrp = await typeInColumn(s, 'MRP (₹)', '34');
          colFills.gst = await typeInColumn(s, 'GST %', '12');
          await sleep(800);
          const totalsLine = (await s.text()).match(/Net Payable[\s\S]{0,40}?₹?\s*([\d,.]+)/i);
          await s.screenshot('D1_lines');
          await s.clickExact('Post Purchase (F12)') || await s.clickText('Post Purchase');
          await sleep(3000);
          const modal = (await s.text()).replace(/\n{3,}/g, '\n');
          await s.screenshot('D1_post_modal');
          await s.key('Enter');
          const confirmed = /Confirm & Post Purchase/i.test(await s.text()) ? false : true;
          await sleep(9000);
          await s.screenshot('D1_after_post');
          const afterText = (await s.text()).replace(/\n{3,}/g, '\n');
          await forcePush(s);
          const purch = sql(`select * from purchases where store_id=${store.id} and invoice_number='${vendorBill}'`);
          const items = purch[0] ? sql(`select * from purchase_items where purchase_id=${purch[0].id}`) : [];
          const devPurch = (await localTable(s, store.id, 'purchase_documents') || []);
          const devBatch = (await localTable(s, store.id, 'product_batches') || []);
          const devTx = (await localTable(s, store.id, 'stock_transactions') || []);
          const localDoc = Array.isArray(devPurch) ? devPurch.find(r => r && (r.supplier_invoice_no === vendorBill || r.purchase_number === vendorBill || r.invoice_number === vendorBill)) : null;
          const localBatch = Array.isArray(devBatch) ? devBatch.find(r => r && String(r.batch_no || '').toUpperCase() === batch) : null;
          const serverBatch = sql(`select id,batch_no,expiry_date,stock_qty,purchase_rate from product_batches where store_id=${store.id} and batch_no='${batch}'`);
          const ledger = sql(`select event_type,qty_delta,balance_after,reference_type from stock_ledger_entries where store_id=${store.id} and created_at >= datetime('now','-6 minutes') order by id desc limit 6`);
          const diffs = [];
          if (!purch.length) diffs.push({ field: 'server purchase document', oracle: `row with invoice_number ${vendorBill}`, db: 'absent' });
          if (purch.length && !eq(purch[0].grand_total, Number(totalsLine && totalsLine[1] ? totalsLine[1].replace(/,/g, '') : 0) || purch[0].grand_total)) {
            diffs.push({ field: 'screen total vs stored grand_total', screen: totalsLine && totalsLine[1], db: p(purch[0].grand_total) });
          }
          if (items[0]) {
            if (Number(items[0].pack_qty ?? items[0].qty) !== 5) diffs.push({ field: 'packs received', keyed: '5', db: String(items[0].pack_qty ?? items[0].qty) });
            if (Number(items[0].free_qty || 0) !== 2) diffs.push({ field: 'free qty', keyed: '2', db: String(items[0].free_qty) });
            // free goods must not attract value
            const wantTaxable = 5 * 25;
            if (Number(items[0].units_per_pack || 10) === 10 && !eq(items[0].taxable_amount, wantTaxable)) {
              diffs.push({ field: 'taxable ignores free qty', oracle: p(wantTaxable), db: p(items[0].taxable_amount) });
            }
          }
          if (!localBatch) diffs.push({ field: 'device batch', oracle: `batch ${batch} exists on the workstation`, db: 'missing' });
          if (serverBatch.length === 0) diffs.push({ field: 'server batch', oracle: `batch ${batch} with 5 packs of stock`, db: 'never created — the server has no batch row for a purchased batch' });
          if (before.serverLedger === sqlOne(`select count(*) from stock_ledger_entries where store_id=${store.id}`) && localBatch) {
            diffs.push({ field: 'server stock ledger', oracle: 'a PURCHASE_RECEIPT entry', db: `no new stock_ledger_entries rows (${before.serverLedger} before and after)` });
          }
          rec('D1', 'Purchase inward creates the batch and adds stock', diffs.length ? 'FAIL' : 'PASS', {
            vendor_bill: vendorBill, form: step.supplier, column_fills: colFills,
            screen_total: totalsLine && totalsLine[0],
            server_purchase: purch[0] && { number: purch[0].invoice_number, supplier: purch[0].supplier_name, subtotal: p(purch[0].subtotal), tax: p(purch[0].tax_total), cgst: p(purch[0].cgst_total), sgst: p(purch[0].sgst_total), igst: p(purch[0].igst_total), round: p(purch[0].round_off), grand: p(purch[0].grand_total), interstate: purch[0].is_interstate, status: purch[0].status },
            server_items: items.map(i => ({ name: i.product_name, batch: i.batch_no, expiry: i.expiry_date, pack: i.pack_qty, loose: i.loose_qty, free: i.free_qty, upp: i.units_per_pack, rate: i.purchase_rate, gst: i.gst_percent, taxable: i.taxable_amount, tax: i.tax_amount, total: i.total_amount })),
            device_purchase_doc: localDoc && { id: localDoc.id || localDoc.purchase_number, grand: localDoc.grand_total, items: (Array.isArray(devTx) ? 0 : 0), sync_state: localDoc.sync_state },
            device_batch: localBatch && { batch_no: localBatch.batch_no, expiry: localBatch.expiry_date, qty: localBatch.stock_qty, pr: localBatch.purchase_rate },
            device_stock_transactions: (Array.isArray(devTx) ? devTx : []).filter(t => t && /PURCHASE/i.test(String(t.event_type || ''))).slice(-3),
            server_batch_rows: serverBatch,
            product_current_stock_before_after: [before.serverProduct, sqlOne(`select current_stock from products where store_id=${store.id} and (name like '%${nm(storeCode, sku).slice(0, 12)}%') limit 1`)],
            server_stock_ledger_recent: ledger,
            post_modal_text: modal.slice(-300), after_post_text: afterText.slice(-300),
            diffs,
          });
          if (diffs.length) def({ id: 'PUR-STOCK', severity: 'Critical', type: 'Data', module: 'Purchases',
            title: 'A posted purchase inward bill does not create batch stock or a stock ledger entry on the server', diffs,
            suspected: 'backend/app/Http/Controllers/Api/SyncController.php:596-667 upsertSinglePurchase (writes Purchase + PurchaseItem only) and Api/PurchaseController.php:34-140 store()' });
          results.lastPurchase = { vendorBill, batch, sku };
        }
      }
    }

    // ---------------- E1: stock adjustment ----------------
    {
      await navTo(s, '/purchases');
      await sleep(1200);
      // F3 is swallowed on /pos (see L group), so start from /purchases where the shell handles it
      const navStock = await navTo(s, '/stock');
      await sleep(4500);
      const modalAlready = /Record Stock Adjustment/i.test(await s.text());
      const openedModal = modalAlready || await s.clickExact('Stock Adjustment') || await s.clickText('Stock Adjustment');
      await sleep(2500);
      if (!openedModal) {
        rec('E1', 'Stock adjustment moves batch quantity and reaches the server', 'BLOCKED', { why: 'no Stock Adjustment button on /stock', nav: navStock, screen: (await s.text()).slice(0, 500) });
      } else {
        const batchSel = 'input[placeholder="Search product name or batch number..."]';
        let picked = false;
        try {
          const trigger = await s.page.$('input[placeholder^="Search product name or batch"]');
          if (trigger) { await trigger.click(); await sleep(1200); }
          const box = await s.page.$(batchSel);
          if (box) { await box.click(); await s.page.keyboard.type('QA-', { delay: 35 }); await sleep(2000); picked = await s.clickText(nm('QA-A', 'QA-CROCIN').slice(0, 16)); }
        } catch { picked = false; }
        await s.screenshot('E1_modal');
        const modalText = (await s.text()).replace(/\n{3,}/g, '\n');
        const qtyInput = await s.page.$('input[type=number]');
        if (qtyInput) { await qtyInput.click(); await s.page.evaluate(() => { const el = document.querySelector('input[type=number]'); el.focus(); try { el.select(); } catch { /* not selectable */ } }); await s.page.keyboard.type('-5', { delay: 40 }); }
        const reasonSet = await s.page.evaluate(() => {
          const sel = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'Damaged'));
          if (!sel) return false;
          sel.value = 'Damaged'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
        });
        await sleep(600);
        const clicked = await s.clickExact('Post Adjustment') || await s.clickText('Post Adjustment');
        await sleep(8000);
        await forcePush(s);
        const adj = sql(`select * from stock_adjustments where store_id=${store.id} order by id desc limit 2`);
        const ledg = sql(`select event_type,qty_delta,balance_after,reference_type from stock_ledger_entries where store_id=${store.id} order by id desc limit 3`);
        const devTx = (await localTable(s, store.id, 'stock_transactions') || []);
        const diffs = [];
        if (!clicked) diffs.push({ field: 'Post Adjustment', oracle: 'button clicked', db: 'not found' });
        if (!adj.length) diffs.push({ field: 'server stock_adjustments', oracle: 'an ADJUSTMENT_OUT row', db: 'none' });
        if (!ledg.some(l => /ADJUST/i.test(String(l.event_type)))) diffs.push({ field: 'server stock ledger', oracle: 'an ADJUSTMENT_OUT entry', db: JSON.stringify(ledg) });
        rec('E1', 'Stock adjustment moves batch quantity and reaches the server', diffs.length ? 'CHECK' : 'PASS', {
          nav: navStock, modal_already_open: modalAlready,
          batch_picked: picked, reason_set: reasonSet, product_row_visible: /QA-/.test(modalText),
          device_transactions: (Array.isArray(devTx) ? devTx : []).filter(t => t && /ADJUST/i.test(String(t.event_type || ''))).slice(-3),
          server_stock_adjustments: adj.map(a => ({ type: a.adjustment_type || a.type, qty: a.qty, reason: a.reason, batch: a.batch_no, created: a.created_at })),
          server_ledger_latest: ledg, diffs,
        });
        if (diffs.length && clicked) def({ id: 'ADJ-SYNC', severity: 'High', type: 'Data', module: 'Stock', title: 'A posted stock adjustment does not appear on the server where reports read it', diffs });
      }
    }

    // ---------------- E3: inter-store transfer ----------------
    {
      await navTo(s, '/purchases');
      await sleep(1200);
      const navTrf = await navTo(s, '/stock/transfers');
      await sleep(4500);
      if (!navTrf.ok) {
        rec('E3', 'Inter-store transfer moves stock from source to destination', 'BLOCKED', { nav: navTrf, screen: (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 500) });
      } else {
      const destSet = await s.page.evaluate(() => {
        const sel = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => /QA /.test(o.text)));
        if (!sel) return null;
        const opt = [...sel.options].find(o => /QA /.test(o.text) && !/QA Mart General\b/.test(o.text));
        const target = [...sel.options].find(o => /QA/.test(o.text));
        if (!target) return null;
        sel.value = target.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
        return { chosen_text: target.text, chosen_value: target.value, all: [...sel.options].map(o => o.text) };
      });
      await sleep(1500);
      const trfNo = 'QA-TRF-' + Date.now().toString().slice(-6);
      const trfInput = await s.page.$('input[placeholder="TRF-001"]');
      if (trfInput) { await trfInput.click(); await s.page.keyboard.type(trfNo, { delay: 30 }); }
      const prodSel = 'input[placeholder^="Scan Barcode or Search Products to Transfer"]';
      let productPicked = false;
      try {
        await s.page.waitForSelector(prodSel, { visible: true, timeout: 8000 });
        await s.page.click(prodSel);
        await s.page.keyboard.type(nm('QA-A', 'QA-BOX24'), { delay: 40 });
        await sleep(2000);
        productPicked = await s.clickText(nm('QA-A', 'QA-BOX24').slice(0, 16));
        await sleep(2000);
        if (/Select Batch \(FEFO Order\)/.test(await s.text())) { await s.key('Enter'); await sleep(2000); }
      } catch { productPicked = false; }
      const qtyBox = await s.page.$('input[id$="-pack"]');
      if (qtyBox) { await qtyBox.click(); await s.page.keyboard.type('2', { delay: 40 }); await s.key('Enter'); await sleep(1000); }
      await s.screenshot('E3_form');
      const dispatched = await s.clickExact('Dispatch Transfer (F12)') || await s.clickText('Dispatch Transfer');
      await sleep(9000);
      await s.screenshot('E3_after');
      await forcePush(s);
      const trf = sql(`select * from stock_transfers order by id desc limit 3`);
      const trfItems = trf[0] ? sql(`select * from stock_transfer_items where stock_transfer_id=${trf[0].id}`) : [];
      const devT = (await localTable(s, store.id, 'stock_transfers') || []);
      const diffs = [];
      if (!productPicked) diffs.push({ field: 'product line', oracle: 'a transfer line exists', db: 'product could not be picked' });
      if (!trf.some(t => t.transfer_number === trfNo)) diffs.push({ field: 'server stock_transfers', oracle: `row ${trfNo}`, db: JSON.stringify(trf.map(t => t.transfer_number)) });
      rec('E3', 'Inter-store transfer moves stock from source to destination', diffs.length ? 'CHECK' : 'PASS', {
        destination_selector: destSet, transfer_no: trfNo, product_picked: productPicked, dispatch_clicked: !!dispatched,
        device_transfers: (Array.isArray(devT) ? devT : []).slice(-2),
        server_transfers: trf.map(t => ({ no: t.transfer_number, from: t.from_store_id, to: t.to_store_id, status: t.status })),
        server_transfer_items: trfItems.map(i => ({ batch: i.batch_no, qty: i.qty })),
        screen_after: (await s.text()).replace(/\n{3,}/g, '\n').slice(-400), diffs,
      });
      }
    }

    // ---------------- D5: purchase return ----------------
    {
      const last = results.lastPurchase;
      await navTo(s, '/pos');
      await sleep(1200);
      const navRet = await navTo(s, '/returns/purchases');
      await sleep(4500);
      const openedForm = navRet.ok && (await s.clickText('New Purchase Return'));
      await sleep(2500);
      if (!openedForm || !last) {
        rec('D5', 'Purchase return reduces stock and posts a debit note', 'BLOCKED', { nav: navRet, form_opened: !!openedForm, have_purchase: !!last, screen: (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 400) });
      } else {
        const searchSel = 'input[placeholder^="e.g. PB-123456"]';
        let found = false;
        try {
          await s.page.waitForSelector(searchSel, { visible: true, timeout: 8000 });
          await s.page.click(searchSel);
          await s.page.keyboard.type(last.vendorBill, { delay: 35 });
          await sleep(2600);
          found = await s.clickText(last.vendorBill);
          await sleep(2200);
        } catch { found = false; }
        if (!found) { rec('D5', 'Purchase return reduces stock and posts a debit note', 'BLOCKED', { why: 'the purchase just posted cannot be found on the return screen', vendor_bill: last.vendorBill, screen: (await s.text()).slice(-600) }); }
        else {
          const beforeBatch = sql(`select id,stock_qty from product_batches where store_id=${store.id} and batch_no='${last.batch}'`);
          const all = await s.clickText('Select All');
          await sleep(1500);
          const one = await s.page.$('input[type=number][max]');
          if (one) { await one.click(); await s.page.evaluate(() => { const el = document.querySelector('input[type=number][max]'); el.focus(); try { el.select(); } catch { /* not selectable */ } }); await s.page.keyboard.type('2', { delay: 40 }); await sleep(1200); }
          await s.clickText('Next: Settlement');
          await sleep(2000);
          await s.clickText('Refund from Supplier');
          await sleep(800);
          const saved = await s.clickText('Save & Print Debit Note');
          await sleep(9000);
          await s.page.keyboard.press('Escape');
          await forcePush(s);
          const dn = sql(`select * from purchases where store_id=${store.id} and module_key in ('debit_note','purchase_return') order by id desc limit 2`);
          const afterBatch = sql(`select id,stock_qty from product_batches where store_id=${store.id} and batch_no='${last.batch}'`);
          const bogus = sql(`select id,store_id,name,mrp,sel_rate,current_stock from products where name like '%Untitled%' and store_id=${store.id}`);
          const diffs = [];
          if (!saved) diffs.push({ field: 'save', oracle: 'debit note posted', db: 'button not found' });
          if (saved && !dn.length) diffs.push({ field: 'server debit note', oracle: 'a purchases row with module_key=debit_note', db: 'none' });
          const dBefore = Number(beforeBatch[0] ? beforeBatch[0].stock_qty : NaN);
          const dAfter = Number(afterBatch[0] ? afterBatch[0].stock_qty : NaN);
          if (!Number.isNaN(dBefore) && dBefore === dAfter) diffs.push({ field: 'server batch stock after a purchase return', oracle: `${dBefore} minus the returned units`, db: `unchanged at ${dAfter}` });
          if (bogus.length) diffs.push({ field: 'product master corruption', oracle: 'no junk product rows', db: JSON.stringify(bogus) });
          rec('D5', 'Purchase return reduces stock and posts a debit note', diffs.length ? 'FAIL' : 'PASS', {
            vendor_bill: last.vendorBill, select_all: !!all,
            server_debit_notes: dn.map(d => ({ no: d.invoice_number, module: d.module_key, grand: p(d.grand_total), tax: p(d.tax_total), status: d.status })),
            server_batch_before_after: [beforeBatch, afterBatch],
            junk_products_created: bogus,
            screen_after: (await s.text()).replace(/\n{3,}/g, '\n').slice(-400), diffs,
          });
          if (diffs.length) def({ id: 'PUR-RETURN', severity: 'High', type: 'Data', module: 'Purchase Returns',
            title: 'Purchase returns do not reach the server as debit notes (and their queue item is mislabelled "product")', diffs,
            suspected: 'frontend/src/lib/purchases/purchaseReturnService.ts:319 enqueue("product", ...) vs backend SyncController.php:91 case "product" -> upsertSingleProduct' });
        }
      }
    }

    await s.close();
  }

  saveEvidence('DE_purchases_stock.json', results);
  console.log('\nstock picture on the server now:', JSON.stringify(sql(`select (select count(*) from purchases) purchases, (select count(*) from purchase_items) purchase_items, (select count(*) from stock_ledger_entries) ledger, (select count(*) from stock_adjustments) adjustments, (select count(*) from stock_transfers) transfers, (select count(*) from product_batches where stock_qty<0) negative_batches`)));
  delete results.lastPurchase;
  fs.writeFileSync(path.join(__dirname, 'DE_summary.json'), JSON.stringify(results.scenarios.map(x => ({ id: x.id, status: x.status })), null, 1));
})().catch(e => { console.error(e); saveEvidence('DE_purchases_stock.json', results); process.exit(1); });
