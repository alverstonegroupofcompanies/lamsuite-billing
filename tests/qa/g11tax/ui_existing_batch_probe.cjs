// Why does a line on an existing batch not commit? + capture a full purchase payload (no charges) to see the server outcome
const { claim } = require('./pos.cjs');
const { sleep, evidence, sql } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
async function tabTo(s, re, max = 50) { for (let i = 0; i < max; i++) { const a = await active(s); if (re.test(a)) return a; await s.page.keyboard.press('Tab'); await sleep(60); } return null; }
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); if (v !== '') await s.page.keyboard.type(String(v), { delay: 25 }); }
(async () => {
  const s = await claim('existing_batch_probe', 2, 4);
  const log = [];
  await s.page.keyboard.press('F2'); await sleep(1500);
  await s.clickText('New Inward Bill'); await sleep(1500);
  await combo(s, ['Alt'], 'KeyS'); await s.page.keyboard.type('QA Pharma', { delay: 30 }); await sleep(1000); await s.page.keyboard.press('Enter'); await sleep(600);
  await combo(s, ['Alt'], 'KeyB'); await put(s, process.env.BILL || 'QA-PB-002');
  await tabTo(s, /type product name \[F1\]/);
  await s.page.keyboard.type('QA Cough', { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(900);
  log.push(['batch cell', await active(s), (await s.text()).split('\n').filter((l) => /CS-A1|on hand|new batch/i.test(l)).slice(0, 6)]);
  await s.page.keyboard.type('CS-A1', { delay: 30 }); await sleep(800);
  log.push(['batch options after typing', (await s.text()).split('\n').filter((l) => /CS-A1|on hand|new batch|create/i.test(l)).slice(0, 8)]);
  await s.page.keyboard.press('Enter'); await sleep(600);
  for (const v of ['0627', '25', '120', '60', '0', '12', '115']) { const a = await active(s); await put(s, v); await s.page.keyboard.press('Enter'); await sleep(400); log.push([a, '->', await active(s), (await s.text()).split('\n').filter((l) => /please|required|invalid|must|cannot|mismatch|warning|error|specify/i.test(l)).slice(0, 4)]); }
  log.push(['rows', (await s.page.evaluate(() => [...document.querySelectorAll('table[aria-label="Purchase Inward Items"] tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim())))]);
  await s.screenshot('existing_batch_probe');
  if (process.env.POST) {
    const n0 = s.net.length;
    await combo(s, ['Alt'], 'KeyI'); await put(s, '1680'); await s.page.keyboard.press('Enter');
    await s.page.keyboard.press('F12'); await sleep(2000); await s.page.keyboard.press('Enter'); await sleep(8000);
    const calls = s.net.slice(n0).filter((n) => /sync\/push|purchases/.test(n.url)).map((n) => ({ u: n.url, st: n.status, req: n.post_data, res: n.response_body }));
    log.push(['post screen', (await s.text()).split('\n').filter((l) => /Posted|C01-PUR|TOTAL INWARD|₹/.test(l)).slice(-6)]);
    log.push(['calls', calls]);
    log.push(['server purchases', sql('select id,invoice_number,subtotal,tax_total,grand_total,status from purchases where store_id=4')]);
  }
  for (const l of log) console.log(JSON.stringify(l).slice(0, 1500));
  evidence('existing_batch_probe' + (process.env.POST ? '_post' : ''), log);
  await s.close();
})();
