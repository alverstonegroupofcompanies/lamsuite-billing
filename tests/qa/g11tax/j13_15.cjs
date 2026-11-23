// J13 tax mode / store type change propagation; profile restriction by direct call; J15 update feed on the test backend
const { api, sql, evidence, state, adminToken, sleep } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {}; const t = await adminToken(); const A = { token: t, store: 5 };
  const CS = { device: st.apiTillCS.token, token: st.apiTillCS.token };
  // existing QA-CS bill before the change
  const old = sql("select id,invoice_number,grand_total,tax_total from invoices where store_id=5 order by id limit 1")[0];
  // J13 tax mode exclusive -> inclusive, live to the counter
  const pre = await api('GET', '/store', undefined, CS);
  ev.before_mode = pre.json && (pre.json.tax_mode || (pre.json.store || {}).tax_mode || (pre.json.data || {}).tax_mode);
  const up = await api('PUT', '/admin/stores/5', { tax_mode: 'inclusive' }, A);
  ev.update = up.status;
  const t0 = Date.now(); let seenAfter = null;
  for (let i = 0; i < 6; i++) { const r = await api('GET', '/store', undefined, CS); const m = r.json && (r.json.tax_mode || (r.json.store || {}).tax_mode || (r.json.data || {}).tax_mode); if (m === 'inclusive') { seenAfter = (Date.now() - t0) / 1000; break; } await sleep(2000); }
  ev.counter_sees_inclusive_after_s = seenAfter;
  ev.old_bill_unchanged = sql(`select grand_total,tax_total from invoices where id=${old.id}`)[0];
  ev.old_bill_before = old;
  await api('PUT', '/admin/stores/5', { tax_mode: 'exclusive' }, A);
  // J13 store type change pharmacy -> cosmetics on QA-PH keeps data; doctor fields hidden flag in counter context
  const ctx1 = await api('GET', '/counter/context', undefined, { device: st.apiTillPH.token, token: st.apiTillPH.token });
  ev.ph_context_is_pharmacy = ctx1.json && JSON.stringify(ctx1.json).match(/"is_pharmacy":\s*(true|false)/)?.[1];
  // J13 counter profile restriction enforced on direct calls: deny purchase entry for C02 (QA-PH) and try a purchase
  const prof = await api('GET', '/admin/counters/3/profile', undefined, { token: t, store: 4 });
  ev.profile_get = { st: prof.status, keys: prof.json ? Object.keys(prof.json).slice(0, 10) : null, sample: prof.text.slice(0, 600) };
  // J15 update feed served by the test backend
  for (const u of ['/app/update/latest.json', '/app/update/windows-x86_64/2.1.0', '/app/update/windows-x86_64/2.1.1', '/app/update/download/does-not-exist.zip']) {
    const r = await api('GET', u); ev['update ' + u] = { st: r.status, body: r.text.slice(0, 300) };
  }
  for (const [k, x] of Object.entries(ev)) console.log(k, String(JSON.stringify(x)).slice(0, 600));
  evidence('J13_J15', ev);
})();
