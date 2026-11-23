// G3-PURCHASE-UI re-check (PUR-02, PUR-03, PUR-04) against a private copy of the r3 env.
// Drives cells by locating them, not by counting Enter presses, so a keyboard-order change elsewhere
// (G8) can't make it type into the wrong cell.
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep } = require('./lib.cjs');

const BILL = process.env.BILL || 'QA-PB-G3-1';
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.placeholder || e.getAttribute('aria-label') || e.id || ''}=${(e.value ?? '').toString().slice(0, 20)}` : null; });
const tfoot = (s) => s.page.evaluate(() => { const f = document.querySelector('table[aria-label="Purchase Inward Items"] tfoot'); return f ? f.innerText.replace(/\s+/g, ' ').trim() : null; });
const bodyRows = (s) => s.page.evaluate(() => [...document.querySelectorAll('table[aria-label="Purchase Inward Items"] tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()));
const totalsBar = async (s) => (await s.text()).split('\n').filter((l) => /SUBTOTAL|GST TAX|NET PAYABLE|Match|Over|Short|Round/i.test(l)).slice(0, 12);

async function focusDraft(s, placeholder) {
  return s.page.evaluate((ph) => {
    const f = document.querySelector('table[aria-label="Purchase Inward Items"] tfoot');
    const el = f && [...f.querySelectorAll('input')].find((i) => i.placeholder === ph);
    if (!el) return false; el.focus(); el.select && el.select(); return true;
  }, placeholder);
}
async function setDraft(s, placeholder, value) {
  if (!(await focusDraft(s, placeholder))) return `missing:${placeholder}`;
  await s.page.keyboard.type(String(value), { delay: 20 }); await sleep(150);
  return 'ok';
}
async function pickProduct(s, query) {
  const ok = await s.page.evaluate(() => { const i = document.querySelector('input[placeholder*="type product name" i]'); if (!i) return false; i.focus(); return true; });
  if (!ok) return 'no product input';
  await s.page.keyboard.type(query, { delay: 35 }); await sleep(1300);
  // choose the exact-name result rather than the first fuzzy match
  const picked = await s.page.evaluate((q) => {
    const opt = [...document.querySelectorAll('[role=option], li, button')].find((e) => (e.innerText || '').trim().startsWith(q));
    if (opt) { opt.scrollIntoView(); return opt.innerText.split('\n')[0]; } return null;
  }, query);
  await s.page.keyboard.press('Enter'); await sleep(1000);
  return picked;
}

(async () => {
  const log = [];
  const s = await claim('g3_probe', 2, 4);
  try {
    await s.page.keyboard.press('F2'); await sleep(1500);
    await s.clickText('New Inward Bill'); await sleep(1500);
    await combo(s, ['Alt'], 'KeyS'); await s.page.keyboard.type('QA Pharma', { delay: 30 }); await sleep(1000); await s.page.keyboard.press('Enter'); await sleep(600);
    await combo(s, ['Alt'], 'KeyB'); await s.page.keyboard.type(BILL, { delay: 20 }); await sleep(300);

    // ---- PUR-02 + PUR-04: existing batch CS-A1 on QA Cough Syrup, then commit with Enter on Sell
    log.push(['product', await pickProduct(s, 'QA Cough Syrup 100ml'), await active(s)]);
    const trig = await s.page.evaluate(() => { const t = document.querySelector('table[aria-label="Purchase Inward Items"] tfoot [role=combobox][id^="purchase-batch-"]'); if (!t) return null; t.focus(); return t.id; });
    log.push(['batch trigger', trig]);
    await s.page.keyboard.type('CS-A1', { delay: 40 }); await sleep(900);
    const opts = await s.page.evaluate(() => [...document.querySelectorAll('[role=listbox] [data-index]')].map((o) => o.innerText.replace(/\s+/g, ' ').trim()).slice(0, 5));
    log.push(['batch options', opts]);
    await s.page.keyboard.press('Enter'); await sleep(700);
    log.push(['entry row after pick', await tfoot(s)]);
    for (const [ph, v] of [['Packs', '10'], ['Rate', '60'], ['Sell', '90']]) log.push(['set', ph, await setDraft(s, ph, v)]);
    log.push(['entry row before commit', await tfoot(s)]);
    await focusDraft(s, 'Sell'); await s.page.keyboard.press('Enter'); await sleep(900);
    const toasts1 = (await s.text()).split('\n').filter((l) => /specify batch|expiry|invalid|cannot/i.test(l));
    log.push(['PUR-02 toasts', toasts1]);
    log.push(['PUR-02 committed rows', await bodyRows(s)]);

    // ---- PUR-03: put a second product in the entry row and leave it there
    const before = await totalsBar(s);
    log.push(['totals with 1 committed line', before]);
    log.push(['product 2', await pickProduct(s, 'QA Paracet 500 Strip')]);
    await setDraft(s, 'Rate', '60'); await setDraft(s, 'Sell', '90');
    const withDraft = await totalsBar(s);
    log.push(['totals with entry-row line', withDraft, 'unchanged=' + (JSON.stringify(before) === JSON.stringify(withDraft))]);
    log.push(['PUR-04 entry-row margin', (await tfoot(s) || '').match(/-?\d+\.\d%/g)]);

    await s.page.evaluate(() => document.body.focus());
    await s.page.keyboard.press('F12'); await sleep(1200);
    const refusal = (await s.text()).split('\n').filter((l) => /still in the entry row|Press Enter to add/i.test(l));
    const summaryOpen = /Post Purchase Inward Bill/.test(await s.text());
    log.push(['PUR-03 F12 with entry row', { refusal, summaryOpen }]);
    await s.screenshot('g3_f12_refused');

    // clear the entry row, then post and compare the payload with the screen
    await focusDraft(s, 'Sell'); await s.page.keyboard.press('Escape'); await sleep(500);
    if (await tfoot(s).then((t) => /QA Paracet/.test(t || ''))) { await s.page.evaluate(() => document.body.focus()); await s.page.keyboard.press('Escape'); await sleep(500); }
    log.push(['entry row after Esc', await tfoot(s)]);
    const screenNet = (await totalsBar(s));
    log.push(['screen before post', screenNet]);
    const n0 = s.net.length;
    await s.page.evaluate(() => document.body.focus());
    await s.page.keyboard.press('F12'); await sleep(1800);
    log.push(['summary open', /Post Purchase Inward Bill/.test(await s.text())]);
    await s.page.keyboard.press('Enter'); await sleep(8000);
    const success = (await s.text()).split('\n').filter((l) => /Posted|TOTAL INWARD|₹/.test(l)).slice(-8);
    log.push(['success modal', success]);
    await s.screenshot('g3_posted');
    const calls = s.net.slice(n0).filter((n) => /sync\/push|purchases/.test(n.url) && n.method === 'POST').map((n) => ({ u: n.url, st: n.status, req: (n.post_data || '').slice(0, 4000) }));
    log.push(['post calls', calls]);
    await sleep(3000);
    log.push(['server row', sql(`select id,invoice_number,subtotal,tax_total,grand_total,status from purchases where store_id=4 and (invoice_number='${BILL}' or supplier_invoice_no='${BILL}')`)]);
  } catch (e) {
    log.push(['error', String(e && e.stack || e)]);
    try { await s.screenshot('g3_error'); } catch { /* */ }
  }
  for (const l of log) console.log(JSON.stringify(l).slice(0, 1800));
  evidence(`G3_probe_${BILL}`, log);
  await s.close();
})();
