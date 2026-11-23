// J1.01 create two stores through the admin panel UI, verify on all surfaces
const { adminSession } = require('./ui_admin_login.cjs');
const { sql, evidence, state, saveState } = require('./lib.cjs');
const defs = [
  { name: 'QA Pharma Kochi', code: 'QA-PH', st: '32', gstin: '32ABCDE1234F1Z5', type: 'pharmacy', gst: 'regular', basis: 'inclusive', addr: 'QA Lane 1, Kochi 682001' },
  { name: 'QA Glow Cosmetics', code: 'QA-CS', st: '29', gstin: '29ABCDE1234F1Z5', type: 'cosmetics', gst: 'regular', basis: 'exclusive', addr: 'QA Road 2, Bengaluru 560001' },
];
(async () => {
  const s = await adminSession('j1_01');
  const ev = { steps: [] };
  for (const d of defs) {
    const before = sql(`select count(*) n from stores where code='${d.code}'`)[0].n;
    if (before) { ev.steps.push({ code: d.code, skipped: 'exists' }); continue; }
    await s.nav('/stores');
    await s.clickText('Add Store Branch'); await new Promise((r) => setTimeout(r, 1000));
    const set = async (idx, v) => {
      const els = await s.page.$$('input,select,textarea'); const el = els[idx];
      const tag = await el.evaluate((e) => e.tagName);
      if (tag === 'SELECT') await el.select(v);
      else { await el.click({ clickCount: 3 }); await s.page.keyboard.press('Delete'); await el.type(v, { delay: 10 }); }
    };
    await set(2, d.name); await set(3, d.code); await set(4, d.st); await set(6, d.gstin);
    await set(7, d.type); await set(8, d.gst); await set(9, d.basis); await set(11, d.addr);
    await s.screenshot(`j1_01_form_${d.code}`);
    const n0 = s.net.length;
    const clicked = await s.page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /create|save/i.test(b.innerText) && !/add store branch/i.test(b.innerText)).pop();
      if (b) { b.click(); return b.innerText; } return null;
    });
    await new Promise((r) => setTimeout(r, 3000));
    const calls = s.net.slice(n0).filter((n) => n.method !== 'GET').map((n) => ({ m: n.method, u: n.url, st: n.status, req: n.post_data, res: (n.response_body || '').slice(0, 600) }));
    const ui = await s.text();
    const row = sql(`select id,code,name,state_code,gstin,store_type,gst_type,tax_mode,timezone,is_active from stores where code='${d.code}'`);
    const audit = row.length ? sql(`select id,action,auditable_type,auditable_id,store_id,created_at from audit_logs where created_at > datetime('now','-3 minutes') order by id desc limit 8`) : [];
    await s.screenshot(`j1_01_after_${d.code}`);
    ev.steps.push({ code: d.code, clicked, calls, db: row, audit, ui_lists_store: ui.includes(d.name) });
    console.log(d.code, clicked, JSON.stringify(calls).slice(0, 400), JSON.stringify(row), 'audit', JSON.stringify(audit).slice(0, 300));
  }
  const st = state(); st.stores = {};
  for (const d of defs) { const r = sql(`select id from stores where code='${d.code}'`)[0]; if (r) st.stores[d.code] = Number(r.id); }
  saveState(st);
  ev.dup_network = s.dupNetwork(); ev.console = s.consoleErrs.slice(0, 20);
  console.log(evidence('J1_01_stores', ev));
  await s.close();
})();
