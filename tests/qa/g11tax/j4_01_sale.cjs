// J4.01 / J4.02 keyboard cash bill: 2 strips + 5 tablets @ 90/strip(15) 12% inclusive -> 210.00
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep, P, R, inclusive, state, saveState } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
const lines = async (s) => (await s.text()).split('\n').filter((l) => /SUBTOTAL|GST TAX|NET PAYABLE|Round-off|ITEMS|INVOICE NO|C01-INV|₹ 2[01]\d\.\d\d/.test(l)).slice(0, 14);
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
(async () => {
  // independent expectation
  const gross = P('90') * 2n + (P('90') * 5n) / 15n;                // 180 + 30 = 210.00
  const exp = inclusive(gross, 1200);
  const expected = { total: R(exp.total), taxable: R(exp.taxable), tax: R(exp.tax), cgst: R(exp.cgst), sgst: R(exp.sgst), stock_delta_tablets: -35, batch: 'PA-OLD (FEFO, exp 2027-03-31)' };
  const pre = { batches: sql("select id,batch_no,stock_qty from product_batches where product_id=5 order by expiry_date"), product: sql('select current_stock from products where id=5')[0], invoices: sql('select count(*) n from invoices where store_id=4')[0].n };
  const ev = { expected, pre, steps: [] };
  const s = await claim('j4_01', 2, 4);
  await s.page.keyboard.press('F1'); await sleep(1200); await s.page.keyboard.press('F1'); await sleep(500);
  await s.page.keyboard.type('QA Paracet', { delay: 40 }); await sleep(1500);
  await s.page.keyboard.press('Enter'); await sleep(900);
  ev.batch_modal = (await s.page.evaluate(() => { const d = [...document.querySelectorAll('[role=dialog], .fixed')].map((x) => x.innerText).find((t) => /Select Batch/.test(t)); return d ? d.split('\n').filter(Boolean).slice(0, 30) : null; }));
  console.log('BATCH MODAL', JSON.stringify(ev.batch_modal).slice(0, 800));
  await s.page.keyboard.press('Enter'); await sleep(900);                    // take the FEFO default
  const seq = [];
  seq.push(['after batch', await active(s)]);
  await put(s, '2'); seq.push(['typed packs', await active(s), await lines(s)]);
  await s.page.keyboard.press('Tab'); await sleep(300); seq.push(['tab', await active(s)]);
  await put(s, '5'); seq.push(['typed loose', await active(s), await lines(s)]);
  ev.totals_before_enter = await lines(s);
  await s.page.keyboard.press('Enter'); await sleep(900);
  seq.push(['after Enter', await active(s), await lines(s)]);
  ev.steps = seq; for (const x of seq) console.log(JSON.stringify(x).slice(0, 600));
  ev.cart_rows = await s.page.evaluate(() => [...document.querySelectorAll('tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()).filter((t) => /QA Paracet/.test(t)));
  console.log('CART', JSON.stringify(ev.cart_rows));
  await s.screenshot('j4_01_cart');
  // checkout
  const n0 = s.net.length;
  await s.page.keyboard.press('F12'); await sleep(1500);
  ev.settle_modal = (await s.text()).split('\n').filter(Boolean).slice(-45);
  console.log('SETTLE', ev.settle_modal.join(' | ').slice(0, 1500));
  await s.screenshot('j4_01_settlement');
  // J4.02: double Enter / double submit in the settlement modal
  ev.settle_focus = await active(s); console.log('SETTLE FOCUS', ev.settle_focus);
  await put(s, '500'); ev.settle_after_amount = (await s.text()).split('\n').filter((l) => /change|balance|return|tender|paid/i.test(l)).slice(0, 8);
  console.log('AFTER AMOUNT', JSON.stringify(ev.settle_after_amount));
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); await sleep(5000);
  ev.after_settle = (await s.text()).split('\n').filter(Boolean).slice(-25);
  ev.calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, req: n.post_data || '', res: (n.response_body || '').slice(0, 2500) }));
  console.log('CALLS', JSON.stringify(ev.calls.map((c) => c.m + ' ' + c.u + ' ' + c.st)));
  console.log('AFTER', ev.after_settle.join(' | ').slice(0, 900));
  await s.screenshot('j4_01_after_save');
  await sleep(6000);
  const inv = sql('select * from invoices where store_id=4 order by id desc limit 3');
  ev.db = {
    invoices: inv,
    items: inv.length ? sql(`select * from invoice_items where invoice_id=${inv[0].id}`) : [],
    payments: inv.length ? sql(`select * from invoice_payments where invoice_id=${inv[0].id}`) : [],
    batches: sql("select id,batch_no,stock_qty from product_batches where product_id=5 order by expiry_date"),
    product: sql('select current_stock from products where id=5')[0],
    ledger: sql("select batch_id,event_type,qty_delta,reference_type,reference_id,counter_code,balance_after from stock_ledger_entries where product_id=5 and reference_type!='PURCHASE'"),
    count: sql('select count(*) n from invoices where store_id=4')[0].n,
  };
  console.log('DB', JSON.stringify(ev.db).slice(0, 3500));
  ev.later_calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => n.method + ' ' + n.url.replace(/.*\/api/, '') + ' ' + n.status);
  evidence('J4_01_sale', ev);
  const st = state(); st.j4Invoice = inv[0] && inv[0].id; saveState(st);
  await s.close();
})();
