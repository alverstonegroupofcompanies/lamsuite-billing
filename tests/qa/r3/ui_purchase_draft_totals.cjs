// PUR-03: the entry row is not on the bill. Totals and Alt+I exclude it, F12 refuses while it
// holds a product, and the bill that posts carries exactly the committed lines.
const { claim } = require('./pos.cjs');
const { sleep, evidence, sql } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
async function tabTo(s, re, max = 50) { for (let i = 0; i < max; i++) { const a = await active(s); if (re.test(a)) return a; await s.page.keyboard.press('Tab'); await sleep(60); } return null; }
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); if (v !== '') await s.page.keyboard.type(String(v), { delay: 25 }); }
const rupee = (text, label) => { const m = new RegExp(label + '[^0-9]*([0-9][0-9,]*\\.[0-9]{2})').exec(text); return m ? Number(m[1].replace(/,/g, '')) : null; };
const BILL = (process.env.BILL || 'QA-PB-DRAFT').replace(/[^A-Za-z0-9_-]/g, '');
// Two committed lines: 100 × ₹60 @12% = ₹6,720 and 25 × ₹60 @12% = ₹1,680.
const LINES = [
  { q: 'QA Paracet', batch: 'PA-NEW', fields: ['0128', '100', '90', '60', '0', '12', '90'] },
  { q: 'QA Cough', batch: 'CS-B2', fields: ['0627', '25', '120', '60', '0', '12', '115'] },
];
const COMMITTED_NET = 8400;

(async () => {
  const s = await claim('purchase_draft_totals', 2, 4);
  const log = [];
  const text = async () => (await s.text()).split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

  await s.page.keyboard.press('F2'); await sleep(1500);
  await s.clickText('New Inward Bill'); await sleep(1500);
  await combo(s, ['Alt'], 'KeyS'); await s.page.keyboard.type('QA Pharma', { delay: 30 }); await sleep(1000); await s.page.keyboard.press('Enter'); await sleep(600);
  await combo(s, ['Alt'], 'KeyB'); await put(s, BILL);

  for (const L of LINES) {
    await tabTo(s, /type product name \[F1\]/);
    await s.page.keyboard.type(L.q, { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(900);
    await s.page.keyboard.type(L.batch, { delay: 30 }); await sleep(600); await s.page.keyboard.press('Enter'); await sleep(500);
    for (const v of L.fields) { await put(s, v); await s.page.keyboard.press('Enter'); await sleep(350); }
  }

  // Third product into the entry row only: no batch/expiry, so it cannot be committed (PUR-02).
  await tabTo(s, /type product name \[F1\]/);
  await s.page.keyboard.type('QA Cough', { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(900);
  log.push(['entry row holds', await active(s)]);

  const withDraft = await text();
  log.push(['subtotal with draft in entry row', rupee(withDraft, 'SUBTOTAL')]);
  log.push(['net payable with draft in entry row', rupee(withDraft, 'NET PAYABLE')]);

  await combo(s, ['Alt'], 'KeyI'); await put(s, String(COMMITTED_NET)); await s.page.keyboard.press('Enter'); await sleep(800);
  log.push(['"Match" against the committed total', /✓\s*Match/.test(await text())]);
  await s.screenshot('pur03_draft_totals_before_f12');

  await s.page.keyboard.press('F12'); await sleep(800);
  const refused = await text();
  log.push(['F12 refusal shown', /Press Enter to add the line in the entry row, or Esc to clear it/.test(refused)]);
  log.push(['summary opened anyway', /Post Purchase Inward Bill/.test(refused)]);

  await s.page.keyboard.press('Escape'); await sleep(700);
  log.push(['entry row cleared', await s.page.evaluate(() => document.getElementById('purchase-batch-2') === null)]);

  const beforePost = await text();
  log.push(['subtotal after Esc', rupee(beforePost, 'SUBTOTAL')]);
  log.push(['net payable after Esc', rupee(beforePost, 'NET PAYABLE')]);

  const n0 = s.net.length;
  await s.page.keyboard.press('F12'); await sleep(1500); await s.page.keyboard.press('Enter'); await sleep(8000);
  const calls = s.net.slice(n0).filter((n) => /sync\/push|purchases/.test(n.url));
  const push = calls.map((c) => { try { return JSON.parse(c.post_data || '{}'); } catch { return null; } }).find((b) => b && Array.isArray(b.items));
  const doc = push?.items?.map((i) => i.payload).find((p) => p && p.entity_type !== 'purchase_return' && p.grand_total !== undefined);
  log.push(['posted lines', doc?.items?.length ?? null]);
  log.push(['posted grand_total', doc?.grand_total ?? null]);
  log.push(['push response', (calls.find((c) => /sync\/push/.test(c.url))?.response_body || '').slice(0, 400)]);
  log.push(['screen after post', (await text()).split('\n').filter((l) => /Posted|TOTAL INWARD|₹/.test(l)).slice(-4)]);
  log.push(['server purchase', sql(`select id,invoice_number,subtotal,tax_total,grand_total,status from purchases where store_id=4 and invoice_number='${BILL}'`)]);
  log.push(['server lines', sql(`select count(*) n from purchase_items where purchase_id in (select id from purchases where store_id=4 and invoice_number='${BILL}')`)]);
  await s.screenshot('pur03_draft_totals_after_post');

  for (const l of log) console.log(JSON.stringify(l).slice(0, 1200));
  evidence('PUR03_draft_totals', log);
  await s.close();
})();
