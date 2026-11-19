/**
 * S3 — purchase inward bill and purchase return (debit note), through the POS web UI.
 * S3SURVEY=1 stops after the first product row is added and prints the grid's real controls,
 * so the full run never guesses at selectors.
 */
const {
  storeByCode, fixture, login, shot, sleep, navTo, sql, saveEvidence, localTable, localQueue,
  serverBatchStock, setGridCell, readGrid, setInput, readMoney, p2, eq, cmp,
} = require('./gst_kit.cjs');

const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';
const SURVEY = process.env.S3SURVEY === '1';
const out = { scenarios: [], defects: [], notes: [], survey: {} };
const rec = (id, title, status, evidence) => {
  out.scenarios.push({ id, title, status, evidence });
  console.log(`[${status}] ${id} — ${title}`);
  if (status !== 'PASS') console.log('     ' + JSON.stringify(evidence).slice(0, 1500));
};
const def = (d) => { out.defects.push(d); console.log(`  >>> DEFECT ${d.severity} ${d.id}: ${d.title}`); };

const GRID = 'table[aria-label="Purchase Inward Items"]';
const stamp = String(Date.now()).slice(-6);
const PUR_INV = `QA-PUR-${stamp}`;

function batchMap(productId, storeId) {
  const m = {};
  for (const b of sql(`select batch_no, stock_qty, expiry_date from product_batches where product_id=${productId} and store_id=${storeId}`)) m[b.batch_no] = Number(b.stock_qty);
  return m;
}

async function pickSuggestion(s, frag) {
  const box = await s.page.evaluate((f) => {
    const els = [...document.querySelectorAll('button,[role="option"],[role="button"],li,div')]
      .filter(el => el.offsetParent !== null && (el.innerText || '').includes(f) && (el.innerText || '').length < 220);
    const el = els.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.innerText || '').replace(/\s+/g, ' ').slice(0, 80) };
  }, frag);
  if (!box) return { ok: false, why: 'no suggestion' };
  await s.page.mouse.click(box.x, box.y);
  await sleep(1800);
  return { ok: true, picked: box.text };
}

async function typeIntoPlaceholder(s, phFrag, text) {
  const sel = await s.page.evaluate((p) => {
    const el = [...document.querySelectorAll('input,textarea')].find(e => e.offsetParent !== null && (e.placeholder || '').toLowerCase().includes(p.toLowerCase()));
    if (!el) return null;
    el.setAttribute('data-qa-ph', '1');
    return 'input[data-qa-ph="1"],textarea[data-qa-ph="1"]';
  }, phFrag);
  if (!sel) return { ok: false, why: `no input for placeholder "${phFrag}"` };
  await s.page.click(sel);
  await sleep(200);
  const v = await setInput(s, sel, text);
  await sleep(1500);
  return { ok: true, value: v };
}

async function findSearchSel(s) {
  return s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /scan barcode or type product/i.test(e.placeholder || ''));
    if (!el) return null;
    el.setAttribute('data-qa-search', '1');
    return 'input[data-qa-search="1"]';
  });
}

async function addPurchaseProduct(s, name) {
  let sel = await findSearchSel(s);
  if (!sel) {
    // the inward grid has no draft row until product entry is invoked
    await s.key('F1');
    await sleep(2000);
    sel = await findSearchSel(s);
  }
  if (!sel) return { ok: false, why: 'no purchase product search box even after F1' };
  const rows = async () => (await readGrid(s, GRID)).rows.length;
  await s.page.click(sel);
  await s.page.keyboard.type(name, { delay: 45 });
  await sleep(2500);
  const drop = (await s.text()).replace(/\n{3,}/g, '\n').slice(-500);
  // the entry field is keyboard-first: Enter accepts the highlighted suggestion
  await s.key('Enter');
  await sleep(2500);
  let via = 'enter';
  let n = await rows();
  if (!n) {
    const picked = await pickSuggestion(s, name.split(' ').slice(0, 3).join(' '));
    await sleep(2000);
    await s.key('Enter');
    await sleep(2500);
    via = 'click+enter';
    n = await rows();
    return { ok: n > 0, typed: name, suggestion: picked, rows_before_look: drop, via, grid: await readGrid(s, GRID) };
  }
  return { ok: true, typed: name, suggestion: { ok: true, picked: 'enter' }, rows_before_look: drop, via, grid: await readGrid(s, GRID) };
}

(async () => {
  const store = storeByCode('QA-A');
  const SYR = fixture(store.id, 'QA Antibiotic Syrup');
  const ORS = fixture(store.id, 'QA Oral Rehydration');
  console.log('store', JSON.stringify(store));

  const { s, ok, stage, detail } = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101', counterName: 'GST Run S3' });
  console.log('login', ok, stage, JSON.stringify(detail || '').slice(0, 160));
  if (!ok) { saveEvidence('GST_S3_purchases.json', out); process.exit(1); }

  const before = { [SYR.id]: batchMap(SYR.id, store.id), [ORS.id]: batchMap(ORS.id, store.id) };
  console.log('server batch stock before:', JSON.stringify(before));

  const nav = await navTo(s, '/purchases');
  await sleep(2000);
  await s.clickText('New Inward Bill');
  await sleep(3000);
  const formOpen = /Purchase Operations|Inward/i.test(await s.text());
  console.log('form open:', formOpen);

  const sup = await typeIntoPlaceholder(s, 'Select or search supplier', 'QA Supplier Kerala');
  await sleep(2500);
  const supPick = await pickSuggestion(s, 'QA Supplier Kerala');
  const invNo = await typeIntoPlaceholder(s, 'INV-001', PUR_INV);
  out.survey.supplier = { sup, supPick, invNo };
  console.log('supplier:', JSON.stringify(out.survey.supplier));

  const p1 = await addPurchaseProduct(s, SYR.name);
  out.survey.after_first_product = p1;
  console.log('grid heads:', JSON.stringify((p1.grid || {}).heads));
  console.log('grid rows:', JSON.stringify((p1.grid || {}).rows));
  const map = await s.page.evaluate((g) => {
    const tables = [...document.querySelectorAll('table')].map((t, i) => ({
      i,
      aria: t.getAttribute('aria-label'),
      heads: [...t.querySelectorAll('thead th')].map(x => (x.innerText || '').replace(/\s+/g, ' ').trim()).slice(0, 20),
      rows: t.querySelectorAll('tbody tr').length,
      is_grid_sel: t === document.querySelector(g),
    }));
    const search = [...document.querySelectorAll('input')].find(e => /scan barcode or type product/i.test(e.placeholder || ''));
    let searchRow = null;
    if (search) {
      const tr = search.closest('tr');
      searchRow = tr ? {
        inTable: !!tr.closest('table[aria-label]') && tr.closest('table').getAttribute('aria-label'),
        cells: [...tr.children].map((td, i) => {
          const el = td.querySelector('input,select,textarea');
          return { col: i, text: (td.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24), tag: el ? el.tagName + (el.type ? ':' + el.type : '') : null, id: el ? el.id : null };
        }),
      } : { noTr: true, outer: search.outerHTML.slice(0, 200) };
    }
    return {
      tables,
      searchRow,
      buttons: [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null)
        .map(b => (b.innerText || b.getAttribute('title') || '').replace(/\s+/g, ' ').trim()).filter(x => x).slice(0, 60),
    };
  }, GRID);
  out.survey.page_map = map;
  console.log('tables:', JSON.stringify(map.tables));
  console.log('search row:', JSON.stringify(map.searchRow, null, 1));
  console.log('buttons:', JSON.stringify(map.buttons));
  if (SURVEY) { await shot(s, 'S3_survey'); await s.close(); saveEvidence('GST_S3_survey.json', out); return; }

  // fill the first row: batch, expiry, qty, rate
  const NEWB = `QAPUR${stamp}`;
  const cells = [
    ['BATCH', NEWB], ['EXPIRY', '12/28'], ['QUANTITY', '5'], ['PUR. RATE', '150'],
  ];
  const filled = [];
  for (const [h, v] of cells) filled.push({ header: h, res: await setGridCell(s, GRID, h, 0, v) });
  console.log('filled row 0:', JSON.stringify(filled));

  const p2add = await addPurchaseProduct(s, ORS.name);
  const filled2 = [];
  for (const [h, v] of [['BATCH', NEWB + '-B'], ['EXPIRY', '06/29'], ['QUANTITY', '2'], ['PUR. RATE', '240']]) {
    filled2.push({ header: h, res: await setGridCell(s, GRID, h, 1, v) });
  }
  await sleep(1500);
  const gridAfter = await readGrid(s, GRID);
  const money = await readMoney(s);
  await shot(s, 'S3_before_post');

  await s.key('F12');
  await sleep(3000);
  const postScreen = (await s.text()).replace(/\n{3,}/g, '\n');
  const confirmed = await s.clickText('Confirm & Post Purchase') || (await s.key('Enter'), true);
  await sleep(9000);
  await shot(s, 'S3_after_post');
  const afterPost = (await s.text()).replace(/\n{3,}/g, '\n');

  const srvPurchases = sql(`select * from purchases where store_id=${store.id} order by id desc limit 3`);
  const srvItems = srvPurchases.length ? sql(`select * from purchase_items where purchase_id=${srvPurchases[0].id}`) : [];
  const tillDocs = (await localTable(s, 'purchase_documents', store.id)).rows;
  const after = { [SYR.id]: batchMap(SYR.id, store.id), [ORS.id]: batchMap(ORS.id, store.id) };
  const queue = await localQueue(s, store.id);
  const writes = s.apiLog().filter(w => w.u !== '/api/device-sessions/heartbeat').map(w => ({ m: w.m, u: w.u, s: w.s })).slice(-16);

  const checks = [];
  const srvDoc = srvPurchases.find(p => (p.supplier_invoice_number || p.invoice_number || '').includes(PUR_INV)) || srvPurchases[0];
  rec('S3.1', 'purchase inward bill with two new batches', srvDoc && srvItems.length === 2 ? 'CHECK' : 'FAIL', {
    purchase_number_expected: PUR_INV, server_purchases: srvPurchases, server_items: srvItems,
    till_documents: tillDocs.map(d => ({ id: d.id, no: d.bill_number || d.purchase_number, supplier_inv: d.supplier_invoice_number, grand: d.grand_total, lines: (d.lines || []).length, status: d.status })),
    ui_money: money, grid: gridAfter, filled, filled2, stock_before: before, stock_after: after, queue, writes,
    post_screen: postScreen.slice(-700), after_post: afterPost.slice(-500),
  });

  await s.close();
  saveEvidence('GST_S3_purchases.json', out);
})().catch(e => { console.error(e); saveEvidence('GST_S3_purchases.json', out); process.exit(1); });
