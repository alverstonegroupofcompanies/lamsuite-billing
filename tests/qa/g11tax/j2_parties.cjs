// Setup: customers, suppliers, doctor per store through the admin panel Parties form
const { adminSession } = require('./ui_admin_login.cjs');
const { sql, evidence, state, saveState, sleep } = require('./lib.cjs');
const PARTIES = [
  { store: 'QA-PH', type: 'customer', name: 'QA Credit Customer', phone: '9000000101', limit: '1000', open: '0' },
  { store: 'QA-PH', type: 'customer', name: 'QA No Credit Customer', phone: '9000000102', limit: '0', open: '0' },
  { store: 'QA-PH', type: 'supplier', name: 'QA Pharma Distributors', phone: '9000000103', gstin: '32AAACQ1234A1Z1', limit: '0', open: '0' },
  { store: 'QA-PH', type: 'doctor', name: 'Dr QA Physician', phone: '9000000104', reg: 'KMC-12345', limit: '0', open: '0' },
  { store: 'QA-CS', type: 'customer', name: 'QA Beauty Client', phone: '9000000201', limit: '2000', open: '0' },
  { store: 'QA-CS', type: 'supplier', name: 'QA Beauty Wholesale MH', phone: '9000000202', gstin: '27AAACQ5678B1Z2', limit: '0', open: '0' },
];
async function switchStore(s, code) {
  await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /STORE-0|QA-PH|QA-CS/.test(b.innerText) && b.innerText.includes('\n')); b && b.click(); });
  await sleep(700);
  await s.page.evaluate((code) => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.innerText.includes(code)).pop(); b && b.click(); }, code);
  await sleep(2500);
}
async function setIdx(s, i, v) {
  const el = (await s.page.$$('input,select,textarea'))[i];
  if ((await el.evaluate((e) => e.tagName)) === 'SELECT') { await el.select(v); return v; }
  await el.click(); await el.evaluate((e) => e.select && e.select()); await el.type(v, { delay: 6 });
  return el.evaluate((e) => e.value);
}
(async () => {
  const s = await adminSession('j2_parties');
  const st = state(); st.parties = st.parties || {};
  const ev = { created: [] };
  for (const p of PARTIES) {
    const sid = { 'QA-PH': 4, 'QA-CS': 5 }[p.store];
    const ex = sql(`select id from parties where store_id=${sid} and name='${p.name}'`);
    if (ex.length) { st.parties[p.name] = Number(ex[0].id); continue; }
    await s.nav('/masters'); await switchStore(s, p.store);
    await s.clickText('Parties & Ledgers'); await sleep(1200);
    await s.clickText('Add Party'); await sleep(900);
    const f = await s.labelled(); const L = (re) => f.find((x) => re.test(x.label));
    await setIdx(s, L(/Party Type/).i, p.type);
    await sleep(300);
    const f2 = await s.labelled(); const L2 = (re) => f2.find((x) => re.test(x.label));
    await setIdx(s, L2(/Full Name/).i, p.name);
    await setIdx(s, L2(/Mobile/).i, p.phone);
    if (p.gstin && L2(/GSTIN/)) await setIdx(s, L2(/GSTIN/).i, p.gstin);
    if (L2(/Credit Limit/)) await setIdx(s, L2(/Credit Limit/).i, p.limit);
    if (p.reg && L2(/Registration/)) await setIdx(s, L2(/Registration/).i, p.reg);
    const n0 = s.net.length;
    await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /^(save|create|add)( party)?$/i.test(b.innerText.trim())).pop(); b && b.click(); });
    await sleep(2200);
    const calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, req: (n.post_data || '').slice(0, 400), res: (n.response_body || '').slice(0, 300) }));
    const db = sql(`select id,store_id,type,name,phone,gstin,state_code,credit_limit,current_balance,reg_no from parties where name='${p.name}'`);
    if (db.length) st.parties[p.name] = Number(db[0].id);
    ev.created.push({ p, calls, db });
    console.log(p.store, p.type, p.name, calls.map((c) => c.m + ' ' + c.u + ' ' + c.st).join(','), JSON.stringify(db));
  }
  saveState(st);
  evidence('J2_parties', ev);
  await s.close();
})();
