/**
 * Shared kit for the GST / stock / edit-cancel regression run.
 * Everything is a real keystroke or click against the POS web build.
 *
 * Isolation: backend must be started with DB_DATABASE=tests/qa/qa_gstcheck.sqlite and
 * the POS dev server must proxy to it (VITE_API_BASE_URL). driver.cjs reads QA_DB / QA_BACKEND.
 */
const path = require('path');
const fs = require('fs');
const { newSession, sql, sqlOne, saveEvidence, POS_URL, BACKEND, DB_PATH, SHOTS, EVIDENCE } = require('./driver.cjs');
const { onboard, navTo, sleep } = require('./pos_flow.cjs');
const { computeInvoice } = require('./tax_oracle.cjs');

const RUN_SHOTS = path.resolve(__dirname, '../../test-reports/screenshots/gst_run');
fs.mkdirSync(RUN_SHOTS, { recursive: true });

/** Store rows are read from the DB, never from the stale manifest. */
function storeByCode(code) {
  return sql(`select id, code, name, tax_mode, gst_type, state_code, gstin from stores where code='${code}'`)[0];
}
function userByName(username) {
  return sql(`select id, store_id, username, pin_hash, role from users where username='${username}'`)[0];
}
/** Fixture product with its live batch stock, so scenarios pick batches that can pay. */
function fixture(storeId, frag) {
  const p = sql(`select id, name, sel_rate, mrp, gst_percent, units_per_pack, current_stock, hsn_sac_code
                 from products where store_id=${storeId} and name like '%${frag}%' limit 1`)[0];
  if (!p) throw new Error(`no fixture product "${frag}" in store ${storeId}`);
  p.batches = sql(`select id, batch_no, expiry_date, stock_qty, selling_rate from product_batches
                   where product_id=${p.id} and store_id=${storeId} order by expiry_date`);
  return p;
}

/**
 * The price the POS itself would quote for this batch: posCartService prices a line from the
 * selected batch's selling_rate and only falls back to the product master when the batch has none.
 */
function batchRate(prod, batchNo) {
  const b = (prod.batches || []).find((x) => x.batch_no === batchNo);
  return b && Number(b.selling_rate) > 0 ? Number(b.selling_rate) : Number(prod.sel_rate) || 0;
}

async function shot(s, label) {
  const f = path.join(RUN_SHOTS, `${s.name}_${label.replace(/[^\w.-]+/g, '_')}.png`);
  try { await s.page.screenshot({ path: f }); } catch { /* nav in flight */ }
  return f;
}

/**
 * Sign in like a cashier: pick the operator card, punch the PIN, and answer the
 * "already signed in on another counter" guard. Driven as a state machine off the visible
 * screen, because the 409 duplicate-session guard can appear before or after the PIN pad.
 */
async function login({ storeCode, key, username, pin, counterName, budgetMs = 150000 }) {
  const s = await newSession(`gst${storeCode}${Date.now()}`, { url: POS_URL, stable: false });
  const trace = [];
  const ob = await onboard(s, key, counterName || `GST Run ${storeCode}`);
  trace.push(['onboard', ob.ok]);
  if (!ob.ok) return { s, ok: false, stage: 'onboard', detail: ob, trace };

  const deadline = Date.now() + budgetMs;
  let cardClicks = 0, pinAttempts = 0, forceClicks = 0;
  while (Date.now() < deadline) {
    const t = await s.text();

    if (/already signed in on/i.test(t) && forceClicks < 6) {
      forceClicks++;
      trace.push(['force-sign-out', forceClicks]);
      await s.clickText('Force sign-out there & continue here');
      await sleep(2500);
      continue;
    }
    if (/SELECT OPERATOR/i.test(t) && cardClicks < 6) {
      cardClicks++;
      const card = await s.page.evaluate((h) => {
        const m = [...document.querySelectorAll('button,[role="button"],div,li')]
          .filter(el => (el.innerText || '').toLowerCase().includes(h.toLowerCase()));
        const el = m.sort((a, b) => a.innerText.length - b.innerText.length)[0];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, `@${username}`);
      trace.push(['card', cardClicks, !!card]);
      if (card) await s.page.mouse.click(card.x, card.y);
      await sleep(1600);
      continue;
    }
    if (/QUICK PIN/i.test(t) && pinAttempts < 5) {
      pinAttempts++;
      await s.clickText('Clear');
      await sleep(250);
      for (const d of String(pin)) {
        if (!(await s.clickExact(d))) await s.page.keyboard.type(d, { delay: 70 });
        await sleep(160);
      }
      trace.push(['pin', pinAttempts]);
      if (!(await s.clickText('Authorize & Open Terminal'))) await s.key('Enter');
      await sleep(2200);
      continue;
    }
    if (!/SELECT OPERATOR|QUICK PIN|Authorize & Open Terminal/i.test(t)) {
      const nav = await navTo(s, '/pos');
      trace.push(['pos', nav.ok, nav.path]);
      if (nav.ok) return { s, ok: true, stage: 'pos', trace };
    }
    await sleep(1200);
  }
  await shot(s, 'login_stuck');
  return { s, ok: false, stage: 'signin', detail: (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 900), trace };
}

async function forceSignout(s) {
  const b = await s.clickText('Force sign-out there & continue here');
  if (b) await sleep(2500);
  return !!b;
}

/** Read the money footer exactly as the cashier sees it. */
async function readMoney(s) {
  const t = await s.text();
  const num = (re) => { const m = t.match(re); return m ? m[1].replace(/,/g, '') : null; };
  const rm = t.match(/Round-off:\s*([+-]?)\s*₹?\s*([\d,.]+)/i);
  return {
    subtotal: num(/SUBTOTAL:\s*₹\s*(-?[\d,.]+)/i),
    gst_tax: num(/GST TAX:\s*₹\s*(-?[\d,.]+)/i),
    round_off: rm ? `${rm[1] === '-' ? '-' : ''}${rm[2].replace(/,/g, '')}` : null,
    net_payable: num(/NET PAYABLE\s*\n+\s*₹?\s*(-?[\d,.]+)/i),
  };
}

async function invoiceNoShown(s) {
  const t = await s.text();
  const m = t.match(/INVOICE NO\s*\n+\s*([A-Z0-9\-]+)/i);
  return m ? m[1] : null;
}

/**
 * The batch picker is a scrollable listbox. A row below its own viewport still reports
 * coordinates, and clicking those lands on whatever sits behind the modal — after which the old
 * fallback pressed Enter, which confirms the FEFO default and quietly bills a different batch at
 * a different price. So: look only at the picker's own options, scroll the wanted one into view,
 * click it, and if it cannot be taken report that instead of taking the default.
 */
async function pickBatch(s, batchNo) {
  const box = await s.page.evaluate((b) => {
    const list = document.querySelector('#batch-listbox');
    const opts = list ? [...list.querySelectorAll('[role="option"]')] : [];
    const el = opts.find(o => (o.innerText || '').includes(b));
    if (!el) {
      return { ok: false, why: 'batch is not offered in the picker', wanted: b,
        offered: opts.map(o => (o.innerText || '').replace(/\s+/g, ' ').slice(0, 44)) };
    }
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { ok: true, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: el.getAttribute('aria-disabled') };
  }, batchNo);
  if (!box.ok) return { clicked: false, box, stillOpen: true };
  await s.page.mouse.click(box.x, box.y);
  await sleep(1400);
  return { clicked: true, box, stillOpen: await batchModalOpen(s) };
}

async function batchModalOpen(s) {
  return /Select Batch \(FEFO Order\)/.test(await s.text());
}

/** Add one cart line: search, take a specific batch, set packs/loose, and verify it stuck. */
async function addLine(s, { search, batch, packs = 0, loose = 0 }) {
  const SEARCH = 'input[aria-label="Scan barcode or type product name"]';
  await s.page.click(SEARCH);
  await s.page.keyboard.type(String(search), { delay: 40 });
  await sleep(1700);
  await s.key('Enter');
  await sleep(1600);
  let pickedBatch = null;
  if (await batchModalOpen(s)) {
    if (batch) {
      const pk = await pickBatch(s, batch);
      pickedBatch = batch;
      if (pk.stillOpen) return { ok: false, why: 'batch modal would not close', search, batch, detail: pk };
    } else {
      await s.key('Enter'); pickedBatch = 'fefo-first'; await sleep(1500);
    }
  }
  const ids = await s.page.evaluate(() => [...document.querySelectorAll('input[id^="qty-input-"]')]
    .map(i => i.id.replace(/^qty-input-/, '').replace(/-(pack|loose)$/, ''))
    .filter((v, i, a) => a.indexOf(v) === i));
  const id = ids[ids.length - 1];
  if (!id) return { ok: false, why: 'line not added', search };
  const seen = {};
  for (const [kind, want] of [['pack', packs], ['loose', loose]]) {
    const sel = `#qty-input-${id}-${kind}`;
    if (!(await s.page.$(sel))) { seen[kind] = 'no-input'; continue; }
    const cur = await s.page.$eval(sel, e => e.value).catch(() => null);
    if (cur != null && Number(cur) === Number(want)) { seen[kind] = cur; continue; }
    await s.page.click(sel);
    await s.page.evaluate(x => { const el = document.querySelector(x); el.focus(); el.setSelectionRange(0, el.value.length); }, sel);
    await s.page.keyboard.type(String(want), { delay: 40 });
    await sleep(400);
    await s.key('Enter');
    await sleep(900);
    seen[kind] = await s.page.$eval(sel, e => e.value).catch(() => null);
  }
  const stuck = [['pack', seen.pack, Number(packs)], ['loose', seen.loose, Number(loose)]]
    .filter(([k, got, w]) => got !== 'no-input' && Number(got) !== w);
  if (stuck.length) return { ok: false, why: 'quantity did not stick', search, seen, stuck };
  if (await batchModalOpen(s)) return { ok: false, why: 'batch modal reopened after qty', search, seen };
  return { ok: true, id, batch: pickedBatch, seen };
}

/** FEFO-ish batch that can actually pay for `units`, so a line is never blocked on shortage. */
function batchWithStock(prod, units, prefer) {
  const sorted = [...(prod.batches || [])].sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
  const enough = sorted.find(b => (prefer ? b.batch_no === prefer : true) && Number(b.stock_qty) >= units)
    || sorted.find(b => Number(b.stock_qty) >= units);
  return enough ? enough.batch_no : (prefer || (sorted[0] && sorted[0].batch_no));
}

/** Settle with a single tender mode and save without printing. */
async function checkoutAndSave(s, { tender = 'Cash' } = {}) {
  await s.key('F12');
  await sleep(2500);
  const dialogText = (await s.text()).replace(/\n{3,}/g, '\n');
  const tenderPicked = await s.clickExact(tender) || await s.page.evaluate((t) => {
    const el = [...document.querySelectorAll('button,[role="button"]')]
      .find(b => ((b.innerText || '').trim().split('\n')[0]) === t && b.offsetParent !== null);
    if (!el) return false;
    el.click();
    return true;
  }, tender);
  await sleep(900);
  if (!(await s.clickText('Save (Ctrl+S)'))) {
    await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control');
  }
  let confirmed = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const t = await s.text();
    const m = t.match(/billed successfully[^\n]*|Invoice [A-Z0-9\-]+ (?:saved|created)[^\n]*/i);
    if (m) { confirmed = m[0]; break; }
    if (/Business rule|not allowed|Blocked|failed to save/i.test(t)) { confirmed = 'ERROR: ' + t.slice(-300); break; }
  }
  await sleep(3500);
  return {
    tenderPicked: !!tenderPicked, confirmed,
    checkout_screen: dialogText.slice(Math.max(0, dialogText.length - 1200)),
    tail: (await s.text()).replace(/\n{3,}/g, '\n').slice(-400),
  };
}

/** Force the device to flush its sync queue so queued docs reach the backend. */
async function flushQueue(s) {
  const tried = [];
  for (const label of ['Sync Now', 'Force Sync', 'Sync Pending', 'Sync']) {
    const ok = await s.clickExact(label);
    tried.push([label, !!ok]);
    if (ok) { await sleep(6000); break; }
  }
  return tried;
}

/** Server-side view of one invoice, with lines and payments. */
function serverInvoice(number, storeId) {
  const inv = sql(`select * from invoices where store_id=${storeId} and invoice_number='${number}'`)[0] || null;
  if (!inv) return null;
  inv.items = sql(`select * from invoice_items where invoice_id=${inv.id} order by id`);
  inv.payments = sql(`select * from invoice_payments where invoice_id=${inv.id} order by id`);
  return inv;
}

/** Server-side stock for a product's batches, in units. */
function serverBatchStock(productId) {
  return sql(`select batch_no, expiry_date, stock_qty from product_batches where product_id=${productId} order by expiry_date`);
}
function serverStockTx(productId, sinceMs) {
  return sql(`select id, event_type, qty_delta, batch_id, reference_type, reference_id, balance_after, created_at
              from stock_ledger_entries where product_id=${productId} ${sinceMs ? `and created_at >= '${new Date(sinceMs).toISOString().slice(0, 19).replace('T', ' ')}'` : ''}
              order by id desc limit 12`);
}

/** React controls ignore a bare .value write — use the native setter and fire events. */
async function setInput(s, selector, value) {
  return s.page.evaluate((sel, v) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.focus();
    const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
      : (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return el.value;
  }, selector, value);
}

/** Pick the option whose value or visible text matches, for a React <select>. */
async function selectOption(s, selector, want) {
  return s.page.evaluate((sel, w) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, why: 'no select' };
    const opt = [...el.options].find(o => o.value === w || (o.text || '').toLowerCase().includes(String(w).toLowerCase()));
    if (!opt) return { ok: false, why: 'no option', options: [...el.options].map(o => o.value + '|' + o.text) };
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, value: opt.value, text: opt.text };
  }, selector, want);
}

/** Find the first select whose preceding label text matches, then set it. */
async function selectByLabel(s, labelText, want) {
  const sel = await s.page.evaluate((l) => {
    const lab = [...document.querySelectorAll('label,span,div,p,th')].find(e => e.children.length === 0
      && (e.innerText || '').trim().toLowerCase().includes(String(l).toLowerCase()));
    if (!lab) return null;
    let node = lab;
    for (let up = 0; up < 5 && node; up++) {
      const s2 = node.querySelector && node.querySelector('select');
      if (s2) { s2.setAttribute('data-qa-found', '1'); return 'select[data-qa-found="1"]'; }
      node = node.parentElement;
    }
    const sib = lab.parentElement && lab.parentElement.querySelector('select');
    if (sib) { sib.setAttribute('data-qa-found', '1'); return 'select[data-qa-found="1"]'; }
    return null;
  }, labelText);
  if (!sel) return { ok: false, why: `no select for label "${labelText}"` };
  return selectOption(s, sel, want);
}

/** Parse "GST Reversal: ₹ 12.34" style readouts off the screen. */
async function readLabeled(s, labels) {
  const t = await s.text();
  const out = {};
  for (const l of labels) {
    const m = t.match(new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:?\\s*(?:₹\\s*)?(-?[\\d,]+(?:\\.\\d+)?)', 'i'));
    out[l] = m ? m[1].replace(/,/g, '') : null;
  }
  return out;
}

/** The till's own copy of a table (MockSqliteDatabase persists [id, record] pairs per store). */
async function localTable(s, table, storeId) {
  const raw = await s.page.evaluate((t, sid) => {
    const key = Object.keys(localStorage).find(k => k === `lamsuite_tbl_${sid}_${t}`)
      || Object.keys(localStorage).find(k => k.startsWith('lamsuite_tbl_') && k.endsWith(`_${t}`));
    if (!key) return { key: null, json: null };
    return { key, json: localStorage.getItem(key) };
  }, table, storeId);
  if (!raw.key) return { key: null, rows: [] };
  try {
    const parsed = JSON.parse(raw.json);
    const rows = (Array.isArray(parsed) ? parsed : []).map(e => (Array.isArray(e) ? e[1] : e)).filter(Boolean);
    return { key: raw.key, rows };
  } catch { return { key: raw.key, rows: [], parse_error: true }; }
}

/** Queue state, so a "not on the server" finding can be attributed to the client or the push. */
async function localQueue(s, storeId) {
  const { rows } = await localTable(s, 'sync_queue', storeId);
  return (rows || []).map(e => ({
    entity: e.entity_type || e.entity, op: e.action || e.operation, status: e.status,
    error: (e.last_error || '').slice(0, 120), id: e.entity_id,
    payload: String(e.payload_json || '').slice(0, 260),
  }));
}

/**
 * Set a cell of an in-app grid table by its column header, without knowing the cell's id.
 * Works for edit-on-click cells too: the cell is clicked first, then whatever control appears
 * is filled. Returns what was found so a failure is attributable to the UI, not the harness.
 */
async function setGridCell(s, gridSelector, headerText, rowIndex, value) {
  const found = await s.page.evaluate((g, h, r) => {
    const grids = [...document.querySelectorAll(g)];
    if (document.querySelector(g) && grids.length === 0) grids.push(document.querySelector(g));
    const tables = grids.length ? grids : [...document.querySelectorAll('table')];
    for (const grid of tables) {
      const heads = [...grid.querySelectorAll('thead th, thead td')].map(x => (x.innerText || '').replace(/\s+/g, ' ').trim());
      const col = heads.findIndex(x => x.toLowerCase().includes(String(h).toLowerCase()));
      if (col < 0) continue;
      const rows = [...grid.querySelectorAll('tbody tr')];
      const row = rows[r];
      if (!row) return { ok: false, why: 'no row', rows: rows.length, heads };
      const cell = row.children[col];
      if (!cell) return { ok: false, why: 'no cell', heads };
      cell.scrollIntoView({ block: 'center' });
      const rect = cell.getBoundingClientRect();
      cell.setAttribute('data-qa-cell', '1');
      return { ok: true, heads, col, rows: rows.length, cell_text: (cell.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    }
    return { ok: false, why: 'no column in any table', tried: tables.map(t => [...t.querySelectorAll('thead th')].map(x => (x.innerText || '').trim()).join(',')) };
  }, gridSelector, headerText, rowIndex);
  if (!found.ok) return found;
  if (!/INPUT|SELECT|TEXTAREA/.test(found.cell_text)) {
    await s.page.mouse.click(found.x, found.y);
    await sleep(700);
  }
  const filled = await s.page.evaluate((v) => {
    const cell = document.querySelector('[data-qa-cell="1"]');
    if (!cell) return { ok: false, why: 'cell marker lost' };
    const el = cell.querySelector('input,select,textarea');
    if (!el) return { ok: false, why: 'no control in cell', cell_html: cell.innerHTML.slice(0, 200) };
    el.focus();
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === String(v) || (o.text || '').toLowerCase().includes(String(v).toLowerCase()));
      if (!opt) return { ok: false, why: 'no option', options: [...el.options].map(o => o.text).slice(0, 8) };
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, tag: 'SELECT', value: el.value, text: opt.text };
    }
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, tag: 'INPUT', type: el.type, value: el.value };
  }, value);
  await sleep(700);
  await s.key('Tab').catch(() => {});
  await sleep(500);
  return { ...found, ...filled };
}

/**
 * The stock-adjustment grid renders a cell editor only while that cell is in
 * edit mode, and it enters edit mode on double-click (or Enter), not on click.
 * So: double-click the data-cell, then fill the data-cell-edit control that appears.
 */
async function setAdjCell(s, rowIndex, column, value) {
  const box = await s.page.evaluate((r, c) => {
    const el = document.querySelector(`[data-cell="${r}-${c}"]`);
    if (!el) return { ok: false, why: 'no cell', present: [...document.querySelectorAll('[data-cell]')].map(x => x.getAttribute('data-cell')).slice(0, 20) };
    el.scrollIntoView({ block: 'center' });
    const rect = el.getBoundingClientRect();
    return { ok: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: (el.innerText || '').trim() };
  }, rowIndex, column);
  if (!box.ok) return box;
  await s.page.mouse.click(box.x, box.y, { clickCount: 2 });
  await sleep(600);
  const filled = await s.page.evaluate((r, c, v) => {
    const el = document.querySelector(`[data-cell-edit="${r}-${c}"]`);
    if (!el) return { ok: false, why: 'editor did not open', cls: 'none' };
    if (el.tagName === 'SELECT') {
      const opt = [...el.options].find(o => o.value === String(v) || (o.text || '').toLowerCase().includes(String(v).toLowerCase()));
      if (!opt) return { ok: false, why: 'no option', wanted: String(v), options: [...el.options].map(o => o.text).slice(0, 12) };
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(el, opt.value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return { ok: true, tag: 'SELECT', value: el.value, text: opt.text };
    }
    el.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return { ok: true, tag: 'INPUT', type: el.type, value: el.value };
  }, rowIndex, column, value);
  await sleep(500);
  if (filled.ok) {
    const after = await s.page.evaluate((r) => [...document.querySelectorAll(`[data-cell^="${r}-"]`)]
      .map(e => ({ c: e.getAttribute('data-cell').slice(String(r).length + 1), v: (e.innerText || '').trim() })), rowIndex);
    return { ...filled, row: after };
  }
  return filled;
}

/** Read a grid table as text rows, keyed by header. */
async function readGrid(s, gridSelector) {
  return s.page.evaluate((g) => {
    const grid = document.querySelector(g) || document.querySelector('table');
    if (!grid) return { heads: [], rows: [] };
    const heads = [...grid.querySelectorAll('thead th, thead td')].map(x => (x.innerText || '').replace(/\s+/g, ' ').trim());
    const rows = [...grid.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => (td.innerText || '').replace(/\s+/g, ' ').trim()));
    return { heads, rows };
  }, gridSelector);
}

/**
 * The purchase inward form keeps committed lines in <tbody> and a permanent
 * product-entry row in <tfoot>. That draft row exposes live inputs (never a
 * click-to-edit cell); Enter on its last input (selling rate) is what promotes
 * the draft into a committed line.
 */
async function draftRowText(s) {
  return s.page.evaluate(() => {
    const tr = document.querySelector('table tfoot tr');
    return tr ? (tr.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400) : null;
  });
}

/** Focus the draft row's product search box, type a product name, accept the first suggestion. */
async function addDraftProduct(s, name) {
  const found = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /scan barcode or type product/i.test(e.placeholder || ''));
    if (!el) return null;
    el.focus();
    return true;
  });
  if (!found) return { ok: false, why: 'no draft product search input' };
  await sleep(300);
  await s.page.keyboard.press('Escape').catch(() => {});
  await sleep(250);
  await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /scan barcode or type product/i.test(e.placeholder || ''));
    if (el) { el.focus(); el.select(); }
  });
  await s.page.keyboard.press('Delete').catch(() => {});
  await s.page.keyboard.type(name, { delay: 45 });
  await sleep(1800);
  await s.page.keyboard.press('Enter');
  await sleep(1500);
  const row = await draftRowText(s);
  return { ok: !!row && row.toLowerCase().includes(name.split(' ')[0].toLowerCase()), typed: name, draft_row: row };
}

/** Set the draft row's batch via the BatchCombobox portal (supports a brand-new batch value). */
async function setDraftBatch(s, batch) {
  const trigger = () => s.page.evaluate(() => {
    const el = document.querySelector('table tfoot [role="combobox"]');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const searchSel = () => s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /search product name or batch/i.test(e.placeholder || ''));
    if (!el) return null;
    el.setAttribute('data-qa-batch-search', '1');
    el.focus();
    return 'input[data-qa-batch-search="1"]';
  });

  const tried = [];
  // ArrowDown opens the listbox without the toggle race a click can hit when a
  // previous row left it already open.
  const t0 = await trigger();
  if (!t0) return { ok: false, why: 'no batch combobox in draft row' };
  await s.page.evaluate(() => document.querySelector('table tfoot [role="combobox"]').focus());
  await s.page.keyboard.press('ArrowDown');
  await sleep(900);
  tried.push('arrow');
  let sel = await searchSel();

  for (const alt of ['click', 'click-again']) {
    if (sel) break;
    const box = await trigger();
    if (!box) break;
    await s.page.mouse.click(box.x, box.y);
    await sleep(900);
    tried.push(alt);
    sel = await searchSel();
  }
  if (!sel) return { ok: false, why: 'batch dropdown did not open', tried };

  await s.page.keyboard.type(batch, { delay: 40 });
  await sleep(700);
  await s.page.keyboard.press('Enter');
  await sleep(1000);
  return { ok: true, batch, via: tried, draft_row: await draftRowText(s) };
}

/** Type into one of the draft row's always-live inputs, identified by placeholder. */
async function setDraftField(s, placeholder, value) {
  const found = await s.page.evaluate((p) => {
    const el = [...document.querySelectorAll('table tfoot input')].find(e => e.offsetParent !== null && (e.placeholder || '').toLowerCase() === String(p).toLowerCase());
    if (!el) {
      return { ok: false, why: 'no draft input', present: [...document.querySelectorAll('table tfoot input')]
        .filter(e => e.offsetParent !== null).map(e => e.type + ':' + e.placeholder) };
    }
    el.scrollIntoView({ block: 'center' });
    el.focus();
    el.select();
    return { ok: true, before: el.value };
  }, placeholder);
  if (!found.ok) return found;
  await sleep(200);
  await s.page.keyboard.press('Delete').catch(() => {});
  await s.page.keyboard.type(String(value), { delay: 40 });
  await sleep(400);
  await s.page.keyboard.press('Enter');
  await sleep(700);
  const after = await s.page.evaluate((p) => {
    const el = [...document.querySelectorAll('table tfoot input')].find(e => (e.placeholder || '').toLowerCase() === String(p).toLowerCase());
    return el ? el.value : null;
  }, placeholder);
  return { ok: String(after) === String(value), placeholder, before: found.before, typed: value, after };
}

const p2 = (v) => Number(v ?? 0).toFixed(2);
const eq = (a, b) => p2(a) === p2(b);
function cmp(label, got, want, out) {
  const ok = eq(got, want);
  out.push({ check: label, got: p2(got), want: p2(want), ok });
  return ok;
}

module.exports = {
  storeByCode, userByName, fixture, login, shot, sleep, readMoney, invoiceNoShown, addLine,
  pickBatch, batchModalOpen, batchWithStock, batchRate,
  checkoutAndSave, flushQueue, serverInvoice, serverBatchStock, serverStockTx,
  computeInvoice, p2, eq, cmp, forceSignout, navTo, sql, sqlOne, saveEvidence, BACKEND, DB_PATH, RUN_SHOTS,
  setInput, selectOption, selectByLabel, readLabeled, localTable, localQueue, setGridCell, readGrid, setAdjCell,
  draftRowText, addDraftProduct, setDraftBatch, setDraftField,
};
