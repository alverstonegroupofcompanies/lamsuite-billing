/**
 * G15-GAPS / GAP-02 — live replay of the QA defect.
 *
 * The defect said: "Sold (C02-INV-QA010) with no gate; users table has no
 * registration fields." This replays the till's own invoice payload for a
 * restricted drug against a running backend and reports what the server does:
 * no pharmacist, right PIN, wrong PIN, expired registration, and an unmarked
 * item that must still sell freely. It also reads the database back to prove
 * the confirmation was written and that no PIN was written anywhere.
 *
 * Throwaway environment only. Point it at the isolated QA backend:
 *   QA_BACKEND=http://127.0.0.1:8011 QA_DB=/tmp/cc6_evidence.sqlite \
 *     node tests/qa/r3/g15_gap02_pharmacist.cjs
 *
 * Nothing here touches the harness state.json — the token lives in memory only.
 */
const fs = require('fs');
const path = require('path');
const { api, sql } = require('./lib.cjs');

const ADMIN = { email: 'admin@lamstone.in', password: process.env.QA_ADMIN_PASS || 'password123' };
const STORE = process.env.QA_STORE || '4';
const COUNTER_CODE = process.env.QA_COUNTER || 'C02';
const OUT = process.env.QA_OUT || '/tmp/g15_gap02_evidence.json';

const rows = [];
const note = (id, expect, res, extra) => {
  const row = {
    id,
    expect,
    http: res.status,
    message: res.json?.message || String(res.text || '').slice(0, 160),
    ...extra,
  };
  rows.push(row);
  console.log(`${id.padEnd(34)} want "${expect}" -> HTTP ${row.http} ${String(row.message).slice(0, 120)}`);
  return row;
};

const attribution = {};

const invoice = (ext, over = {}) => ({
  store_id: STORE,
  store_code: 'QA-A',
  external_id: ext,
  idempotency_key: ext,
  invoice_number: ext,
  invoice_date: '2026-11-22',
  customer_name: 'Walk-in Customer',
  place_of_supply: '32-Kerala',
  payment_mode: 'Cash',
  paid_amount: 200,
  payments: [{ mode: 'Cash', amount: 200, status: 'received' }],
  counter_code: COUNTER_CODE,
  tax_mode: 'inclusive',
  store_state: '32',
  gst_type: 'regular',
  is_composition: false,
  subtotal: 169.49,
  discount_total: 0,
  tax_total: 30.51,
  round_off: 0,
  grand_total: 200,
  is_inter_state: false,
  ...attribution,
  items: [],
  ...over,
});

const restrictedLine = (qty = 1) => [{
  product_id: process.env.QA_PRODUCT || '1405',
  product_name: 'QA Antibiotic Syrup 200ml [A]',
  batch_id: process.env.QA_BATCH || '1421',
  batch_no: 'QA-A-LONG-01',
  expiry_date: '2028-06-30',
  qty, loose_qty: 0, free_qty: 0, free_loose_qty: 0,
  units_per_pack: 1,
  unit_price: 200, mrp: 215, gst_percent: 18,
  discount_percent: 0, discount_amount: 0, rate_basis: 'sel_rate',
}];

const plainLine = () => [{
  product_id: process.env.QA_PLAIN_PRODUCT || '1406',
  product_name: 'QA Hand Sanitizer 500ml (Case of 6) [A]',
  batch_no: 'QA-A-LONG-01',
  expiry_date: '2028-06-30',
  qty: 1, loose_qty: 0, units_per_pack: 6,
  unit_price: 95, mrp: 99.99, gst_percent: 28,
  discount_percent: 0, discount_amount: 0,
}];

(async () => {
  const login = await api('POST', '/login', ADMIN);
  if (!login.json?.token) throw new Error('admin login failed HTTP=' + login.status + ' ' + login.text);
  const admin = { token: login.json.token };

  // 1. The master data the owner would now enter in the panel.
  const findLookup = async (code) => {
    const list = await api('GET', '/admin/lookups?type=drug_schedule', undefined, { ...admin, store: STORE });
    return (list.json?.data || []).find((s) => String(s.code).toUpperCase() === code);
  };
  let scheduleId = await findLookup('H1');
  let sched;
  if (scheduleId) {
    scheduleId = scheduleId.id;
    sched = { status: 200, json: { message: 'Schedule H1 already on this store\'s list.' } };
  } else {
    sched = await api('POST', '/admin/lookups', {
      type: 'drug_schedule', store_id: Number(STORE), code: 'H1', name: 'Schedule H1',
      config: { restricted: true, prescription_required: true }, is_active: true, description: 'Replayed for GAP-02.',
    }, { ...admin, store: STORE });
    scheduleId = (sched.json?.data || sched.json?.lookup || sched.json || {}).id;
  }
  note('master: schedule H1', '201 or already present', sched, { scheduleId });

  const productId = process.env.QA_PRODUCT || '1405';
  const mark = await api('PUT', `/admin/products/${productId}`, { drug_schedule_id: Number(scheduleId) }, { ...admin, store: STORE });
  const stamped = mark.json?.product || mark.json?.data || mark.json || {};
  note('master: mark product H1', 'stamp schedule_code H1', mark, { schedule_code: stamped.schedule_code, drug_schedule_id: stamped.drug_schedule_id });

  const findStaff = async (name) => {
    const list = await api('GET', '/admin/salespeople', undefined, { ...admin, store: STORE });
    return (list.json?.salespeople || list.json?.data || []).find((s) => s.name === name);
  };
  const mk = async (name, regUntil, pin) => {
    const r = await api('POST', '/admin/salespeople', {
      name, is_pharmacist: true, reg_no: 'KPK-2019-' + Math.floor(Math.random() * 1e5),
      reg_valid_from: '2019-06-01', reg_valid_until: regUntil, pin, is_active: true,
    }, { ...admin, store: STORE });
    const id = (r.json?.salesperson || r.json?.data || {}).id ?? (await findStaff(name))?.id;
    return { r, id };
  };
  const live = await mk('QA GAP02 Live Pharmacist', '2031-12-31', '701945');
  note('staff: live pharmacist', '201', live.r, { staffId: live.id });
  const lapsed = await mk('QA GAP02 Lapsed Pharmacist', '2023-12-31', '812346');
  note('staff: lapsed pharmacist', '201', lapsed.r, { staffId: lapsed.id });
  const goodId = live.id;
  const lapsedId = lapsed.id;
  if (!goodId || !lapsedId) throw new Error('no pharmacist staff ids to confirm with');
  // This QA store runs salesperson_on_bill=required, so every bill must name a clerk.
  const clerk = await api('POST', '/admin/salespeople', { name: 'QA GAP02 Clerk', is_active: true }, { ...admin, store: STORE });
  const clerkId = (clerk.json?.salesperson || clerk.json?.data || {}).id ?? (await findStaff('QA GAP02 Clerk'))?.id;
  note('staff: clerk', '201', clerk, { staffId: clerkId });
  attribution.salesperson_id = String(clerkId);
  attribution.salesperson_name = 'QA GAP02 Clerk';

  // 2. A counter session, the way the till gets one.
  const counters = await api('GET', '/admin/counters', undefined, { ...admin, store: STORE });
  const counter = (counters.json?.data || counters.json?.counters || []).find((c) => c.counter_code === COUNTER_CODE);
  if (!counter) throw new Error('no counter ' + COUNTER_CODE + ' in store ' + STORE);
  let code = await api('POST', `/admin/counters/${counter.id}/activation-code`, {}, { ...admin, store: STORE });
  if (code.status !== 200) code = await api('POST', `/admin/counters/${counter.id}/reissue`, {}, { ...admin, store: STORE });
  if (!code.json?.code) throw new Error('no activation code HTTP=' + code.status + ' ' + code.text);
  const claimed = await api('POST', '/counters/claim', { code: code.json.code, device_uuid: 'g15-gap02-replay', device_name: 'GAP-02 replay' });
  const tillToken = claimed.json?.device_token;
  if (!tillToken) throw new Error('claim failed HTTP=' + claimed.status + ' ' + claimed.text);
  const till = { token: tillToken, device: tillToken };
  console.log(`counter ${COUNTER_CODE} claimed (token length ${String(tillToken).length})`);

  // 3. The bill itself, five ways.
  const stamp = Date.now();
  const a = await api('POST', '/invoices', invoice(`G02-${stamp}-A`, { items: restrictedLine() }), till);
  note('bill: restricted, no PIN', '422', a);

  const b = await api('POST', '/invoices', invoice(`G02-${stamp}-B`, { items: restrictedLine(), pharmacist_id: String(goodId), pharmacist_pin: '701945' }), till);
  note('bill: restricted, live PIN', '201', b, { invoice_id: (b.json?.invoice || {}).id });

  const c = await api('POST', '/invoices', invoice(`G02-${stamp}-C`, { items: restrictedLine(), pharmacist_id: String(goodId), pharmacist_pin: '000000' }), till);
  note('bill: restricted, wrong PIN', '422', c);

  const d = await api('POST', '/invoices', invoice(`G02-${stamp}-D`, { items: restrictedLine(), pharmacist_id: String(lapsedId), pharmacist_pin: '812346' }), till);
  note('bill: restricted, lapsed reg', '422', d);

  const e = await api('POST', '/invoices', invoice(`G02-${stamp}-E`, { items: plainLine(), subtotal: 74.22, tax_total: 20.78, grand_total: 95, paid_amount: 95, payments: [{ mode: 'Cash', amount: 95, status: 'received' }] }), till);
  note('bill: unmarked item', '201, no gate', e);

  // 4. What the database actually kept. The server numbers the bill itself, so
  // the read-back goes by the external id the till sent, not by a number.
  const bill = sql(`select id, invoice_number, pharmacist_id, pharmacist_name, pharmacist_reg_no, pharmacist_confirmed_at, salesperson_name from invoices where external_id='G02-${stamp}-B'`)[0] || null;
  const number = bill?.invoice_number || '';
  const conf = sql(`select id, document_type, document_reference, pharmacist_id, pharmacist_name, pharmacist_reg_no, restricted_items, mode, confirmed_at from pharmacist_confirmations where document_reference='${number}'`);
  const pinColumns = sql(`select name from pragma_table_info('pharmacist_confirmations')`).map((r) => r.name).filter((n) => /pin/i.test(n));
  const leaked = ['invoices', 'pharmacist_confirmations', 'audit_logs', 'salespeople']
    .flatMap((t) => sql(`select '${t}' as tbl, c.name as col from pragma_table_info('${t}') c where c.name like '%pin%'`).map((r) => `${r.tbl}.${r.col}`));
  console.log('\nDB: bill ' + JSON.stringify(bill));
  console.log('DB: confirmations ' + JSON.stringify(conf));
  console.log('DB: pin-shaped columns on the confirmation table ' + JSON.stringify(pinColumns));
  console.log('DB: pin-shaped columns across the touched tables ' + JSON.stringify(leaked));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ backend: require('./lib.cjs').BACKEND, rows, bill, conf, pinColumns, leaked }, null, 2));
  console.log('\nevidence -> ' + OUT);

  const failed = rows.filter((r) =>
    (r.id.startsWith('bill: restricted, no PIN') && r.http !== 422) ||
    (r.id.startsWith('bill: restricted, live PIN') && r.http !== 201) ||
    (r.id.startsWith('bill: restricted, wrong PIN') && r.http !== 422) ||
    (r.id.startsWith('bill: restricted, lapsed reg') && r.http !== 422) ||
    (r.id.startsWith('bill: unmarked item') && r.http !== 201));
  if (failed.length) { console.log('DEFECT STILL OPEN: ' + failed.map((f) => f.id).join(', ')); process.exit(1); }
  console.log('GAP-02 closed on this backend.');
})().catch((err) => { console.error('REPLAY FAILED: ' + err.message); process.exit(2); });
