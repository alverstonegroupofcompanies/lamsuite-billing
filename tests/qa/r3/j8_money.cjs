// J1.07 counter PIN/lockout/admin lock; J8.01 customer receipt; J8.03 supplier payment; J8.04 shift with mixed modes
const { api, sql, evidence, state, adminToken } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {};
  const t = await adminToken(); const A = { token: t, store: 4 };
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  // J1.07 PIN policy and lockout
  ev.pin_trivial = await api('POST', '/admin/counters/3/unlock-pin/reset', { pin: '1234' }, A).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.pin_set = await api('POST', '/admin/counters/3/unlock-pin/reset', { pin: '739214' }, A).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.pin_leak = sql('select unlock_pin_hash is not null has_hash, length(unlock_pin_hash) len from counters where id=3')[0];
  ev.unlock_wrong = [];
  for (let i = 0; i < 6; i++) ev.unlock_wrong.push(await api('POST', '/counter/unlock', { pin: '000111' }, C).then((r) => r.status + ' ' + r.text.slice(0, 100)));
  ev.unlock_right_after_lockout = await api('POST', '/counter/unlock', { pin: '739214' }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.counter_row = sql('select unlock_failed_attempts,unlock_locked_until,status from counters where id=3')[0];
  // admin lock -> counter calls refused -> unlock
  ev.admin_lock = await api('POST', '/admin/counters/3/lock', { reason: 'QA lock' }, A).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.call_while_locked = await api('GET', '/store', undefined, C).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.sale_while_locked = await api('POST', '/invoices', { store_id: '4', external_id: 'qa_locked_1', invoice_number: 'C02-INV-LOCKED', invoice_date: '2026-11-21', customer_name: 'Walk-in Customer', payment_mode: 'Cash', paid_amount: 115, payments: [{ mode: 'Cash', amount: 115 }], grand_total: 115, items: [{ product_id: '6', product_name: 'QA Cough Syrup 100ml', batch_id: '13', batch_no: 'CS-B2', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 115, mrp: 120, gst_percent: 12 }] }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.admin_unlock = await api('POST', '/admin/counters/3/unlock', {}, A).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  ev.call_after_unlock = await api('GET', '/store', undefined, C).then((r) => r.status);
  // J8.04 shift: open with PIN and float 1000; close with the counter's figures
  ev.shift_open = await api('POST', '/counter/shift/open', { pin: '739214', opening_float: 1000 }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 300) }));
  ev.shift_show = await api('GET', '/counter/shift', undefined, C).then((r) => ({ st: r.status, body: r.text.slice(0, 500) }));
  // two sales on C02 during the shift: cash 115, UPI 230 (ref)
  for (const [mode, qty, ref] of [['Cash', 1, null], ['UPI', 2, 'UTR-QA-778899']]) {
    const amt = 115 * qty; const ext = `qa_shift_${mode}_${Date.now()}`;
    const r = await api('POST', '/invoices', { store_id: '4', external_id: ext, idempotency_key: ext, invoice_number: `C02-INV-SH-${mode}`, invoice_date: '2026-11-21', customer_name: 'Walk-in Customer', place_of_supply: '32-Kerala', payment_mode: mode, paid_amount: amt, payments: [{ mode, amount: amt, reference_no: ref }], tax_mode: 'inclusive', grand_total: amt, counter_code: 'C02', items: [{ product_id: '6', product_name: 'QA Cough Syrup 100ml', batch_id: '13', batch_no: 'CS-B2', qty, loose_qty: 0, units_per_pack: 1, unit_price: 115, mrp: 120, gst_percent: 12 }] }, C);
    ev['shift_sale_' + mode] = r.status;
  }
  // close: counted cash 1100 (expected 1000 float + 115 cash = 1115 -> short 15). Till claims cash_sales 0 to see whose figure wins.
  ev.shift_close = await api('POST', '/counter/shift/close', { pin: '739214', closing_cash_actual: 1100, opening_float: 1000, cash_sales: 0, digital_sales: 0, cash_refunds: 0 }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 900) }));
  ev.shift_row = sql('select * from counter_shifts order by id desc limit 1');
  // J8.01 customer receipt: QA Credit Customer owes 90 (C02-INV-QA005)
  const c0 = sql('select current_balance from parties where id=6')[0].current_balance;
  ev.cust_receipt = await api('POST', '/payments/customer', { store_id: 4, customer_id: 6, amount: 90, payment_mode: 'UPI', reference_no: 'UTR-QA-RCPT-1', notes: 'against C02-INV-QA005' }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 300) }));
  ev.cust_after = { before: c0, after: sql('select current_balance from parties where id=6')[0].current_balance, invoice: sql("select payment_status,paid_amount from invoices where invoice_number='C02-INV-QA005'")[0], rows: sql('select * from customer_payments order by id desc limit 1') };
  ev.cust_receipt_cross_store = await api('POST', '/payments/customer', { store_id: 5, customer_id: 10, amount: 1, payment_mode: 'Cash' }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  // J8.03 supplier payment 5000 against QA-PB-002 (11,200)
  ev.sup_payment = await api('POST', '/payments/supplier', { store_id: 4, supplier_id: 8, amount: 5000, payment_mode: 'Bank Transfer', reference_no: 'NEFT-QA-1', notes: 'part of QA-PB-002' }, C).then((r) => ({ st: r.status, body: r.text.slice(0, 300) }));
  ev.sup_after = { party: sql('select current_balance from parties where id=8')[0], purchases: sql('select invoice_number,grand_total,paid_amount from purchases where store_id=4'), rows: sql('select * from supplier_payments order by id desc limit 1') };
  const led = await api('GET', '/admin/suppliers/8/ledger', undefined, A);
  ev.sup_ledger = led.json && { current_balance: led.json.current_balance, tx: led.json.transactions };
  for (const [k, x] of Object.entries(ev)) console.log(k, JSON.stringify(x).slice(0, 700));
  evidence('J8_money', ev);
})();
