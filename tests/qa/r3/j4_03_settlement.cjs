// J4.03 split cash+UPI with reference; J4.04 credit rules (walk-in, named within limit, over limit) through the till UI
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || ''}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
const combo = async (s, mods, key) => { for (const m of mods) await s.page.keyboard.down(m); await s.page.keyboard.press(key); for (const m of [...mods].reverse()) await s.page.keyboard.up(m); };
async function addItem(s, q, packs, loose) {
  await s.page.keyboard.press('F1'); await sleep(400);
  await s.page.keyboard.type(q, { delay: 35 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(800);
  if (/Select Batch/.test(await s.text())) { await s.page.keyboard.press('Enter'); await sleep(700); }
  await put(s, String(packs)); if (loose !== undefined) { await s.page.keyboard.press('Tab'); await put(s, String(loose)); }
  await s.page.keyboard.press('Enter'); await sleep(600);
}
async function setCustomer(s, name) {
  await combo(s, ['Alt'], 'KeyC'); await sleep(400);
  await put(s, name); await sleep(1200); await s.page.keyboard.press('Enter'); await sleep(700);
  return (await s.text()).split('\n').filter((l) => /QA Credit|QA No Credit|credit limit|outstanding/i.test(l)).slice(0, 5);
}
const msgs = async (s) => (await s.text()).split('\n').filter((l) => /credit|limit|walk-?in|reference|required|cannot|not allowed|exceed|blocked|saved|C01-INV/i.test(l)).slice(-8);
(async () => {
  const ev = {};
  const s = await claim('j4_03', 2, 4);
  await s.page.keyboard.press('F1'); await sleep(1000);
  // ---- J4.03 split: 1 strip = 90.00 -> cash 50 + UPI 40 (ref UPI-QA-0001)
  let n0 = s.net.length;
  await addItem(s, 'QA Paracet', 1, 0);
  await s.page.keyboard.press('F12'); await sleep(1200);
  ev.split_focus = await active(s);
  await put(s, '50');
  await combo(s, ['Alt'], 'Digit2'); await sleep(600);
  ev.split_after_alt2 = { active: await active(s), text: (await s.text()).split('\n').filter((l) => /#\d|UPI|Cash|balance|remaining|reference|Ref/i.test(l)).slice(0, 20) };
  // move to the reference field of the UPI line by Tab and type it
  for (let i = 0; i < 6; i++) { const a = await active(s); if (/ref|UTR|transaction/i.test(a)) break; await s.page.keyboard.press('Tab'); await sleep(150); }
  ev.ref_field = await active(s);
  if (/ref|UTR|transaction/i.test(ev.ref_field)) await s.page.keyboard.type('UPI-QA-0001', { delay: 20 });
  await s.screenshot('j4_03_split_ready');
  await combo(s, ['Control'], 'KeyS'); await sleep(4500);
  ev.split_msgs = await msgs(s);
  ev.split_calls = s.net.slice(n0).filter((n) => /\/invoices$/.test(n.url) && n.method === 'POST').map((n) => ({ st: n.status, req: n.post_data, res: (n.response_body || '').slice(0, 600) }));
  const inv1 = sql('select id,invoice_number,grand_total,paid_amount,payment_mode,payment_status from invoices where store_id=4 order by id desc limit 1')[0];
  ev.split_db = { inv: inv1, pays: inv1 ? sql(`select payment_mode,amount,reference_no from invoice_payments where invoice_id=${inv1.id}`) : [] };
  console.log('SPLIT', JSON.stringify(ev.split_db), JSON.stringify(ev.split_msgs));
  // ---- J4.04a credit for walk-in (expect refused)
  n0 = s.net.length;
  await addItem(s, 'QA Paracet', 1, 0);
  await s.page.keyboard.press('F12'); await sleep(1200);
  await combo(s, ['Alt'], 'Digit8'); await sleep(600);       // Credit
  ev.walkin_credit_screen = await msgs(s);
  await combo(s, ['Control'], 'KeyS'); await sleep(3500);
  ev.walkin_credit_after = await msgs(s);
  ev.walkin_credit_calls = s.net.slice(n0).filter((n) => /\/invoices$/.test(n.url) && n.method === 'POST').map((n) => ({ st: n.status, res: (n.response_body || '').slice(0, 400) }));
  console.log('WALKIN CREDIT', JSON.stringify(ev.walkin_credit_after), JSON.stringify(ev.walkin_credit_calls.map((c) => c.st)));
  await s.screenshot('j4_04_walkin_credit');
  await s.page.keyboard.press('Escape'); await sleep(500);
  // ---- J4.04b named customer within limit (QA Credit Customer, limit 1000): 1 strip credit
  ev.cust_pick = await setCustomer(s, 'QA Credit');
  n0 = s.net.length;
  await s.page.keyboard.press('F12'); await sleep(1200);
  await combo(s, ['Alt'], 'Digit8'); await sleep(600);
  await combo(s, ['Control'], 'KeyS'); await sleep(4000);
  ev.named_credit_after = await msgs(s);
  ev.named_credit_calls = s.net.slice(n0).filter((n) => /\/invoices$/.test(n.url) && n.method === 'POST').map((n) => ({ st: n.status, req: (n.post_data || '').slice(0, 800), res: (n.response_body || '').slice(0, 400) }));
  console.log('NAMED CREDIT', JSON.stringify(ev.cust_pick), JSON.stringify(ev.named_credit_after), JSON.stringify(ev.named_credit_calls.map((c) => c.st)));
  // ---- J4.04c over limit: 12 strips = 1080 credit for same customer
  ev.cust_pick2 = await setCustomer(s, 'QA Credit');
  await addItem(s, 'QA Paracet', 12, 0);
  n0 = s.net.length;
  await s.page.keyboard.press('F12'); await sleep(1200);
  await combo(s, ['Alt'], 'Digit8'); await sleep(600);
  ev.over_limit_screen = await msgs(s);
  await combo(s, ['Control'], 'KeyS'); await sleep(4000);
  ev.over_limit_after = await msgs(s);
  ev.over_limit_calls = s.net.slice(n0).filter((n) => /\/invoices$/.test(n.url) && n.method === 'POST').map((n) => ({ st: n.status, res: (n.response_body || '').slice(0, 400) }));
  console.log('OVER LIMIT', JSON.stringify(ev.over_limit_after), JSON.stringify(ev.over_limit_calls.map((c) => c.st)));
  await s.screenshot('j4_04_over_limit');
  ev.db = sql('select id,invoice_number,customer_id,customer_name,grand_total,paid_amount,payment_mode,payment_status from invoices where store_id=4 order by id');
  ev.customer = sql('select id,name,credit_limit,current_balance from parties where id in (6,7)');
  console.log('DB', JSON.stringify(ev.db), JSON.stringify(ev.customer));
  evidence('J4_03_settlement', ev);
  await s.close();
})();
