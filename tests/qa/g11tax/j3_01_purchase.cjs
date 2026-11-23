// J3.01/J3.02/J3.03 keyboard purchase bill with charges; post; verify every effect
const { claim } = require('./pos.cjs');
const { sql, api, evidence, sleep, state, saveState } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
async function tabTo(s, re, max = 50) { for (let i = 0; i < max; i++) { const a = await active(s); if (re.test(a)) return a; await s.page.keyboard.press('Tab'); await sleep(60); } return null; }
// overwrite the focused field (select its text first, as a user's select-all would)
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); if (v !== '') await s.page.keyboard.type(String(v), { delay: 25 }); }
const BILL = process.env.BILL || 'QA-PB-001';
const LINES = [
  { q: 'QA Paracet', batch: 'PA-NEW', exp: '0128', packs: '100', mrp: '90', rate: '60', disc: '0', gst: '12', sell: '90' },
  { q: 'QA Paracet', batch: 'PA-OLD', exp: '0327', packs: '50', mrp: '90', rate: '50', disc: '0', gst: '12', sell: '90' },
  { q: 'QA Cough', batch: 'CS-B2', exp: '0627', packs: '25', mrp: '120', rate: '60', disc: '0', gst: '12', sell: '115' },
];
(async () => {
  const st = state();
  const ev = { bill: BILL, steps: [] };
  const clog = [];
  let s;
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await s.page.keyboard.press(k); await sleep(150); } };
  const pre = {
    batches: sql('select id,product_id,batch_no,stock_qty,purchase_rate,landed_cost_rate from product_batches where store_id=4 order by id'),
    supplier: sql("select id,current_balance from parties where name='QA Pharma Distributors'"),
    ledger_rows: sql('select count(*) n from stock_ledger_entries where store_id=4')[0].n,
  };
  ev.pre = pre;
  s = await claim('j3_01', 2, 4);
  await s.page.keyboard.press('F2'); await sleep(1500);
  await s.clickText('New Inward Bill'); await sleep(1500);   // KB-01: no key opens the form
  await combo(s, ['Alt'], 'KeyS'); await s.page.keyboard.type('QA Pharma', { delay: 30 }); await sleep(1000); await s.page.keyboard.press('Enter'); await sleep(600);
  await combo(s, ['Alt'], 'KeyB'); await put(s, BILL);
  for (const [i, L] of LINES.entries()) {
    const at = await tabTo(s, /type product name \[F1\]/);
    await s.page.keyboard.type(L.q, { delay: 40 }); await sleep(1300);
    await s.page.keyboard.press('Enter'); await sleep(900);
    const seq = [];
    // batch combobox: type batch and Enter
    seq.push(await active(s)); await s.page.keyboard.type(L.batch, { delay: 30 }); await sleep(600); await s.page.keyboard.press('Enter'); await sleep(500);
    for (const v of [L.exp, L.packs, L.mrp, L.rate, L.disc, L.gst, L.sell]) { seq.push(await active(s)); await put(s, v); await s.page.keyboard.press('Enter'); await sleep(350); }
    seq.push(await active(s));
    ev.steps.push({ line: i, at, seq });
    console.log('line', i, JSON.stringify(seq));
  }
  const gridText = (await s.text()).split('\n').filter((l) => /QA Paracet|QA Cough|PA-|CS-A1|SUBTOTAL|GST TAX|CHARGES|NET PAYABLE|₹/.test(l)).slice(0, 40);
  ev.grid_before_charges = gridText; console.log(gridText.join(' | ').slice(0, 1500));
  await s.screenshot(`j3_01_${BILL}_lines`);
  if (!process.env.NOCHARGES) {
  // charges grid
  await combo(s, ['Alt'], 'KeyF'); await sleep(1200);
  ev.charges_open = (await s.text()).split('\n').filter((l) => /charge|freight|packing|treatment|spread|head/i.test(l)).slice(0, 30);
  console.log('CHARGES MODAL', ev.charges_open.join(' | ').slice(0, 1500));
  await s.screenshot(`j3_01_${BILL}_charges_modal`);
  evidence(`J3_01_${BILL}_partial`, ev);
  if (process.env.STOP_AT_CHARGES) { await s.close(); return; }
  }
  if (!process.env.NOCHARGES) {
  const rows = () => s.page.evaluate(() => [...document.querySelectorAll('[role=dialog] tr, .fixed tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()).filter((t) => t && !/^# HEAD/.test(t)));
  // grid opens on row 1 Amount. Freight: Enter, 200, Enter; GST cycle to 18; treatment stays Add to cost
  const cell = (r, c) => s.page.evaluate((r, c) => { const e = document.querySelector(`[data-cell="${r}-${c}"]`); return e ? e.innerText.trim() : null; }, r, c);
  await key('Enter'); await s.page.keyboard.type('200', { delay: 30 }); await key('Enter');
  await key('ArrowRight');
  for (let i = 0; i < 6 && (await cell(0, 'gst_percent')) !== '18'; i++) await key('Space');
  clog.push(['freight', await rows()]);
  // Packing: Insert (lands on row 2 Amount), Left to Head, cycle to Packing
  await key('Insert'); await key('ArrowLeft');
  for (let i = 0; i < 8 && !/packing/i.test((await cell(1, 'head_code')) || ''); i++) await key('Space');
  await key('ArrowRight'); await key('Enter'); await s.page.keyboard.type('100', { delay: 30 }); await key('Enter');
  await key('ArrowRight');
  for (let i = 0; i < 6 && (await cell(1, 'gst_percent')) !== '18'; i++) await key('Space');
  await key('ArrowRight');
  for (let i = 0; i < 4 && !/expense/i.test((await cell(1, 'treatment')) || ''); i++) await key('Space');
  clog.push(['packing row', await rows()]);
  ev.charge_rows = await rows(); console.log('CHARGE ROWS', JSON.stringify(ev.charge_rows));
  ev.charges_text = (await s.text()).split('\n').filter((l) => /Charges ₹|needs|must|invalid/i.test(l)).slice(0, 8);
  await s.screenshot(`j3_02_${BILL}_charges_filled`);
  await combo(s, ['Control'], 'Enter'); await sleep(1200);
  ev.after_apply = (await s.text()).split('\n').filter((l) => /SUBTOTAL|GST TAX|CHARGES|NET PAYABLE|Round|₹ 1[01],/.test(l)).slice(0, 12);
  console.log('AFTER APPLY', ev.after_apply.join(' | '));
  }
  // supplier bill total check
  await combo(s, ['Alt'], 'KeyI'); await put(s, process.env.NOCHARGES ? '11200' : '11554'); await key('Enter'); await sleep(600);
  ev.total_check = (await s.text()).split('\n').filter((l) => /match|differ|mismatch|vendor inv|11554|11,554/i.test(l)).slice(0, 8);
  console.log('TOTAL CHECK', ev.total_check.join(' | '));
  await s.screenshot(`j3_02_${BILL}_ready_to_post`);
  // post
  const n0 = s.net.length;
  await key('F12'); await sleep(2000);
  ev.post_modal = (await s.text()).split('\n').filter(Boolean).slice(-40);
  await s.screenshot(`j3_03_${BILL}_post_summary`);
  // confirm summary if shown (Enter on its primary action)
  await key('Enter'); await sleep(3500);
  ev.post_calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, req: n.post_data || '', res: n.response_body || '' }));
  ev.post_screen = (await s.text()).split('\n').filter(Boolean).slice(-30);
  console.log('POST CALLS', JSON.stringify(ev.post_calls.map((c) => c.m + ' ' + c.u + ' ' + c.st)));
  console.log('POST SCREEN', ev.post_screen.join(' | ').slice(0, 1200));
  await s.screenshot(`j3_03_${BILL}_after_post`);
  await sleep(6000); // allow background sync
  ev.later_calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status }));
  ev.dups = s.dupNetwork();
  ev.clog = clog;
  evidence(`J3_01_${BILL}`, ev);
  st.purchaseBill = BILL; saveState(st);
  await s.close();
})();
