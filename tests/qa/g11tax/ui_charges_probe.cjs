// Trace the charges grid focus/active cell after each key (no posting)
const { claim } = require('./pos.cjs');
const { sleep, evidence } = require('./lib.cjs');
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
(async () => {
  const s = await claim('charges_probe', 2, 4);
  await s.page.keyboard.press('F2'); await sleep(1500);
  await s.clickText('New Inward Bill'); await sleep(1500);
  await combo(s, ['Alt'], 'KeyF'); await sleep(1200);
  const state = () => s.page.evaluate(() => {
    const a = document.activeElement;
    const ring = [...document.querySelectorAll('[data-cell].ring-1, [data-cell-edit]')].map((e) => e.getAttribute('data-cell') || ('EDIT:' + e.getAttribute('data-cell-edit')));
    const rows = [...document.querySelectorAll('tr')].filter((r) => r.querySelector('[data-cell],[data-cell-edit]')).map((r) => r.innerText.replace(/\s+/g, ' ').trim());
    return { active: a ? `${a.tagName}:${a.getAttribute('data-cell') || a.getAttribute('data-cell-edit') || a.getAttribute('data-cell-entry') || a.placeholder || ''}` : null, ring, rows };
  });
  const log = [['open', await state()]];
  const seq = process.env.SEQ ? process.env.SEQ.split(',') : ['ArrowDown', 'ArrowUp', 'ArrowRight', 'Enter', 'T:200', 'Enter', 'ArrowRight', 'Space', 'Insert', 'Space'];
  for (const k of seq) {
    if (k.startsWith('T:')) await s.page.keyboard.type(k.slice(2), { delay: 40 }); else await s.page.keyboard.press(k);
    await sleep(350);
    log.push([k, await state()]);
  }
  for (const l of log) console.log(JSON.stringify(l));
  evidence('charges_probe', log);
  await s.close();
})();
