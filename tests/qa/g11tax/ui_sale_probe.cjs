// Probe the POS entry row: field order after picking a product, live totals before Enter (no checkout)
const { claim } = require('./pos.cjs');
const { sleep, evidence } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
const totals = async (s) => (await s.text()).split('\n').filter((l) => /SUBTOTAL|GST TAX|NET PAYABLE|Round-off|ITEMS:|^₹/.test(l)).slice(0, 10).join(' | ');
(async () => {
  const s = await claim('sale_probe', 2, 4);
  const log = [];
  await s.page.keyboard.press('F1'); await sleep(1200);
  log.push(['after first F1', await active(s)]);
  await s.page.keyboard.press('F1'); await sleep(600);
  log.push(['start', await active(s)]);
  await s.page.keyboard.type('QA Paracet', { delay: 40 }); await sleep(1500);
  log.push(['suggestions', (await s.text()).split('\n').filter((l) => /QA Paracet|PA-OLD|PA-NEW|Stock|on hand/i.test(l)).slice(0, 10)]);
  log.push(['totals with product highlighted, before Enter', await totals(s)]);
  await s.page.keyboard.press('Enter'); await sleep(900);
  log.push(['after Enter', await active(s), await totals(s)]);
  for (let i = 0; i < 6; i++) { await s.page.keyboard.press('Tab'); await sleep(250); log.push([`tab ${i}`, await active(s)]); }
  log.push(['row', (await s.page.evaluate(() => [...document.querySelectorAll('tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /QA Paracet/.test(t))))]);
  await s.screenshot('sale_probe');
  for (const l of log) console.log(JSON.stringify(l).slice(0, 900));
  evidence('sale_probe', log);
  await s.close();
})();
