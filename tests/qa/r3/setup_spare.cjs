const { api, adminToken, state, saveState, sql } = require('./lib.cjs');
(async () => {
  const t = await adminToken(); const st = state();
  let c = sql("select id from counters where store_id=5 and counter_name='CS Spare Till'")[0];
  if (!c) { const r = await api('POST','/admin/counters',{ store_id:5, counter_name:'CS Spare Till', location_name:'Store room' },{ token:t, store:5 }); console.log('create', r.status, r.text.slice(0,200)); c = sql("select id from counters where store_id=5 and counter_name='CS Spare Till'")[0]; }
  const k = await api('POST',`/admin/counters/${c.id}/activation-code`,{ ttl_hours:1, label:'expiry probe' },{ token:t, store:5 });
  console.log('code', k.status, k.json && k.json.expires_at);
  st.expiryProbe = { counter_id: Number(c.id), code: k.json && k.json.code, issued_at: new Date().toISOString(), expires_at: k.json && k.json.expires_at };
  st.revokedCode = 'LAM-C02-72E32CEB6F0C6473-DB464205BAB4204C';
  saveState(st);
})();
