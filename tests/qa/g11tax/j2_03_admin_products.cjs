// J2.03 / J2.05 products created in the admin panel per store; cross-store same barcode; same-store duplicate refused
const { adminSession } = require('./ui_admin_login.cjs');
const { sql, evidence, state, saveState, sleep } = require('./lib.cjs');
const PRODUCTS = [
  { store: 'QA-PH', name: 'QA Paracet 500 Strip', barcode: '8909000000011', hsn: '30049099', unit: 'Strip', mrp: '90', sell: '90', ptr: '60', gst: '12', upp: '15', stock: '0' },
  { store: 'QA-PH', name: 'QA Cough Syrup 100ml', barcode: '8909000000028', hsn: '30049011', unit: 'Bottle', mrp: '120', sell: '115', ptr: '80', gst: '12', upp: '1', stock: '40', batch: 'CS-A1', exp: '2027-06-30' },
  { store: 'QA-PH', name: 'QA Alprazolam 0.25 Strip', barcode: '8909000000035', hsn: '30049099', unit: 'Strip', mrp: '30', sell: '30', ptr: '18', gst: '12', upp: '10', stock: '0' },
  { store: 'QA-CS', name: 'QA Glow Face Cream 50g', barcode: '8909000000011', hsn: '33049910', unit: 'Jar', mrp: '295', sell: '250', ptr: '150', gst: '18', upp: '1', stock: '0' }, // same barcode as PH product: must be allowed
  { store: 'QA-CS', name: 'QA Ruby Lipstick', barcode: '8909100000028', hsn: '33041000', unit: 'Piece', mrp: '450', sell: '400', ptr: '220', gst: '18', upp: '1', stock: '25', batch: 'LP-01', exp: '2028-12-31' },
  { store: 'QA-PH', name: 'QA Duplicate Barcode Probe', barcode: '8909000000028', hsn: '30049099', unit: 'Bottle', mrp: '10', sell: '10', ptr: '5', gst: '12', upp: '1', stock: '0', expectRefusal: true },
];
async function switchStore(s, code) {
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /STORE-0|QA-PH|QA-CS/.test(b.innerText) && b.innerText.includes('\n')); b && b.click(); });
  await sleep(700);
  await s.page.evaluate((code) => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.innerText.includes(code)).pop(); b && b.click(); }, code);
  await sleep(2500);
}
async function setIdx(s, i, v) {
  const el = (await s.page.$$('input,select,textarea'))[i];
  const tag = await el.evaluate((e) => e.tagName);
  if (tag === 'SELECT') {
    const val = await el.evaluate((e, v) => { const o = [...e.options].find((o) => o.value === v || o.text.startsWith(v)); return o ? o.value : null; }, v);
    if (val !== null) await el.select(val); return val;
  }
  await el.click(); await el.evaluate((e) => { try { e.select(); } catch { /* date */ } });
  await el.type(v, { delay: 6 });
  return el.evaluate((e) => e.value);
}
(async () => {
  const s = await adminSession('j2_03');
  const st = state(); st.products = st.products || {};
  const ev = { created: [] };
  let cur = null;
  for (const p of PRODUCTS) {
    const sid0 = { 'QA-PH': 4, 'QA-CS': 5 }[p.store];
    if (!p.expectRefusal && sql(`select id from products where store_id=${sid0} and name='${p.name}'`).length) { st.products[p.name] = Number(sql(`select id from products where store_id=${sid0} and name='${p.name}'`)[0].id); console.log('exists', p.name); continue; }
    await s.nav('/masters');
    if (cur !== p.store || true) { await switchStore(s, p.store); cur = p.store; }
    await s.clickText('Add Product'); await sleep(1000);
    const f = await s.labelled();
    const L = (re) => f.find((x) => re.test(x.label));
    const vals = {};
    vals.name = await setIdx(s, L(/Item Name/).i, p.name);
    vals.barcode = await setIdx(s, L(/Barcode/).i, p.barcode);
    vals.hsn = await setIdx(s, L(/HSN/).i, p.hsn);
    vals.unit = await setIdx(s, L(/Primary Unit/).i, p.unit);
    vals.mrp = await setIdx(s, L(/^MRP/).i, p.mrp);
    vals.sell = await setIdx(s, L(/Selling Rate/).i, p.sell);
    vals.ptr = await setIdx(s, L(/Purchase Rate/).i, p.ptr);
    vals.gst = await setIdx(s, L(/GST Percent/).i, p.gst);
    vals.upp = await setIdx(s, L(/Units Per Pack/).i, p.upp);
    vals.stock = await setIdx(s, L(/Stock Quantity/).i, p.stock);
    if (p.batch) { vals.batch = await setIdx(s, L(/Batch No/).i, p.batch); }
    if (p.exp) { const el = (await s.page.$$('input,select,textarea'))[L(/Expiry/).i]; await el.evaluate((e, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, p.exp); vals.exp = p.exp; }
    const n0 = s.net.length;
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /^(save|create|add)( product)?$/i.test(b.innerText.trim())).pop(); b && b.click(); });
    await sleep(2500);
    const calls = s.net.slice(n0).filter((n) => n.method !== 'GET' && n.method !== 'OPTIONS').map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, req: (n.post_data || '').slice(0, 500), res: (n.response_body || '').slice(0, 500) }));
    const txt = await s.text();
    const msg = (txt.match(/(already|duplicate|exists|barcode)[^\n]{0,160}/i) || [])[0] || null;
    const db = sql(`select id,store_id,name,barcode,hsn_sac_code,gst_percent,mrp,sel_rate,ptr,units_per_pack,unit_id,current_stock,version from products where name='${p.name}'`);
    const batches = db.length ? sql(`select id,store_id,batch_no,expiry_date,stock_qty,purchase_rate,mrp from product_batches where product_id=${db[0].id}`) : [];
    await s.screenshot(`j2_03_${p.name.replace(/\W+/g, '_')}`);
    ev.created.push({ p, vals, calls, msg, db, batches });
    if (db.length && !p.expectRefusal) st.products[p.name] = Number(db[0].id);
    console.log(p.store, p.name, '| calls', calls.map((c) => c.m + ' ' + c.u + ' ' + c.st).join(','), '| db', JSON.stringify(db), '| batches', batches.length, '| msg', msg);
    if (calls[0]) console.log('   res', calls[0].res.slice(0, 300));
  }
  saveState(st);
  // list parity: each store's admin list shows only its products
  for (const code of ['QA-PH', 'QA-CS']) {
    await s.nav('/masters'); await switchStore(s, code);
    const txt = await s.text();
    ev['list_' + code] = PRODUCTS.map((p) => ({ name: p.name, store: p.store, shown: txt.includes(p.name) }));
    console.log('LIST', code, JSON.stringify(ev['list_' + code].filter((x) => x.shown).map((x) => x.name)));
  }
  evidence('J2_03_admin_products', ev);
  await s.close();
})();
