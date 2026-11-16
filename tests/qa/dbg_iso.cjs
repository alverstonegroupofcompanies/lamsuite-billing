/** Ad-hoc probe: can one store's POS token read or write another store's data? */
const { BACKEND, sql } = require('./driver.cjs');
const m = require('./manifest.json');
const J = { 'Content-Type': 'application/json', Accept: 'application/json' };

(async () => {
  const A = m.stores['QA-A'], B = m.stores['QA-B'];
  const r = await fetch(BACKEND + '/api/staff/login', {
    method: 'POST', headers: J,
    body: JSON.stringify({ store_id: A.id, user_id: A.users.cash.id, username: A.users.cash.username, pin: A.users.cash.pin }),
  });
  const jb = await r.json();
  const tok = jb.token || (jb.data && jb.data.token);
  console.log('login', r.status, '| token:', !!tok, '| role:', (jb.user && jb.user.role) || (jb.data && jb.data.user && jb.data.user.role));

  for (const u of [`/api/settings?store_id=${B.id}`, `/api/counters?store_id=${B.id}`, `/api/invoices?store_id=${B.id}`,
                   `/api/products?store_id=${B.id}`, `/api/parties?store_id=${B.id}`]) {
    const x = await fetch(BACKEND + u, { headers: { ...J, Authorization: `Bearer ${tok}`, 'X-Store-Id': String(B.id) } });
    const t = await x.text();
    console.log(`\n${x.status} GET ${u}\n   ${t.slice(0, 300).replace(/\s+/g, ' ')}`);
  }

  const w = await fetch(BACKEND + '/api/settings', {
    method: 'POST', headers: { ...J, Authorization: `Bearer ${tok}`, 'X-Store-Id': String(B.id) },
    body: JSON.stringify({ store_id: B.id, key: 'qa_tamper_probe', value: { written_by: 'store-A cashier token' } }),
  });
  console.log('\nWRITE store-B settings using store-A cashier token:', w.status, (await w.text()).slice(0, 200));
  console.log('company_settings rows now:', JSON.stringify(sql(`select store_id, key, value from company_settings where key='qa_tamper_probe' or (key='billing' and store_id in (${A.id},${B.id}))`)));
})();
