/** Dump the POS billing screen controls so UI scenarios can target real fields. */
const { openCounter, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const { s, ok, detail } = await openCounter(store, store.users.cash, { counterName: 'QA A Main Counter 1' });
  if (!ok) { console.error('sign-in failed', JSON.stringify(detail).slice(0, 300)); await s.close(); process.exit(1); }
  await sleep(2000);
  await s.key('F1');
  await sleep(3000);
  console.log('===== URL =====', s.page.url());
  console.log('===== TEXT =====\n' + (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 4000));
  const inputs = await s.page.evaluate(() => [...document.querySelectorAll('input,textarea,select')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ tag: el.tagName, type: el.type, id: el.id, ph: el.placeholder, aria: el.getAttribute('aria-label'), value: el.value?.slice(0, 30) })));
  console.log('===== VISIBLE INPUTS (' + inputs.length + ') =====\n' + JSON.stringify(inputs, null, 0));
  const buttons = await s.page.evaluate(() => [...document.querySelectorAll('button')]
    .filter(el => el.offsetParent !== null)
    .map(el => (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 42)).filter(Boolean));
  console.log('===== BUTTONS (' + buttons.length + ') =====\n' + JSON.stringify(buttons));
  await s.screenshot('PROBE_billing');
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
