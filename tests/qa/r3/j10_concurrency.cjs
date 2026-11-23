// J10.01 two counters sell the same last units concurrently; J10.05 admin counter list
const { api, sql, evidence, state, saveState, adminToken } = require('./lib.cjs');
const { issueCode } = require('./pos.cjs');
(async () => {
  const st = state(); const ev = {};
  const code = await issueCode(2, 4);
  const cl = await api('POST', '/counters/claim', { code, device_uuid: 'qa-api-till-ph-c01', device_name: 'QA API till PH C01' });
  const C1 = { device: cl.json.device_token, token: cl.json.device_token };
  const C2 = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  st.apiTillPH_C01 = { counterId: 2, token: cl.json.device_token }; saveState(st);
  const b = sql("select id,stock_qty from product_batches where batch_no='CS-B2'")[0];
  ev.start = b;
  const qty = Math.max(1, Number(b.stock_qty));        // each counter tries to sell ALL remaining units
  const body = (who) => ({ store_id: '4', external_id: `qa_race_${who}_${Date.now()}`, invoice_number: `${who}-INV-RACE`, invoice_date: '2026-11-21', customer_name: 'Walk-in Customer', place_of_supply: '32', payment_mode: 'Cash', paid_amount: 115 * qty, payments: [{ mode: 'Cash', amount: 115 * qty }], tax_mode: 'inclusive', grand_total: 115 * qty, counter_code: who, items: [{ product_id: '6', product_name: 'QA Cough Syrup 100ml', batch_id: String(b.id), batch_no: 'CS-B2', qty, loose_qty: 0, units_per_pack: 1, unit_price: 115, mrp: 120, gst_percent: 12 }] });
  const [r1, r2] = await Promise.all([api('POST', '/invoices', body('C01'), C1), api('POST', '/invoices', body('C02'), C2)]);
  ev.results = [{ st: r1.status, body: r1.text.slice(0, 200) }, { st: r2.status, body: r2.text.slice(0, 200) }];
  ev.end = { batch: sql(`select stock_qty from product_batches where id=${b.id}`)[0], ledger_sum: sql(`select sum(qty_delta) s from stock_ledger_entries where batch_id=${b.id}`)[0].s, negatives: sql(`select event_type,qty_delta,is_reconciled_negative,balance_after from stock_ledger_entries where batch_id=${b.id} order by id desc limit 3`) };
  console.log('RACE qty', qty, JSON.stringify(ev.results.map((r) => r.st)), JSON.stringify(ev.end));
  // J10.05 admin counter list
  const t = await adminToken();
  const lst = await api('GET', '/admin/counters?store_id=4', undefined, { token: t, store: 4 });
  const rows = (lst.json && (lst.json.counters || lst.json.data)) || [];
  ev.counter_list = rows.map((c) => ({ code: c.counter_code, status: c.status, last_seen_at: c.last_seen_at, last_bill_at: c.last_bill_at ?? c.last_invoice_at ?? null, last_salesperson: c.last_salesperson_name ?? null, unsynced: c.unsynced_items ?? c.unsynced_items_count ?? null, offline_periods: c.offline_periods ?? null, device: c.device_name }));
  console.log('COUNTERS', JSON.stringify(ev.counter_list));
  evidence('J10_concurrency', ev);
})();
