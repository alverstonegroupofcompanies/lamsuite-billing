/** Debug: walk the activation form exactly like a user and watch state transitions. */
const { newSession, saveEvidence, POS_URL, BACKEND } = require('./driver.cjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const stamp = Date.now().toString().slice(-6);
  const code = `QA-DB${stamp}`;
  const admin = await fetch(`${BACKEND}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: 'admin@lamstone.in', password: 'password123' }) }).then(r => r.json());
  const store = await fetch(`${BACKEND}/api/admin/stores`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${admin.token}` }, body: JSON.stringify({ name: `QA Debug Store ${stamp}`, code, state_code: '32', tax_mode: 'exclusive', gst_type: 'regular', store_type: 'pharmacy', invoice_prefix: 'DBG', license_plan: 'Enterprise Multi-Store' }) }).then(r => r.json());
  console.log('virgin store', store.id, code, store.activation_key);

  const s = await newSession('DBG', { url: POS_URL });
  await sleep(3000);

  // Click the key field with the mouse, then type like a person.
  const keySel = 'input[placeholder^="LAM-STORE"]';
  await s.page.waitForSelector(keySel, { visible: true, timeout: 15000 });
  await s.page.click(keySel);
  await s.page.keyboard.type(store.activation_key, { delay: 25 });
  await s.page.click('input[placeholder="Counter 01"]');
  await s.page.keyboard.type('QA Debug Counter', { delay: 25 });
  await sleep(400);

  const state1 = await s.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const btn = [...document.querySelectorAll('button[type=submit]')][0];
    return { key_value: el?.value, btn_text: btn?.innerText?.trim(), btn_disabled: btn?.disabled, all_buttons: [...document.querySelectorAll('button')].map(b => ({ t: b.innerText.trim().slice(0, 40), d: b.disabled })) };
  }, keySel);
  console.log('FORM STATE:', JSON.stringify(state1, null, 1));
  await s.screenshot('DBG_filled');

  await s.page.click('button[type=submit]');
  for (const wait of [800, 1500, 2500, 4000, 6000]) {
    await sleep(wait);
    const t = (await s.text()).replace(/\n{3,}/g, '\n');
    console.log(`\n----- after +${wait}ms -----\n` + t.slice(0, 700));
    await s.screenshot(`DBG_wait_${wait}`);
  }
  console.log('\nNETWORK:', JSON.stringify(s.net.map(n => ({ m: n.method, u: n.url.replace('http://127.0.0.1:8000', ''), s: n.status, req: (n.post_data || '').slice(0, 200), resp: (n.response_body || '').slice(0, 250) })).filter(n => !n.u.includes('heartbeat') && !n.u.includes('license/check') && !n.u.includes('branches') && !n.u.includes('public-ip')), null, 1));
  console.log('\nCONSOLE:', JSON.stringify(s.consoleErrs.slice(-15), null, 1));
  console.log('\nPAGE ERRORS:', JSON.stringify(s.pageErrs.slice(-10), null, 1));
  saveEvidence('dbg_onboard.json', { state1, net: s.net, console: s.consoleErrs, pageErrors: s.pageErrs });
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
