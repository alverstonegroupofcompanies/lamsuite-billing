// Probe the sales-return flow (selector discovery, no save unless SAVE=1)
const { claim } = require('./pos.cjs');
const { sleep, evidence, sql } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
(async () => {
  const s = await claim('return_probe', 2, 4);
  const log = [];
  await s.page.keyboard.press('F7'); await sleep(1500);
  await s.page.keyboard.press('F7'); await sleep(1500);
  log.push(['after F7 F7', await active(s), (await s.text()).split('\n').filter(Boolean).slice(24, 70)]);
  if (!/invoice/i.test(await active(s))) { await s.clickText('New Return'); await sleep(1500); log.push(['clicked New Return', await active(s)]); }
  log.push(['controls', (await s.controls()).filter((c) => c.tag !== 'BUTTON' || /return|search|find|load/i.test(c.text)).map((c) => `${c.tag}:${c.type}:${c.ph || c.text}`).slice(0, 40)]);
  await s.page.keyboard.type('C01-INV-8301', { delay: 25 }); await s.page.keyboard.press('Enter'); await sleep(2000);
  log.push(['after search', await active(s), (await s.text()).split('\n').filter((l) => /QA Paracet|PA-OLD|returnable|sold|qty|strip|tabl|refund|credit|restock|damage/i.test(l)).slice(0, 30)]);
  log.push(['controls2', (await s.controls()).filter((c) => !c.disabled).map((c) => `${c.tag}:${c.type}:${c.ph || c.aria || c.text}`).slice(0, 60)]);
  await s.screenshot('return_probe');
  for (const l of log) console.log(JSON.stringify(l).slice(0, 2500));
  evidence('return_probe', log);
  await s.close();
})();
