// J2.02 quick-add from the purchase grid: typed name prefilled, saved to server under the right store, visible to C02 and admin
const { claim } = require('./pos.cjs');
const { api, sql, evidence, sleep, state, adminToken } = require('./lib.cjs');
const NAME = 'QA Vitamin C Quickadd';
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || ''}=${(e.value ?? '').toString().slice(0, 30)}` : null; });
async function tabTo(s, re, max = 50) { for (let i = 0; i < max; i++) { const a = await active(s); if (re.test(a)) return a; await s.page.keyboard.press('Tab'); await sleep(60); } return null; }
(async () => {
  const st = state(); const ev = {};
  const s = await claim('j2_02', 2, 4);
  await s.page.keyboard.press('F2'); await sleep(1500);
  await s.clickText('New Inward Bill'); await sleep(1500);
  await tabTo(s, /type product name \[F1\]/);
  await s.page.keyboard.type(NAME, { delay: 35 }); await sleep(1500);
  ev.options = (await s.text()).split('\n').filter((l) => /Add new product|QA Vitamin/i.test(l)).slice(0, 5);
  // the "Add new product" option is the only/first result for an unknown name
  await s.page.keyboard.press('Enter'); await sleep(1500);
  ev.modal = await s.page.evaluate(() => [...document.querySelectorAll('input,select')].filter((e) => e.offsetParent && e.closest('[role=dialog], .fixed')).map((e) => ({ ph: e.placeholder || e.getAttribute('aria-label') || e.name, v: e.value })).slice(0, 25));
  ev.prefilled = ev.modal.some((i) => i.v === NAME);
  console.log('OPTIONS', JSON.stringify(ev.options), 'PREFILLED', ev.prefilled, JSON.stringify(ev.modal).slice(0, 1200));
  await s.screenshot('j2_02_quickadd_modal');
  const n0 = s.net.length;
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('Enter'); await s.page.keyboard.up('Control'); await sleep(800);
  if (!/Batch|purchase-batch/.test(await active(s))) {
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.closest('[role=dialog], .fixed') && /save|create|add product/i.test(b.innerText)).pop(); b && b.click(); });
  }
  await sleep(6000);
  ev.calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, res: (n.response_body || '').slice(0, 400) }));
  ev.after_active = await active(s);
  ev.server = sql(`select id,store_id,name,barcode,hsn_sac_code,gst_percent,units_per_pack from products where name='${NAME}'`);
  const t0 = Date.now(); let seen = null;
  for (let i = 0; i < 8 && !seen; i++) { const r = await api('GET', `/products?search=${encodeURIComponent('QA Vitamin')}`, undefined, { device: st.apiTillPH.token, token: st.apiTillPH.token }); if (r.text.includes(NAME)) seen = (Date.now() - t0) / 1000; else await sleep(2000); }
  ev.second_counter_sees_after_s = seen;
  const t = await adminToken();
  ev.admin = { in_store4: (await api('GET', `/admin/products?store_id=4&search=QA%20Vitamin`, undefined, { token: t, store: 4 })).text.includes(NAME), in_store5: (await api('GET', `/admin/products?store_id=5&search=QA%20Vitamin`, undefined, { token: t, store: 5 })).text.includes(NAME) };
  console.log('CALLS', JSON.stringify(ev.calls.map((c) => c.m + ' ' + c.u + ' ' + c.st + ' ' + c.res.slice(0, 120))), 'SERVER', JSON.stringify(ev.server), 'C02 after', seen, 'ADMIN', JSON.stringify(ev.admin), 'focus', ev.after_active);
  evidence('J2_02_quickadd_purchase', ev);
  await s.close();
})();
