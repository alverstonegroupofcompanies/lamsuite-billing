/**
 * S5 — purchase bill cancel and purchase bill edit through the POS purchases screen.
 *
 * Every run gets a throwaway Chrome profile, so the till starts empty: this scenario
 * posts its own two inward bills first, then cancels one and edits the other, judging
 * money, status and batch stock on the till and on the server after each action.
 */
const {
  storeByCode, fixture, login, shot, sleep, navTo, sql, saveEvidence, localTable, localQueue,
  readGrid, setGridCell, setInput, cmp,
} = require('./gst_kit.cjs');
const { postPurchaseInward, closePostSuccessModal, GRID } = require('./purchase_flow.cjs');
const { computeInvoice } = require('./tax_oracle.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const SUPPLIER = 'QA Supplier Kerala';
const stamp = String(Date.now()).slice(-6);
const out = { scenarios: [], defects: [], notes: [], cancel: {}, edit: {} };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 2200));
};
const def = (d) => { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); };

function srvBatchMap(productId, storeId) {
  const m = {};
  for (const b of sql(`select batch_no, stock_qty from product_batches where product_id=${productId} and store_id=${storeId}`)) {
    m[b.batch_no] = Number(b.stock_qty);
  }
  return m;
}

async function tillBatchMap(s, storeId) {
  const { rows } = await localTable(s, 'product_batches', storeId);
  const m = {};
  for (const b of rows) {
    m[b.product_id] = m[b.product_id] || {};
    m[b.product_id][b.batch_no] = Number(b.stock_qty);
  }
  return m;
}

/** The till keeps posted purchases in purchase_documents (older builds used purchases). */
async function tillDocs(s, storeId) {
  const a = (await localTable(s, 'purchase_documents', storeId)).rows;
  const b = (await localTable(s, 'purchases', storeId)).rows;
  const rows = a.length ? a : b;
  return rows.slice().sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
}

/** Units each line put into — and therefore must take back from — a batch. */
function stockMapFor(rows) {
  const m = {};
  for (const it of rows) {
    const units = Number(it.total_units ?? (Number(it.pack_qty) * Number(it.units_per_pack || 1) + Number(it.loose_qty || 0)));
    m[`${it.product_id}|${it.batch_no}`] = units;
  }
  return m;
}

/**
 * The cancel confirmation is a React modal: a click that lands on an overlay above the
 * button silently does nothing, so probe what is actually topmost before judging the app.
 */
async function readCancelModal(s) {
  return s.page.evaluate(() => {
    const boxes = [...document.querySelectorAll('div')]
      .filter(d => /Cancel Purchase Bill/.test(d.innerText || '') && /Confirm Cancel/.test(d.innerText || ''));
    const box = boxes.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!box) return { present: false };
    const btn = [...box.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Confirm Cancel');
    const reason = [...box.querySelectorAll('input')][0] || null;
    const base = {
      present: true, has_button: !!btn,
      z_box: getComputedStyle(box).zIndex,
      reason_value: reason ? reason.value : null,
      error_text: (box.innerText.match(/Please provide a cancellation reason|Failed to cancel[^\n]*/) || [])[0] || null,
    };
    if (!btn) return base;
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      ...base,
      rect: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      topmost_is_button: top === btn || btn.contains(top),
      topmost: top ? `${top.tagName}.${String(top.className).slice(0, 70)}|${(top.innerText || '').replace(/\s+/g, ' ').slice(0, 50)}` : null,
    };
  });
}

/** Type into the reason box that belongs to the cancel modal, not to any other input. */
async function setCancelReason(s, text) {
  return s.page.evaluate((v) => {
    const boxes = [...document.querySelectorAll('div')]
      .filter(d => /Cancel Purchase Bill/.test(d.innerText || '') && /Confirm Cancel/.test(d.innerText || ''));
    const box = boxes.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    const el = box && [...box.querySelectorAll('input')].find(i => /cancellation reason|invoice revised/i.test(i.placeholder || ''));
    if (!el) return { ok: false, why: 'reason input not inside cancel modal' };
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, value: el.value };
  }, text);
}

/** Click "Confirm Cancel" as a user would, falling back to a DOM click when an overlay eats it. */
async function confirmCancel(s) {
  const trace = [];
  let m = await readCancelModal(s);
  trace.push(m);
  if (!m.present) return { clicked: false, why: 'cancel modal not open', trace };
  if (!m.has_button) return { clicked: false, why: 'no Confirm Cancel button', trace };

  const blockedBy = m.topmost_is_button ? null : m.topmost;
  if (m.topmost_is_button) {
    await s.page.mouse.click(m.rect.x, m.rect.y);
  } else {
    const dom = await s.page.evaluate(() => {
      const boxes = [...document.querySelectorAll('div')].filter(d => /Cancel Purchase Bill/.test(d.innerText || '') && /Confirm Cancel/.test(d.innerText || ''));
      const box = boxes.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      const btn = [...box.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Confirm Cancel');
      btn.click();
      return true;
    });
    trace.push({ dom_click_fallback: dom, intercepted: true });
  }
  await sleep(4000);
  m = await readCancelModal(s);
  trace.push({ after_click: m });
  if (!m.present) return { clicked: true, how: blockedBy ? 'dom click (a mouse click is blocked)' : 'mouse', mouse_blocked_by: blockedBy, modal_still_open: false, trace };

  await s.page.evaluate(() => {
    const boxes = [...document.querySelectorAll('div')].filter(d => /Cancel Purchase Bill/.test(d.innerText || '') && /Confirm Cancel/.test(d.innerText || ''));
    const box = boxes.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!box) return;
    const btn = [...box.querySelectorAll('button')].find(b => (b.innerText || '').trim() === 'Confirm Cancel');
    if (btn) btn.click();
  });
  await sleep(4000);
  m = await readCancelModal(s);
  trace.push({ after_dom_click: m });
  for (let i = 0; i < 6 && m.present; i++) { await sleep(3000); m = await readCancelModal(s); }
  trace.push(m);
  return { clicked: !m.present, how: 'mouse then dom', mouse_blocked_by: blockedBy, modal_still_open: m.present, trace };
}

/**
 * Committed purchase cells are static <span>s; only a double-click (or Enter in grid
 * mode) opens the inline editor. Double-click the cell, then type into the input it yields.
 */
async function editGridCell(s, col, text, value) {
  const locate = () => s.page.evaluate((c, t) => {
    const table = document.querySelector('table[aria-label="Purchase Inward Items"]');
    if (!table) return { ok: false, why: 'no purchase grid' };
    const row = [...table.querySelectorAll('tbody tr')].find(r => (r.innerText || '').includes(t));
    if (!row) return { ok: false, why: 'no row for product', rows: [...table.querySelectorAll('tbody tr')].map(r => (r.innerText || '').replace(/\s+/g, ' ').slice(0, 70)) };
    const td = row.children[c];
    if (!td) return { ok: false, why: 'row has no such cell', cells: row.children.length, col: c };
    const r = td.getBoundingClientRect();
    return {
      ok: true, col: c,
      head: (table.querySelectorAll('thead th')[c] || {}).innerText,
      x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
      before: (td.innerText || '').replace(/\s+/g, ' ').trim(),
      editable: !!td.querySelector('input, select, textarea'),
    };
  }, col, text);

  const cell = await locate();
  if (!cell.ok) return cell;

  const typeIntoCell = () => s.page.evaluate((c, v) => {
    const table = document.querySelector('table[aria-label="Purchase Inward Items"]');
    const target = [...table.querySelectorAll('tbody tr')]
      .map(r => r.children[c])
      .filter(td => td && td.querySelector('input'))
      .map(td => td.querySelector('input'))[0];
    if (!target) return { opened: false };
    target.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(target, String(v));
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { opened: true, value: target.value };
  }, col, value);

  await s.page.mouse.click(cell.x, cell.y, { clickCount: 2 });
  await sleep(1500);
  let typed = await typeIntoCell();
  const via = ['mouse dblclick'];
  if (!typed.opened) {
    await s.page.evaluate((x, y) => {
      const el = document.elementFromPoint(x, y);
      const td = el ? el.closest('td') : null;
      if (!td) return;
      td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    }, cell.x, cell.y);
    await sleep(1500);
    typed = await typeIntoCell();
    via.push('dispatched dblclick');
  }
  await sleep(800);
  await s.page.keyboard.press('Enter');
  await sleep(2000);
  const after = await locate();
  return { ...cell, via, typed, after: after.before, ok: !!typed.opened && String(typed.value) === String(value),
    why: typed.opened ? null : 'inline editor never opened on this cell' };
}

/** The purchases table row for one document number, with its action buttons labelled. */
async function openPurchaseRow(s, number, which) {
  const found = await s.page.evaluate((n, w) => {
    const rows = [...document.querySelectorAll('tbody tr')].filter(r => (r.innerText || '').includes(n));
    const row = rows.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!row) return { ok: false, why: 'row not found' };
    const btns = [...row.querySelectorAll('button')].map(b => b.title || (b.innerText || '').trim());
    const target = [...row.querySelectorAll('button')].find(b =>
      w === 'edit' ? /edit/i.test(b.title || '') : /view full purchase details/i.test(b.title || ''))
      || row.querySelector('button');
    if (!target) return { ok: false, why: 'row has no buttons', btns, row_text: (row.innerText || '').replace(/\s+/g, ' ').slice(0, 200) };
    target.click();
    return { ok: true, clicked: target.title || (target.innerText || '').trim(), btns };
  }, number, which);
  await sleep(3500);
  return found;
}

(async () => {
  const store = storeByCode('QA-A');
  console.log('store', JSON.stringify(store));
  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S5' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 140));
  if (!ok) { saveEvidence('GST_S5_purchase_edit_cancel.json', out); process.exit(1); }

  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  const ORS = fixture(store.id, 'QA Oral Rehydration Sachet');

  const BILL_C = { vendor: `QA-PUR-${stamp}C`, lines: [
    { prod: SYR, batch: `QAPB${stamp}C1`, expiry: '12/28', packs: 4, rate: 150 },
    { prod: ORS, batch: `QAPB${stamp}C2`, expiry: '06/29', packs: 2, rate: 240 },
  ] };
  const BILL_E = { vendor: `QA-PUR-${stamp}E`, lines: [
    { prod: SYR, batch: `QAPB${stamp}E1`, expiry: '12/28', packs: 3, rate: 150 },
  ] };

  const seeded = [];
  for (const bill of [BILL_C, BILL_E]) {
    const r = await postPurchaseInward(s, { lines: bill.lines, supplier: SUPPLIER, vendorBill: bill.vendor, label: bill.vendor });
    seeded.push({ vendor: bill.vendor, ok: r.ok, why: r.why, toasts: r.toasts, steps: r.steps, totals: r.totals, post_attempts: r.post_attempts, pre_post: r.pre_post, form_before_lines: r.form_before_lines, form_open_trace: r.form_open_trace, diagnosis: r.diagnosis, after_post_screen: r.after_post_screen, post_success_modal: r.post_success_modal, success_modal_closed: r.success_modal_closed, confirm_click: r.confirm_click });
    console.log(`seed ${bill.vendor}: ok=${r.ok} ${r.why || ''} totals=${JSON.stringify(r.totals || {})} form=${JSON.stringify(r.form_before_lines)}`);
    await shot(s, `S5_seeded_${bill.vendor.slice(-3)}`);
  }

  const docs = await tillDocs(s, store.id);
  const cancelDoc = docs.find(d => String(d.supplier_invoice_no || '').includes(BILL_C.vendor));
  const editDoc = docs.find(d => String(d.supplier_invoice_no || '').includes(BILL_E.vendor));
  const missing = [BILL_C.vendor, BILL_E.vendor].filter(v => !docs.some(d => String(d.supplier_invoice_no || '').includes(v)));
  out.seed = { seeded, docs: docs.slice(0, 4), missing };
  rec('S5.0', 'two inward bills seeded on this till', missing.length ? 'BLOCKED' : 'PASS',
    { till_purchase_count: docs.length, missing, newest: docs.slice(0, 4).map(d => ({ no: d.purchase_number, inv: d.supplier_invoice_no, status: d.status, grand: d.grand_total })) });
  if (missing.length) {
    await shot(s, 'S5_blocked');
    await s.close(); saveEvidence('GST_S5_purchase_edit_cancel.json', out); return;
  }

  // ---------------------------------------------------------------- S5.1 cancel
  const cancelItemsTill = (await localTable(s, 'purchase_items', store.id)).rows.filter(i => i.purchase_id === cancelDoc.id);
  const cancelDocServer = sql(`select * from purchases where invoice_number='${BILL_C.vendor}'`)[0] || null;
  const cancelItemsSrv = cancelDocServer ? sql(`select * from purchase_items where purchase_id=${cancelDocServer.id}`) : [];
  out.cancel = { doc: cancelDoc, till_items: cancelItemsTill, server_doc: cancelDocServer, server_items: cancelItemsSrv };

  const unitsByBatch = stockMapFor(cancelItemsTill.length ? cancelItemsTill : cancelItemsSrv);
  out.cancel.expected_units = unitsByBatch;
  const stockBefore = await tillBatchMap(s, store.id);
  const srvBefore = {};
  for (const key of Object.keys(unitsByBatch)) {
    const [pid] = key.split('|');
    srvBefore[pid] = srvBefore[pid] || srvBatchMap(pid, store.id);
  }
  out.cancel.stock_before = { till: stockBefore, server: srvBefore };

  // the second seeded bill ends on the post-success modal; its X is the only way back to
  // the list without creating a third bill
  out.cancel.modal_dismissed = await closePostSuccessModal(s);
  await sleep(1500);
  await navTo(s, '/purchases');
  await sleep(5000);
  const row = await openPurchaseRow(s, cancelDoc.purchase_number, 'view');
  out.cancel.row_actions = row;
  const drawerText = (await s.text()).replace(/\n{3,}/g, '\n');
  out.cancel.drawer = { opened: /Cancel Bill/.test(drawerText), has_edit_action: /Edit Bill|Edit Purchase/i.test(drawerText), head: drawerText.slice(-600) };
  console.log('drawer:', JSON.stringify(out.cancel.drawer).slice(0, 300));

  if (!out.cancel.drawer.opened) {
    rec('S5.1', 'cancel an inward bill and revert batch stock', 'BLOCKED', { row, drawer: out.cancel.drawer });
  } else {
    await s.clickText('Cancel Bill');
    await sleep(2500);
    const modalBefore = await readCancelModal(s);
    const reasonSet = await setCancelReason(s, 'QA S5 cancellation: wrong inward entry');
    await sleep(800);
    out.cancel.modal = { before_reason: modalBefore, reason_set: reasonSet, after_reason: await readCancelModal(s) };
    out.cancel.confirm = await confirmCancel(s);
    await sleep(6000);
    const afterScreen = (await s.text()).replace(/\n{3,}/g, '\n');
    out.cancel.after_screen = afterScreen.slice(-700);

    const docsA = await tillDocs(s, store.id);
    const tillAfterDoc = docsA.find(d => d.id === cancelDoc.id) || null;
    const srvRow = sql(`select * from purchases where invoice_number='${BILL_C.vendor}'`)[0] || cancelDocServer;
    const stockAfter = await tillBatchMap(s, store.id);
    const srvAfter = {};
    for (const key of Object.keys(unitsByBatch)) {
      const [pid] = key.split('|');
      srvAfter[pid] = srvAfter[pid] || srvBatchMap(pid, store.id);
    }
    out.cancel.till_after = tillAfterDoc;
    out.cancel.server_after = srvRow;
    out.cancel.stock_after = { till: stockAfter, server: srvAfter };
    out.cancel.queue = await localQueue(s, store.id);
    out.cancel.writes = s.apiLog().filter(w => w.u !== '/api/device-sessions/heartbeat').map(w => ({ m: w.m, u: w.u, s: w.s })).slice(-12);

    const checks = [];
    checks.push({ check: 'cancel dialog opened from drawer', got: out.cancel.modal.before_reason && out.cancel.modal.before_reason.present, want: true, ok: !!(out.cancel.modal.before_reason && out.cancel.modal.before_reason.present) });
    checks.push({ check: 'Confirm Cancel is reachable by a real mouse click', got: out.cancel.modal.before_reason && out.cancel.modal.before_reason.topmost_is_button ? 'button is topmost' : (out.cancel.confirm.mouse_blocked_by || 'unknown'), want: 'button is topmost', ok: !!(out.cancel.modal.before_reason && out.cancel.modal.before_reason.topmost_is_button) });
    checks.push({ check: 'cancel dialog closed by Confirm Cancel', got: out.cancel.confirm.clicked, want: true, ok: out.cancel.confirm.clicked === true });
    checks.push({ check: 'till status cancelled', got: tillAfterDoc && tillAfterDoc.status, want: 'cancelled', ok: !!tillAfterDoc && String(tillAfterDoc.status).toLowerCase() === 'cancelled' });
    checks.push({ check: 'server status cancelled', got: srvRow && srvRow.status, want: 'cancelled', ok: !!srvRow && String(srvRow.status).toLowerCase() === 'cancelled' });
    checks.push({ check: 'server keeps the money of a cancelled bill', got: srvRow && { grand: srvRow.grand_total, tax: srvRow.tax_total, paid: srvRow.paid_amount }, want: 'non-zero audit trail', ok: !!srvRow && Number(srvRow.grand_total) > 0 });
    for (const [key, units] of Object.entries(unitsByBatch)) {
      const [pid, batch] = key.split('|');
      const b = Number(stockBefore[pid] && stockBefore[pid][batch]);
      const a = Number(stockAfter[pid] && stockAfter[pid][batch]);
      checks.push({ check: `till batch ${batch} reverted -${units} (the inward is taken back)`, got: a, want: b - units, ok: a === b - units });
      const sb = Number(srvBefore[pid] && srvBefore[pid][batch]);
      const sa = Number(srvAfter[pid] && srvAfter[pid][batch]);
      checks.push({ check: `server batch ${batch} reverted -${units}`, got: isNaN(sb) ? 'NO ROW before' : sa, want: isNaN(sb) ? 'row exists on server' : sb - units, ok: !isNaN(sb) && sa === sb - units });
    }
    const pass = checks.every(c => c.ok);
    rec('S5.1', 'cancel an inward bill and revert batch stock', pass ? 'PASS' : 'CHECK', { checks, confirm: out.cancel.confirm, modal: out.cancel.modal, till_after: out.cancel.till_after, server_after: out.cancel.server_after, writes: out.cancel.writes });
    if (!pass) def({ id: 'S5.1', severity: 'TBD', title: 'purchase cancel verification found failures', evidence: checks.filter(c => !c.ok) });
    if (out.cancel.confirm.mouse_blocked_by) def({
      id: 'S5.1-CLICK', severity: 'High',
      title: 'The purchase "Confirm Cancel" dialog is unclickable: the drawer backdrop paints above it (z-60 emits no CSS)',
      evidence: { element_at_button_center: out.cancel.confirm.mouse_blocked_by, modal_z_index: out.cancel.modal.before_reason.z_box, cancel_still_possible_via: 'keyboard/DOM only' },
    });
  }

  // ---------------------------------------------------------------- S5.2 edit
  const editItemsTill = (await localTable(s, 'purchase_items', store.id)).rows.filter(i => i.purchase_id === editDoc.id);
  const editDocServer = sql(`select * from purchases where invoice_number='${BILL_E.vendor}'`)[0] || null;
  const editItemsSrv = editDocServer ? sql(`select * from purchase_items where purchase_id=${editDocServer.id}`) : [];
  out.edit = { doc: editDoc, till_items: editItemsTill, server_doc: editDocServer, server_items: editItemsSrv };

  const editUnits = stockMapFor(editItemsTill.length ? editItemsTill : editItemsSrv);
  out.edit.expected_units = editUnits;
  const stockBeforeEdit = await tillBatchMap(s, store.id);
  const srvBeforeEdit = {};
  for (const key of Object.keys(editUnits)) {
    const [pid] = key.split('|');
    srvBeforeEdit[pid] = srvBatchMap(pid, store.id);
  }
  out.edit.stock_before = { till: stockBeforeEdit, server: srvBeforeEdit };

  await navTo(s, '/purchases');
  await sleep(5000);
  const editRow = await openPurchaseRow(s, editDoc.purchase_number, 'edit');
  out.edit.row_actions = editRow;
  const inForm = await s.page.evaluate(() => ({
    grid: !!document.querySelector('table[aria-label="Purchase Inward Items"]'),
    editing_banner: /Editing|Edit Purchase/i.test(document.body.innerText),
    supplier: (() => { const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /select or search supplier/i.test(e.placeholder || '')); return el ? el.value : null; })(),
    bill_no: (() => { const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && e.placeholder === 'INV-001'); return el ? el.value : null; })(),
    screen: document.body.innerText.replace(/\n{3,}/g, '\n').slice(-500),
  }));
  out.edit.form_opened = inForm;
  console.log('edit form:', JSON.stringify(inForm).slice(0, 400));

  if (!inForm.grid) {
    rec('S5.2', 'edit an inward bill and re-post', 'BLOCKED', { row: editRow, form: inForm });
  } else try {
    const gridBefore = await readGrid(s, GRID);
    out.edit.grid_before = gridBefore;
    const qCol = gridBefore.heads.findIndex(h => /qty|quantity|pack/i.test(h));
    const firstPack = Number(String((gridBefore.rows[0] || [])[qCol] || '').replace(/[^0-9]/g, '') || 0);
    const newPacks = firstPack + 3;
    const cell = await editGridCell(s, qCol, SYR.name, String(newPacks));
    await sleep(4000);
    const gridAfter = await readGrid(s, GRID);
    const ts = await s.text();
    const num = (re) => { const m = ts.match(re); return m ? Number(m[1].replace(/[^0-9.\-]/g, '')) : null; };
    const totalsAfter = { subtotal: num(/Subtotal:\s*₹\s*([\d,.]+)/i), tax: num(/(?:IGST|GST) Tax:\s*₹\s*([\d,.]+)/i), net: num(/Net Payable\s*₹\s*([\d,.]+)/i) };
    out.edit.qty_change = { column: gridBefore.heads[qCol], col: qCol, from: firstPack, to: newPacks, cell, totals_after: totalsAfter, grid_after: gridAfter };
    console.log('edit qty:', JSON.stringify(out.edit.qty_change).slice(0, 700));

    if (!cell.ok) {
      rec('S5.2', 'edit an inward bill and re-post', 'BLOCKED', { form: inForm, qty_change: out.edit.qty_change });
      out.edit.skipped = 'inline cell editor could not be driven — nothing posted';
    } else {
    // independent paisa oracle for the revised single-line bill
    const oracle = computeInvoice({
      store: { state_code: store.state_code, tax_mode: store.tax_mode, gst_type: store.gst_type },
      price_basis: 'per_pack',
      lines: [{ name: SYR.name, packs: newPacks, loose_qty: 0, unit_price: BILL_E.lines[0].rate, units_per_pack: SYR.units_per_pack, gst_percent: SYR.gst_percent }],
    });
    out.edit.oracle = oracle.totals;

    const posted = await s.page.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find(b => b.offsetParent !== null && (b.innerText || '').replace(/\s+/g, ' ').trim().startsWith('Post Purchase'));
      if (!el) return false;
      el.click();
      return true;
    });
    await sleep(4000);
    const modalOpen = await s.page.evaluate(() => /Confirm & Post Purchase/.test(document.body.innerText));
    const confirmed = modalOpen ? await s.clickText('Confirm & Post Purchase') : false;
    await sleep(14000);
    out.edit.post = { posted, modalOpen, confirmed, screen: (await s.text()).replace(/\n{3,}/g, '\n').slice(-700) };
    await shot(s, 'S5_after_edit_post');

    const docsB = await tillDocs(s, store.id);
    const tillEdited = docsB.find(d => d.id === editDoc.id) || null;
    const srvEdited = sql(`select * from purchases where invoice_number='${BILL_E.vendor}'`)[0] || null;
    const srvItemsEdited = srvEdited ? sql(`select product_name,batch_no,qty,pack_qty,taxable_amount,tax_amount,total_amount from purchase_items where purchase_id=${srvEdited.id}`) : [];
    const stockAfterEdit = await tillBatchMap(s, store.id);
    const srvAfterEdit = {};
    for (const key of Object.keys(editUnits)) {
      const [pid] = key.split('|');
      srvAfterEdit[pid] = srvBatchMap(pid, store.id);
    }
    out.edit.till_after = tillEdited;
    out.edit.server_after = srvEdited;
    out.edit.server_items = srvItemsEdited;
    out.edit.stock_after = { till: stockAfterEdit, server: srvAfterEdit };
    out.edit.queue = await localQueue(s, store.id);
    out.edit.writes = s.apiLog().filter(w => w.u !== '/api/device-sessions/heartbeat').map(w => ({ m: w.m, u: w.u, s: w.s })).slice(-12);

    const checks = [];
    if (!tillEdited) checks.push({ check: 'till still has the edited bill', got: 'MISSING', want: 'row', ok: false });
    if (!srvEdited) checks.push({ check: 'server still has the edited bill', got: 'MISSING', want: 'row', ok: false });
    if (tillEdited && srvEdited) {
      cmp('UI net payable after edit vs oracle grand', totalsAfter.net, oracle.totals.grand_total, checks);
      cmp('till grand after edit vs oracle', tillEdited.grand_total, oracle.totals.grand_total, checks);
      cmp('server grand after edit vs till', srvEdited.grand_total, tillEdited.grand_total, checks);
      cmp('server tax after edit vs till', srvEdited.tax_total, tillEdited.tax_total, checks);
      checks.push({ check: 'revised total actually changed from the original', got: { before: editDoc.grand_total, till_now: tillEdited.grand_total, server_now: srvEdited.grand_total }, want: `different from ${editDoc.grand_total}`, ok: Number(tillEdited.grand_total) !== Number(editDoc.grand_total) });
    }
    for (const [key, units] of Object.entries(editUnits)) {
      const [pid, batch] = key.split('|');
      const delta = 3 * Number(SYR.units_per_pack);
      const b = Number(stockBeforeEdit[pid] && stockBeforeEdit[pid][batch]);
      const a = Number(stockAfterEdit[pid] && stockAfterEdit[pid][batch]);
      checks.push({ check: `till batch ${batch} = seeded ${units} + ${delta} from the edit`, got: a, want: units + delta, ok: a === units + delta });
      const sb = Number(srvBeforeEdit[pid] && srvBeforeEdit[pid][batch]);
      const sa = Number(srvAfterEdit[pid] && srvAfterEdit[pid][batch]);
      checks.push({ check: `server batch ${batch} follows the edit`, got: isNaN(sb) ? 'NO ROW before' : sa, want: isNaN(sb) ? 'row exists on server' : `was ${sb}`, ok: !isNaN(sb) && sa !== sb });
    }
    checks.push({ check: `grid cell for ${SYR.name} now shows ${newPacks}`, got: cell.after, want: String(newPacks), ok: String(cell.after || '').includes(String(newPacks)) });
    const pass = checks.every(c => c.ok);
    rec('S5.2', 'edit an inward bill and re-post', pass ? 'PASS' : 'CHECK', { checks, qty_change: out.edit.qty_change, till: out.edit.till_after, server: out.edit.server_after, server_items: srvItemsEdited, post: out.edit.post, oracle: oracle.totals });
    if (!pass) def({ id: 'S5.2', severity: 'TBD', title: 'purchase edit verification found failures', evidence: checks.filter(c => !c.ok) });
    }
  } catch (e) {
    out.edit.error = { message: String((e && e.message) || e), stack: String((e && e.stack) || '').split('\n').slice(0, 8).join(' | ') };
    console.log('S5.2 ERROR: ' + out.edit.error.message + '\n   ' + out.edit.error.stack);
    rec('S5.2', 'edit an inward bill and re-post', 'ERROR', out.edit.error);
  }

  out.dialogs = s.dialogs;
  await shot(s, 'S5_final');
  await s.close();
  saveEvidence('GST_S5_purchase_edit_cancel.json', out);
})().catch(e => { console.log('FATAL: ' + ((e && e.message) || e) + '\n   ' + String((e && e.stack) || '').split('\n').slice(1, 6).join(' | ')); console.error(e); saveEvidence('GST_S5_purchase_edit_cancel.json', out); process.exit(1); });
