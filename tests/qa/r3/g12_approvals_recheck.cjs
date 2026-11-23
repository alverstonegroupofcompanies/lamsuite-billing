/**
 * G12-APPROVALS against a live QA backend.
 *
 * APR-01 — a counter cancels only with a grant the server minted; the grant is
 *          spent once, the bill records who cancelled, and a queued (sync)
 *          cancel without a grant is refused and filed as a conflict.
 * PER-01 — a day the admin has closed refuses cancellation (till and panel)
 *          without spending the grant; reopening the day lets it through.
 *
 * Throwaway data only: it creates its own store, counter, manager, product and
 * bills, so it does not depend on the order of the journey scripts.
 */
const { api, adminToken, sql, one, evidence } = require('./lib.cjs');

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
  return ok;
};

(async () => {
  const admin = await adminToken();
  const stamp = Date.now().toString().slice(-6);
  const managerSecret = process.env.QA_G12_MANAGER_SECRET || `G12-Throwaway-${stamp}`;

  const storeRes = await api('POST', '/admin/stores', {
    name: `G12 Approvals QA ${stamp}`,
    code: `G12A${stamp}`,
    state_code: '32',
    store_type: 'pharmacy',
    gst_type: 'regular',
    tax_mode: 'inclusive',
  }, { token: admin });
  if (storeRes.status !== 201 && storeRes.status !== 200) throw new Error('store create failed ' + storeRes.text);
  const storeId = storeRes.json.id;
  const A = { token: admin, store: storeId };

  const managerRes = await api('POST', '/admin/users', {
    name: 'G12 Floor Manager',
    email: `g12.manager.${stamp}@example.test`,
    password: managerSecret,
    role: 'manager',
    store_id: storeId,
  }, A);
  if (managerRes.status !== 201 && managerRes.status !== 200) throw new Error('manager create failed ' + managerRes.text);
  const managerEmail = `g12.manager.${stamp}@example.test`;

  const counterRes = await api('POST', '/admin/counters', { counter_name: 'G12 Front Till', location_name: 'Front desk' }, A);
  if (counterRes.status !== 201 && counterRes.status !== 200) throw new Error('counter create failed ' + counterRes.text);
  const counterId = counterRes.json.counter.id;
  const codeRes = await api('POST', `/admin/counters/${counterId}/activation-code`, {}, A);
  if (codeRes.status !== 200) throw new Error('activation code failed ' + codeRes.text);
  const claimRes = await api('POST', '/counters/claim', {
    code: codeRes.json.code,
    device_uuid: `g12-approvals-${stamp}`,
    device_name: 'G12 QA till',
  });
  if (claimRes.status !== 200 || !claimRes.json.device_token) throw new Error('claim failed ' + claimRes.text);
  const device = claimRes.json.device_token;
  const C = { device };

  const productRes = await api('POST', '/products', {
    barcode: `G12BAR${stamp}`, name: 'G12 Approval Strip', mrp: 100, sel_rate: 100, gst_percent: 0, units_per_pack: 1,
  }, C);
  if (productRes.status !== 201) throw new Error('product create failed ' + productRes.text);
  const batchRes = await api('POST', `/products/${productRes.json.id}/batches`, {
    batch_no: 'G12-B1', expiry_date: '2028-01-01', stock_qty: 100, mrp: 100, selling_rate: 100,
  }, C);
  if (batchRes.status !== 201) throw new Error('batch create failed ' + batchRes.text);

  const bill = async (n) => {
    const externalId = `g12_${stamp}_${n}`;
    const res = await api('POST', '/invoices', {
      external_id: externalId,
      idempotency_key: externalId,
      customer_name: 'Walk-in Customer',
      payment_mode: 'Cash',
      payments: [{ mode: 'Cash', amount: 100 }],
      items: [{ product_id: productRes.json.id, batch_id: batchRes.json.id, batch_no: 'G12-B1', qty: 1, unit_price: 100, gst_percent: 0 }],
    }, C);
    if (res.status !== 201) throw new Error(`bill ${n} failed ${res.status} ${res.text}`);
    return { id: res.json.invoice.id, number: res.json.invoice.invoice_number, externalId };
  };
  const statusOf = (id) => one(`select status from invoices where id=${id}`);
  const grant = async (inv) => {
    const res = await api('POST', `/invoices/${inv.id}/approvals/verify`, {
      action: 'cancel', mode: 'manager', identifier: managerEmail, secret: managerSecret, counter_code: 'G12', reason: 'G12 recheck',
    }, C);
    // Never echo the grant itself: it is a live credential until spent.
    const body = res.status === 200 ? `${res.status} approval ${res.json.approval && res.json.approval.id}` : res.text.slice(0, 200);
    return { status: res.status, token: res.json && res.json.token, body };
  };
  const consumed = (inv) => Number(one(`select count(*) from invoice_approvals where invoice_id=${inv.id} and action='cancel' and consumed_at is not null`));

  const ev = { storeId, counterId };

  /* ---------- APR-01 ---------- */
  const a = await bill(1);
  const noTok = await api('POST', `/invoices/${a.id}/cancel`, { reason: 'G12 no grant' }, C);
  ev.cancel_without_grant = { st: noTok.status, body: noTok.text.slice(0, 200) };
  check('APR-01 cancel without a grant is refused', noTok.status === 403 && noTok.json.code === 'CANCEL_APPROVAL_REQUIRED', `${noTok.status} ${noTok.json && noTok.json.code}`);
  check('APR-01 refused cancel leaves the bill as sold', statusOf(a.id) !== 'cancelled', statusOf(a.id));

  const g = await grant(a);
  check('APR-01 manager verify mints a grant', g.status === 200 && !!g.token, g.body);
  const withTok = await api('POST', `/invoices/${a.id}/cancel`, { reason: 'G12 approved', approval_token: g.token }, C);
  const row = sql(`select status,cancelled_by from invoices where id=${a.id}`)[0];
  ev.cancel_with_grant = { st: withTok.status, row };
  check('APR-01 cancel with the grant succeeds', withTok.status === 200 && row.status === 'cancelled', `${withTok.status} ${row.status}`);
  check('APR-01 cancelled_by is stamped', row.cancelled_by !== null && row.cancelled_by !== undefined, String(row.cancelled_by));
  check('APR-01 the grant is spent', consumed(a) === 1);
  check('APR-01 the cancel is audited with its approval',
    Number(one(`select count(*) from audit_logs where action='invoice_cancelled' and entity_id='${a.id}' and new_values like '%approval_id%'`)) === 1);

  const b = await bill(2);
  const replay = await api('POST', `/invoices/${b.id}/cancel`, { reason: 'G12 replay', approval_token: g.token }, C);
  ev.replay_on_other_bill = { st: replay.status, body: replay.text.slice(0, 200) };
  check('APR-01 a spent grant cannot cancel another bill', replay.status === 403 && statusOf(b.id) !== 'cancelled', `${replay.status}`);

  const push = await api('POST', '/sync/push/batch', {
    items: [{ id: `g12-q-${stamp}`, entity_type: 'invoice', action: 'update', payload: {
      external_id: b.externalId, invoice_number: b.number, store_id: storeId, status: 'cancelled', cancel_reason: 'G12 queued without grant',
    } }],
  }, C);
  ev.sync_cancel_without_grant = { st: push.status, body: push.text.slice(0, 300) };
  check('APR-01 a queued cancel without a grant is not applied', statusOf(b.id) !== 'cancelled', statusOf(b.id));
  check('APR-01 the refused queued cancel is a sync-centre conflict',
    Number(one(`select count(*) from sync_events where entity_type='invoice' and entity_id='${b.id}' and status='conflict'`)) >= 1);

  /* ---------- PER-01 ---------- */
  const day = String(one(`select invoice_date from invoices where id=${b.id}`)).slice(0, 10);
  const gb = await grant(b);
  check('PER-01 grant minted while the day is open', gb.status === 200 && !!gb.token, gb.body);

  const close = await api('POST', '/admin/day-close/close', { close_date: day, notes: 'G12 recheck close' }, A);
  ev.day_close = { st: close.status, day };
  check('PER-01 admin closes the day', close.status === 200, `${close.status}`);

  const afterClose = await api('POST', `/invoices/${b.id}/cancel`, { reason: 'G12 after close', approval_token: gb.token }, C);
  ev.cancel_after_close = { st: afterClose.status, body: afterClose.text.slice(0, 250) };
  check('PER-01 cancel on a closed day is refused with 409', afterClose.status === 409 && afterClose.json.code === 'DAY_CLOSED_LOCKED', `${afterClose.status} ${afterClose.json && afterClose.json.code}`);
  check('PER-01 the closed day keeps the bill', statusOf(b.id) !== 'cancelled', statusOf(b.id));
  check('PER-01 the refused cancel does not spend the grant', consumed(b) === 0);

  const panel = await api('POST', `/admin/invoices/${b.id}/cancel`, { reason: 'G12 panel after close' }, A);
  ev.panel_cancel_after_close = { st: panel.status, body: panel.text.slice(0, 200) };
  check('PER-01 the admin panel cancel also respects the closed day', panel.status === 409 && statusOf(b.id) !== 'cancelled', `${panel.status}`);

  const reopen = await api('POST', '/admin/day-close/reopen', { close_date: day, reason: 'G12 recheck reopen' }, A);
  ev.reopen = { st: reopen.status, day_status: one(`select status from store_day_closes where store_id=${storeId} and date(close_date)='${day}'`) };
  check('PER-01 reopen sets the day open', reopen.status === 200 && ev.reopen.day_status === 'open', JSON.stringify(ev.reopen));

  const afterReopen = await api('POST', `/invoices/${b.id}/cancel`, { reason: 'G12 after reopen', approval_token: gb.token }, C);
  ev.cancel_after_reopen = { st: afterReopen.status };
  check('PER-01 after reopening, the same grant cancels the bill', afterReopen.status === 200 && statusOf(b.id) === 'cancelled', `${afterReopen.status}`);

  ev.failures = failures;
  const file = evidence('G12_approvals_recheck', ev);
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : failures.length + ' FAILED'} — evidence ${file}`);
  process.exit(failures.length === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
