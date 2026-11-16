/** Explore the POS as a cashier: reach the billing screen and dump its controls. */
const { openCounter, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const user = store.users.cash;
  const { s, ok, stage, detail } = await openCounter(store, user, { counterName: 'QA A Main Counter' });
  console.log(`reached POS: ${ok} (stage ${stage})`, JSON.stringify(detail).slice(0, 300));
  await sleep(3000);
  console.log('\n===== SCREEN TEXT =====\n' + (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 3000));
  console.log('\n===== CONTROLS =====\n' + JSON.stringify(await s.controls(), null, 1).slice(0, 3000));
  await s.screenshot('EXPLORE_pos');
  console.log('\n===== URL =====', s.page.url());
  console.log('\n===== API SEEN =====');
  for (const n of s.net.filter(x => x.url.includes('/api/'))) console.log(`${n.status || '??'} ${n.method} ${n.url.replace('http://127.0.0.1:8000', '')}`);
  console.log('\n===== BLOCKED EXTERNAL =====');
  console.log(JSON.stringify(s.blockedExternal.slice(0, 6), null, 1));
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
