// J10.02 bill offline on a till, reconnect, verify each bill syncs exactly once, in order, numbers unique
const { claim } = require('./pos.cjs');
const { sql, evidence, sleep } = require('./lib.cjs');
async function put(s, v) { await s.page.evaluate(() => { const e = document.activeElement; try { e.select && e.select(); } catch { /* */ } }); await s.page.keyboard.type(String(v), { delay: 30 }); }
async function sellOne(s, packs) {
  await s.page.keyboard.press('F1'); await sleep(500);
  await s.page.keyboard.type('QA Cough', { delay: 40 }); await sleep(1300); await s.page.keyboard.press('Enter'); await sleep(800);
  if (/Select Batch/.test(await s.text())) { await s.page.keyboard.press('Enter'); await sleep(600); }
  await put(s, String(packs)); await s.page.keyboard.press('Enter'); await sleep(600);
  await s.page.keyboard.press('F12'); await sleep(1200);
  // G13: the header number the cashier sees BEFORE saving. After saving, the
  // header already shows the next bill's number, which round 3 misread as a renumber.
  const before_save = ((await s.text()).match(/C0\d-INV-\d+/g) || []).slice(-1)[0] || null;
  await s.page.keyboard.down('Control'); await s.page.keyboard.press('KeyS'); await s.page.keyboard.up('Control'); await sleep(3500);
  const after_save = (await s.text()).split('\n').filter((l) => /offline|queued|saved|C0\d-INV|sync|pending|error|failed/i.test(l)).slice(-6);
  return { before_save, after_save };
}
(async () => {
  const ev = { bills: [] };
  const before = sql('select count(*) n, max(id) m from invoices where store_id=4')[0];
  const s = await claim('j10_02', 2, 4);
  await s.page.keyboard.press('F1'); await sleep(1000);
  s.goOffline();
  await sleep(1500);
  ev.status_offline = (await s.text()).split('\n').filter((l) => /offline|online|synced|sync/i.test(l)).slice(0, 6);
  for (let i = 1; i <= 3; i++) { const m = await sellOne(s, i); ev.bills.push({ i, screen: m }); console.log('offline bill', i, JSON.stringify(m)); }
  ev.dropped_while_offline = s.dropped().length;
  ev.server_during_offline = sql('select count(*) n from invoices where store_id=4')[0].n - before.n;
  ev.status_before_reconnect = (await s.text()).split('\n').filter((l) => /offline|pending|unsynced|queue|sync/i.test(l)).slice(0, 8);
  await s.screenshot('j10_02_offline_status');
  const n0 = s.net.length;
  s.goOnline();
  for (let i = 0; i < 12; i++) { await sleep(5000); const got = sql('select count(*) n from invoices where store_id=4')[0].n - before.n; if (got >= 3) break; }
  await sleep(8000);
  ev.reconnect_calls = s.net.slice(n0).filter((n) => !['GET', 'OPTIONS'].includes(n.method)).map((n) => ({ m: n.method, u: n.url.replace(/.*\/api/, ''), st: n.status, res: (n.response_body || '').slice(0, 300) }));
  ev.status_after = (await s.text()).split('\n').filter((l) => /offline|pending|unsynced|queue|sync/i.test(l)).slice(0, 8);
  const rows = sql(`select id,invoice_number,external_id,grand_total,counter_code,created_at from invoices where store_id=4 and id>${before.m || 0} order by id`);
  ev.server_rows = rows;
  ev.items = rows.map((r) => sql(`select product_name,qty,taxable_amount,tax_amount,total_amount from invoice_items where invoice_id=${r.id}`));
  ev.payments = rows.map((r) => sql(`select payment_mode,amount from invoice_payments where invoice_id=${r.id}`));
  ev.dup_numbers = sql("select invoice_number,count(*) c from invoices group by store_id,invoice_number having c>1");
  ev.dup_external = sql("select external_id,count(*) c from invoices where external_id is not null group by external_id having c>1");
  ev.ledger = sql(`select reference_id,qty_delta from stock_ledger_entries where reference_type='INVOICE' and reference_id in (${rows.map((r) => r.id).join(',') || 0})`);
  console.log('SERVER ROWS', JSON.stringify(rows));
  console.log('ITEMS', JSON.stringify(ev.items));
  console.log('PAYMENTS', JSON.stringify(ev.payments), 'LEDGER', JSON.stringify(ev.ledger));
  console.log('DUPS', JSON.stringify(ev.dup_numbers), JSON.stringify(ev.dup_external));
  console.log('RECONNECT CALLS', JSON.stringify(ev.reconnect_calls.map((c) => c.m + ' ' + c.u + ' ' + c.st)));
  evidence('J10_02_offline', ev);
  await s.close();
})();
