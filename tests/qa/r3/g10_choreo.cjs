// What does the tender panel do to a cash line that is smaller than the bill?
const { claim } = require('./pos.cjs');
const { sleep } = require('./lib.cjs');

const read = async (s) => {
  const t = (await s.text()).split('\n').map((l) => l.trim()).filter(Boolean);
  return {
    summary: t.filter((l) => /TOTAL DUE|PAID SO FAR|CHANGE DUE|BALANCE REMAINING|NON-CASH/i.test(l))
      .map((l, i, a) => `${l}=${a[i + 1] || ''}`).slice(0, 8),
    tenderInputs: await s.page.evaluate(() => [...document.querySelectorAll('input[placeholder="0.00"]')].map((i) => i.value)),
    tail: t.slice(-8).join(' | '),
  };
};

(async () => {
  const s = await claim('g10_tender_read', 3, 4);
  await s.clickText('POS Billing'); await sleep(3000);
  await s.page.keyboard.press('F1'); await sleep(1200);
  await s.page.keyboard.type('QA Cough Syrup', { delay: 30 }); await sleep(1800);
  await s.page.keyboard.press('Enter'); await sleep(1400);
  await s.page.keyboard.press('Enter'); await sleep(1400);
  await s.page.keyboard.press('Enter'); await sleep(1400);
  await s.page.keyboard.press('F12'); await sleep(1800);
  console.log('opened ->', JSON.stringify(await read(s)));
  const ok = await s.page.evaluate(() => {
    const el = [...document.querySelectorAll('input[placeholder="0.00"]')].filter((i) => i.type === 'number')[0];
    if (!el) return 'no input';
    el.focus();
    try { el.select(); } catch (e) { return 'select threw ' + e.message; }
    return 'selected=' + el.value;
  });
  console.log('select ->', ok);
  await s.page.keyboard.type('10.00', { delay: 40 }); await sleep(1000);
  console.log('typed 10 ->', JSON.stringify(await read(s)));
  await s.close();
})().catch((e) => { console.error('error:', e.message); process.exit(1); });
