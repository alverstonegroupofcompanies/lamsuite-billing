// Probe the keyboard field sequence of a purchase line (no posting); F1 data-loss check
const { claim } = require('./pos.cjs');
const { sleep, evidence } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
async function tabTo(s, re, max = 40) { for (let i = 0; i < max; i++) { const a = await active(s); if (re.test(a)) return a; await s.page.keyboard.press('Tab'); await sleep(80); } return null; }
(async () => {
  const s = await claim('purchase_probe2', 2, 4);
  const log = [];
  await s.page.keyboard.press('F2'); await sleep(1500);
  await s.clickText('New Inward Bill'); await sleep(1500);
  await combo(s, ['Alt'], 'KeyS'); await s.page.keyboard.type('QA Pharma', { delay: 30 }); await sleep(1000); await s.page.keyboard.press('Enter'); await sleep(600);
  await combo(s, ['Alt'], 'KeyB'); await s.page.keyboard.type('QA-PROBE-F1', { delay: 20 });
  // proper keyboard path: supplier, bill no, then Tab to product row
  await combo(s, ['Alt'], 'KeyS'); await s.page.keyboard.type('QA Pharma', { delay: 30 }); await sleep(1000); await s.page.keyboard.press('Enter'); await sleep(600);
  await combo(s, ['Alt'], 'KeyB'); await s.page.keyboard.type('QA-PROBE-2', { delay: 20 });
  log.push(['tab to product row', await tabTo(s, /type product name \[F1\]/)]);
  await s.page.keyboard.type('QA Paracet', { delay: 40 }); await sleep(1500);
  log.push(['suggestions', (await s.text()).split('\n').filter((l) => /QA Paracet/.test(l)).slice(0, 5)]);
  await s.page.keyboard.press('Enter'); await sleep(1000);
  for (let i = 0; i < 18; i++) {
    log.push([`field ${i}`, await active(s)]);
    await s.page.keyboard.press('Enter'); await sleep(300);
  }
  log.push(['grid text', (await s.text()).split('\n').filter((l) => /QA Paracet|SUBTOTAL|GST TAX|NET PAYABLE|warning|margin/i.test(l)).slice(0, 12)]);
  await s.screenshot('purchase_line_probe2');
  for (const l of log) console.log(JSON.stringify(l));
  evidence('purchase_line_probe2', log);
  await s.close();
})();
