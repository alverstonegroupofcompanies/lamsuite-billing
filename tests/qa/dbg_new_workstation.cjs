/** Why does a brand-new workstation profile stop at "Workstation Device Registration"?
 *  Walks the real activation form and prints every screen transition, API call and console error. */
const { newSession, saveEvidence, POS_URL, BACKEND, sql } = require('./driver.cjs');
const { onboard } = require('./pos_flow.cjs');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const manifest = require('./manifest.json');

(async () => {
  const code = 'QA-A';
  const store = manifest.stores[code];
  const name = `qa_probe_${Date.now().toString().slice(-6)}`;
  const out = { session: name, frames: [], net: [], console: [], pageErrors: [], blocked: [] };

  const s = await newSession(name, { url: POS_URL, stable: true });
  await sleep(3000);
  out.before = (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 500);

  const keySel = 'input[placeholder^="LAM-STORE"]';
  try {
    await s.page.waitForSelector(keySel, { visible: true, timeout: 12000 });
    await s.page.click(keySel);
    await s.page.keyboard.type(store.activation_key, { delay: 25 });
    await s.page.click('input[placeholder="Counter 01"]');
    await s.page.keyboard.type(`QA Probe Counter ${name.slice(-4)}`, { delay: 25 });
    await sleep(500);
    out.submit = await s.page.evaluate(() => {
      const b = document.querySelector('button[type=submit]');
      return { text: b && b.innerText.trim(), disabled: b && b.disabled };
    });
    await s.page.click('button[type=submit]');
  } catch (e) {
    out.stage_error = `activation form not reachable: ${e.message}`;
  }

  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const t = (await s.text()).replace(/\n{3,}/g, '\n');
    out.frames.push({ at: `${(i + 1) * 3}s`, head: t.slice(0, 260) });
    console.log(`\n----- +${(i + 1) * 3}s -----\n${t.slice(0, 300)}`);
    if (/SELECT OPERATOR|QUICK PIN/i.test(t)) { await s.screenshot('reached_operator'); break; }
  }
  await s.screenshot('final');

  out.net = s.net
    .filter(n => !/heartbeat|license\/check|public-ip|branches/.test(n.url))
    .map(n => ({ m: n.method, u: n.url.replace(BACKEND, ''), s: n.status, req: (n.post_data || '').slice(0, 220), resp: (n.response_body || '').slice(0, 300) }));
  out.console = s.consoleErrs.slice(-20);
  out.pageErrors = s.pageErrs.slice(-10);
  out.blocked = s.blockedExternal.slice(0, 20);
  out.device_cols = sql('pragma table_info(devices)').map(c => c.name);
  out.devices = sql(`select id, store_id, device_name, device_uuid, status, counter_id, registered_via, created_at from devices where store_id=${store.id} order by id desc limit 6`);
  out.appStorage = await s.page.evaluate(() => Object.keys(localStorage)
    .filter(k => /device|activ|store|session|auth|licen/i.test(k))
    .map(k => ({ k, v: (localStorage.getItem(k) || '').slice(0, 160) })));

  console.log('\nNET:', JSON.stringify(out.net, null, 1).slice(0, 3000));
  console.log('\nCONSOLE:', JSON.stringify(out.console, null, 1).slice(0, 1500));
  console.log('\nPAGE ERRORS:', JSON.stringify(out.pageErrors, null, 1).slice(0, 1200));
  console.log('\nBLOCKED EXTERNAL:', JSON.stringify(out.blocked, null, 1).slice(0, 800));
  console.log('\nLOCALSTORAGE:', JSON.stringify(out.appStorage, null, 1).slice(0, 2000));
  console.log('\nDEVICES:', JSON.stringify(out.devices, null, 1).slice(0, 1200));
  saveEvidence('A7_new_workstation_probe.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
