// J4.06 exclusive tax bill in the cosmetics store + J4.07 pharmacy-only fields absent
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep, P, R, exclusive } = require('./lib.cjs');
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
(async () => {
  const e = exclusive(P('400'), 1800);
  const ev = { expected: { taxable: R(e.taxable), cgst: R(e.cgst), sgst: R(e.sgst), total: R(e.total) } };
  const s = await claim('j4_06', 4, 5);
  ev.home = (await s.text()).split('\n').slice(0, 12);
  await s.page.keyboard.press('F1'); await sleep(1000); await s.page.keyboard.press('F1'); await sleep(400);
  const ctrls = await s.controls();
  ev.billing_controls = ctrls.filter((c) => c.tag === 'INPUT').map((c) => c.ph);
  ev.pharmacy_fields_visible = ev.billing_controls.filter((p) => /Dr\.|Doctor|Patient|pharmacist/i.test(p || ''));
  ev.pharmacy_words_on_screen = (await s.text()).split('\n').filter((l) => /doctor|patient|schedule|pharmac|drug/i.test(l)).slice(0, 10);
  console.log('PHARMACY FIELDS IN COSMETICS', JSON.stringify(ev.pharmacy_fields_visible), JSON.stringify(ev.pharmacy_words_on_screen));
  ev.tax_badge = (await s.text()).split('\n').filter((l) => /GST (Incl|Excl)/.test(l));
  await s.page.keyboard.type('QA Ruby', { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(800);
  if (/Select Batch/.test(await s.text())) { ev.batch_modal = (await s.text()).split('\n').filter((l) => /LP-01|B1|in stock/.test(l)); await s.page.keyboard.press('Enter'); await sleep(600); }
  await put(s, '1'); await s.page.keyboard.press('Enter'); await sleep(700);
  ev.totals = (await s.text()).split('\n').filter((l) => /SUBTOTAL|GST TAX|NET PAYABLE|₹ 4\d\d/.test(l)).slice(0, 8);
  console.log('TOTALS', JSON.stringify(ev.totals), 'badge', JSON.stringify(ev.tax_badge));
  await s.screenshot('j4_06_cosmetics_cart');
  const n0 = s.net.length;
  await s.page.keyboard.press('F12'); await sleep(1200);
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); await sleep(5000);
  ev.calls = s.net.slice(n0).filter((n) => /\/invoices$/.test(n.url) && n.method === 'POST').map((n) => ({ st: n.status, req: n.post_data, res: (n.response_body || '').slice(0, 500) }));
  const inv = sql('select id,invoice_number,store_id,counter_code,subtotal,taxable_subtotal,cgst_total,sgst_total,igst_total,tax_total,grand_total,place_of_supply,store_state_code,doctor_name,patient_name from invoices where store_id=5 order by id desc limit 1')[0];
  ev.db = { inv, items: inv ? sql(`select product_name,qty,unit_price,taxable_amount,cgst_amount,sgst_amount,igst_amount,total_amount from invoice_items where invoice_id=${inv.id}`) : [] };
  console.log('DB', JSON.stringify(ev.db));
  await s.screenshot('j4_06_after_save');
  evidence('J4_06_exclusive', ev);
  await s.close();
})();
