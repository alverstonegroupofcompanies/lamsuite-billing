// J2.01 quick-add from billing (typed name prefilled) -> server row in the right store -> second counter + admin see it
const { claim } = require('./pos.cjs');
const { api, sql, evidence, sleep, state, adminToken } = require('./lib.cjs');
const NAME = 'QA Zinc Quickadd Tab';
(async () => {
  const st = state(); const ev = {};
  const s = await claim('j2_01', 2, 4);
  await s.page.keyboard.press('F1'); await sleep(1000); await s.page.keyboard.press('F1'); await sleep(400);
  await s.page.keyboard.type(NAME, { delay: 35 }); await sleep(1500);
  ev.suggestions = (await s.text()).split('\n').filter((l) => /add new|create|QA Zinc/i.test(l)).slice(0, 6);
  // pick the "Add new product" option with the keyboard: ArrowDown until highlighted then Enter
  await s.page.keyboard.press('Enter'); await sleep(1500);
  ev.modal_inputs = await s.page.evaluate(() => [...document.querySelectorAll('[role=dialog] input, .fixed input')].filter((e) => e.offsetParent).map((e) => ({ ph: e.placeholder, v: e.value })).slice(0, 20));
  ev.prefilled = ev.modal_inputs.some((i) => i.v === NAME);
  console.log('SUGGEST', JSON.stringify(ev.suggestions), 'MODAL', JSON.stringify(ev.modal_inputs).slice(0, 900));
  await s.screenshot('j2_01_quickadd_modal');
  // fill minimum fields if present: MRP / selling / GST / HSN
  const fill = async (re, v) => s.page.evaluate((re, v) => { const el = [...document.querySelectorAll('[role=dialog] input, .fixed input')].find((e) => e.offsetParent && new RegExp(re, 'i').test((e.placeholder || '') + ' ' + (e.getAttribute('aria-label') || '') + ' ' + ((e.closest('label') || e.parentElement || {}).innerText || ''))); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); return true; }, re, v);
  ev.filled = { mrp: await fill('MRP', '50'), sell: await fill('Sell|Selling|Rate', '48'), hsn: await fill('HSN', '30049099'), gst: await fill('GST', '12'), barcode: await fill('Barcode', '8909000000097') };
  const n0 = s.net.length;
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); await sleep(1500);
  if (!s.net.slice(n0).some((n) => /products/.test(n.url) && n.method !== 'GET')) {
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('[role=dialog] button, .fixed button')].filter((b) => b.offsetParent && /save|create|add/i.test(b.innerText)).pop(); b && b.click(); });
  }
  await sleep(6000);
  ev.calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, res: (n.response_body || '').slice(0, 300) }));
  const t0 = Date.now();
  ev.server = sql(`select id,store_id,name,barcode,mrp,sel_rate,gst_percent from products where name='${NAME}'`);
  // second counter (C02 API token) and admin panel
  let seen = null;
  for (let i = 0; i < 6 && !seen; i++) { const r = await api('GET', `/products?search=${encodeURIComponent('QA Zinc')}`, undefined, { device: st.apiTillPH.token, token: st.apiTillPH.token }); if (r.text.includes(NAME)) seen = (Date.now() - t0) / 1000; else await sleep(2000); }
  ev.second_counter_sees_after_s = seen;
  const t = await adminToken();
  const a4 = await api('GET', `/admin/products?store_id=4&search=${encodeURIComponent('QA Zinc')}`, undefined, { token: t, store: 4 });
  const a5 = await api('GET', `/admin/products?store_id=5&search=${encodeURIComponent('QA Zinc')}`, undefined, { token: t, store: 5 });
  ev.admin = { in_store4: a4.text.includes(NAME), in_store5: a5.text.includes(NAME) };
  console.log('CALLS', JSON.stringify(ev.calls.map((c) => c.m + ' ' + c.u + ' ' + c.st)), 'SERVER', JSON.stringify(ev.server), 'C02 sees after', seen, 'ADMIN', JSON.stringify(ev.admin));
  evidence('J2_01_quickadd', ev);
  await s.close();
})();
