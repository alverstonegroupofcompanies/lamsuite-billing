/** Why can't the return/bills screens find a bill the API returns? Capture the search requests. */
const { newSession, saveEvidence, POS_URL } = require('./driver.cjs');
const { onboard, signInWithPin, navTo, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const out = { steps: [], requests: [] };
  const s = await newSession('qaA_search', { url: POS_URL, stable: true });
  await onboard(s, store.activation_key, 'QA Counter Search');
  const si = await signInWithPin(s, store.users.cash.pin, store.users.cash.username);
  if (!si.ok) { console.log('signin failed'); await s.close(); return; }

  await navTo(s, '/returns/sales'); await sleep(3500);
  const txt = await s.text();
  out.landed = /Sales Returns/i.test(txt);
  // open New Return if a button exists
  const opened = await s.page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).find(e => /New Return/i.test(e.innerText || ''));
    if (b) { b.click(); return true; } return false;
  });
  await sleep(1800);
  out.new_return_opened = opened;
  const inputs = await s.page.evaluate(() => [...document.querySelectorAll('input')].filter(e => e.offsetParent !== null).map(e => ({ ph: e.placeholder || null, type: e.type, value: (e.value || '').slice(0, 20) })));
  out.inputs = inputs;

  const searchSel = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input')].find(e => e.offsetParent !== null && /INV-001|Ravi Kumar/i.test(e.placeholder || ''));
    if (!el) return null; el.id = 'qa-search'; return '#qa-search';
  });
  out.search_input = searchSel;
  if (searchSel) {
    await s.page.click(searchSel);
    await s.page.keyboard.type('QAA-1035', { delay: 45 });
    await sleep(3000);
    out.requests = s.net.filter(n => /invoices/.test(n.url)).map(n => ({ m: n.method, u: n.url.replace('http://127.0.0.1:8000', ''), status: n.status, body: (n.response_body || '').slice(0, 240) }));
    out.results = await s.page.evaluate(() => [...document.querySelectorAll('[role="option"], li, tr')].filter(e => e.offsetParent !== null).map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 80)).filter(t => t).slice(0, 8));
    out.screen = (await s.text()).replace(/\n{3,}/g, '\n').slice(-700);
  }
  await s.screenshot('return_search');
  out.console = s.consoleErrs.slice(-8);
  out.pageErrors = s.pageErrs.slice(-5);
  console.log(JSON.stringify(out, null, 1).slice(0, 5000));
  saveEvidence('C_search_probe.json', out);
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
