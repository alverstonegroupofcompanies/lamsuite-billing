// J1.02 create two counters per QA store in the admin panel and issue activation codes
const { adminSession } = require('./ui_admin_login.cjs');
const { sql, evidence, state, saveState } = require('./lib.cjs');
const plan = [
  { store: 'QA-PH', name: 'PH Front Till', loc: 'Front desk' },
  { store: 'QA-PH', name: 'PH Back Till', loc: 'Back desk' },
  { store: 'QA-CS', name: 'CS Front Till', loc: 'Entrance' },
  { store: 'QA-CS', name: 'CS Back Till', loc: 'Makeup bar' },
];
(async () => {
  const s = await adminSession('j1_02');
  const st = state(); st.counters = st.counters || {};
  const ev = { create: [], codes: [] };
  for (const p of plan) {
    const sid = st.stores[p.store];
    if (sql(`select id from counters where store_id=${sid} and counter_name='${p.name}'`).length) continue;
    await s.nav('/counters');
    await s.clickText('New counter'); await new Promise((r) => setTimeout(r, 800));
    const f = await s.labelled();
    const sel = f.find((x) => x.tag === 'SELECT' && (x.options || []).some((o) => o.includes('QA-PH')));
    const els = await s.page.$$('input,select,textarea');
    await els[sel.i].select(String(sid));
    const txt = f.filter((x) => x.tag === 'INPUT' && x.type === 'text');
    await els[txt[0].i].type(p.name, { delay: 8 });       // counter name
    await els[txt[2].i].type(p.loc, { delay: 8 });        // location
    const n0 = s.net.length;
    await s.clickExact('Create counter'); await new Promise((r) => setTimeout(r, 2500));
    const calls = s.net.slice(n0).filter((n) => n.method === 'POST').map((n) => ({ u: n.url, st: n.status, req: n.post_data, res: (n.response_body || '').slice(0, 800) }));
    const ui = await s.text();
    const code = (ui.match(/\b[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,}\b/) || [])[0] || null;
    await s.screenshot(`j1_02_created_${p.name.replace(/\s/g, '_')}`);
    ev.create.push({ p, calls, ui_code_seen: code, ui_tail: ui.slice(-700) });
    console.log(p.name, JSON.stringify(calls).slice(0, 500), 'code on screen:', code);
  }
  ev.db = sql(`select id,store_id,counter_code,counter_name,location_name,status,device_uuid from counters where store_id in (${st.stores['QA-PH']},${st.stores['QA-CS']})`);
  ev.codes_db = sql(`select * from activation_keys order by id desc limit 8`);
  console.log(JSON.stringify(ev.db)); console.log(JSON.stringify(ev.codes_db).slice(0, 1200));
  evidence('J1_02_counters', ev);
  await s.close();
})();
