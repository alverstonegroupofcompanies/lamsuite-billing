/** Calibration: add single lines with the hardened kit and dump cart rows + footer + modal. */
const { storeByCode, fixture, login, shot, sleep, readMoney, invoiceNoShown, addLine, batchWithStock } = require('./gst_kit.cjs');
const KEY = process.env.QA_KEY_A || 'LAM-QAA-97814AFCF43A787D-F6323688';

async function cart(s) {
  return s.page.evaluate(() => [...document.querySelectorAll('tr')]
    .filter(tr => tr.querySelector('input[id^="qty-input-"]'))
    .map(tr => ({
      text: (tr.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 170),
      qty: [...tr.querySelectorAll('input[id^="qty-input-"]')].map(i => `${i.id.split('-').slice(-1)[0]}=${i.value}`),
    })));
}

(async () => {
  const store = storeByCode('QA-A');
  const r0 = await login({ storeCode: 'QA-A', key: KEY, username: 'qaa_owner', pin: '9101' });
  console.log('login', r0.ok, JSON.stringify(r0.trace));
  if (!r0.ok) { console.log(String(r0.detail).slice(0, 600)); process.exit(1); }
  const s = r0.s;
  await s.key('F1'); await sleep(2500);
  console.log('invoice:', await invoiceNoShown(s));

  const SPECS = [
    { frag: 'QA Antibiotic Syrup', packs: 2, loose: 0 },
    { frag: 'QA Exempt Nutritional', packs: 3, loose: 0 },
    { frag: 'QA Precision Item', packs: 7, loose: 0 },
    { frag: 'QA Oral Rehydration', packs: 1, loose: 12 },
    { frag: 'QA Half-Paisa', packs: 3, loose: 0 },
  ];
  for (const spec of SPECS) {
    const prod = fixture(store.id, spec.frag);
    const units = spec.packs * (Number(prod.units_per_pack) || 1) + spec.loose;
    const batch = batchWithStock(prod, units);
    console.log(`\nLINE ${prod.name} rate=${prod.sel_rate} gst=${prod.gst_percent} upp=${prod.units_per_pack} units=${units} batch=${batch} (${prod.batches.map(b => b.batch_no + ':' + b.stock_qty).join(' ')})`);
    const r = await addLine(s, { search: prod.name, batch, packs: spec.packs, loose: spec.loose });
    console.log('   addLine ->', JSON.stringify(r).slice(0, 200));
    console.log('   cart:', JSON.stringify(await cart(s)));
    console.log('   money:', JSON.stringify(await readMoney(s)));
    await shot(s, `calib_${prod.id}`);
  }
  await s.close();
})().catch(e => { console.error('CALIB CRASH', e); process.exit(1); });
