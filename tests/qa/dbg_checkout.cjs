/** Build one real bill in QA-A and dump the checkout dialog so payment scenarios can target it. */
const { openCounter } = require('./pos_flow.cjs');
const { newBill, addProduct, lineIds, setQty, readTotals, readLines, openCheckout, sleep } = require('./pos_ui.cjs');
const manifest = require('./manifest.json');

(async () => {
  const store = manifest.stores['QA-A'];
  const { s, ok, detail } = await openCounter(store, store.users.cash, { counterName: 'QA A Counter 1' });
  if (!ok) { console.error('sign-in failed', JSON.stringify(detail).slice(0, 300)); await s.close(); process.exit(1); }
  await sleep(1500);
  const invNo = await newBill(s);
  console.log('invoice no on screen:', invNo);

  const added = await addProduct(s, 'QA Dolo 650');
  const ids = added.ids;
  console.log('add:', JSON.stringify(added));
  if (ids.length) console.log('qty set:', JSON.stringify(await setQty(s, ids[0], { packs: 2, loose: 3 })));
  console.log('totals after qty:', JSON.stringify(await readTotals(s)));
  console.log('lines:', JSON.stringify(await readLines(s), null, 0).slice(0, 1200));

  const co = await openCheckout(s);
  console.log('\n===== CHECKOUT DIALOG TEXT =====\n' + co.text);
  console.log('\n===== INPUTS =====\n' + JSON.stringify(co.inputs, null, 0));
  console.log('\n===== BUTTONS =====\n' + JSON.stringify(co.buttons));
  await s.screenshot('PROBE_checkout');
  await s.close();
})().catch(e => { console.error(e); process.exit(1); });
