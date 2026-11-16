/**
 * Environment prep: mint a fresh activation key per QA store (the old ones are exhausted
 * because every throwaway browser profile registers a device) and give each new key enough
 * device slots for the scenario matrix. max_devices enforcement itself is already verified
 * as a scenario, so raising it here only affects our own fixture stores.
 */
const { BACKEND } = require('./driver.cjs');
const fs = require('fs');
const path = require('path');
const manifest = require('./manifest.json');

(async () => {
  const login = await fetch(`${BACKEND}/api/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: 'admin@lamstone.in', password: 'password123' }),
  }).then(r => r.json());
  const H = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${login.token}` };

  for (const [code, store] of Object.entries(manifest.stores)) {
    const res = await fetch(`${BACKEND}/api/admin/stores/${store.id}/regenerate-key`, { method: 'POST', headers: H });
    const body = await res.json();
    if (res.status !== 200) { console.error(code, res.status, JSON.stringify(body)); continue; }
    store.activation_key = body.activation_key;
    store.key_prefix = body.key_prefix;
    console.log(`${code} (store ${store.id}) -> ${body.key_prefix}`);
  }

  fs.writeFileSync(path.join(__dirname, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('manifest updated');
})();
