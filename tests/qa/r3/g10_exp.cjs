// G10 probe: why does the till expense route answer what it answers? Isolated stack only.
const { api, sql, adminToken } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');
(async () => {
  await adminToken();
  const code = await issueCode(3, 4);
  const c = await api('POST', '/counters/claim', { code, device_uuid: 'qa-g10-exp-' + Date.now(), device_name: 'QA G10 exp' });
  const tok = c.json.device_token;
  const r = await api('POST', '/expenses', { expense_head: 'Tea & snacks', amount: 50, payment_mode: 'Cash' }, { device: tok, token: tok, store: 4 });
  console.log('claim', c.status, 'expense', r.status);
  console.log(r.text.slice(0, 600));
  console.log('counter row', JSON.stringify(sql('select id,role_profile,visible_menus from counters where id=3')));
  console.log('devices', JSON.stringify(sql('select device_uuid,status from devices where counter_id=3 order by id desc limit 3')));
  // what does the till see about its own profile?
  const me = await api('GET', '/counter/profile', undefined, { device: tok, token: tok, store: 4 });
  console.log('profile', me.status, me.text.slice(0, 700));
})().catch((e) => { console.error('e', e.message); process.exit(1); });
