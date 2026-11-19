/**
 * S3 — purchase inward bill and purchase return (debit note), through the POS web UI.
 *
 * The inward grid keeps committed lines in <tbody> and a permanent product-entry row
 * in <tfoot>, so each line is built in the draft row and promoted with Enter on an
 * empty product box (commitEntryRow).
 * S3SURVEY=1 stops after building the draft lines and dumps the real controls.
 */
const {
  storeByCode, fixture, login, shot, sleep, navTo, sql, saveEvidence, localTable, localQueue,
  readGrid, setInput, cmp,
  draftRowText, addDraftProduct, setDraftBatch, setDraftField,
} = require('./gst_kit.cjs');
const { computeInvoice } = require('./tax_oracle.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const SURVEY = process.env.S3SURVEY === '1';
const GRID = 'table[aria-label="Purchase Inward Items"]';
const stamp = String(Date.now()).slice(-6);
const PUR_INV = `QA-PUR-${stamp}`;

const out = { scenarios: [], defects: [], notes: [], purchase: {}, ret: {} };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 9000));
};
const def = (d) => { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); };

function batchMap(productId, storeId) {
  const m = {};
  for (const b of sql(`select batch_no, stock_qty from product_batches where product_id=${productId} and store_id=${storeId}`)) {
    m[b.batch_no] = Number(b.stock_qty);
  }
  return m;
}

async function tillBatchMap(s, productId, storeId) {
  const { rows } = await localTable(s, 'product_batches', storeId);
  const m = {};
  for (const b of rows) if (String(b.product_id) === String(productId)) m[b.batch_no] = Number(b.stock_qty);
  return m;
}

/** Purchase footer summary strip: Subtotal / GST Tax / Round / Net Payable. */
async function readPurchaseTotals(s) {
  const t = await s.text();
  const num = (re) => { const m = t.match(re); return m ? Number(m[1].replace(/[^0-9.\-]/g, '')) : null; };
  return {
    subtotal: num(/Subtotal:\s*₹\s*([\d,.]+)/i),
    tax: num(/(?:IGST|GST) Tax:\s*₹\s*([\d,.]+)/i),
    round_off: num(/Round:\s*[+-]?₹\s*([\d,.]+)/i),
    net_payable: num(/Net Payable\s*₹\s*([\d,.]+)/i),
    tail: t.replace(/\n{3,}/g, '\n').slice(-800),
  };
}

async function pickSupplier(s, name) {
  // the purchases dashboard behind the overlay has its own "Search Bill #, Supplier..."
  // box, so only the combobox-role input is the real supplier field
  const sel = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input[role="combobox"]')]
      .find(e => e.offsetParent !== null && /select or search supplier/i.test(e.placeholder || ''));
    if (!el) return null;
    el.setAttribute('data-qa-sup', '1');
    return 'input[data-qa-sup="1"]';
  });
  if (!sel) return { ok: false, why: 'no supplier combobox' };
  await s.page.click(sel);
  await sleep(500);
  await s.page.keyboard.type(name, { delay: 40 });
  await sleep(2200);
  const opt = await s.page.evaluate((n) => {
    const el = [...document.querySelectorAll('[role="option"]')].find(e => e.offsetParent !== null && (e.innerText || '').includes(n));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 70) };
  }, name);
  if (opt) { await s.page.mouse.click(opt.x, opt.y); await sleep(1800); }
  else await s.key('Enter');
  await sleep(1000);
  const value = await s.page.evaluate(() => { const el = document.querySelector('input[data-qa-sup="1"]'); return el ? el.value : null; });
  return { ok: !!value && value.toLowerCase().includes('supplier'), value, clicked_option: opt ? opt.text : 'enter' };
}

/**
 * Everything the post gates read: supplier, vendor bill number, the post button's
 * own state, committed lines and any overlay sitting on top of the form.
 * The form's F12 listener never runs: the global capture-phase dispatcher claims
 * F12 as "Switch Account" (centralKeyMap.ts:121) with no `purchase`-scope
 * registration in production code, so posting has to come from the button.
 */
function headerState(s) {
  return s.page.evaluate(() => {
    const val = (re) => {
      const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && re.test(e.placeholder || ''));
      return el ? el.value : null;
    };
    const btn = [...document.querySelectorAll('button')].find(b =>
      b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().startsWith('Post Purchase'));
    return {
      supplier: val(/select or search supplier/i),
      vendor_bill_no: val(/^INV-001$/),
      post_button: btn ? { text: (btn.innerText || '').replace(/\s+/g, ' ').trim(), disabled: btn.disabled } : null,
      tbody_rows: document.querySelectorAll('table[aria-label="Purchase Inward Items"] tbody tr').length,
      overlays: [...document.querySelectorAll('[role="dialog"]')]
        .map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 60)),
      switcher_open: /Switch Counter Cashier|Switch Account/i.test(document.body.innerText),
      post_modal_in_dom: /Confirm & Post Purchase/.test(document.body.innerText),
    };
  });
}

/** Close the "Switch Counter Cashier" overlay without touching the form's own Cancel. */
function closeSwitcher(s) {
  return s.page.evaluate(() => {
    const hosts = [...document.querySelectorAll('div')]
      .filter(d => /Switch Counter Cashier|Switch Account/i.test(d.innerText || ''))
      .sort((a, b) => a.innerText.length - b.innerText.length);
    for (const h of hosts) {
      const btn = [...h.querySelectorAll('button')].find(b => /^(cancel|close)$/i.test((b.innerText || '').trim()));
      if (btn) { btn.click(); return true; }
    }
    return false;
  });
}

/** Committed lines for one product (the empty-state placeholder row never matches a name). */
async function committedRows(s) {
  const grid = await readGrid(s, GRID);
  return grid.rows.filter(r => r.length > 1);
}

/**
 * Enter in the draft row's last input (selling rate) is what runs commitEntryRow();
 * Enter on the product box only works when the search *state* is empty, which the
 * harness cannot guarantee after a selection.
 */
async function addPurchaseLine(s, prod, { batch, expiry, packs, rate }) {
  const before = (await committedRows(s)).length;
  const step = { supplier_trace: {} };
  const trace = async (label) => {
    const h = await headerState(s);
    step.supplier_trace[label] = h.supplier === null ? 'no-field' : (h.supplier || 'CLEARED');
  };
  step.product = await addDraftProduct(s, prod.name);
  await trace('product');
  if (!step.product.ok) return { ...step, ok: false };
  step.batch = await setDraftBatch(s, batch);
  await trace('batch');
  step.expiry = await setDraftField(s, 'MM/YY', expiry);
  // the field normalises MM/YY into an ISO month-end, so an exact echo is not expected
  step.expiry.ok = !!step.expiry.after;
  await trace('expiry');
  step.qty = await setDraftField(s, 'Packs', packs);
  await trace('qty');
  step.rate = await setDraftField(s, 'Rate', rate);
  await trace('rate');
  step.draft_before_commit = await draftRowText(s);
  step.sell = await setDraftField(s, 'Sell', String(Math.round(rate * 1.2)));
  await trace('sell');
  await sleep(1500);
  const rows = await committedRows(s);
  step.committed_row = rows[rows.length - 1] || null;
  step.toast = (await s.text()).match(/(Please specify [^\n]{0,40}|Invalid expiry[^\n]{0,40}|Cannot inward expired[^\n]{0,40}|must be before[^\n]{0,40}|HSN\/SAC[^\n]{0,40})/);
  step.ok = rows.length === before + 1;
  return step;
}

(async () => {
  const store = storeByCode('QA-A');
  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  const ORS = fixture(store.id, 'QA Oral Rehydration Sachet');
  console.log('store', JSON.stringify(store));

  const L1 = { prod: SYR, batch: `QAPB${stamp}`, expiry: '12/28', packs: 5, rate: 150 };
  const L2 = { prod: ORS, batch: `QAPB${stamp}B`, expiry: '06/29', packs: 2, rate: 240 };
  const lines = [L1, L2];

  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S3' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 160));
  if (!ok) { saveEvidence('GST_S3_purchases.json', out); process.exit(1); }

  const srvMaxPurchaseId = Number(sql(`select coalesce(max(id),0) m from purchases`)[0].m);
  const srvBefore = {}, tillBefore = {};
  for (const l of lines) {
    srvBefore[l.prod.id] = batchMap(l.prod.id, store.id);
    tillBefore[l.prod.id] = await tillBatchMap(s, l.prod.id, store.id);
  }
  out.purchase.stock_before = { server: srvBefore, till: tillBefore };
  console.log('server stock before:', JSON.stringify(srvBefore));

  await navTo(s, '/purchases');
  await sleep(2000);
  await s.clickText('New Inward Bill');
  await sleep(3000);

  out.purchase.supplier = await pickSupplier(s, 'QA Supplier Kerala');
  const invOk = await setInput(s, 'input[placeholder="INV-001"]', PUR_INV);
  console.log('header:', JSON.stringify(out.purchase.supplier), 'vendor_bill:', invOk);

  const added = [];
  for (const l of lines) {
    const step = await addPurchaseLine(s, l.prod, l);
    step.header_after = await headerState(s);
    added.push({ product: l.prod.name, batch: l.batch, packs: l.packs, rate: l.rate, step });
    console.log(`line ${l.prod.name}:`, JSON.stringify(step).slice(0, 900));
    console.log(`  header after line: ${JSON.stringify(step.header_after)}`);
    if (!step.ok) break;
  }

  const grid = await readGrid(s, GRID);
  const totals = await readPurchaseTotals(s);
  out.purchase.ui = { grid, totals };

  if (SURVEY) {
    out.purchase.survey = { added, controls: await s.page.evaluate(() => ({
      tfoot: [...document.querySelectorAll('table tfoot input, table tfoot [role="combobox"]')]
        .map(e => ({ tag: e.tagName, type: e.type, ph: e.placeholder, role: e.getAttribute('role') })),
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
        .map(b => (b.innerText || '').replace(/\s+/g, ' ').trim()).filter(x => x).slice(0, 50),
    })) };
    await shot(s, 'S3_survey');
    await s.close();
    saveEvidence('GST_S3_survey.json', out);
    return;
  }

  const failed = added.find(a => !a.step.ok);
  if (failed) {
    rec('S3.1', 'purchase inward bill with two new batches', 'BLOCKED', { failed_product: failed.product, added, grid, totals });
    def({ id: 'S3-Blocked', severity: 'Harness', title: 'purchase draft row could not be completed', evidence: failed.step });
    await shot(s, 'S3_blocked');
    await s.close();
    saveEvidence('GST_S3_purchases.json', out);
    return;
  }

  await shot(s, 'S3_before_post');

  // independent paisa oracle over the same lines (purchase rate is per pack)
  const oracle = computeInvoice({
    store: { state_code: store.state_code, tax_mode: store.tax_mode, gst_type: store.gst_type },
    price_basis: 'per_pack',
    lines: lines.map(l => ({ name: l.prod.name, packs: l.packs, loose_qty: 0,
      unit_price: l.rate, units_per_pack: l.prod.units_per_pack, gst_percent: l.prod.gst_percent })),
  });
  out.purchase.oracle = oracle.totals;
  console.log('oracle:', JSON.stringify(oracle.totals));
  console.log('ui totals:', JSON.stringify({ subtotal: totals.subtotal, tax: totals.tax, net: totals.net_payable }));

  const prePost = await headerState(s);
  out.purchase.pre_post = prePost;
  console.log('pre-post state:', JSON.stringify(prePost));

  // keyboard evidence for the F12 collision: the button advertises F12, but the
  // global capture-phase dispatcher opens the account switcher instead.
  await s.key('F12');
  await sleep(1800);
  out.purchase.f12_probe = await headerState(s);
  console.log('F12 probe:', JSON.stringify(out.purchase.f12_probe));
  if (out.purchase.f12_probe.switcher_open && !out.purchase.f12_probe.post_modal_in_dom) {
    def({
      id: 'S3-F12', severity: 'Medium',
      title: 'F12 "Post Purchase (F12)" opens the Switch Account modal instead of posting',
      evidence: out.purchase.f12_probe,
    });
  }
  await s.page.evaluate(() => {
    const hosts = [...document.querySelectorAll('div')]
      .filter(d => /Switch Counter Cashier|Switch Account/i.test(d.innerText || ''))
      .sort((a, b) => a.innerText.length - b.innerText.length);
    for (const h of hosts) {
      const btn = [...h.querySelectorAll('button')].find(b => /^(cancel|close)$/i.test((b.innerText || '').trim()));
      if (btn) { btn.click(); return; }
    }
  });
  await sleep(800);

  const toastSeen = [];
  async function clickPost(label) {
    const clicked = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find(b =>
        b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().startsWith('Post Purchase'));
      if (!el) return false;
      el.click();
      return true;
    });
    for (let i = 0; i < 14; i++) {
      await sleep(250);
      const t = await s.page.evaluate(() => {
        const el = [...document.querySelectorAll('div')].find(d => String(d.className).includes('9999'));
        return el ? (el.innerText || '').replace(/\s+/g, ' ').trim() : null;
      });
      if (t && !toastSeen.includes(t)) {
        toastSeen.push(t);
        console.log(`  toast(${label}): ${t}`);
      }
      const open = await s.page.evaluate(() => /Confirm & Post Purchase/.test(document.body.innerText));
      if (open) return true;
    }
    return clicked ? 'no-modal' : false;
  }

  let modalOpen = await clickPost('first');
  if (modalOpen !== true) {
    // A cleared header field is the usual gate. Escape is deliberately NOT pressed:
    // in this form it raises "Close purchase bill entry?" and takes the page away.
    const stuck = await headerState(s);
    if (stuck.switcher_open) await closeSwitcher(s);
    await sleep(600);
    out.purchase.supplier_repick = stuck.supplier ? 'kept' : await pickSupplier(s, 'QA Supplier Kerala');
    if (!stuck.vendor_bill_no) await setInput(s, 'input[placeholder="INV-001"]', PUR_INV);
    out.purchase.retry_from = await headerState(s);
    console.log('retry from:', JSON.stringify(out.purchase.retry_from));
    modalOpen = out.purchase.retry_from.post_button ? await clickPost('retry') : false;
    out.purchase.post_attempts = 2;
  } else {
    out.purchase.post_attempts = 1;
  }
  out.purchase.post_toasts = toastSeen;
  const confirm = modalOpen === true ? await s.clickText('Confirm & Post Purchase') : false;
  await sleep(12000);
  await shot(s, 'S3_after_post');
  const afterPost = (await s.text()).replace(/\n{3,}/g, '\n');

  const srvPurchases = sql(`select * from purchases where store_id=${store.id} and id>${srvMaxPurchaseId} order by id desc`);
  const srvDoc = srvPurchases[0] || null;
  const srvItems = srvDoc ? sql(`select * from purchase_items where purchase_id=${srvDoc.id}`) : [];
  const tillDocsA = (await localTable(s, 'purchase_documents', store.id)).rows;
  const tillDocsB = (await localTable(s, 'purchases', store.id)).rows;
  const byDate = (a, b) => String(b.created_at).localeCompare(String(a.created_at));
  const tillDocs = (tillDocsA.length ? tillDocsA : tillDocsB).slice().sort(byDate);
  const tillDoc = tillDocs.find(d => String(d.supplier_invoice_no || '').includes(PUR_INV)) || tillDocs[0] || null;
  out.purchase.till_doc_matched_by_vendor_bill = !!tillDoc && String(tillDoc.supplier_invoice_no || '').includes(PUR_INV);
  out.purchase.local_storage_keys = tillDocs.length ? [] : await s.page.evaluate(() => Object.keys(localStorage).filter(k => /purchase|batch/i.test(k)));
  out.purchase.dialogs = s.dialogs;
  const queue = await localQueue(s, store.id);
  const writes = s.apiLog().filter(w => w.u !== '/api/device-sessions/heartbeat').map(w => ({ m: w.m, u: w.u, s: w.s })).slice(-20);

  const srvAfter = {}, tillAfter = {};
  for (const l of lines) {
    srvAfter[l.prod.id] = batchMap(l.prod.id, store.id);
    tillAfter[l.prod.id] = await tillBatchMap(s, l.prod.id, store.id);
  }
  out.purchase.server = { doc: srvDoc, items: srvItems, recent: srvPurchases };
  out.purchase.till = { doc: tillDoc, recent: tillDocs.slice(0, 3) };
  out.purchase.stock_after = { server: srvAfter, till: tillAfter };
  out.purchase.queue = queue;
  out.purchase.writes = writes;
  out.purchase.post_screen = (prePost.post_button ? prePost.post_button.text : 'no post button') + ' | ' + JSON.stringify(prePost);
  out.purchase.after_post_screen = afterPost.slice(-800);
  out.purchase.confirm_click = confirm;
  out.purchase.post_button = prePost.post_button;
  out.purchase.post_modal_open = modalOpen;

  const checks = [];
  cmp('UI subtotal vs oracle taxable', totals.subtotal, oracle.totals.taxable_subtotal, checks);
  cmp('UI GST tax vs oracle tax', totals.tax, oracle.totals.tax_total, checks);
  cmp('UI net payable vs oracle grand', totals.net_payable, oracle.totals.grand_total, checks);

  if (!tillDoc) {
    checks.push({ check: 'purchase saved on till', got: 'MISSING', want: 'row', ok: false });
  } else {
    checks.push({ check: `purchase saved on till (${tillDoc.purchase_number})`, got: 'row', want: 'row', ok: true });
    cmp('till taxable vs oracle', tillDoc.subtotal, oracle.totals.taxable_subtotal, checks);
    cmp('till tax vs oracle', tillDoc.tax_total, oracle.totals.tax_total, checks);
    cmp('till grand vs oracle', tillDoc.grand_total, oracle.totals.grand_total, checks);
  }

  if (!srvDoc) {
    checks.push({ check: 'purchase reached backend', got: 'MISSING', want: 'row', ok: false });
  } else {
    checks.push({ check: `purchase reached backend (${srvDoc.invoice_number})`, got: 'row', want: 'row', ok: true });
    cmp('server subtotal vs oracle', srvDoc.subtotal, oracle.totals.taxable_subtotal, checks);
    cmp('server tax vs oracle', srvDoc.tax_total, oracle.totals.tax_total, checks);
    cmp('server grand vs oracle', srvDoc.grand_total, oracle.totals.grand_total, checks);
    cmp('server grand = subtotal+tax+roundoff', Number(srvDoc.subtotal) + Number(srvDoc.tax_total) + Number(srvDoc.round_off), srvDoc.grand_total, checks);
    cmp('server cgst+sgst+igst = tax_total', Number(srvDoc.cgst_total || 0) + Number(srvDoc.sgst_total || 0) + Number(srvDoc.igst_total || 0), srvDoc.tax_total, checks);
    checks.push({ check: 'server line count', got: srvItems.length, want: 2, ok: srvItems.length === 2 });
    cmp('sum(line taxable) = header subtotal', srvItems.reduce((a, i) => a + Number(i.taxable_amount || 0), 0), srvDoc.subtotal, checks);
    cmp('sum(line tax) = header tax', srvItems.reduce((a, i) => a + Number(i.tax_amount || 0), 0), srvDoc.tax_total, checks);
    for (const l of lines) {
      const units = l.packs * l.prod.units_per_pack;
      const it = srvItems.find(i => String(i.batch_no) === l.batch);
      checks.push({ check: `server line stored for ${l.prod.name}`,
        got: it ? { product_id: it.product_id, batch: it.batch_no, qty: it.qty, pack_qty: it.pack_qty,
                    units_per_pack: it.units_per_pack, rate: it.purchase_rate, gst: it.gst_percent } : 'MISSING',
        want: `${l.batch} ${l.packs}pk @${l.rate}`, ok: !!it && Number(it.purchase_rate) === l.rate });
      if (it) {
        checks.push({ check: `server line links to product master (product_id=${l.prod.id})`,
          got: it.product_id, want: l.prod.id, ok: String(it.product_id) === String(l.prod.id) });
        // purchases-server convention is the same as PurchaseController@store: qty holds PACKS and
        // the unit count is derived, so assert the convention instead of a flat unit figure.
        checks.push({ check: `server line qty = ${l.packs} packs`, got: { qty: it.qty, pack_qty: it.pack_qty },
          want: `${l.packs} packs`, ok: Number(it.qty) === l.packs && Number(it.pack_qty) === l.packs });
        const baseUnits = (Number(it.qty) + Number(it.free_qty || 0)) * Number(it.units_per_pack || 1)
          + Number(it.loose_qty || 0) + Number(it.free_loose_qty || 0);
        checks.push({ check: `server line base units = ${units}`, got: baseUnits, want: units, ok: baseUnits === units });
      }
      checks.push({ check: `server batch ${l.batch} = +${units} units`, got: srvAfter[l.prod.id][l.batch] ?? 'NO ROW',
        want: (srvBefore[l.prod.id][l.batch] || 0) + units, ok: Number(srvAfter[l.prod.id][l.batch]) === Number(srvBefore[l.prod.id][l.batch] || 0) + units });
      checks.push({ check: `till batch ${l.batch} vs server batch`, got: { till: tillAfter[l.prod.id][l.batch] ?? 'NO ROW', server: srvAfter[l.prod.id][l.batch] ?? 'NO ROW' },
        want: `${units} on both`, ok: Number(tillAfter[l.prod.id][l.batch]) === Number(srvAfter[l.prod.id][l.batch]) });
    }
    const cols = Object.keys(srvDoc);
    // The purchases table has no separate vendor-bill column: the supplier's own bill number IS
    // purchases.invoice_number, which is also the store-scoped key the server dedupes on.
    checks.push({ check: 'vendor bill no stored on server (purchases.invoice_number)',
      got: srvDoc.invoice_number, want: PUR_INV, ok: String(srvDoc.invoice_number) === PUR_INV });
    const keepsTillNumber = cols.includes('purchase_number')
      || (tillDoc && String(srvDoc.invoice_number) === String(tillDoc.purchase_number));
    checks.push({ check: 'server row keeps the till document number',
      got: { invoice_number: srvDoc.invoice_number, purchase_number_col: cols.includes('purchase_number') },
      want: tillDoc ? tillDoc.purchase_number : 'PUR-xxx', ok: !!keepsTillNumber });
    checks.push({ check: 'server supplier_id links to master', got: srvDoc.supplier_id, want: 22,
      ok: String(srvDoc.supplier_id) === '22' });
    checks.push({ check: 'server qty/unit integrity (mrp and effective cost per unit)',
      got: srvItems.map(i => ({ name: i.product_name, mrp: i.mrp, units_per_pack: i.units_per_pack, eff: i.effective_unit_cost })),
      want: 'mrp and units_per_pack per pack master', ok: srvItems.every(i => Number(i.mrp) > 0) });
    if (tillDoc) checks.push({ check: 'till document flagged synced after push',
      got: tillDoc.sync_state, want: 'synced', ok: String(tillDoc.sync_state) === 'synced' });
  }
  // Purchases only ever flow till -> server, so the missing till number is a traceability gap
  // rather than a duplication risk; report it separately instead of failing the stock/GST proof.
  const tillNumIdx = checks.findIndex(c => c.check === 'server row keeps the till document number');
  if (tillNumIdx >= 0) {
    const tillNum = checks.splice(tillNumIdx, 1)[0];
    if (!tillNum.ok) {
      rec('S3.1c', 'server purchase row retains the till document number', 'GAP', tillNum);
      def({ id: 'S3-Number', severity: 'Low', title: 'server purchase row does not retain the till document number', evidence: tillNum });
    }
  }
  const pass = checks.every(c => c.ok);
  rec('S3.1', 'purchase inward: 2 new batches, GST, stock and backend persistence', pass ? 'PASS' : 'CHECK',
    { checks, ui: out.purchase.ui, oracle: oracle.totals, server: out.purchase.server, till: out.purchase.till, stock: out.purchase.stock_after, queue, writes });
  if (!pass) def({ id: 'S3.1', severity: 'TBD', title: 'purchase inward verification found failures', evidence: checks.filter(c => !c.ok) });

  // ---------------------------------------------------------------- S3.2 purchase return
  await navTo(s, '/returns/purchases');
  await sleep(3500);
  // any stray overlay (counter switcher, post-success dialog) would swallow the wizard click
  out.ret.stray_overlays = [];
  for (let i = 0; i < 3; i++) {
    const closed = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find(b => b.offsetParent !== null && /^(Cancel|Close)$/.test((b.innerText || '').trim()));
      if (!el) return null;
      el.click();
      return (el.innerText || '').trim();
    });
    if (!closed) break;
    out.ret.stray_overlays.push(closed);
    await sleep(1200);
  }
  const openedForm = await s.clickText('New Purchase Return');
  await sleep(2500);
  const searchSel = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /PB-123456|Apex Pharma|SUP-INV/i.test(e.placeholder || ''));
    if (!el) return null;
    el.setAttribute('data-qa-ret-search', '1');
    return 'input[data-qa-ret-search="1"]';
  });
  out.ret.opened_form = openedForm;
  out.ret.search_selector = searchSel;
  if (!searchSel) {
    rec('S3.2', 'purchase return / debit note', 'BLOCKED', { why: 'step 1 search box not found', page: (await s.text()).slice(0, 1500) });
    await shot(s, 'S3_ret_blocked');
    await s.close();
    saveEvidence('GST_S3_purchases.json', out);
    return;
  }

  const retBatch = L1.batch;
  const srvRetBefore = batchMap(SYR.id, store.id);
  const tillRetBefore = await tillBatchMap(s, SYR.id, store.id);
  const srvMaxRetId = Number(sql(`select coalesce(max(id),0) m from purchases`)[0].m);

  await setInput(s, searchSel, PUR_INV);
  await sleep(2500);
  const cardBox = await s.page.evaluate((inv) => {
    const els = [...document.querySelectorAll('[role="button"],button,div')].filter(el => el.offsetParent !== null && (el.innerText || '').includes(inv) && (el.innerText || '').length < 400);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120) };
  }, PUR_INV);
  if (cardBox) { await s.page.mouse.click(cardBox.x, cardBox.y); await sleep(3000); }
  out.ret.card = cardBox;

  // scoped to the wizard's own line table, so the register behind it is never counted
  const lineRows = await s.page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find(t => [...t.querySelectorAll('thead th')].some(th => /Return Qty/i.test(th.innerText || '')));
    if (!table) return [];
    return [...table.querySelectorAll('tbody tr')].map((r, i) => ({
      i, text: (r.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      hasCheck: !!r.querySelector('input[type="checkbox"]'),
      numberInputs: [...r.querySelectorAll('input[type="number"]')].length,
      hasSelect: !!r.querySelector('select'),
    }));
  });
  out.ret.line_rows = lineRows;
  const target = lineRows.find(r => /Antibiotic/i.test(r.text)) || lineRows[0];
  if (!target || !target.hasCheck) {
    // Prove whether the lines are missing from storage or just unread by the wizard:
    // PurchaseReturnPage.loadPurchases() returns raw purchase_documents rows, and
    // selectPurchase() reads purchase.lines, which the entry form never writes.
    const tillItems = (await localTable(s, 'purchase_items', store.id)).rows
      .filter(it => String(it.purchase_id) === String(out.purchase.till.doc && out.purchase.till.doc.id));
    const otherPurchases = await s.page.evaluate(() => {
      const els = [...document.querySelectorAll('[role="button"],button,div')]
        .filter(e => e.offsetParent !== null && /\bPUR-\d+\b/.test(e.innerText || '') && (e.innerText || '').length < 300);
      return [...new Set(els.map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()))].slice(0, 6);
    });
    const diag = { why: 'no selectable purchase line', card: cardBox, lineRows,
      till_purchase_items_for_doc: tillItems.map(i => ({ product_name: i.product_name, batch_no: i.batch_no, qty: i.qty, pack_qty: i.pack_qty })),
      till_doc_has_lines_key: !!(out.purchase.till.doc && Array.isArray(out.purchase.till.doc.lines)),
      server_purchase_items: (srvDoc ? sql(`select product_name,batch_no,qty,pack_qty,units_per_pack,product_id from purchase_items where purchase_id=${srvDoc.id}`) : []),
      purchases_visible_in_search: otherPurchases };
    rec('S3.2', 'purchase return / debit note', 'BLOCKED', diag);
    def({ id: 'S3.2', severity: 'High',
      title: 'Purchase return (debit note) wizard cannot load line items for an inward bill posted from the POS',
      evidence: { till_items_exist: tillItems.length, server_items_exist: diag.server_purchase_items.length, card: cardBox } });
    await shot(s, 'S3_ret_nolines');
    await s.close();
    saveEvidence('GST_S3_purchases.json', out);
    return;
  }

  // mark the target row once, so later steps never depend on row ordering
  await s.page.evaluate((i) => {
    const table = [...document.querySelectorAll('table')].find(t => [...t.querySelectorAll('thead th')].some(th => /Return Qty/i.test(th.innerText || '')));
    table.querySelectorAll('tbody tr')[i].setAttribute('data-qa-ret-row', '1');
  }, target.i);
  // the return line row is marked above; every later step reads it back by that marker
  await s.page.evaluate(() => { document.querySelector('[data-qa-ret-row="1"] input[type="checkbox"]').click(); return true; });
  await sleep(1500);
  const qtySet = await s.page.evaluate(() => {
    const el = document.querySelector('[data-qa-ret-row="1"] input[type="number"]');
    if (!el) return null;
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, '1');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  });
  await sleep(1200);
  const reason = await s.page.evaluate(() => {
    const el = document.querySelector('[data-qa-ret-row="1"] select');
    if (!el) return { ok: false, why: 'no reason select' };
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, el.options[1].value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: el.options[1].value, text: el.options[1].text };
  });
  await sleep(1000);
  const nextBtn = await s.clickText('Next: Settlement');
  await sleep(2500);
  await shot(s, 'S3_ret_settlement');
  const settleText = (await s.text()).replace(/\n{3,}/g, '\n');
  const method = await s.page.evaluate(() => {
    const els = [...document.querySelectorAll('label,button,[role="radio"]')].filter(e => e.offsetParent !== null && /Adjust Against Payable|Credit/i.test(e.innerText || ''));
    const el = els[0];
    if (!el) return null;
    el.click();
    return (el.innerText || '').replace(/\s+/g, ' ').slice(0, 60);
  });
  await sleep(1200);
  const saved = await s.clickText('Save & Print Debit Note') || await s.clickText('Save Debit Note') || await s.clickText('Save');
  await sleep(10000);
  await shot(s, 'S3_ret_saved');
  const afterSaved = (await s.text()).replace(/\n{3,}/g, '\n');

  const tillReturns = (await localTable(s, 'purchase_returns', store.id)).rows;
  const srvPurchases2 = sql(`select * from purchases where store_id=${store.id} and id>${srvMaxRetId} order by id desc`);
  const srvTables = sql(`select name from sqlite_master where type='table' and (name like '%return%' or name like '%debit%' or name like '%credit%')`).map(r => r.name);
  const srvRetAfter = batchMap(SYR.id, store.id);
  const tillRetAfter = await tillBatchMap(s, SYR.id, store.id);
  const queue2 = await localQueue(s, store.id);
  const writes2 = s.apiLog().filter(w => w.u !== '/api/device-sessions/heartbeat')
    .map(w => ({ m: w.m, u: w.u, s: w.s, body: (w.body || '').slice(0, 200) })).slice(-12);

  const rchecks = [];
  const ret = tillReturns.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  rchecks.push({ check: 'debit note saved on till', got: ret ? (ret.return_number || ret.id) : 'MISSING', want: 'row', ok: !!ret });
  if (ret) {
    rchecks.push({ check: 'debit note line references inward batch',
      got: (ret.lines || []).map(l => ({ p: l.product_name, b: l.batch_no, q: l.return_qty ?? l.qty })),
      want: `${retBatch} x1`, ok: (ret.lines || []).some(l => l.batch_no === retBatch) });
    // the debit note row books its money in grand_total/subtotal/tax_total, not total_amount
    const retMoney = Number(ret.grand_total ?? ret.total_amount ?? ret.amount ?? 0);
    rchecks.push({ check: 'debit note amount > 0', got: { grand_total: ret.grand_total, subtotal: ret.subtotal, tax_total: ret.tax_total }, want: '>0', ok: retMoney > 0 });
    cmp('debit note lines sum to header subtotal', (ret.lines || []).reduce((a, l) => a + Number(l.taxable_amount || 0), 0), ret.subtotal, rchecks);
    cmp('debit note lines sum to header tax', (ret.lines || []).reduce((a, l) => a + Number(l.cgst_amount || 0) + Number(l.sgst_amount || 0) + Number(l.igst_amount || 0) + Number(l.cess_amount || 0), 0), ret.tax_total, rchecks);
  }
  rchecks.push({ check: `till batch ${retBatch} reduced by 1 pack`, got: tillRetAfter[retBatch],
    want: Number(tillRetBefore[retBatch]) - SYR.units_per_pack,
    ok: Number(tillRetAfter[retBatch]) === Number(tillRetBefore[retBatch]) - SYR.units_per_pack });
  rchecks.push({ check: `server batch ${retBatch} reduced by 1 pack`, got: srvRetAfter[retBatch],
    want: Number(srvRetBefore[retBatch]) - SYR.units_per_pack,
    ok: Number(srvRetAfter[retBatch]) === Number(srvRetBefore[retBatch]) - SYR.units_per_pack });
  const retRows = srvPurchases2.filter(p => /RETURN|DEBIT/i.test(`${p.module_key || ''} ${p.invoice_number || ''}`));
  rchecks.push({ check: 'purchase return document exists on server',
    got: { return_debit_tables_on_server: srvTables, matching_purchase_rows: retRows.map(p => ({ no: p.invoice_number, module: p.module_key, grand: p.grand_total })) },
    want: 'a debit-note row', ok: retRows.length > 0 });

  out.ret = { ...out.ret, qtySet, reason, nextBtn, method, saved,
    screen: { settlement: settleText.slice(-800), after_saved: afterSaved.slice(-800) },
    till_returns: tillReturns, server_purchases_recent: srvPurchases2, server_return_tables: srvTables,
    stock_before: { server: srvRetBefore, till: tillRetBefore }, stock_after: { server: srvRetAfter, till: tillRetAfter },
    queue: queue2, writes: writes2 };
  const rpass = rchecks.every(c => c.ok);
  rec('S3.2', 'purchase return (debit note): stock reversal and backend persistence', rpass ? 'PASS' : 'CHECK',
    { checks: rchecks, till_return: ret, server_return_tables: srvTables, writes: writes2, queue: queue2 });
  if (!rpass) def({ id: 'S3.2', severity: 'TBD', title: 'purchase return verification found failures', evidence: rchecks.filter(c => !c.ok) });

  await s.close();
  saveEvidence('GST_S3_purchases.json', out);
})().catch(e => { console.error(e); saveEvidence('GST_S3_purchases.json', out); process.exit(1); });
