/** Add one product line through the POS UI and dump the resulting row controls. */
const { openCounter, sleep } = require('./pos_flow.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const { s, ok, detail } = await openCounter(store, store.users.cash, { counterName: 'QA A Main Counter 1' });
  if (!ok) { console.error('sign-in failed', JSON.stringify(detail).slice(0, 300)); await s.close(); process.exit(1); }
  await sleep(2000);
  await s.key('F1');
  await sleep(2500);

  const SEARCH = 'input[aria-label="Scan barcode or type product name"]';
  const prod = manifest.stores['QA-A'].products['QA-DOLO650'];
  await s.page.click(SEARCH);
  await s.page.keyboard.type(prod.sku, { delay: 40 });
  await sleep(2500);
  await s.screenshot('PROBE_search_results');
  console.log('===== AFTER TYPING SKU (text) =====\n' + (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 2200));
  await s.key('Enter');
  await sleep(2500);
  const inputs = await s.page.evaluate(() => [...document.querySelectorAll('input')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ id: el.id, ph: el.placeholder, value: el.value, aria: el.getAttribute('aria-label') })));
  console.log('===== INPUTS AFTER ENTER =====\n' + JSON.stringify(inputs, null, 0));
  console.log('===== TEXT AFTER ENTER =====\n' + (await s.text()).replace(/\n{3,}/g, '\n').slice(0, 2500));
  await s.screenshot('PROBE_line_added');
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
