/** Throwaway: which <select> on the POS tender panel is the payment line's mode? */
const { claim } = require('./pos.cjs');
const { sleep } = require('./lib.cjs');

async function addItem(s, name) {
  await s.page.keyboard.press('F1'); await sleep(1200);
  await s.page.keyboard.type(name, { delay: 30 }); await sleep(1800);
  await s.page.keyboard.press('Enter'); await sleep(1400);
  await s.page.keyboard.press('Enter'); await sleep(1400);
}

(async () => {
  const s = await claim('g10_sel', 1, 2);
  const ok = await s.clickText('POS Billing'); await sleep(2500);
  await addItem(s, 'Kochi Exclusive Wellness Tonic');
  await s.page.keyboard.press('F12'); await sleep(1600);

  const dump = await s.page.evaluate(() => {
    const lines = [...document.querySelectorAll('select')].map((el) => {
      const box = el.closest('div');
      let label = '';
      let n = el;
      for (let i = 0; i < 4 && n; i++) {
        n = n.parentElement;
        if (n && n.innerText) { label = n.innerText.split('\n').slice(0, 3).join(' | '); break; }
      }
      return {
        value: el.value,
        options: [...el.options].map((o) => o.value).slice(0, 14),
        near: label.slice(0, 90),
        rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width)]; })(),
        inModal: !!el.closest('[class*="fixed"]'),
      };
    });
    const tenderHeader = [...document.querySelectorAll('span, div')]
      .filter((e) => /Payment Tender Lines/.test(e.innerText || '')).length;
    return { lines, tenderHeader };
  });
  console.log(JSON.stringify(dump, null, 1));
  await s.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
