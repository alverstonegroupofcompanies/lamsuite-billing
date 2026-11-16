/** After a reload, is the device token still in storage — and what does the app look at? */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

const dump = async (s) => s.page.evaluate(() => {
  const pick = (re) => Object.keys(localStorage).filter(k => re.test(k))
    .map(k => ({ k, v: (localStorage.getItem(k) || '').slice(0, 120) }));
  return {
    vault: pick(/^lamsuite_vault_/),
    active_store: localStorage.getItem('lamsuite_active_store_id'),
    registry: pick(/registry|store_list|lamsuite_store/i),
    staff: pick(/staff|session/i),
    all_keys: Object.keys(localStorage).slice(0, 60),
  };
});

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { frames: [] };
  const s = await newSession('qaA_money', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA A Money Counter 1');
  await signInWithPin(s, store.users.cash.pin, store.users.cash.username);
  await sleep(3000);
  out.frames.push({ when: 'signed in, before reload', url: s.page.url(), storage: await dump(s) });

  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(7000);
  out.frames.push({ when: 'after reload', url: s.page.url(), screen: (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 220), storage: await dump(s) });

  for (const x of out.frames) {
    console.log(`\n### ${x.when}  (${x.url})`);
    if (x.screen) console.log('screen: ' + x.screen.replace(/\n/g, ' | ').slice(0, 200));
    console.log('active_store_id:', x.storage.active_store);
    console.log('vault keys:', JSON.stringify(x.storage.vault.map(v => v.k + '=' + v.v.slice(0, 40))));
    console.log('registry keys:', JSON.stringify(x.storage.registry.map(v => v.k)));
    console.log('staff/session keys:', JSON.stringify(x.storage.staff.map(v => v.k + '=' + v.v.slice(0, 60))));
  }
  saveEvidence('N1b_storage_after_reload.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
