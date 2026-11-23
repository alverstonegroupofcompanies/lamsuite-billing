/** Throwaway: when does the tender line stop being UPI? */
const { claim } = require('./pos.cjs');
const { sleep } = require('./lib.cjs');

async function addItem(s, name) {
  await s.page.keyboard.press('F1'); await sleep(1200);
  await s.page.keyboard.type(name, { delay: 30 }); await sleep(1800);
  await s.page.keyboard.press('Enter'); await sleep(1400);
  await s.page.keyboard.press('Enter'); await sleep(1400);
}

const state = (s, tag) => s.page.evaluate((t) => {
  const sel = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
  const line = sel && sel.closest('div[class*="rounded-lg"]');
  const ref = line && line.querySelector('input[type="text"]');
  const amt = line && line.querySelector('input[type="number"]');
  const notes = [...document.querySelectorAll('div,p,span')]
    .map((e) => (e.innerText || '').trim())
    .filter((x) => x && x.length < 140 && /reference|UTR|required|settled|denied|blocked/i.test(x));
  return { tag: t, mode: sel ? sel.value : null, has_ref: !!ref, ref_ph: ref ? ref.placeholder : null,
    amount: amt ? amt.value : null, activeEl: document.activeElement ? document.activeElement.tagName + '/' + (document.activeElement.placeholder || '') : null,
    notes: [...new Set(notes)].slice(0, 4) };
}, tag).then((r) => { console.log(JSON.stringify(r)); return r; });

async function pick(s, mode) {
  await s.page.evaluate((m) => {
    const el = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'Gift Voucher'));
    const opt = [...el.options].find((o) => o.value === m);
    opt.selected = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, mode);
  await sleep(900);
}

(async () => {
  const s = await claim('g10_seq', 1, 2);
  await s.clickText('POS Billing'); await sleep(2500);
  await addItem(s, 'Kochi Exclusive Wellness Tonic');
  await s.page.keyboard.press('F12'); await sleep(1600);
  await state(s, 'after F12');
  await pick(s, 'UPI');
  await state(s, 'after pick UPI');

  // type the amount the way the UI script does
  const found = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input[placeholder="0.00"]')].filter((i) => i.type === 'number')[0];
    if (!el) return null; el.focus(); el.select(); return el.value;
  });
  console.log('focused amount box was ' + JSON.stringify(found));
  await s.page.keyboard.press('Backspace');
  await s.page.keyboard.type('450.00', { delay: 25 });
  await sleep(600);
  await state(s, 'after typing amount');

  await pick(s, 'UPI');
  await state(s, 'after re-pick UPI');

  const n0 = s.net.length;
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control');
  await sleep(6000);
  await state(s, 'after save attempt');
  console.log(JSON.stringify(s.net.slice(n0).filter((x) => /invoices/.test(x.url) && x.method === 'POST')
    .map((x) => ({ st: x.status, body: (x.post_data || '').slice(0, 400) })), null, 1));
  await s.screenshot('g10_seq_state');
  await s.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
