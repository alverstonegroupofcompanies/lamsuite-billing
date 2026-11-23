// J6.01 retry with correct params; J6.03 closed period with close_date
const { api, sql, evidence, state, adminToken, sleep } = require('./lib.cjs');
(async () => {
  const st = state(); const ev = {};
  const t = await adminToken(); const A = { token: t, store: 4 };
  const C = { device: st.apiTillPH.token, token: st.apiTillPH.token };
  const uid = st.phManager;
  const a = sql("select id from invoices where invoice_number='C01-INV-10351'")[0];   // issued sale
  const b = sql("select id from invoices where invoice_number='C01-INV-9651'")[0];
  const v = (id, body) => api('POST', `/invoices/${id}/approvals/verify`, body, C).then((r) => ({ st: r.status, body: r.text.slice(0, 220) }));
  const iss = await api('POST', `/admin/invoices/${a.id}/edit-approvals`, { action: 'edit', user_id: uid, minutes: 10 }, A);
  const pin = iss.json.pin;
  ev.otp_other_doc = await v(b.id, { action: 'edit', mode: 'one_time_pin', pin, user_id: uid });
  ev.otp_wrong_action = await v(a.id, { action: 'cancel', mode: 'one_time_pin', pin, user_id: uid });
  ev.otp_ok = await v(a.id, { action: 'edit', mode: 'one_time_pin', pin, user_id: uid });
  ev.otp_reuse = await v(a.id, { action: 'edit', mode: 'one_time_pin', pin, user_id: uid });
  ev.otp_no_token = await api('POST', `/invoices/${a.id}/approvals/verify`, { action: 'edit', mode: 'one_time_pin', pin, user_id: uid }).then((r) => ({ st: r.status, body: r.text.slice(0, 160) }));
  const iss2 = await api('POST', `/admin/invoices/${b.id}/edit-approvals`, { action: 'edit', user_id: uid, minutes: 1 }, A);
  ev.mgr_ok = await v(a.id, { action: 'edit', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '482916' });
  ev.mgr_wrong = [];
  for (let i = 0; i < 6; i++) ev.mgr_wrong.push((await v(a.id, { action: 'edit', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '111111' })).body.slice(0, 110));
  ev.mgr_after_lock = await v(a.id, { action: 'edit', mode: 'manager', identifier: 'qa.ph.manager@example.test', secret: '482916' });
  console.log('waiting 65s for expiry…'); await sleep(65000);
  ev.otp_expired = await v(b.id, { action: 'edit', mode: 'one_time_pin', pin: iss2.json.pin, user_id: uid });
  ev.approvals = sql('select id,invoice_id,action,mode,status,used_at from invoice_approvals order by id');
  ev.audit = sql("select action,entity_type,entity_id from audit_logs where action like '%approval%' order by id desc limit 8");
  // closed period
  // Mint a cancel grant while the day is still open: it must not survive the close.
  const victim = sql("select id,invoice_number,status,invoice_date from invoices where invoice_number='C02-INV-QA002'")[0];
  const day = victim.invoice_date ? String(victim.invoice_date).slice(0, 10) : '2026-11-21';
  const cancelIss = await api('POST', `/admin/invoices/${victim.id}/edit-approvals`, { action: 'cancel', user_id: uid, minutes: 10 }, A);
  const cancelGrant = await v(victim.id, { action: 'cancel', mode: 'one_time_pin', pin: cancelIss.json && cancelIss.json.pin, user_id: uid });
  const victimToken = cancelGrant.json && cancelGrant.json.token;
  ev.grant_before_close = { st: cancelGrant.status, body: cancelGrant.body.slice(0, 200), has_token: !!victimToken, day };
  const dc = await api('POST', '/admin/day-close/close', { close_date: day, notes: 'QA close' }, A);
  ev.day_close = { st: dc.status, body: dc.text.slice(0, 300) };
  const canNoTok = await api('POST', `/invoices/${victim.id}/cancel`, { reason: 'QA after close, no grant' }, C);
  ev.cancel_after_close_no_grant = { st: canNoTok.status, body: canNoTok.text.slice(0, 300), status_now: sql(`select status from invoices where id=${victim.id}`)[0].status };
  const can = await api('POST', `/invoices/${victim.id}/cancel`, { reason: 'QA after close, stale grant', approval_token: victimToken }, C);
  ev.cancel_after_close = { st: can.status, body: can.text.slice(0, 300), status_now: sql(`select status from invoices where id=${victim.id}`)[0].status, grant_consumed: sql(`select consumed_at is not null as c from invoice_approvals where invoice_id=${victim.id} and action='cancel' order by id desc limit 1`)[0].c };
  const reopen = await api('POST', '/admin/day-close/reopen', { close_date: day, reason: 'QA reopen after closed-period test' }, A);
  ev.reopen = { st: reopen.status, body: reopen.text.slice(0, 200) };
  const canAfterReopen = await api('POST', `/invoices/${victim.id}/cancel`, { reason: 'QA after reopen', approval_token: victimToken }, C);
  ev.cancel_after_reopen = { st: canAfterReopen.status, body: canAfterReopen.text.slice(0, 300), status_now: sql(`select status from invoices where id=${victim.id}`)[0].status, grant_consumed: sql(`select consumed_at is not null as c from invoice_approvals where invoice_id=${victim.id} and action='cancel' order by id desc limit 1`)[0].c };
  for (const [k, x] of Object.entries(ev)) console.log(k, JSON.stringify(x).slice(0, 700));
  evidence('J6_approvals2', ev);
})();
