// J6.01 one-time PIN (bound, single-use, expiry) + manager PIN; J6.02 cancel with reversal; J6.03 closed period
const { api, sql, evidence, state, saveState, adminToken, sleep } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {};
  const t = await adminToken(); const A = { token: t, store: 4 };
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  // staff: manager with PIN (admin panel API)
  let mgr = sql("select id from users where email='qa.ph.manager@example.test'")[0];
  if (!mgr) {
    const r = await api('POST', '/admin/users', { name: 'QA PH Manager', email: 'qa.ph.manager@example.test', password: 'Qa-Mgr-Pass-2026!', role: 'manager', store_id: 4, pin: '482916' }, A);
    ev.create_manager = { st: r.status, body: r.text.slice(0, 300) };
    mgr = sql("select id from users where email='qa.ph.manager@example.test'")[0];
  }
  st.phManager = mgr && Number(mgr.id); saveState(st);
  const inv = sql("select id,invoice_number from invoices where invoice_number='C01-INV-8651'")[0];   // 90 cash, QA-PH
  const other = sql("select id,invoice_number from invoices where invoice_number='C01-INV-8751'")[0];
  // one-time PIN
  const iss = await api('POST', `/admin/invoices/${inv.id}/edit-approvals`, { action: 'edit', user_id: st.phManager, minutes: 10, reason: 'QA price correction' }, A);
  const pin = iss.json && iss.json.pin; ev.issue = { st: iss.status, has_pin: !!pin, msg: iss.json && iss.json.message };
  const v = (id, body) => api('POST', `/invoices/${id}/approvals/verify`, body, C);
  ev.otp_other_doc = await v(other.id, { action: 'edit', mode: 'one_time_pin', pin }).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  ev.otp_wrong_action = await v(inv.id, { action: 'cancel', mode: 'one_time_pin', pin }).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  ev.otp_ok = await v(inv.id, { action: 'edit', mode: 'one_time_pin', pin }).then((r) => ({ st: r.status, body: r.text.slice(0, 300) }));
  ev.otp_reuse = await v(inv.id, { action: 'edit', mode: 'one_time_pin', pin }).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  ev.otp_unauth = await api('POST', `/invoices/${inv.id}/approvals/verify`, { action: 'edit', mode: 'one_time_pin', pin: '000000' }).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  // manager PIN mode (the credential field is `secret`)
  ev.mgr_ok = await v(inv.id, { action: 'edit', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '482916', requested_by_user_id: st.phManager }).then((r) => ({ st: r.status, body: r.text.slice(0, 300) }));
  // cancel grant for J6.02, minted while the manager is still unlocked
  const gCancel = await v(inv.id, { action: 'cancel', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '482916', requested_by_user_id: st.phManager });
  ev.grant_cancel = { st: gCancel.status, body: gCancel.text.slice(0, 200), has_token: !!(gCancel.json && gCancel.json.token) };
  const cancelToken = gCancel.json && gCancel.json.token;
  ev.mgr_wrong = [];
  for (let i = 0; i < 6; i++) ev.mgr_wrong.push(await v(inv.id, { action: 'edit', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '111111' }).then((r) => r.status + ' ' + r.text.slice(0, 120)));
  ev.mgr_after_lock = await v(inv.id, { action: 'edit', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '482916' }).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  // expiry: 1-minute PIN
  const iss2 = await api('POST', `/admin/invoices/${other.id}/edit-approvals`, { action: 'cancel', user_id: st.phManager, minutes: 1 }, A);
  const pin2 = iss2.json && iss2.json.pin;
  console.log('waiting 65s for OTP expiry…'); await sleep(65000);
  ev.otp_expired = await v(other.id, { action: 'cancel', mode: 'one_time_pin', pin: pin2 }).then((r) => ({ st: r.status, body: r.text.slice(0, 200) }));
  ev.approvals_rows = sql('select id,invoice_id,action,mode,status,expires_at,used_at from invoice_approvals order by id');
  // J6.02 cancel: without a grant is refused, the minted grant is redeemed exactly once
  const pre = { inv: sql(`select status,invoice_number,grand_total from invoices where id=${inv.id}`)[0], stock: sql("select stock_qty from product_batches where id=(select b.id from product_batches b join invoice_items ii on ii.batch_no=b.batch_no and ii.product_id=b.product_id where ii.invoice_id=" + inv.id + ")")[0], ledger: sql(`select count(*) n from stock_ledger_entries where reference_id='${inv.id}'`)[0].n };
  const noGrant = await api('POST', `/invoices/${inv.id}/cancel`, { reason: 'QA: cancel with no grant' }, C);
  const afterNoGrant = { inv: sql(`select status,cancelled_by from invoices where id=${inv.id}`)[0], grants: sql(`select count(*) n from invoice_approvals where invoice_id=${inv.id} and action='cancel' and consumed_at is not null`)[0].n };
  ev.cancel_without_grant = { st: noGrant.status, body: noGrant.text.slice(0, 300), after: afterNoGrant };
  const can = await api('POST', `/invoices/${inv.id}/cancel`, { reason: 'QA: customer changed mind', approval_token: cancelToken }, C);
  const post = { inv: sql(`select status,invoice_number,cancel_reason,cancelled_at,cancelled_by,grand_total,paid_amount from invoices where id=${inv.id}`)[0], payments: sql(`select payment_mode,amount,status from invoice_payments where invoice_id=${inv.id}`), stock: sql("select stock_qty from product_batches where id=(select b.id from product_batches b join invoice_items ii on ii.batch_no=b.batch_no and ii.product_id=b.product_id where ii.invoice_id=" + inv.id + ")")[0], ledger: sql(`select event_type,qty_delta from stock_ledger_entries where reference_id='${inv.id}'`), audit: sql(`select action,entity_id from audit_logs where entity_id='${inv.id}' or new_values like '%${inv.invoice_number}%' order by id desc limit 5`), grants: sql(`select action,status,consumed_at is not null as consumed,token_hash is null as token_cleared from invoice_approvals where invoice_id=${inv.id} and action='cancel'`) };
  ev.cancel = { st: can.status, body: can.text.slice(0, 300), pre, post };
  const cancelReuse = await api('POST', `/invoices/${inv.id}/cancel`, { reason: 'QA: replay the same grant', approval_token: cancelToken }, C);
  ev.cancel_replay = { st: cancelReuse.status, body: cancelReuse.text.slice(0, 200) };
  // number reuse check: no other invoice got the cancelled number
  ev.cancel_number_reused = sql(`select count(*) n from invoices where invoice_number='${inv.invoice_number}'`)[0].n;
  // J6.03 closed period: a grant minted while open cannot be spent after the close
  const victimRow = sql("select id,invoice_number,invoice_date from invoices where invoice_number='C01-INV-8751'")[0]
    || sql("select id,invoice_number,invoice_date from invoices where status='issued' and store_id=4 order by id desc limit 1")[0];
  const victim = victimRow;
  const day = victim.invoice_date ? String(victim.invoice_date).slice(0, 10) : '2026-11-21';
  const vIss = await api('POST', `/admin/invoices/${victim.id}/edit-approvals`, { action: 'cancel', user_id: st.phManager, minutes: 10, reason: 'QA close-day cancel grant' }, A);
  const vPin = vIss.json && vIss.json.pin;
  const vGrant = await v(victim.id, { action: 'cancel', mode: 'one_time_pin', pin: vPin, user_id: st.phManager });
  ev.grant_before_close = { st: vGrant.status, body: vGrant.text.slice(0, 200), has_token: !!(vGrant.json && vGrant.json.token), day };
  const victimToken = vGrant.json && vGrant.json.token;
  const dc = await api('POST', '/admin/day-close/close', { close_date: day, notes: 'QA close' }, A);
  ev.day_close = { st: dc.status, body: dc.text.slice(0, 300), day };
  const can2NoTok = await api('POST', `/invoices/${victim.id}/cancel`, { reason: 'QA after close, no grant' }, C);
  ev.cancel_after_close_no_grant = { st: can2NoTok.status, body: can2NoTok.text.slice(0, 300), status_now: sql(`select status from invoices where id=${victim.id}`)[0].status };
  const can2 = await api('POST', `/invoices/${victim.id}/cancel`, { reason: 'QA after close, stale grant', approval_token: victimToken }, C);
  ev.cancel_after_close = { st: can2.status, body: can2.text.slice(0, 300), status_now: sql(`select status from invoices where id=${victim.id}`)[0].status, grant_consumed: sql(`select consumed_at is not null as c from invoice_approvals where invoice_id=${victim.id} and action='cancel' order by id desc limit 1`)[0].c };
  const sale2 = await api('POST', '/invoices', { store_id: '4', external_id: 'qa_after_close_1', idempotency_key: 'qa_after_close_1', invoice_number: 'C02-INV-QA-AFTERCLOSE', invoice_date: day, customer_name: 'Walk-in Customer', payment_mode: 'Cash', paid_amount: 115, payments: [{ mode: 'Cash', amount: 115 }], tax_mode: 'inclusive', grand_total: 115, items: [{ product_id: '6', product_name: 'QA Cough Syrup 100ml', batch_id: '13', batch_no: 'CS-B2', qty: 1, loose_qty: 0, units_per_pack: 1, unit_price: 115, mrp: 120, gst_percent: 12 }] }, C);
  ev.sale_after_close = { st: sale2.status, body: sale2.text.slice(0, 200) };
  const reopen = await api('POST', '/admin/day-close/reopen', { close_date: day, reason: 'QA reopen' }, A);
  ev.reopen = { st: reopen.status, body: reopen.text.slice(0, 200), status_now: sql(`select status from store_day_closes where date(close_date)=date('${day}')`)[0].status };
  const can3 = await api('POST', `/invoices/${victim.id}/cancel`, { reason: 'QA after reopen', approval_token: victimToken }, C);
  ev.cancel_after_reopen = { st: can3.status, body: can3.text.slice(0, 300), status_now: sql(`select status from invoices where id=${victim.id}`)[0].status, grant_consumed: sql(`select consumed_at is not null as c from invoice_approvals where invoice_id=${victim.id} and action='cancel' order by id desc limit 1`)[0].c };
  for (const [k, x] of Object.entries(ev)) console.log(k, JSON.stringify(x).slice(0, 600));
  evidence('J6_approvals_cancel', ev);
})();
