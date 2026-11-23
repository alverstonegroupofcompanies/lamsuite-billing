// J5.01 sale then partial loose return in one till session; then over-limit attempt
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep } = require('./lib.cjs');
const active = (s) => s.page.evaluate(() => { const e = document.activeElement; return e ? `${e.tagName}:${e.type || ''}:${e.placeholder || e.getAttribute('aria-label') || e.id || (e.innerText || '').slice(0, 30)}=${(e.value ?? '').toString().slice(0, 24)}` : null; });
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
async function openReturn(s, saleNo) {
  await s.page.keyboard.press('F7'); await sleep(1500);
  await s.clickText('New Return'); await sleep(1500);
  await s.page.keyboard.type(saleNo, { delay: 25 }); await s.page.keyboard.press('Enter'); await sleep(2000);
  await s.page.evaluate((no) => { const b = [...document.querySelectorAll('button')].find((b) => b.innerText.includes(no) && b.innerText.includes('₹')); if (b) b.click(); }, saleNo);
  await sleep(1800);
}
async function fillLine(s, units) {
  const cb = await s.page.$('input[type=checkbox]'); if (cb) await cb.click(); await sleep(300);
  const qty = await s.page.$('input[type=number]');
  if (qty) { await qty.click(); await qty.evaluate((e) => e.select()); await qty.type(String(units), { delay: 30 }); }
  await sleep(300);
  for (const sel of await s.page.$$('select')) {
    const opts = await sel.evaluate((e) => [...e.options].map((o) => o.value + '|' + o.text));
    const pick = opts.find((o) => /Restock to Inventory/.test(o)) || opts.find((o) => /Customer Return/.test(o));
    if (pick) await sel.select(pick.split('|')[0]);
  }
  await sleep(400);
  const exp_cell = await s.page.evaluate(() => {
    const row = document.querySelector('[data-return-line="0"]');
    return row ? (row.querySelectorAll('td')[2]?.innerText || '').replace(/\s+/g, ' ').trim() : null;
  });
  return { qty_value: qty ? await qty.evaluate((e) => e.value) : null, exp_cell, summary: (await s.text()).split('\n').filter((l) => /item\(s\) selected|exceed|max|only/i.test(l)).slice(-4) };
}
async function finish(s) {
  await s.clickText('Next: Payment'); await sleep(1500);
  const step = (await s.text()).split('\n').filter(Boolean).slice(-40);
  const controls = (await s.controls()).filter((c) => !c.disabled).map((c) => `${c.tag}:${c.type}:${c.ph || c.aria || c.text}`).slice(-20);
  const n0 = s.net.length;
  const btn = await s.page.evaluate(() => { const b = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && /complete|save|process|issue|confirm|refund/i.test(b.innerText) && !/back/i.test(b.innerText)).pop(); if (b) { const t = b.innerText; b.click(); return t; } return null; });
  await sleep(5000);
  const calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, req: (n.post_data || '').slice(0, 2500), res: (n.response_body || '').slice(0, 800) }));
  const after = (await s.text()).split('\n').filter(Boolean).slice(-30);
  return { step, controls, btn, calls, after };
}
(async () => {
  const ev = {};
  const s = await claim('j5_01', 2, 4);
  await s.page.keyboard.press('F1'); await sleep(1000); await s.page.keyboard.press('F1'); await sleep(400);
  // "2*qty" multiplier: the billing screen now adds the line on the batch pick and puts focus
  // on the row quantity input, so the quantity must be typed without jumping straight to Enter.
  await s.page.keyboard.type('2*QA Paracet', { delay: 40 }); await sleep(1400); await s.page.keyboard.press('Enter'); await sleep(900);
  await s.page.keyboard.press('Enter'); await sleep(900);
  await put(s, '2'); await s.page.keyboard.press('Tab'); await put(s, '5'); await s.page.keyboard.press('Enter'); await sleep(600);
  let n0 = s.net.length;
  await s.page.keyboard.press('F12'); await sleep(1200);
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); await sleep(5000);
  const sale = s.net.slice(n0).find((n) => /\/invoices$/.test(n.url) && n.method === 'POST');
  let saleNo = null; try { saleNo = JSON.parse(sale.response_body).invoice.invoice_number; } catch { /* */ }
  ev.sale = { st: sale && sale.status, no: saleNo, res: sale ? (sale.response_body || '').slice(0, 300) : null };
  ev.preStock = sql('select id,batch_no,stock_qty from product_batches where product_id=5 order by expiry_date');
  console.log('SALE', JSON.stringify(ev.sale));
  if (!saleNo) {
    await s.screenshot('j5_01_sale_failed');
    evidence('J5_01_return', ev);
    console.error('sale did not save; stopping before the return flow');
    process.exitCode = 1;
    await s.close();
    return;
  }
  await openReturn(s, saleNo);
  ev.line1 = await fillLine(s, 5);
  console.log('LINE1', JSON.stringify(ev.line1));
  ev.ret1 = await finish(s);
  console.log('RET1 BTN', ev.ret1.btn, JSON.stringify(ev.ret1.calls.map((c) => c.m + ' ' + c.u + ' ' + c.st)));
  console.log('RET1 STEP', JSON.stringify(ev.ret1.step).slice(0, 1500));
  console.log('RET1 AFTER', JSON.stringify(ev.ret1.after).slice(0, 1200));
  await s.screenshot('j5_01_return_saved');
  ev.db1 = {
    stock: sql('select id,batch_no,stock_qty from product_batches where product_id=5 order by expiry_date'),
    ledger: sql('select batch_id,event_type,qty_delta,reference_type,reference_id from stock_ledger_entries where product_id=5 order by id desc limit 3'),
    returns: sql("select id,invoice_number,module_key,status,original_invoice_number,grand_total,taxable_subtotal,tax_total,cgst_total,sgst_total,paid_amount,payment_mode from invoices where module_key!='invoice' or original_invoice_number is not null order by id desc limit 3"),
  };
  console.log('DB1', JSON.stringify(ev.db1).slice(0, 2500));
  // remaining-qty limit: 31 units > 30 remaining
  await openReturn(s, saleNo);
  ev.line2 = await fillLine(s, 31);
  console.log('LINE2 (31 units)', JSON.stringify(ev.line2));
  ev.ret2 = await finish(s);
  console.log('RET2', ev.ret2.btn, JSON.stringify(ev.ret2.calls.map((c) => c.m + ' ' + c.u + ' ' + c.st + ' ' + c.res.slice(0, 160))));
  await s.screenshot('j5_01_return_over_limit');
  ev.db2 = { stock: sql('select id,batch_no,stock_qty from product_batches where product_id=5 order by expiry_date'), returns: sql("select id,invoice_number,module_key,status,original_invoice_number,grand_total from invoices where module_key!='invoice' or original_invoice_number is not null order by id desc limit 4") };
  console.log('DB2', JSON.stringify(ev.db2).slice(0, 1500));
  evidence('J5_01_return', ev);
  await s.close();
})();
